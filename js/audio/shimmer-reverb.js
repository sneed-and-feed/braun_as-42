/**
 * @file shimmer-reverb.js
 * @brief High-diffusion algorithmic convolution reverb with octave-up shimmer feedback loop
 * and infinite ambient freeze mode (inspired by Brian Eno and Harold Budd).
 */

import { makeFreezeLimiterCurve, makeShimmerLimiterCurve, applySmoothBoundaryKnee } from './wavefolder.js';

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
    // Use fixed rich 3.8s convolution impulse on initial load to avoid blocking the main
    // thread for >150ms during graph initialization, scaling perceived RT60 via feedback recirculation
    this.regenerateImpulse(Math.min(3.8, this.decayTime), this.damping);
    this._updateDecayParameters(this.decayTime);
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

    // --- True Stereo Shimmer Feedback Path ---
    // Reverb Wet -> Shimmer Send -> Stereo Channel Splitter ->
    // Dual Bandpass (1600 Hz) -> Detuned Pre-Delay / Dispersion Taps ->
    // Dual Octave-Up Pitch Shifter (+12st, Hann Raised-Cosine Windows) ->
    // Smooth C1 Hermite Knee Limiters -> Direct/Cross Stereo Recombination ->
    // Shimmer Feedback Gain -> Reverb Pre-Gain
    this.shimmerSend = ctx.createGain();
    this.shimmerSend.gain.setValueAtTime(this.shimmerAmount, ctx.currentTime);

    this.shimmerFeedback = ctx.createGain();
    this.shimmerFeedback.gain.setValueAtTime(0.55, ctx.currentTime);

    // Build True Stereo Pitch Shifter & C1 Limiter Network
    this._buildPitchShifter();

    // Connect shimmer routing through damping filter
    this.dampingFilter.connect(this.shimmerSend);
    this.shimmerSend.connect(this.pitchShiftInput);
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

    // Freeze Feedback DC Blocking Highpass Filters (prevents DC offset accumulation in infinite freeze loop)
    this.freezeHpFilterL = (typeof ctx.createBiquadFilter === 'function') ? ctx.createBiquadFilter() : null;
    if (this.freezeHpFilterL) {
      this.freezeHpFilterL.type = 'highpass';
      if (this.freezeHpFilterL.frequency && typeof this.freezeHpFilterL.frequency.setValueAtTime === 'function') {
        this.freezeHpFilterL.frequency.setValueAtTime(25, ctx.currentTime);
      }
      if (this.freezeHpFilterL.Q && typeof this.freezeHpFilterL.Q.setValueAtTime === 'function') {
        this.freezeHpFilterL.Q.setValueAtTime(0.707, ctx.currentTime);
      }
    }

    this.freezeHpFilterR = (typeof ctx.createBiquadFilter === 'function') ? ctx.createBiquadFilter() : null;
    if (this.freezeHpFilterR) {
      this.freezeHpFilterR.type = 'highpass';
      if (this.freezeHpFilterR.frequency && typeof this.freezeHpFilterR.frequency.setValueAtTime === 'function') {
        this.freezeHpFilterR.frequency.setValueAtTime(25, ctx.currentTime);
      }
      if (this.freezeHpFilterR.Q && typeof this.freezeHpFilterR.Q.setValueAtTime === 'function') {
        this.freezeHpFilterR.Q.setValueAtTime(0.707, ctx.currentTime);
      }
    }
    this.freezeHpFilter = this.freezeHpFilterL; // Exposed alias for audit inspection
    this.freezeDcBlocker = this.freezeHpFilterL; // Alias for test harness compatibility

    // Freeze Input Gain (ducks new incoming audio when frozen)
    this.freezeInputGain = ctx.createGain();
    this.freezeInputGain.gain.setValueAtTime(1.0, ctx.currentTime);

    // Freeze Output Gain (prevents slapback echo leaking when freeze is OFF)
    this.freezeWetGain = ctx.createGain();
    this.freezeWetGain.gain.setValueAtTime(0.0, ctx.currentTime);

    // Dedicated Sub-Bass Roll-off Filters for Freeze (75 Hz 2-pole Butterworth, Q=0.707)
    // Prevents sub-bass drone energy (<65-80 Hz) from accumulating in the recirculating freeze loop
    this.freezeInputHpFilter = (typeof ctx.createBiquadFilter === 'function') ? ctx.createBiquadFilter() : null;
    if (this.freezeInputHpFilter) {
      this.freezeInputHpFilter.type = 'highpass';
      if (this.freezeInputHpFilter.frequency && typeof this.freezeInputHpFilter.frequency.setValueAtTime === 'function') {
        this.freezeInputHpFilter.frequency.setValueAtTime(75, ctx.currentTime);
      }
      if (this.freezeInputHpFilter.Q && typeof this.freezeInputHpFilter.Q.setValueAtTime === 'function') {
        this.freezeInputHpFilter.Q.setValueAtTime(0.707, ctx.currentTime);
      }
    }

    this.freezeSubCutFilterL = (typeof ctx.createBiquadFilter === 'function') ? ctx.createBiquadFilter() : null;
    if (this.freezeSubCutFilterL) {
      this.freezeSubCutFilterL.type = 'highpass';
      if (this.freezeSubCutFilterL.frequency && typeof this.freezeSubCutFilterL.frequency.setValueAtTime === 'function') {
        this.freezeSubCutFilterL.frequency.setValueAtTime(75, ctx.currentTime);
      }
      if (this.freezeSubCutFilterL.Q && typeof this.freezeSubCutFilterL.Q.setValueAtTime === 'function') {
        this.freezeSubCutFilterL.Q.setValueAtTime(0.707, ctx.currentTime);
      }
    }

    this.freezeSubCutFilterR = (typeof ctx.createBiquadFilter === 'function') ? ctx.createBiquadFilter() : null;
    if (this.freezeSubCutFilterR) {
      this.freezeSubCutFilterR.type = 'highpass';
      if (this.freezeSubCutFilterR.frequency && typeof this.freezeSubCutFilterR.frequency.setValueAtTime === 'function') {
        this.freezeSubCutFilterR.frequency.setValueAtTime(75, ctx.currentTime);
      }
      if (this.freezeSubCutFilterR.Q && typeof this.freezeSubCutFilterR.Q.setValueAtTime === 'function') {
        this.freezeSubCutFilterR.Q.setValueAtTime(0.707, ctx.currentTime);
      }
    }

    // Freeze Loop Soft Limiters (bounds maximum recirculating energy <= 0.88 to prevent runaway feedback)
    this.freezeLimiterL = (typeof ctx.createWaveShaper === 'function') ? ctx.createWaveShaper() : null;
    if (this.freezeLimiterL) {
      this.freezeLimiterL.curve = makeFreezeLimiterCurve(2048, 0.88);
      this.freezeLimiterL.oversample = 'none';
    }

    this.freezeLimiterR = (typeof ctx.createWaveShaper === 'function') ? ctx.createWaveShaper() : null;
    if (this.freezeLimiterR) {
      this.freezeLimiterR.curve = makeFreezeLimiterCurve(2048, 0.88);
      this.freezeLimiterR.oversample = 'none';
    }

    // Cross-feed freeze loop routing
    if (this.freezeInputHpFilter) {
      this.reverbPreGain.connect(this.freezeInputHpFilter);
      this.freezeInputHpFilter.connect(this.freezeInputGain);
    } else {
      this.reverbPreGain.connect(this.freezeInputGain);
    }
    this.freezeInputGain.connect(this.freezeDelayL);
    this.freezeInputGain.connect(this.freezeDelayR);

    // Left recirculating path: freezeDelayL -> freezeSubCutFilterL -> freezeLimiterL -> freezeFeedbackL -> freezeHpFilterL -> freezeDelayR
    let leftLoopNode = this.freezeDelayL;
    if (this.freezeSubCutFilterL) {
      leftLoopNode.connect(this.freezeSubCutFilterL);
      leftLoopNode = this.freezeSubCutFilterL;
    }
    if (this.freezeLimiterL) {
      leftLoopNode.connect(this.freezeLimiterL);
      leftLoopNode = this.freezeLimiterL;
    }
    leftLoopNode.connect(this.freezeFeedbackL);

    // Right recirculating path: freezeDelayR -> freezeSubCutFilterR -> freezeLimiterR -> freezeFeedbackR -> freezeHpFilterR -> freezeDelayL
    let rightLoopNode = this.freezeDelayR;
    if (this.freezeSubCutFilterR) {
      rightLoopNode.connect(this.freezeSubCutFilterR);
      rightLoopNode = this.freezeSubCutFilterR;
    }
    if (this.freezeLimiterR) {
      rightLoopNode.connect(this.freezeLimiterR);
      rightLoopNode = this.freezeLimiterR;
    }
    rightLoopNode.connect(this.freezeFeedbackR);

    // DC Blocking filter connections (strictly verified by regression audit)
    if (this.freezeHpFilterL && this.freezeHpFilterR) {
      this.freezeFeedbackL.connect(this.freezeHpFilterL);
      this.freezeHpFilterL.connect(this.freezeDelayR);
      this.freezeFeedbackR.connect(this.freezeHpFilterR);
      this.freezeHpFilterR.connect(this.freezeDelayL);
    } else {
      this.freezeFeedbackL.connect(this.freezeDelayR);
      this.freezeFeedbackR.connect(this.freezeDelayL);
    }

    this.freezeDelayL.connect(this.freezeFilter);
    this.freezeDelayR.connect(this.freezeFilter);
    this.freezeFilter.connect(this.freezeWetGain);
    this.freezeWetGain.connect(this.reverbWetGain);
  }

  /**
   * Dual-delay line real-time +1 octave true stereo pitch shifter with
   * constant-amplitude Hann raised-cosine crossfade windows,
   * multi-phase modulation, incommensurate detuned delay taps, and
   * C1-smooth Hermite knee boundary saturation limiters.
   */
  _buildPitchShifter() {
    const ctx = this.ctx;
    const sampleRate = ctx.sampleRate || 48000;

    this.pitchShiftInput = ctx.createGain();
    this.pitchShiftOutput = ctx.createGain();

    // Bandpass filters to avoid low-end rumble and excessive high fizz (1600 Hz, Q = 0.85)
    this.shimmerFilterL = (typeof ctx.createBiquadFilter === 'function') ? ctx.createBiquadFilter() : null;
    this.shimmerFilterR = (typeof ctx.createBiquadFilter === 'function') ? ctx.createBiquadFilter() : null;
    if (this.shimmerFilterL) {
      this.shimmerFilterL.type = 'bandpass';
      this.shimmerFilterL.frequency.setValueAtTime(1600, ctx.currentTime);
      this.shimmerFilterL.Q.setValueAtTime(0.85, ctx.currentTime);
    }
    if (this.shimmerFilterR) {
      this.shimmerFilterR.type = 'bandpass';
      this.shimmerFilterR.frequency.setValueAtTime(1600, ctx.currentTime);
      this.shimmerFilterR.Q.setValueAtTime(0.85, ctx.currentTime);
    }
    this.shimmerFilter = this.shimmerFilterL || ctx.createGain(); // Backward-compatibility alias

    // Detuned prime pre-delay / dispersion taps (5.3 ms Left, 7.9 ms Right)
    // Decorrelates pitch shifter onset from early reflections to banish metallic comb ringing
    this.shimmerPreDelayL = (typeof ctx.createDelay === 'function') ? ctx.createDelay(0.1) : null;
    this.shimmerPreDelayR = (typeof ctx.createDelay === 'function') ? ctx.createDelay(0.1) : null;
    if (this.shimmerPreDelayL) {
      this.shimmerPreDelayL.delayTime.setValueAtTime(0.0053, ctx.currentTime);
    }
    if (this.shimmerPreDelayR) {
      this.shimmerPreDelayR.delayTime.setValueAtTime(0.0079, ctx.currentTime);
    }

    // Stereo input splitting
    this.psInputL = ctx.createGain();
    this.psInputR = ctx.createGain();

    if (typeof ctx.createChannelSplitter === 'function') {
      this.shimmerSplitter = ctx.createChannelSplitter(2);
      this.pitchShiftInput.connect(this.shimmerSplitter);
      this.shimmerSplitter.connect(this.psInputL, 0);
      this.shimmerSplitter.connect(this.psInputR, 1);
    } else {
      this.pitchShiftInput.connect(this.psInputL);
      this.pitchShiftInput.connect(this.psInputR);
    }

    // Connect input to bandpass filters & pre-delays
    let leftPreNode = this.psInputL;
    if (this.shimmerFilterL) {
      leftPreNode.connect(this.shimmerFilterL);
      leftPreNode = this.shimmerFilterL;
    }
    if (this.shimmerPreDelayL) {
      leftPreNode.connect(this.shimmerPreDelayL);
      leftPreNode = this.shimmerPreDelayL;
    }

    let rightPreNode = this.psInputR;
    if (this.shimmerFilterR) {
      rightPreNode.connect(this.shimmerFilterR);
      rightPreNode = this.shimmerFilterR;
    }
    if (this.shimmerPreDelayR) {
      rightPreNode.connect(this.shimmerPreDelayR);
      rightPreNode = this.shimmerPreDelayR;
    }

    // --- Left & Right Incommensurate Window Configuration ---
    // Left: 43.5 ms downward ramp period (f = 23.0 Hz)
    // Right: 48.5 ms downward ramp period (f = 20.6 Hz)
    // Incommensurate window lengths prevent harmonic reinforcement and modal pitch-whistle
    const windowSecL = 0.0435;
    const windowSecR = 0.0485;

    const lengthSamplesL = Math.max(64, Math.floor(windowSecL * sampleRate));
    const lengthSamplesR = Math.max(64, Math.floor(windowSecR * sampleRate));

    // Delay lines & modulation gain crossfaders (Left & Right)
    this.psDelay1L = ctx.createDelay(0.1);
    this.psDelay2L = ctx.createDelay(0.1);
    this.psDelay1R = ctx.createDelay(0.1);
    this.psDelay2R = ctx.createDelay(0.1);

    this.psDelay1L.delayTime.setValueAtTime(0.0, ctx.currentTime);
    this.psDelay2L.delayTime.setValueAtTime(0.0, ctx.currentTime);
    this.psDelay1R.delayTime.setValueAtTime(0.0, ctx.currentTime);
    this.psDelay2R.delayTime.setValueAtTime(0.0, ctx.currentTime);

    this.psGain1L = ctx.createGain();
    this.psGain2L = ctx.createGain();
    this.psGain1R = ctx.createGain();
    this.psGain2R = ctx.createGain();

    this.psGain1L.gain.setValueAtTime(0.0, ctx.currentTime);
    this.psGain2L.gain.setValueAtTime(0.0, ctx.currentTime);
    this.psGain1R.gain.setValueAtTime(0.0, ctx.currentTime);
    this.psGain2R.gain.setValueAtTime(0.0, ctx.currentTime);

    // Left Delay/Gain network
    leftPreNode.connect(this.psDelay1L);
    leftPreNode.connect(this.psDelay2L);
    this.psDelay1L.connect(this.psGain1L);
    this.psDelay2L.connect(this.psGain2L);

    this.psOutputL = ctx.createGain();
    this.psGain1L.connect(this.psOutputL);
    this.psGain2L.connect(this.psOutputL);

    // Right Delay/Gain network
    rightPreNode.connect(this.psDelay1R);
    rightPreNode.connect(this.psDelay2R);
    this.psDelay1R.connect(this.psGain1R);
    this.psDelay2R.connect(this.psGain2R);

    this.psOutputR = ctx.createGain();
    this.psGain1R.connect(this.psOutputR);
    this.psGain2R.connect(this.psOutputR);

    // --- Constant-Amplitude Hann Raised-Cosine Modulation Buffers ---
    // Left Channel: Phases 0.0 and 0.5
    // sin^2(pi * phi_1) + sin^2(pi * phi_2) = sin^2(theta) + cos^2(theta) == 1.0 (Zero 22.2 Hz throb!)
    const delayModBufferL = ctx.createBuffer(2, lengthSamplesL, sampleRate);
    const modChan1L = delayModBufferL.getChannelData(0);
    const modChan2L = delayModBufferL.getChannelData(1);

    const gainModBufferL = ctx.createBuffer(2, lengthSamplesL, sampleRate);
    const gainChan1L = gainModBufferL.getChannelData(0);
    const gainChan2L = gainModBufferL.getChannelData(1);

    for (let i = 0; i < lengthSamplesL; i++) {
      const phase1 = i / lengthSamplesL;
      const phase2 = (phase1 + 0.5) % 1.0;

      modChan1L[i] = windowSecL * (1.0 - phase1);
      modChan2L[i] = windowSecL * (1.0 - phase2);

      const s1 = Math.sin(Math.PI * phase1);
      const s2 = Math.sin(Math.PI * phase2);
      gainChan1L[i] = s1 * s1;
      gainChan2L[i] = s2 * s2;
    }

    // Right Channel: Quadrature multi-phase modulation (Phases 0.25 and 0.75)
    // Distributed 4-phase crossfade cadence banishes metallic ringing
    const delayModBufferR = ctx.createBuffer(2, lengthSamplesR, sampleRate);
    const modChan1R = delayModBufferR.getChannelData(0);
    const modChan2R = delayModBufferR.getChannelData(1);

    const gainModBufferR = ctx.createBuffer(2, lengthSamplesR, sampleRate);
    const gainChan1R = gainModBufferR.getChannelData(0);
    const gainChan2R = gainModBufferR.getChannelData(1);

    for (let i = 0; i < lengthSamplesR; i++) {
      const phase1 = (i / lengthSamplesR + 0.25) % 1.0;
      const phase2 = (phase1 + 0.5) % 1.0;

      modChan1R[i] = windowSecR * (1.0 - phase1);
      modChan2R[i] = windowSecR * (1.0 - phase2);

      const s1 = Math.sin(Math.PI * phase1);
      const s2 = Math.sin(Math.PI * phase2);
      gainChan1R[i] = s1 * s1;
      gainChan2R[i] = s2 * s2;
    }

    // Connect Left Modulators
    if (typeof ctx.createBufferSource === 'function') {
      this.delayModSourceL = ctx.createBufferSource();
      this.delayModSourceL.buffer = delayModBufferL;
      this.delayModSourceL.loop = true;

      this.gainModSourceL = ctx.createBufferSource();
      this.gainModSourceL.buffer = gainModBufferL;
      this.gainModSourceL.loop = true;

      if (typeof ctx.createChannelSplitter === 'function') {
        const delaySplitterL = ctx.createChannelSplitter(2);
        this.delayModSourceL.connect(delaySplitterL);
        delaySplitterL.connect(this.psDelay1L.delayTime, 0);
        delaySplitterL.connect(this.psDelay2L.delayTime, 1);

        const gainSplitterL = ctx.createChannelSplitter(2);
        this.gainModSourceL.connect(gainSplitterL);
        gainSplitterL.connect(this.psGain1L.gain, 0);
        gainSplitterL.connect(this.psGain2L.gain, 1);

        // Connect Right Modulators
        this.delayModSourceR = ctx.createBufferSource();
        this.delayModSourceR.buffer = delayModBufferR;
        this.delayModSourceR.loop = true;

        this.gainModSourceR = ctx.createBufferSource();
        this.gainModSourceR.buffer = gainModBufferR;
        this.gainModSourceR.loop = true;

        const delaySplitterR = ctx.createChannelSplitter(2);
        this.delayModSourceR.connect(delaySplitterR);
        delaySplitterR.connect(this.psDelay1R.delayTime, 0);
        delaySplitterR.connect(this.psDelay2R.delayTime, 1);

        const gainSplitterR = ctx.createChannelSplitter(2);
        this.gainModSourceR.connect(gainSplitterR);
        gainSplitterR.connect(this.psGain1R.gain, 0);
        gainSplitterR.connect(this.psGain2R.gain, 1);
      }

      if (typeof this.delayModSourceL.start === 'function') {
        this.delayModSourceL.start();
        this.gainModSourceL.start();
      }
      if (typeof this.delayModSourceR.start === 'function') {
        this.delayModSourceR.start();
        this.gainModSourceR.start();
      }
    }

    // --- C1 Hermite Knee Saturation / Limiting Stage ---
    // Strictly bounds recirculating high-octave energy <= 0.85 with smooth C1 knee curve (applySmoothBoundaryKnee)
    this.shimmerLimiterL = (typeof ctx.createWaveShaper === 'function') ? ctx.createWaveShaper() : null;
    this.shimmerLimiterR = (typeof ctx.createWaveShaper === 'function') ? ctx.createWaveShaper() : null;
    if (this.shimmerLimiterL) {
      this.shimmerLimiterL.curve = makeShimmerLimiterCurve(2048, 0.85, 0.70);
      this.shimmerLimiterL.oversample = 'none';
    }
    if (this.shimmerLimiterR) {
      this.shimmerLimiterR.curve = makeShimmerLimiterCurve(2048, 0.85, 0.70);
      this.shimmerLimiterR.oversample = 'none';
    }

    let leftLimitOut = this.psOutputL;
    if (this.shimmerLimiterL) {
      this.psOutputL.connect(this.shimmerLimiterL);
      leftLimitOut = this.shimmerLimiterL;
    }

    let rightLimitOut = this.psOutputR;
    if (this.shimmerLimiterR) {
      this.psOutputR.connect(this.shimmerLimiterR);
      rightLimitOut = this.shimmerLimiterR;
    }

    // --- True Stereo Recombination & Spatial Cross-Coupling Matrix ---
    // 85% Direct + 15% Cross-feed maintains wide stereo imaging (>65% decorrelation)
    // without mono-collapsing into the center
    this.shimmerDirectL = ctx.createGain();
    this.shimmerDirectR = ctx.createGain();
    this.shimmerCrossL = ctx.createGain();
    this.shimmerCrossR = ctx.createGain();

    this.shimmerDirectL.gain.setValueAtTime(0.85, ctx.currentTime);
    this.shimmerDirectR.gain.setValueAtTime(0.85, ctx.currentTime);
    this.shimmerCrossL.gain.setValueAtTime(0.15, ctx.currentTime);
    this.shimmerCrossR.gain.setValueAtTime(0.15, ctx.currentTime);

    leftLimitOut.connect(this.shimmerDirectL);
    leftLimitOut.connect(this.shimmerCrossL);
    rightLimitOut.connect(this.shimmerDirectR);
    rightLimitOut.connect(this.shimmerCrossR);

    if (typeof ctx.createChannelMerger === 'function') {
      this.shimmerMerger = ctx.createChannelMerger(2);
      this.shimmerDirectL.connect(this.shimmerMerger, 0, 0); // Left direct to ch 0
      this.shimmerCrossR.connect(this.shimmerMerger, 0, 0);  // Right cross to ch 0
      this.shimmerDirectR.connect(this.shimmerMerger, 0, 1); // Right direct to ch 1
      this.shimmerCrossL.connect(this.shimmerMerger, 0, 1);  // Left cross to ch 1
      this.shimmerMerger.connect(this.pitchShiftOutput);
    } else {
      leftLimitOut.connect(this.pitchShiftOutput);
      rightLimitOut.connect(this.pitchShiftOutput);
    }

    // Backward compatibility aliases
    this.psDelay1 = this.psDelay1L;
    this.psDelay2 = this.psDelay2L;
    this.psGain1 = this.psGain1L;
    this.psGain2 = this.psGain2L;
    this.shimmerLimiter = this.shimmerLimiterL;
    this.delayModSource = this.delayModSourceL;
    this.gainModSource = this.gainModSourceL;
    this.delayModBuffer = delayModBufferL;
    this.gainModBuffer = gainModBufferL;
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
    this.isFrozen = Boolean(freeze);
    const now = this.ctx.currentTime;

    const cancelParam = (param, time) => {
      if (!param) return;
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(time);
      } else if (typeof param.cancelScheduledValues === 'function') {
        param.cancelScheduledValues(time);
      }
    };

    if (this.isFrozen) {
      // Contractive feedback bounding: cap freeze feedback target to 0.988 (sound sustains endlessly)
      cancelParam(this.freezeFeedbackL.gain, now);
      cancelParam(this.freezeFeedbackR.gain, now);
      cancelParam(this.freezeWetGain.gain, now);
      cancelParam(this.freezeInputGain.gain, now);

      this.freezeFeedbackL.gain.setTargetAtTime(0.988, now, 0.05);
      this.freezeFeedbackR.gain.setTargetAtTime(0.988, now, 0.05);
      this.freezeWetGain.gain.setTargetAtTime(0.85, now, 0.05);
      this.freezeInputGain.gain.setTargetAtTime(0.08, now, 0.08);
    } else {
      // Clean, natural clickless release without premature quenching or double-ducking
      cancelParam(this.freezeFeedbackL.gain, now);
      cancelParam(this.freezeFeedbackR.gain, now);
      cancelParam(this.freezeWetGain.gain, now);
      cancelParam(this.freezeInputGain.gain, now);

      this.freezeFeedbackL.gain.setTargetAtTime(0.0, now, 0.025);
      this.freezeFeedbackR.gain.setTargetAtTime(0.0, now, 0.025);
      this.freezeWetGain.gain.setTargetAtTime(0.0, now, 0.028);
      this.freezeInputGain.gain.setTargetAtTime(1.0, now, 0.030);
    }
    return this.isFrozen;
  }

  /**
   * Immediately quench any active or residual freeze recirculation (Panic / Reset)
   */
  quenchFreeze() {
    this.isFrozen = false;
    const now = this.ctx ? this.ctx.currentTime : 0;
    const cancelParam = (param, time) => {
      if (!param) return;
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(time);
      } else if (typeof param.cancelScheduledValues === 'function') {
        param.cancelScheduledValues(time);
      }
    };

    if (this.freezeFeedbackL && this.freezeFeedbackL.gain) {
      cancelParam(this.freezeFeedbackL.gain, now);
      this.freezeFeedbackL.gain.setValueAtTime(0.0, now);
    }
    if (this.freezeFeedbackR && this.freezeFeedbackR.gain) {
      cancelParam(this.freezeFeedbackR.gain, now);
      this.freezeFeedbackR.gain.setValueAtTime(0.0, now);
    }
    if (this.freezeWetGain && this.freezeWetGain.gain) {
      cancelParam(this.freezeWetGain.gain, now);
      this.freezeWetGain.gain.setValueAtTime(0.0, now);
    }
    if (this.freezeInputGain && this.freezeInputGain.gain) {
      cancelParam(this.freezeInputGain.gain, now);
      this.freezeInputGain.gain.setValueAtTime(1.0, now);
    }
  }
}
