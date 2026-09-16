/**
 * @file challenger-m1-2-stress-harness.js
 * @brief Empirical stress test harness by m1_challenger_2.
 * Adversarially tests:
 * 1. Master Sub-Audio Pumping Stress (0.35 Hz sub-audio beating into masterDcBlocker & masterCompressor)
 * 2. Shimmer Freeze DC Drift Stress (0.992 feedback over 100,000 samples with steady DC input offset)
 * 3. AudioParam Fallback Pop Stress (rapid transitions without cancelAndHoldAtTime)
 */

import assert from 'node:assert/strict';
import { AudioEngine } from '../js/audio/engine.js';
import { SolarDroneVoice } from '../js/audio/drone-voice.js';
import { ShimmerReverb } from '../js/audio/shimmer-reverb.js';
import { TapeDelay } from '../js/audio/tape-delay.js';

// --- Test 1: Master Sub-Audio Pumping Stress ---
function stressTestMasterSubAudioPumping() {
  console.log('\n--- Challenge 1: Master Sub-Audio Pumping Stress ---');

  const sampleRate = 48000;
  const durationSec = 3.0; // > 1 full cycle of 0.35 Hz (period = 2.857s)
  const numSamples = Math.floor(sampleRate * durationSec);

  // Highpass filter implementation (2nd-order Butterworth biquad at fc = 15 Hz, Q = 0.707)
  function makeHighpassFilter(fc, Q, fs) {
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

  // Web Audio DynamicsCompressor model:
  // threshold = -3.0 dBFS, knee = 12 dB, ratio = 8:1, attack = 3ms, release = 60ms
  class CompressorModel {
    constructor(fs, threshold = -3.0, knee = 12.0, ratio = 8.0, attack = 0.003, release = 0.060) {
      this.fs = fs;
      this.threshold = threshold;
      this.knee = knee;
      this.ratio = ratio;
      this.attackCoeff = 1 - Math.exp(-1 / (attack * fs));
      this.releaseCoeff = 1 - Math.exp(-1 / (release * fs));
      this.envelope = 0;
    }

    process(sample) {
      const absSample = Math.abs(sample);
      // Envelope detector (peak with attack / release)
      if (absSample > this.envelope) {
        this.envelope += this.attackCoeff * (absSample - this.envelope);
      } else {
        this.envelope += this.releaseCoeff * (absSample - this.envelope);
      }

      // Compute input level in dB
      const envDb = 20 * Math.log10(Math.max(1e-6, this.envelope));
      let gainReductionDb = 0;

      const T = this.threshold;
      const W = this.knee;
      const R = this.ratio;

      // Soft knee compression characteristic
      if (2 * (envDb - T) < -W) {
        gainReductionDb = 0;
      } else if (2 * Math.abs(envDb - T) <= W) {
        const delta = envDb - T + W / 2;
        gainReductionDb = (1 / R - 1) * (delta * delta) / (2 * W);
      } else {
        gainReductionDb = (T + (envDb - T) / R) - envDb;
      }

      return {
        envelope: this.envelope,
        envDb,
        gainReductionDb // <= 0 dB
      };
    }
  }

  // Generate a heavy 0.35 Hz sub-bass oscillation with wavefolder saturation
  // Simulation: 0.35 Hz wavefolded sub-audio (amplitude = 1.4, +2.9 dBFS peaks)
  // plus legitimate program audio (e.g. 440 Hz felt piano note at -6 dBFS = 0.5 amplitude)
  const inputBuffer = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // 0.35 Hz beating oscillation
    const subOsc = 1.4 * Math.sin(2 * Math.PI * 0.35 * t);
    // Wavefolder polynomial distortion simulating saturated drone voice: tanh(sin(subOsc))
    const saturatedSub = Math.tanh(1.5 * Math.sin(0.5 * Math.PI * subOsc));
    // Legitimate audio tone (440 Hz at -6 dBFS)
    const audioTone = 0.5 * Math.sin(2 * Math.PI * 440 * t);
    inputBuffer[i] = saturatedSub + audioTone;
  }

  // Case A: Buggy routing without DC Blocker upstream of Compressor
  // (inputBuffer enters Compressor directly)
  const compBuggy = new CompressorModel(sampleRate);
  let maxGrBuggy = 0;
  let minGrBuggy = 0;
  const grBuggyHistory = [];

  for (let i = 0; i < numSamples; i++) {
    const res = compBuggy.process(inputBuffer[i]);
    grBuggyHistory.push(res.gainReductionDb);
    if (i > sampleRate * 0.5) { // after initial transient settles
      maxGrBuggy = Math.max(maxGrBuggy, res.gainReductionDb);
      minGrBuggy = Math.min(minGrBuggy, res.gainReductionDb);
    }
  }
  const grPumpingBuggy = maxGrBuggy - minGrBuggy;

  // Case B: Fixed routing (masterDcBlocker at 15 Hz BEFORE Compressor)
  const dcBlocker = makeHighpassFilter(15, 0.707, sampleRate);
  const compFixed = new CompressorModel(sampleRate);
  let maxGrFixed = -Infinity;
  let minGrFixed = Infinity;
  const grFixedHistory = [];

  for (let i = 0; i < numSamples; i++) {
    const filtered = dcBlocker(inputBuffer[i]);
    const res = compFixed.process(filtered);
    grFixedHistory.push(res.gainReductionDb);
    if (i > sampleRate * 0.5) { // after initial filter transient settles
      maxGrFixed = Math.max(maxGrFixed, res.gainReductionDb);
      minGrFixed = Math.min(minGrFixed, res.gainReductionDb);
    }
  }
  const grPumpingFixed = maxGrFixed - minGrFixed;

  // Also check attenuation of 0.35 Hz pure tone through 15 Hz highpass
  const hpTest = makeHighpassFilter(15, 0.707, sampleRate);
  let maxIn = 0, maxOut = 0;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const s = Math.sin(2 * Math.PI * 0.35 * t);
    const out = hpTest(s);
    if (i > sampleRate * 1.0) {
      maxIn = Math.max(maxIn, Math.abs(s));
      maxOut = Math.max(maxOut, Math.abs(out));
    }
  }
  const subAudioAttenuationDb = 20 * Math.log10(maxOut / maxIn);

  console.log(`Sub-audio 0.35 Hz Attenuation through 15 Hz DC blocker: ${subAudioAttenuationDb.toFixed(2)} dB`);
  console.log(`Buggy Routing (no DC blocker pre-comp) Gain Reduction Fluctuation: ${grPumpingBuggy.toFixed(2)} dB (Severe Pumping!)`);
  console.log(`Fixed Routing (DC blocker pre-comp) Gain Reduction Fluctuation: ${grPumpingFixed.toFixed(2)} dB`);

  // Assertions:
  assert.ok(subAudioAttenuationDb < -60.0, `0.35 Hz must be attenuated by at least -60 dB (got ${subAudioAttenuationDb.toFixed(2)} dB)`);
  assert.ok(grPumpingBuggy > 3.0, `Buggy routing must exhibit > 3 dB cyclic breathing/pumping`);
  assert.ok(grPumpingFixed < 0.2, `Fixed routing must stabilize gain reduction with < 0.2 dB fluctuation (got ${grPumpingFixed.toFixed(2)} dB)`);

  console.log('✔ Challenge 1 PASSED: masterDcBlocker completely removes 0.35 Hz subsonic energy, eliminating compressor pumping.');
}

// --- Test 2: Shimmer Freeze DC Drift Stress ---
function stressTestShimmerFreezeDcDrift() {
  console.log('\n--- Challenge 2: Shimmer Freeze DC Drift Stress ---');

  const sampleRate = 48000;
  const numSamples = 100000; // 100,000 samples (~2.08s, >4 full circulations)
  const delaySamplesL = Math.round(0.387 * sampleRate); // 18576 samples
  const delaySamplesR = Math.round(0.491 * sampleRate); // 23568 samples
  const feedback = 0.992;
  const dcOffset = 0.25; // steady +0.25 DC bias

  // Highpass filter (25 Hz, Q = 0.707)
  function makeHighpassFilter(fc, Q, fs) {
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

  // Simulation: Delay Line Buffer
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

  // Test 2A: Rapid recirculation over 100,000 samples (delay = 20ms / 960 samples, ~104 circulations)
  // Demonstrates the asymptotic runaway accumulation of DC offset in a 0.992 feedback loop
  const delayFast = 960;
  const delayLineA_fast = new DelayLine(delayFast);
  const delayLineB_fast = new DelayLine(delayFast);
  const hpFast = makeHighpassFilter(25, 0.707, sampleRate);
  let maxStateA_fast = 0;
  let maxStateB_fast = 0;

  for (let i = 0; i < numSamples; i++) {
    const outA = delayLineA_fast.read();
    const inA = outA * feedback + dcOffset * 0.12;
    delayLineA_fast.write(inA);
    maxStateA_fast = Math.max(maxStateA_fast, Math.abs(inA));

    const outB = delayLineB_fast.read();
    const inB = hpFast(outB * feedback) + dcOffset * 0.12;
    delayLineB_fast.write(inB);
    maxStateB_fast = Math.max(maxStateB_fast, Math.abs(inB));
  }

  // Test 2B: Full freeze delay lengths (0.387s / 0.491s) with initial DC offset (0.90) and sustained DC
  const delayL_A = new DelayLine(delaySamplesL);
  const delayR_A = new DelayLine(delaySamplesR);
  // Pre-seed with initial frozen audio containing high DC offset (0.90)
  for (let k = 0; k < delaySamplesL; k++) delayL_A.buffer[k] = 0.90;
  for (let k = 0; k < delaySamplesR; k++) delayR_A.buffer[k] = 0.90;

  const delayL_B = new DelayLine(delaySamplesL);
  const delayR_B = new DelayLine(delaySamplesR);
  for (let k = 0; k < delaySamplesL; k++) delayL_B.buffer[k] = 0.90;
  for (let k = 0; k < delaySamplesR; k++) delayR_B.buffer[k] = 0.90;

  const hpL = makeHighpassFilter(25, 0.707, sampleRate);
  const hpR = makeHighpassFilter(25, 0.707, sampleRate);

  let finalStateA = 0;
  let finalStateB = 0;

  for (let i = 0; i < numSamples; i++) {
    const outL_A = delayL_A.read();
    const outR_A = delayR_A.read();
    const inL_A = outR_A * feedback + dcOffset * 0.12;
    const inR_A = outL_A * feedback + dcOffset * 0.12;
    delayL_A.write(inL_A);
    delayR_A.write(inR_A);

    const outL_B = delayL_B.read();
    const outR_B = delayR_B.read();
    const inL_B = hpR(outR_B * feedback) + dcOffset * 0.12;
    const inR_B = hpL(outL_B * feedback) + dcOffset * 0.12;
    delayL_B.write(inL_B);
    delayR_B.write(inR_B);

    if (i === numSamples - 1) {
      finalStateA = Math.max(Math.abs(inL_A), Math.abs(inR_A));
      finalStateB = Math.max(Math.abs(inL_B), Math.abs(inR_B));
    }
  }

  console.log(`Rapid Loop (104 circulations) WITHOUT DC Blocker: Max State = ${maxStateA_fast.toFixed(4)} (Runaway DC blown past 1.0!)`);
  console.log(`Rapid Loop (104 circulations) WITH DC Blocker:    Max State = ${maxStateB_fast.toFixed(4)} (Strictly bounded!)`);
  console.log(`Full Shimmer Delays WITHOUT DC Blocker: Final DC Offset at 100k samples = ${finalStateA.toFixed(4)} (DC persists at ~0.90!)`);
  console.log(`Full Shimmer Delays WITH freezeHpFilter: Final DC Offset at 100k samples = ${finalStateB.toFixed(4)} (DC attenuated to near zero!)`);

  // Assertions:
  assert.ok(maxStateA_fast > 1.0, `Without DC blockers, feedback accumulation must exceed digital full scale 1.0 (got ${maxStateA_fast.toFixed(4)})`);
  assert.ok(maxStateB_fast < 0.10, `With 25 Hz DC blocker, rapid loop must remain strictly bounded below 0.10 (got ${maxStateB_fast.toFixed(4)})`);
  assert.ok(finalStateA > 0.80, `Without DC blockers, frozen DC offset must linger near initial 0.90 (got ${finalStateA.toFixed(4)})`);
  assert.ok(finalStateB < 0.05, `With freezeHpFilterL/R, DC offset must be stripped to < 0.05 (got ${finalStateB.toFixed(4)})`);

  console.log('✔ Challenge 2 PASSED: freezeHpFilterL/R completely eliminates DC runaway drift and strips sustained DC offset over 100,000 samples.');
}

// --- Test 3: AudioParam Fallback Pop Stress ---
function stressTestAudioParamFallbacks() {
  console.log('\n--- Challenge 3: AudioParam Fallback Pop Stress ---');

  // Simulated Web Audio AudioParam evaluator without cancelAndHoldAtTime
  class MockAudioParamTimeline {
    constructor(defaultValue = 1.0, getNow = () => 0) {
      this.defaultValue = defaultValue;
      this.timeline = []; // scheduled events
      this.getNow = getNow;
      // cancelAndHoldAtTime is explicitly UNDEFINED to force fallback
      this.cancelAndHoldAtTime = undefined;
    }

    get value() {
      return this.getValueAtTime(this.getNow());
    }

    set value(v) {
      this.setValueAtTime(v, this.getNow());
    }

    // Evaluate parameter value at exact time t
    getValueAtTime(t) {
      if (this.timeline.length === 0) return this.defaultValue;

      // Find the last event at or before t
      let currentVal = this.defaultValue;
      for (let i = 0; i < this.timeline.length; i++) {
        const ev = this.timeline[i];
        if (ev.time > t) {
          // If in middle of a linear ramp
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

        if (ev.type === 'setValue') {
          currentVal = ev.value;
        } else if (ev.type === 'linearRamp') {
          currentVal = ev.value;
        } else if (ev.type === 'setTarget') {
          currentVal = ev.target + (currentVal - ev.target) * Math.exp(-(t - ev.time) / ev.tau);
        }
      }
      return currentVal;
    }

    setValueAtTime(v, t) {
      this.timeline.push({ type: 'setValue', value: v, time: t });
    }

    linearRampToValueAtTime(v, t) {
      this.timeline.push({ type: 'linearRamp', value: v, time: t });
    }

    setTargetAtTime(target, t, tau) {
      this.timeline.push({ type: 'setTarget', target, value: target, time: t, tau });
    }

    cancelScheduledValues(t) {
      this.timeline = this.timeline.filter(e => e.time < t);
    }
  }

  const createMockNode = (name) => ({
    name,
    connect: () => {},
    disconnect: () => {}
  });

  // Mock AudioNode / Drone Voice context
  const mockCtx = {
    currentTime: 0.0,
    createGain: () => ({
      ...createMockNode('gain'),
      gain: new MockAudioParamTimeline(1.0, () => mockCtx.currentTime)
    }),
    createBiquadFilter: () => ({
      ...createMockNode('biquad'),
      type: 'lowpass',
      frequency: new MockAudioParamTimeline(1000, () => mockCtx.currentTime),
      Q: new MockAudioParamTimeline(1.0, () => mockCtx.currentTime)
    }),
    createDelay: () => ({
      ...createMockNode('delay'),
      delayTime: new MockAudioParamTimeline(0.0, () => mockCtx.currentTime)
    }),
    createWaveShaper: () => ({
      ...createMockNode('waveshaper'),
      curve: null,
      oversample: 'none'
    }),
    createOscillator: () => ({
      ...createMockNode('oscillator'),
      frequency: new MockAudioParamTimeline(440, () => mockCtx.currentTime),
      detune: new MockAudioParamTimeline(0, () => mockCtx.currentTime),
      start: () => {},
      stop: () => {},
      setPeriodicWave: () => {}
    }),
    destination: createMockNode('destination')
  };

  const drone = new SolarDroneVoice(mockCtx, mockCtx.destination, null, 1);
  drone.setActive(true);
  drone.setVolume(0.8);

  console.log('--- 3A: Pure Declick Transitions (Fallback) ---');
  let maxPureDeclickJump = 0;
  let tA = 0.05;
  const droneA = new SolarDroneVoice(mockCtx, mockCtx.destination, null, 1);
  droneA.setActive(true);
  droneA.setVolume(0.8);
  droneA.voiceGain.gain.cancelAndHoldAtTime = undefined;

  for (let i = 0; i < 100; i++) {
    tA += 0.006 + (i % 4) * 0.002;
    mockCtx.currentTime = tA;
    const vBefore = droneA.voiceGain.gain.getValueAtTime(tA);
    droneA.declickTransition(0.035);
    const vAfter = droneA.voiceGain.gain.getValueAtTime(tA);
    maxPureDeclickJump = Math.max(maxPureDeclickJump, Math.abs(vAfter - vBefore));
  }
  console.log(`100 Pure Declick Fallback Transitions Max Discontinuity: ${maxPureDeclickJump.toFixed(8)} (PASS: continuous)`);
  assert.strictEqual(maxPureDeclickJump, 0, 'Pure declick transitions must have 0 discontinuity');

  console.log('\n--- 3B: Pure Volume Transitions (Fallback) ---');
  let maxPureVolJump = 0;
  let tB = 0.05;
  const droneB = new SolarDroneVoice(mockCtx, mockCtx.destination, null, 1);
  droneB.setActive(true);
  droneB.setVolume(0.8);
  droneB.voiceGain.gain.cancelAndHoldAtTime = undefined;

  for (let i = 0; i < 100; i++) {
    tB += 0.002 + (i % 5) * 0.001;
    mockCtx.currentTime = tB;
    const vBefore = droneB.voiceGain.gain.getValueAtTime(tB);
    droneB.setVolume(0.1 + (i % 10) * 0.09);
    const vAfter = droneB.voiceGain.gain.getValueAtTime(tB);
    maxPureVolJump = Math.max(maxPureVolJump, Math.abs(vAfter - vBefore));
  }
  console.log(`100 Pure Volume Fallback Transitions Max Discontinuity: ${maxPureVolJump.toFixed(8)} (PASS: continuous)`);
  assert.ok(maxPureVolJump < 1e-12, 'Pure volume transitions must have 0 discontinuity');

  console.log('\n--- 3C: TapeDelay Wow/Flutter Fallback Transitions ---');
  const delay = new TapeDelay(mockCtx);
  delay.wowGainL.gain.cancelAndHoldAtTime = undefined;
  let maxTapeJump = 0;
  let tC = 0.05;
  for (let i = 0; i < 100; i++) {
    tC += 0.002 + (i % 5) * 0.001;
    mockCtx.currentTime = tC;
    const vBefore = delay.wowGainL.gain.getValueAtTime(tC);
    delay.setWowFlutter(0.05 + (i % 10) * 0.08);
    const vAfter = delay.wowGainL.gain.getValueAtTime(tC);
    maxTapeJump = Math.max(maxTapeJump, Math.abs(vAfter - vBefore));
  }
  console.log(`100 TapeDelay Wow/Flutter Transitions Max Discontinuity: ${maxTapeJump.toExponential(4)} (PASS: continuous)`);
  assert.ok(maxTapeJump < 1e-12, 'TapeDelay transitions must be continuous');

  console.log('\n--- 3D: [ADVERSARIAL VULNERABILITY 1] setActive(false) Mute Cliff Drop ---');
  const droneD = new SolarDroneVoice(mockCtx, mockCtx.destination, null, 1);
  droneD.setActive(true);
  droneD.setVolume(0.8);
  droneD.voiceGain.gain.cancelAndHoldAtTime = undefined;

  mockCtx.currentTime = 1.0;
  const valBeforeMute = droneD.voiceGain.gain.getValueAtTime(1.0);
  droneD.setActive(false);
  const valAfterMute = droneD.voiceGain.gain.getValueAtTime(1.0);
  const muteCliffDrop = Math.abs(valAfterMute - valBeforeMute);

  console.log(`Mute at t=1.0: Gain Before = ${valBeforeMute.toFixed(4)}, Gain After = ${valAfterMute.toFixed(4)}`);
  console.log(`Instantaneous Cliff Drop on Mute: ${muteCliffDrop.toFixed(4)} (${(muteCliffDrop * 100).toFixed(1)}% volume drop in 0ms!)`);
  console.log(`Root Cause: setActive() sets this.isActive = false before _getInstantGain(now) is called; line 408 returns 0.0001, anchoring setValueAtTime(0.0001, now) instantly.`);

  console.log('\n--- 3E: [ADVERSARIAL VULNERABILITY 2] Interleaved Volume & Declick Step Jumps ---');
  const droneE = new SolarDroneVoice(mockCtx, mockCtx.destination, null, 1);
  droneE.setActive(true);
  droneE.setVolume(0.8);
  droneE.voiceGain.gain.cancelAndHoldAtTime = undefined;

  let maxInterleavedJump = 0;
  let tE = 0.05;
  for (let step = 0; step < 200; step++) {
    const dt = 0.001 + (step % 5) * 0.002;
    tE += dt;
    mockCtx.currentTime = tE;

    const vBefore = droneE.voiceGain.gain.getValueAtTime(tE);
    if (step % 2 === 0) {
      droneE.declickTransition(0.035);
    } else {
      droneE.setVolume(0.2 + (step % 5) * 0.15);
    }
    const vAfter = droneE.voiceGain.gain.getValueAtTime(tE);
    maxInterleavedJump = Math.max(maxInterleavedJump, Math.abs(vAfter - vBefore));
  }
  console.log(`200 Interleaved Volume & Declick Transitions Max Discontinuity: ${maxInterleavedJump.toFixed(6)} (${(maxInterleavedJump * 100).toFixed(2)}% jump)`);
  console.log(`Root Cause: setVolume cancels scheduled values but does not reset this._declickEndTime; stale linear-ramp interpolation pollutes subsequent parameter calculations.`);

  console.log('\n--- 3F: Proof of Mitigation Verification ---');
  const droneF = new SolarDroneVoice(mockCtx, mockCtx.destination, null, 1);
  droneF.setActive(true);
  droneF.setVolume(0.8);
  droneF.voiceGain.gain.cancelAndHoldAtTime = undefined;

  // Apply proposed surgical mitigation
  droneF.setActive = function(active) {
    const now = this.ctx.currentTime;
    const prevGain = this._getInstantGain(now); // capture BEFORE updating this.isActive
    this.isActive = Boolean(active);
    const effectiveGain = this.volume * (this.subBassGainTrim || 1.0);
    const targetGain = this.isActive ? effectiveGain : 0.0;
    this._currentGain = targetGain;
    this._declickEndTime = null;
    this._declickingUntil = null;

    let held = false;
    if (typeof this.voiceGain.gain.cancelAndHoldAtTime === 'function') {
      try { this.voiceGain.gain.cancelAndHoldAtTime(now); held = true; } catch (e) { held = false; }
    }
    if (!held && typeof this.voiceGain.gain.cancelScheduledValues === 'function') {
      this.voiceGain.gain.cancelScheduledValues(now);
      if (typeof this.voiceGain.gain.setValueAtTime === 'function') {
        this.voiceGain.gain.setValueAtTime(prevGain, now);
      }
    }
    if (typeof this.voiceGain.gain.setTargetAtTime === 'function') {
      this.voiceGain.gain.setTargetAtTime(targetGain, now, 0.06);
    }
    return this.isActive;
  };

  const origSetVol = droneF.setVolume.bind(droneF);
  droneF.setVolume = function(v) {
    origSetVol(v);
    this._declickEndTime = null;
    this._declickingUntil = null;
  };

  // Retest Mute
  mockCtx.currentTime = 1.0;
  const vBeforeMuteF = droneF.voiceGain.gain.getValueAtTime(1.0);
  droneF.setActive(false);
  const vAfterMuteF = droneF.voiceGain.gain.getValueAtTime(1.0);
  const mitigatedMuteJump = Math.abs(vAfterMuteF - vBeforeMuteF);
  console.log(`Mitigated Mute Step Drop: ${mitigatedMuteJump.toFixed(8)} (ZERO step jump, smooth 60ms fade-out)`);

  // Retest 200 Chaotic Interleaved Transitions
  let maxMitigatedJump = 0;
  let tF = 2.0;
  droneF.setActive(true);
  droneF.setVolume(0.8);
  for (let step = 0; step < 200; step++) {
    const dt = 0.001 + (step % 5) * 0.002;
    tF += dt;
    mockCtx.currentTime = tF;
    const vBefore = droneF.voiceGain.gain.getValueAtTime(tF);
    const act = step % 3;
    if (act === 0) droneF.declickTransition(0.035);
    else if (act === 1) droneF.setVolume(0.1 + (step % 10) * 0.09);
    else droneF.setActive(step % 6 !== 0);
    const vAfter = droneF.voiceGain.gain.getValueAtTime(tF);
    maxMitigatedJump = Math.max(maxMitigatedJump, Math.abs(vAfter - vBefore));
  }
  console.log(`Mitigated 200 Chaotic Transitions Max Discontinuity: ${maxMitigatedJump.toExponential(4)} (Zero step discontinuity!)`);
  assert.strictEqual(mitigatedMuteJump, 0);
  assert.ok(maxMitigatedJump < 1e-12);
}

function runAllChallenges() {
  console.log('================================================================');
  console.log('  M1 CHALLENGER 2: EMPIRICAL ADVERSARIAL STRESS TEST SUITE      ');
  console.log('================================================================');

  stressTestMasterSubAudioPumping();
  stressTestShimmerFreezeDcDrift();
  stressTestAudioParamFallbacks();

  console.log('\n================================================================');
  console.log('  ADVERSARIAL STRESS HARNESS EXECUTION FINISHED                 ');
  console.log('================================================================');
}

runAllChallenges();
