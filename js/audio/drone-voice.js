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
    this.detuneCents = voiceId === 1 ? 2.5 : -3.2; // Initial subtle microtonal beating
    this.subHertzBeat = 0.35; // Sub-hertz beating frequency offset in Hz
    this.waveA = 'saw';
    this.waveB = 'warm';
    this.drive = 1.6;
    this.fold = 0.45;
    this.cutoff = 680;
    this.resonance = 3.5;
    this.lfoRate = 0.12;
    this.lfoDepth = 180;
    this.volume = 0.55;
    this.pan = voiceId === 1 ? -0.45 : 0.45;
    this.isActive = false;

    this._buildGraph();
  }

  _buildGraph() {
    const ctx = this.ctx;

    // Master Voice Gain
    this.voiceGain = ctx.createGain();
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
    this.oscAGain.connect(this.oscMixer);
    this.oscBGain.connect(this.oscMixer);

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
    const standardType = type === 'saw' ? 'sawtooth' : type;
    if (type === 'sine') {
      osc.type = 'sine';
    } else if (this.wavetables && this.wavetables[type]) {
      osc.setPeriodicWave(this.wavetables[type]);
    } else if (type === 'warm' && this.wavetables && this.wavetables.warm) {
      osc.setPeriodicWave(this.wavetables.warm);
    } else if (['sine', 'square', 'sawtooth', 'triangle'].includes(standardType)) {
      osc.type = standardType;
    } else {
      osc.type = 'sawtooth';
    }
  }

  setWaveA(type) {
    this.waveA = type;
    this._applyWaveform(this.oscA, type);
  }

  setWaveB(type) {
    this.waveB = type;
    this._applyWaveform(this.oscB, type);
  }

  /**
   * Set root pitch with smooth 20-30ms exponential frequency slewing to prevent phase cracking
   * @param {number} freq - Base frequency in Hz
   * @param {number} [timeConstant=0.025] - Slew time constant in seconds (20-30ms)
   */
  setFrequency(freq, timeConstant = 0.025) {
    this.baseFreq = Math.max(20, Math.min(2000, freq));
    const now = this.ctx.currentTime;
    const tau = Math.max(0.015, Math.min(0.05, timeConstant));
    if (typeof this.oscA.frequency.cancelAndHoldAtTime === 'function') {
      this.oscA.frequency.cancelAndHoldAtTime(now);
      this.oscB.frequency.cancelAndHoldAtTime(now);
    } else if (typeof this.oscA.frequency.cancelScheduledValues === 'function') {
      this.oscA.frequency.cancelScheduledValues(now);
      this.oscB.frequency.cancelScheduledValues(now);
      const curA = (this.oscA.frequency.value !== undefined && this.oscA.frequency.value !== null) ? this.oscA.frequency.value : this.baseFreq;
      const curB = (this.oscB.frequency.value !== undefined && this.oscB.frequency.value !== null) ? this.oscB.frequency.value : (this.baseFreq + this.subHertzBeat);
      if (typeof this.oscA.frequency.setValueAtTime === 'function') {
        this.oscA.frequency.setValueAtTime(curA, now);
        this.oscB.frequency.setValueAtTime(curB, now);
      }
    }
    if (typeof this.oscA.frequency.setTargetAtTime === 'function') {
      this.oscA.frequency.setTargetAtTime(this.baseFreq, now, tau);
      this.oscB.frequency.setTargetAtTime(this.baseFreq + this.subHertzBeat, now, tau);
    } else {
      this.oscA.frequency.value = this.baseFreq;
      this.oscB.frequency.value = this.baseFreq + this.subHertzBeat;
    }
  }

  /**
   * Set microtonal detune in cents (-50 to +50 cents) with smooth slewing
   */
  setDetuneCents(cents, timeConstant = 0.025) {
    this.detuneCents = cents;
    const now = this.ctx.currentTime;
    const tau = Math.max(0.015, Math.min(0.05, timeConstant));
    if (typeof this.oscB.detune.cancelAndHoldAtTime === 'function') {
      this.oscB.detune.cancelAndHoldAtTime(now);
    } else if (typeof this.oscB.detune.cancelScheduledValues === 'function') {
      this.oscB.detune.cancelScheduledValues(now);
      const curDetune = (this.oscB.detune.value !== undefined && this.oscB.detune.value !== null) ? this.oscB.detune.value : cents;
      if (typeof this.oscB.detune.setValueAtTime === 'function') {
        this.oscB.detune.setValueAtTime(curDetune, now);
      }
    }
    if (typeof this.oscB.detune.setTargetAtTime === 'function') {
      this.oscB.detune.setTargetAtTime(cents, now, tau);
    } else {
      this.oscB.detune.value = cents;
    }
  }

  /**
   * Set continuous acoustic beating frequency offset in Hz (0.0 to 8.0 Hz)
   * This allows exact dial-in of slow throbbing acoustic interference!
   */
  setBeatingHz(hz, timeConstant = 0.025) {
    this.subHertzBeat = Math.max(-15.0, Math.min(15.0, hz));
    const now = this.ctx.currentTime;
    const tau = Math.max(0.015, Math.min(0.05, timeConstant));
    if (typeof this.oscB.frequency.cancelAndHoldAtTime === 'function') {
      this.oscB.frequency.cancelAndHoldAtTime(now);
    } else if (typeof this.oscB.frequency.cancelScheduledValues === 'function') {
      this.oscB.frequency.cancelScheduledValues(now);
      const curB = (this.oscB.frequency.value !== undefined && this.oscB.frequency.value !== null) ? this.oscB.frequency.value : (this.baseFreq + this.subHertzBeat);
      if (typeof this.oscB.frequency.setValueAtTime === 'function') {
        this.oscB.frequency.setValueAtTime(curB, now);
      }
    }
    if (typeof this.oscB.frequency.setTargetAtTime === 'function') {
      this.oscB.frequency.setTargetAtTime(this.baseFreq + this.subHertzBeat, now, tau);
    } else {
      this.oscB.frequency.value = this.baseFreq + this.subHertzBeat;
    }
  }

  /**
   * Set quick-snap tuning directly on voice with smooth pitch slewing
   */
  setSnap(snapKey, rootFreq = null, timeConstant = 0.025) {
    if (rootFreq) this.baseFreq = rootFreq;
    let freq = this.baseFreq;
    if (this.voiceId === 1) {
      if (snapKey === 'sub-bass') freq = this.baseFreq * 0.5;
      else if (snapKey === 'deep-tonic') freq = this.baseFreq;
      else if (snapKey === 'warm-root') freq = this.baseFreq * 2.0;
      else if (snapKey === 'octave-up') freq = this.baseFreq * 4.0;
    } else {
      if (snapKey === 'perfect-5th') freq = this.baseFreq * 1.5;
      else if (snapKey === 'sus-4th') freq = this.baseFreq * (4 / 3);
      else if (snapKey === 'major-9th') freq = this.baseFreq * (9 / 8);
      else if (snapKey === 'beating-unison') freq = this.baseFreq;
    }
    this.setFrequency(freq, timeConstant);
    return freq;
  }

  /**
   * Set harmonic frequency ratio relative to base fundamental with smooth slewing
   */
  setHarmonyRatio(ratio, timeConstant = 0.025) {
    const targetFreq = this.baseFreq * ratio;
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
   * Set filter cutoff in Hz
   */
  setCutoff(hz) {
    this.cutoff = Math.max(40, Math.min(14000, hz));
    const now = this.ctx.currentTime;
    this._updateLfoModulation(now);
    if (typeof this.filter1.frequency.cancelAndHoldAtTime === 'function') {
      this.filter1.frequency.cancelAndHoldAtTime(now);
      this.filter2.frequency.cancelAndHoldAtTime(now);
    } else if (typeof this.filter1.frequency.cancelScheduledValues === 'function') {
      this.filter1.frequency.cancelScheduledValues(now);
      this.filter2.frequency.cancelScheduledValues(now);
      const curCutoff = (this.filter1.frequency.value !== undefined && this.filter1.frequency.value !== null) ? this.filter1.frequency.value : this.cutoff;
      if (typeof this.filter1.frequency.setValueAtTime === 'function') {
        this.filter1.frequency.setValueAtTime(curCutoff, now);
        this.filter2.frequency.setValueAtTime(curCutoff, now);
      }
    }
    if (typeof this.filter1.frequency.setTargetAtTime === 'function') {
      this.filter1.frequency.setTargetAtTime(this.cutoff, now, 0.025);
      this.filter2.frequency.setTargetAtTime(this.cutoff, now, 0.025);
    } else {
      this.filter1.frequency.value = this.cutoff;
      this.filter2.frequency.value = this.cutoff;
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
   */
  setResonance(q) {
    this.resonance = Math.max(0.5, Math.min(12.0, q));
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
   * Set volume
   */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1.0, v));
    if (this.isActive && this.voiceGain && this.voiceGain.gain) {
      const now = this.ctx.currentTime;
      if (typeof this.voiceGain.gain.cancelAndHoldAtTime === 'function') {
        this.voiceGain.gain.cancelAndHoldAtTime(now);
      } else if (typeof this.voiceGain.gain.cancelScheduledValues === 'function') {
        this.voiceGain.gain.cancelScheduledValues(now);
        const curGain = (this.voiceGain.gain.value !== undefined && this.voiceGain.gain.value !== null)
          ? this.voiceGain.gain.value
          : this.volume;
        if (typeof this.voiceGain.gain.setValueAtTime === 'function') {
          this.voiceGain.gain.setValueAtTime(curGain, now);
        }
      }
      this.voiceGain.gain.setTargetAtTime(this.volume, now, 0.04);
    }
  }

  /**
   * Toggle or set active state with soft clickless crossfade
   */
  setActive(active) {
    this.isActive = active;
    const now = this.ctx.currentTime;
    const targetGain = this.isActive ? this.volume : 0.0001;
    if (typeof this.voiceGain.gain.cancelAndHoldAtTime === 'function') {
      this.voiceGain.gain.cancelAndHoldAtTime(now);
    } else if (typeof this.voiceGain.gain.cancelScheduledValues === 'function') {
      this.voiceGain.gain.cancelScheduledValues(now);
      const curGain = (this.voiceGain.gain.value !== undefined && this.voiceGain.gain.value !== null)
        ? this.voiceGain.gain.value
        : (this.isActive ? 0.0001 : this.volume);
      if (typeof this.voiceGain.gain.setValueAtTime === 'function') {
        this.voiceGain.gain.setValueAtTime(curGain, now);
      }
    }
    this.voiceGain.gain.setTargetAtTime(targetGain, now, 0.06);
    return this.isActive;
  }
}

export { SolarDroneVoice as DroneVoice };
