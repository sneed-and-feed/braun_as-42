/**
 * @file shimmer-true-stereo-and-low-end-decoupling.test.js
 * @brief Comprehensive verification test suite for modernized True Stereo Shimmer Reverb,
 * constant-amplitude Hann raised-cosine windows (sin^2(phi1) + sin^2(phi2) = 1.0),
 * smooth C1 Hermite knee saturation, multi-phase detuned taps, and low-end decoupling (<120 Hz).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ShimmerReverb } from '../js/audio/shimmer-reverb.js';
import { AudioEngine } from '../js/audio/engine.js';
import { SolarDroneVoice } from '../js/audio/drone-voice.js';
import { makeShimmerLimiterCurve, applySmoothBoundaryKnee } from '../js/audio/wavefolder.js';

class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.events = [];
  }
  setValueAtTime(val, time) {
    this.value = val;
    this.events.push({ type: 'setValueAtTime', value: val, time });
  }
  setTargetAtTime(target, time, timeConstant) {
    this.value = target;
    this.events.push({ type: 'setTargetAtTime', target, time, timeConstant });
  }
  linearRampToValueAtTime(val, time) {
    this.value = val;
    this.events.push({ type: 'linearRampToValueAtTime', value: val, time });
  }
  cancelScheduledValues(time) {
    this.events.push({ type: 'cancelScheduledValues', time });
  }
  cancelAndHoldAtTime(time) {
    this.events.push({ type: 'cancelAndHoldAtTime', time });
  }
}

class MockAudioNode {
  constructor(name = 'node') {
    this.name = name;
    this.connectedTo = [];
  }
  connect(dest, outputIndex = 0, inputIndex = 0) {
    this.connectedTo.push({ dest, outputIndex, inputIndex });
    return dest;
  }
  disconnect(dest) {
    if (!dest) {
      this.connectedTo = [];
    } else {
      this.connectedTo = this.connectedTo.filter(c => c.dest !== dest);
    }
  }
}

function createFullMockCtx(sampleRate = 48000) {
  return {
    sampleRate,
    currentTime: 0,
    state: 'running',
    destination: new MockAudioNode('destination'),
    createGain: () => {
      const g = new MockAudioNode('gain');
      g.gain = new MockAudioParam(1.0);
      return g;
    },
    createDelay: (maxDelay = 1.0) => {
      const d = new MockAudioNode('delay');
      d.delayTime = new MockAudioParam(0.0);
      d.maxDelay = maxDelay;
      return d;
    },
    createBiquadFilter: () => {
      const f = new MockAudioNode('biquad');
      f.type = 'lowpass';
      f.frequency = new MockAudioParam(1000);
      f.Q = new MockAudioParam(1.0);
      return f;
    },
    createWaveShaper: () => {
      const w = new MockAudioNode('waveshaper');
      w.curve = null;
      w.oversample = 'none';
      return w;
    },
    createChannelSplitter: (channels = 2) => {
      const s = new MockAudioNode('splitter');
      s.numberOfOutputs = channels;
      return s;
    },
    createChannelMerger: (channels = 2) => {
      const m = new MockAudioNode('merger');
      m.numberOfInputs = channels;
      return m;
    },
    createBufferSource: () => {
      const src = new MockAudioNode('bufferSource');
      src.buffer = null;
      src.loop = false;
      src.start = () => {};
      src.stop = () => {};
      return src;
    },
    createBuffer: (channels, length, sRate) => {
      const data = [];
      for (let c = 0; c < channels; c++) {
        data.push(new Float32Array(length));
      }
      return {
        numberOfChannels: channels,
        length,
        sampleRate: sRate,
        getChannelData: (idx) => data[idx]
      };
    },
    createConvolver: () => {
      const c = new MockAudioNode('convolver');
      c.normalize = true;
      c.buffer = null;
      return c;
    },
    createStereoPanner: () => {
      const p = new MockAudioNode('stereopanner');
      p.pan = new MockAudioParam(0.0);
      return p;
    },
    createDynamicsCompressor: () => {
      const comp = new MockAudioNode('compressor');
      comp.threshold = new MockAudioParam(-24);
      comp.knee = new MockAudioParam(30);
      comp.ratio = new MockAudioParam(12);
      comp.attack = new MockAudioParam(0.003);
      comp.release = new MockAudioParam(0.25);
      return comp;
    },
    createAnalyser: () => {
      const a = new MockAudioNode('analyser');
      a.fftSize = 2048;
      a.smoothingTimeConstant = 0.8;
      return a;
    },
    createOscillator: () => {
      const osc = new MockAudioNode('oscillator');
      osc.type = 'sine';
      osc.frequency = new MockAudioParam(440);
      osc.detune = new MockAudioParam(0);
      osc.start = () => {};
      osc.stop = () => {};
      osc.setPeriodicWave = () => {};
      return osc;
    },
    createPeriodicWave: () => ({}),
    resume: async () => {},
    suspend: async () => {}
  };
}

describe('Modernized Shimmer Reverb & Low-End Decoupling', () => {

  describe('1. Pitch Shifting: Constant-Amplitude Hann Raised-Cosine Windows', () => {
    it('guarantees exact constant-amplitude window summation (sin^2(phi1) + sin^2(phi2) = 1.0) with zero 22.2 Hz throb', () => {
      const ctx = createFullMockCtx(48000);
      const reverb = new ShimmerReverb(ctx);

      // Verify Left channel modulation buffer
      assert.ok(reverb.gainModBuffer, 'Left gainModBuffer must exist');
      const gainL1 = reverb.gainModBuffer.getChannelData(0);
      const gainL2 = reverb.gainModBuffer.getChannelData(1);
      const numSamplesL = gainL1.length;

      let maxDevL = 0;
      for (let i = 0; i < numSamplesL; i++) {
        const sum = gainL1[i] + gainL2[i];
        const dev = Math.abs(sum - 1.0);
        if (dev > maxDevL) maxDevL = dev;
      }
      assert.ok(maxDevL < 1e-6, `Left channel gain crossfade sum must equal 1.0 at every sample (max deviation was ${maxDevL})`);

      // Verify Right channel gain mod source and buffer
      assert.ok(reverb.gainModSourceR, 'Right gainModSourceR must exist');
      const gainBufferR = reverb.gainModSourceR.buffer;
      assert.ok(gainBufferR, 'Right gain buffer must exist');
      const gainR1 = gainBufferR.getChannelData(0);
      const gainR2 = gainBufferR.getChannelData(1);
      const numSamplesR = gainR1.length;

      let maxDevR = 0;
      for (let i = 0; i < numSamplesR; i++) {
        const sum = gainR1[i] + gainR2[i];
        const dev = Math.abs(sum - 1.0);
        if (dev > maxDevR) maxDevR = dev;
      }
      assert.ok(maxDevR < 1e-6, `Right channel gain crossfade sum must equal 1.0 at every sample (max deviation was ${maxDevR})`);
    });
  });

  describe('2. True Stereo Shimmer Paths & Metallic Ringing Prevention', () => {
    it('instantiates true stereo pitch shifting network with distinct Left and Right delay lines and bandpass filters', () => {
      const ctx = createFullMockCtx(48000);
      const reverb = new ShimmerReverb(ctx);

      // Verify distinct Left and Right bandpass filters
      assert.ok(reverb.shimmerFilterL, 'shimmerFilterL must exist');
      assert.ok(reverb.shimmerFilterR, 'shimmerFilterR must exist');
      assert.notStrictEqual(reverb.shimmerFilterL, reverb.shimmerFilterR, 'Left and Right bandpass filters must be distinct nodes');
      assert.strictEqual(reverb.shimmerFilterL.type, 'bandpass');
      assert.strictEqual(reverb.shimmerFilterR.type, 'bandpass');
      assert.strictEqual(reverb.shimmerFilterL.frequency.value, 1600);
      assert.strictEqual(reverb.shimmerFilterR.frequency.value, 1600);
      assert.strictEqual(reverb.shimmerFilterL.Q.value, 0.85);
      assert.strictEqual(reverb.shimmerFilterR.Q.value, 0.85);

      // Verify distinct Left and Right pitch shift delay lines
      assert.ok(reverb.psDelay1L, 'psDelay1L must exist');
      assert.ok(reverb.psDelay2L, 'psDelay2L must exist');
      assert.ok(reverb.psDelay1R, 'psDelay1R must exist');
      assert.ok(reverb.psDelay2R, 'psDelay2R must exist');
      assert.notStrictEqual(reverb.psDelay1L, reverb.psDelay1R);
      assert.notStrictEqual(reverb.psDelay2L, reverb.psDelay2R);

      // Verify detuned prime pre-delay / dispersion taps to eliminate metallic ringing
      assert.ok(reverb.shimmerPreDelayL, 'shimmerPreDelayL must exist');
      assert.ok(reverb.shimmerPreDelayR, 'shimmerPreDelayR must exist');
      assert.strictEqual(reverb.shimmerPreDelayL.delayTime.value, 0.0053, 'Left prime pre-delay tap must be 5.3 ms');
      assert.strictEqual(reverb.shimmerPreDelayR.delayTime.value, 0.0079, 'Right prime pre-delay tap must be 7.9 ms');

      // Verify incommensurate window lengths between Left (43.5ms) and Right (48.5ms)
      assert.ok(reverb.delayModBuffer, 'Left delay buffer must exist');
      assert.ok(reverb.delayModSourceR && reverb.delayModSourceR.buffer, 'Right delay buffer must exist');
      const lenL = reverb.delayModBuffer.length;
      const lenR = reverb.delayModSourceR.buffer.length;
      assert.strictEqual(lenL, Math.floor(0.0435 * 48000), 'Left window must be 43.5ms (~2088 samples)');
      assert.strictEqual(lenR, Math.floor(0.0485 * 48000), 'Right window must be 48.5ms (~2328 samples)');
      assert.notStrictEqual(lenL, lenR, 'Left and Right windows must be incommensurate to eliminate modal pitch-whistle');
    });

    it('implements stereo recombination with 85% direct and 15% cross-feed matrix without mono-collapsing', () => {
      const ctx = createFullMockCtx(48000);
      const reverb = new ShimmerReverb(ctx);

      assert.ok(reverb.shimmerMerger, 'shimmerMerger must exist');
      assert.ok(reverb.shimmerDirectL, 'shimmerDirectL must exist');
      assert.ok(reverb.shimmerDirectR, 'shimmerDirectR must exist');
      assert.ok(reverb.shimmerCrossL, 'shimmerCrossL must exist');
      assert.ok(reverb.shimmerCrossR, 'shimmerCrossR must exist');

      assert.strictEqual(reverb.shimmerDirectL.gain.value, 0.85);
      assert.strictEqual(reverb.shimmerDirectR.gain.value, 0.85);
      assert.strictEqual(reverb.shimmerCrossL.gain.value, 0.15);
      assert.strictEqual(reverb.shimmerCrossR.gain.value, 0.15);

      // Verify merger connection to pitchShiftOutput
      const mergerConns = reverb.shimmerMerger.connectedTo.map(c => c.dest);
      assert.ok(mergerConns.includes(reverb.pitchShiftOutput), 'shimmerMerger must connect to pitchShiftOutput');
    });
  });

  describe('3. Smooth C1 Hermite Knee Saturation & Limiting', () => {
    it('instantiates smooth C1 Hermite knee limiters in both Left and Right shimmer paths', () => {
      const ctx = createFullMockCtx(48000);
      const reverb = new ShimmerReverb(ctx);

      assert.ok(reverb.shimmerLimiterL, 'shimmerLimiterL must exist');
      assert.ok(reverb.shimmerLimiterR, 'shimmerLimiterR must exist');
      assert.ok(reverb.shimmerLimiterL.curve instanceof Float32Array);
      assert.ok(reverb.shimmerLimiterR.curve instanceof Float32Array);
      assert.strictEqual(reverb.shimmerLimiterL.curve.length, 2048);

      // Verify maximum bound <= 0.85001
      let maxL = 0;
      for (let i = 0; i < reverb.shimmerLimiterL.curve.length; i++) {
        maxL = Math.max(maxL, Math.abs(reverb.shimmerLimiterL.curve[i]));
      }
      assert.ok(maxL <= 0.85001, `Shimmer limiter maximum must be <= 0.85 (got ${maxL})`);
      assert.ok(maxL >= 0.84, `Shimmer limiter maximum should reach ~0.85 (got ${maxL})`);
    });

    it('verifies makeShimmerLimiterCurve exhibits exact unity small-signal gain and C1 derivative glides to 0', () => {
      const curve = makeShimmerLimiterCurve(2048, 0.85, 0.70);
      const half = 1023.5;

      // Check small signal at x = 0.20 (within linear knee where |x| <= 0.70 * 0.85 = 0.595)
      // Index for x = 0.20:
      const idx20 = Math.round(half + 0.20 * half);
      const val20 = curve[idx20];
      assert.ok(Math.abs(val20 - 0.20) < 0.002, `Small signal at 0.20 must have unity gain (got ${val20})`);

      // Check endpoints: |f(1.0)| == 0.85
      const rightEnd = curve[2047];
      assert.ok(Math.abs(rightEnd - 0.85) < 0.001, `Endpoint at +1.0 must be 0.85 (got ${rightEnd})`);

      // Check endpoint derivative: slope at endpoint must glide smoothly to 0
      const slopeAtEnd = Math.abs(curve[2047] - curve[2046]);
      assert.ok(slopeAtEnd < 0.0001, `Slope at boundary must be ~0 (got ${slopeAtEnd})`);
    });
  });

  describe('4. Low-End Decoupling (<120 Hz) & Sub-Bass Centering', () => {
    it('decouples sub-bass frequencies (<120 Hz) from the reverb tank using cascaded Butterworth highpass filters', async () => {
      const ctx = createFullMockCtx(48000);
      const engine = new AudioEngine(ctx);
      await engine.init();

      // Verify dedicated 120 Hz highpass filter on drone reverb send
      assert.ok(engine.droneReverbHpFilter1, 'droneReverbHpFilter1 must exist');
      assert.ok(engine.droneReverbHpFilter2, 'droneReverbHpFilter2 must exist');
      assert.strictEqual(engine.droneReverbHpFilter1.type, 'highpass');
      assert.strictEqual(engine.droneReverbHpFilter2.type, 'highpass');
      assert.strictEqual(engine.droneReverbHpFilter1.frequency.value, 120);
      assert.strictEqual(engine.droneReverbHpFilter2.frequency.value, 120);
      assert.ok(Math.abs(engine.droneReverbHpFilter1.Q.value - 0.7071) < 0.001);
      assert.ok(Math.abs(engine.droneReverbHpFilter2.Q.value - 0.7071) < 0.001);

      // Verify cascading: filter1 -> filter2 -> shimmerReverb.input
      const f1Conns = engine.droneReverbHpFilter1.connectedTo.map(c => c.dest);
      assert.ok(f1Conns.includes(engine.droneReverbHpFilter2), 'droneReverbHpFilter1 must connect to droneReverbHpFilter2');
      const f2Conns = engine.droneReverbHpFilter2.connectedTo.map(c => c.dest);
      assert.ok(f2Conns.includes(engine.shimmerReverb.input), 'droneReverbHpFilter2 must connect to shimmerReverb.input');

      // Verify drone gate source connects to reverb send filter (NOT directly to shimmerReverb.input)
      const gateConns = engine.droneGateNode.connectedTo.map(c => c.dest);
      assert.ok(gateConns.includes(engine.droneReverbHpFilter1), 'droneGateNode must connect to droneReverbHpFilter1');
      assert.ok(!gateConns.includes(engine.shimmerReverb.input), 'droneGateNode must NOT connect directly to shimmerReverb.input without highpass filter');
    });

    it('centers stereo panner in sub-bass mode to keep sub-bass frequencies tight and centered', () => {
      const ctx = createFullMockCtx(48000);
      const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

      // Default Voice 1 is panned -0.45
      assert.strictEqual(drone.pan, -0.45);

      // Engage sub-bass mode
      drone.setSubBass(true);
      assert.strictEqual(drone.isSubBass, true);
      assert.strictEqual(drone.pan, 0.0, 'Panner must center to 0.0 in sub-bass mode');
      assert.strictEqual(drone.panner.pan.value, 0.0, 'AudioParam panner.pan must be 0.0');

      // Release sub-bass mode
      drone.setSubBass(false);
      assert.strictEqual(drone.isSubBass, false);
      assert.strictEqual(drone.pan, -0.45, 'Panner must restore to -0.45 when leaving sub-bass mode');
      assert.strictEqual(drone.panner.pan.value, -0.45);
    });

    it('integrates 120 Hz M/S Elliptical Filter on Drone Bus to keep sub-bass centered without phase smearing', async () => {
      const ctx = createFullMockCtx(48000);
      const engine = new AudioEngine(ctx);
      await engine.init();

      assert.ok(engine.droneEllipticalSplitter, 'droneEllipticalSplitter must exist');
      assert.ok(engine.droneEllipticalMerger, 'droneEllipticalMerger must exist');
      assert.ok(engine.droneSideHp1, 'droneSideHp1 must exist');
      assert.ok(engine.droneSideHp2, 'droneSideHp2 must exist');
      assert.strictEqual(engine.droneSideHp1.type, 'highpass');
      assert.strictEqual(engine.droneSideHp1.frequency.value, 120);
      assert.strictEqual(engine.droneSideHp2.type, 'highpass');
      assert.strictEqual(engine.droneSideHp2.frequency.value, 120);
    });
  });

});
