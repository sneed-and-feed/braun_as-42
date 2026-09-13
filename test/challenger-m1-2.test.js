/**
 * @file challenger-m1-2.test.js
 * @brief Adversarial verification test suite by challenger_m1_2.
 * Validates dynamic hotplugging, Omni-channel coverage (0..15),
 * environment fallback edge cases, audio auto-wake robustness, and packet resilience.
 */

import { test, describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BraunMidiManager } from '../js/midi/midi-manager.js';
import { AudioEngine } from '../js/audio/engine.js';
import { FeltPianoSynthesizer, FeltPianoVoice } from '../js/audio/felt-piano.js';
import { midiToFrequency } from '../js/generative/scales.js';

// --- Test Harness Helpers ---

function setMockNavigator(mock) {
  if (mock === undefined) {
    try {
      delete globalThis.navigator;
    } catch (e) {
      Object.defineProperty(globalThis, 'navigator', {
        value: undefined,
        configurable: true,
        writable: true
      });
    }
  } else {
    Object.defineProperty(globalThis, 'navigator', {
      value: mock,
      configurable: true,
      writable: true
    });
  }
}

class MockMIDIInput {
  constructor(id = 'input-1', name = 'Mock Device', type = 'input') {
    this.id = id;
    this.name = name;
    this.type = type;
    this.state = 'connected';
    this.listeners = new Map();
    this.onmidimessage = null;
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }

  removeEventListener(type, callback) {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const handlers = (this.listeners.get(event.type) || []).slice();
    for (const h of handlers) {
      h(event);
    }
    if (event.type === 'midimessage' && typeof this.onmidimessage === 'function') {
      this.onmidimessage(event);
    }
  }

  send(bytes) {
    const data = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes);
    this.dispatchEvent({ type: 'midimessage', data, target: this });
  }
}

class MockMIDIAccess {
  constructor() {
    this.inputs = new Map();
    this.listeners = new Map();
    this.onstatechange = null;
  }

  addPort(port) {
    if (port.type === 'input') {
      this.inputs.set(port.id, port);
    }
    port.state = 'connected';
    this.dispatchEvent({ type: 'statechange', port });
  }

  removePort(port) {
    port.state = 'disconnected';
    if (port.type === 'input') {
      this.inputs.delete(port.id);
    }
    this.dispatchEvent({ type: 'statechange', port });
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(callback);
  }

  removeEventListener(type, callback) {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    const handlers = (this.listeners.get(event.type) || []).slice();
    for (const h of handlers) {
      h(event);
    }
    if (event.type === 'statechange' && typeof this.onstatechange === 'function') {
      this.onstatechange(event);
    }
  }
}

function createMockAudioContext() {
  class MockAudioParam {
    constructor(val = 0) {
      this.value = val;
      this.events = [];
    }
    setValueAtTime(v, t) {
      this.value = v;
      this.events.push({ type: 'setValueAtTime', v, t });
    }
    setTargetAtTime(v, t, tau) {
      this.value = v;
      this.events.push({ type: 'setTargetAtTime', v, t, tau });
    }
    cancelScheduledValues(t) {
      this.events.push({ type: 'cancelScheduledValues', t });
    }
    linearRampToValueAtTime(v, t) {
      this.value = v;
      this.events.push({ type: 'linearRampToValueAtTime', v, t });
    }
    exponentialRampToValueAtTime(v, t) {
      this.value = v;
      this.events.push({ type: 'exponentialRampToValueAtTime', v, t });
    }
  }

  return {
    currentTime: 0.1,
    sampleRate: 48000,
    state: 'running',
    createGain: () => ({
      gain: new MockAudioParam(1.0),
      connect() {},
      disconnect() {}
    }),
    createBiquadFilter: () => ({
      type: 'lowpass',
      frequency: new MockAudioParam(440),
      Q: new MockAudioParam(0.707),
      gain: new MockAudioParam(0.0),
      connect() {},
      disconnect() {}
    }),
    createWaveShaper: () => ({
      oversample: '4x',
      curve: null,
      connect() {},
      disconnect() {}
    }),
    createOscillator: () => ({
      frequency: new MockAudioParam(440),
      detune: new MockAudioParam(0),
      connect() {},
      start() {},
      stop() {},
      setPeriodicWave() {}
    }),
    createBuffer: (channels, length, sampleRate) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length)
    }),
    createBufferSource: () => ({
      buffer: null,
      connect() {},
      start() {},
      stop() {}
    }),
    createPeriodicWave: () => ({})
  };
}

function createTrackingEngine() {
  const ctx = createMockAudioContext();
  const voices = [];
  const playCalls = [];
  let pitchBendCents = 0;
  let feltTone = 0.5;

  const mockFeltPiano = {
    currentPitchBendCents: 0,
    playCalls,
    voices,
    playNote(freq, velocity, duration, isHold) {
      const v = {
        id: voices.length + 1,
        freq,
        velocity,
        duration,
        isHold,
        isActive: true,
        releaseCount: 0,
        release() {
          this.isActive = false;
          this.releaseCount++;
        }
      };
      voices.push(v);
      playCalls.push({ freq, velocity, duration, isHold, voice: v });
      return v;
    },
    setPitchBend(cents) {
      this.currentPitchBendCents = cents;
    }
  };

  return {
    ctx,
    a4: 440,
    feltPiano: mockFeltPiano,
    playCalls,
    voices,
    get pitchBendCents() { return pitchBendCents; },
    set pitchBendCents(v) { pitchBendCents = v; },
    get feltTone() { return feltTone; },
    set feltTone(v) { feltTone = v; },
    setPitchBend(cents) {
      pitchBendCents = cents;
      mockFeltPiano.setPitchBend(cents);
    },
    setModulationWheel(val) {
      feltTone = val;
    }
  };
}

describe('Challenger M1-2: Adversarial Verification of Web MIDI Integration', () => {
  let originalNavigator;

  beforeEach(() => {
    originalNavigator = globalThis.navigator;
  });

  afterEach(() => {
    setMockNavigator(originalNavigator);
  });

  describe('Section 1: Dynamic Device Hotplugging & onstatechange Stress', () => {
    it('strictly ignores output ports on statechange events', async () => {
      const mockAccess = new MockMIDIAccess();
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      // Dispatch statechange with output port
      const outputPort = new MockMIDIInput('out-1', 'MIDI Out Synthesizer', 'output');
      mockAccess.addPort(outputPort);

      assert.strictEqual(manager._attachedInputs.has(outputPort), false, 'Output ports must never be attached as inputs');
      assert.strictEqual(manager._attachedInputs.size, 0);

      // Now disconnect the output port
      mockAccess.removePort(outputPort);
      assert.strictEqual(manager._attachedInputs.size, 0);
    });

    it('survives null, undefined, and malformed statechange events without throwing', async () => {
      const mockAccess = new MockMIDIAccess();
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      assert.doesNotThrow(() => manager._handleStateChange(null));
      assert.doesNotThrow(() => manager._handleStateChange(undefined));
      assert.doesNotThrow(() => manager._handleStateChange({}));
      assert.doesNotThrow(() => manager._handleStateChange({ port: null }));
      assert.doesNotThrow(() => manager._handleStateChange({ port: { type: 'unknown', state: 'connected' } }));
      assert.doesNotThrow(() => manager._handleStateChange({ port: { type: 'input', state: 'unknown_state' } }));
    });

    it('is idempotent under repeated rapid connect events for the same port', async () => {
      const mockAccess = new MockMIDIAccess();
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      const input = new MockMIDIInput('in-1', 'Controller Alpha');
      // Repeatedly fire connected events
      for (let i = 0; i < 10; i++) {
        mockAccess.addPort(input);
      }

      assert.strictEqual(manager._attachedInputs.size, 1);
      assert.strictEqual(manager._attachedInputs.has(input), true);

      // Verify that triggering a note results in exactly ONE voice allocation (no duplicate listener registrations)
      input.send([0x90, 60, 100]);
      assert.strictEqual(engine.playCalls.length, 1, 'Duplicate connect events must not register duplicate message handlers');
    });

    it('is idempotent under repeated disconnect events for an unattached or already detached port', async () => {
      const mockAccess = new MockMIDIAccess();
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      const input = new MockMIDIInput('in-1', 'Controller Alpha');
      mockAccess.addPort(input);
      assert.strictEqual(manager._attachedInputs.size, 1);

      for (let i = 0; i < 5; i++) {
        mockAccess.removePort(input);
      }
      assert.strictEqual(manager._attachedInputs.size, 0);

      const neverAttached = new MockMIDIInput('in-ghost');
      assert.doesNotThrow(() => mockAccess.removePort(neverAttached));
    });

    it('handles multi-device concurrency: 5 controllers connected simultaneously', async () => {
      const mockAccess = new MockMIDIAccess();
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      const controllers = Array.from({ length: 5 }, (_, i) => new MockMIDIInput(`ctrl-${i}`, `Controller ${i}`));
      controllers.forEach(c => mockAccess.addPort(c));

      assert.strictEqual(manager._attachedInputs.size, 5);

      // Play notes across different controllers
      controllers.forEach((c, i) => {
        c.send([0x90, 50 + i, 80]);
      });

      assert.strictEqual(engine.playCalls.length, 5);
      for (let i = 0; i < 5; i++) {
        assert.strictEqual(manager.activeNotes.has(50 + i), true);
      }

      // Disconnect 2 controllers
      mockAccess.removePort(controllers[0]);
      mockAccess.removePort(controllers[1]);
      assert.strictEqual(manager._attachedInputs.size, 3);

      // Remaining controllers send notes
      controllers[2].send([0x90, 70, 90]);
      assert.strictEqual(manager.activeNotes.has(70), true);

      // Disconnected controller sends message: should not reach manager because listener was detached
      controllers[0].send([0x90, 80, 90]);
      assert.strictEqual(manager.activeNotes.has(80), false, 'Disconnected controller messages must be ignored');
    });

    it('allows clean device reconnection after disconnection', async () => {
      const mockAccess = new MockMIDIAccess();
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      const input = new MockMIDIInput('reconnect-dev', 'USB Reconnectable');
      mockAccess.addPort(input);
      assert.strictEqual(manager._attachedInputs.has(input), true);

      mockAccess.removePort(input);
      assert.strictEqual(manager._attachedInputs.has(input), false);

      // Reconnect same port instance
      mockAccess.addPort(input);
      assert.strictEqual(manager._attachedInputs.has(input), true);

      input.send([0x90, 62, 95]);
      assert.strictEqual(manager.activeNotes.has(62), true);
      assert.strictEqual(engine.playCalls.length, 1);
    });
  });

  describe('Section 2: Exhaustive Omni Mode (Channels 0 through 15) Coverage', () => {
    it('accurately decodes Note-On across all 16 MIDI channels (0x90 through 0x9F)', async () => {
      const mockAccess = new MockMIDIAccess();
      const input = new MockMIDIInput('omni-in');
      mockAccess.addPort(input);
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      for (let ch = 0; ch < 16; ch++) {
        const status = 0x90 + ch;
        const note = 36 + ch; // Range of notes
        const vel = 20 + ch * 6; // Range of velocities

        input.send([status, note, vel]);

        assert.strictEqual(manager.activeNotes.has(note), true, `Note ${note} on Channel ${ch} (status 0x${status.toString(16)}) must be active`);
        const lastCall = engine.playCalls[engine.playCalls.length - 1];
        const expectedFreq = midiToFrequency(note, 440);
        const expectedVel = vel / 127.0;

        assert.ok(Math.abs(lastCall.freq - expectedFreq) < 1e-4, `Channel ${ch}: Frequency error`);
        assert.ok(Math.abs(lastCall.velocity - expectedVel) < 1e-4, `Channel ${ch}: Velocity scaling error`);
        assert.strictEqual(lastCall.isHold, true);
      }

      assert.strictEqual(engine.playCalls.length, 16);
    });

    it('accurately decodes Note-Off across all 16 MIDI channels (0x80 through 0x8F)', async () => {
      const mockAccess = new MockMIDIAccess();
      const input = new MockMIDIInput('omni-in');
      mockAccess.addPort(input);
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      for (let ch = 0; ch < 16; ch++) {
        const note = 40 + ch;
        // Strike note on channel ch
        input.send([0x90 + ch, note, 90]);
        assert.strictEqual(manager.activeNotes.has(note), true);

        // Release note via 0x80 + ch
        input.send([0x80 + ch, note, 64]);
        assert.strictEqual(manager.activeNotes.has(note), false, `Channel ${ch}: Note-Off (0x${(0x80 + ch).toString(16)}) must release note`);
      }

      // Verify all voices received release()
      assert.strictEqual(engine.voices.length, 16);
      for (const v of engine.voices) {
        assert.strictEqual(v.releaseCount, 1);
        assert.strictEqual(v.isActive, false);
      }
    });

    it('accurately treats Note-On with velocity 0 as Note-Off across all 16 channels', async () => {
      const mockAccess = new MockMIDIAccess();
      const input = new MockMIDIInput('omni-in');
      mockAccess.addPort(input);
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      for (let ch = 0; ch < 16; ch++) {
        const note = 50 + ch;
        // Note-On
        input.send([0x90 + ch, note, 100]);
        assert.strictEqual(manager.activeNotes.has(note), true);

        // Note-On with vel 0
        input.send([0x90 + ch, note, 0]);
        assert.strictEqual(manager.activeNotes.has(note), false, `Channel ${ch}: Note-On with vel 0 must release note`);
      }

      for (const v of engine.voices) {
        assert.strictEqual(v.releaseCount, 1);
      }
    });

    it('handles CC 64 Sustain Pedal across all 16 channels in Omni mode', async () => {
      const mockAccess = new MockMIDIAccess();
      const input = new MockMIDIInput('omni-in');
      mockAccess.addPort(input);
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      for (let ch = 0; ch < 16; ch++) {
        const note = 60;
        // 1. Strike note on channel ch
        input.send([0x90 + ch, note, 80]);
        // 2. Sustain on channel ch
        input.send([0xB0 + ch, 64, 127]);
        assert.strictEqual(manager.isSustainDown, true);
        // 3. Note-Off on channel ch
        input.send([0x80 + ch, note, 0]);
        assert.strictEqual(manager.latchedVoices.size, 1, `Channel ${ch}: Voice must latch with sustain`);

        // 4. Release sustain on channel ch
        input.send([0xB0 + ch, 64, 0]);
        assert.strictEqual(manager.isSustainDown, false);
        assert.strictEqual(manager.latchedVoices.size, 0, `Channel ${ch}: Latched voices must clear on sustain release`);
      }
    });

    it('handles 14-bit Pitch Bend across all 16 channels (0xE0 through 0xEF)', async () => {
      const mockAccess = new MockMIDIAccess();
      const input = new MockMIDIInput('omni-in');
      mockAccess.addPort(input);
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      for (let ch = 0; ch < 16; ch++) {
        // Bend to +100 cents (halfway up: 8192 + 4096 = 12288 -> LSB=0, MSB=96)
        input.send([0xE0 + ch, 0, 96]);
        assert.ok(Math.abs(engine.pitchBendCents - 100.0) < 1.0, `Channel ${ch}: Pitch bend positive error`);

        // Return to center (8192 -> LSB=0, MSB=64)
        input.send([0xE0 + ch, 0, 64]);
        assert.ok(Math.abs(engine.pitchBendCents - 0.0) < 1e-4, `Channel ${ch}: Pitch bend center error`);
      }
    });

    it('handles CC 1 Modulation Wheel across all 16 channels (0xB0 through 0xBF)', async () => {
      const mockAccess = new MockMIDIAccess();
      const input = new MockMIDIInput('omni-in');
      mockAccess.addPort(input);
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      for (let ch = 0; ch < 16; ch++) {
        const val = 64;
        input.send([0xB0 + ch, 1, val]);
        const expected = 64 / 127.0;
        assert.ok(Math.abs(engine.feltTone - expected) < 1e-4, `Channel ${ch}: Mod wheel mapping error`);
      }
    });

    it('manages overlapping identical notes triggered across different channels', async () => {
      const mockAccess = new MockMIDIAccess();
      const input = new MockMIDIInput('omni-in');
      mockAccess.addPort(input);
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      await manager.init();

      // Note 60 on Channel 0
      input.send([0x90, 60, 80]);
      // Note 60 on Channel 1
      input.send([0x91, 60, 90]);

      const noteSet = manager.activeNotes.get(60);
      assert.strictEqual(noteSet.size, 2, 'Two overlapping voices should exist for note 60');

      // Note-Off received on Channel 0
      input.send([0x80, 60, 0]);
      // Both voices released cleanly
      assert.strictEqual(manager.activeNotes.has(60), false);
      assert.strictEqual(engine.voices[0].releaseCount, 1);
      assert.strictEqual(engine.voices[1].releaseCount, 1);
    });
  });

  describe('Section 3: Environment Fallback & Permission Edge Cases', () => {
    it('returns false and remains inert when navigator is undefined', async () => {
      setMockNavigator(undefined);
      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);

      const result = await manager.init();
      assert.strictEqual(result, false);
      assert.strictEqual(manager.midiAccess, null);

      // Subsequent calls must not throw
      assert.doesNotThrow(() => manager.handleMidiMessage([0x90, 60, 80]));
      assert.doesNotThrow(() => manager.panic());
      assert.doesNotThrow(() => manager.destroy());
    });

    it('returns false when navigator is an empty object or has non-function requestMIDIAccess', async () => {
      setMockNavigator({});
      const engine = createTrackingEngine();
      const manager1 = new BraunMidiManager(engine);
      assert.strictEqual(await manager1.init(), false);

      setMockNavigator({ requestMIDIAccess: 'not-a-function' });
      const manager2 = new BraunMidiManager(engine);
      assert.strictEqual(await manager2.init(), false);

      setMockNavigator({ requestMIDIAccess: null });
      const manager3 = new BraunMidiManager(engine);
      assert.strictEqual(await manager3.init(), false);
    });

    it('gracefully catches synchronous SecurityError thrown by requestMIDIAccess', async () => {
      setMockNavigator({
        requestMIDIAccess: () => {
          const err = new Error('The request is not allowed by the user agent or the platform in the current context.');
          err.name = 'SecurityError';
          throw err;
        }
      });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      const result = await manager.init();

      assert.strictEqual(result, false);
      assert.strictEqual(manager.midiAccess, null);
    });

    it('gracefully catches asynchronous Promise rejection (NotAllowedError / denied permission)', async () => {
      setMockNavigator({
        requestMIDIAccess: async () => {
          const err = new Error('Web MIDI permission denied by user');
          err.name = 'NotAllowedError';
          throw err;
        }
      });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      const result = await manager.init();

      assert.strictEqual(result, false);
      assert.strictEqual(manager.midiAccess, null);
    });

    it('gracefully handles requestMIDIAccess returning null or object without inputs', async () => {
      setMockNavigator({
        requestMIDIAccess: async () => null
      });
      const engine = createTrackingEngine();
      const manager1 = new BraunMidiManager(engine);
      assert.strictEqual(await manager1.init(), false);

      setMockNavigator({
        requestMIDIAccess: async () => ({ inputs: null, addEventListener: () => {} })
      });
      const manager2 = new BraunMidiManager(engine);
      assert.strictEqual(await manager2.init(), true);
    });

    it('supports MIDIAccess with values() iterator when forEach is not available', async () => {
      const input = new MockMIDIInput('iter-1');
      const inputMap = {
        values: function* () {
          yield input;
        }
      };

      setMockNavigator({
        requestMIDIAccess: async () => ({
          inputs: inputMap,
          addEventListener: () => {}
        })
      });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      const result = await manager.init();

      assert.strictEqual(result, true);
      assert.strictEqual(manager._attachedInputs.has(input), true);
    });

    it('is safe under concurrent multiple init() calls', async () => {
      const mockAccess = new MockMIDIAccess();
      setMockNavigator({ requestMIDIAccess: async () => mockAccess });

      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);

      const results = await Promise.all([manager.init(), manager.init(), manager.init()]);
      assert.deepStrictEqual(results, [true, true, true]);
      assert.strictEqual(manager.midiAccess, mockAccess);
    });

    it('is safe to call destroy() on an uninitialized or failed manager', () => {
      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);
      assert.doesNotThrow(() => manager.destroy());
      assert.doesNotThrow(() => manager.panic());
    });
  });

  describe('Section 4: Audio Auto-Wake Logic on First Strike', () => {
    it('wakes audio context on Note-On when app is unpowered (isPowerOn = false)', async () => {
      const engine = createTrackingEngine();
      let startAudioCalled = 0;
      const app = {
        isPowerOn: false,
        async startAudio() {
          startAudioCalled++;
          this.isPowerOn = true;
        }
      };

      const manager = new BraunMidiManager(engine, app);
      // Send Note-On
      manager.handleMidiMessage([0x90, 60, 80]);

      assert.strictEqual(startAudioCalled, 1, 'startAudio must be called on first Note-On');
    });

    it('wakes audio context on Note-On when AudioContext is suspended even if isPowerOn is true', async () => {
      const engine = createTrackingEngine();
      engine.ctx.state = 'suspended';
      let startAudioCalled = 0;
      const app = {
        isPowerOn: true,
        async startAudio() {
          startAudioCalled++;
          engine.ctx.state = 'running';
        }
      };

      const manager = new BraunMidiManager(engine, app);
      manager.handleMidiMessage([0x90, 60, 80]);

      assert.strictEqual(startAudioCalled, 1, 'startAudio must be called when context is suspended');
    });

    it('does NOT call startAudio if synth is already powered on and context is running', async () => {
      const engine = createTrackingEngine();
      engine.ctx.state = 'running';
      let startAudioCalled = 0;
      const app = {
        isPowerOn: true,
        async startAudio() {
          startAudioCalled++;
        }
      };

      const manager = new BraunMidiManager(engine, app);
      manager.handleMidiMessage([0x90, 60, 80]);

      assert.strictEqual(startAudioCalled, 0, 'startAudio should not be called when already running');
    });

    it('does NOT trigger startAudio on Note-Off, Note-On vel 0, CC, or Pitch Bend when unpowered', async () => {
      const engine = createTrackingEngine();
      let startAudioCalled = 0;
      const app = {
        isPowerOn: false,
        async startAudio() {
          startAudioCalled++;
        }
      };

      const manager = new BraunMidiManager(engine, app);

      // Note-Off (0x80)
      manager.handleMidiMessage([0x80, 60, 64]);
      assert.strictEqual(startAudioCalled, 0, 'Note-Off must not wake audio');

      // Note-On with velocity 0
      manager.handleMidiMessage([0x90, 60, 0]);
      assert.strictEqual(startAudioCalled, 0, 'Velocity-0 Note-On must not wake audio');

      // CC 64
      manager.handleMidiMessage([0xB0, 64, 127]);
      assert.strictEqual(startAudioCalled, 0, 'CC 64 must not wake audio');

      // Pitch Bend
      manager.handleMidiMessage([0xE0, 0, 64]);
      assert.strictEqual(startAudioCalled, 0, 'Pitch bend must not wake audio');
    });

    it('swallows promise rejection from startAudio without unhandled exception', async () => {
      const engine = createTrackingEngine();
      const app = {
        isPowerOn: false,
        startAudio() {
          return Promise.reject(new Error('Autoplay policy prevented AudioContext resumption'));
        }
      };

      const manager = new BraunMidiManager(engine, app);
      assert.doesNotThrow(() => {
        manager.handleMidiMessage([0x90, 60, 80]);
      });
    });

    it('handles null app or app without startAudio gracefully', () => {
      const engine = createTrackingEngine();
      const manager1 = new BraunMidiManager(engine, null);
      assert.doesNotThrow(() => manager1.handleMidiMessage([0x90, 60, 80]));

      const manager2 = new BraunMidiManager(engine, { isPowerOn: false });
      assert.doesNotThrow(() => manager2.handleMidiMessage([0x90, 60, 80]));
    });
  });

  describe('Section 5: Packet Robustness, Real-Time Filtering, and Panic', () => {
    it('discards empty, truncated, or invalid packet payloads gracefully', () => {
      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);

      assert.doesNotThrow(() => manager.handleMidiMessage(null));
      assert.doesNotThrow(() => manager.handleMidiMessage(undefined));
      assert.doesNotThrow(() => manager.handleMidiMessage({}));
      assert.doesNotThrow(() => manager.handleMidiMessage({ data: null }));
      assert.doesNotThrow(() => manager.handleMidiMessage({ data: [] }));
      assert.doesNotThrow(() => manager.handleMidiMessage([]));
      assert.doesNotThrow(() => manager.handleMidiMessage(new Uint8Array(0)));

      assert.strictEqual(engine.playCalls.length, 0);
    });

    it('ignores System Real-Time messages (0xF8 through 0xFE)', () => {
      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);

      const realTimeBytes = [0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE];
      realTimeBytes.forEach(status => {
        manager.handleMidiMessage([status]);
      });

      assert.strictEqual(engine.playCalls.length, 0);
    });

    it('releases all notes on CC 123 (All Notes Off) and CC 120 (All Sound Off)', () => {
      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);

      // Play notes and latch pedal
      manager.handleMidiMessage([0x90, 60, 80]);
      manager.handleMidiMessage([0xB0, 64, 127]);
      manager.handleMidiMessage([0x80, 60, 0]);

      assert.strictEqual(manager.latchedVoices.size, 1);
      assert.strictEqual(manager.isSustainDown, true);

      // Send CC 123 All Notes Off
      manager.handleMidiMessage([0xB0, 123, 0]);

      assert.strictEqual(manager.latchedVoices.size, 0);
      assert.strictEqual(manager.activeNotes.size, 0);
      assert.strictEqual(manager.isSustainDown, false);
      assert.strictEqual(engine.voices[0].releaseCount, 1);
    });

    it('handles status === 0xFF System Reset by invoking panic()', () => {
      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);

      // Play notes and latch pedal
      manager.handleMidiMessage([0x90, 60, 80]);
      manager.handleMidiMessage([0xB0, 64, 127]);
      manager.handleMidiMessage([0x80, 60, 0]);

      assert.strictEqual(manager.latchedVoices.size, 1);
      assert.strictEqual(manager.isSustainDown, true);

      // Send 0xFF System Reset
      manager.handleMidiMessage([0xFF]);

      // 0xFF (System Reset / Panic) unblocks and triggers panic(), clearing latched and active voices
      assert.strictEqual(
        manager.latchedVoices.size,
        0,
        '0xFF System Reset triggers panic() and clears latched voices'
      );
      assert.strictEqual(manager.isSustainDown, false);
      assert.strictEqual(manager.activeNotes.size, 0);
    });

    it('prevents double trigger when same event is dispatched to onmidimessage and addEventListener', () => {
      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);

      const eventObj = {
        data: new Uint8Array([0x90, 60, 100])
      };

      // Call twice with identical event reference
      manager.handleMidiMessage(eventObj);
      manager.handleMidiMessage(eventObj);

      assert.strictEqual(engine.playCalls.length, 1, 'Duplicate event object reference must be de-duplicated');
    });

    it('clamps out-of-range velocities and normalizes pitch bend extreme edges', () => {
      const engine = createTrackingEngine();
      const manager = new BraunMidiManager(engine);

      // Velocity > 127
      manager.handleMidiMessage([0x90, 60, 255]);
      assert.strictEqual(engine.playCalls[0].velocity, 1.0, 'Velocity > 127 should clamp to 1.0');

      // Extreme pitch bend upper boundary (127, 127)
      manager.handleMidiMessage([0xE0, 127, 127]);
      assert.ok(Math.abs(manager.currentPitchBendCents - 200.0) < 0.1);

      // Extreme pitch bend lower boundary (0, 0)
      manager.handleMidiMessage([0xE0, 0, 0]);
      assert.ok(Math.abs(manager.currentPitchBendCents - (-200.0)) < 1e-4);
    });
  });
});
