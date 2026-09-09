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
import { makeSoftClipCurve, makeTapeSaturationCurve, makeLimiterCurve } from './wavefolder.js';

export class AudioEngine {
  constructor(ctx = null) {
    this.ctx = ctx;
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
      humanize: 0.50,
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
    this.masterVolume = 0.80;
    this.tapeDrive = 0.18; // Analog master bus tape saturation

    this.feltParams = {
      tone: 0.62,
      hammer: 0.45,
      decay: 1.1,
      volume: 0.80,
      sympathetic: 0.45,
      waveform: 'felt'
    };

    this.droneBusGain = 0.22; // Calibrated ambient underbed (-8.0dB relative to felt piano bus)

    this.droneSnap = {
      1: 'deep-tonic',
      2: 'perfect-5th'
    };
    this.drone1Midi = 36 + this.rootPitchClass;
    this.drone1Freq = midiToFrequency(this.drone1Midi, this.a4);
    this.drone2Freq = this.drone1Freq * 1.5;

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
        vol: 0.55
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
        vol: 0.55
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
      if (!this.ctx) {
        const AudioContextClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
                                  (typeof globalThis !== 'undefined' && globalThis.AudioContext);
        if (!AudioContextClass) return;

        this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
      }
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        this.ctx.resume().catch(e => console.warn('AudioContext resume deferred:', e));
      }

    // Generate band-limited wavetables
    this.wavetables = createWavetableCache(this.ctx);

    // --- Master Bus & Limiter ---
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);

    // Analog Soft Limiter (prevents digital clipping, transparent unity gain below knee)
    this.masterLimiter = this.ctx.createWaveShaper();
    this.masterLimiter.oversample = '4x';
    this.masterLimiter.curve = makeLimiterCurve(2048, 0.80);

    // Analog Master Bus Tape Saturation Stage (adds warmth, musical harmonics, and tape glue)
    this.masterTapeSaturator = this.ctx.createWaveShaper();
    this.masterTapeSaturator.oversample = '4x';
    this.masterTapeSaturator.curve = makeTapeSaturationCurve(2048, this.tapeDrive);

    // Analyser Node for Oscilloscope & Lissajous Phase Meter
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    // Master Bus Peak Compressor / Brickwall Limiter (transparent protection against polyphonic summing overloads)
    if (this.ctx.createDynamicsCompressor) {
      this.masterCompressor = this.ctx.createDynamicsCompressor();
      this.masterCompressor.threshold.setValueAtTime(-3.0, this.ctx.currentTime); // -3 dBFS
      this.masterCompressor.knee.setValueAtTime(12.0, this.ctx.currentTime); // 12 dB smooth soft knee prevents hard threshold ducking clicks
      this.masterCompressor.ratio.setValueAtTime(8.0, this.ctx.currentTime); // 8:1 ratio
      this.masterCompressor.attack.setValueAtTime(0.003, this.ctx.currentTime); // 3ms attack
      this.masterCompressor.release.setValueAtTime(0.060, this.ctx.currentTime);

      this.masterGain.connect(this.masterCompressor);
      this.masterCompressor.connect(this.masterTapeSaturator);
      this.masterTapeSaturator.connect(this.masterLimiter);
    } else {
      this.masterGain.connect(this.masterTapeSaturator);
      this.masterTapeSaturator.connect(this.masterLimiter);
    }
    this.masterLimiter.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // --- FX Processors ---
    this.tapeDelay = new TapeDelay(this.ctx, {
      delayTimeL: this.delayParams.time,
      delayTimeR: this.delayParams.time * 1.5,
      feedback: this.delayParams.feedback,
      wetLevel: this.delayParams.wet,
      dryLevel: 0.0,
      inputPad: 0.38 // Calibrated -8.4dB headroom ensures max velocity polyphonic chords never overdrive delay line
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

    // Connect Delay into Reverb for lush cascade and into Master Bus
    // Calibrated Delay Return bus with compressor and soft limiting prevents circulating delay buildup from overdriving master or shimmer
    this.delayReturn = this.ctx.createGain();
    this.delayReturn.gain.setValueAtTime(1.0, this.ctx.currentTime);
    this.delayReturnLimiter = this.ctx.createWaveShaper();
    this.delayReturnLimiter.oversample = '4x';
    this.delayReturnLimiter.curve = makeLimiterCurve(2048, 0.78);

    if (this.ctx.createDynamicsCompressor) {
      this.delayReturnCompressor = this.ctx.createDynamicsCompressor();
      this.delayReturnCompressor.threshold.setValueAtTime(-6.0, this.ctx.currentTime); // -6 dBFS
      this.delayReturnCompressor.knee.setValueAtTime(4.0, this.ctx.currentTime);
      this.delayReturnCompressor.ratio.setValueAtTime(4.0, this.ctx.currentTime);
      this.delayReturnCompressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.delayReturnCompressor.release.setValueAtTime(0.080, this.ctx.currentTime);

      this.tapeDelay.output.connect(this.delayReturn);
      this.delayReturn.connect(this.delayReturnCompressor);
      this.delayReturnCompressor.connect(this.delayReturnLimiter);
    } else {
      this.tapeDelay.output.connect(this.delayReturn);
      this.delayReturn.connect(this.delayReturnLimiter);
    }
    this.delayReturnLimiter.connect(this.shimmerReverb.input);
    this.delayReturnLimiter.connect(this.masterGain);
    this.shimmerReverb.output.connect(this.masterGain);

    // --- Instruments ---
    // Harold Budd Felt Piano & Pluck
    this.feltPiano = new FeltPianoSynthesizer(this.ctx, this.wavetables, 24);
    this.feltPiano.setTone(this.feltParams.tone);
    this.feltPiano.setHammer(this.feltParams.hammer);
    this.feltPiano.setDecay(this.feltParams.decay);
    this.feltPiano.setVolume(this.feltParams.volume);
    this.feltPiano.setSympathetic(this.feltParams.sympathetic);
    this.feltPiano.setWaveform(this.feltParams.waveform);

    // Calibrated Felt Piano Bus
    this.pianoBus = this.ctx.createGain();
    this.pianoBus.gain.setValueAtTime(1.0, this.ctx.currentTime);

    // Dedicated Delay Send Bus with calibrated unity headroom
    this.delaySend = this.ctx.createGain();
    this.delaySend.gain.setValueAtTime(1.0, this.ctx.currentTime);

    this.feltPiano.output.connect(this.pianoBus);
    this.pianoBus.connect(this.masterGain);
    this.pianoBus.connect(this.delaySend);
    this.delaySend.connect(this.tapeDelay.input);
    this.pianoBus.connect(this.shimmerReverb.input);

    // Elta Solar 42n Microtonal Drone Voices (Voice 1 & Voice 2)
    this.droneBus = this.ctx.createGain();
    this.droneBus.gain.setValueAtTime(this.droneBusGain, this.ctx.currentTime);

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

    this.applyDrone1Snap();
    this.applyDrone2Snap();

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

    // Update Drone 1 & 2 root notes smoothly according to active snap presets
    this.applyDrone1Snap();
    this.applyDrone2Snap();
  }

  /**
   * Set quick-snap tuning preset for Drone Voice 1 or Voice 2
   * @param {number} voiceId - 1 or 2
   * @param {string} snapKey - Preset key
   * @returns {number} Selected frequency in Hz
   */
  setDroneSnap(voiceId, snapKey) {
    this.droneSnap[voiceId] = snapKey;
    if (voiceId === 1) {
      this.applyDrone1Snap();
      this.applyDrone2Snap();
      return this.drone1Freq;
    } else {
      return this.applyDrone2Snap();
    }
  }

  applyDrone1Snap() {
    const root = this.rootPitchClass;
    const snapKey = this.droneSnap[1] || 'deep-tonic';
    let midi = 36 + root; // default C2 (Deep Tonic)
    if (snapKey === 'sub-bass') midi = 24 + root; // C1 (Sub Bass)
    else if (snapKey === 'deep-tonic') midi = 36 + root; // C2 (Deep Tonic)
    else if (snapKey === 'warm-root') midi = 48 + root; // C3 (Warm Root)
    else if (snapKey === 'octave-up') midi = 60 + root; // C4 (Octave Up)

    this.drone1Midi = midi;
    this.drone1Freq = midiToFrequency(midi, this.a4);
    if (this.drone1) {
      this.drone1.setFrequency(this.drone1Freq);
    }
    return this.drone1Freq;
  }

  applyDrone2Snap() {
    const f1 = this.drone1Freq || (this.drone1 ? this.drone1.baseFreq : midiToFrequency(36 + this.rootPitchClass, this.a4));
    const snapKey = this.droneSnap[2] || 'perfect-5th';
    let freq = f1 * 1.5; // default 3:2 ratio

    if (snapKey === 'perfect-5th') {
      freq = f1 * 1.5; // 3:2 ratio
    } else if (snapKey === 'sus-4th') {
      freq = f1 * (4 / 3); // 4:3 ratio
    } else if (snapKey === 'major-9th') {
      freq = f1 * (9 / 8); // 9:8 ratio
    } else if (snapKey === 'beating-unison') {
      freq = f1;
      this.setDroneBeating(2, 0.35); // ~0.35 Hz acoustic beat offset
    }

    this.drone2Freq = freq;
    if (this.drone2) {
      this.drone2.setFrequency(freq);
    }
    return this.drone2Freq;
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

  setTapeDrive(drive) {
    this.tapeDrive = Math.max(0, Math.min(1.0, drive));
    if (this.ctx && this.masterTapeSaturator) {
      this.masterTapeSaturator.curve = makeTapeSaturationCurve(2048, this.tapeDrive);
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

  setFeltSympathetic(sympathetic) {
    this.feltParams.sympathetic = Math.max(0, Math.min(1.0, sympathetic));
    if (this.feltPiano) this.feltPiano.setSympathetic(this.feltParams.sympathetic);
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

  setPoissonHumanize(humanize) {
    if (this.poisson) {
      this.poisson.setParameters({ humanize });
    }
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

  setReverbDiffusion(diffusion) {
    this.setReverbDecay(diffusion);
  }

  setReverbDamping(damping) {
    this.reverbParams.damping = damping;
    if (this.shimmerReverb) this.shimmerReverb.setDamping(damping);
  }

  setReverbDamp(damping) {
    this.setReverbDamping(damping);
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
