/**
 * @file engine.js
 * @brief Master Audio Engine coordinator, audio bus routing, lossless WAV recorder,
 * and audio analysis hooks for the Braun Ambient Synthesizer.
 */

import { createWavetableCache } from './anti-aliasing.js';
import { FeltPianoSynthesizer } from './felt-piano.js';
import { SolarDroneVoice } from './drone-voice.js';
import { TapeDelay } from './tape-delay.js';
import { ShimmerReverb } from './shimmer-reverb.js';
import { PhaseLoopEngine } from '../generative/phase-loops.js';
import { PoissonGenerator } from '../generative/poisson.js';
import { SCALES, NOTE_NAMES, midiToFrequency } from '../generative/scales.js';
import { makeSoftClipCurve } from './wavefolder.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.isRecording = false;

    // Musical state
    this.rootPitchClass = 0; // 0 = C
    this.currentScaleKey = 'BUDD_PENTATONIC';
    this.a4 = 440;

    // Generative Engines initialized immediately so scales and loops work before power-on
    this.poisson = new PoissonGenerator({
      eventsPerMinute: 12,
      minRestSeconds: 0.6,
      maxRestSeconds: 8.5,
      rootPitchClass: this.rootPitchClass,
      scaleIntervals: SCALES[this.currentScaleKey].intervals,
      a4: this.a4
    });

    this.phaseLoops = new PhaseLoopEngine({
      rootPitchClass: this.rootPitchClass,
      scaleIntervals: SCALES[this.currentScaleKey].intervals,
      a4: this.a4
    });

    // Control parameters (cached so UI tweaks before power-on are seamlessly preserved)
    this.masterVolume = 0.85;

    this.feltParams = {
      tone: 0.62,
      hammer: 0.45,
      decay: 1.1,
      volume: 0.80,
      waveform: 'felt'
    };

    this.droneParams = {
      1: {
        active: false,
        waveA: 'saw',
        waveB: 'warm',
        beat: 0.35,
        detune: 2.5,
        fold: 45,
        cutoff: 650,
        res: 3.5,
        lfo: 0.12,
        vol: 0.75
      },
      2: {
        active: false,
        waveA: 'square',
        waveB: 'triangle',
        beat: 0.65,
        detune: -3.2,
        fold: 45,
        cutoff: 850,
        res: 3.5,
        lfo: 0.12,
        vol: 0.75
      }
    };

    this.delayParams = {
      time: 0.46,
      feedback: 0.55,
      wow: 0.45,
      tone: 3600,
      wet: 0.40
    };

    this.reverbParams = {
      decay: 8.5,
      damping: 0.60,
      shimmer: 0.45,
      wet: 0.45,
      freeze: false
    };

    // Recorder buffers
    this.recordedChunks = [];
    this.recorderNode = null;
  }

  /**
   * Initialize AudioContext on first user interaction
   */
  async init() {
    if (this.isInitialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch (e) {
          console.warn('AudioContext resume deferred:', e);
        }
      }
      return;
    }

    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      const AudioContextClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
                                (typeof globalThis !== 'undefined' && globalThis.AudioContext);
      if (!AudioContextClass) return;

      this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(e => console.warn('AudioContext resume deferred:', e));
      }

    // Generate band-limited wavetables
    this.wavetables = createWavetableCache(this.ctx);

    // --- Master Bus & Limiter ---
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);

    // Analog Soft Limiter (prevents digital clipping, adds warm saturation if pushed)
    this.masterLimiter = this.ctx.createWaveShaper();
    this.masterLimiter.oversample = '4x';
    this.masterLimiter.curve = makeSoftClipCurve(2048, 1.15);

    // Analyser Node for Oscilloscope & Lissajous Phase Meter
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    // Master Bus Peak Compressor / Brickwall Limiter (transparent protection against polyphonic summing overloads)
    if (this.ctx.createDynamicsCompressor) {
      this.masterCompressor = this.ctx.createDynamicsCompressor();
      this.masterCompressor.threshold.setValueAtTime(-1.0, this.ctx.currentTime); // -1 dBFS
      this.masterCompressor.knee.setValueAtTime(3.0, this.ctx.currentTime);
      this.masterCompressor.ratio.setValueAtTime(20.0, this.ctx.currentTime);
      this.masterCompressor.attack.setValueAtTime(0.002, this.ctx.currentTime);
      this.masterCompressor.release.setValueAtTime(0.050, this.ctx.currentTime);

      this.masterGain.connect(this.masterCompressor);
      this.masterCompressor.connect(this.masterLimiter);
    } else {
      this.masterGain.connect(this.masterLimiter);
    }
    this.masterLimiter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // --- FX Processors ---
    this.tapeDelay = new TapeDelay(this.ctx, {
      delayTimeL: this.delayParams.time,
      delayTimeR: this.delayParams.time * 1.5,
      feedback: this.delayParams.feedback,
      wetLevel: this.delayParams.wet,
      dryLevel: 0.0
    });
    this.tapeDelay.setTone(this.delayParams.tone);
    this.tapeDelay.setWowFlutter(this.delayParams.wow);

    this.shimmerReverb = new ShimmerReverb(this.ctx, {
      decayTime: this.reverbParams.decay,
      damping: this.reverbParams.damping,
      shimmerAmount: this.reverbParams.shimmer,
      wetLevel: this.reverbParams.wet,
      dryLevel: 0.0
    });
    if (this.reverbParams.freeze) {
      this.shimmerReverb.setFreeze(true);
    }

    // Connect Delay into Reverb for lush cascade
    this.tapeDelay.output.connect(this.shimmerReverb.input);
    this.tapeDelay.output.connect(this.masterGain);
    this.shimmerReverb.output.connect(this.masterGain);

    // --- Instruments ---
    // Harold Budd Felt Piano & Pluck
    this.feltPiano = new FeltPianoSynthesizer(this.ctx, this.wavetables, 24);
    this.feltPiano.setTone(this.feltParams.tone);
    this.feltPiano.setHammer(this.feltParams.hammer);
    this.feltPiano.setDecay(this.feltParams.decay);
    this.feltPiano.setVolume(this.feltParams.volume);
    this.feltPiano.setWaveform(this.feltParams.waveform);

    this.feltPiano.output.connect(this.masterGain);
    this.feltPiano.output.connect(this.tapeDelay.input);
    this.feltPiano.output.connect(this.shimmerReverb.input);

    // Elta Solar 42n Microtonal Drone Voices (Voice 1 & Voice 2)
    this.droneBus = this.ctx.createGain();
    this.droneBus.gain.setValueAtTime(0.85, this.ctx.currentTime);

    this.drone1 = new SolarDroneVoice(this.ctx, this.droneBus, this.wavetables, 1);
    this.drone2 = new SolarDroneVoice(this.ctx, this.droneBus, this.wavetables, 2);

    [1, 2].forEach(id => {
      const drone = id === 1 ? this.drone1 : this.drone2;
      const p = this.droneParams[id];
      drone.setWaveA(p.waveA);
      drone.setWaveB(p.waveB);
      drone.setBeatingHz(p.beat);
      drone.setDetuneCents(p.detune);
      drone.setWavefold(1.0 + (p.fold / 50), p.fold / 100);
      drone.setCutoff(p.cutoff);
      drone.setResonance(p.res);
      drone.setLfo(p.lfo, 180);
      drone.setVolume(p.vol);
      if (p.active) drone.setActive(true);
    });

    const drone1Midi = 36 + this.rootPitchClass;
    const drone2Midi = 43 + this.rootPitchClass;
    this.drone1.setFrequency(midiToFrequency(drone1Midi, this.a4));
    this.drone2.setFrequency(midiToFrequency(drone2Midi, this.a4));

    this.droneBus.connect(this.masterGain);
    this.droneBus.connect(this.tapeDelay.input);
    this.droneBus.connect(this.shimmerReverb.input);

    this.isInitialized = true;
    })();

    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  /**
   * Set musical root note and modal scale
   */
  setScale(scaleKey, rootPitchClass = this.rootPitchClass) {
    this.currentScaleKey = scaleKey;
    this.rootPitchClass = rootPitchClass;

    const scale = SCALES[scaleKey] || SCALES.BUDD_PENTATONIC;
    if (this.poisson) {
      this.poisson.setParameters({
        rootPitchClass: this.rootPitchClass,
        scaleIntervals: scale.intervals,
        a4: this.a4
      });
    }

    if (this.phaseLoops) {
      this.phaseLoops.updateScale(this.rootPitchClass, scale.intervals, this.a4);
    }

    // Update Drone 1 & 2 root notes smoothly
    if (this.drone1 && this.drone2) {
      const drone1Midi = 36 + this.rootPitchClass; // Base octave 2
      const drone2Midi = 43 + this.rootPitchClass; // 5th above
      this.drone1.setFrequency(midiToFrequency(drone1Midi, this.a4));
      this.drone2.setFrequency(midiToFrequency(drone2Midi, this.a4));
    }
  }

  setTuningReference(a4) {
    this.a4 = a4;
    this.setScale(this.currentScaleKey, this.rootPitchClass);
  }

  setMasterVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(1.0, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.03);
    }
  }

  setFeltTone(tone) {
    this.feltParams.tone = tone;
    if (this.feltPiano) this.feltPiano.setTone(tone);
  }

  setFeltHammer(hammer) {
    this.feltParams.hammer = hammer;
    if (this.feltPiano) this.feltPiano.setHammer(hammer);
  }

  setFeltDecay(decay) {
    this.feltParams.decay = decay;
    if (this.feltPiano) this.feltPiano.setDecay(decay);
  }

  setFeltVolume(vol) {
    this.feltParams.volume = vol;
    if (this.feltPiano) this.feltPiano.setVolume(vol);
  }

  setFeltWaveform(wave) {
    this.feltParams.waveform = wave;
    if (this.feltPiano) this.feltPiano.setWaveform(wave);
  }

  setDroneActive(id, active) {
    this.droneParams[id].active = active;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) {
      return drone.setActive(active);
    }
    return active;
  }

  setDroneWaveA(id, wave) {
    this.droneParams[id].waveA = wave;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) drone.setWaveA(wave);
  }

  setDroneWaveB(id, wave) {
    this.droneParams[id].waveB = wave;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) drone.setWaveB(wave);
  }

  setDroneBeating(id, hz) {
    this.droneParams[id].beat = hz;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) drone.setBeatingHz(hz);
  }

  setDroneDetune(id, cents) {
    this.droneParams[id].detune = cents;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) drone.setDetuneCents(cents);
  }

  setDroneWavefold(id, percent) {
    this.droneParams[id].fold = percent;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) drone.setWavefold(1.0 + (percent / 50), percent / 100);
  }

  setDroneCutoff(id, hz) {
    this.droneParams[id].cutoff = hz;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) drone.setCutoff(hz);
  }

  setDroneResonance(id, q) {
    this.droneParams[id].res = q;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) drone.setResonance(q);
  }

  setDroneLfo(id, hz) {
    this.droneParams[id].lfo = hz;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) drone.setLfo(hz, 180);
  }

  setDroneVolume(id, vol) {
    this.droneParams[id].vol = vol;
    const drone = id === 1 ? this.drone1 : this.drone2;
    if (drone) drone.setVolume(vol);
  }

  setDelayTime(sec) {
    this.delayParams.time = sec;
    if (this.tapeDelay) this.tapeDelay.setTime(sec);
  }

  setDelayFeedback(fb) {
    this.delayParams.feedback = fb;
    if (this.tapeDelay) this.tapeDelay.setFeedback(fb);
  }

  setDelayWow(wow) {
    this.delayParams.wow = wow;
    if (this.tapeDelay) this.tapeDelay.setWowFlutter(wow);
  }

  setDelayTone(tone) {
    this.delayParams.tone = tone;
    if (this.tapeDelay) this.tapeDelay.setTone(tone);
  }

  setDelayWet(wet) {
    this.delayParams.wet = wet;
    if (this.tapeDelay) this.tapeDelay.setWet(wet);
  }

  setReverbDecay(decay) {
    this.reverbParams.decay = decay;
    if (this.shimmerReverb) this.shimmerReverb.setDecay(decay);
  }

  setReverbDamping(damping) {
    this.reverbParams.damping = damping;
    if (this.shimmerReverb) this.shimmerReverb.setDamping(damping);
  }

  setReverbShimmer(shimmer) {
    this.reverbParams.shimmer = shimmer;
    if (this.shimmerReverb) this.shimmerReverb.setShimmer(shimmer);
  }

  setReverbWet(wet) {
    this.reverbParams.wet = wet;
    if (this.shimmerReverb) this.shimmerReverb.setWet(wet);
  }

  toggleReverbFreeze() {
    this.reverbParams.freeze = !this.reverbParams.freeze;
    if (this.shimmerReverb) {
      return this.shimmerReverb.toggleFreeze();
    }
    return this.reverbParams.freeze;
  }

  /**
   * Start lossless recording
   */
  startRecording() {
    if (!this.ctx || this.isRecording) return;
    if (!this.ctx.createScriptProcessor) return;
    this.isRecording = true;
    this.recordedBuffersL = [];
    this.recordedBuffersR = [];
    this.recordingLength = 0;

    // Use ScriptProcessorNode to intercept lossless raw 32-bit float audio samples
    this.recorderNode = this.ctx.createScriptProcessor(4096, 2, 2);
    this.recorderNode.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const inputL = e.inputBuffer.getChannelData(0);
      const inputR = e.inputBuffer.getChannelData(1);
      this.recordedBuffersL.push(new Float32Array(inputL));
      this.recordedBuffersR.push(new Float32Array(inputR));
      this.recordingLength += inputL.length;
    };

    // Connect through a silent zero-gain sink node to satisfy Web Audio active-node lifecycle
    // without leaking an 85ms buffer-delayed audio echo back to the speakers
    this.recorderSilentGain = this.ctx.createGain();
    this.recorderSilentGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.analyser.connect(this.recorderNode);
    this.recorderNode.connect(this.recorderSilentGain);
    this.recorderSilentGain.connect(this.ctx.destination);
  }

  /**
   * Stop recording and return WAV Blob
   * @returns {Blob}
   */
  stopRecording() {
    if (!this.isRecording) return null;
    this.isRecording = false;

    if (this.recorderNode) {
      this.recorderNode.onaudioprocess = null;
      this.analyser.disconnect(this.recorderNode);
      this.recorderNode.disconnect();
      this.recorderNode = null;
    }
    if (this.recorderSilentGain) {
      this.recorderSilentGain.disconnect();
      this.recorderSilentGain = null;
    }

    // Concatenate channels
    const totalSamples = this.recordingLength;
    const flatL = new Float32Array(totalSamples);
    const flatR = new Float32Array(totalSamples);

    let offset = 0;
    for (let i = 0; i < this.recordedBuffersL.length; i++) {
      flatL.set(this.recordedBuffersL[i], offset);
      flatR.set(this.recordedBuffersR[i], offset);
      offset += this.recordedBuffersL[i].length;
    }

    return this.encodeWAV(flatL, flatR, this.ctx.sampleRate);
  }

  /**
   * Encode stereo Float32Array into lossless 16-bit PCM WAV Blob
   */
  encodeWAV(left, right, sampleRate) {
    const numChannels = 2;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = left.length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // RIFF chunk descriptor
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');

    // fmt sub-chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // BitsPerSample

    // data sub-chunk
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Write interleaved 16-bit PCM samples with soft clipping
    let offset = 44;
    for (let i = 0; i < left.length; i++) {
      // Left channel
      let sL = Math.max(-1, Math.min(1, left[i]));
      view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7FFF, true);
      offset += 2;

      // Right channel
      let sR = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }
}
