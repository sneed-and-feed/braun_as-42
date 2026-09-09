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
      assert.ok(drone.oscA.periodicWave, `Voice ${voiceId} Osc A must have periodicWave assigned for sqr`);

      // Test Osc A with 'square'
      drone.setWaveformA('square');
      assert.strictEqual(drone.waveA, 'square', `Voice ${voiceId} waveA should accept 'square' via setWaveformA`);
      assert.ok(drone.oscA.periodicWave, `Voice ${voiceId} Osc A must retain periodicWave for square`);

      // Test Osc B with 'sqr' alias
      drone.setWaveB('sqr');
      assert.strictEqual(drone.waveB, 'square', `Voice ${voiceId} waveB should normalize 'sqr' to 'square'`);
      assert.ok(drone.oscB.periodicWave, `Voice ${voiceId} Osc B must have periodicWave assigned for sqr`);

      // Test Osc B with 'square' via setWaveformB alias
      drone.setWaveformB('square');
      assert.strictEqual(drone.waveB, 'square', `Voice ${voiceId} waveB should accept 'square' via setWaveformB`);
      assert.ok(drone.oscB.periodicWave, `Voice ${voiceId} Osc B must retain periodicWave for square`);

      // Simultaneous SQR on both Osc A and Osc B
      drone.setWaveformA('sqr');
      drone.setWaveformB('sqr');
      assert.strictEqual(drone.waveA, 'square');
      assert.strictEqual(drone.waveB, 'square');
      assert.ok(drone.oscA.periodicWave);
      assert.ok(drone.oscB.periodicWave);
    });
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

  it('verifies Master Bus incorporates 15 Hz highpass masterDcBlocker between limiter and analyser', async () => {
    const origAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends MockContext {};

    try {
      const engine = new AudioEngine();
      await engine.init();

      assert.ok(engine.masterDcBlocker, 'masterDcBlocker biquad filter must exist');
      assert.strictEqual(engine.masterDcBlocker.type, 'highpass', 'masterDcBlocker must be highpass filter');
      assert.strictEqual(engine.masterDcBlocker.frequency.value, 15, 'masterDcBlocker frequency must be 15 Hz');
      assert.strictEqual(engine.masterDcBlocker.Q.value, 0.707, 'masterDcBlocker Q must be Butterworth 0.707');

      // Graph connectivity: masterLimiter -> masterDcBlocker -> analyser -> destination
      const limiterOutput = engine.masterLimiter.connectedTo;
      assert.ok(limiterOutput.includes(engine.masterDcBlocker), 'masterLimiter must connect to masterDcBlocker');

      const dcBlockerOutput = engine.masterDcBlocker.connectedTo;
      assert.ok(dcBlockerOutput.includes(engine.analyser), 'masterDcBlocker must connect to analyser');

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
    assert.ok(drone.oscA.periodicWave, 'PeriodicWave must be set for uppercase SQR');

    // Mixed-case with whitespace '  Square  '
    drone.setWaveB('  Square  ');
    assert.strictEqual(drone.waveB, 'square', "Padded mixed-case '  Square  ' must normalize to 'square'");
    assert.ok(drone.oscB.periodicWave, 'PeriodicWave must be set for padded Square');

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
});
