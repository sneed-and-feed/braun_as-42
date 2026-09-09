/**
 * @file drone-voice.js
 * @brief Elta Solar 42n inspired microtonal twin-oscillator drone voice engine.
 * Dual oscillators, sub-hertz continuous beating, analog wavefolding,
 * resonant low-pass ladder filtering, and organic slow drift modulation.
 */

import { makeWavefoldCurve, makeSoftClipCurve } from './wavefolder.js';
import { midiToFrequency } from '../generative/scales.js';

export class SolarDroneVoice {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination
   * @param {Object} wavetables
   * @param {number} [voiceId=1]
   */
  constructor(ctx, destination, wavetables, voiceId = 1) {
    this.ctx = ctx;
    this.destination = destination;
    this.wavetables = wavetables;
    this.voiceId = voiceId;

    this.baseMidi = voiceId === 1 ? 36 : 43; // C2 (Voice 1) and G2 (Voice 2)
    this.baseFreq = midiToFrequency(this.baseMidi, 440);
    this.rootFreq = this.baseFreq;
    this.currentFreq = this.baseFreq;
    this.detuneCents = voiceId === 1 ? 2.5 : -3.2; // Initial subtle microtonal beating
    this._currentDetune = this.detuneCents;
    this.subHertzBeat = 0.35; // Sub-hertz beating frequency offset in Hz
    this.waveA = voiceId === 2 ? 'square' : 'saw';
    this.waveB = voiceId === 2 ? 'triangle' : 'warm';
    this.drive = 1.6;
    this.fold = 0.45;
    this.cutoff = 680;
    this._currentCutoff = this.cutoff;
    this._baseCutoff = 680;
    this.resonance = 3.5;
    this._baseResonance = 3.5;
    this.lfoRate = 0.12;
    this.lfoDepth = 180;
    this.volume = 0.55;
    this._currentGain = 0.0;
    this._lastDeclickTime = -1;
    this.pan = voiceId === 1 ? -0.45 : 0.45;
    this.isActive = false;

    this._buildGraph();
  }

  _buildGraph() {
    const ctx = this.ctx;

    // Master Voice Gain
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = 0.0;
    this.voiceGain.gain.setValueAtTime(0.0, ctx.currentTime);

    // Stereo Panner
    this.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.panner) {
      this.panner.pan.setValueAtTime(this.pan, ctx.currentTime);
      this.voiceGain.connect(this.panner);
      this.panner.connect(this.destination);
    } else {
      this.voiceGain.connect(this.destination);
    }

    // Resonant Filter Section (24dB / 4-pole cascaded biquad)
    this.filter1 = ctx.createBiquadFilter();
    this.filter2 = ctx.createBiquadFilter();
    this.filter1.type = 'lowpass';
    this.filter2.type = 'lowpass';
    this.filter1.frequency.setValueAtTime(this.cutoff, ctx.currentTime);
    this.filter2.frequency.setValueAtTime(this.cutoff, ctx.currentTime);
    this.filter1.Q.setValueAtTime(Math.sqrt(this.resonance), ctx.currentTime);
    this.filter2.Q.setValueAtTime(Math.sqrt(this.resonance), ctx.currentTime);

    // Wavefolder / Drive stage with 4x anti-aliasing oversampling
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.shaper.curve = makeWavefoldCurve(2048, this.drive, this.fold);

    // Twin Oscillators (Osc A & Osc B)
    this.oscA = ctx.createOscillator();
    this.oscB = ctx.createOscillator();

    this.oscAGain = ctx.createGain();
    this.oscBGain = ctx.createGain();
    this.oscAGain.gain.setValueAtTime(0.5, ctx.currentTime);
    this.oscBGain.gain.setValueAtTime(0.5, ctx.currentTime);

    // Dynamic wavefolder bypass routing gains:
    // When an oscillator is set to SQR / square, it routes directly to the resonant filter
    // (filter1) rather than folding past the peak in makeWavefoldCurve, which cancels the
    // fundamental and transforms the square wave into a thin, buzzing needle-spike whine.
    // Non-square waves (saw, warm, tri, sine) continue through the wavefolder shaper.
    this.oscAShaperGain = ctx.createGain();
    this.oscADirectGain = ctx.createGain();
    this.oscBShaperGain = ctx.createGain();
    this.oscBDirectGain = ctx.createGain();

    const isSqA = (this.waveA === 'square' || this.waveA === 'sqr');
    const isSqB = (this.waveB === 'square' || this.waveB === 'sqr');
    this.oscAShaperGain.gain.value = isSqA ? 0.0 : 1.0;
    this.oscADirectGain.gain.value = isSqA ? 1.0 : 0.0;
    this.oscBShaperGain.gain.value = isSqB ? 0.0 : 1.0;
    this.oscBDirectGain.gain.value = isSqB ? 1.0 : 0.0;
    if (typeof this.oscAShaperGain.gain.setValueAtTime === 'function') {
      this.oscAShaperGain.gain.setValueAtTime(isSqA ? 0.0 : 1.0, ctx.currentTime);
      this.oscADirectGain.gain.setValueAtTime(isSqA ? 1.0 : 0.0, ctx.currentTime);
      this.oscBShaperGain.gain.setValueAtTime(isSqB ? 0.0 : 1.0, ctx.currentTime);
      this.oscBDirectGain.gain.setValueAtTime(isSqB ? 1.0 : 0.0, ctx.currentTime);
    }

    this._applyWaveform(this.oscA, this.waveA);
    this._applyWaveform(this.oscB, this.waveB);

    this.oscA.frequency.setValueAtTime(this.baseFreq, ctx.currentTime);
    this.oscB.frequency.setValueAtTime(this.baseFreq + this.subHertzBeat, ctx.currentTime);
    this.oscA.detune.setValueAtTime(0, ctx.currentTime);
    this.oscB.detune.setValueAtTime(this.detuneCents, ctx.currentTime);

    // Mixer
    this.oscMixer = ctx.createGain();
    this.oscA.connect(this.oscAGain);
    this.oscB.connect(this.oscBGain);

    this.oscAGain.connect(this.oscAShaperGain);
    this.oscAGain.connect(this.oscADirectGain);
    this.oscAShaperGain.connect(this.oscMixer);
    this.oscADirectGain.connect(this.filter1);

    this.oscBGain.connect(this.oscBShaperGain);
    this.oscBGain.connect(this.oscBDirectGain);
    this.oscBShaperGain.connect(this.oscMixer);
    this.oscBDirectGain.connect(this.filter1);

    // Signal Flow: OscMixer -> Shaper -> Filter1 -> Filter2 -> VoiceGain -> Panner -> Destination
    this.oscMixer.connect(this.shaper);
    this.shaper.connect(this.filter1);
    this.filter1.connect(this.filter2);
    this.filter2.connect(this.voiceGain);

    // LFO Filter Modulation (Breathing organic movement)
    this.lfoOsc = ctx.createOscillator();
    this.lfoOsc.type = 'sine';
    this.lfoOsc.frequency.setValueAtTime(this.lfoRate, ctx.currentTime);

    this.lfoGain1 = ctx.createGain();
    this.lfoGain2 = ctx.createGain();
    const maxSafeDepth = Math.max(0, (this.cutoff - 30) * 0.85);
    const initialDepth = Math.min(this.lfoDepth, maxSafeDepth);
    this._appliedLfoDepth = initialDepth;
    this.lfoGain1.gain.setValueAtTime(initialDepth, ctx.currentTime);
    this.lfoGain2.gain.setValueAtTime(initialDepth, ctx.currentTime);

    this.lfoOsc.connect(this.lfoGain1);
    this.lfoOsc.connect(this.lfoGain2);
    this.lfoGain1.connect(this.filter1.frequency);
    this.lfoGain2.connect(this.filter2.frequency);

    this.oscA.start();
    this.oscB.start();
    this.lfoOsc.start();
  }

  _applyWaveform(osc, type) {
    if (!osc || !type) return;
    const raw = (typeof type === 'string') ? type.trim().toLowerCase() : type;
    const norm = (raw === 'sqr' || raw === 'square') ? 'square'
      : (raw === 'saw' || raw === 'sawtooth') ? 'sawtooth'
      : (raw === 'tri' || raw === 'triangle') ? 'triangle'
      : (raw === 'sin' || raw === 'sine') ? 'sine'
      : (raw === 'warm') ? 'warm'
      : raw;

    // Set standard Web Audio type for type inspection and native fallback
    if (['sine', 'square', 'sawtooth', 'triangle'].includes(norm)) {
      try {
        osc.type = norm;
      } catch (e) {}
    }

    if (norm === 'sine') {
      try {
        osc.type = 'sine';
        if (osc.periodicWave !== undefined) {
          osc.periodicWave = null;
        }
      } catch (e) {}
    } else if (norm === 'warm') {
      if (this.wavetables && this.wavetables.warm) {
        try {
          osc.setPeriodicWave(this.wavetables.warm);
        } catch (e) {}
      } else {
        try {
          osc.type = 'sawtooth';
          if (osc.periodicWave !== undefined) {
            osc.periodicWave = null;
          }
        } catch (e) {}
      }
    } else if (norm === 'square') {
      // Native Web Audio square oscillator uses optimal minBLEP / polyBLEP anti-aliasing
      // without Gibbs overshoot ripples. A truncated Fourier series wavetable creates
      // Gibbs ringing ripples at transitions that fold back and forth non-linearly
      // in the analog wavefolder shaper (makeWavefoldCurve), causing harsh screeching
      // and metallic distortion. Native osc.type = 'square' produces the authentic,
      // warm, hollow analog square wave tone.
      try {
        osc.type = 'square';
        if (osc.periodicWave !== undefined) {
          osc.periodicWave = null;
        }
      } catch (e) {}
    } else if (norm === 'sawtooth') {
      if (this.wavetables && (this.wavetables.saw || this.wavetables.sawtooth)) {
        try {
          osc.setPeriodicWave(this.wavetables.saw || this.wavetables.sawtooth);
        } catch (e) {}
      } else {
        try {
          osc.type = 'sawtooth';
          if (osc.periodicWave !== undefined) {
            osc.periodicWave = null;
          }
        } catch (e) {}
      }
    } else if (norm === 'triangle') {
      if (this.wavetables && (this.wavetables.triangle || this.wavetables.tri)) {
        try {
          osc.setPeriodicWave(this.wavetables.triangle || this.wavetables.tri);
        } catch (e) {}
      } else {
        try {
          osc.type = 'triangle';
          if (osc.periodicWave !== undefined) {
            osc.periodicWave = null;
          }
        } catch (e) {}
      }
    } else if (this.wavetables && (this.wavetables[raw] || this.wavetables[type])) {
      try {
        osc.setPeriodicWave(this.wavetables[raw] || this.wavetables[type]);
      } catch (e) {}
    } else {
      try {
        osc.type = 'sawtooth';
        if (osc.periodicWave !== undefined) {
          osc.periodicWave = null;
        }
      } catch (e) {}
    }
  }

  setWaveA(type) {
    const raw = (typeof type === 'string') ? type.trim().toLowerCase() : type;
    const norm = (raw === 'sqr' || raw === 'square') ? 'square'
      : (raw === 'saw' || raw === 'sawtooth') ? 'saw'
      : (raw === 'tri' || raw === 'triangle') ? 'triangle'
      : (raw === 'sin' || raw === 'sine') ? 'sine'
      : raw;
    this.waveA = norm;
    if (this.oscA) this._applyWaveform(this.oscA, norm);
    this._updateWaveformRouting();
  }

  setWaveB(type) {
    const raw = (typeof type === 'string') ? type.trim().toLowerCase() : type;
    const norm = (raw === 'sqr' || raw === 'square') ? 'square'
      : (raw === 'saw' || raw === 'sawtooth') ? 'saw'
      : (raw === 'tri' || raw === 'triangle') ? 'triangle'
      : (raw === 'sin' || raw === 'sine') ? 'sine'
      : raw;
    this.waveB = norm;
    if (this.oscB) this._applyWaveform(this.oscB, norm);
    this._updateWaveformRouting();
  }

  setWaveformA(type) {
    return this.setWaveA(type);
  }

  setWaveformB(type) {
    return this.setWaveB(type);
  }

  /**
   * Route square waves directly to filter1 bypassing the wavefolder shaper.
   * A wavefolder folds instantaneous rails inward past the peak, canceling the square
   * fundamental and producing an impulse-train whine. Direct routing preserves 100%
   * of the warm, rich fundamental energy and odd harmonic hollow character.
   */
  _updateWaveformRouting() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const isSqA = (this.waveA === 'square' || this.waveA === 'sqr');
    const isSqB = (this.waveB === 'square' || this.waveB === 'sqr');

    const targetShaperA = isSqA ? 0.0 : 1.0;
    const targetDirectA = isSqA ? 1.0 : 0.0;
    const targetShaperB = isSqB ? 0.0 : 1.0;
    const targetDirectB = isSqB ? 1.0 : 0.0;

    const slewRoutingParam = (gainNode, target) => {
      if (!gainNode || !gainNode.gain) return;
      const param = gainNode.gain;
      const curVal = (typeof param.value === 'number' && isFinite(param.value)) ? param.value : target;
      let held = false;
      if (typeof param.cancelAndHoldAtTime === 'function') {
        try {
          param.cancelAndHoldAtTime(now);
          held = true;
        } catch (e) {
          held = false;
        }
      }
      if (!held && typeof param.cancelScheduledValues === 'function') {
        param.cancelScheduledValues(now);
        if (typeof param.setValueAtTime === 'function') {
          param.setValueAtTime(curVal, now);
        }
      }
      if (typeof param.setTargetAtTime === 'function') {
        param.setTargetAtTime(target, now, 0.02);
      } else {
        param.value = target;
      }
    };

    if (this.oscAShaperGain) slewRoutingParam(this.oscAShaperGain, targetShaperA);
    if (this.oscADirectGain) slewRoutingParam(this.oscADirectGain, targetDirectA);
    if (this.oscBShaperGain) slewRoutingParam(this.oscBShaperGain, targetShaperB);
    if (this.oscBDirectGain) slewRoutingParam(this.oscBDirectGain, targetDirectB);
  }

  /**
   * Micro-gain declick crossfade (15–30 ms) during pitch jumps/frequency slewing
   * Dips output gain to near-silence for ~12ms and ramps back up to volume by ~25-30ms,
   * preventing pitch-slew transients from blasting into tape delay and shimmer reverb.
   * @param {number} [crossfadeTime=0.025] - Total crossfade duration in seconds
   */
  declickTransition(crossfadeTime = 0.025) {
    if (!this.isActive || !this.voiceGain || !this.voiceGain.gain) return;
    const now = this.ctx.currentTime;
    if (this._lastDeclickTime !== undefined && Math.abs(now - this._lastDeclickTime) < 0.005) {
      return;
    }
    this._lastDeclickTime = now;

    const curVol = (typeof this._currentGain === 'number' && isFinite(this._currentGain)) ? this._currentGain : this.volume;
    if (curVol <= 0.001) return;

    let held = false;
    if (typeof this.voiceGain.gain.cancelAndHoldAtTime === 'function') {
      try {
        this.voiceGain.gain.cancelAndHoldAtTime(now);
        held = true;
      } catch (e) {
        held = false;
      }
    }
    if (!held && typeof this.voiceGain.gain.cancelScheduledValues === 'function') {
      this.voiceGain.gain.cancelScheduledValues(now);
      if (typeof this.voiceGain.gain.setValueAtTime === 'function') {
        this.voiceGain.gain.setValueAtTime(curVol, now);
      }
    }

    const dipGain = Math.max(0.0001, curVol * 0.02);
    const halfTime = Math.max(0.008, Math.min(0.015, crossfadeTime * 0.45));
    const fullTime = Math.max(0.018, Math.min(0.035, crossfadeTime));

    if (typeof this.voiceGain.gain.linearRampToValueAtTime === 'function') {
      this.voiceGain.gain.linearRampToValueAtTime(dipGain, now + halfTime);
      this.voiceGain.gain.linearRampToValueAtTime(curVol, now + fullTime);
    } else if (typeof this.voiceGain.gain.setTargetAtTime === 'function') {
      this.voiceGain.gain.setTargetAtTime(curVol, now, 0.025);
    }
  }

  /**
   * Set root pitch with smooth 20-30ms exponential frequency slewing to prevent phase cracking
   * @param {number} freq - Base frequency in Hz
   * @param {number} [timeConstant=0.025] - Slew time constant in seconds (20-30ms)
   */
  setFrequency(freq, timeConstant = 0.025) {
    const targetFreq = Math.max(20, Math.min(2000, freq));
    const now = this.ctx.currentTime;
    const tau = Math.max(0.015, Math.min(0.05, timeConstant));
    const prevA = (this.oscA.frequency.value !== undefined && this.oscA.frequency.value !== null && isFinite(this.oscA.frequency.value) && this.oscA.frequency.value > 0)
      ? this.oscA.frequency.value
      : (this.currentFreq || this.baseFreq);
    const prevB = (this.oscB.frequency.value !== undefined && this.oscB.frequency.value !== null && isFinite(this.oscB.frequency.value) && this.oscB.frequency.value > 0)
      ? this.oscB.frequency.value
      : (prevA + this.subHertzBeat);

    // Smooth micro-gain declick crossfade during pitch jumps/frequency slewing when voice is active
    if (this.isActive && Math.abs(targetFreq - prevA) >= 2.0) {
      this.declickTransition(tau);
    }

    this.currentFreq = targetFreq;
    this.baseFreq = targetFreq;

    let held = false;
    if (typeof this.oscA.frequency.cancelAndHoldAtTime === 'function') {
      try {
        this.oscA.frequency.cancelAndHoldAtTime(now);
        this.oscB.frequency.cancelAndHoldAtTime(now);
        held = true;
      } catch (e) {
        held = false;
      }
    }
    if (!held && typeof this.oscA.frequency.cancelScheduledValues === 'function') {
      this.oscA.frequency.cancelScheduledValues(now);
      this.oscB.frequency.cancelScheduledValues(now);
      if (typeof this.oscA.frequency.setValueAtTime === 'function') {
        this.oscA.frequency.setValueAtTime(prevA, now);
        this.oscB.frequency.setValueAtTime(prevB, now);
      }
    }
    if (typeof this.oscA.frequency.setTargetAtTime === 'function') {
      this.oscA.frequency.setTargetAtTime(targetFreq, now, tau);
      this.oscB.frequency.setTargetAtTime(targetFreq + this.subHertzBeat, now, tau);
    } else {
      this.oscA.frequency.value = targetFreq;
      this.oscB.frequency.value = targetFreq + this.subHertzBeat;
    }
  }

  /**
   * Set microtonal detune in cents (-50 to +50 cents) with smooth slewing
   */
  setDetuneCents(cents, timeConstant = 0.025) {
    const prevDetune = (this.oscB.detune.value !== undefined && this.oscB.detune.value !== null && isFinite(this.oscB.detune.value))
      ? this.oscB.detune.value
      : (this._currentDetune ?? this.detuneCents);
    this.detuneCents = cents;
    this._currentDetune = cents;
    const now = this.ctx.currentTime;
    const tau = Math.max(0.015, Math.min(0.05, timeConstant));

    let held = false;
    if (typeof this.oscB.detune.cancelAndHoldAtTime === 'function') {
      try {
        this.oscB.detune.cancelAndHoldAtTime(now);
        held = true;
      } catch (e) {
        held = false;
      }
    }
    if (!held && typeof this.oscB.detune.cancelScheduledValues === 'function') {
      this.oscB.detune.cancelScheduledValues(now);
      if (typeof this.oscB.detune.setValueAtTime === 'function') {
        this.oscB.detune.setValueAtTime(prevDetune, now);
      }
    }
    if (typeof this.oscB.detune.setTargetAtTime === 'function') {
      this.oscB.detune.setTargetAtTime(cents, now, tau);
    } else {
      this.oscB.detune.value = cents;
    }
  }

  /**
   * Alias for setDetuneCents for voicing consistency
   */
  setDetune(cents, timeConstant = 0.025) {
    return this.setDetuneCents(cents, timeConstant);
  }

  /**
   * Set continuous acoustic beating frequency offset in Hz (-15.0 to +15.0 Hz)
   * This allows exact dial-in of slow throbbing acoustic interference!
   */
  setBeatingHz(hz, timeConstant = 0.025) {
    this.subHertzBeat = Math.max(-15.0, Math.min(15.0, hz));
    const now = this.ctx.currentTime;
    const tau = Math.max(0.015, Math.min(0.05, timeConstant));
    const currentBase = this.currentFreq || this.baseFreq;
    const targetFreq = currentBase + this.subHertzBeat;
    const prevB = (this.oscB.frequency.value !== undefined && this.oscB.frequency.value !== null && isFinite(this.oscB.frequency.value))
      ? this.oscB.frequency.value
      : targetFreq;

    let held = false;
    if (typeof this.oscB.frequency.cancelAndHoldAtTime === 'function') {
      try {
        this.oscB.frequency.cancelAndHoldAtTime(now);
        held = true;
      } catch (e) {
        held = false;
      }
    }
    if (!held && typeof this.oscB.frequency.cancelScheduledValues === 'function') {
      this.oscB.frequency.cancelScheduledValues(now);
      if (typeof this.oscB.frequency.setValueAtTime === 'function') {
        this.oscB.frequency.setValueAtTime(prevB, now);
      }
    }
    if (typeof this.oscB.frequency.setTargetAtTime === 'function') {
      this.oscB.frequency.setTargetAtTime(targetFreq, now, tau);
    } else {
      this.oscB.frequency.value = targetFreq;
    }
  }

  /**
   * Set quick-snap tuning directly on voice with smooth pitch and filter slewing
   */
  setSnap(snapKey, rootFreq = null, timeConstant = 0.025) {
    if (rootFreq) {
      this.rootFreq = rootFreq;
    }
    const root = this.rootFreq || this.baseFreq;
    let freq = root;
    if (this._baseCutoff === undefined) {
      this._baseCutoff = this.cutoff;
    }
    if (this._baseResonance === undefined) {
      this._baseResonance = this.resonance;
    }
    const baseCutoff = this._baseCutoff;
    const baseRes = this._baseResonance;
    let cutoffTarget = baseCutoff;

    if (this.voiceId === 1) {
      if (snapKey === 'sub-bass') {
        freq = root * 0.5;
        cutoffTarget = Math.min(125, Math.max(80, baseCutoff * 0.18));
        this.setResonance(Math.min(1.6, baseRes), false);
      } else if (snapKey === 'deep-tonic') {
        freq = root;
        cutoffTarget = baseCutoff;
        this.setResonance(baseRes, false);
      } else if (snapKey === 'warm-root') {
        freq = root * 2.0;
        cutoffTarget = Math.min(2200, baseCutoff * 1.15);
        this.setResonance(baseRes, false);
      } else if (snapKey === 'octave-up') {
        freq = root * 4.0;
        cutoffTarget = Math.min(3600, baseCutoff * 1.35);
        this.setResonance(baseRes, false);
      }
    } else {
      if (snapKey === 'perfect-5th') {
        freq = root * 1.5;
        cutoffTarget = baseCutoff;
      } else if (snapKey === 'sus-4th') {
        freq = root * (4 / 3);
        cutoffTarget = baseCutoff;
      } else if (snapKey === 'major-9th') {
        freq = root * (9 / 8);
        cutoffTarget = baseCutoff;
      } else if (snapKey === 'beating-unison') {
        freq = root;
        cutoffTarget = baseCutoff;
        this.setBeatingHz(0.35, timeConstant);
      }
    }
    this.setFrequency(freq, timeConstant);
    this.setCutoff(cutoffTarget, timeConstant, false);
    return freq;
  }

  /**
   * Set harmonic frequency ratio relative to base fundamental with smooth slewing
   */
  setHarmonyRatio(ratio, timeConstant = 0.025) {
    const root = this.rootFreq || this.baseFreq;
    const targetFreq = root * ratio;
    this.setFrequency(targetFreq, timeConstant);
    return targetFreq;
  }

  /**
   * Set wavefolding drive and fold depth
   */
  setWavefold(drive, fold) {
    const d = Math.max(0.5, Math.min(4.0, drive));
    const f = Math.max(0.0, Math.min(1.0, fold));
    if (this.shaper && this.shaper.curve && Math.abs(this.drive - d) < 0.005 && Math.abs(this.fold - f) < 0.005) {
      return;
    }
    this.drive = d;
    this.fold = f;
    this.shaper.curve = makeWavefoldCurve(2048, this.drive, this.fold);
  }

  /**
   * Set filter cutoff in Hz with smooth slewing
   * @param {number} hz - Filter cutoff frequency in Hz
   * @param {number} [timeConstant=0.025] - Slew time constant in seconds
   * @param {boolean} [isBase=true] - Whether this updates the voice's base cutoff
   */
  setCutoff(hz, timeConstant = 0.025, isBase = true) {
    const targetHz = Math.max(40, Math.min(14000, hz));
    const prevCutoff = (this.filter1.frequency.value !== undefined && this.filter1.frequency.value !== null && isFinite(this.filter1.frequency.value))
      ? this.filter1.frequency.value
      : (this._currentCutoff || this.cutoff);
    this.cutoff = targetHz;
    this._currentCutoff = targetHz;
    if (isBase) {
      this._baseCutoff = targetHz;
    }
    const now = this.ctx.currentTime;
    const tau = Math.max(0.015, Math.min(0.05, timeConstant));
    this._updateLfoModulation(now);

    let held = false;
    if (typeof this.filter1.frequency.cancelAndHoldAtTime === 'function') {
      try {
        this.filter1.frequency.cancelAndHoldAtTime(now);
        this.filter2.frequency.cancelAndHoldAtTime(now);
        held = true;
      } catch (e) {
        held = false;
      }
    }
    if (!held && typeof this.filter1.frequency.cancelScheduledValues === 'function') {
      this.filter1.frequency.cancelScheduledValues(now);
      this.filter2.frequency.cancelScheduledValues(now);
      if (typeof this.filter1.frequency.setValueAtTime === 'function') {
        this.filter1.frequency.setValueAtTime(prevCutoff, now);
        this.filter2.frequency.setValueAtTime(prevCutoff, now);
      }
    }
    if (typeof this.filter1.frequency.setTargetAtTime === 'function') {
      this.filter1.frequency.setTargetAtTime(targetHz, now, tau);
      this.filter2.frequency.setTargetAtTime(targetHz, now, tau);
    } else {
      this.filter1.frequency.value = targetHz;
      this.filter2.frequency.value = targetHz;
    }
  }

  _updateLfoModulation(now = this.ctx.currentTime) {
    // Dynamic clamp ensures filter frequency never drops below 25 Hz at negative LFO peaks
    const maxSafeDepth = Math.max(0, (this.cutoff - 30) * 0.85);
    const safeDepth = Math.min(this.lfoDepth, maxSafeDepth);
    if (this.lfoGain1 && this.lfoGain1.gain) {
      if (Math.abs((this._appliedLfoDepth ?? -1) - safeDepth) > 0.5) {
        this._appliedLfoDepth = safeDepth;
        if (typeof this.lfoGain1.gain.cancelAndHoldAtTime === 'function') {
          this.lfoGain1.gain.cancelAndHoldAtTime(now);
          this.lfoGain2.gain.cancelAndHoldAtTime(now);
        } else if (typeof this.lfoGain1.gain.cancelScheduledValues === 'function') {
          this.lfoGain1.gain.cancelScheduledValues(now);
          this.lfoGain2.gain.cancelScheduledValues(now);
        }
        if (typeof this.lfoGain1.gain.setTargetAtTime === 'function') {
          this.lfoGain1.gain.setTargetAtTime(safeDepth, now, 0.05);
          this.lfoGain2.gain.setTargetAtTime(safeDepth, now, 0.05);
        } else {
          this.lfoGain1.gain.value = safeDepth;
          this.lfoGain2.gain.value = safeDepth;
        }
      }
    }
  }

  /**
   * Set filter resonance
   * @param {number} q - Filter Q factor
   * @param {boolean} [isBase=true] - Whether this updates the voice's base resonance
   */
  setResonance(q, isBase = true) {
    this.resonance = Math.max(0.5, Math.min(12.0, q));
    if (isBase) {
      this._baseResonance = this.resonance;
    }
    const qSqrt = Math.sqrt(this.resonance);
    const now = this.ctx.currentTime;
    if (typeof this.filter1.Q.cancelAndHoldAtTime === 'function') {
      this.filter1.Q.cancelAndHoldAtTime(now);
      this.filter2.Q.cancelAndHoldAtTime(now);
    } else if (typeof this.filter1.Q.cancelScheduledValues === 'function') {
      this.filter1.Q.cancelScheduledValues(now);
      this.filter2.Q.cancelScheduledValues(now);
    }
    if (typeof this.filter1.Q.setTargetAtTime === 'function') {
      this.filter1.Q.setTargetAtTime(qSqrt, now, 0.03);
      this.filter2.Q.setTargetAtTime(qSqrt, now, 0.03);
    } else {
      this.filter1.Q.value = qSqrt;
      this.filter2.Q.value = qSqrt;
    }
  }

  /**
   * Set LFO breathing rate and depth
   */
  setLfo(rateHz, depthHz) {
    this.lfoRate = Math.max(0.01, Math.min(8.0, rateHz));
    this.lfoDepth = Math.max(0, Math.min(1200, depthHz));
    const now = this.ctx.currentTime;
    if (typeof this.lfoOsc.frequency.setTargetAtTime === 'function') {
      this.lfoOsc.frequency.setTargetAtTime(this.lfoRate, now, 0.05);
    } else {
      this.lfoOsc.frequency.value = this.lfoRate;
    }
    this._updateLfoModulation(now);
  }

  /**
   * Set stereo pan
   */
  setPan(p) {
    this.pan = Math.max(-1.0, Math.min(1.0, p));
    if (this.panner) {
      this.panner.pan.setTargetAtTime(this.pan, this.ctx.currentTime, 0.03);
    }
  }

  /**
   * Set volume with smooth slewing and gain tracking
   */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1.0, v));
    if (this.isActive && this.voiceGain && this.voiceGain.gain) {
      const now = this.ctx.currentTime;
      const prevGain = (this._currentGain !== undefined) ? this._currentGain : this.volume;
      this._currentGain = this.volume;
      let held = false;
      if (typeof this.voiceGain.gain.cancelAndHoldAtTime === 'function') {
        try {
          this.voiceGain.gain.cancelAndHoldAtTime(now);
          held = true;
        } catch (e) {
          held = false;
        }
      }
      if (!held && typeof this.voiceGain.gain.cancelScheduledValues === 'function') {
        this.voiceGain.gain.cancelScheduledValues(now);
        if (typeof this.voiceGain.gain.setValueAtTime === 'function') {
          this.voiceGain.gain.setValueAtTime(prevGain, now);
        }
      }
      if (typeof this.voiceGain.gain.setTargetAtTime === 'function') {
        this.voiceGain.gain.setTargetAtTime(this.volume, now, 0.04);
      } else {
        this.voiceGain.gain.value = this.volume;
      }
    }
  }

  /**
   * Toggle or set active state with soft clickless crossfade
   */
  setActive(active) {
    this.isActive = Boolean(active);
    const now = this.ctx.currentTime;
    const targetGain = this.isActive ? this.volume : 0.0;
    const prevGain = (this._currentGain !== undefined) ? this._currentGain : (this.isActive ? 0.0 : this.volume);
    this._currentGain = targetGain;

    let held = false;
    if (typeof this.voiceGain.gain.cancelAndHoldAtTime === 'function') {
      try {
        this.voiceGain.gain.cancelAndHoldAtTime(now);
        held = true;
      } catch (e) {
        held = false;
      }
    }
    if (!held && typeof this.voiceGain.gain.cancelScheduledValues === 'function') {
      this.voiceGain.gain.cancelScheduledValues(now);
      if (typeof this.voiceGain.gain.setValueAtTime === 'function') {
        this.voiceGain.gain.setValueAtTime(prevGain, now);
      }
    }
    if (typeof this.voiceGain.gain.setTargetAtTime === 'function') {
      this.voiceGain.gain.setTargetAtTime(targetGain, now, 0.06);
    } else {
      this.voiceGain.gain.value = targetGain;
    }
    return this.isActive;
  }
}

export { SolarDroneVoice as DroneVoice };
