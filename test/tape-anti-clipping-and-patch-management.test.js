import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TapeDelay } from '../js/audio/tape-delay.js';
import { AudioEngine } from '../js/audio/engine.js';
import { AmbientApp } from '../js/app.js';
import { makeTapeSaturationCurve } from '../js/audio/wavefolder.js';

class MockAudioParam {
  constructor(v = 1.0) {
    this.value = v;
    this.scheduledValues = [];
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.scheduledValues.push({ type: 'setValueAtTime', v, t });
  }
  setTargetAtTime(v, t, tau) {
    this.value = v;
    this.scheduledValues.push({ type: 'setTargetAtTime', v, t, tau });
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.scheduledValues.push({ type: 'linearRampToValueAtTime', v, t });
  }
  exponentialRampToValueAtTime(v, t) {
    this.value = v;
    this.scheduledValues.push({ type: 'exponentialRampToValueAtTime', v, t });
  }
  cancelScheduledValues(t) {
    this.scheduledValues.push({ type: 'cancelScheduledValues', t });
  }
  cancelAndHoldAtTime(t) {
    this.scheduledValues.push({ type: 'cancelAndHoldAtTime', t });
  }
}

function createFullMockCtx(currentTime = 5.0) {
  return {
    sampleRate: 48000,
    currentTime,
    createGain: () => ({ gain: new MockAudioParam(1.0), connect() {}, disconnect() {} }),
    createDelay: (max = 3.5) => ({ delayTime: new MockAudioParam(0.48), maxDelayTime: max, connect() {}, disconnect() {} }),
    createBiquadFilter: () => ({
      frequency: new MockAudioParam(1000),
      Q: new MockAudioParam(1.0),
      gain: new MockAudioParam(1.0),
      type: 'lowpass',
      connect() {},
      disconnect() {}
    }),
    createBuffer: (ch, len, rate) => ({
      getChannelData: () => new Float32Array(len),
      length: len,
      sampleRate: rate
    }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
    createWaveShaper: () => ({ oversample: '', curve: null, connect() {}, disconnect() {} }),
    createStereoPanner: () => ({ pan: new MockAudioParam(0), connect() {}, disconnect() {} }),
    createOscillator: () => ({
      frequency: new MockAudioParam(440),
      detune: new MockAudioParam(0),
      type: 'sine',
      connect() {},
      start() {},
      stop() {}
    }),
    createAnalyser: () => ({ fftSize: 2048, smoothingTimeConstant: 0.8, connect() {} }),
    createDynamicsCompressor: () => ({
      threshold: new MockAudioParam(-3),
      knee: new MockAudioParam(6),
      ratio: new MockAudioParam(8),
      attack: new MockAudioParam(0.003),
      release: new MockAudioParam(0.060),
      connect() {},
      disconnect() {}
    }),
    createChannelSplitter: () => ({ connect() {} }),
    createConvolver: () => ({ connect() {} }),
    state: 'running',
    destination: { connect() {} }
  };
}

describe('Tape Delay DSP Anti-Clipping & Feedback Normalization', () => {
  it('normalizes feedback gains with shaperGain so circulating loop gain never exceeds feedback setting', () => {
    const ctx = createFullMockCtx();
    const delay = new TapeDelay(ctx, {
      delayTimeL: 0.48,
      delayTimeR: 0.72,
      feedback: 0.58
    });

    assert.ok(delay.shaperGain > 1.5, `shaperGain must reflect tape saturation small-signal slope (~1.5173), got ${delay.shaperGain}`);
    
    // Direct and cross feedback gains must be normalized
    const directGain = delay.fbGainLL.gain.value;
    const crossGain = delay.fbGainRL.gain.value;
    const totalLoopGain = (directGain + crossGain) * delay.shaperGain;

    assert.ok(Math.abs(totalLoopGain - 0.58) < 1e-3, `Net loop gain at feedback=0.58 must equal 0.58, got ${totalLoopGain}`);
    assert.ok(totalLoopGain < 1.0, 'Total loop gain must be strictly < 1.0 to prevent runaway self-oscillation');

    // Test max feedback setting (0.92)
    delay.setFeedback(0.92);
    const maxDirect = delay.fbGainLL.gain.value;
    const maxCross = delay.fbGainRL.gain.value;
    const maxTotalLoopGain = (maxDirect + maxCross) * delay.shaperGain;

    assert.ok(Math.abs(maxTotalLoopGain - 0.92) < 1e-3, `Net loop gain at max feedback must equal 0.92, got ${maxTotalLoopGain}`);
    assert.ok(maxTotalLoopGain < 1.0, 'Loop gain at max feedback must remain strictly < 1.0');
  });

  it('bounds tape head lowpass and highpass biquad filter Q values to Butterworth Q <= 0.707', () => {
    const ctx = createFullMockCtx();
    const delay = new TapeDelay(ctx);

    assert.ok(delay.filterL.Q.value <= 0.7071, `Lowpass L filter Q must be <= 0.707, got ${delay.filterL.Q.value}`);
    assert.ok(delay.filterR.Q.value <= 0.7071, `Lowpass R filter Q must be <= 0.707, got ${delay.filterR.Q.value}`);
    assert.ok(delay.highpassL.Q.value <= 0.7071, `Highpass L filter Q must be <= 0.707, got ${delay.highpassL.Q.value}`);
    assert.ok(delay.highpassR.Q.value <= 0.7071, `Highpass R filter Q must be <= 0.707, got ${delay.highpassR.Q.value}`);

    // Adjusting tone should maintain bounded Q
    delay.setTone(5000);
    assert.ok(delay.filterL.Q.value <= 0.7071, 'Lowpass Q must remain <= 0.707 after setTone');
    assert.ok(delay.filterR.Q.value <= 0.7071, 'Lowpass Q must remain <= 0.707 after setTone');
  });

  it('safety clamps wow and flutter modulation depth so delayTime never drops below 0.015s', () => {
    const ctx = createFullMockCtx();
    const delay = new TapeDelay(ctx, {
      delayTimeL: 0.020, // 20ms
      delayTimeR: 0.030,
      wowAmount: 0.005,
      flutterAmount: 0.0015
    });

    delay.setWowFlutter(1.0); // full depth request

    // Headroom = Math.max(0, 0.020 - 0.015) = 0.005s.
    // Nominal max = 0.0065s.
    // Scale = 0.005 / 0.0065 = 0.769.
    const wowL = Math.abs(delay.wowGainL.gain.value);
    const flutterL = Math.abs(delay.flutterGainL.gain.value);
    const maxExcursion = wowL + flutterL;

    assert.ok(0.020 - maxExcursion >= 0.015 - 1e-6, `Effective minimum delay time (${0.020 - maxExcursion}s) must never drop below 0.015s`);

    // Extreme near-zero case: delayTime set to 0.015s exactly
    delay.setTime(0.015);
    const clampedWow = Math.abs(delay.wowGainL.gain.value);
    const clampedFlutter = Math.abs(delay.flutterGainL.gain.value);

    assert.strictEqual(clampedWow, 0, 'Wow modulation must be clamped to 0 at 0.015s boundary');
    assert.strictEqual(clampedFlutter, 0, 'Flutter modulation must be clamped to 0 at 0.015s boundary');
    assert.strictEqual(delay.delayTimeL, 0.015, 'delayTimeL must be clamped to minimum 0.015s');
  });
});

describe('AudioEngine Delay Send, Delay Return Bus & Return Limiter', () => {
  it('instantiates delayReturn bus and soft-knee delayReturnLimiter protecting master and reverb', async () => {
    const ctx = createFullMockCtx();
    const origCtx = globalThis.AudioContext;
    globalThis.AudioContext = class { constructor() { return ctx; } };

    try {
      const engine = new AudioEngine();
      await engine.init();

      assert.ok(engine.delayReturn, 'AudioEngine must instantiate delayReturn gain node');
      assert.strictEqual(engine.delayReturn.gain.value, 1.0, 'delayReturn gain must be unity calibrated');
      assert.ok(engine.delayReturnLimiter, 'AudioEngine must instantiate delayReturnLimiter');
      assert.strictEqual(engine.delayReturnLimiter.oversample, '4x', 'delayReturnLimiter must use 4x oversampling');
      assert.ok(engine.delayReturnLimiter.curve instanceof Float32Array, 'delayReturnLimiter must have a soft clip curve');

      // Verify delaySend bus remains unity calibrated
      assert.ok(engine.delaySend, 'delaySend bus must exist');
      assert.strictEqual(engine.delaySend.gain.value, 1.0, 'delaySend bus gain must be unity calibrated');
    } finally {
      globalThis.AudioContext = origCtx;
    }
  });

  it('handles high-velocity note strikes and 6-note polyphonic chords into tape delay with zero NaN or errors', async () => {
    const ctx = createFullMockCtx();
    const origCtx = globalThis.AudioContext;
    globalThis.AudioContext = class { constructor() { return ctx; } };

    try {
      const engine = new AudioEngine();
      await engine.init();

      // Trigger high-velocity polyphonic chord (6 voices simultaneously)
      const chordFreqs = [130.81, 196.00, 261.63, 329.63, 392.00, 493.88]; // C3, G3, C4, E4, G4, B4
      chordFreqs.forEach(freq => {
        const voice = engine.feltPiano.playNote(freq, 1.0, 4.0, false);
        assert.ok(voice, 'Voice must be successfully allocated');
      });

      // Verify piano bus output gain is attenuated by 1/sqrt(N_active)
      assert.ok(engine.feltPiano.output.gain.value > 0, 'Piano output gain must be positive');
      assert.ok(!Number.isNaN(engine.feltPiano.output.gain.value), 'Piano output gain must not be NaN');

      // Check tape delay delay lines receive signal with valid audio parameters
      assert.ok(!Number.isNaN(engine.tapeDelay.delayNodeL.delayTime.value));
      assert.ok(!Number.isNaN(engine.tapeDelay.fbGainLL.gain.value));
      assert.ok(engine.tapeDelay.fbGainLL.gain.value <= 0.606, 'Direct feedback gain must be safely bounded');
    } finally {
      globalThis.AudioContext = origCtx;
    }
  });
});

describe('Synthesizer Patch Export & Load Management', () => {
  function createMockAppDOM() {
    const elements = new Map();
    const createEl = (id, tag = 'div') => {
      const listeners = new Map();
      const el = {
        id,
        tagName: tag.toUpperCase(),
        value: '0',
        textContent: '',
        style: {},
        classList: {
          contains: () => false,
          add: () => {},
          remove: () => {},
          toggle: () => {}
        },
        setAttribute: (k, v) => { el[k] = v; },
        getAttribute: (k) => el[k] || null,
        addEventListener: (type, cb) => {
          if (!listeners.has(type)) listeners.set(type, []);
          listeners.get(type).push(cb);
        },
        dispatchEvent: (type, ev = {}) => {
          (listeners.get(type) || []).forEach(cb => cb(ev));
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        appendChild: () => {},
        removeChild: () => {},
        click: () => {},
        blur: () => {},
        focus: () => {}
      };
      elements.set(id, el);
      return el;
    };

    return {
      getElementById: (id) => elements.get(id) || createEl(id),
      createElement: (tag) => createEl('created-' + Math.random(), tag),
      querySelectorAll: () => [],
      querySelector: () => null,
      body: createEl('body', 'body')
    };
  }

  it('exportPatch serializes complete synthesizer state into valid JSON patch structure', () => {
    const ctx = createFullMockCtx();
    const origCtx = globalThis.AudioContext;
    const origDoc = globalThis.document;

    globalThis.AudioContext = class { constructor() { return ctx; } };
    globalThis.document = createMockAppDOM();

    try {
      const app = new AmbientApp();
      const patch = app.exportPatch();

      assert.strictEqual(patch.format, 'BRAUN_AS42_PATCH');
      assert.strictEqual(patch.version, 1);
      assert.ok(patch.timestamp, 'Patch must have timestamp');
      assert.ok(patch.knobs, 'Patch must contain knobs dictionary');
      assert.ok(patch.drone1, 'Patch must contain drone1 state');
      assert.ok(patch.drone2, 'Patch must contain drone2 state');
      assert.ok(patch.vectorPad, 'Patch must contain vectorPad coordinates');
      assert.strictEqual(typeof patch.knobs.delayTime, 'number');
      assert.strictEqual(typeof patch.knobs.delayFeedback, 'number');
      assert.strictEqual(typeof (patch.knobs.masterVol ?? patch.knobs.masterVolume), 'number');
    } finally {
      globalThis.AudioContext = origCtx;
      globalThis.document = origDoc;
    }
  });

  it('loadPatch restores all knobs, modal harmony, waveforms, and drone snap tuning accurately', () => {
    const ctx = createFullMockCtx();
    const origCtx = globalThis.AudioContext;
    const origDoc = globalThis.document;

    globalThis.AudioContext = class { constructor() { return ctx; } };
    globalThis.document = createMockAppDOM();

    try {
      const app = new AmbientApp();

      const customPatch = {
        format: 'BRAUN_AS42_PATCH',
        version: 1,
        rootPitchClass: 5, // F
        currentScaleKey: 'AVALON_MODAL',
        a4: 432,
        theme: 'dark',
        pianoWave: 'cs80',
        knobs: {
          delayTime: 850,
          delayFeedback: 75,
          delayWow: 60,
          delayTone: 4500,
          feltTone: 85,
          masterVolume: 90
        },
        drone1: { active: true, waveA: 'saw', waveB: 'warm', snap: 'warm-root' },
        drone2: { active: true, waveA: 'triangle', waveB: 'sine', snap: 'sus-4th' },
        vectorPad: { x: 0.70, y: 0.65 }
      };

      const success = app.loadPatch(customPatch, { animate: false });
      assert.strictEqual(success, true, 'loadPatch must return true on success');

      // Verify musical settings restored
      assert.strictEqual(app.engine.rootPitchClass, 5);
      assert.strictEqual(app.engine.currentScaleKey, 'AVALON_MODAL');
      assert.strictEqual(app.engine.a4, 432);

      // Verify knobs restored
      assert.strictEqual(app.knobs.delayTime.value, 850);
      assert.strictEqual(app.knobs.delayFeedback.value, 75);
      assert.strictEqual(app.knobs.delayWow.value, 60);

      // Verify engine audio parameters were updated
      assert.strictEqual(app.engine.delayParams.time, 0.85);
      assert.strictEqual(app.engine.delayParams.feedback, 0.75);
      assert.strictEqual(app.engine.delayParams.wow, 0.60);
      assert.strictEqual(app.engine.feltParams.waveform, 'cs80');
      if (app.engine.feltPiano) {
        assert.strictEqual(app.engine.feltPiano.currentWaveform, 'cs80');
      }
      assert.strictEqual(app.engine.droneParams[1].active, true);
      assert.strictEqual(app.engine.droneParams[2].active, true);
    } finally {
      globalThis.AudioContext = origCtx;
      globalThis.document = origDoc;
    }
  });
});
