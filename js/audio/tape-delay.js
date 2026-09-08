/**
 * @file tape-delay.js
 * @brief Brian Eno / Frippertronics style stereo tape delay with tape saturation,
 * high-frequency damping, cross-feedback, and wow/flutter mechanical modulation.
 */

import { makeTapeSaturationCurve } from './wavefolder.js';

export class TapeDelay {
  /**
   * @param {AudioContext} ctx
   * @param {Object} options
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.delayTimeL = options.delayTimeL ?? 0.48; // Seconds
    this.delayTimeR = options.delayTimeR ?? 0.72; // Polyrhythmic prime ratio ~ 3:2
    this.feedback = options.feedback ?? 0.58;
    this.wowAmount = options.wowAmount ?? 0.0025; // Delay time excursion in seconds (~2.5ms)
    this.flutterAmount = options.flutterAmount ?? 0.0008; // High-frequency flutter
    this.wetLevel = options.wetLevel ?? 0.45;
    this.dryLevel = options.dryLevel ?? 1.0;
    this.inputPadGain = options.inputPad ?? 0.707; // Calibrated input headroom pad

    this._buildGraph();
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // Dry path
    this.dryGain = ctx.createGain();
    this.dryGain.gain.setValueAtTime(this.dryLevel, ctx.currentTime);
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // Stereo Delay Lines (3.5s max to allow 3:2 harmonic offset at 2.0s master time)
    this.delayNodeL = ctx.createDelay(3.5);
    this.delayNodeR = ctx.createDelay(3.5);
    this.delayNodeL.delayTime.setValueAtTime(this.delayTimeL, ctx.currentTime);
    this.delayNodeR.delayTime.setValueAtTime(this.delayTimeR, ctx.currentTime);

    // Feedback and Cross-Coupling Gains
    this.fbGainLL = ctx.createGain();
    this.fbGainRR = ctx.createGain();
    this.fbGainLR = ctx.createGain(); // Cross-feedback Left to Right
    this.fbGainRL = ctx.createGain(); // Cross-feedback Right to Left

    // Tape saturation curve small-signal gain factor at warmth=0.4 is ~1.5173.
    // Compensating feedback path by this factor bounds the total loop gain to strictly <= this.feedback (<= 0.92),
    // preventing circulating energy from accumulating and hard-clipping at the waveshaper boundary.
    this.shaperGain = 1.5173;
    const directFb = (this.feedback * 0.7) / this.shaperGain;
    const crossFb = (this.feedback * 0.3) / this.shaperGain;
    this.fbGainLL.gain.setValueAtTime(directFb, ctx.currentTime);
    this.fbGainRR.gain.setValueAtTime(directFb, ctx.currentTime);
    this.fbGainLR.gain.setValueAtTime(crossFb, ctx.currentTime);
    this.fbGainRL.gain.setValueAtTime(crossFb, ctx.currentTime);

    // Tape saturation wave shapers in feedback loop with 4x anti-aliasing oversampling
    this.shaperL = ctx.createWaveShaper();
    this.shaperR = ctx.createWaveShaper();
    this.shaperL.oversample = '4x';
    this.shaperR.oversample = '4x';
    const tapeCurve = makeTapeSaturationCurve(2048, 0.4);
    this.shaperL.curve = tapeCurve;
    this.shaperR.curve = tapeCurve;

    // Tape head filters (High-cut tape warmth + low rumble cut)
    // Butterworth Q <= 0.707 eliminates resonant peaking in the recirculation feedback loop
    this.filterL = ctx.createBiquadFilter();
    this.filterR = ctx.createBiquadFilter();
    this.filterL.type = 'lowpass';
    this.filterR.type = 'lowpass';
    this.filterL.frequency.setValueAtTime(3600, ctx.currentTime);
    this.filterR.frequency.setValueAtTime(3600, ctx.currentTime);
    if (this.filterL.Q && typeof this.filterL.Q.setValueAtTime === 'function') {
      this.filterL.Q.setValueAtTime(0.707, ctx.currentTime);
      this.filterR.Q.setValueAtTime(0.707, ctx.currentTime);
    }

    this.highpassL = ctx.createBiquadFilter();
    this.highpassR = ctx.createBiquadFilter();
    this.highpassL.type = 'highpass';
    this.highpassR.type = 'highpass';
    this.highpassL.frequency.setValueAtTime(75, ctx.currentTime);
    this.highpassR.frequency.setValueAtTime(75, ctx.currentTime);
    if (this.highpassL.Q && typeof this.highpassL.Q.setValueAtTime === 'function') {
      this.highpassL.Q.setValueAtTime(0.707, ctx.currentTime);
      this.highpassR.Q.setValueAtTime(0.707, ctx.currentTime);
    }

    // Stereo Panners
    this.pannerL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.pannerR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.pannerL) this.pannerL.pan.setValueAtTime(-0.8, ctx.currentTime);
    if (this.pannerR) this.pannerR.pan.setValueAtTime(0.8, ctx.currentTime);

    // Wet output gain
    this.wetGain = ctx.createGain();
    this.wetGain.gain.setValueAtTime(this.wetLevel, ctx.currentTime);

    // Input attenuation pad: provides calibrated headroom so simultaneous drone + Poisson note bursts never overload the tape saturation waveshaper
    this.inputPad = ctx.createGain();
    this.inputPad.gain.setValueAtTime(this.inputPadGain, ctx.currentTime);
    this.input.connect(this.inputPad);
    this.inputPad.connect(this.delayNodeL);
    this.inputPad.connect(this.delayNodeR);

    // Delay L chain: DelayL -> Highpass -> Filter -> Shaper
    this.delayNodeL.connect(this.highpassL);
    this.highpassL.connect(this.filterL);
    this.filterL.connect(this.shaperL);

    // Delay R chain: DelayR -> Highpass -> Filter -> Shaper
    this.delayNodeR.connect(this.highpassR);
    this.highpassR.connect(this.filterR);
    this.filterR.connect(this.shaperR);

    // Feedback Routing
    this.shaperL.connect(this.fbGainLL);
    this.shaperL.connect(this.fbGainLR);
    this.shaperR.connect(this.fbGainRR);
    this.shaperR.connect(this.fbGainRL);

    this.fbGainLL.connect(this.delayNodeL);
    this.fbGainRL.connect(this.delayNodeL);
    this.fbGainRR.connect(this.delayNodeR);
    this.fbGainLR.connect(this.delayNodeR);

    // Output routing
    if (this.pannerL && this.pannerR) {
      this.shaperL.connect(this.pannerL);
      this.shaperR.connect(this.pannerR);
      this.pannerL.connect(this.wetGain);
      this.pannerR.connect(this.wetGain);
    } else {
      this.shaperL.connect(this.wetGain);
      this.shaperR.connect(this.wetGain);
    }
    this.wetGain.connect(this.output);

    // --- Wow and Flutter LFO Modulation ---
    this._buildWowFlutterLFOs();
  }

  _buildWowFlutterLFOs() {
    const ctx = this.ctx;

    // Wow LFO (Slow motor capstan drift ~0.38 Hz)
    this.wowOsc = ctx.createOscillator();
    this.wowOsc.type = 'sine';
    this.wowOsc.frequency.setValueAtTime(0.38, ctx.currentTime);

    this.wowGainL = ctx.createGain();
    this.wowGainR = ctx.createGain();
    this.wowGainL.gain.setValueAtTime(this.wowAmount, ctx.currentTime);
    this.wowGainR.gain.setValueAtTime(-this.wowAmount, ctx.currentTime); // Phase inverted for stereo width

    this.wowOsc.connect(this.wowGainL);
    this.wowOsc.connect(this.wowGainR);
    this.wowGainL.connect(this.delayNodeL.delayTime);
    this.wowGainR.connect(this.delayNodeR.delayTime);

    // Flutter LFO (Fast mechanical scrape ~5.8 Hz - smooth sine eliminates triangle wave velocity step pops)
    this.flutterOsc = ctx.createOscillator();
    this.flutterOsc.type = 'sine';
    this.flutterOsc.frequency.setValueAtTime(5.8, ctx.currentTime);

    this.flutterGainL = ctx.createGain();
    this.flutterGainR = ctx.createGain();
    this.flutterGainL.gain.setValueAtTime(this.flutterAmount, ctx.currentTime);
    this.flutterGainR.gain.setValueAtTime(this.flutterAmount * 0.8, ctx.currentTime);

    this.flutterOsc.connect(this.flutterGainL);
    this.flutterOsc.connect(this.flutterGainR);
    this.flutterGainL.connect(this.delayNodeL.delayTime);
    this.flutterGainR.connect(this.delayNodeR.delayTime);

    this.wowOsc.start();
    this.flutterOsc.start();
    this._updateWowFlutterHeadroom();
  }

  _updateWowFlutterHeadroom() {
    // Safety clamp wow and flutter modulation depth so delayTime never dips below 0.015s (15ms).
    // Delay lines in Web Audio API crackle or produce buffer wrapping discontinuities when delayTime < 0.005s.
    const minDelay = Math.min(this.delayTimeL, this.delayTimeR);
    const maxMod = Math.max(0, minDelay - 0.015);
    const nominalTotal = 0.0065; // max wow (0.005) + max flutter (0.0015)
    const scale = maxMod < nominalTotal ? (nominalTotal > 0 ? maxMod / nominalTotal : 0) : 1.0;

    const effWow = this.wowAmount * scale;
    const effFlutter = this.flutterAmount * scale;
    const now = this.ctx.currentTime;

    if (this.wowGainL && this.wowGainL.gain) {
      if (typeof this.wowGainL.gain.cancelScheduledValues === 'function') {
        this.wowGainL.gain.cancelScheduledValues(now);
        this.wowGainR.gain.cancelScheduledValues(now);
        this.flutterGainL.gain.cancelScheduledValues(now);
        this.flutterGainR.gain.cancelScheduledValues(now);
      }
      if (typeof this.wowGainL.gain.setTargetAtTime === 'function') {
        this.wowGainL.gain.setTargetAtTime(effWow, now, 0.05);
        this.wowGainR.gain.setTargetAtTime(-effWow, now, 0.05);
        this.flutterGainL.gain.setTargetAtTime(effFlutter, now, 0.05);
        this.flutterGainR.gain.setTargetAtTime(effFlutter * 0.8, now, 0.05);
      } else {
        this.wowGainL.gain.value = effWow;
        this.wowGainR.gain.value = -effWow;
        this.flutterGainL.gain.value = effFlutter;
        this.flutterGainR.gain.value = effFlutter * 0.8;
      }
    }
  }

  setTime(timeSeconds) {
    const t = Math.max(0.015, Math.min(2.0, timeSeconds));
    if (Math.abs(this.delayTimeL - t) < 0.001) return;
    this.delayTimeL = t;
    this.delayTimeR = Math.max(0.015, t * 1.5); // Harmonic 3:2 stereo offset
    const now = this.ctx.currentTime;

    // Safety clamp wow and flutter modulation depth against the new delay time
    this._updateWowFlutterHeadroom();

    // Clear prior pending target curves to prevent Doppler fluttering / zipper rasp pileup
    if (typeof this.delayNodeL.delayTime.cancelAndHoldAtTime === 'function') {
      this.delayNodeL.delayTime.cancelAndHoldAtTime(now);
      this.delayNodeR.delayTime.cancelAndHoldAtTime(now);
    } else if (typeof this.delayNodeL.delayTime.cancelScheduledValues === 'function') {
      const curDelayL = this.delayNodeL.delayTime.value ?? this.delayTimeL;
      const curDelayR = this.delayNodeR.delayTime.value ?? this.delayTimeR;
      this.delayNodeL.delayTime.cancelScheduledValues(now);
      this.delayNodeR.delayTime.cancelScheduledValues(now);
      if (typeof this.delayNodeL.delayTime.setValueAtTime === 'function') {
        this.delayNodeL.delayTime.setValueAtTime(curDelayL, now);
        this.delayNodeR.delayTime.setValueAtTime(curDelayR, now);
      }
    }

    if (typeof this.delayNodeL.delayTime.setTargetAtTime === 'function') {
      this.delayNodeL.delayTime.setTargetAtTime(this.delayTimeL, now, 0.065);
      this.delayNodeR.delayTime.setTargetAtTime(this.delayTimeR, now, 0.065);
    } else {
      this.delayNodeL.delayTime.value = this.delayTimeL;
      this.delayNodeR.delayTime.value = this.delayTimeR;
    }
  }

  setFeedback(fb) {
    this.feedback = Math.max(0.0, Math.min(0.92, fb));
    const shaperGain = this.shaperGain || 1.5173;
    const directFb = (this.feedback * 0.7) / shaperGain;
    const crossFb = (this.feedback * 0.3) / shaperGain;
    const now = this.ctx.currentTime;

    if (typeof this.fbGainLL.gain.cancelAndHoldAtTime === 'function') {
      this.fbGainLL.gain.cancelAndHoldAtTime(now);
      this.fbGainRR.gain.cancelAndHoldAtTime(now);
      this.fbGainLR.gain.cancelAndHoldAtTime(now);
      this.fbGainRL.gain.cancelAndHoldAtTime(now);
    } else if (typeof this.fbGainLL.gain.cancelScheduledValues === 'function') {
      const curLL = this.fbGainLL.gain.value ?? directFb;
      const curRR = this.fbGainRR.gain.value ?? directFb;
      const curLR = this.fbGainLR.gain.value ?? crossFb;
      const curRL = this.fbGainRL.gain.value ?? crossFb;
      this.fbGainLL.gain.cancelScheduledValues(now);
      this.fbGainRR.gain.cancelScheduledValues(now);
      this.fbGainLR.gain.cancelScheduledValues(now);
      this.fbGainRL.gain.cancelScheduledValues(now);
      if (typeof this.fbGainLL.gain.setValueAtTime === 'function') {
        this.fbGainLL.gain.setValueAtTime(curLL, now);
        this.fbGainRR.gain.setValueAtTime(curRR, now);
        this.fbGainLR.gain.setValueAtTime(curLR, now);
        this.fbGainRL.gain.setValueAtTime(curRL, now);
      }
    }

    this.fbGainLL.gain.setTargetAtTime(directFb, now, 0.025);
    this.fbGainRR.gain.setTargetAtTime(directFb, now, 0.025);
    this.fbGainLR.gain.setTargetAtTime(crossFb, now, 0.025);
    this.fbGainRL.gain.setTargetAtTime(crossFb, now, 0.025);
  }

  setWowFlutter(depth) {
    const d = Math.max(0, Math.min(1.0, depth));
    this.wowAmount = 0.005 * d;
    this.flutterAmount = 0.0015 * d;
    this._updateWowFlutterHeadroom();
  }

  setTone(cutoffHz) {
    const c = Math.max(800, Math.min(12000, cutoffHz));
    const now = this.ctx.currentTime;
    if (typeof this.filterL.frequency.cancelAndHoldAtTime === 'function') {
      this.filterL.frequency.cancelAndHoldAtTime(now);
      this.filterR.frequency.cancelAndHoldAtTime(now);
    } else if (typeof this.filterL.frequency.cancelScheduledValues === 'function') {
      const curF1 = this.filterL.frequency.value ?? c;
      const curF2 = this.filterR.frequency.value ?? c;
      this.filterL.frequency.cancelScheduledValues(now);
      this.filterR.frequency.cancelScheduledValues(now);
      if (typeof this.filterL.frequency.setValueAtTime === 'function') {
        this.filterL.frequency.setValueAtTime(curF1, now);
        this.filterR.frequency.setValueAtTime(curF2, now);
      }
    }
    this.filterL.frequency.setTargetAtTime(c, now, 0.04);
    this.filterR.frequency.setTargetAtTime(c, now, 0.04);

    // Keep Q bounded to <= 0.707 to prevent resonant peaks
    if (this.filterL.Q && typeof this.filterL.Q.setValueAtTime === 'function') {
      if (this.filterL.Q.value > 0.7071 || Math.abs((this.filterL.Q.value || 0) - 0.707) > 0.001) {
        this.filterL.Q.setValueAtTime(0.707, now);
        this.filterR.Q.setValueAtTime(0.707, now);
      }
    }
  }

  setWet(wet) {
    this.wetLevel = Math.max(0, Math.min(1.0, wet));
    const now = this.ctx.currentTime;
    if (typeof this.wetGain.gain.cancelAndHoldAtTime === 'function') {
      this.wetGain.gain.cancelAndHoldAtTime(now);
    } else if (typeof this.wetGain.gain.cancelScheduledValues === 'function') {
      const curWet = this.wetGain.gain.value ?? this.wetLevel;
      this.wetGain.gain.cancelScheduledValues(now);
      if (typeof this.wetGain.gain.setValueAtTime === 'function') {
        this.wetGain.gain.setValueAtTime(curWet, now);
      }
    }
    this.wetGain.gain.setTargetAtTime(this.wetLevel, now, 0.025);
  }

  setDry(dry) {
    this.dryLevel = Math.max(0, Math.min(1.0, dry));
    const now = this.ctx.currentTime;
    if (typeof this.dryGain.gain.cancelAndHoldAtTime === 'function') {
      this.dryGain.gain.cancelAndHoldAtTime(now);
    } else if (typeof this.dryGain.gain.cancelScheduledValues === 'function') {
      const curDry = this.dryGain.gain.value ?? this.dryLevel;
      this.dryGain.gain.cancelScheduledValues(now);
      if (typeof this.dryGain.gain.setValueAtTime === 'function') {
        this.dryGain.gain.setValueAtTime(curDry, now);
      }
    }
    this.dryGain.gain.setTargetAtTime(this.dryLevel, now, 0.03);
  }
}
