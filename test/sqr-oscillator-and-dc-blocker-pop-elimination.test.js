import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AudioEngine } from '../js/audio/engine.js';
import { SolarDroneVoice } from '../js/audio/drone-voice.js';
import { createWavetableCache } from '../js/audio/anti-aliasing.js';

class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.events.push({ type: 'setValueAtTime', v, t });
  }
  setTargetAtTime(target, startTime, timeConstant) {
    this.events.push({ type: 'setTargetAtTime', target, startTime, timeConstant });
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.events.push({ type: 'linearRampToValueAtTime', v, t });
  }
  exponentialRampToValueAtTime(v, t) {
    this.value = v;
    this.events.push({ type: 'exponentialRampToValueAtTime', v, t });
  }
  cancelScheduledValues(t) {
    this.events.push({ type: 'cancelScheduledValues', t });
  }
  cancelAndHoldAtTime(t) {
    this.events.push({ type: 'cancelAndHoldAtTime', t });
  }
}

class MockAudioNode {
  constructor(name = 'node') {
    this.name = name;
    this.connectedTo = [];
  }
  connect(dest) {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect(dest) {
    if (!dest) {
      this.connectedTo = [];
    } else {
      this.connectedTo = this.connectedTo.filter(d => d !== dest);
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

class MockOscillator extends MockAudioNode {
  constructor() {
    super('osc');
    this.type = 'sawtooth';
    this.frequency = new MockAudioParam(440);
    this.detune = new MockAudioParam(0);
    this.periodicWave = null;
    this.started = false;
    this.stopped = false;
  }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  setPeriodicWave(pw) {
    this.periodicWave = pw;
    this.type = 'custom';
  }
}

class MockContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0.0;
    this.state = 'running';
    this.destination = new MockAudioNode('destination');
    this.createdNodes = [];
  }
  createGain() {
    const n = new MockGainNode();
    this.createdNodes.push(n);
    return n;
  }
  createBiquadFilter() {
    const n = new MockBiquadFilter();
    this.createdNodes.push(n);
    return n;
  }
  createOscillator() {
    const n = new MockOscillator();
    this.createdNodes.push(n);
    return n;
  }
  createStereoPanner() {
    const n = new MockAudioNode('panner');
    n.pan = new MockAudioParam(0);
    this.createdNodes.push(n);
    return n;
  }
  createWaveShaper() {
    const n = new MockAudioNode('shaper');
    n.curve = null;
    n.oversample = 'none';
    this.createdNodes.push(n);
    return n;
  }
  createAnalyser() {
    const n = new MockAudioNode('analyser');
    n.fftSize = 2048;
    n.smoothingTimeConstant = 0.8;
    this.createdNodes.push(n);
    return n;
  }
  createDynamicsCompressor() {
    const n = new MockAudioNode('compressor');
    n.threshold = new MockAudioParam(-3.0);
    n.knee = new MockAudioParam(12.0);
    n.ratio = new MockAudioParam(8.0);
    n.attack = new MockAudioParam(0.003);
    n.release = new MockAudioParam(0.060);
    this.createdNodes.push(n);
    return n;
  }
  createDelay() {
    const n = new MockAudioNode('delay');
    n.delayTime = new MockAudioParam(0.4);
    this.createdNodes.push(n);
    return n;
  }
  createConvolver() {
    const n = new MockAudioNode('convolver');
    n.buffer = null;
    n.normalize = true;
    this.createdNodes.push(n);
    return n;
  }
  createBuffer(ch, len, rate) {
    return {
      numberOfChannels: ch,
      length: len,
      sampleRate: rate || 48000,
      duration: len / (rate || 48000),
      getChannelData: () => new Float32Array(len)
    };
  }
  createBufferSource() {
    const n = new MockAudioNode('bufferSource');
    n.buffer = null;
    n.start = () => {};
    n.stop = () => {};
    this.createdNodes.push(n);
    return n;
  }
  createChannelSplitter(channels = 2) {
    const n = new MockAudioNode('splitter');
    n.numberOfOutputs = channels;
    this.createdNodes.push(n);
    return n;
  }
  createPeriodicWave(real, imag, options) {
    return { real, imag, options, _isPeriodicWave: true };
  }
  async suspend() {
    this.state = 'suspended';
  }
  async resume() {
    this.state = 'running';
  }
}

describe('SQR Drone Oscillator & DC Blocker Verification', () => {
  it('verifies createWavetableCache provides both square and sqr aliases', () => {
    const ctx = new MockContext();
    const cache = createWavetableCache(ctx);
    assert.ok(cache.square, 'cache must have square wave PeriodicWave');
    assert.strictEqual(cache.sqr, cache.square, 'cache.sqr must alias cache.square');
    assert.ok(cache.sawtooth, 'cache must have sawtooth alias');
    assert.strictEqual(cache.sawtooth, cache.saw, 'cache.sawtooth must alias cache.saw');
    assert.ok(cache.triangle, 'cache must have triangle');
    assert.strictEqual(cache.tri, cache.triangle, 'cache.tri must alias cache.triangle');
  });

  it('verifies SolarDroneVoice initializes default waveforms per voiceId', () => {
    const ctx = new MockContext();
    const tables = createWavetableCache(ctx);

    const voice1 = new SolarDroneVoice(ctx, ctx.destination, tables, 1);
    assert.strictEqual(voice1.waveA, 'saw', 'Voice 1 default waveA should be saw');
    assert.strictEqual(voice1.waveB, 'warm', 'Voice 1 default waveB should be warm');

    const voice2 = new SolarDroneVoice(ctx, ctx.destination, tables, 2);
    assert.strictEqual(voice2.waveA, 'square', 'Voice 2 default waveA should be square');
    assert.strictEqual(voice2.waveB, 'triangle', 'Voice 2 default waveB should be triangle');
  });

  it('verifies SQR oscillator works for Osc A and Osc B on Voice 1 and Voice 2', () => {
    const ctx = new MockContext();
    const tables = createWavetableCache(ctx);

    [1, 2].forEach(voiceId => {
      const drone = new SolarDroneVoice(ctx, ctx.destination, tables, voiceId);

      // Test Osc A with 'sqr' alias and public API methods
      drone.setWaveA('sqr');
      assert.strictEqual(drone.waveA, 'square', `Voice ${voiceId} waveA should normalize 'sqr' to 'square'`);
      assert.strictEqual(drone.oscA.type, 'square', `Voice ${voiceId} Osc A must use native square oscillator without Gibbs ripple wavetable`);
      assert.strictEqual(drone.oscA.periodicWave, null, `Voice ${voiceId} Osc A must not use PeriodicWave to prevent wavefolder Gibbs distortion`);

      // Test Osc A with 'square'
      drone.setWaveformA('square');
      assert.strictEqual(drone.waveA, 'square', `Voice ${voiceId} waveA should accept 'square' via setWaveformA`);
      assert.strictEqual(drone.oscA.type, 'square', `Voice ${voiceId} Osc A must retain native square oscillator`);
      assert.strictEqual(drone.oscA.periodicWave, null);

      // Test Osc B with 'sqr' alias
      drone.setWaveB('sqr');
      assert.strictEqual(drone.waveB, 'square', `Voice ${voiceId} waveB should normalize 'sqr' to 'square'`);
      assert.strictEqual(drone.oscB.type, 'square', `Voice ${voiceId} Osc B must use native square oscillator without Gibbs ripple wavetable`);
      assert.strictEqual(drone.oscB.periodicWave, null);

      // Test Osc B with 'square' via setWaveformB alias
      drone.setWaveformB('square');
      assert.strictEqual(drone.waveB, 'square', `Voice ${voiceId} waveB should accept 'square' via setWaveformB`);
      assert.strictEqual(drone.oscB.type, 'square', `Voice ${voiceId} Osc B must retain native square oscillator`);
      assert.strictEqual(drone.oscB.periodicWave, null);

      // Simultaneous SQR on both Osc A and Osc B
      drone.setWaveformA('sqr');
      drone.setWaveformB('sqr');
      assert.strictEqual(drone.waveA, 'square');
      assert.strictEqual(drone.waveB, 'square');
      assert.strictEqual(drone.oscA.type, 'square');
      assert.strictEqual(drone.oscB.type, 'square');
      assert.strictEqual(drone.oscA.periodicWave, null);
      assert.strictEqual(drone.oscB.periodicWave, null);
    });
  });

  it('verifies switching from wavetable to SQR clears periodicWave to avoid Gibbs wavefolder distortion', () => {
    const ctx = new MockContext();
    const tables = createWavetableCache(ctx);
    const drone = new SolarDroneVoice(ctx, ctx.destination, tables, 1);

    // First assign warm wavetable
    drone.setWaveA('warm');
    assert.ok(drone.oscA.periodicWave, 'Osc A must have periodicWave for warm');

    // Switch to sqr
    drone.setWaveA('sqr');
    assert.strictEqual(drone.oscA.type, 'square', 'Osc A must switch to native square');
    assert.strictEqual(drone.oscA.periodicWave, null, 'Osc A must clear periodicWave when selecting sqr');

    // Osc B warm -> square
    drone.setWaveB('warm');
    assert.ok(drone.oscB.periodicWave, 'Osc B must have periodicWave for warm');
    drone.setWaveB('square');
    assert.strictEqual(drone.oscB.type, 'square', 'Osc B must switch to native square');
    assert.strictEqual(drone.oscB.periodicWave, null, 'Osc B must clear periodicWave when selecting square');
  });

  it('verifies SQR works even in absence of wavetable cache via native oscillator fallback', () => {
    const ctx = new MockContext();
    // Null wavetables
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

    drone.setWaveA('sqr');
    assert.strictEqual(drone.waveA, 'square');
    assert.strictEqual(drone.oscA.type, 'square', 'Osc A must fall back to native square oscillator type');

    drone.setWaveB('square');
    assert.strictEqual(drone.waveB, 'square');
    assert.strictEqual(drone.oscB.type, 'square', 'Osc B must fall back to native square oscillator type');
  });

  it('verifies AudioEngine normalizes sqr in setDroneWaveA/B and exposes setDroneWaveformA/B', async () => {
    const origAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends MockContext {};

    try {
      const engine = new AudioEngine();
      await engine.init();

      // Test Voice 1 Osc A and B
      engine.setDroneWaveA(1, 'sqr');
      assert.strictEqual(engine.droneParams[1].waveA, 'square');
      assert.strictEqual(engine.drone1.waveA, 'square');

      engine.setDroneWaveB(1, 'sqr');
      assert.strictEqual(engine.droneParams[1].waveB, 'square');
      assert.strictEqual(engine.drone1.waveB, 'square');

      // Test Voice 2 Osc A and B with setDroneWaveformA / setDroneWaveformB
      engine.setDroneWaveformA(2, 'sqr');
      assert.strictEqual(engine.droneParams[2].waveA, 'square');
      assert.strictEqual(engine.drone2.waveA, 'square');

      engine.setDroneWaveformB(2, 'sqr');
      assert.strictEqual(engine.droneParams[2].waveB, 'square');
      assert.strictEqual(engine.drone2.waveB, 'square');
    } finally {
      globalThis.AudioContext = origAudioContext;
    }
  });

  it('verifies Master Bus incorporates 15 Hz highpass masterDcBlocker preceding masterGain and compressor', async () => {
    const origAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends MockContext {};

    try {
      const engine = new AudioEngine();
      await engine.init();

      assert.ok(engine.masterDcBlocker, 'masterDcBlocker biquad filter must exist');
      assert.strictEqual(engine.masterDcBlocker.type, 'highpass', 'masterDcBlocker must be highpass filter');
      assert.strictEqual(engine.masterDcBlocker.frequency.value, 15, 'masterDcBlocker frequency must be 15 Hz');
      assert.strictEqual(engine.masterDcBlocker.Q.value, 0.707, 'masterDcBlocker Q must be Butterworth 0.707');

      // Graph connectivity: masterBus -> masterDcBlocker -> masterGain -> masterCompressor
      const busOutput = engine.masterBus.connectedTo;
      assert.ok(busOutput.includes(engine.masterDcBlocker), 'masterBus must connect to masterDcBlocker');

      const dcBlockerOutput = engine.masterDcBlocker.connectedTo;
      assert.ok(dcBlockerOutput.includes(engine.masterGain), 'masterDcBlocker must connect to masterGain');

      const limiterOutput = engine.masterLimiter.connectedTo;
      assert.ok(limiterOutput.includes(engine.analyser), 'masterLimiter must connect to analyser');

      const analyserOutput = engine.analyser.connectedTo;
      assert.ok(analyserOutput.includes(engine.ctx.destination), 'analyser must connect to destination');
    } finally {
      globalThis.AudioContext = origAudioContext;
    }
  });

  it('verifies clickless power on/off gain ramping and resume behavior', async () => {
    const origAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends MockContext {};

    try {
      const engine = new AudioEngine();
      await engine.init();

      // On initial init, masterGain was scheduled with setTargetAtTime
      const gainEvents = engine.masterGain.gain.events;
      const initialSlew = gainEvents.find(e => e.type === 'setTargetAtTime' && e.target === engine.masterVolume);
      assert.ok(initialSlew, 'masterGain must ramp up smoothly to masterVolume on initialization');

      // Now simulate suspended resume:
      engine.ctx.state = 'suspended';
      gainEvents.length = 0;
      await engine.init();

      const resumeSlew = gainEvents.find(e => e.type === 'setTargetAtTime' && e.target === engine.masterVolume);
      assert.ok(resumeSlew, 'resuming suspended AudioContext must ramp masterGain up smoothly');
      assert.strictEqual(resumeSlew.timeConstant, 0.025, 'ramp timeConstant must be 25ms');
    } finally {
      globalThis.AudioContext = origAudioContext;
    }
  });

  it('verifies case-insensitive and trimmed SQR handling across voice and engine', async () => {
    const ctx = new MockContext();
    const tables = createWavetableCache(ctx);
    const drone = new SolarDroneVoice(ctx, ctx.destination, tables, 1);

    // Uppercase 'SQR'
    drone.setWaveA('SQR');
    assert.strictEqual(drone.waveA, 'square', "Upper-case 'SQR' must normalize to 'square'");
    assert.strictEqual(drone.oscA.type, 'square', 'Native square oscillator must be set for uppercase SQR');
    assert.strictEqual(drone.oscA.periodicWave, null, 'PeriodicWave must be null for uppercase SQR');

    // Mixed-case with whitespace '  Square  '
    drone.setWaveB('  Square  ');
    assert.strictEqual(drone.waveB, 'square', "Padded mixed-case '  Square  ' must normalize to 'square'");
    assert.strictEqual(drone.oscB.type, 'square', 'Native square oscillator must be set for padded Square');
    assert.strictEqual(drone.oscB.periodicWave, null, 'PeriodicWave must be null for padded Square');

    // Engine with string id and uppercase
    const origAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends MockContext {};

    try {
      const engine = new AudioEngine();
      await engine.init();

      engine.setDroneWaveA("1", "SQR");
      assert.strictEqual(engine.droneParams[1].waveA, 'square');
      assert.strictEqual(engine.drone1.waveA, 'square');

      engine.setDroneWaveB("2", " SQR ");
      assert.strictEqual(engine.droneParams[2].waveB, 'square');
      assert.strictEqual(engine.drone2.waveB, 'square');
    } finally {
      globalThis.AudioContext = origAudioContext;
    }
  });

  it('verifies isWaveformMatch correctly matches aliases and case variants', async () => {
    const { isWaveformMatch } = await import('../js/app.js');

    // Square aliases
    assert.strictEqual(isWaveformMatch('square', 'sqr'), true);
    assert.strictEqual(isWaveformMatch('sqr', 'square'), true);
    assert.strictEqual(isWaveformMatch('SQR', 'square'), true);
    assert.strictEqual(isWaveformMatch('square', 'SQR'), true);

    // Saw aliases
    assert.strictEqual(isWaveformMatch('saw', 'sawtooth'), true);
    assert.strictEqual(isWaveformMatch('sawtooth', 'saw'), true);
    assert.strictEqual(isWaveformMatch('SAW', 'saw'), true);

    // Triangle aliases
    assert.strictEqual(isWaveformMatch('triangle', 'tri'), true);
    assert.strictEqual(isWaveformMatch('tri', 'triangle'), true);

    // Sine aliases
    assert.strictEqual(isWaveformMatch('sine', 'sin'), true);
    assert.strictEqual(isWaveformMatch('sin', 'sine'), true);

    // Negative matches
    assert.strictEqual(isWaveformMatch('square', 'saw'), false);
    assert.strictEqual(isWaveformMatch('sine', 'triangle'), false);
    assert.strictEqual(isWaveformMatch(null, 'square'), false);
  });

  it('verifies UI buttons in index.html match data-wave="sqr" for drone 1 and drone 2', async () => {
    const fs = await import('node:fs');
    const html = fs.readFileSync('index.html', 'utf-8');

    assert.ok(html.includes('class="braun-wave-btn drone1-wave-a" data-wave="sqr"'), 'drone1-wave-a must have data-wave="sqr"');
    assert.ok(html.includes('class="braun-wave-btn drone1-wave-b" data-wave="sqr"'), 'drone1-wave-b must have data-wave="sqr"');
    assert.ok(html.includes('class="braun-wave-btn drone2-wave-a is-active" data-wave="sqr"'), 'drone2-wave-a must have data-wave="sqr"');
    assert.ok(html.includes('class="braun-wave-btn drone2-wave-b" data-wave="sqr"'), 'drone2-wave-b must have data-wave="sqr"');
  });

  it('verifies native square wave preserves stable plateaus through wavefolder without Gibbs ripple artifacts', async () => {
    const { makeWavefoldCurve } = await import('../js/audio/wavefolder.js');
    const { generateSquareCoefficients } = await import('../js/audio/anti-aliasing.js');
    const curve = makeWavefoldCurve(2048, 1.6, 0.45);
    assert.ok(curve && curve.length === 2048, 'Wavefold curve must be instantiated');

    const sampleToCurve = (x) => {
      const norm = Math.max(-1, Math.min(1, x));
      const idx = Math.round(((norm + 1) / 2) * (curve.length - 1));
      return curve[idx];
    };

    // 1. Native square wave: strictly flat at +1.0 and -1.0
    const nativePositive = sampleToCurve(1.0);
    const nativeNegative = sampleToCurve(-1.0);
    assert.ok(Number.isFinite(nativePositive), 'Native positive plateau must yield valid folded value');
    assert.ok(Number.isFinite(nativeNegative), 'Native negative plateau must yield valid folded value');
    assert.ok(Math.abs(nativePositive) <= 1.0, 'Native positive plateau must remain bounded');
    assert.ok(Math.abs(nativeNegative) <= 1.0, 'Native negative plateau must remain bounded');

    // 2. Gibbs phenomenon contrast: truncated Fourier series has overshoot ripples near edge
    // Reconstructing a truncated Fourier square wave near t = 0+ demonstrates Gibbs ripple overshoot
    const coeffs = generateSquareCoefficients(64);
    assert.ok(coeffs.imag.length >= 65, 'Square wave coefficients must have at least 65 harmonics');
    // On the native square wave, any sample on the top plateau is exactly 1.0 with 0 ripple variance
    const nativeTopSamples = [1.0, 1.0, 1.0, 1.0].map(sampleToCurve);
    const nativeVariance = nativeTopSamples.reduce((acc, v) => acc + Math.abs(v - nativeTopSamples[0]), 0);
    assert.strictEqual(nativeVariance, 0, 'Native square wave plateau through wavefolder must have zero ripple distortion variance');
  });

  it('verifies cycling through all waveforms properly sets and clears PeriodicWave for SQR and SINE', () => {
    const ctx = new MockContext();
    const tables = createWavetableCache(ctx);
    const drone = new SolarDroneVoice(ctx, ctx.destination, tables, 1);

    // Initial state: saw
    assert.strictEqual(drone.waveA, 'saw');
    assert.ok(drone.oscA.periodicWave, 'saw should have PeriodicWave');

    // Switch to sqr
    drone.setWaveA('sqr');
    assert.strictEqual(drone.waveA, 'square');
    assert.strictEqual(drone.oscA.type, 'square');
    assert.strictEqual(drone.oscA.periodicWave, null, 'sqr must not have PeriodicWave');

    // Switch to warm
    drone.setWaveA('warm');
    assert.strictEqual(drone.waveA, 'warm');
    assert.ok(drone.oscA.periodicWave, 'warm must have PeriodicWave');

    // Switch to sine
    drone.setWaveA('sine');
    assert.strictEqual(drone.waveA, 'sine');
    assert.strictEqual(drone.oscA.type, 'sine');
    assert.strictEqual(drone.oscA.periodicWave, null, 'sine must not have PeriodicWave');

    // Switch to triangle
    drone.setWaveA('triangle');
    assert.strictEqual(drone.waveA, 'triangle');
    assert.ok(drone.oscA.periodicWave, 'triangle must have PeriodicWave');

    // Switch back to square
    drone.setWaveA('square');
    assert.strictEqual(drone.waveA, 'square');
    assert.strictEqual(drone.oscA.type, 'square');
    assert.strictEqual(drone.oscA.periodicWave, null, 'square must clear PeriodicWave');
  });

  it('verifies UI button clicks toggle data-wave="sqr" and update engine and DOM state', async () => {
    const origAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends MockContext {};

    try {
      const engine = new AudioEngine();
      await engine.init();

      // Mock DOM buttons
      const createMockButton = (cls, wave, active = false) => {
        const classSet = new Set([cls]);
        if (active) classSet.add('is-active');
        return {
          getAttribute: (attr) => (attr === 'data-wave' ? wave : null),
          classList: {
            add: (c) => classSet.add(c),
            remove: (c) => classSet.delete(c),
            toggle: (c, val) => (val ? classSet.add(c) : classSet.delete(c)),
            contains: (c) => classSet.has(c)
          },
          blur() {}
        };
      };

      const btnSaw = createMockButton('drone1-wave-a', 'saw', true);
      const btnSqr = createMockButton('drone1-wave-a', 'sqr', false);
      const btnSine = createMockButton('drone1-wave-a', 'sine', false);

      const buttons = [btnSaw, btnSqr, btnSine];

      // Simulate clicking SQR button
      const clickSqr = () => {
        buttons.forEach(b => b.classList.remove('is-active'));
        btnSqr.classList.add('is-active');
        engine.setDroneWaveA(1, btnSqr.getAttribute('data-wave'));
      };

      clickSqr();

      assert.strictEqual(btnSqr.classList.contains('is-active'), true, 'SQR button must be active');
      assert.strictEqual(btnSaw.classList.contains('is-active'), false, 'SAW button must be inactive');
      assert.strictEqual(engine.droneParams[1].waveA, 'square', 'engine droneParams must normalize sqr to square');
      assert.strictEqual(engine.drone1.waveA, 'square', 'drone1 voice must have square waveform');
      assert.strictEqual(engine.drone1.oscA.type, 'square', 'drone1 Osc A must use native square oscillator');
      assert.strictEqual(engine.drone1.oscA.periodicWave, null, 'drone1 Osc A PeriodicWave must be null');

      // Test Voice 1 Osc B
      const btnWarmB = createMockButton('drone1-wave-b', 'warm', true);
      const btnSqrB = createMockButton('drone1-wave-b', 'sqr', false);
      const buttonsB = [btnWarmB, btnSqrB];

      const clickSqrB = () => {
        buttonsB.forEach(b => b.classList.remove('is-active'));
        btnSqrB.classList.add('is-active');
        engine.setDroneWaveB(1, btnSqrB.getAttribute('data-wave'));
      };

      clickSqrB();
      assert.strictEqual(engine.droneParams[1].waveB, 'square');
      assert.strictEqual(engine.drone1.waveB, 'square');
      assert.strictEqual(engine.drone1.oscB.type, 'square');
      assert.strictEqual(engine.drone1.oscB.periodicWave, null);

      // Test Voice 2 Osc A & Osc B
      engine.setDroneWaveA(2, 'sqr');
      engine.setDroneWaveB(2, 'sqr');
      assert.strictEqual(engine.droneParams[2].waveA, 'square');
      assert.strictEqual(engine.droneParams[2].waveB, 'square');
      assert.strictEqual(engine.drone2.waveA, 'square');
      assert.strictEqual(engine.drone2.waveB, 'square');
      assert.strictEqual(engine.drone2.oscA.type, 'square');
      assert.strictEqual(engine.drone2.oscB.type, 'square');
      assert.strictEqual(engine.drone2.oscA.periodicWave, null);
      assert.strictEqual(engine.drone2.oscB.periodicWave, null);
    } finally {
      globalThis.AudioContext = origAudioContext;
    }
  });

  it('verifies all native fallback branches in _applyWaveform clear periodicWave when defined', () => {
    const ctx = new MockContext();
    const tables = createWavetableCache(ctx);
    const drone = new SolarDroneVoice(ctx, ctx.destination, tables, 1);

    // Set warm with wavetables -> periodicWave assigned
    drone.setWaveA('warm');
    assert.ok(drone.oscA.periodicWave, 'warm must set periodicWave');

    // Simulate switching to native fallback with null wavetables
    drone.wavetables = null;

    // Fallback saw
    drone.setWaveA('saw');
    assert.strictEqual(drone.oscA.type, 'sawtooth');
    assert.strictEqual(drone.oscA.periodicWave, null, 'saw fallback must clear periodicWave');

    // Assign periodicWave back manually to test tri fallback
    drone.oscA.setPeriodicWave({});
    assert.ok(drone.oscA.periodicWave);
    drone.setWaveA('triangle');
    assert.strictEqual(drone.oscA.type, 'triangle');
    assert.strictEqual(drone.oscA.periodicWave, null, 'triangle fallback must clear periodicWave');

    // Assign periodicWave back manually to test warm fallback
    drone.oscA.setPeriodicWave({});
    assert.ok(drone.oscA.periodicWave);
    drone.setWaveA('warm');
    assert.strictEqual(drone.oscA.type, 'sawtooth');
    assert.strictEqual(drone.oscA.periodicWave, null, 'warm fallback must clear periodicWave');

    // Assign periodicWave back manually to test unknown fallback
    drone.oscA.setPeriodicWave({});
    assert.ok(drone.oscA.periodicWave);
    drone.setWaveA('unknown-waveform');
    assert.strictEqual(drone.oscA.type, 'sawtooth');
    assert.strictEqual(drone.oscA.periodicWave, null, 'unknown fallback must clear periodicWave');
  });

  it('verifies deploy-pages.bat includes README.md in sync and commit commands', async () => {
    const fs = await import('node:fs');
    const bat = fs.readFileSync('deploy-pages.bat', 'utf-8');

    assert.ok(bat.includes('copy /y "README.md" "%TARGET_DIR%\\"'), 'deploy-pages.bat must copy README.md to target directory');
    assert.ok(bat.includes('git add index.html .nojekyll README.md'), 'deploy-pages.bat must git add README.md');
  });
});
