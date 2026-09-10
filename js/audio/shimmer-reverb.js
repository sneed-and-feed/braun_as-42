/**
 * @file shimmer-reverb.js
 * @brief High-diffusion algorithmic convolution reverb with octave-up shimmer feedback loop
 * and infinite ambient freeze mode (inspired by Brian Eno and Harold Budd).
 */

export class ShimmerReverb {
  /**
   * @param {AudioContext} ctx
   * @param {Object} options
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.decayTime = options.decayTime ?? 7.5; // Seconds of lush diffuse tail
    this.damping = options.damping ?? 0.65; // High-frequency air absorption
    this.shimmerAmount = options.shimmerAmount ?? 0.45; // Octave-up bloom
    this.wetLevel = options.wetLevel ?? 0.40;
    this.dryLevel = options.dryLevel ?? 0.90;
    this.isFrozen = false;

    this._buildGraph();
    this.regenerateImpulse(this.decayTime, this.damping);
  }

  _buildGraph() {
    const ctx = this.ctx;

    // Main I/O
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // Dry path
    this.dryGain = ctx.createGain();
    this.dryGain.gain.setValueAtTime(this.dryLevel, ctx.currentTime);
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // Wet convolver path with dual crossfaded convolvers and real-time air damping filter
    this.convolverA = ctx.createConvolver();
    this.convolverA.normalize = true;
    this.convolverB = null;
    this.convolver = this.convolverA;
    this.activeConvolver = 'A';
    this._hasInitialBuffer = false;
    this._crossfadeCleanupTimer = null;
    this._fadingConvolver = null;
    this._regenTimer = null;

    this.convolverGainA = ctx.createGain();
    this.convolverGainB = ctx.createGain();
    this.convolverGainA.gain.setValueAtTime(1.0, ctx.currentTime);
    this.convolverGainB.gain.setValueAtTime(0.0, ctx.currentTime);

    this.convolverBus = ctx.createGain();
    this.convolverBus.gain.setValueAtTime(1.0, ctx.currentTime);

    this.reverbPreGain = ctx.createGain();
    this.reverbPreGain.gain.setValueAtTime(0.85, ctx.currentTime);

    this.reverbWetGain = ctx.createGain();
    this.reverbWetGain.gain.setValueAtTime(this.wetLevel, ctx.currentTime);

    // Real-time acoustic air damping filter (lowpass with 0.707 Butterworth Q)
    this.dampingFilter = ctx.createBiquadFilter();
    this.dampingFilter.type = 'lowpass';
    this.dampingFilter.Q.setValueAtTime(0.707, ctx.currentTime);
    const initialCutoff = this._calculateDampingCutoff(this.damping);
    this.dampingFilter.frequency.setValueAtTime(initialCutoff, ctx.currentTime);

    this.input.connect(this.reverbPreGain);
    this.reverbPreGain.connect(this.convolverA);
    this.convolverA.connect(this.convolverGainA);
    this.convolverGainA.connect(this.convolverBus);
    this.convolverGainB.connect(this.convolverBus);
    this.convolverBus.connect(this.dampingFilter);
    this.dampingFilter.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.output);

    // --- Shimmer Feedback Path ---
    // Reverb Wet -> Shimmer Send -> Highpass/Bandpass -> Pitch Shifter (+12st) -> Feedback Gain -> Reverb Pre
    this.shimmerSend = ctx.createGain();
    this.shimmerSend.gain.setValueAtTime(this.shimmerAmount, ctx.currentTime);

    // Bandpass filter to avoid low-end rumble and excessive harsh high fizz
    this.shimmerFilter = ctx.createBiquadFilter();
    this.shimmerFilter.type = 'bandpass';
    this.shimmerFilter.frequency.setValueAtTime(1600, ctx.currentTime);
    this.shimmerFilter.Q.setValueAtTime(0.85, ctx.currentTime);

    this.shimmerFeedback = ctx.createGain();
    this.shimmerFeedback.gain.setValueAtTime(0.55, ctx.currentTime);

    // Octave-Up Pitch Shifter (+1 Octave = 2.0x frequency)
    this._buildPitchShifter();

    // Connect shimmer routing through damping filter
    this.dampingFilter.connect(this.shimmerSend);
    this.shimmerSend.connect(this.shimmerFilter);
    this.shimmerFilter.connect(this.pitchShiftInput);
    this.pitchShiftOutput.connect(this.shimmerFeedback);
    this.shimmerFeedback.connect(this.reverbPreGain);

    // --- Infinite Freeze Recirculating Delay Loop ---
    this.freezeDelayL = ctx.createDelay(1.0);
    this.freezeDelayR = ctx.createDelay(1.0);
    this.freezeDelayL.delayTime.setValueAtTime(0.387, ctx.currentTime);
    this.freezeDelayR.delayTime.setValueAtTime(0.491, ctx.currentTime);

    this.freezeFeedbackL = ctx.createGain();
    this.freezeFeedbackR = ctx.createGain();
    this.freezeFeedbackL.gain.setValueAtTime(0.0, ctx.currentTime);
    this.freezeFeedbackR.gain.setValueAtTime(0.0, ctx.currentTime);

    this.freezeFilter = ctx.createBiquadFilter();
    this.freezeFilter.type = 'lowpass';
    this.freezeFilter.frequency.setValueAtTime(3200, ctx.currentTime);

    // Freeze Input Gain (ducks new incoming audio when frozen)
    this.freezeInputGain = ctx.createGain();
    this.freezeInputGain.gain.setValueAtTime(1.0, ctx.currentTime);

    // Freeze Output Gain (prevents slapback echo leaking when freeze is OFF)
    this.freezeWetGain = ctx.createGain();
    this.freezeWetGain.gain.setValueAtTime(0.0, ctx.currentTime);

    // Cross-feed freeze loop routing
    this.reverbPreGain.connect(this.freezeInputGain);
    this.freezeInputGain.connect(this.freezeDelayL);
    this.freezeInputGain.connect(this.freezeDelayR);
    this.freezeDelayL.connect(this.freezeFeedbackL);
    this.freezeDelayR.connect(this.freezeFeedbackR);
    this.freezeFeedbackL.connect(this.freezeDelayR);
    this.freezeFeedbackR.connect(this.freezeDelayL);
    this.freezeDelayL.connect(this.freezeFilter);
    this.freezeDelayR.connect(this.freezeFilter);
    this.freezeFilter.connect(this.freezeWetGain);
    this.freezeWetGain.connect(this.reverbWetGain);
  }

  /**
   * Dual-delay line real-time +1 octave pitch shifter
   */
  _buildPitchShifter() {
    const ctx = this.ctx;

    this.pitchShiftInput = ctx.createGain();
    this.pitchShiftOutput = ctx.createGain();

    // Delay window = 45 ms
    const windowSec = 0.045;
    // For ratio r = 2.0 (+1 octave), downward ramp period T = W / (2 - 1) = 0.045s (f = 22.2 Hz)
    const periodSec = windowSec;
    const sampleRate = ctx.sampleRate || 48000;
    const lengthSamples = Math.floor(periodSec * sampleRate);

    // Delay lines - anchor base delayTime to 0.0
    this.psDelay1 = ctx.createDelay(0.1);
    this.psDelay2 = ctx.createDelay(0.1);
    this.psDelay1.delayTime.setValueAtTime(0.0, ctx.currentTime);
    this.psDelay2.delayTime.setValueAtTime(0.0, ctx.currentTime);

    // Modulation gain crossfaders - CRITICAL: Base gain MUST be 0.0
    // so AudioNode input modulates gain exclusively between 0.0 and 1.0 (no +1 offset click)
    this.psGain1 = ctx.createGain();
    this.psGain2 = ctx.createGain();
    this.psGain1.gain.setValueAtTime(0.0, ctx.currentTime);
    this.psGain2.gain.setValueAtTime(0.0, ctx.currentTime);

    this.pitchShiftInput.connect(this.psDelay1);
    this.pitchShiftInput.connect(this.psDelay2);

    this.psDelay1.connect(this.psGain1);
    this.psDelay2.connect(this.psGain2);

    this.psGain1.connect(this.pitchShiftOutput);
    this.psGain2.connect(this.pitchShiftOutput);

    // Create periodic modulation buffers
    const delayModBuffer = ctx.createBuffer(2, lengthSamples, sampleRate);
    const modChan1 = delayModBuffer.getChannelData(0);
    const modChan2 = delayModBuffer.getChannelData(1);

    const gainModBuffer = ctx.createBuffer(2, lengthSamples, sampleRate);
    const gainChan1 = gainModBuffer.getChannelData(0);
    const gainChan2 = gainModBuffer.getChannelData(1);

    for (let i = 0; i < lengthSamples; i++) {
      // Sawtooth delay ramp from windowSec down to 0
      const phase1 = i / lengthSamples;
      const phase2 = (phase1 + 0.5) % 1.0;

      modChan1[i] = windowSec * (1.0 - phase1);
      modChan2[i] = windowSec * (1.0 - phase2);

      // Smooth sine window for clickless crossfade
      gainChan1[i] = Math.sin(Math.PI * phase1);
      gainChan2[i] = Math.sin(Math.PI * phase2);
    }

    // Delay modulators
    this.delayModSource = ctx.createBufferSource();
    this.delayModSource.buffer = delayModBuffer;
    this.delayModSource.loop = true;

    // Splitter for 2 channels
    const delaySplitter = ctx.createChannelSplitter(2);
    this.delayModSource.connect(delaySplitter);
    delaySplitter.connect(this.psDelay1.delayTime, 0);
    delaySplitter.connect(this.psDelay2.delayTime, 1);

    // Gain modulators
    this.gainModSource = ctx.createBufferSource();
    this.gainModSource.buffer = gainModBuffer;
    this.gainModSource.loop = true;

    const gainSplitter = ctx.createChannelSplitter(2);
    this.gainModSource.connect(gainSplitter);
    gainSplitter.connect(this.psGain1.gain, 0);
    gainSplitter.connect(this.psGain2.gain, 1);

    this.delayModSource.start();
    this.gainModSource.start();
  }

  _calculateDampingCutoff(damping) {
    const d = Math.max(0.05, Math.min(0.98, damping));
    const minCutoff = 1200;
    const maxCutoff = 18000;
    return maxCutoff * Math.pow(minCutoff / maxCutoff, (d - 0.05) / (0.98 - 0.05));
  }

  /**
   * Synthesize a lush, high-density velvet/exponential diffuse impulse response
   * @param {number} decaySec - RT60 in seconds
   * @param {number} dampingFactor - High-frequency absorption (0.0 to 1.0)
   */
  regenerateImpulse(decaySec = 7.5, dampingFactor = 0.65) {
    const ctx = this.ctx;
    const sampleRate = ctx.sampleRate || 48000;
    const numSamples = Math.floor(sampleRate * Math.max(1.0, decaySec));
    const impulseBuffer = ctx.createBuffer(2, numSamples, sampleRate);
    const left = impulseBuffer.getChannelData(0);
    const right = impulseBuffer.getChannelData(1);

    // Time constant tau for -60dB decay
    const decayTau = decaySec / 6.91; // ln(1000) ~ 6.91
    const decayMul = Math.exp(-1.0 / (sampleRate * decayTau));

    // Early reflection taps (prime spacing with stereo divergence)
    const earlyTapTimes = [0.011, 0.017, 0.023, 0.031, 0.043, 0.059, 0.071, 0.089, 0.103, 0.127];
    const earlyGains = [0.75, -0.68, 0.62, -0.55, 0.49, -0.42, 0.38, -0.31, 0.28, -0.22];

    for (let k = 0; k < earlyTapTimes.length; k++) {
      const sampleIdx = Math.floor(earlyTapTimes[k] * sampleRate);
      if (sampleIdx < numSamples) {
        const pan = (k % 2 === 0) ? 0.7 : -0.7;
        left[sampleIdx] += earlyGains[k] * (1.0 - pan * 0.5);
        right[sampleIdx] += earlyGains[k] * (1.0 + pan * 0.5);
      }
    }

    // Late diffuse tail with frequency-dependent damping
    // Fast scalar decayMul replaces hundreds of thousands of Math.exp calls
    let lpL = 0;
    let lpR = 0;
    const dampAlphaBase = 0.15 + (1.0 - dampingFactor) * 0.75;
    let envelope = 1.0;

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;

      // White/Velvet noise generator
      const noiseL = (Math.random() * 2 - 1);
      const noiseR = (Math.random() * 2 - 1);

      // Lowpass smoothing coefficient decreases with time (absorption increases over time)
      const dampAlpha = Math.max(0.01, dampAlphaBase / (1.0 + t * dampingFactor * 2.0));

      lpL += dampAlpha * (noiseL - lpL);
      lpR += dampAlpha * (noiseR - lpR);

      left[i] += (0.6 * noiseL + 0.4 * lpL) * envelope;
      right[i] += (0.6 * noiseR + 0.4 * lpR) * envelope;

      envelope *= decayMul;
    }

    // Initial construction check: load primary convolver before audio graph starts
    if (!this._hasInitialBuffer) {
      this._hasInitialBuffer = true;
      this.convolverA.buffer = impulseBuffer;
      this.convolver = this.convolverA;
      return;
    }

    // Dual-convolver clickless crossfading:
    // Create new convolver, assign buffer BEFORE connecting to active graph,
    // then smoothly crossfade from old to new convolver over 50ms.
    // This eliminates audio thread pauses and delay line chops/drops.
    const now = ctx.currentTime;
    const crossfadeTime = 0.050; // 50ms smooth crossfade
    const newConvolver = ctx.createConvolver();
    newConvolver.normalize = true;
    newConvolver.buffer = impulseBuffer;

    if (this._crossfadeCleanupTimer) {
      clearTimeout(this._crossfadeCleanupTimer);
      this._crossfadeCleanupTimer = null;
      if (this._fadingConvolver) {
        try {
          this.reverbPreGain.disconnect(this._fadingConvolver);
          this._fadingConvolver.disconnect();
        } catch (e) {}
        this._fadingConvolver = null;
      }
    }

    if (this.activeConvolver === 'A') {
      const oldConvolver = this.convolverA;
      this._fadingConvolver = oldConvolver;
      this.convolverB = newConvolver;
      this.convolver = newConvolver;
      this.reverbPreGain.connect(newConvolver);
      newConvolver.connect(this.convolverGainB);

      if (typeof this.convolverGainB.gain.cancelAndHoldAtTime === 'function') {
        this.convolverGainB.gain.cancelAndHoldAtTime(now);
        this.convolverGainA.gain.cancelAndHoldAtTime(now);
      } else if (typeof this.convolverGainB.gain.cancelScheduledValues === 'function') {
        this.convolverGainB.gain.cancelScheduledValues(now);
        this.convolverGainA.gain.cancelScheduledValues(now);
        if (typeof this.convolverGainB.gain.setValueAtTime === 'function') {
          this.convolverGainB.gain.setValueAtTime(this.convolverGainB.gain.value ?? 0.0, now);
          this.convolverGainA.gain.setValueAtTime(this.convolverGainA.gain.value ?? 1.0, now);
        }
      }

      this.convolverGainB.gain.setTargetAtTime(1.0, now, crossfadeTime);
      this.convolverGainA.gain.setTargetAtTime(0.0, now, crossfadeTime);
      this.activeConvolver = 'B';

      this._crossfadeCleanupTimer = setTimeout(() => {
        try {
          if (this._fadingConvolver) {
            this.reverbPreGain.disconnect(this._fadingConvolver);
            this._fadingConvolver.disconnect();
          }
        } catch (e) {}
        this._fadingConvolver = null;
        this._crossfadeCleanupTimer = null;
      }, 250);
    } else {
      const oldConvolver = this.convolverB;
      this._fadingConvolver = oldConvolver;
      this.convolverA = newConvolver;
      this.convolver = newConvolver;
      this.reverbPreGain.connect(newConvolver);
      newConvolver.connect(this.convolverGainA);

      if (typeof this.convolverGainA.gain.cancelAndHoldAtTime === 'function') {
        this.convolverGainA.gain.cancelAndHoldAtTime(now);
        this.convolverGainB.gain.cancelAndHoldAtTime(now);
      } else if (typeof this.convolverGainA.gain.cancelScheduledValues === 'function') {
        this.convolverGainA.gain.cancelScheduledValues(now);
        this.convolverGainB.gain.cancelScheduledValues(now);
        if (typeof this.convolverGainA.gain.setValueAtTime === 'function') {
          this.convolverGainA.gain.setValueAtTime(this.convolverGainA.gain.value ?? 0.0, now);
          this.convolverGainB.gain.setValueAtTime(this.convolverGainB.gain.value ?? 1.0, now);
        }
      }

      this.convolverGainA.gain.setTargetAtTime(1.0, now, crossfadeTime);
      this.convolverGainB.gain.setTargetAtTime(0.0, now, crossfadeTime);
      this.activeConvolver = 'A';

      this._crossfadeCleanupTimer = setTimeout(() => {
        try {
          if (this._fadingConvolver) {
            this.reverbPreGain.disconnect(this._fadingConvolver);
            this._fadingConvolver.disconnect();
          }
        } catch (e) {}
        this._fadingConvolver = null;
        this._crossfadeCleanupTimer = null;
      }, 250);
    }
  }

  _scheduleImpulseRegeneration() {
    if (this._regenTimer) clearTimeout(this._regenTimer);
    this._regenTimer = setTimeout(() => {
      this.regenerateImpulse(this.decayTime, this.damping);
      this._regenTimer = null;
    }, 60);
  }

  _updateDecayParameters(seconds) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Modulate perceived RT60 decay dynamically via feedback recirculation
    // Base shimmerFeedback: 0.2 + shimmerAmount * 0.45, scaled with RT60
    const decayScale = Math.min(1.35, Math.max(0.70, seconds / 8.5));
    if (this.shimmerFeedback && this.shimmerFeedback.gain) {
      const targetFeedback = Math.min(0.75, (0.2 + this.shimmerAmount * 0.45) * decayScale);
      if (typeof this.shimmerFeedback.gain.setTargetAtTime === 'function') {
        this.shimmerFeedback.gain.setTargetAtTime(targetFeedback, now, 0.03);
      } else {
        this.shimmerFeedback.gain.value = targetFeedback;
      }
    }
  }

  setDecay(seconds, skipRegen = false) {
    const s = Math.max(0.5, Math.min(25.0, seconds));
    if (Math.abs(this.decayTime - s) < 0.01 && this._hasInitialBuffer) {
      return;
    }
    this.decayTime = s;
    this._updateDecayParameters(s);
    if (skipRegen) {
      if (this._regenTimer) {
        clearTimeout(this._regenTimer);
        this._regenTimer = null;
      }
      return;
    }
    this._scheduleImpulseRegeneration();
  }

  setDiffusion(seconds, skipRegen = false) {
    this.setDecay(seconds, skipRegen);
  }

  setDamping(damping) {
    this.damping = Math.max(0.05, Math.min(0.98, damping));
    // Real-time damping filter responds immediately and continuously without delay
    // Eliminates convolver buffer hot-swapping and audio thread underruns during air damp knob turns
    if (this.dampingFilter && this.dampingFilter.frequency) {
      const cutoff = this._calculateDampingCutoff(this.damping);
      const now = this.ctx.currentTime;
      if (typeof this.dampingFilter.frequency.setTargetAtTime === 'function') {
        this.dampingFilter.frequency.setTargetAtTime(cutoff, now, 0.025);
      } else {
        this.dampingFilter.frequency.setValueAtTime(cutoff, now);
      }
    }
  }

  setDamp(damping) {
    this.setDamping(damping);
  }

  setShimmer(amount) {
    this.shimmerAmount = Math.max(0, Math.min(1.0, amount));
    const now = this.ctx.currentTime;
    if (typeof this.shimmerSend.gain.cancelAndHoldAtTime === 'function') {
      this.shimmerSend.gain.cancelAndHoldAtTime(now);
      this.shimmerFeedback.gain.cancelAndHoldAtTime(now);
    } else if (typeof this.shimmerSend.gain.cancelScheduledValues === 'function') {
      this.shimmerSend.gain.cancelScheduledValues(now);
      this.shimmerFeedback.gain.cancelScheduledValues(now);
    }
    this.shimmerSend.gain.setTargetAtTime(this.shimmerAmount * 0.9, now, 0.025);
    this.shimmerFeedback.gain.setTargetAtTime(0.2 + this.shimmerAmount * 0.45, now, 0.025);
  }

  setWet(level) {
    this.wetLevel = Math.max(0, Math.min(1.0, level));
    const now = this.ctx.currentTime;
    if (typeof this.reverbWetGain.gain.cancelAndHoldAtTime === 'function') {
      this.reverbWetGain.gain.cancelAndHoldAtTime(now);
    } else if (typeof this.reverbWetGain.gain.cancelScheduledValues === 'function') {
      this.reverbWetGain.gain.cancelScheduledValues(now);
    }
    this.reverbWetGain.gain.setTargetAtTime(this.wetLevel, now, 0.025);
  }

  setDry(level) {
    this.dryLevel = Math.max(0, Math.min(1.0, level));
    this.dryGain.gain.setTargetAtTime(this.dryLevel, this.ctx.currentTime, 0.03);
  }

  toggleFreeze() {
    this.setFreeze(!this.isFrozen);
    return this.isFrozen;
  }

  setFreeze(freeze) {
    this.isFrozen = freeze;
    const now = this.ctx.currentTime;
    if (this.isFrozen) {
      // Engage infinite recirculation delay and duck input
      this.freezeFeedbackL.gain.setTargetAtTime(0.992, now, 0.08);
      this.freezeFeedbackR.gain.setTargetAtTime(0.992, now, 0.08);
      this.freezeWetGain.gain.setTargetAtTime(0.85, now, 0.08);
      this.freezeInputGain.gain.setTargetAtTime(0.12, now, 0.25);
    } else {
      // Gently release freeze feedback, fade out freeze wet gain, restore input
      this.freezeFeedbackL.gain.setTargetAtTime(0.0, now, 0.25);
      this.freezeFeedbackR.gain.setTargetAtTime(0.0, now, 0.25);
      this.freezeWetGain.gain.setTargetAtTime(0.0, now, 0.25);
      this.freezeInputGain.gain.setTargetAtTime(1.0, now, 0.1);
    }
  }
}
