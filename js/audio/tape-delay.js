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

    const directFb = this.feedback * 0.7;
    const crossFb = this.feedback * 0.3;
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
    this.filterL = ctx.createBiquadFilter();
    this.filterR = ctx.createBiquadFilter();
    this.filterL.type = 'lowpass';
    this.filterR.type = 'lowpass';
    this.filterL.frequency.setValueAtTime(3600, ctx.currentTime);
    this.filterR.frequency.setValueAtTime(3600, ctx.currentTime);

    this.highpassL = ctx.createBiquadFilter();
    this.highpassR = ctx.createBiquadFilter();
    this.highpassL.type = 'highpass';
    this.highpassR.type = 'highpass';
    this.highpassL.frequency.setValueAtTime(75, ctx.currentTime);
    this.highpassR.frequency.setValueAtTime(75, ctx.currentTime);

    // Stereo Panners
    this.pannerL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.pannerR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.pannerL) this.pannerL.pan.setValueAtTime(-0.8, ctx.currentTime);
    if (this.pannerR) this.pannerR.pan.setValueAtTime(0.8, ctx.currentTime);

    // Wet output gain
    this.wetGain = ctx.createGain();
    this.wetGain.gain.setValueAtTime(this.wetLevel, ctx.currentTime);

    // Input to Delays
    this.input.connect(this.delayNodeL);
    this.input.connect(this.delayNodeR);

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

    // Flutter LFO (Fast mechanical scrape ~5.8 Hz)
    this.flutterOsc = ctx.createOscillator();
    this.flutterOsc.type = 'triangle';
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
  }

  setTime(timeSeconds) {
    const t = Math.max(0.05, Math.min(2.0, timeSeconds));
    if (Math.abs(this.delayTimeL - t) < 0.002) return;
    this.delayTimeL = t;
    this.delayTimeR = t * 1.5; // Harmonic 3:2 stereo offset
    const now = this.ctx.currentTime;

    // Clear prior pending target curves to prevent Doppler fluttering / zipper rasp pileup
    if (typeof this.delayNodeL.delayTime.cancelAndHoldAtTime === 'function') {
      this.delayNodeL.delayTime.cancelAndHoldAtTime(now);
      this.delayNodeR.delayTime.cancelAndHoldAtTime(now);
    } else if (typeof this.delayNodeL.delayTime.cancelScheduledValues === 'function') {
      this.delayNodeL.delayTime.cancelScheduledValues(now);
      this.delayNodeR.delayTime.cancelScheduledValues(now);
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
    const directFb = this.feedback * 0.7;
    const crossFb = this.feedback * 0.3;
    const now = this.ctx.currentTime;

    if (typeof this.fbGainLL.gain.cancelAndHoldAtTime === 'function') {
      this.fbGainLL.gain.cancelAndHoldAtTime(now);
      this.fbGainRR.gain.cancelAndHoldAtTime(now);
      this.fbGainLR.gain.cancelAndHoldAtTime(now);
      this.fbGainRL.gain.cancelAndHoldAtTime(now);
    } else if (typeof this.fbGainLL.gain.cancelScheduledValues === 'function') {
      this.fbGainLL.gain.cancelScheduledValues(now);
      this.fbGainRR.gain.cancelScheduledValues(now);
      this.fbGainLR.gain.cancelScheduledValues(now);
      this.fbGainRL.gain.cancelScheduledValues(now);
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
    const now = this.ctx.currentTime;
    if (this.wowGainL && this.wowGainL.gain) {
      if (typeof this.wowGainL.gain.cancelAndHoldAtTime === 'function') {
        this.wowGainL.gain.cancelAndHoldAtTime(now);
        this.wowGainR.gain.cancelAndHoldAtTime(now);
        this.flutterGainL.gain.cancelAndHoldAtTime(now);
        this.flutterGainR.gain.cancelAndHoldAtTime(now);
      } else if (typeof this.wowGainL.gain.cancelScheduledValues === 'function') {
        this.wowGainL.gain.cancelScheduledValues(now);
        this.wowGainR.gain.cancelScheduledValues(now);
        this.flutterGainL.gain.cancelScheduledValues(now);
        this.flutterGainR.gain.cancelScheduledValues(now);
      }
      this.wowGainL.gain.setTargetAtTime(this.wowAmount, now, 0.05);
      this.wowGainR.gain.setTargetAtTime(-this.wowAmount, now, 0.05);
      this.flutterGainL.gain.setTargetAtTime(this.flutterAmount, now, 0.05);
      this.flutterGainR.gain.setTargetAtTime(this.flutterAmount * 0.8, now, 0.05);
    }
  }

  setTone(cutoffHz) {
    const c = Math.max(800, Math.min(12000, cutoffHz));
    const now = this.ctx.currentTime;
    if (typeof this.filterL.frequency.cancelAndHoldAtTime === 'function') {
      this.filterL.frequency.cancelAndHoldAtTime(now);
      this.filterR.frequency.cancelAndHoldAtTime(now);
    } else if (typeof this.filterL.frequency.cancelScheduledValues === 'function') {
      this.filterL.frequency.cancelScheduledValues(now);
      this.filterR.frequency.cancelScheduledValues(now);
    }
    this.filterL.frequency.setTargetAtTime(c, now, 0.04);
    this.filterR.frequency.setTargetAtTime(c, now, 0.04);
  }

  setWet(wet) {
    this.wetLevel = Math.max(0, Math.min(1.0, wet));
    const now = this.ctx.currentTime;
    if (typeof this.wetGain.gain.cancelAndHoldAtTime === 'function') {
      this.wetGain.gain.cancelAndHoldAtTime(now);
    } else if (typeof this.wetGain.gain.cancelScheduledValues === 'function') {
      this.wetGain.gain.cancelScheduledValues(now);
    }
    this.wetGain.gain.setTargetAtTime(this.wetLevel, now, 0.025);
  }

  setDry(dry) {
    this.dryLevel = Math.max(0, Math.min(1.0, dry));
    const now = this.ctx.currentTime;
    if (typeof this.dryGain.gain.cancelAndHoldAtTime === 'function') {
      this.dryGain.gain.cancelAndHoldAtTime(now);
    } else if (typeof this.dryGain.gain.cancelScheduledValues === 'function') {
      this.dryGain.gain.cancelScheduledValues(now);
    }
    this.dryGain.gain.setTargetAtTime(this.dryLevel, now, 0.03);
  }
}
