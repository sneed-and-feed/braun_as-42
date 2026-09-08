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
   * @param {FeltPianoSynthesizer} [synth=null]
   * @param {number} [voiceIndex=0]
   */
  constructor(ctx, destination, wavetables, hammerBuffer = null, synth = null, voiceIndex = 0) {
    this.ctx = ctx;
    this.destination = destination;
    this.wavetables = wavetables;
    this.hammerBuffer = hammerBuffer;
    this.synth = synth;
    this.voiceIndex = voiceIndex;

    // Natural per-voice acoustic micro-dispersion (cents detune and overtone spread)
    // Golden-ratio quasi-random distribution across voices ensures no two voices in a chord phase identically
    this.dispersionOffset = ((voiceIndex * 1.6180339887) % 1 - 0.5) * 2.8; // -1.4 to +1.4 cents
    this.overtoneSpread = 1.5 + ((voiceIndex * 3) % 5) * 0.22; // 1.5 to 2.38 cents

    this.isActive = false;
    this.currentMidi = null;
    this.currentFreq = null;
    this.currentVelocity = 0.6;
    this.startTime = 0;
    this.currentWaveform = 'felt';
    this.currentHammerSource = null;

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

    // 24dB/octave lowpass filter (cascaded dual 12dB biquad filters with smooth Q=1.3)
    this.filter1 = ctx.createBiquadFilter();
    this.filter2 = ctx.createBiquadFilter();
    this.filter1.type = 'lowpass';
    this.filter2.type = 'lowpass';
    this.filter1.Q.setValueAtTime(1.3, ctx.currentTime);
    this.filter2.Q.setValueAtTime(1.3, ctx.currentTime);

    // Acoustic wooden body soundboard formant filter (peaking resonator)
    this.bodyFilter = ctx.createBiquadFilter();
    this.bodyFilter.type = 'peaking';
    this.bodyFilter.frequency.setValueAtTime(540, ctx.currentTime);
    this.bodyFilter.Q.setValueAtTime(1.6, ctx.currentTime);
    if (this.bodyFilter.gain && this.bodyFilter.gain.setValueAtTime) {
      this.bodyFilter.gain.setValueAtTime(2.5, ctx.currentTime);
    }

    // Hammer noise thump generator
    this.hammerGain = ctx.createGain();
    this.hammerGain.gain.setValueAtTime(0, ctx.currentTime);

    this.hammerFilter = ctx.createBiquadFilter();
    this.hammerFilter.type = 'bandpass';
    this.hammerFilter.frequency.setValueAtTime(280, ctx.currentTime);
    this.hammerFilter.Q.setValueAtTime(3.0, ctx.currentTime);

    // Oscillators: Osc 1 (Fundamental core) & Osc 2 (Detuned overtone)
    // Scaled to sum <= 0.86 so saturation shaper never hits hard digital boundary
    this.osc1 = ctx.createOscillator();
    this.osc2 = ctx.createOscillator();

    this.osc1Gain = ctx.createGain();
    this.osc2Gain = ctx.createGain();
    this.osc1Gain.gain.setValueAtTime(0.58, ctx.currentTime);
    this.osc2Gain.gain.setValueAtTime(0.28, ctx.currentTime);

    this.setWaveform(this.currentWaveform);

    this.osc1.detune.setValueAtTime(this.dispersionOffset, ctx.currentTime);
    this.osc2.detune.setValueAtTime(this.dispersionOffset + this.overtoneSpread, ctx.currentTime);

    // Connect oscillators -> Voice Mixer
    this.oscMixer = ctx.createGain();
    this.osc1.connect(this.osc1Gain);
    this.osc2.connect(this.osc2Gain);
    this.osc1Gain.connect(this.oscMixer);
    this.osc2Gain.connect(this.oscMixer);

    // Hammer thump connects to filter
    this.hammerGain.connect(this.hammerFilter);
    this.hammerFilter.connect(this.filter1);

    // Voice routing: OscMixer -> Saturation -> Filter1 -> Filter2 -> BodyFilter -> VoiceGain -> Destination
    this.oscMixer.connect(this.saturationShaper);
    this.saturationShaper.connect(this.filter1);
    this.filter1.connect(this.filter2);
    this.filter2.connect(this.bodyFilter);
    this.bodyFilter.connect(this.voiceGain);
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
   * Trigger note strike with register-dependent multisampled acoustic character
   * @param {number} freq - Fundamental frequency in Hz
   * @param {number} velocity - 0.0 to 1.0
   * @param {number} duration - Note duration in seconds
   * @param {Object} params - Global piano parameters
   */
  trigger(freq, velocity, duration, params) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const cancelTime = Math.max(now, ctx.currentTime);

    const feltDamp = params.tone ?? 0.65; // 0.0 (darkest felt) to 1.0 (bright chime)
    const hammerThump = params.hammer ?? 0.50; // Felt hammer click volume
    const decayMultiplier = params.decay ?? 1.0;
    const releaseTime = params.release ?? 1.8;

    this.currentFreq = freq;
    this.currentVelocity = velocity;

    // Acoustic register modeling (Teenage Engineering EP-1320 multisampled style):
    // Register 1: Bass octaves 1–2 (MIDI < 48 / freq < ~130.8 Hz)
    // Register 2: Mid octaves 3–4 (MIDI 48–71 / freq ~130.8 Hz to 523.25 Hz)
    // Register 3: Treble octaves 5–6 (MIDI >= 72 / freq > 523.25 Hz)
    const a4 = params.a4 || (this.synth ? this.synth.a4 : 440) || 440;
    const midi = Math.round(69 + 12 * Math.log2(Math.max(20, freq) / a4));
    this.currentMidi = midi;

    const isBass = midi < 48;
    const isTreble = midi >= 72;

    let registerDecayMult = 1.0;
    let hammerCutoff = 280;
    let hammerThumpGainMult = 0.35;
    let thumpDuration = 0.025; // 25ms
    let bodyFormantHz = 540;
    let osc1Vol = 0.58;
    let osc2Vol = 0.28;
    let filterAttackTime = 0.006;
    let filterDecayBase = 0.18;

    let maxCutoff;
    let restCutoff;

    if (isBass) {
      // Bass octaves 1-2: deep sub-weight, slower damping, and heavy felt hammer thud
      registerDecayMult = 1.45 + Math.max(0, (48 - midi) * 0.04);
      osc1Vol = 0.64;
      osc2Vol = 0.22;
      hammerCutoff = Math.min(220, Math.max(110, freq * 1.3));
      hammerThumpGainMult = 0.46;
      thumpDuration = 0.032;
      bodyFormantHz = Math.max(280, Math.min(420, 300 + (midi - 24) * 5));
      filterDecayBase = 0.26;
      maxCutoff = Math.min(6000, Math.max(freq * 1.7, 360 + (feltDamp * 2200 * velocity)));
      restCutoff = Math.min(1400, Math.max(120, freq * 1.05));
    } else if (isTreble) {
      // Treble octaves 5-6: brighter acoustic bell presence and quicker decay
      registerDecayMult = Math.max(0.48, 1.0 - (midi - 71) * 0.035);
      osc1Vol = 0.52;
      osc2Vol = 0.34;
      hammerCutoff = Math.min(1400, Math.max(550, freq * 0.9));
      hammerThumpGainMult = 0.26;
      thumpDuration = 0.016;
      bodyFormantHz = Math.min(950, 680 + (midi - 72) * 12);
      filterAttackTime = 0.004;
      filterDecayBase = 0.12;
      maxCutoff = Math.min(9500, Math.max(freq * 2.2, 750 + (feltDamp * 3600 * velocity)));
      restCutoff = Math.min(3800, Math.max(280, freq * 1.35));
    } else {
      // Mid octaves 3-4: rich resonant wooden body formant and singing sustain
      registerDecayMult = 1.0;
      bodyFormantHz = 480 + (midi - 48) * 5.5; // Spruce piano soundboard formant ~480-605 Hz
      hammerCutoff = Math.min(450, Math.max(240, freq * 1.2));
      hammerThumpGainMult = 0.35;
      thumpDuration = 0.025;
      filterDecayBase = 0.18;
      maxCutoff = Math.min(7500, Math.max(freq * 1.8, 420 + (feltDamp * 2600 * velocity)));
      restCutoff = Math.min(2200, Math.max(160, freq * 1.15));
    }

    // Check if voice is being stolen / re-triggered while currently sounding
    const curGain = Math.max(0.0001, this.voiceGain.gain.value || 0.0001);
    const isStealing = this.isActive || (curGain > 0.0005);

    // When stealing an active voice, give a fast 5ms micro-ramp down to silence
    // before re-tuning oscillators to eliminate phase-jump clicks.
    const declickRampTime = 0.005; // 5ms
    const noteStartTime = isStealing ? Math.max(now + declickRampTime, ctx.currentTime + declickRampTime) : now;

    if (isStealing) {
      if (typeof this.voiceGain.gain.cancelAndHoldAtTime === 'function') {
        this.voiceGain.gain.cancelAndHoldAtTime(cancelTime);
      } else {
        this.voiceGain.gain.cancelScheduledValues(cancelTime);
        this.voiceGain.gain.setValueAtTime(curGain, cancelTime);
      }
      this.voiceGain.gain.linearRampToValueAtTime(0.0001, noteStartTime);
    }

    // Pitch setting and per-voice micro-dispersion scheduled at noteStartTime
    this.osc1.frequency.cancelScheduledValues(cancelTime);
    this.osc2.frequency.cancelScheduledValues(cancelTime);
    this.osc1.frequency.setValueAtTime(freq, noteStartTime);
    this.osc2.frequency.setValueAtTime(freq, noteStartTime);

    this.osc1Gain.gain.setValueAtTime(osc1Vol, noteStartTime);
    this.osc2Gain.gain.setValueAtTime(osc2Vol, noteStartTime);
    if (typeof this.osc1.detune.cancelScheduledValues === 'function') {
      this.osc1.detune.cancelScheduledValues(cancelTime);
      this.osc2.detune.cancelScheduledValues(cancelTime);
    }
    this.osc1.detune.setValueAtTime(this.dispersionOffset, noteStartTime);
    this.osc2.detune.setValueAtTime(this.dispersionOffset + this.overtoneSpread, noteStartTime);

    // Apply soundboard body formant
    this.bodyFilter.frequency.setValueAtTime(bodyFormantHz, noteStartTime);

    // Frequency-dependent acoustic string decay (low notes ring longer, high notes decay faster)
    const baseDecay = Math.max(1.2, Math.min(10.0, 7.5 * Math.pow(220 / Math.max(60, freq), 0.45))) * decayMultiplier * registerDecayMult;

    // --- Hammer Transient Impulse ---
    // Clean up any previously running hammer buffer source
    if (this.currentHammerSource) {
      try {
        this.currentHammerSource.stop(noteStartTime);
      } catch (e) {}
      this.currentHammerSource = null;
    }

    // Smoothly de-click hammer gain if voice was stolen, avoiding abrupt step drop
    const curHammerGain = Math.max(0.0001, this.hammerGain.gain.value || 0.0001);
    this.hammerGain.gain.cancelScheduledValues(cancelTime);
    if (isStealing && curHammerGain > 0.001) {
      this.hammerGain.gain.setValueAtTime(curHammerGain, cancelTime);
      this.hammerGain.gain.linearRampToValueAtTime(0.0001, noteStartTime);
    } else {
      this.hammerGain.gain.setValueAtTime(0.0001, noteStartTime);
    }

    // Use pre-allocated zero-DC noise buffer with smooth micro-attack to prevent step clicks
    if (hammerThump > 0.01 && this.hammerBuffer) {
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.hammerBuffer;
      noiseSource.connect(this.hammerGain);

      this.hammerFilter.frequency.setValueAtTime(hammerCutoff, noteStartTime);

      const targetHammerGain = Math.max(0.0001, velocity * hammerThump * hammerThumpGainMult);
      // Smooth micro-attack to peak, then exponential decay down to silence with future-guaranteed targets
      const hammerAttackTarget = Math.max(noteStartTime + 0.0025, ctx.currentTime + 0.001);
      const hammerDecayTarget = Math.max(noteStartTime + thumpDuration, hammerAttackTarget + 0.003);
      this.hammerGain.gain.linearRampToValueAtTime(targetHammerGain, hammerAttackTarget);
      this.hammerGain.gain.exponentialRampToValueAtTime(0.0001, hammerDecayTarget);

      noiseSource.start(noteStartTime);
      noiseSource.stop(noteStartTime + thumpDuration);
      this.currentHammerSource = noiseSource;
    }

    // Anchor current filter cutoff to eliminate biquad filter leap clicks
    const curCutoff1 = Math.max(20, Math.min(20000, this.filter1.frequency.value || restCutoff));
    const curCutoff2 = Math.max(20, Math.min(20000, this.filter2.frequency.value || restCutoff));

    if (typeof this.filter1.frequency.cancelAndHoldAtTime === 'function') {
      this.filter1.frequency.cancelAndHoldAtTime(cancelTime);
      this.filter2.frequency.cancelAndHoldAtTime(cancelTime);
    } else {
      this.filter1.frequency.cancelScheduledValues(cancelTime);
      this.filter2.frequency.cancelScheduledValues(cancelTime);
    }

    if (isStealing) {
      this.filter1.frequency.setValueAtTime(curCutoff1, cancelTime);
      this.filter2.frequency.setValueAtTime(curCutoff2, cancelTime);
      this.filter1.frequency.linearRampToValueAtTime(restCutoff, noteStartTime);
      this.filter2.frequency.linearRampToValueAtTime(restCutoff, noteStartTime);
    } else {
      // Voice was idle/silent: cleanly anchor at restCutoff of struck note
      this.filter1.frequency.setValueAtTime(restCutoff, cancelTime);
      this.filter2.frequency.setValueAtTime(restCutoff, cancelTime);
    }

    // Filter attack ramp
    const filterAttackTarget = Math.max(noteStartTime + filterAttackTime, ctx.currentTime + 0.002);
    this.filter1.frequency.linearRampToValueAtTime(maxCutoff, filterAttackTarget);
    this.filter2.frequency.linearRampToValueAtTime(maxCutoff, filterAttackTarget);

    // Rapid exponential decay down to fundamental
    const filterDecayTime = filterDecayBase + (1.0 - feltDamp) * 0.25;
    const filterDecayTarget = Math.max(noteStartTime + filterAttackTime + filterDecayTime, filterAttackTarget + 0.01);
    this.filter1.frequency.exponentialRampToValueAtTime(restCutoff, filterDecayTarget);
    this.filter2.frequency.exponentialRampToValueAtTime(restCutoff, filterDecayTarget);

    // --- Master Amplitude Envelope ---
    // Smooth 7ms micro-attack ramp from 0.0001 to peakGain eliminates step discontinuity clicks
    const attackTime = 0.007;
    const peakGain = Math.max(0.005, velocity * (isBass ? 0.44 : isTreble ? 0.42 : 0.40));

    if (!isStealing) {
      this.voiceGain.gain.cancelScheduledValues(cancelTime);
      this.voiceGain.gain.setValueAtTime(0.0001, cancelTime);
    }
    // When stealing, the voice gain has already smoothly ramped down to 0.0001 at noteStartTime.
    // Ramping directly to peakGain from noteStartTime prevents redundant setValueAtTime collisions.
    const attackTarget = Math.max(noteStartTime + attackTime, ctx.currentTime + 0.002);
    this.voiceGain.gain.linearRampToValueAtTime(peakGain, attackTarget);

    // Long acoustic string decay
    const sustainLevel = Math.max(0.0002, peakGain * 0.4);
    const sustainTarget = Math.max(noteStartTime + attackTime + 0.5, attackTarget + 0.05);
    this.voiceGain.gain.exponentialRampToValueAtTime(sustainLevel, sustainTarget);
    const decayEndTarget = Math.max(noteStartTime + attackTime + baseDecay + releaseTime, sustainTarget + 0.1);
    this.voiceGain.gain.exponentialRampToValueAtTime(0.0001, decayEndTarget);

    this.isActive = true;
    this.startTime = noteStartTime;

    // Mark inactive when done and update polyphonic headroom
    const totalLifetime = (baseDecay + releaseTime + (isStealing ? declickRampTime : 0)) * 1000;
    setTimeout(() => {
      if (this.startTime === noteStartTime) {
        this.isActive = false;
        if (this.synth) {
          this.synth._updatePolyphonicHeadroom();
        }
      }
    }, totalLifetime);
  }

  release() {
    if (!this.isActive) return;
    const now = this.ctx.currentTime;
    const cancelTime = Math.max(now, this.ctx.currentTime);
    const curGain = Math.max(0.0001, this.voiceGain.gain.value || 0.0001);
    if (typeof this.voiceGain.gain.cancelAndHoldAtTime === 'function') {
      this.voiceGain.gain.cancelAndHoldAtTime(cancelTime);
    } else {
      this.voiceGain.gain.cancelScheduledValues(cancelTime);
      this.voiceGain.gain.setValueAtTime(curGain, cancelTime);
    }
    const releaseTarget = Math.max(cancelTime + 0.35, this.ctx.currentTime + 0.01);
    this.voiceGain.gain.exponentialRampToValueAtTime(0.0001, releaseTarget);
    setTimeout(() => {
      this.isActive = false;
      if (this.synth) {
        this.synth._updatePolyphonicHeadroom();
      }
    }, 380);
  }
}

export class FeltPianoSynthesizer {
  /**
   * @param {AudioContext} ctx
   * @param {Object} wavetables
   * @param {number} [voiceCount=24]
   */
  constructor(ctx, wavetables, voiceCount = 24) {
    this.ctx = ctx;
    this.wavetables = wavetables;
    this.currentWaveform = 'felt';

    // Master voice mixer bus for polyphonic summation
    this.voiceMixer = ctx.createGain();
    this.voiceMixer.gain.setValueAtTime(1.0, ctx.currentTime);

    // Calibrated piano bus headroom (0.38 base gain)
    this.baseOutputGain = 0.38;
    this.output = ctx.createGain();
    this.output.gain.setValueAtTime(this.baseOutputGain, ctx.currentTime);

    // Natural sympathetic string resonance & soundboard acoustic coupling:
    // Models undamped open string and soundboard body sympathetic resonance
    // (EP-1320 multisampled blend style: binds chords into unified acoustic instrument)
    this.sympatheticFilter1 = ctx.createBiquadFilter();
    this.sympatheticFilter1.type = 'bandpass';
    this.sympatheticFilter1.frequency.setValueAtTime(290, ctx.currentTime); // Wood cavity mode
    this.sympatheticFilter1.Q.setValueAtTime(3.2, ctx.currentTime);

    this.sympatheticFilter2 = ctx.createBiquadFilter();
    this.sympatheticFilter2.type = 'bandpass';
    this.sympatheticFilter2.frequency.setValueAtTime(560, ctx.currentTime); // Spruce soundboard bridge mode
    this.sympatheticFilter2.Q.setValueAtTime(3.5, ctx.currentTime);

    this.sympatheticGain = ctx.createGain();
    this.sympatheticGain.gain.setValueAtTime(0.14, ctx.currentTime);

    // Routing: voiceMixer feeds direct piano output and parallel sympathetic resonance
    this.voiceMixer.connect(this.output);
    this.voiceMixer.connect(this.sympatheticFilter1);
    this.voiceMixer.connect(this.sympatheticFilter2);
    this.sympatheticFilter1.connect(this.sympatheticGain);
    this.sympatheticFilter2.connect(this.sympatheticGain);
    this.sympatheticGain.connect(this.output);

    this.params = {
      tone: 0.60,      // Felt lowpass damping (0 = ultra soft Harold Budd, 1 = chime)
      hammer: 0.45,    // Wooden felt hammer impact
      decay: 1.0,      // Sustain length multiplier
      release: 1.8,    // Damper pedal release time
      volume: 0.80,    // Output volume
      sympathetic: 0.45 // EP-1320 sympathetic string soundboard coupling level
    };

    // Pre-allocate single hammer noise burst buffer once for all voices
    // Ensure zero DC offset and smooth windowed attack to prevent click/pop
    const thumpDuration = 0.025; // 25ms
    const thumpSamples = Math.floor(ctx.sampleRate * thumpDuration);
    this.hammerBuffer = ctx.createBuffer(1, thumpSamples, ctx.sampleRate);
    const d = this.hammerBuffer.getChannelData(0);

    // 1. Generate windowed noise with 2ms attack and exponential decay
    const attackSamples = Math.max(1, Math.floor(ctx.sampleRate * 0.002));
    for (let i = 0; i < thumpSamples; i++) {
      let s = Math.random() * 2 - 1;
      if (i < attackSamples) {
        // Hann / raised-cosine window starting at 0.0
        s *= 0.5 * (1 - Math.cos((Math.PI * i) / attackSamples));
      }
      s *= Math.exp(-i / (ctx.sampleRate * 0.007));
      d[i] = s;
    }
    d[0] = 0.0;
    d[thumpSamples - 1] = 0.0;

    // 2. High-precision DC removal: subtract weighted DC baseline that tapers to 0 at boundaries
    let sumD = 0;
    let sumW = 0;
    const weights = new Float32Array(thumpSamples);
    for (let i = 0; i < thumpSamples; i++) {
      sumD += d[i];
      const w = Math.sin((Math.PI * i) / (thumpSamples - 1));
      weights[i] = w;
      sumW += w;
    }

    const dcOffsetFactor = sumW > 0 ? sumD / sumW : 0;
    for (let i = 0; i < thumpSamples; i++) {
      d[i] -= dcOffsetFactor * weights[i];
    }
    d[0] = 0.0;
    d[thumpSamples - 1] = 0.0;

    // Polyphonic Voice Pool with synth backreference and per-voice index for acoustic micro-dispersion
    this.voices = [];
    for (let i = 0; i < voiceCount; i++) {
      this.voices.push(new FeltPianoVoice(ctx, this.voiceMixer, wavetables, this.hammerBuffer, this, i));
    }
    this.voiceIndex = 0;
  }

  /**
   * Recalculate dynamic polyphonic summing headroom attenuation (1 / sqrt(N_active))
   * Keeps master bus and limiter completely free of waveshaper flat-topping or distortion.
   */
  _updatePolyphonicHeadroom() {
    if (!this.ctx || !this.output || !this.output.gain) return;
    const activeCount = this.voices.reduce((acc, v) => acc + (v.isActive ? 1 : 0), 0);
    const polyHeadroom = 1.0 / Math.sqrt(Math.max(1, activeCount));
    const userVol = this.params.volume ?? 0.80;
    const targetGain = this.baseOutputGain * polyHeadroom * userVol;
    const now = this.ctx.currentTime;
    if (typeof this.output.gain.setTargetAtTime === 'function') {
      this.output.gain.setTargetAtTime(targetGain, Math.max(now, this.ctx.currentTime), 0.025);
    } else if (typeof this.output.gain.linearRampToValueAtTime === 'function') {
      this.output.gain.linearRampToValueAtTime(targetGain, now + 0.025);
    } else {
      this.output.gain.value = targetGain;
    }
  }

  /**
   * Trigger note
   * @param {number} freq
   * @param {number} [velocity=0.6]
   * @param {number} [duration=3.5]
   */
  playNote(freq, velocity = 0.6, duration = 3.5) {
    // 1. Find free inactive voice using round-robin rotation across pool
    let voice = null;
    const n = this.voices.length;
    for (let i = 0; i < n; i++) {
      const idx = (this.voiceIndex + i) % n;
      if (!this.voices[idx].isActive) {
        voice = this.voices[idx];
        this.voiceIndex = (idx + 1) % n;
        break;
      }
    }

    // 2. If all voices are active, steal the quietest or oldest sounding voice
    if (!voice) {
      voice = this.voices.reduce((best, v) => {
        const vGain = v.voiceGain ? v.voiceGain.gain.value : 0;
        const bestGain = best.voiceGain ? best.voiceGain.gain.value : 0;
        if (vGain < bestGain) return v;
        if (Math.abs(vGain - bestGain) < 0.01 && v.startTime < best.startTime) return v;
        return best;
      }, this.voices[0]);
    }

    voice.trigger(freq, velocity, duration, this.params);
    this._updatePolyphonicHeadroom();
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
    if (this.ctx) {
      const now = this.ctx.currentTime;

      // Modulate shared sympathetic resonance filters to track acoustic felt damping
      if (this.sympatheticFilter1 && this.sympatheticFilter1.frequency && this.sympatheticFilter1.frequency.setTargetAtTime) {
        this.sympatheticFilter1.frequency.setTargetAtTime(220 + this.params.tone * 120, now, 0.025);
      }
      if (this.sympatheticFilter2 && this.sympatheticFilter2.frequency && this.sympatheticFilter2.frequency.setTargetAtTime) {
        this.sympatheticFilter2.frequency.setTargetAtTime(440 + this.params.tone * 200, now, 0.025);
      }
      if (this.sympatheticGain && this.sympatheticGain.gain && this.sympatheticGain.gain.setTargetAtTime) {
        const sympScale = (this.params.sympathetic ?? 0.45) / 0.45;
        this.sympatheticGain.gain.setTargetAtTime((0.08 + this.params.tone * 0.10) * sympScale, now, 0.025);
      }

      for (const voice of this.voices) {
        if (voice.isActive && voice.currentFreq) {
          // Register-dependent rest cutoff calculation matching acoustic modeling
          const isBass = (voice.currentMidi != null && voice.currentMidi < 48) || voice.currentFreq < 130.8;
          const isTreble = (voice.currentMidi != null && voice.currentMidi >= 72) || voice.currentFreq > 523.25;
          let rest;
          if (isBass) {
            rest = Math.min(1800, Math.max(120, voice.currentFreq * (0.8 + this.params.tone * 0.5)));
          } else if (isTreble) {
            rest = Math.min(4800, Math.max(280, voice.currentFreq * (1.1 + this.params.tone * 0.8)));
          } else {
            rest = Math.min(2800, Math.max(160, voice.currentFreq * (0.9 + this.params.tone * 0.6)));
          }

          if (voice.filter1 && voice.filter1.frequency && voice.filter1.frequency.setTargetAtTime) {
            if (typeof voice.filter1.frequency.cancelAndHoldAtTime === 'function') {
              voice.filter1.frequency.cancelAndHoldAtTime(now);
            }
            voice.filter1.frequency.setTargetAtTime(rest, now, 0.025);
          }
          if (voice.filter2 && voice.filter2.frequency && voice.filter2.frequency.setTargetAtTime) {
            if (typeof voice.filter2.frequency.cancelAndHoldAtTime === 'function') {
              voice.filter2.frequency.cancelAndHoldAtTime(now);
            }
            voice.filter2.frequency.setTargetAtTime(rest, now, 0.025);
          }
        }
      }
    }
  }

  setSympathetic(val) {
    this.params.sympathetic = Math.max(0, Math.min(1.0, val));
    if (this.ctx && this.sympatheticGain && this.sympatheticGain.gain) {
      const now = this.ctx.currentTime;
      const sympScale = this.params.sympathetic / 0.45;
      const targetGain = (0.08 + (this.params.tone ?? 0.60) * 0.10) * sympScale;
      if (typeof this.sympatheticGain.gain.setTargetAtTime === 'function') {
        this.sympatheticGain.gain.setTargetAtTime(targetGain, now, 0.025);
      } else {
        this.sympatheticGain.gain.value = targetGain;
      }
    }
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
    this.params.volume = Math.max(0, Math.min(1.0, vol));
    this._updatePolyphonicHeadroom();
  }
}
