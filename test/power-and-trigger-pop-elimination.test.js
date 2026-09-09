import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AudioEngine } from '../js/audio/engine.js';
import { FeltPianoVoice, FeltPianoSynthesizer } from '../js/audio/felt-piano.js';

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
  constructor(initGain = 1.0) {
    super('gain');
    this.gain = new MockAudioParam(initGain);
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
    this.started = false;
    this.stopped = false;
  }
  start() { this.started = true; }
  stop() { this.stopped = true; }
  setPeriodicWave(pw) { this.type = 'custom'; }
}

class MockContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 10.0;
    this.state = 'running';
    this.destination = new MockAudioNode('destination');
    this.suspended = false;
  }
  createGain() { return new MockGainNode(1.0); }
  createBiquadFilter() { return new MockBiquadFilter(); }
  createOscillator() { return new MockOscillator(); }
  createDelay() { return Object.assign(new MockAudioNode('delay'), { delayTime: new MockAudioParam(0.1) }); }
  createDynamicsCompressor() {
    return Object.assign(new MockAudioNode('compressor'), {
      threshold: new MockAudioParam(-3),
      knee: new MockAudioParam(6),
      ratio: new MockAudioParam(8),
      attack: new MockAudioParam(0.003),
      release: new MockAudioParam(0.06)
    });
  }
  createWaveShaper() { return Object.assign(new MockAudioNode('shaper'), { curve: null, oversample: '4x' }); }
  createStereoPanner() { return Object.assign(new MockAudioNode('panner'), { pan: new MockAudioParam(0) }); }
  createAnalyser() { return Object.assign(new MockAudioNode('analyser'), { fftSize: 2048, smoothingTimeConstant: 0.8 }); }
  createBuffer(ch, len, rate) { return { length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) }; }
  createBufferSource() { return Object.assign(new MockAudioNode('bufferSource'), { buffer: null, start() {}, stop() {} }); }
  createConvolver() { return Object.assign(new MockAudioNode('convolver'), { buffer: null }); }
  createChannelSplitter() { return new MockAudioNode('splitter'); }
  createChannelMerger() { return new MockAudioNode('merger'); }
  createPeriodicWave() { return {}; }
  async suspend() { this.state = 'suspended'; this.suspended = true; }
  async resume() { this.state = 'running'; this.suspended = false; }
}

describe('Drone Active Power On/Off Pop Elimination', () => {
  it('verifies powerOff smoothly ramps droneBus, pianoBus, and masterGain to 0.0 before suspend', async () => {
    const origAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends MockContext {};

    try {
      const engine = new AudioEngine();
      await engine.init();

      // Activate both drone voices
      engine.setDroneActive(1, true);
      engine.setDroneActive(2, true);
      assert.strictEqual(engine.drone1.isActive, true);
      assert.strictEqual(engine.drone2.isActive, true);

      // Clear previous init events
      engine.masterGain.gain.events = [];
      engine.droneBus.gain.events = [];
      engine.pianoBus.gain.events = [];

      // Execute powerOff with drones active
      await engine.powerOff();

      assert.strictEqual(engine.ctx.state, 'suspended', 'Context must be suspended after powerOff');

      // Verify masterGain ramped down smoothly to 0.0
      const masterRamp = engine.masterGain.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
      assert.ok(masterRamp, 'masterGain must have linearRampToValueAtTime to 0.0');

      // Verify droneBus ramped down smoothly to 0.0
      const droneRamp = engine.droneBus.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
      assert.ok(droneRamp, 'droneBus must have linearRampToValueAtTime to 0.0');

      // Verify pianoBus ramped down smoothly to 0.0
      const pianoRamp = engine.pianoBus.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
      assert.ok(pianoRamp, 'pianoBus must have linearRampToValueAtTime to 0.0');

      // Verify final clamping to strict 0.0 before suspend
      const masterZero = engine.masterGain.gain.events.filter(e => e.type === 'setValueAtTime' && e.v === 0.0);
      assert.ok(masterZero.length >= 1, 'masterGain must be clamped strictly to 0.0');

      const droneZero = engine.droneBus.gain.events.filter(e => e.type === 'setValueAtTime' && e.v === 0.0);
      assert.ok(droneZero.length >= 1, 'droneBus must be clamped strictly to 0.0');
    } finally {
      globalThis.AudioContext = origAudioContext;
    }
  });

  it('verifies resuming suspended AudioContext zeros all buses before resume and ramps them smoothly', async () => {
    const origAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends MockContext {};

    try {
      const engine = new AudioEngine();
      await engine.init();

      engine.setDroneActive(1, true);
      await engine.powerOff();

      assert.strictEqual(engine.ctx.state, 'suspended');

      // Clear events to inspect resume behavior
      engine.masterGain.gain.events = [];
      engine.droneBus.gain.events = [];
      engine.pianoBus.gain.events = [];

      // Resume via init()
      await engine.init();

      assert.strictEqual(engine.ctx.state, 'running');

      // Verify zeroing at suspendTime before audio thread wakes
      const masterPreZero = engine.masterGain.gain.events.find(e => e.type === 'setValueAtTime' && e.v === 0.0);
      assert.ok(masterPreZero, 'masterGain must be zeroed at suspendTime prior to resume');

      const dronePreZero = engine.droneBus.gain.events.find(e => e.type === 'setValueAtTime' && e.v === 0.0);
      assert.ok(dronePreZero, 'droneBus must be zeroed at suspendTime prior to resume');

      const pianoPreZero = engine.pianoBus.gain.events.find(e => e.type === 'setValueAtTime' && e.v === 0.0);
      assert.ok(pianoPreZero, 'pianoBus must be zeroed at suspendTime prior to resume');

      // Verify smooth exponential setTargetAtTime slew up to operating levels
      const masterSlew = engine.masterGain.gain.events.find(e => e.type === 'setTargetAtTime' && e.target === engine.masterVolume);
      assert.ok(masterSlew, 'masterGain must slew smoothly to masterVolume on resume');

      const droneSlew = engine.droneBus.gain.events.find(e => e.type === 'setTargetAtTime' && e.target === engine.droneBusGain);
      assert.ok(droneSlew, 'droneBus must slew smoothly to droneBusGain on resume');

      const pianoSlew = engine.pianoBus.gain.events.find(e => e.type === 'setTargetAtTime' && e.target === 1.0);
      assert.ok(pianoSlew, 'pianoBus must slew smoothly to unity on resume');
    } finally {
      globalThis.AudioContext = origAudioContext;
    }
  });
});

describe('Click-Free Note Trigger & Voice Amplitude Continuity', () => {
  it('verifies idle voice oscMixer starts at 0.0 and ramps to 1.0 on note trigger', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 2);
    const voice = synth.voices[0];

    assert.strictEqual(voice.oscMixer.gain.value, 0.0, 'Idle voice oscMixer must be initialized to 0.0');

    voice.oscMixer.gain.events = [];
    voice.trigger(440, 0.8, 2.0, synth.params, false);

    // Verify oscMixer ramps to 1.0 smoothly over the attack duration
    const mixerRamp = voice.oscMixer.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 1.0);
    assert.ok(mixerRamp, 'oscMixer.gain must ramp to 1.0 smoothly on attack');
  });

  it('verifies voice stealing ramps oscMixer and voiceGain to 0 before retuning oscillators', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 2);
    const voice = synth.voices[0];

    // Strike note 1
    voice.trigger(261.63, 0.7, 4.0, synth.params, false);
    voice.voiceGain.gain.value = 0.22; // actively sounding

    // Trigger note 2 on the same voice while sounding (stealing)
    voice.voiceGain.gain.events = [];
    voice.oscMixer.gain.events = [];
    voice.osc1.frequency.events = [];

    const now = ctx.currentTime;
    voice.trigger(523.25, 0.8, 4.0, synth.params, false);

    // Verify voiceGain de-click ramp to 0.0001
    const declickGain = voice.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0001);
    assert.ok(declickGain, 'voiceGain must ramp to 0.0001 over declick period');

    // Verify oscMixer de-click ramp to 0.0
    const declickMixer = voice.oscMixer.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
    assert.ok(declickMixer, 'oscMixer must ramp to 0.0 over declick period');

    // Verify oscillator retuning happens at noteStartTime (5ms in the future), not immediately at cancelTime
    const oscRetune = voice.osc1.frequency.events.find(e => e.type === 'setValueAtTime' && e.v === 523.25);
    assert.ok(oscRetune, 'oscillator frequency must be updated');
    assert.ok(oscRetune.t >= now + 0.0049, 'Oscillator retuning must occur after de-click ramp to prevent phase clicks');
  });

  it('verifies voice release smoothly ramps both voiceGain and oscMixer to 0.0', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 2);
    const voice = synth.voices[0];

    voice.trigger(329.63, 0.75, 4.0, synth.params, true); // hold note

    voice.voiceGain.gain.events = [];
    voice.oscMixer.gain.events = [];

    voice.release();

    const gainRamp = voice.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
    assert.ok(gainRamp, 'voice.release() must ramp voiceGain to 0.0');

    const mixerRamp = voice.oscMixer.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
    assert.ok(mixerRamp, 'voice.release() must ramp oscMixer to 0.0');
  });
});
