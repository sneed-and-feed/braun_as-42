/**
 * @file web-midi.test.js
 * @brief Comprehensive automated unit tests for Web MIDI API integration in BRAUN AS 42.
 * Tests device discovery, hotplugging, Note-On/Off dispatch, velocity scaling,
 * sustain pedal (CC 64) voice latching, 14-bit pitch bend, CC 1 mod wheel, and graceful fallback.
 */

import { test, describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BraunMidiManager } from '../js/midi/midi-manager.js';
import { AudioEngine } from '../js/audio/engine.js';
import { FeltPianoSynthesizer, FeltPianoVoice } from '../js/audio/felt-piano.js';
import { midiToFrequency } from '../js/generative/scales.js';

// --- Web MIDI Mock Infrastructure ---

class MockMIDIInput {
  constructor(id = 'input-1', name = 'Mock Master Keyboard') {
    this.id = id;
    this.name = name;
    this.manufacturer = 'Braun AG';
    this.type = 'input';
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
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const handlers = this.listeners.get(event.type) || [];
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
    this.inputs.set(port.id, port);
    port.state = 'connected';
    this.dispatchEvent({ type: 'statechange', port });
  }

  removePort(port) {
    port.state = 'disconnected';
    this.inputs.delete(port.id);
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
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    const handlers = this.listeners.get(event.type) || [];
    for (const h of handlers) {
      h(event);
    }
    if (event.type === 'statechange' && typeof this.onstatechange === 'function') {
      this.onstatechange(event);
    }
  }
}

// Mock Web Audio Context for DSP voice assertions
function createDSPMockCtx() {
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
    cancelAndHoldAtTime(t) {
      this.events.push({ type: 'cancelAndHoldAtTime', t });
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
    currentTime: 1.0,
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

describe('Milestone 1: Web MIDI API & DAW Controller Integration', () => {
  let originalNavigator;

  beforeEach(() => {
    originalNavigator = globalThis.navigator;
  });

  afterEach(() => {
    if (originalNavigator === undefined) {
      delete globalThis.navigator;
    } else {
      globalThis.navigator = originalNavigator;
    }
  });

  describe('1. Web MIDI API Fallback & Initialization Safety', () => {
    it('handles navigator being undefined without throwing', async () => {
      delete globalThis.navigator;
      const manager = new BraunMidiManager({});
      const result = await manager.init();
      assert.strictEqual(result, false, 'Should return false when navigator is undefined');
      assert.strictEqual(manager.midiAccess, null);
    });

    it('handles navigator.requestMIDIAccess being missing without throwing', async () => {
      globalThis.navigator = {};
      const manager = new BraunMidiManager({});
      const result = await manager.init();
      assert.strictEqual(result, false, 'Should return false when requestMIDIAccess is missing');
      assert.strictEqual(manager.midiAccess, null);
    });

    it('handles navigator.requestMIDIAccess rejection gracefully (SecurityError / NotAllowedError)', async () => {
      globalThis.navigator = {
        requestMIDIAccess: async () => {
          throw new Error('SecurityError: Web MIDI access denied');
        }
      };
      const manager = new BraunMidiManager({});
      const result = await manager.init();
      assert.strictEqual(result, false, 'Should return false when requestMIDIAccess rejects');
      assert.strictEqual(manager.midiAccess, null);
    });

    it('attaches existing input ports and statechange listener upon successful initialization', async () => {
      const mockAccess = new MockMIDIAccess();
      const input1 = new MockMIDIInput('in-1', 'Controller 1');
      mockAccess.inputs.set('in-1', input1);

      globalThis.navigator = {
        requestMIDIAccess: async () => mockAccess
      };

      const manager = new BraunMidiManager({});
      const result = await manager.init();
      assert.strictEqual(result, true, 'Should return true upon successful init');
      assert.strictEqual(manager.midiAccess, mockAccess);
      assert.strictEqual(manager._attachedInputs.has(input1), true, 'Existing input should be attached');
      assert.ok(mockAccess.onstatechange, 'onstatechange listener should be set');
    });
  });

  describe('2. MIDI Packet Decoding, Note-On & Velocity Scaling', () => {
    let mockAccess;
    let input;
    let mockVoice;
    let mockFeltPiano;
    let mockEngine;
    let mockApp;
    let manager;

    beforeEach(async () => {
      mockAccess = new MockMIDIAccess();
      input = new MockMIDIInput('in-1', 'Keyboard 1');
      mockAccess.inputs.set('in-1', input);

      globalThis.navigator = {
        requestMIDIAccess: async () => mockAccess
      };

      mockVoice = {
        isActive: true,
        isHold: true,
        releaseCount: 0,
        release() {
          this.isActive = false;
          this.releaseCount++;
        }
      };

      mockFeltPiano = {
        playCalls: [],
        currentPitchBendCents: 0,
        playNote(freq, velocity, duration, isHold) {
          this.playCalls.push({ freq, velocity, duration, isHold });
          return mockVoice;
        },
        setPitchBend(cents) {
          this.currentPitchBendCents = cents;
        }
      };

      mockEngine = {
        a4: 440,
        feltPiano: mockFeltPiano,
        feltTone: 0.60,
        pitchBendCents: 0,
        ctx: { state: 'running' },
        setPitchBend(cents) {
          this.pitchBendCents = cents;
          this.feltPiano.setPitchBend(cents);
        },
        setModulationWheel(v) {
          this.feltTone = v;
        }
      };

      mockApp = {
        isPowerOn: true,
        startAudioCalls: 0,
        async startAudio() {
          this.isPowerOn = true;
          this.startAudioCalls++;
        },
        knobs: {
          feltTone: {
            value: 60,
            lastTrigger: null,
            setValue(val, trigger) {
              this.value = val;
              this.lastTrigger = trigger;
            }
          }
        },
        playSurface: {
          flashedKeys: [],
          flashKey(note) {
            this.flashedKeys.push(note);
          }
        }
      };

      manager = new BraunMidiManager(mockEngine, mockApp);
      await manager.init();
    });

    it('triggers voice on Note-On with exact frequency and scaled velocity (0x90)', () => {
      // Send Note-On: Note 60 (Middle C), velocity 100 on Channel 1 (0x90)
      input.send([0x90, 60, 100]);

      assert.strictEqual(mockFeltPiano.playCalls.length, 1);
      const call = mockFeltPiano.playCalls[0];
      const expectedFreq = midiToFrequency(60, 440);
      assert.ok(Math.abs(call.freq - expectedFreq) < 1e-4, `Expected frequency ~${expectedFreq}, got ${call.freq}`);
      assert.ok(Math.abs(call.velocity - (100 / 127.0)) < 1e-4, `Expected velocity ~${100 / 127}, got ${call.velocity}`);
      assert.strictEqual(call.isHold, true, 'Voice should be triggered with hold=true for keyboard sustain');
      assert.strictEqual(manager.activeNotes.has(60), true, 'Note 60 should be registered in activeNotes');
      assert.strictEqual(mockApp.playSurface.flashedKeys.includes(60), true, 'Chime strip flashKey should be called');
    });

    it('supports Omni mode across different MIDI channels (0x90 - 0x9F)', () => {
      // Channel 10 Note-On: Note 69 (A4, 440Hz), velocity 127 (0x99)
      input.send([0x99, 69, 127]);

      assert.strictEqual(mockFeltPiano.playCalls.length, 1);
      const call = mockFeltPiano.playCalls[0];
      assert.ok(Math.abs(call.freq - 440.0) < 1e-4, 'A4 frequency should be 440Hz');
      assert.strictEqual(call.velocity, 1.0, 'Max velocity 127 should normalize to 1.0');
      assert.strictEqual(manager.activeNotes.has(69), true);
    });

    it('releases voice on Note-Off (0x80)', () => {
      input.send([0x90, 64, 80]); // Note-On E4
      assert.strictEqual(manager.activeNotes.has(64), true);
      assert.strictEqual(mockVoice.releaseCount, 0);

      input.send([0x80, 64, 64]); // Note-Off E4
      assert.strictEqual(mockVoice.releaseCount, 1, 'Voice should be released on Note-Off');
      assert.strictEqual(manager.activeNotes.has(64), false, 'Note 64 should be removed from activeNotes');
    });

    it('handles Note-On with velocity 0 as Note-Off according to MIDI specification', () => {
      input.send([0x90, 67, 90]); // Note-On G4
      assert.strictEqual(manager.activeNotes.has(67), true);
      assert.strictEqual(mockVoice.releaseCount, 0);

      input.send([0x90, 67, 0]); // Note-On G4 with velocity 0
      assert.strictEqual(mockVoice.releaseCount, 1, 'Note-On with velocity 0 should trigger release');
      assert.strictEqual(manager.activeNotes.has(67), false, 'Note 67 should be removed from activeNotes');
    });

    it('auto-wakes synthesizer power if system is unpowered or suspended', () => {
      mockApp.isPowerOn = false;
      mockEngine.ctx.state = 'suspended';

      input.send([0x90, 60, 64]);
      assert.strictEqual(mockApp.startAudioCalls, 1, 'startAudio should be invoked on Note-On when unpowered');
    });
  });

  describe('3. Sustain Pedal (CC 64) Voice Latching Mechanics', () => {
    let input;
    let voices;
    let mockFeltPiano;
    let mockEngine;
    let manager;

    beforeEach(async () => {
      const mockAccess = new MockMIDIAccess();
      input = new MockMIDIInput('in-1');
      mockAccess.inputs.set('in-1', input);
      globalThis.navigator = { requestMIDIAccess: async () => mockAccess };

      voices = [];
      mockFeltPiano = {
        playNote() {
          const v = {
            id: voices.length + 1,
            isActive: true,
            releaseCount: 0,
            release() {
              this.isActive = false;
              this.releaseCount++;
            }
          };
          voices.push(v);
          return v;
        },
        setPitchBend() {}
      };

      mockEngine = {
        a4: 440,
        feltPiano: mockFeltPiano,
        setPitchBend() {},
        setModulationWheel() {}
      };

      manager = new BraunMidiManager(mockEngine);
      await manager.init();
    });

    it('latches active voices when CC 64 >= 64, holding notes past Note-Off until pedal release', () => {
      // 1. Strike Note 60 (C4)
      input.send([0x90, 60, 80]);
      const voiceC4 = voices[0];
      assert.strictEqual(manager.activeNotes.has(60), true);

      // 2. Depress Sustain Pedal: CC 64 = 127
      input.send([0xB0, 64, 127]);
      assert.strictEqual(manager.isSustainDown, true, 'Sustain pedal should be down');

      // 3. Release physical key Note 60
      input.send([0x80, 60, 0]);
      assert.strictEqual(voiceC4.releaseCount, 0, 'Voice must NOT be released while pedal is down');
      assert.strictEqual(manager.latchedVoices.has(voiceC4), true, 'Voice should be transferred to latchedVoices');
      assert.strictEqual(manager.activeNotes.has(60), false, 'Note 60 removed from activeNotes');

      // 4. Strike Note 64 (E4) while pedal is still held
      input.send([0x90, 64, 85]);
      const voiceE4 = voices[1];
      assert.strictEqual(manager.activeNotes.has(64), true);

      // 5. Release physical key Note 64 while pedal still held
      input.send([0x80, 64, 0]);
      assert.strictEqual(voiceE4.releaseCount, 0, 'Voice E4 must not be released');
      assert.strictEqual(manager.latchedVoices.has(voiceE4), true);

      // 6. Release Sustain Pedal: CC 64 = 0
      input.send([0xB0, 64, 0]);
      assert.strictEqual(manager.isSustainDown, false, 'Sustain pedal should be released');
      assert.strictEqual(voiceC4.releaseCount, 1, 'Voice C4 must be released upon pedal release');
      assert.strictEqual(voiceE4.releaseCount, 1, 'Voice E4 must be released upon pedal release');
      assert.strictEqual(manager.latchedVoices.size, 0, 'Latched voices should be cleared');
    });

    it('does NOT prematurely release voices whose physical keys are still held when pedal is released', () => {
      // 1. Depress pedal
      input.send([0xB0, 64, 127]);

      // 2. Play Note 67 (G4) and KEEP PHYSICAL KEY PRESSED
      input.send([0x90, 67, 90]);
      const voiceG4 = voices[0];

      // 3. Release pedal while key is STILL held
      input.send([0xB0, 64, 0]);
      assert.strictEqual(voiceG4.releaseCount, 0, 'Voice G4 must remain sounding because key is still depressed');
      assert.strictEqual(manager.activeNotes.has(67), true, 'Note 67 should still be in activeNotes');

      // 4. Finally release physical key Note 67
      input.send([0x80, 67, 0]);
      assert.strictEqual(voiceG4.releaseCount, 1, 'Voice G4 should release upon physical Note-Off');
      assert.strictEqual(manager.activeNotes.has(67), false);
    });
  });

  describe('4. Pitch Bend (0xE0) & CC 1 Modulation Wheel', () => {
    let input;
    let mockEngine;
    let mockApp;
    let manager;

    beforeEach(async () => {
      const mockAccess = new MockMIDIAccess();
      input = new MockMIDIInput('in-1');
      mockAccess.inputs.set('in-1', input);
      globalThis.navigator = { requestMIDIAccess: async () => mockAccess };

      mockEngine = {
        feltTone: 0.5,
        pitchBendCents: 0,
        feltPiano: {
          setPitchBend(c) { mockEngine.pitchBendCents = c; },
          playNote() { return null; }
        },
        setPitchBend(c) {
          this.pitchBendCents = c;
          this.feltPiano.setPitchBend(c);
        },
        setModulationWheel(v) {
          this.feltTone = v;
        }
      };

      mockApp = {
        isPowerOn: true,
        knobs: {
          feltTone: {
            value: 50,
            lastTrigger: null,
            setValue(val, trigger) {
              this.value = val;
              this.lastTrigger = trigger;
            }
          }
        }
      };

      manager = new BraunMidiManager(mockEngine, mockApp);
      await manager.init();
    });

    it('decodes 14-bit pitch bend: center position equals 0 cents', () => {
      // 14-bit 8192: LSB = 0, MSB = 64
      input.send([0xE0, 0, 64]);
      assert.ok(Math.abs(mockEngine.pitchBendCents - 0.0) < 1e-4, `Expected 0 cents, got ${mockEngine.pitchBendCents}`);
    });

    it('decodes 14-bit pitch bend: maximum upward bend equals +200 cents (+2 semitones)', () => {
      // 14-bit 16383: LSB = 127, MSB = 127
      input.send([0xE0, 127, 127]);
      assert.ok(Math.abs(mockEngine.pitchBendCents - 200.0) < 0.1, `Expected ~+200 cents, got ${mockEngine.pitchBendCents}`);
    });

    it('decodes 14-bit pitch bend: maximum downward bend equals -200 cents (-2 semitones)', () => {
      // 14-bit 0: LSB = 0, MSB = 0
      input.send([0xE0, 0, 0]);
      assert.ok(Math.abs(mockEngine.pitchBendCents - (-200.0)) < 1e-4, `Expected -200 cents, got ${mockEngine.pitchBendCents}`);
    });

    it('maps CC 1 modulation wheel to felt tone damping and updates UI knob without ping-pong loop', () => {
      // CC 1 with value 95 (75% modulation)
      input.send([0xB0, 1, 95]);

      const expectedNorm = 95 / 127.0;
      assert.ok(Math.abs(mockEngine.feltTone - expectedNorm) < 1e-4, 'Engine felt tone should match normalized CC 1');
      assert.ok(Math.abs(mockApp.knobs.feltTone.value - (expectedNorm * 100)) < 1e-2, 'Knob value should be updated');
      assert.strictEqual(mockApp.knobs.feltTone.lastTrigger, false, 'Knob triggerOnChange must be false to avoid feedback loops');
    });
  });

  describe('5. Hotplugging, Dynamic Controller Discovery, and Panic', () => {
    let mockAccess;
    let manager;
    let mockEngine;

    beforeEach(async () => {
      mockAccess = new MockMIDIAccess();
      globalThis.navigator = { requestMIDIAccess: async () => mockAccess };

      mockEngine = {
        feltPiano: {
          playNote() {
            return { isActive: true, release() { this.isActive = false; } };
          },
          setPitchBend() {}
        },
        setPitchBend() {},
        setModulationWheel() {}
      };

      manager = new BraunMidiManager(mockEngine);
      await manager.init();
    });

    it('dynamically attaches new MIDI controller on statechange connected event', () => {
      assert.strictEqual(manager._attachedInputs.size, 0);

      // Connect hotplugged controller
      const hotplugInput = new MockMIDIInput('hotplug-1', 'USB Keybed');
      mockAccess.addPort(hotplugInput);

      assert.strictEqual(manager._attachedInputs.has(hotplugInput), true, 'Hotplugged device should be automatically monitored');

      // Verify hotplugged device transmits Note-On
      hotplugInput.send([0x90, 60, 90]);
      assert.strictEqual(manager.activeNotes.has(60), true, 'Notes from hotplugged device should be received');
    });

    it('detaches controller on statechange disconnected event', () => {
      const controller = new MockMIDIInput('ctrl-1');
      mockAccess.addPort(controller);
      assert.strictEqual(manager._attachedInputs.has(controller), true);

      mockAccess.removePort(controller);
      assert.strictEqual(manager._attachedInputs.has(controller), false, 'Disconnected controller should be detached');
    });

    it('releases all active and latched notes on CC 123 (All Notes Off) or CC 120 (All Sound Off)', () => {
      const input = new MockMIDIInput('in-1');
      mockAccess.addPort(input);

      // Play notes and latch pedal
      input.send([0x90, 60, 80]);
      input.send([0x90, 64, 80]);
      input.send([0xB0, 64, 127]); // Sustain pedal down
      input.send([0x80, 60, 0]); // Note 60 in latchedVoices

      assert.strictEqual(manager.activeNotes.size, 1);
      assert.strictEqual(manager.latchedVoices.size, 1);

      // Send CC 123 All Notes Off
      input.send([0xB0, 123, 0]);
      assert.strictEqual(manager.activeNotes.size, 0, 'Active notes should be cleared');
      assert.strictEqual(manager.latchedVoices.size, 0, 'Latched voices should be cleared');
      assert.strictEqual(manager.isSustainDown, false, 'Sustain pedal state should be reset');
    });

    it('destroy() cleans up attached ports and clears voice sets', () => {
      const input = new MockMIDIInput('in-1');
      mockAccess.addPort(input);
      input.send([0x90, 60, 80]);

      manager.destroy();
      assert.strictEqual(manager._attachedInputs.size, 0);
      assert.strictEqual(manager.activeNotes.size, 0);
      assert.strictEqual(manager.latchedVoices.size, 0);
      assert.strictEqual(manager.midiAccess, null);
    });
  });

  describe('6. Real Felt Piano DSP & AudioEngine Integration', () => {
    it('verifies FeltPianoVoice.setPitchBend slews osc1 and osc2 detune via setTargetAtTime', () => {
      const ctx = createDSPMockCtx();
      const voice = new FeltPianoVoice(ctx, ctx.createGain(), null, null, null, 0);

      voice.setPitchBend(150, 0.015);
      assert.strictEqual(voice.currentPitchBendCents, 150);

      const osc1Events = voice.osc1.detune.events;
      const osc2Events = voice.osc2.detune.events;

      assert.ok(osc1Events.length > 0);
      assert.ok(osc2Events.length > 0);

      const last1 = osc1Events[osc1Events.length - 1];
      const last2 = osc2Events[osc2Events.length - 1];

      assert.strictEqual(last1.type, 'setTargetAtTime');
      assert.strictEqual(last2.type, 'setTargetAtTime');
      assert.strictEqual(last1.tau, 0.015);
      assert.strictEqual(last2.tau, 0.015);

      // Value should include dispersion offset + 150 cents
      assert.ok(Math.abs(last1.v - (voice.dispersionOffset + 150)) < 1e-4);
    });

    it('verifies FeltPianoSynthesizer propagates pitch bend to active voices and stores for future notes', () => {
      const ctx = createDSPMockCtx();
      const synth = new FeltPianoSynthesizer(ctx, null, 4);

      // Play note before pitch bend
      const v1 = synth.playNote(440, 0.8, 20.0, true);
      assert.strictEqual(v1.isActive, true);

      // Apply pitch bend
      synth.setPitchBend(120);
      assert.strictEqual(synth.currentPitchBendCents, 120);
      assert.strictEqual(v1.currentPitchBendCents, 120);

      // Future note should inherit pitch bend
      const v2 = synth.playNote(554.37, 0.8, 20.0, true);
      assert.strictEqual(v2.currentPitchBendCents, 120);
    });

    it('verifies AudioEngine delegates setPitchBend and setModulationWheel seamlessly', () => {
      const ctx = createDSPMockCtx();
      const engine = new AudioEngine(ctx);
      engine.feltPiano = new FeltPianoSynthesizer(ctx, null, 4);

      engine.setPitchBend(75);
      assert.strictEqual(engine.currentPitchBendCents, 75);
      assert.strictEqual(engine.feltPiano.currentPitchBendCents, 75);

      engine.setModulationWheel(0.85);
      assert.strictEqual(engine.feltParams.tone, 0.85);
      assert.strictEqual(engine.feltPiano.params.tone, 0.85);
    });
  });
});
