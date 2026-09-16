/**
 * @file web-audio-audit-regressions.test.js
 * @brief Comprehensive Automated Regression Test Suite (Feature F10)
 * 
 * Verifies all 7 audit findings and regression criteria:
 * 1. Single keypress on playNote allocates exactly 1 voice in feltPiano (F01).
 * 2. Chord cluster strum allocates exactly N voices for an N-note chord, not 2N (F02).
 * 3. MIDI Note-On allocates exactly 1 voice and tracks it cleanly (F03).
 * 4. AudioEngine.releaseAllNotes() smoothly deactivates all active voices (F04).
 * 5. Generative Poisson & Phase Loops route through engine.noteOn/noteOff and keep drone gating synchronized (F05).
 * 6. Audio graph connections verify:
 *    masterBus -> masterDcBlocker -> masterGain -> masterCompressor -> masterTapeSaturator -> masterLimiter (F06).
 * 7. Shimmer freeze feedback loop includes DC blocking filter (F07).
 * 8. AudioParam fallback continuity (F08) and WaveShaper curve caching (F09).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { AudioEngine } from '../js/audio/engine.js';
import { FeltPianoSynthesizer, FeltPianoVoice } from '../js/audio/felt-piano.js';
import { SolarDroneVoice } from '../js/audio/drone-voice.js';
import { TapeDelay } from '../js/audio/tape-delay.js';
import { ShimmerReverb } from '../js/audio/shimmer-reverb.js';
import { BraunPlaySurface } from '../js/ui/keyboard.js';
import { BraunMidiManager } from '../js/midi/midi-manager.js';
import { midiToFrequency } from '../js/generative/scales.js';

// --- Mock Infrastructure for Node.js Headless Testing ---

class MockAudioParam {
  constructor(defaultValue = 0, getNow = null) {
    this.defaultValue = defaultValue;
    this._value = defaultValue;
    this.events = [];
    this.timeline = [];
    this.getNow = getNow;
  }
  get value() {
    if (typeof this.getNow === 'function') {
      return this.getValueAtTime(this.getNow());
    }
    return this._value;
  }
  set value(v) {
    this._value = v;
  }
  getValueAtTime(t) {
    if (this.timeline.length === 0) return this._value;
    let currentVal = this.defaultValue;
    for (let i = 0; i < this.timeline.length; i++) {
      const ev = this.timeline[i];
      if (ev.time > t) {
        if (ev.type === 'linearRamp') {
          const prev = this.timeline[i - 1];
          const prevTime = prev ? prev.time : 0;
          const prevVal = prev ? prev.value : this.defaultValue;
          const frac = (t - prevTime) / Math.max(1e-5, ev.time - prevTime);
          return prevVal + (ev.value - prevVal) * Math.max(0, Math.min(1, frac));
        } else if (ev.type === 'setTarget') {
          const prev = this.timeline[i - 1];
          const prevVal = prev ? prev.value : this.defaultValue;
          return ev.target + (prevVal - ev.target) * Math.exp(-(t - ev.time) / ev.tau);
        }
        break;
      }
      if (ev.type === 'setValue') currentVal = ev.value;
      else if (ev.type === 'linearRamp') currentVal = ev.value;
      else if (ev.type === 'setTarget') currentVal = ev.target + (currentVal - ev.target) * Math.exp(-(t - ev.time) / ev.tau);
    }
    return currentVal;
  }
  setValueAtTime(v, t) {
    this._value = v;
    this.timeline.push({ type: 'setValue', value: v, time: t });
    this.events.push({ type: 'setValueAtTime', v, t });
    return this;
  }
  setTargetAtTime(target, startTime, timeConstant) {
    this._value = target;
    this.timeline.push({ type: 'setTarget', target, value: target, time: startTime, tau: timeConstant });
    this.events.push({ type: 'setTargetAtTime', target, v: target, t: startTime, tau: timeConstant, startTime, timeConstant });
    return this;
  }
  linearRampToValueAtTime(v, t) {
    this._value = v;
    this.timeline.push({ type: 'linearRamp', value: v, time: t });
    this.events.push({ type: 'linearRampToValueAtTime', v, t });
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    this._value = v;
    this.timeline.push({ type: 'exponentialRamp', value: v, time: t });
    this.events.push({ type: 'exponentialRampToValueAtTime', v, t });
    return this;
  }
  cancelScheduledValues(t) {
    this.timeline = this.timeline.filter(e => e.time < t);
    this.events.push({ type: 'cancelScheduledValues', t });
    return this;
  }
  cancelAndHoldAtTime(t) {
    const valAtT = this.getValueAtTime(t);
    this.timeline = this.timeline.filter(e => e.time < t);
    this.timeline.push({ type: 'setValue', value: valAtT, time: t });
    this.events.push({ type: 'cancelAndHoldAtTime', t });
    return this;
  }
}

class MockAudioNode {
  constructor(name = 'node') {
    this.name = name;
    this.connectedTo = [];
    this.connections = this.connectedTo; // alias
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
    n.gain = new MockAudioParam(1.0, () => this.currentTime);
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
  querySelectorAll(sel) {
    const res = [];
    const walk = (el) => {
      for (const ch of (el.children || [])) {
        if (sel.startsWith('.') && ch.classList && ch.classList.contains(sel.slice(1))) res.push(ch);
        else if (sel.startsWith('#') && ch.getAttribute && ch.getAttribute('id') === sel.slice(1)) res.push(ch);
        walk(ch);
      }
    };
    walk(this);
    return res;
  }
}

// Ensure DOM mocks are installed for BraunPlaySurface
function setupDomMock() {
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

describe('Feature F10: Comprehensive Web Audio Audit Regressions', () => {

  describe('1. Single Keypress Voice Allocation De-duplication (F01)', () => {
    it('BraunPlaySurface.playNote allocates exactly 1 voice in engine.feltPiano', async () => {
      const teardownDom = setupDomMock();
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        let playNoteCalls = 0;
        const origPlayNote = engine.feltPiano.playNote.bind(engine.feltPiano);
        engine.feltPiano.playNote = function(...args) {
          playNoteCalls++;
          return origPlayNote(...args);
        };

        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');
        const surface = new BraunPlaySurface(mockStrip, mockChords, engine);

        // Trigger a single key press (Middle C, MIDI 60)
        const voice = surface.playNote(261.63, 60, 0.75, 3.5, false);

        assert.strictEqual(playNoteCalls, 1, 'feltPiano.playNote must be called exactly once, never twice');
        assert.ok(voice, 'playNote must return active voice reference');
        const activeVoices = engine.feltPiano.voices.filter(v => v.isActive);
        assert.strictEqual(activeVoices.length, 1, 'feltPiano must have exactly 1 active voice allocated');
        assert.ok(Math.abs(activeVoices[0].currentFreq - 261.63) < 0.01, 'Allocated voice must match key frequency');
        assert.strictEqual(engine._heldNotes.has(60), true, 'Note 60 must be in engine._heldNotes');

        engine.noteOff(60);
        assert.strictEqual(engine._heldNotes.has(60), false, 'Note 60 must be removed from engine._heldNotes');
      } finally {
        globalThis.AudioContext = origAudioContext;
        teardownDom();
      }
    });
  });

  describe('2. Chord Cluster Strum Polyphony (F02)', () => {
    it('BraunPlaySurface chord strumming allocates exactly N voices for N-note chord, not 2N', async () => {
      const teardownDom = setupDomMock();
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        let playNoteCalls = 0;
        const origPlayNote = engine.feltPiano.playNote.bind(engine.feltPiano);
        engine.feltPiano.playNote = function(...args) {
          playNoteCalls++;
          return origPlayNote(...args);
        };

        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');
        const surface = new BraunPlaySurface(mockStrip, mockChords, engine);
        surface.chordSpeed = 'fast';

        // Strum 'PLATEAUX_MAJ9' voicing (intervals: [0, 4, 7, 11, 14] -> 5 notes)
        const session = surface.startChord('PLATEAUX_MAJ9', true);

        // Await strum timers to complete
        await new Promise(r => setTimeout(r, 300));

        assert.strictEqual(playNoteCalls, 5, 'feltPiano.playNote must be called exactly 5 times for 5-note chord');
        assert.strictEqual(session.voices.length, 5, 'session.voices must track exactly 5 voices, not 10');
        const activeVoices = engine.feltPiano.voices.filter(v => v.isActive);
        assert.strictEqual(activeVoices.length, 5, 'feltPiano pool must have exactly 5 active voices');
        assert.ok(session.voices.every(v => v.isChord === true), 'All chord voices must have isChord === true');

        // Stop chord session
        surface.stopChordSession(session);
        assert.strictEqual(session.isReleased, true);
        assert.strictEqual(engine._heldNotes.size, 0, 'All chord notes must be removed from engine._heldNotes');
      } finally {
        globalThis.AudioContext = origAudioContext;
        teardownDom();
      }
    });
  });

  describe('3. MIDI Note-On Tracking & Voice Lifecycle (F03)', () => {
    it('MIDIManager._handleNoteOn allocates exactly 1 voice and releases cleanly on Note-Off', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        let playNoteCalls = 0;
        const origPlayNote = engine.feltPiano.playNote.bind(engine.feltPiano);
        engine.feltPiano.playNote = function(...args) {
          playNoteCalls++;
          return origPlayNote(...args);
        };

        const midiManager = new BraunMidiManager(engine);

        // Send Note-On: Note 60, velocity 90
        midiManager._handleNoteOn(60, 90);

        assert.strictEqual(playNoteCalls, 1, 'feltPiano.playNote must be called exactly ONCE');
        assert.strictEqual(midiManager.activeNotes.has(60), true);
        assert.strictEqual(midiManager.activeNotes.get(60).size, 1);
        const voice = midiManager.activeNotes.get(60).values().next().value;
        assert.strictEqual(voice.isActive, true);
        assert.strictEqual(engine._heldNotes.has(60), true);

        // Send Note-Off: Note 60
        midiManager._handleNoteOff(60);
        assert.strictEqual(midiManager.activeNotes.has(60), false, 'Active note 60 must be cleared');
        assert.strictEqual(engine._heldNotes.has(60), false, 'Held note 60 must be cleared in engine');
        assert.ok(voice._isReleased, 'Tracked voice must transition to released state');
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });
  });

  describe('4. AudioEngine.releaseAllNotes() Panic Deactivation (F04)', () => {
    it('deactivates all active voices smoothly and clears timers in feltPiano', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        // Play 4 active notes
        engine.noteOn(60, 0.7, 20.0, true);
        engine.noteOn(64, 0.7, 20.0, true);
        engine.noteOn(67, 0.7, 20.0, true);
        engine.noteOn(72, 0.7, 20.0, true);

        const activeBefore = engine.feltPiano.voices.filter(v => v.isActive);
        assert.strictEqual(activeBefore.length, 4, 'Four voices must be active before panic');

        // Trigger Panic / releaseAllNotes
        engine.releaseAllNotes();

        const activeAfter = engine.feltPiano.voices.filter(v => v.isActive);
        assert.strictEqual(activeAfter.length, 0, 'All voices must be inactive after releaseAllNotes()');
        assert.strictEqual(engine._heldNotes.size, 0, '_heldNotes must be cleared');
        assert.strictEqual(engine._latchedNotes.size, 0, '_latchedNotes must be cleared');

        // Verify timers are cleared
        for (const voice of engine.feltPiano.voices) {
          assert.strictEqual(voice._decayTimer, null, '_decayTimer must be cleared');
          assert.strictEqual(voice._releaseTimer, null, '_releaseTimer must be cleared');
        }
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });
  });

  describe('5. Generative Drone Sync (F05)', () => {
    it('generative notes route through engine.noteOn and gate drones open', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();
        engine.setDroneTrackMidi(true);

        assert.strictEqual(engine._heldNotes.size, 0);

        // Trigger generative note via engine.noteOn (as wired in app.js)
        const midi = 62;
        engine.noteOn(midi, 0.7, 3.5);

        assert.strictEqual(engine._heldNotes.has(midi), true, '_heldNotes must track generative note');
        assert.strictEqual(engine.drone1Freq, midiToFrequency(38, engine.a4), 'drone1Freq must track generative note pitch in bass octave');

        // Note-off
        engine.noteOff(midi);
        assert.strictEqual(engine._heldNotes.has(midi), false, '_heldNotes must be cleared after noteOff');
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });
  });

  describe('6. Master DC Stage Relocation (F06)', () => {
    it('verifies masterBus -> masterDcBlocker -> masterGain -> masterCompressor -> masterTapeSaturator -> masterLimiter', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        assert.ok(engine.masterBus, 'engine.masterBus must exist');
        assert.ok(engine.masterDcBlocker, 'engine.masterDcBlocker must exist');
        assert.ok(engine.masterGain, 'engine.masterGain must exist');
        assert.ok(engine.masterCompressor, 'engine.masterCompressor must exist');
        assert.ok(engine.masterTapeSaturator, 'engine.masterTapeSaturator must exist');
        assert.ok(engine.masterLimiter, 'engine.masterLimiter must exist');

        // Verify routing chain: masterBus -> masterDcBlocker -> masterGain -> masterCompressor -> masterTapeSaturator -> masterLimiter -> analyser
        assert.ok(engine.masterBus.connectedTo.includes(engine.masterDcBlocker), 'masterBus must connect to masterDcBlocker');
        assert.ok(engine.masterDcBlocker.connectedTo.includes(engine.masterGain), 'masterDcBlocker must connect to masterGain');
        assert.ok(engine.masterGain.connectedTo.includes(engine.masterCompressor), 'masterGain must connect to masterCompressor');
        assert.ok(engine.masterCompressor.connectedTo.includes(engine.masterTapeSaturator), 'masterCompressor must connect to masterTapeSaturator');
        assert.ok(engine.masterTapeSaturator.connectedTo.includes(engine.masterLimiter), 'masterTapeSaturator must connect to masterLimiter');
        assert.ok(engine.masterLimiter.connectedTo.includes(engine.analyser), 'masterLimiter must connect to analyser');

        // Verify DC Blocker is highpass at 15 Hz
        assert.strictEqual(engine.masterDcBlocker.type, 'highpass');
        assert.strictEqual(engine.masterDcBlocker.frequency.value, 15);
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });
  });

  describe('7. Reverb Freeze DC Blocker (F07)', () => {
    it('includes dual 25 Hz highpass DC blocking filters within the freeze feedback loop', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const ctx = new MockContext();
        const rev = new ShimmerReverb(ctx);

        assert.ok(rev.freezeHpFilterL, 'freezeHpFilterL must exist');
        assert.ok(rev.freezeHpFilterR, 'freezeHpFilterR must exist');
        assert.ok(rev.freezeDcBlocker, 'freezeDcBlocker alias must exist');
        assert.strictEqual(rev.freezeHpFilterL.type, 'highpass');
        assert.strictEqual(rev.freezeHpFilterL.frequency.value, 25);
        assert.strictEqual(rev.freezeHpFilterR.type, 'highpass');
        assert.strictEqual(rev.freezeHpFilterR.frequency.value, 25);

        // Verify cross-feed routing includes the filters
        assert.ok(rev.freezeFeedbackL.connectedTo.includes(rev.freezeHpFilterL), 'freezeFeedbackL must connect to freezeHpFilterL');
        assert.ok(rev.freezeHpFilterL.connectedTo.includes(rev.freezeDelayR), 'freezeHpFilterL must connect to freezeDelayR');
        assert.ok(rev.freezeFeedbackR.connectedTo.includes(rev.freezeHpFilterR), 'freezeFeedbackR must connect to freezeHpFilterR');
        assert.ok(rev.freezeHpFilterR.connectedTo.includes(rev.freezeDelayL), 'freezeHpFilterR must connect to freezeDelayL');
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });
  });

  describe('8. AudioParam Fallback Continuity (F08)', () => {
    it('prevents step pops in DroneVoice when cancelAndHoldAtTime fallback executes', () => {
      const ctx = new MockContext();
      const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

      // Simulate environment where cancelAndHoldAtTime is missing
      drone.voiceGain.gain.cancelAndHoldAtTime = undefined;
      drone.setActive(true);

      drone.setVolume(0.8);
      ctx.currentTime = 2.0;

      // Trigger declick transition
      drone.declickTransition(0.045);

      const events = drone.voiceGain.gain.events;
      const setVal = events.find(e => e.type === 'setValueAtTime' && e.t === 2.0);
      assert.ok(setVal, 'Fallback must call setValueAtTime at cancelTime');
      assert.ok(setVal.v > 0 && setVal.v <= 1.0, 'Fallback setValueAtTime must use valid instantaneous gain, not 0 or unanchored');

      // Mid-transition second declick: verify no jump to target volume
      ctx.currentTime = 2.015; // In mid-dip
      drone.declickTransition(0.045);
      const midEvents = drone.voiceGain.gain.events.filter(e => e.type === 'setValueAtTime' && e.t === 2.015);
      if (midEvents.length > 0) {
        assert.ok(midEvents[0].v < 0.8, 'Mid-transition fallback must anchor at in-flight dip gain, not target 0.8');
      }
    });

    it('anchors wow/flutter gain parameters on cancelScheduledValues fallback in TapeDelay', () => {
      const ctx = new MockContext();
      const delay = new TapeDelay(ctx);

      delay.wowGainL.gain.cancelAndHoldAtTime = undefined;
      delay.wowGainR.gain.cancelAndHoldAtTime = undefined;
      delay.flutterGainL.gain.cancelAndHoldAtTime = undefined;
      delay.flutterGainR.gain.cancelAndHoldAtTime = undefined;

      ctx.currentTime = 3.0;
      delay._updateWowFlutterHeadroom(true);

      const wowEvents = delay.wowGainL.gain.events;
      const setVal = wowEvents.find(e => e.type === 'setValueAtTime' && e.t === 3.0);
      assert.ok(setVal, 'TapeDelay wowGainL fallback must explicitly anchor via setValueAtTime before setTargetAtTime');
    });

    it('anchors at prevGain and does not jump instantaneously to 0.0001 when calling setActive(false) on sounding voice', () => {
      const ctx = new MockContext();
      const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

      // Force fallback path by simulating environment lacking cancelAndHoldAtTime
      drone.voiceGain.gain.cancelAndHoldAtTime = undefined;
      drone.setActive(true);
      drone.setVolume(0.8);

      // Advance time to steady-state sounding
      ctx.currentTime = 2.0;

      // Verify sounding gain before deactivation
      const initialGain = drone._getInstantGain(ctx.currentTime);
      assert.ok(Math.abs(initialGain - 0.8) < 0.01, `Voice must be sounding near 0.8 before deactivation, got ${initialGain}`);

      // Call setActive(false) on sounding voice
      drone.setActive(false);

      // 1. Fallback path must call cancelScheduledValues at currentTime
      const cancelEvents = drone.voiceGain.gain.events.filter(e => e.type === 'cancelScheduledValues' && e.t === 2.0);
      assert.ok(cancelEvents.length > 0, 'Fallback path must call cancelScheduledValues at currentTime');

      // 2. setValueAtTime must anchor at prevGain (~0.8), NOT cliff drop to 0.0001
      const setValEvents = drone.voiceGain.gain.events.filter(e => e.type === 'setValueAtTime' && e.t === 2.0);
      assert.ok(setValEvents.length > 0, 'Fallback path must call setValueAtTime to anchor gain at currentTime');

      const anchorGain = setValEvents[setValEvents.length - 1].v;
      assert.notStrictEqual(
        anchorGain,
        0.0001,
        'Calling setActive(false) must not anchor at 0.0001 (cliff drop pop!)'
      );
      assert.ok(
        anchorGain >= 0.79,
        `Calling setActive(false) must anchor at previous sounding gain (~0.8), but anchored at ${anchorGain}`
      );

      // 3. Smooth release envelope: setTargetAtTime must target 0.0 with 60ms time constant
      const targetEvents = drone.voiceGain.gain.events.filter(e => e.type === 'setTargetAtTime' && e.t === 2.0);
      assert.ok(targetEvents.length > 0, 'Must schedule setTargetAtTime fade to 0.0 on setActive(false)');
      assert.strictEqual(targetEvents[targetEvents.length - 1].target, 0.0, 'Fade target must be 0.0');
      assert.strictEqual(targetEvents[targetEvents.length - 1].tau, 0.06, 'Fade time constant must be 0.06s (60ms)');
    });

    it('resets declick state and anchors continuously without step jumps > 0.001 when calling setVolume during in-flight declick transition', () => {
      const ctx = new MockContext();
      const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

      drone.voiceGain.gain.cancelAndHoldAtTime = undefined;
      drone.setActive(true);
      drone.setVolume(0.8);
      ctx.currentTime = 2.0;

      // Start declick transition
      drone.declickTransition(0.045);
      assert.ok(drone._declickEndTime > 2.0, 'Declick transition must be active with _declickEndTime set');
      assert.ok(drone._declickingUntil > 2.0, '_declickingUntil must be active');

      // Mid-dip knob adjustment (t = 2.015)
      ctx.currentTime = 2.015;
      const valBefore1 = drone.voiceGain.gain.getValueAtTime(2.015);
      drone.setVolume(0.5);
      const valAfter1 = drone.voiceGain.gain.getValueAtTime(2.015);

      // 1. Verify declick state is cleared immediately upon setVolume
      assert.strictEqual(drone._declickEndTime, null, 'setVolume(v) must reset _declickEndTime to null');
      assert.strictEqual(drone._declickingUntil, null, 'setVolume(v) must reset _declickingUntil to null');

      // 2. Verify continuity at adjustment point
      const stepJump1 = Math.abs(valAfter1 - valBefore1);
      assert.ok(stepJump1 <= 0.001, `Gain at adjustment moment must be continuous (jump <= 0.001), got ${stepJump1}`);

      // 3. Interleaved subsequent knob adjustment within the old declick window (t = 2.020)
      ctx.currentTime = 2.020;
      const valBefore2 = drone.voiceGain.gain.getValueAtTime(2.020);
      drone.setVolume(0.6);
      const valAfter2 = drone.voiceGain.gain.getValueAtTime(2.020);
      const stepJump2 = Math.abs(valAfter2 - valBefore2);
      assert.ok(
        stepJump2 <= 0.001,
        `Interleaved volume adjustment must anchor continuously without step jumps > 0.001, got ${stepJump2}`
      );

      // 4. Multi-step rapid knob scrubbing stress test across 50 steps
      let maxScrubJump = 0;
      let t = 2.025;
      for (let step = 0; step < 50; step++) {
        t += 0.002;
        ctx.currentTime = t;
        const vBefore = drone.voiceGain.gain.getValueAtTime(t);
        if (step % 3 === 0) {
          drone.declickTransition(0.035);
        } else {
          drone.setVolume(0.2 + (step % 5) * 0.12);
        }
        const vAfter = drone.voiceGain.gain.getValueAtTime(t);
        maxScrubJump = Math.max(maxScrubJump, Math.abs(vAfter - vBefore));
      }
      assert.ok(
        maxScrubJump <= 0.001,
        `Max step jump across rapid knob scrub must be <= 0.001, got ${maxScrubJump}`
      );
    });
  });

  describe('9. WaveShaper Live Curve Drag Caching & De-noising (F09)', () => {
    it('reuses pre-computed Float32Array curves from bank without dynamic re-allocation', () => {
      const ctx = new MockContext();
      const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

      drone.setWavefold(1.5, 0.4);
      const curve1 = drone.shaper.curve;
      assert.ok(curve1 instanceof Float32Array);
      assert.strictEqual(curve1.length, 2048);

      // Call again with same parameters
      drone.setWavefold(1.5, 0.4);
      const curve2 = drone.shaper.curve;
      assert.strictEqual(curve2, curve1, 'Must reuse identical cached Float32Array reference for duplicate parameters');

      // Rapid sweep across 20 values simulating live drag
      const curveRefs = [];
      for (let i = 0; i <= 20; i++) {
        drone.setWavefold(1.0 + i * 0.05, i * 0.02);
        curveRefs.push(drone.shaper.curve);
      }
      assert.strictEqual(curveRefs.length, 21);
      assert.ok(curveRefs.every(c => c instanceof Float32Array));
    });
  });

  describe('10. noteOn Signature & isChord Propagation', () => {
    it('AudioEngine.prototype.noteOn forwards isChord flag to FeltPianoSynthesizer', async () => {
      const origAudioContext = globalThis.AudioContext;
      globalThis.AudioContext = class extends MockContext {};

      try {
        const engine = new AudioEngine();
        await engine.init();

        // Test noteOn with isChord = true
        const chordVoice = engine.noteOn(60, 0.7, 20.0, true, true);
        assert.ok(chordVoice);
        assert.strictEqual(chordVoice.isChord, true, 'isChord flag must be forwarded and stored on voice');

        // Test default noteOn with isChord omitted (defaults to false)
        const regularVoice = engine.noteOn(64, 0.7, 3.5, false);
        assert.ok(regularVoice);
        assert.strictEqual(regularVoice.isChord, false, 'isChord must default to false');

        engine.releaseAllNotes();
      } finally {
        globalThis.AudioContext = origAudioContext;
      }
    });
  });
});
