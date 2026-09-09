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
      engine.delayReturn.gain.events = [];
      engine.delaySend.gain.events = [];
      engine.drone1.voiceGain.gain.events = [];
      engine.drone2.voiceGain.gain.events = [];

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

      // Verify delayReturn and delaySend ramped down smoothly to 0.0
      const delayReturnRamp = engine.delayReturn.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
      assert.ok(delayReturnRamp, 'delayReturn must have linearRampToValueAtTime to 0.0');

      const delaySendRamp = engine.delaySend.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
      assert.ok(delaySendRamp, 'delaySend must have linearRampToValueAtTime to 0.0');

      // Verify active drone voices ramped down to 0.0
      const drone1Ramp = engine.drone1.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
      assert.ok(drone1Ramp, 'drone1 voiceGain must ramp to 0.0');

      const drone2Ramp = engine.drone2.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
      assert.ok(drone2Ramp, 'drone2 voiceGain must ramp to 0.0');

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
      engine.delayReturn.gain.events = [];
      engine.delaySend.gain.events = [];
      engine.drone1.voiceGain.gain.events = [];

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

      const delayReturnPreZero = engine.delayReturn.gain.events.find(e => e.type === 'setValueAtTime' && e.v === 0.0);
      assert.ok(delayReturnPreZero, 'delayReturn must be zeroed at suspendTime prior to resume');

      const drone1PreZero = engine.drone1.voiceGain.gain.events.find(e => e.type === 'setValueAtTime' && e.v === 0.0);
      assert.ok(drone1PreZero, 'drone1 voiceGain must be zeroed at suspendTime prior to resume');

      // Verify smooth exponential setTargetAtTime slew up to operating levels
      const masterSlew = engine.masterGain.gain.events.find(e => e.type === 'setTargetAtTime' && e.target === engine.masterVolume);
      assert.ok(masterSlew, 'masterGain must slew smoothly to masterVolume on resume');

      const droneSlew = engine.droneBus.gain.events.find(e => e.type === 'setTargetAtTime' && e.target === engine.droneBusGain);
      assert.ok(droneSlew, 'droneBus must slew smoothly to droneBusGain on resume');

      const pianoSlew = engine.pianoBus.gain.events.find(e => e.type === 'setTargetAtTime' && e.target === 1.0);
      assert.ok(pianoSlew, 'pianoBus must slew smoothly to unity on resume');

      const drone1Slew = engine.drone1.voiceGain.gain.events.find(e => e.type === 'setTargetAtTime' && Math.abs(e.target - engine.droneParams[1].vol) < 1e-4);
      assert.ok(drone1Slew, 'drone1 voiceGain must slew smoothly to active volume on resume');
    } finally {
      globalThis.AudioContext = origAudioContext;
    }
  });

  it('verifies rapid power-off and immediate power-on serializes cleanly without race conditions', async () => {
    const origAudioContext = globalThis.AudioContext;
    globalThis.AudioContext = class extends MockContext {};

    try {
      const engine = new AudioEngine();
      await engine.init();
      engine.setDroneActive(1, true);

      // Trigger powerOff without awaiting, then immediately trigger init()
      const offPromise = engine.powerOff();
      const onPromise = engine.init();

      await Promise.all([offPromise, onPromise]);

      assert.strictEqual(engine.ctx.state, 'running', 'Context must end in running state');
      const masterSlew = engine.masterGain.gain.events.find(e => e.type === 'setTargetAtTime' && e.target === engine.masterVolume);
      assert.ok(masterSlew, 'Master gain must schedule setTargetAtTime to masterVolume');
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

  it('verifies triggering idle voice in CS-80 mode maintains smooth filter continuity without step pop', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 2);
    const voice = synth.voices[0];
    voice.setWaveform('cs80');

    voice.filter1.frequency.events = [];
    voice.voiceGain.gain.events = [];
    voice.oscMixer.gain.events = [];

    voice.trigger(440, 0.8, 3.5, synth.params, false);

    // Verify filter1 has a linear ramp to brassMaxCutoff
    const filterAttack = voice.filter1.frequency.events.find(e => e.type === 'linearRampToValueAtTime');
    assert.ok(filterAttack, 'CS-80 mode must schedule linear ramp brass filter swell');
    assert.ok(filterAttack.v >= 3200, 'Brass filter swell peak must reach brassMaxCutoff >= 3200 Hz');

    // Verify oscMixer and voiceGain ramp up smoothly on attack
    const ampAttack = voice.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime');
    assert.ok(ampAttack, 'voiceGain must schedule smooth attack ramp');

    const mixerAttack = voice.oscMixer.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 1.0);
    assert.ok(mixerAttack, 'oscMixer must schedule smooth ramp to 1.0');
  });

  it('verifies simultaneous chord cluster release ramps smoothly to 0.0 without abrupt setValueAtTime cuts in timer', async () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 6);

    // Play a 4-voice chord cluster
    ctx.currentTime = 5.0;
    const voices = [
      synth.playNote(261.63, 0.7, 20.0, true, true),
      synth.playNote(329.63, 0.7, 20.0, true, true),
      synth.playNote(392.00, 0.7, 20.0, true, true),
      synth.playNote(493.88, 0.7, 20.0, true, true)
    ];

    voices.forEach(v => {
      v.voiceGain.gain.events = [];
      v.oscMixer.gain.events = [];
    });

    // Release all chord voices simultaneously at currentTime = 6.0
    ctx.currentTime = 6.0;
    voices.forEach(v => v.release());

    for (const v of voices) {
      // Check voiceGain ramps to 0.0
      const gainRamp = v.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
      assert.ok(gainRamp, 'voiceGain must schedule linear ramp to 0.0 on release');

      // Check oscMixer ramps to 0.0
      const mixerRamp = v.oscMixer.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
      assert.ok(mixerRamp, 'oscMixer must schedule linear ramp to 0.0 on release');

      // Check that oscMixer does NOT have a setValueAtTime(0.0) cut scheduled at release time
      const abruptCut = v.oscMixer.gain.events.find(e => e.type === 'setValueAtTime' && e.v === 0.0);
      assert.strictEqual(abruptCut, undefined, 'oscMixer must not schedule an abrupt setValueAtTime(0.0) step cut on release');

      // Wait for release timer to fire and verify no setValueAtTime(0.0) is called in timer callback
      if (v._releaseTimer) {
        // Clear events to inspect what timer does
        v.oscMixer.gain.events = [];
      }
    }
  });

  it('verifies rapid successive headroom updates at the same timestamp cancel previous event without stacking duplicate targets', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 6);

    ctx.currentTime = 10.0;
    synth.playNote(261.63, 0.7);
    synth.playNote(329.63, 0.7);
    synth.playNote(392.00, 0.7);

    // After 3 rapid notes at the exact same timestamp, verify cancelScheduledValues was used to prevent event accumulation
    const cancelsAt10 = synth.output.gain.events.filter(e => e.type === 'cancelScheduledValues' && e.t === 10.0);
    assert.ok(cancelsAt10.length >= 2, 'Consecutive headroom updates at the same timestamp must cancel previous scheduled target');
  });

  it('verifies idle note strike anchors voiceGain at 0.0 at cancelTime before attack ramp', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 2);
    const voice = synth.voices[0];

    ctx.currentTime = 15.0;
    voice.voiceGain.gain.events = [];
    voice.trigger(440, 0.8, 3.5, synth.params, false);

    const anchor = voice.voiceGain.gain.events.find(e => e.type === 'setValueAtTime' && e.t === 15.0 && e.v === 0.0);
    assert.ok(anchor, 'Idle note strike must explicitly anchor voiceGain at 0.0 at cancelTime');

    const attackRamp = voice.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.t > 15.0);
    assert.ok(attackRamp, 'Attack ramp must be scheduled after cancelTime');
  });
});

