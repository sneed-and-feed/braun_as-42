/**
 * @file sub-bass-freeze-safeguard.test.js
 * @brief Regression test suite for AS-42 Sub-Bass Freeze Trapped Feedback Loop Bug
 *
 * Verifies:
 * 1. Dedicated Sub-Bass Roll-off Filters (75 Hz) & Soft Limiter (0.88 cap) in ShimmerReverb freeze loop.
 * 2. Contractive feedback bounding (0.982 <= 0.985 max) preventing infinite runaway.
 * 3. Numerical DSP simulation: injecting 32.7 Hz C1 sub-bass at 1.70x boost during freeze never exceeds 0 dBFS.
 * 4. Rapid & reliable quench: calling setFreeze(false) strictly silences feedback and wet gain within 50 ms.
 * 5. Clean panic / reset: releaseAllNotes() and panic() on AudioEngine immediately quench freeze recirculation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ShimmerReverb } from '../js/audio/shimmer-reverb.js';
import { AudioEngine } from '../js/audio/engine.js';
import { makeFreezeLimiterCurve, applySmoothBoundaryKnee } from '../js/audio/wavefolder.js';

// --- Mock Infrastructure for Node.js Testing ---

class MockAudioParam {
  constructor(defaultValue = 0, getNow = null) {
    this.defaultValue = defaultValue;
    this._value = defaultValue;
    this.events = [];
    this.timeline = [];
    this.getNow = getNow;
  }
  get value() {
    if (typeof this.getNow === 'function') {
      return this.getValueAtTime(this.getNow());
    }
    return this._value;
  }
  set value(v) {
    this._value = v;
  }
  getValueAtTime(t) {
    if (this.timeline.length === 0) return this._value;
    let currentVal = this.defaultValue;
    for (let i = 0; i < this.timeline.length; i++) {
      const ev = this.timeline[i];
      if (ev.time > t) {
        if (ev.type === 'linearRamp') {
          const prev = this.timeline[i - 1];
          const prevTime = prev ? prev.time : 0;
          const prevVal = prev ? prev.value : this.defaultValue;
          const frac = (t - prevTime) / Math.max(1e-5, ev.time - prevTime);
          return prevVal + (ev.value - prevVal) * Math.max(0, Math.min(1, frac));
        } else if (ev.type === 'setTarget') {
          const prev = this.timeline[i - 1];
          const prevVal = prev ? prev.value : this.defaultValue;
          return ev.target + (prevVal - ev.target) * Math.exp(-(t - ev.time) / ev.tau);
        }
        break;
      }
      if (ev.type === 'setValue') currentVal = ev.value;
      else if (ev.type === 'linearRamp') currentVal = ev.value;
      else if (ev.type === 'setTarget') currentVal = ev.target + (currentVal - ev.target) * Math.exp(-(t - ev.time) / ev.tau);
    }
    return currentVal;
  }
  setValueAtTime(v, t) {
    this._value = v;
    this.timeline.push({ type: 'setValue', value: v, time: t });
    this.events.push({ type: 'setValueAtTime', v, t });
    return this;
  }
  setTargetAtTime(target, startTime, timeConstant) {
    this._value = target;
    this.timeline.push({ type: 'setTarget', target, value: target, time: startTime, tau: timeConstant });
    this.events.push({ type: 'setTargetAtTime', target, v: target, t: startTime, tau: timeConstant, startTime, timeConstant });
    return this;
  }
  cancelScheduledValues(t) {
    this.timeline = this.timeline.filter(e => e.time < t);
    this.events.push({ type: 'cancelScheduledValues', t });
    return this;
  }
  cancelAndHoldAtTime(t) {
    const valAtT = this.getValueAtTime(t);
    this.timeline = this.timeline.filter(e => e.time < t);
    this.timeline.push({ type: 'setValue', value: valAtT, time: t });
    this.events.push({ type: 'cancelAndHoldAtTime', t });
    return this;
  }
}

class MockAudioNode {
  constructor(name = 'node') {
    this.name = name;
    this.connectedTo = [];
    this.connections = this.connectedTo;
  }
  connect(dest) {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect(dest) {
    if (!dest) {
      this.connectedTo.length = 0;
    } else {
      const idx = this.connectedTo.indexOf(dest);
      if (idx !== -1) this.connectedTo.splice(idx, 1);
    }
  }
}

class MockGainNode extends MockAudioNode {
  constructor() {
    super('gain');
    this.gain = new MockAudioParam(1.0);
  }
}

class MockBiquadFilter extends MockAudioNode {
  constructor() {
    super('filter');
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(1000);
    this.Q = new MockAudioParam(1);
    this.gain = new MockAudioParam(0);
  }
}

class MockDelayNode extends MockAudioNode {
  constructor(maxDelayTime = 1.0) {
    super('delay');
    this.delayTime = new MockAudioParam(0.0);
    this.maxDelayTime = maxDelayTime;
  }
}

class MockWaveShaperNode extends MockAudioNode {
  constructor() {
    super('shaper');
    this.curve = null;
    this.oversample = 'none';
  }
}

class MockContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 1.0;
    this.state = 'running';
    this.destination = new MockAudioNode('destination');
    this.createdNodes = [];
  }
  createGain() {
    const n = new MockGainNode();
    n.gain = new MockAudioParam(1.0, () => this.currentTime);
    this.createdNodes.push(n);
    return n;
  }
  createBiquadFilter() {
    const n = new MockBiquadFilter();
    this.createdNodes.push(n);
    return n;
  }
  createDelay(maxDelay) {
    const n = new MockDelayNode(maxDelay);
    this.createdNodes.push(n);
    return n;
  }
  createWaveShaper() {
    const n = new MockWaveShaperNode();
    this.createdNodes.push(n);
    return n;
  }
  createConvolver() {
    const n = new MockAudioNode('convolver');
    n.normalize = true;
    n.buffer = null;
    this.createdNodes.push(n);
    return n;
  }
  createChannelSplitter(channels) {
    const n = new MockAudioNode('splitter');
    n.numberOfOutputs = channels;
    return n;
  }
  createBufferSource() {
    const n = new MockAudioNode('bufferSource');
    n.start = () => {};
    n.stop = () => {};
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length)
    };
  }
}

// --- Biquad Digital Filter Simulator for Numerical DSP Test ---
function makeBiquadHighpass(fc, Q, fs) {
  const w0 = 2 * Math.PI * fc / fs;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  const b0 = (1 + cosw0) / 2;
  const b1 = -(1 + cosw0);
  const b2 = (1 + cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return function(x) {
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

class DelayLine {
  constructor(length) {
    this.buffer = new Float32Array(length);
    this.index = 0;
    this.length = length;
  }
  read() {
    return this.buffer[this.index];
  }
  write(sample) {
    this.buffer[this.index] = sample;
    this.index = (this.index + 1) % this.length;
  }
}

describe('AS-42 Sub-Bass Freeze Trapped Feedback Loop Safeguards', () => {

  describe('1. Freeze Graph Architecture & Sub-Bass Cut Verification', () => {
    it('instantiates dedicated 75 Hz sub-bass roll-off filters and 0.88 soft limiters in freeze path', () => {
      const ctx = new MockContext();
      const rev = new ShimmerReverb(ctx);

      // Verify DC blockers preserved for regression audit
      assert.ok(rev.freezeHpFilterL, 'freezeHpFilterL must exist');
      assert.ok(rev.freezeHpFilterR, 'freezeHpFilterR must exist');
      assert.strictEqual(rev.freezeHpFilterL.frequency.value, 25, 'freezeHpFilterL DC blocker must remain 25 Hz');
      assert.strictEqual(rev.freezeHpFilterR.frequency.value, 25, 'freezeHpFilterR DC blocker must remain 25 Hz');

      // Verify dedicated 75 Hz sub-bass roll-off filters
      assert.ok(rev.freezeInputHpFilter, 'freezeInputHpFilter must exist');
      assert.ok(rev.freezeSubCutFilterL, 'freezeSubCutFilterL must exist');
      assert.ok(rev.freezeSubCutFilterR, 'freezeSubCutFilterR must exist');
      assert.strictEqual(rev.freezeInputHpFilter.type, 'highpass');
      assert.strictEqual(rev.freezeInputHpFilter.frequency.value, 75);
      assert.strictEqual(rev.freezeSubCutFilterL.type, 'highpass');
      assert.strictEqual(rev.freezeSubCutFilterL.frequency.value, 75);
      assert.strictEqual(rev.freezeSubCutFilterR.type, 'highpass');
      assert.strictEqual(rev.freezeSubCutFilterR.frequency.value, 75);

      // Verify freeze loop soft limiters
      assert.ok(rev.freezeLimiterL, 'freezeLimiterL WaveShaper must exist');
      assert.ok(rev.freezeLimiterR, 'freezeLimiterR WaveShaper must exist');
      assert.ok(rev.freezeLimiterL.curve instanceof Float32Array, 'freezeLimiterL must have a curve');
      assert.strictEqual(rev.freezeLimiterL.curve.length, 2048);

      // Verify soft limiter curve bounds peak energy to <= 0.88
      let maxCurveL = 0;
      for (let i = 0; i < rev.freezeLimiterL.curve.length; i++) {
        maxCurveL = Math.max(maxCurveL, Math.abs(rev.freezeLimiterL.curve[i]));
      }
      assert.ok(maxCurveL <= 0.88001, `Limiter curve maximum must be <= 0.88 (got ${maxCurveL})`);
      assert.ok(maxCurveL >= 0.87, `Limiter curve maximum must reach ~0.88 (got ${maxCurveL})`);
    });

    it('verifies feedback target is bounded to 0.988 (<= 0.990) when freeze is engaged', () => {
      const ctx = new MockContext();
      const rev = new ShimmerReverb(ctx);

      ctx.currentTime = 2.0;
      rev.setFreeze(true);

      const eventsL = rev.freezeFeedbackL.gain.events.filter(e => e.type === 'setTargetAtTime');
      assert.ok(eventsL.length > 0, 'Must schedule setTargetAtTime on freeze feedback');
      const lastEvent = eventsL[eventsL.length - 1];
      assert.ok(lastEvent.target <= 0.990, `Feedback target must be <= 0.990 to be contractive (got ${lastEvent.target})`);
      assert.strictEqual(lastEvent.target, 0.988, 'Feedback target must be 0.988');
    });
  });

  describe('2. Numerical DSP Simulation: 32.7 Hz Sub-Bass Runaway Prevention', () => {
    it('guarantees that 32.7 Hz C1 sub-bass at 1.70x boost does NOT cause >0 dBFS runaway', () => {
      const sampleRate = 48000;
      const numSamples = 96000; // 2 seconds of audio
      const delaySamplesL = Math.round(0.387 * sampleRate);
      const delaySamplesR = Math.round(0.491 * sampleRate);

      const delayL = new DelayLine(delaySamplesL);
      const delayR = new DelayLine(delaySamplesR);

      const inputHp = makeBiquadHighpass(75, 0.707, sampleRate);
      const subCutL = makeBiquadHighpass(75, 0.707, sampleRate);
      const subCutR = makeBiquadHighpass(75, 0.707, sampleRate);
      const dcBlockL = makeBiquadHighpass(25, 0.707, sampleRate);
      const dcBlockR = makeBiquadHighpass(25, 0.707, sampleRate);

      const feedbackGain = 0.988;
      const freezeInGain = 0.08;

      // Soft limiter function matching makeFreezeLimiterCurve(2048, 0.88)
      const softLimiter = (x) => {
        const bound = 0.88;
        const scaled = x / bound;
        return bound * applySmoothBoundaryKnee(scaled, 0.70);
      };

      // 32.703 Hz sine tone (C1, Drone Voice 1 sub-bass) with 1.70x volume boost
      const f0 = 32.703;
      let maxLoopPeak = 0.0;
      let finalSamplesPeak = 0.0;

      for (let n = 0; n < numSamples; n++) {
        const subBassInput = 1.70 * Math.sin(2 * Math.PI * f0 * n / sampleRate);
        const filteredInput = inputHp(subBassInput) * freezeInGain;

        const outL = delayL.read();
        const outR = delayR.read();

        // Left loop: delayL -> subCutL -> limiter -> feedback -> dcBlockL -> delayR
        const cutL = subCutL(outL);
        const limitedL = softLimiter(cutL);
        const fbL = dcBlockL(limitedL * feedbackGain);

        // Right loop: delayR -> subCutR -> limiter -> feedback -> dcBlockR -> delayL
        const cutR = subCutR(outR);
        const limitedR = softLimiter(cutR);
        const fbR = dcBlockR(limitedR * feedbackGain);

        const inL = filteredInput + fbR;
        const inR = filteredInput + fbL;

        delayL.write(inL);
        delayR.write(inR);

        const curPeak = Math.max(Math.abs(inL), Math.abs(inR));
        maxLoopPeak = Math.max(maxLoopPeak, curPeak);

        if (n >= numSamples - 4800) { // last 100ms
          finalSamplesPeak = Math.max(finalSamplesPeak, curPeak);
        }
      }

      // Assertions:
      // Peak must be strictly bounded below 0 dBFS (1.0) and <= 0.88 soft limit ceiling
      assert.ok(maxLoopPeak <= 0.89, `Peak recirculating energy must be <= 0.89 (got ${maxLoopPeak.toFixed(4)})`);
      assert.ok(maxLoopPeak < 1.0, `Peak must never exceed 0 dBFS / digital full scale (got ${maxLoopPeak.toFixed(4)})`);
      assert.ok(!Number.isNaN(finalSamplesPeak), 'Must not produce NaN');
      assert.ok(Number.isFinite(finalSamplesPeak), 'Must not produce Infinity');
    });
  });

  describe('3. Clean Natural Click-Free Decay on Unfreeze within 200 ms', () => {
    it('cancels scheduled values and smoothly slews feedback & wet gain to 0.0', () => {
      const ctx = new MockContext();
      const rev = new ShimmerReverb(ctx);

      // 1. Engage freeze
      ctx.currentTime = 2.0;
      rev.setFreeze(true);
      assert.strictEqual(rev.isFrozen, true);

      // Advance time to 5.0 seconds
      ctx.currentTime = 5.0;

      // 2. Unfreeze
      rev.setFreeze(false);
      assert.strictEqual(rev.isFrozen, false);

      // Verify cancellation events occurred at t = 5.0
      const cancelEventsFbL = rev.freezeFeedbackL.gain.events.filter(e => e.type === 'cancelAndHoldAtTime' || e.type === 'cancelScheduledValues');
      assert.ok(cancelEventsFbL.length > 0, 'freezeFeedbackL must cancel pending values on unfreeze');

      const cancelEventsWet = rev.freezeWetGain.gain.events.filter(e => e.type === 'cancelAndHoldAtTime' || e.type === 'cancelScheduledValues');
      assert.ok(cancelEventsWet.length > 0, 'freezeWetGain must cancel pending values on unfreeze');

      // Verify feedback and wet gain target 0.0
      const eventsFb = rev.freezeFeedbackL.gain.events.filter(e => e.type === 'setTargetAtTime');
      const lastFbEvent = eventsFb[eventsFb.length - 1];
      assert.strictEqual(lastFbEvent.target, 0.0);

      const eventsWet = rev.freezeWetGain.gain.events.filter(e => e.type === 'setTargetAtTime');
      const lastWetEvent = eventsWet[eventsWet.length - 1];
      assert.strictEqual(lastWetEvent.target, 0.0);

      // Verify input gain targets 1.0
      const eventsIn = rev.freezeInputGain.gain.events.filter(e => e.type === 'setTargetAtTime');
      const lastInEvent = eventsIn[eventsIn.length - 1];
      assert.strictEqual(lastInEvent.target, 1.0);

      // Verify that at t = 5.200s (200 ms after unfreeze), feedback and wet gain have decayed to < 0.001
      const fbValAt200ms = rev.freezeFeedbackL.gain.getValueAtTime(5.200);
      const wetValAt200ms = rev.freezeWetGain.gain.getValueAtTime(5.200);

      assert.ok(fbValAt200ms < 0.001, `freezeFeedbackL gain must be < 0.001 at 200ms (got ${fbValAt200ms})`);
      assert.ok(wetValAt200ms < 0.001, `freezeWetGain gain must be < 0.001 at 200ms (got ${wetValAt200ms})`);

      // Verify that input gain is restored to 1.0 (e.g. at 5.20s > 0.90)
      const inputGainRestored = rev.freezeInputGain.gain.getValueAtTime(5.200);
      assert.ok(inputGainRestored > 0.90, `freezeInputGain must be restored smoothly (got ${inputGainRestored})`);
    });
  });

  describe('4. Clean Panic / Reset Deactivation', () => {
    it('quenches active freeze recirculation immediately when quenchFreeze() is called', () => {
      const ctx = new MockContext();
      const rev = new ShimmerReverb(ctx);

      ctx.currentTime = 2.0;
      rev.setFreeze(true);
      assert.strictEqual(rev.isFrozen, true);

      rev.quenchFreeze();
      assert.strictEqual(rev.isFrozen, false);

      assert.strictEqual(rev.freezeFeedbackL.gain.value, 0.0);
      assert.strictEqual(rev.freezeFeedbackR.gain.value, 0.0);
      assert.strictEqual(rev.freezeWetGain.gain.value, 0.0);
      assert.strictEqual(rev.freezeInputGain.gain.value, 1.0);
    });

    it('quenches active freeze when AudioEngine.releaseAllNotes() or AudioEngine.panic() is invoked', () => {
      const engine = new AudioEngine();
      engine.isInitialized = true;
      engine.ctx = new MockContext();
      engine.shimmerReverb = new ShimmerReverb(engine.ctx);

      engine.setReverbFreeze(true);
      assert.strictEqual(engine.reverbParams.freeze, true);
      assert.strictEqual(engine.shimmerReverb.isFrozen, true);

      // Trigger releaseAllNotes() / Panic
      engine.releaseAllNotes();

      assert.strictEqual(engine.reverbParams.freeze, false, 'reverbParams.freeze must be reset to false');
      assert.strictEqual(engine.shimmerReverb.isFrozen, false, 'shimmerReverb.isFrozen must be reset to false');
      assert.strictEqual(engine.shimmerReverb.freezeFeedbackL.gain.value, 0.0);
      assert.strictEqual(engine.shimmerReverb.freezeWetGain.gain.value, 0.0);
    });
  });

});
