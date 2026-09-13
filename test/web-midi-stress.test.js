/**
 * @file web-midi-stress.test.js
 * @brief Adversarial stress test suite for BraunMidiManager.
 * Tests high-throughput bursts, chaotic sustain pedal cycling, malformed/unexpected packets,
 * running status, extreme pitch bends, modulation sweeps, acoustic latching, and voice stealing.
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BraunMidiManager } from '../js/midi/midi-manager.js';
import { AudioEngine } from '../js/audio/engine.js';
import { FeltPianoSynthesizer, FeltPianoVoice } from '../js/audio/felt-piano.js';

// --- Test Harness Helpers ---

class MockAudioParam {
  constructor(val = 0) {
    this.value = val;
    this.events = [];
  }
  setValueAtTime(v, t) {
    if (!isFinite(v)) throw new TypeError(`AudioParam non-finite value: ${v}`);
    this.value = v;
    this.events.push({ type: 'setValueAtTime', v, t });
  }
  setTargetAtTime(v, t, tau) {
    if (!isFinite(v)) throw new TypeError(`AudioParam non-finite value: ${v}`);
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
    if (!isFinite(v)) throw new TypeError(`AudioParam non-finite value: ${v}`);
    this.value = v;
    this.events.push({ type: 'linearRampToValueAtTime', v, t });
  }
  exponentialRampToValueAtTime(v, t) {
    if (!isFinite(v)) throw new TypeError(`AudioParam non-finite value: ${v}`);
    this.value = v;
    this.events.push({ type: 'exponentialRampToValueAtTime', v, t });
  }
}

function createMockAudioContext() {
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

class TrackedVoice {
  constructor(note, velocity) {
    this.note = note;
    this.velocity = velocity;
    this.isActive = true;
    this.releaseCount = 0;
  }
  release() {
    this.isActive = false;
    this.releaseCount++;
  }
}

describe('Adversarial Web MIDI Stress Suite', () => {

  describe('1. High-Throughput Burst & Polyphonic Concurrency', () => {
    it('handles 1,000 rapid sequential Note-On / Note-Off events with zero voice leakage', () => {
      const allVoices = [];
      const engine = {
        a4: 440,
        feltPiano: {
          playNote: (f, v) => {
            const voice = new TrackedVoice(f, v);
            allVoices.push(voice);
            return voice;
          },
          setPitchBend: () => {}
        },
        setPitchBend: () => {},
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      for (let i = 0; i < 1000; i++) {
        const note = 21 + (i % 88);
        const vel = 1 + (i % 127);
        manager.handleMidiMessage({ data: new Uint8Array([0x90, note, vel]) });
        manager.handleMidiMessage({ data: new Uint8Array([0x80, note, 0]) });
      }

      assert.strictEqual(allVoices.length, 1000, 'Expected 1000 voices created');
      assert.strictEqual(manager.activeNotes.size, 0, 'activeNotes must be 0 after all note-offs');
      assert.strictEqual(manager.latchedVoices.size, 0, 'latchedVoices must be 0');
      assert.strictEqual(allVoices.filter(v => v.releaseCount === 0).length, 0, 'Zero voices should remain unreleased');
    });

    it('handles 200 high-density polyphonic chords (6 notes each) with zero leakage', () => {
      const allVoices = [];
      const engine = {
        a4: 440,
        feltPiano: {
          playNote: (f, v) => {
            const voice = new TrackedVoice(f, v);
            allVoices.push(voice);
            return voice;
          },
          setPitchBend: () => {}
        },
        setPitchBend: () => {},
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      for (let c = 0; c < 200; c++) {
        const root = 36 + (c % 48);
        const chord = [root, root + 3, root + 7, root + 10, root + 14, root + 17];
        // Strike chord
        for (const n of chord) {
          manager.handleMidiMessage({ data: new Uint8Array([0x90, n, 85]) });
        }
        // Release chord
        for (const n of chord) {
          manager.handleMidiMessage({ data: new Uint8Array([0x80, n, 0]) });
        }
      }

      assert.strictEqual(allVoices.length, 1200, 'Expected 1200 voices created');
      assert.strictEqual(manager.activeNotes.size, 0, 'activeNotes must be empty');
      assert.strictEqual(manager.latchedVoices.size, 0, 'latchedVoices must be empty');
      assert.strictEqual(allVoices.filter(v => v.releaseCount !== 1).length, 0, 'Every voice must have exactly 1 release call');
    });

    it('releases all voice instances when same note is rapidly restruck before Note-Off', () => {
      const voices = [];
      const engine = {
        a4: 440,
        feltPiano: {
          playNote: () => {
            const v = new TrackedVoice(60, 100);
            voices.push(v);
            return v;
          },
          setPitchBend: () => {}
        },
        setPitchBend: () => {},
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      // Repeat Note 60 8 times without release
      for (let i = 0; i < 8; i++) {
        manager.handleMidiMessage({ data: new Uint8Array([0x90, 60, 80 + i]) });
      }
      assert.strictEqual(voices.length, 8);
      assert.strictEqual(manager.activeNotes.get(60).size, 8);

      // Single Note-Off
      manager.handleMidiMessage({ data: new Uint8Array([0x80, 60, 0]) });
      assert.strictEqual(manager.activeNotes.has(60), false);
      assert.strictEqual(voices.every(v => v.releaseCount === 1), true, 'All 8 voice instances should be released');
    });
  });

  describe('2. Chaotic Sustain Pedal (CC 64) Cycling & Acoustic Latching', () => {
    it('rapidly toggles CC 64 200 times while chord is held without prematurely cutting off notes', () => {
      const voices = [];
      const engine = {
        a4: 440,
        feltPiano: {
          playNote: () => {
            const v = new TrackedVoice(60, 80);
            voices.push(v);
            return v;
          },
          setPitchBend: () => {}
        },
        setPitchBend: () => {},
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      // Hold C-E-G
      [60, 64, 67].forEach(n => manager.handleMidiMessage({ data: new Uint8Array([0x90, n, 80]) }));
      assert.strictEqual(voices.length, 3);
      assert.strictEqual(manager.activeNotes.size, 3);

      // Rapidly toggle CC 64 between 0 and 127
      for (let i = 0; i < 200; i++) {
        const val = (i % 2 === 0) ? 127 : 0;
        manager.handleMidiMessage({ data: new Uint8Array([0xB0, 64, val]) });
        // Notes must NOT release because keys are still physically down!
        assert.strictEqual(voices.every(v => v.releaseCount === 0), true, `Voices prematurely released at toggle ${i}`);
        assert.strictEqual(manager.activeNotes.size, 3);
      }

      // Ensure pedal is down, then release physical keys
      manager.handleMidiMessage({ data: new Uint8Array([0xB0, 64, 127]) });
      [60, 64, 67].forEach(n => manager.handleMidiMessage({ data: new Uint8Array([0x80, n, 0]) }));
      assert.strictEqual(manager.activeNotes.size, 0);
      assert.strictEqual(manager.latchedVoices.size, 3);
      assert.strictEqual(voices.every(v => v.releaseCount === 0), true, 'Voices should still be latched by pedal');

      // Now release pedal -> all 3 voices must release
      manager.handleMidiMessage({ data: new Uint8Array([0xB0, 64, 0]) });
      assert.strictEqual(manager.latchedVoices.size, 0);
      assert.strictEqual(voices.every(v => v.releaseCount === 1), true, 'Voices must release on pedal-up');
    });

    it('Monte Carlo simulation: 2,000 random events with strict physical state oracle', () => {
      const allVoices = [];
      const engine = {
        a4: 440,
        feltPiano: {
          playNote: (f, v) => {
            const voice = new TrackedVoice(f, v);
            allVoices.push(voice);
            return voice;
          },
          setPitchBend: () => {}
        },
        setPitchBend: () => {},
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      let pedalDown = false;
      const physicalKeys = new Set();

      for (let step = 0; step < 2000; step++) {
        const r = Math.random();
        if (r < 0.20) {
          // Toggle pedal
          pedalDown = !pedalDown;
          manager.handleMidiMessage({ data: new Uint8Array([0xB0, 64, pedalDown ? 127 : 0]) });
        } else if (r < 0.60) {
          // Note On
          const note = 21 + Math.floor(Math.random() * 88);
          physicalKeys.add(note);
          manager.handleMidiMessage({ data: new Uint8Array([0x90, note, Math.floor(Math.random() * 127) + 1]) });
        } else {
          // Note Off
          if (physicalKeys.size > 0) {
            const arr = Array.from(physicalKeys);
            const note = arr[Math.floor(Math.random() * arr.length)];
            physicalKeys.delete(note);
            manager.handleMidiMessage({ data: new Uint8Array([0x80, note, 0]) });
          }
        }
      }

      // Cleanup: release all remaining physically held keys
      for (const note of physicalKeys) {
        manager.handleMidiMessage({ data: new Uint8Array([0x80, note, 0]) });
      }
      assert.strictEqual(manager.activeNotes.size, 0, 'activeNotes must be empty after physical keys released');

      // Release pedal if still held
      if (pedalDown) {
        manager.handleMidiMessage({ data: new Uint8Array([0xB0, 64, 0]) });
      }
      assert.strictEqual(manager.latchedVoices.size, 0, 'latchedVoices must be empty after pedal released');

      // Verify oracle
      const unreleased = allVoices.filter(v => v.releaseCount === 0);
      const multiReleased = allVoices.filter(v => v.releaseCount > 1);
      assert.strictEqual(unreleased.length, 0, `Found ${unreleased.length} unreleased voices!`);
      assert.strictEqual(multiReleased.length, 0, `Found ${multiReleased.length} multiply-released voices!`);
    });
  });

  describe('3. Malformed, Truncated, & Boundary MIDI Packets', () => {
    it('handles truncated packets without throwing exceptions', () => {
      const engine = {
        a4: 440,
        feltPiano: { playNote: () => new TrackedVoice(60, 64), setPitchBend: () => {} },
        setPitchBend: () => {},
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      const malformedCases = [
        new Uint8Array([0x90]),             // Note-On missing note and velocity
        new Uint8Array([0x80]),             // Note-Off missing note
        new Uint8Array([0xB0]),             // CC missing cc and value
        new Uint8Array([0xE0]),             // Pitch bend missing bytes
        new Uint8Array([0x90, 60]),         // Note-On missing velocity
        new Uint8Array([0xB0, 64]),         // CC missing value
        new Uint8Array([0xE0, 0]),          // Pitch bend missing msb
        new Uint8Array([]),                 // Empty packet
        new Uint8Array([0xF8]),             // Timing clock
        new Uint8Array([0xFA]),             // Start
        new Uint8Array([0xFB]),             // Continue
        new Uint8Array([0xFC]),             // Stop
        new Uint8Array([0xFE]),             // Active sensing
        new Uint8Array([0xF0, 0x7E, 0xF7]), // SysEx
        null,
        undefined,
        {}
      ];

      for (const pkt of malformedCases) {
        assert.doesNotThrow(() => {
          manager.handleMidiMessage({ data: pkt });
        }, `Should not throw on packet: ${JSON.stringify(pkt)}`);
      }
    });

    it('handles unknown and boundary CC numbers safely', () => {
      let modCalls = 0;
      const engine = {
        a4: 440,
        feltPiano: { playNote: () => null, setPitchBend: () => {} },
        setPitchBend: () => {},
        setModulationWheel: () => { modCalls++; }
      };
      const manager = new BraunMidiManager(engine);

      // Unknown CCs: CC 0, 7, 10, 11, 71, 74, 121, 255
      const ccs = [0, 7, 10, 11, 71, 74, 121, 255];
      for (const cc of ccs) {
        assert.doesNotThrow(() => {
          manager.handleMidiMessage({ data: new Uint8Array([0xB0, cc, 64]) });
        });
      }
      assert.strictEqual(modCalls, 0, 'Unknown CCs should not trigger modulation wheel');
    });

    it('handles out-of-range velocities and notes with clamp protection', () => {
      let lastVelocity = null;
      let lastFreq = null;
      const engine = {
        a4: 440,
        feltPiano: {
          playNote: (f, v) => {
            lastFreq = f;
            lastVelocity = v;
            return new TrackedVoice(f, v);
          },
          setPitchBend: () => {}
        },
        setPitchBend: () => {},
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      // Out of range high velocity: 255 -> clamped to 1.0
      manager.handleMidiMessage({ data: new Uint8Array([0x90, 60, 255]) });
      assert.strictEqual(lastVelocity, 1.0);
      manager.handleMidiMessage({ data: new Uint8Array([0x80, 60, 0]) });

      // Out of range low velocity: 0 on 0x90 -> treated as Note-Off
      manager.handleMidiMessage({ data: new Uint8Array([0x90, 60, 80]) });
      assert.strictEqual(manager.activeNotes.has(60), true);
      manager.handleMidiMessage({ data: new Uint8Array([0x90, 60, 0]) });
      assert.strictEqual(manager.activeNotes.has(60), false);
    });

    it('BUG CHECK: handles running status without dropping Note-Off and leaking voices', () => {
      const voices = [];
      const engine = {
        a4: 440,
        feltPiano: {
          playNote: (f, v) => {
            const vObj = new TrackedVoice(f, v);
            voices.push(vObj);
            return vObj;
          },
          setPitchBend: () => {}
        },
        setPitchBend: () => {},
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      // Status 0x90 Note-On note 60
      manager.handleMidiMessage({ data: new Uint8Array([0x90, 60, 100]) });
      assert.strictEqual(manager.activeNotes.has(60), true);

      // Running status Note-Off: [60, 0] (no status byte, data bytes only)
      manager.handleMidiMessage({ data: new Uint8Array([60, 0]) });

      // If running status is supported or handled gracefully, note 60 must not remain stuck!
      // If activeNotes still has note 60, voice is leaked / stuck on!
      const isVoiceLeaked = manager.activeNotes.has(60);
      assert.strictEqual(isVoiceLeaked, false, 'Running status Note-Off [60, 0] should release note 60 to prevent stuck notes');
    });

    it('BUG CHECK: handles event object reuse without dropping subsequent Note-Off or Note-On', () => {
      let playCalls = 0;
      let releaseCalls = 0;
      const engine = {
        a4: 440,
        feltPiano: {
          playNote: () => {
            playCalls++;
            return { release: () => { releaseCalls++; } };
          },
          setPitchBend: () => {}
        },
        setPitchBend: () => {},
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      // Reused event object (standard in audio worklets / high-performance MIDI parsers)
      const reusedEvent = { data: new Uint8Array([0x90, 60, 100]) };
      manager.handleMidiMessage(reusedEvent);
      assert.strictEqual(playCalls, 1);
      assert.strictEqual(manager.activeNotes.has(60), true);

      // Mutate reused event object to Note-Off
      reusedEvent.data[2] = 0;
      manager.handleMidiMessage(reusedEvent);

      // Note-Off should NOT be dropped due to reference equality check (_lastHandledEvent === event)
      assert.strictEqual(manager.activeNotes.has(60), false, 'Note-Off must not be dropped when event object is reused');
      assert.strictEqual(releaseCalls, 1, 'Voice must be released on reused event Note-Off');

      // Test consecutive Note-On with same array reference
      const noteOnArr = [0x90, 64, 90];
      manager.handleMidiMessage(noteOnArr);
      assert.strictEqual(playCalls, 2);
      manager.handleMidiMessage(noteOnArr); // Restrike same note with same array
      assert.strictEqual(playCalls, 3, 'Consecutive Note-On with same array reference must not be dropped');
    });
  });

  describe('4. Extreme Pitch Bend & Rapid Modulation Sweeps', () => {
    it('decodes extreme pitch bend boundaries and survives 5,000-message sweeps', () => {
      let lastCents = null;
      const engine = {
        a4: 440,
        feltPiano: { playNote: () => null, setPitchBend: () => {} },
        setPitchBend: (c) => { lastCents = c; },
        setModulationWheel: () => {}
      };
      const manager = new BraunMidiManager(engine);

      // Boundary 1: Minimum (0, 0) -> -200 cents
      manager.handleMidiMessage({ data: new Uint8Array([0xE0, 0, 0]) });
      assert.strictEqual(lastCents, -200.0);

      // Boundary 2: Center (0, 64) -> 0 cents
      manager.handleMidiMessage({ data: new Uint8Array([0xE0, 0, 64]) });
      assert.strictEqual(lastCents, 0.0);

      // Boundary 3: Maximum (127, 127) -> +199.975... cents
      manager.handleMidiMessage({ data: new Uint8Array([0xE0, 127, 127]) });
      assert.ok(Math.abs(lastCents - 200.0) < 0.1);

      // 5,000-message pitch bend sweep
      for (let i = 0; i <= 5000; i++) {
        const val = Math.floor((i / 5000) * 16383);
        const lsb = val & 0x7F;
        const msb = (val >> 7) & 0x7F;
        manager.handleMidiMessage({ data: new Uint8Array([0xE0, lsb, msb]) });
      }
      assert.ok(Math.abs(lastCents - 200.0) < 0.1);
    });

    it('survives 5,000-message modulation wheel (CC 1) sweeps with correct scaling and UI knob sync', () => {
      let lastMod = null;
      let knobVal = null;
      let knobTrigger = null;

      const engine = {
        a4: 440,
        feltPiano: { playNote: () => null, setPitchBend: () => {} },
        setPitchBend: () => {},
        setModulationWheel: (m) => { lastMod = m; }
      };
      const app = {
        knobs: {
          feltTone: {
            setValue: (v, trigger) => {
              knobVal = v;
              knobTrigger = trigger;
            }
          }
        }
      };
      const manager = new BraunMidiManager(engine, app);

      for (let i = 0; i <= 5000; i++) {
        const v = i % 128;
        manager.handleMidiMessage({ data: new Uint8Array([0xB0, 1, v]) });
        assert.ok(lastMod >= 0.0 && lastMod <= 1.0);
        assert.strictEqual(knobTrigger, false, 'UI knob must not re-trigger feedback loop');
      }
    });
  });

  describe('5. Polyphonic Voice Stealing & Acoustic Latch Integrity', () => {
    it('BUG CHECK: stolen voice is NOT prematurely cut off when previous note is released', () => {
      const mockCtx = createMockAudioContext();
      const engine = new AudioEngine(mockCtx);
      // Small 4-voice synth to deterministically test voice stealing
      engine.feltPiano = new FeltPianoSynthesizer(mockCtx, null, 4);
      const manager = new BraunMidiManager(engine);

      // 1. Play 4 notes to fill voice pool
      [60, 62, 64, 65].forEach(n => manager.handleMidiMessage({ data: new Uint8Array([0x90, n, 80]) }));

      // 2. Note 67 arrives and steals Voice 0 (which was playing Note 60)
      mockCtx.currentTime += 0.1; // advance time past 60ms recent-strike protection
      manager.handleMidiMessage({ data: new Uint8Array([0x90, 67, 80]) });

      const voice0 = engine.feltPiano.voices[0];
      assert.strictEqual(voice0.currentMidi, 67, 'Voice 0 should now be sounding Note 67');
      assert.strictEqual(voice0._isReleased, false, 'Voice 0 should not be released');

      // 3. Physical key for Note 60 is now released while Note 67 remains held
      manager.handleMidiMessage({ data: new Uint8Array([0x80, 60, 0]) });

      // Voice 0 (currently sounding Note 67) MUST NOT be released by Note 60's key-up!
      assert.strictEqual(voice0._isReleased, false, 'Voice 0 must NOT be released when previous stolen note 60 is released');
    });

    it('BUG CHECK: stolen voice is NOT released when sustain pedal is cycled while key remains held', () => {
      const mockCtx = createMockAudioContext();
      const engine = new AudioEngine(mockCtx);
      engine.feltPiano = new FeltPianoSynthesizer(mockCtx, null, 4);
      const manager = new BraunMidiManager(engine);

      // 1. Play 4 notes
      [60, 62, 64, 65].forEach(n => manager.handleMidiMessage({ data: new Uint8Array([0x90, n, 80]) }));

      // 2. Steal voice 0 with note 67
      mockCtx.currentTime += 0.1;
      manager.handleMidiMessage({ data: new Uint8Array([0x90, 67, 80]) });
      const voice0 = engine.feltPiano.voices[0];

      // 3. Press sustain pedal
      manager.handleMidiMessage({ data: new Uint8Array([0xB0, 64, 127]) });

      // 4. Release note 60 (should not latch voice 0 because voice 0 is playing note 67!)
      manager.handleMidiMessage({ data: new Uint8Array([0x80, 60, 0]) });

      // 5. Release sustain pedal while Note 67 is STILL HELD
      manager.handleMidiMessage({ data: new Uint8Array([0xB0, 64, 0]) });

      assert.strictEqual(voice0._isReleased, false, 'Voice 0 must NOT be released when pedal is released if note 67 key is still held');
    });
  });
});
