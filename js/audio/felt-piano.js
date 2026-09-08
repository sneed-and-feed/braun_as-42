/**
 * @file felt-piano.js
 * @brief Harold Budd "Soft Pedal" felt piano / acoustic chime physical modeling engine.
 * Emulates the warm wooden felt hammer thud, steep 24dB resonant lowpass damping,
 * micro-detuned sympathetic string resonance, and dynamic acoustic decay.
 */

import { makeSoftClipCurve } from './wavefolder.js';

export class FeltPianoVoice {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination
   * @param {Object} wavetables
   * @param {AudioBuffer} [hammerBuffer=null]
   */
  constructor(ctx, destination, wavetables, hammerBuffer = null) {
    this.ctx = ctx;
    this.destination = destination;
    this.wavetables = wavetables;
    this.hammerBuffer = hammerBuffer;

    this.isActive = false;
    this.currentMidi = null;
    this.startTime = 0;
    this.currentWaveform = 'felt';

    this._buildVoice();
  }

  _buildVoice() {
    const ctx = this.ctx;

    // Master voice gain
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.setValueAtTime(0, ctx.currentTime);

    // Warmth / Saturation stage with 4x anti-aliasing oversampling
    this.saturationShaper = ctx.createWaveShaper();
    this.saturationShaper.oversample = '4x';
    this.saturationShaper.curve = makeSoftClipCurve(1024, 1.25);

    // 24dB/octave steep lowpass filter (cascaded dual 12dB biquad filters)
    this.filter1 = ctx.createBiquadFilter();
    this.filter2 = ctx.createBiquadFilter();
    this.filter1.type = 'lowpass';
    this.filter2.type = 'lowpass';
    this.filter1.Q.setValueAtTime(2.0, ctx.currentTime);
    this.filter2.Q.setValueAtTime(2.0, ctx.currentTime);

    // Hammer noise thump generator
    this.hammerGain = ctx.createGain();
    this.hammerGain.gain.setValueAtTime(0, ctx.currentTime);

    this.hammerFilter = ctx.createBiquadFilter();
    this.hammerFilter.type = 'bandpass';
    this.hammerFilter.frequency.setValueAtTime(280, ctx.currentTime);
    this.hammerFilter.Q.setValueAtTime(3.0, ctx.currentTime);

    // Oscillators: Osc 1 (Fundamental core) & Osc 2 (Detuned overtone)
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();

    this.osc1Gain = ctx.createGain();
    this.osc2Gain = ctx.createGain();
    this.osc1Gain.gain.setValueAtTime(0.85, ctx.currentTime);
    this.osc2Gain.gain.setValueAtTime(0.45, ctx.currentTime);

    this.setWaveform(this.currentWaveform);

    this.osc1.detune.setValueAtTime(0, ctx.currentTime);
    this.osc2.detune.setValueAtTime(1.8, ctx.currentTime); // 1.8 cents acoustic chorus detune

    // Connect oscillators -> Voice Mixer
    this.oscMixer = ctx.createGain();
    this.osc1.connect(this.osc1Gain);
    this.osc2.connect(this.osc2Gain);
    this.osc1Gain.connect(this.oscMixer);
    this.osc2Gain.connect(this.oscMixer);

    // Hammer thump connects to filter
    this.hammerGain.connect(this.hammerFilter);
    this.hammerFilter.connect(this.filter1);

    // Voice routing: OscMixer -> Saturation -> Filter1 -> Filter2 -> VoiceGain -> Destination
    this.oscMixer.connect(this.saturationShaper);
    this.saturationShaper.connect(this.filter1);
    this.filter1.connect(this.filter2);
    this.filter2.connect(this.voiceGain);
    this.voiceGain.connect(this.destination);

    this.osc1.start();
    this.osc2.start();
  }

  /**
   * Set voice waveform: 'felt' | 'sine' | 'saw' | 'square'
   */
  setWaveform(type) {
    this.currentWaveform = type;
    if (type === 'saw') {
      if (this.wavetables && this.wavetables.saw) {
        this.osc1.setPeriodicWave(this.wavetables.saw);
        this.osc2.setPeriodicWave(this.wavetables.warm || this.wavetables.saw);
      } else {
        this.osc1.type = 'sawtooth';
        this.osc2.type = 'sawtooth';
      }
    } else if (type === 'square') {
      if (this.wavetables && this.wavetables.square) {
        this.osc1.setPeriodicWave(this.wavetables.square);
        this.osc2.setPeriodicWave(this.wavetables.square);
      } else {
        this.osc1.type = 'square';
        this.osc2.type = 'square';
      }
    } else if (type === 'sine') {
      this.osc1.type = 'sine';
      this.osc2.type = 'sine';
    } else { // 'felt' / 'triangle' default
      this.osc1.type = 'sine';
      if (this.wavetables && this.wavetables.triangle) {
        this.osc2.setPeriodicWave(this.wavetables.triangle);
      } else {
        this.osc2.type = 'triangle';
      }
    }
  }

  /**
   * Trigger note strike
   * @param {number} freq - Fundamental frequency in Hz
   * @param {number} velocity - 0.0 to 1.0
   * @param {number} duration - Note duration in seconds
   * @param {Object} params - Global piano parameters
   */
  trigger(freq, velocity, duration, params) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.isActive = true;
    this.startTime = now;

    const feltDamp = params.tone ?? 0.65; // 0.0 (darkest felt) to 1.0 (bright chime)
    const hammerThump = params.hammer ?? 0.50; // Felt hammer click volume
    const decayMultiplier = params.decay ?? 1.0;
    const releaseTime = params.release ?? 1.8;

    // Pitch setting with microtonal detune
    this.osc1.frequency.setValueAtTime(freq, now);
    this.osc2.frequency.setValueAtTime(freq, now);

    // Frequency-dependent acoustic string decay (low notes ring longer, high notes decay faster)
    const baseDecay = Math.max(1.5, Math.min(9.0, 7.5 * Math.pow(220 / Math.max(60, freq), 0.45))) * decayMultiplier;

    // --- Hammer Transient Impulse ---
    // Use pre-allocated noise buffer to eliminate garbage-collection stutter
    if (hammerThump > 0.01 && this.hammerBuffer) {
      const thumpDuration = 0.025; // 25ms
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.hammerBuffer;
      noiseSource.connect(this.hammerGain);

      this.hammerFilter.frequency.setValueAtTime(Math.min(600, freq * 1.5), now);
      this.hammerGain.gain.cancelScheduledValues(now);
      this.hammerGain.gain.setValueAtTime(velocity * hammerThump * 0.45, now);
      this.hammerGain.gain.exponentialRampToValueAtTime(0.0001, now + thumpDuration);

      noiseSource.start(now);
      noiseSource.stop(now + thumpDuration);
    }

    // --- Steep Warm Lowpass Filter Envelope (Harold Budd Dampening) ---
    // Strike cutoff spikes up to 600 - 2400 Hz then rapidly drops down to the warm fundamental
    const maxCutoff = Math.min(8000, Math.max(freq * 1.8, 450 + (feltDamp * 2800 * velocity)));
    const restCutoff = Math.min(2200, Math.max(160, freq * 1.15));

    // Anchor current filter cutoff to prevent biquad step clicks
    const curCutoff1 = this.filter1.frequency.value;
    const curCutoff2 = this.filter2.frequency.value;
    this.filter1.frequency.cancelScheduledValues(now);
    this.filter2.frequency.cancelScheduledValues(now);
    this.filter1.frequency.setValueAtTime(curCutoff1, now);
    this.filter2.frequency.setValueAtTime(curCutoff2, now);

    // Fast 3.5ms attack to strike peak
    this.filter1.frequency.linearRampToValueAtTime(maxCutoff, now + 0.0035);
    this.filter2.frequency.linearRampToValueAtTime(maxCutoff, now + 0.0035);

    // Rapid exponential decay down to fundamental within 180ms - 450ms
    const filterDecayTime = 0.18 + (1.0 - feltDamp) * 0.25;
    this.filter1.frequency.exponentialRampToValueAtTime(restCutoff, now + filterDecayTime);
    this.filter2.frequency.exponentialRampToValueAtTime(restCutoff, now + filterDecayTime);

    // --- Master Amplitude Envelope ---
    // Anchor current voice gain to eliminate voice stealing / retrigger pop
    const curGain = this.voiceGain.gain.value;
    const peakGain = Math.max(0.01, velocity * 0.55);

    this.voiceGain.gain.cancelScheduledValues(now);
    this.voiceGain.gain.setValueAtTime(Math.max(0.0001, curGain), now);

    // 2.5ms click-free attack
    this.voiceGain.gain.linearRampToValueAtTime(peakGain, now + 0.0025);

    // Long acoustic string decay
    const sustainLevel = peakGain * 0.4;
    this.voiceGain.gain.exponentialRampToValueAtTime(sustainLevel, now + 0.5);
    this.voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + baseDecay + releaseTime);

    // Mark inactive when done
    setTimeout(() => {
      if (this.startTime === now) {
        this.isActive = false;
      }
    }, (baseDecay + releaseTime) * 1000);
  }

  release() {
    if (!this.isActive) return;
    const now = this.ctx.currentTime;
    const curGain = this.voiceGain.gain.value;
    this.voiceGain.gain.cancelScheduledValues(now);
    this.voiceGain.gain.setValueAtTime(Math.max(0.0001, curGain), now);
    this.voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    setTimeout(() => {
      this.isActive = false;
    }, 380);
  }
}

export class FeltPianoSynthesizer {
  /**
   * @param {AudioContext} ctx
   * @param {Object} wavetables
   * @param {number} [voiceCount=16]
   */
  constructor(ctx, wavetables, voiceCount = 16) {
    this.ctx = ctx;
    this.wavetables = wavetables;
    this.currentWaveform = 'felt';

    this.output = ctx.createGain();
    this.output.gain.setValueAtTime(0.9, ctx.currentTime);

    this.params = {
      tone: 0.60,      // Felt lowpass damping (0 = ultra soft Harold Budd, 1 = chime)
      hammer: 0.45,    // Wooden felt hammer impact
      decay: 1.0,      // Sustain length multiplier
      release: 1.8     // Damper pedal release time
    };

    // Pre-allocate single hammer noise burst buffer once for all voices
    const thumpDuration = 0.025; // 25ms
    const thumpSamples = Math.floor(ctx.sampleRate * thumpDuration);
    this.hammerBuffer = ctx.createBuffer(1, thumpSamples, ctx.sampleRate);
    const d = this.hammerBuffer.getChannelData(0);
    for (let i = 0; i < thumpSamples; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.007));
    }

    // Polyphonic Voice Pool
    this.voices = [];
    for (let i = 0; i < voiceCount; i++) {
      this.voices.push(new FeltPianoVoice(ctx, this.output, wavetables, this.hammerBuffer));
    }
    this.voiceIndex = 0;
  }

  /**
   * Trigger note
   * @param {number} freq
   * @param {number} [velocity=0.6]
   * @param {number} [duration=3.5]
   */
  playNote(freq, velocity = 0.6, duration = 3.5) {
    // Find free voice or steal least-recently-used
    let voice = this.voices.find(v => !v.isActive);
    if (!voice) {
      voice = this.voices[this.voiceIndex];
      this.voiceIndex = (this.voiceIndex + 1) % this.voices.length;
    }

    voice.trigger(freq, velocity, duration, this.params);
    return voice;
  }

  /**
   * Set core waveform across all voices: 'felt' | 'sine' | 'saw' | 'square'
   */
  setWaveform(type) {
    this.currentWaveform = type;
    for (const voice of this.voices) {
      voice.setWaveform(type);
    }
  }

  setTone(val) {
    this.params.tone = Math.max(0, Math.min(1.0, val));
  }

  setHammer(val) {
    this.params.hammer = Math.max(0, Math.min(1.0, val));
  }

  setDecay(val) {
    this.params.decay = Math.max(0.2, Math.min(3.0, val));
  }

  setRelease(val) {
    this.params.release = Math.max(0.1, Math.min(5.0, val));
  }

  setVolume(vol) {
    const v = Math.max(0, Math.min(1.0, vol));
    this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }
}
