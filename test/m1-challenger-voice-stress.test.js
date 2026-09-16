/**
 * @file m1-challenger-voice-stress.test.js
 * @brief Adversarial Stress Testing Suite by m1_challenger_1
 * 
 * Verifies voice lifecycle under adversarial and high-throughput workloads:
 * 1. Polyphony voice allocation bounds: 100 rapid note events through keyboard.js:playNote,
 *    verifying active voices never exceed 24 and each key tap allocates exactly 1 voice.
 * 2. Rapid chord cluster re-strumming: 10 consecutive chord clusters in rapid sequence,
 *    verifying clean release and zero leaked/orphaned ghost voices.
 * 3. MIDI panic under maximum polyphony: 24 sustained notes at full capacity,
 *    invoking engine.releaseAllNotes() and verifying 100% deactivation with zero hanging timers.
 * 4. High-stress boundary edge cases: stolen voice latching, rapid re-strumming of identical chords,
 *    interrupted strums, and post-panic re-allocation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../js/audio/engine.js';
import { FeltPianoSynthesizer, FeltPianoVoice } from '../js/audio/felt-piano.js';
import { BraunPlaySurface } from '../js/ui/keyboard.js';
import { midiToFrequency, CHORD_VOICINGS } from '../js/generative/scales.js';

// --- Mocks for Node.js Headless Environment ---

class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.events.push({ type: 'setValueAtTime', v, t });
    return this;
  }
  setTargetAtTime(target, startTime, timeConstant) {
    this.value = target;
    this.events.push({ type: 'setTargetAtTime', target, v: target, t: startTime, tau: timeConstant });
    return this;
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.events.push({ type: 'linearRampToValueAtTime', v, t });
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    this.value = v;
    this.events.push({ type: 'exponentialRampToValueAtTime', v, t });
    return this;
  }
  cancelScheduledValues(t) {
    this.events.push({ type: 'cancelScheduledValues', t });
    return this;
  }
  cancelAndHoldAtTime(t) {
    this.events.push({ type: 'cancelAndHoldAtTime', t });
    return this;
  }
}

class MockAudioNode {
  constructor(name = 'node') {
    this.name = name;
    this.connectedTo = [];
    this.connections = this.connectedTo;
  }
  connect(dest) {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect(dest) {
    if (!dest) {
      this.connectedTo.length = 0;
    } else {
      const idx = this.connectedTo.indexOf(dest);
      if (idx !== -1) this.connectedTo.splice(idx, 1);
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
    this.currentTime = 1.0;
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
  createDelay(maxDelay = 1.0) {
    const n = new MockAudioNode('delay');
    n.delayTime = new MockAudioParam(0.1);
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
  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
}

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    const set = new Set();
    this.classList = {
      add: (...cls) => cls.forEach(c => set.add(c)),
      remove: (...cls) => cls.forEach(c => set.delete(c)),
      contains: (c) => set.has(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (set.has(c)) { set.delete(c); return false; }
          else { set.add(c); return true; }
        } else if (force) {
          set.add(c); return true;
        } else {
          set.delete(c); return false;
        }
      },
      get length() { return set.size; }
    };
    this._className = '';
    this._innerHTML = '';
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.get(k) || null; }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }
  dispatchEvent(type, ev = {}) {
    const cbs = this.listeners.get(type) || [];
    cbs.forEach(cb => cb(ev));
  }
  getBoundingClientRect() {
    return { top: 100, bottom: 200, left: 10, right: 60, width: 50, height: 100 };
  }
  querySelectorAll() { return []; }
}

function setupDom() {
  const origDoc = globalThis.document;
  globalThis.document = {
    createElement: (tag) => new MockElement(tag),
    activeElement: null,
    body: new MockElement('body'),
    getElementById: () => null,
    querySelectorAll: () => []
  };
  return () => {
    globalThis.document = origDoc;
  };
}

describe('M1 Challenger Stress Tests: Voice Lifecycle & Polyphony', () => {

  // =========================================================================
  // Challenge 1: Polyphony Voice Allocation Bounds
  // =========================================================================
  describe('Challenge 1: Polyphony Voice Allocation Bounds', () => {

    it('Scenario 1.1: 100 rapid note events through keyboard.js:playNote allocate exactly 1 voice each and never exceed 24 active voices', async () => {
      const teardownDom = setupDom();
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      let engine = null;
      try {
        engine = new AudioEngine();
        await engine.init();

        let feltPianoPlayNoteCalls = 0;
        const origPlayNote = engine.feltPiano.playNote.bind(engine.feltPiano);
        engine.feltPiano.playNote = function(...args) {
          feltPianoPlayNoteCalls++;
          return origPlayNote(...args);
        };

        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');
        const surface = new BraunPlaySurface(mockStrip, mockChords, engine);

        const MAX_CAPACITY = 24;
        assert.strictEqual(engine.feltPiano.voices.length, MAX_CAPACITY, `Voice pool capacity must be exactly ${MAX_CAPACITY}`);

        // Trigger 100 rapid notes across diverse MIDI pitches (24 to 96)
        for (let i = 0; i < 100; i++) {
          const midi = 24 + (i % 72);
          const freq = midiToFrequency(midi, 440);
          const velocity = 0.5 + (i % 50) * 0.01;
          const callsBefore = feltPianoPlayNoteCalls;

          const voice = surface.playNote(freq, midi, velocity, 3.5, false);

          // Invariant 1: Exactly 1 voice allocated per key tap (no duplicate calls)
          assert.strictEqual(
            feltPianoPlayNoteCalls - callsBefore,
            1,
            `Note #${i} (MIDI ${midi}): feltPiano.playNote must be called exactly 1 time per playNote`
          );
          assert.ok(voice, `Note #${i}: playNote must return an active voice object`);
          assert.strictEqual(voice.isActive, true, `Note #${i}: returned voice must be active`);

          // Invariant 2: Active voices in pool must NEVER exceed 24
          const activeCount = engine.feltPiano.voices.filter(v => v.isActive).length;
          assert.ok(
            activeCount <= MAX_CAPACITY,
            `Active voice count (${activeCount}) must NEVER exceed capacity (${MAX_CAPACITY}) at step ${i}`
          );

          // Invariant 3: Voice pool array must remain fixed length (no leaking/expanding array)
          assert.strictEqual(
            engine.feltPiano.voices.length,
            MAX_CAPACITY,
            `Voice pool length must remain fixed at ${MAX_CAPACITY}`
          );
        }

        assert.strictEqual(feltPianoPlayNoteCalls, 100, 'Total feltPiano.playNote calls must be exactly 100 for 100 key taps');
      } finally {
        if (engine) engine.releaseAllNotes();
        globalThis.AudioContext = origAudioContext;
        teardownDom();
      }
    });

    it('Scenario 1.2: Rapid repeated key strikes on the exact same note do not duplicate voices or leak pool capacity', async () => {
      const teardownDom = setupDom();
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      let engine = null;
      try {
        engine = new AudioEngine();
        await engine.init();

        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');
        const surface = new BraunPlaySurface(mockStrip, mockChords, engine);

        const midi = 60; // Middle C
        const freq = 261.63;

        // Strike Middle C 50 times in rapid succession without releasing
        for (let i = 0; i < 50; i++) {
          const v = surface.playNote(freq, midi, 0.7, 3.5, false);
          assert.ok(v, `Strike #${i} must return a valid voice`);
        }

        // Active voices should be re-triggered rather than expanding the pool
        const activeCount = engine.feltPiano.voices.filter(v => v.isActive).length;
        assert.ok(activeCount <= 24, 'Active voice count must not exceed 24');
        assert.strictEqual(activeCount, 1, 'Re-striking the same non-held frequency reuses the sounding voice');
      } finally {
        if (engine) engine.releaseAllNotes();
        globalThis.AudioContext = origAudioContext;
        teardownDom();
      }
    });

    it('Scenario 1.3: 100 rapid sustained (held) notes enforce voice stealing and hard ceiling of 24 active voices', async () => {
      const teardownDom = setupDom();
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');
        const surface = new BraunPlaySurface(mockStrip, mockChords, engine);

        // Play 100 unique sustained notes
        for (let i = 0; i < 100; i++) {
          const midi = 20 + i;
          const freq = midiToFrequency(midi, 440);
          surface.playNote(freq, midi, 0.8, 20.0, true);

          const activeCount = engine.feltPiano.voices.filter(v => v.isActive).length;
          const expected = Math.min(i + 1, 24);
          assert.strictEqual(
            activeCount,
            expected,
            `At step ${i}, active voice count must be exactly ${expected} (capped at 24)`
          );
        }

        const finalActive = engine.feltPiano.voices.filter(v => v.isActive).length;
        assert.strictEqual(finalActive, 24, 'Voice pool must be fully saturated at exactly 24 voices');
      } finally {
        globalThis.AudioContext = origAudioContext;
        teardownDom();
      }
    });
  });

  // =========================================================================
  // Challenge 2: Rapid Chord Cluster Re-strumming
  // =========================================================================
  describe('Challenge 2: Rapid Chord Cluster Re-strumming', () => {

    it('Scenario 2.1: 10 consecutive chord clusters in rapid sequence cleanly release with zero leaked ghost voices', async () => {
      const teardownDom = setupDom();
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');
        const surface = new BraunPlaySurface(mockStrip, mockChords, engine);
        surface.chordSpeed = 'fast';

        const chordKeys = Object.keys(CHORD_VOICINGS);
        const sessions = [];

        // Strum 10 chords consecutively in rapid succession
        for (let i = 0; i < 10; i++) {
          const voicingId = chordKeys[i % chordKeys.length];
          const session = surface.startChord(voicingId, false);
          assert.ok(session, `Chord session #${i} must be created`);
          sessions.push(session);

          // Brief delay between strums (25ms)
          await new Promise(r => setTimeout(r, 25));

          // Release the previous chord session if one exists
          if (i > 0) {
            surface.stopChordSession(sessions[i - 1]);
            assert.strictEqual(sessions[i - 1].isReleased, true);
          }
        }

        // Release the final chord session
        surface.stopChordSession(sessions[sessions.length - 1]);

        // Await strum timers and release envelopes
        await new Promise(r => setTimeout(r, 350));

        // Invariant 1: All sessions marked released and timers cleared
        for (const [idx, s] of sessions.entries()) {
          assert.strictEqual(s.isReleased, true, `Session #${idx} must be released`);
          assert.strictEqual(s.timers.length, 0, `Session #${idx} timers must be cleared`);
          assert.strictEqual(s.voices.length, 0, `Session #${idx} voices must be flushed`);
        }

        // Invariant 2: Audio engine tracked notes must be completely clear
        assert.strictEqual(engine._heldNotes.size, 0, 'AudioEngine._heldNotes must have size 0');

        // Invariant 3: Zero leaked ghost voices in feltPiano pool
        // Any voice that finished its release envelope must have deactivated
        const lingeringActive = engine.feltPiano.voices.filter(v => v.isActive && !v._isReleased);
        assert.strictEqual(lingeringActive.length, 0, 'No unreleased ghost voices may linger in pool');
      } finally {
        globalThis.AudioContext = origAudioContext;
        teardownDom();
      }
    });

    it('Scenario 2.2: Rapid re-strumming of the exact same chord cluster 10 times does not leak voices', async () => {
      const teardownDom = setupDom();
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');
        const surface = new BraunPlaySurface(mockStrip, mockChords, engine);
        surface.chordSpeed = 'fast';

        const sessions = [];
        // Strum PLATEAUX_MAJ9 10 times in rapid succession
        for (let i = 0; i < 10; i++) {
          const session = surface.startChord('PLATEAUX_MAJ9', true);
          sessions.push(session);
          await new Promise(r => setTimeout(r, 15));
          surface.stopChordSession(session);
        }

        await new Promise(r => setTimeout(r, 300));

        assert.strictEqual(engine._heldNotes.size, 0, 'Engine held notes must be 0');
        const activeVoices = engine.feltPiano.voices.filter(v => v.isActive && !v._isReleased);
        assert.strictEqual(activeVoices.length, 0, 'Zero lingering voices after 10 rapid re-strums');
      } finally {
        globalThis.AudioContext = origAudioContext;
        teardownDom();
      }
    });

    it('Scenario 2.3: Interrupted chord strumming cancels pending timers and prevents deferred ghost voices', async () => {
      const teardownDom = setupDom();
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');
        const surface = new BraunPlaySurface(mockStrip, mockChords, engine);
        surface.chordSpeed = 'slow'; // Slow strum (50ms between notes)

        // Start slow chord with 5 notes (total strum duration > 200ms)
        const session = surface.startChord('PLATEAUX_MAJ9', true);

        // Abort chord after only 30ms (before all notes are triggered)
        await new Promise(r => setTimeout(r, 30));
        surface.stopChordSession(session);

        assert.strictEqual(session.isReleased, true);
        assert.strictEqual(session.timers.length, 0, 'All timers must be cleared immediately');

        // Wait 300ms (longer than the full slow strum duration)
        await new Promise(r => setTimeout(r, 300));

        // Verify no ghost voices were triggered by orphaned timers
        assert.strictEqual(engine._heldNotes.size, 0, 'No notes should remain in engine._heldNotes');
      } finally {
        globalThis.AudioContext = origAudioContext;
        teardownDom();
      }
    });
  });

  // =========================================================================
  // Challenge 3: MIDI Panic Under Maximum Polyphony
  // =========================================================================
  describe('Challenge 3: MIDI Panic Under Maximum Polyphony', () => {

    it('Scenario 3.1: 24 sustained notes at full polyphony deactivate cleanly with zero hanging timers on releaseAllNotes()', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        // 1. Saturate polyphony to maximum capacity (24 voices) with sustained notes
        for (let i = 0; i < 24; i++) {
          const midi = 36 + i;
          engine.noteOn(midi, 0.8, 20.0, true);
        }

        // Verify pre-panic saturation
        assert.strictEqual(engine.feltPiano.voices.length, 24, 'Voice pool must have exactly 24 voices');
        const activeBefore = engine.feltPiano.voices.filter(v => v.isActive);
        assert.strictEqual(activeBefore.length, 24, 'All 24 voices must be actively sounding before panic');
        assert.strictEqual(engine._heldNotes.size, 24, '_heldNotes must contain 24 entries');

        // Verify that each voice has active timers or hold state
        for (const voice of engine.feltPiano.voices) {
          assert.strictEqual(voice.isHold, true, 'Voice should be in hold state');
        }

        // 2. Invoke Panic: engine.releaseAllNotes()
        engine.releaseAllNotes();

        // 3. Assert 100% deactivation across all 24 voices
        const activeAfter = engine.feltPiano.voices.filter(v => v.isActive);
        assert.strictEqual(activeAfter.length, 0, 'All 24 voices must have isActive === false immediately after panic');
        assert.strictEqual(engine._heldNotes.size, 0, 'engine._heldNotes must be cleared to 0');
        assert.strictEqual(engine._latchedNotes.size, 0, 'engine._latchedNotes must be cleared to 0');

        // 4. Assert zero hanging timers on any voice in pool
        for (const [idx, voice] of engine.feltPiano.voices.entries()) {
          assert.strictEqual(voice._decayTimer, null, `Voice #${idx} _decayTimer must be null`);
          assert.strictEqual(voice._releaseTimer, null, `Voice #${idx} _releaseTimer must be null`);
          assert.strictEqual(voice.isHold, false, `Voice #${idx} isHold must be reset to false`);
          assert.strictEqual(voice.isChord, false, `Voice #${idx} isChord must be reset to false`);

          // Verify gain declick ramp was scheduled
          const rampEvents = voice.voiceGain.gain.events.filter(e => e.type === 'linearRampToValueAtTime');
          assert.ok(rampEvents.length >= 1, `Voice #${idx} must schedule a linear declick ramp to 0`);
        }

        // 5. Simulate 100ms passage of time to confirm no deferred timer resurrection
        await new Promise(r => setTimeout(r, 100));
        const activeZombie = engine.feltPiano.voices.filter(v => v.isActive);
        assert.strictEqual(activeZombie.length, 0, 'Zero zombie voices may reactivate after panic');
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });

    it('Scenario 3.2: Panic under maximum polyphony with mixed chord and non-chord sustained voices deactivates all 24 voices', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        // 12 regular sustained voices
        for (let i = 0; i < 12; i++) {
          engine.noteOn(36 + i, 0.7, 20.0, true, false);
        }
        // 12 chord sustained voices
        for (let i = 12; i < 24; i++) {
          engine.noteOn(36 + i, 0.7, 20.0, true, true);
        }

        assert.strictEqual(engine.feltPiano.voices.filter(v => v.isActive).length, 24);

        // Execute panic
        engine.releaseAllNotes();

        assert.strictEqual(engine.feltPiano.voices.filter(v => v.isActive).length, 0);
        for (const voice of engine.feltPiano.voices) {
          assert.strictEqual(voice.isActive, false);
          assert.strictEqual(voice._decayTimer, null);
          assert.strictEqual(voice._releaseTimer, null);
        }
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });

    it('Scenario 3.3: Panic is idempotent and survives rapid consecutive panic calls', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        // Trigger 24 notes
        for (let i = 0; i < 24; i++) {
          engine.noteOn(40 + i, 0.7, 20.0, true);
        }

        // Rapidly call releaseAllNotes 10 times in a loop
        for (let i = 0; i < 10; i++) {
          assert.doesNotThrow(() => engine.releaseAllNotes(), `Panic call #${i} must not throw`);
        }

        assert.strictEqual(engine.feltPiano.voices.filter(v => v.isActive).length, 0);
        assert.strictEqual(engine._heldNotes.size, 0);
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });

    it('Scenario 3.4: Post-panic voice re-allocation operates cleanly and restores full polyphony', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        // 1. Saturate 24 notes
        for (let i = 0; i < 24; i++) {
          engine.noteOn(30 + i, 0.7, 20.0, true);
        }
        assert.strictEqual(engine.feltPiano.voices.filter(v => v.isActive).length, 24);

        // 2. Panic
        engine.releaseAllNotes();
        assert.strictEqual(engine.feltPiano.voices.filter(v => v.isActive).length, 0);

        // 3. Immediately re-allocate 24 new notes
        for (let i = 0; i < 24; i++) {
          const v = engine.noteOn(60 + i, 0.7, 20.0, true);
          assert.ok(v, `New note #${i} must be allocated a voice`);
          assert.strictEqual(v.isActive, true, `New voice #${i} must be active`);
        }

        assert.strictEqual(engine.feltPiano.voices.filter(v => v.isActive).length, 24);
        assert.strictEqual(engine._heldNotes.size, 24);

        // 4. Panic again
        engine.releaseAllNotes();
        assert.strictEqual(engine.feltPiano.voices.filter(v => v.isActive).length, 0);
        assert.strictEqual(engine._heldNotes.size, 0);
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });
  });
});
