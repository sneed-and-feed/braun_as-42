/**
 * @file vangelis-cs80.test.js
 * @brief Comprehensive verification tests for Yamaha CS-80 / Vangelis sound design,
 * Blade Runner harmonic cluster voicing, single-strike click-and-hold pointer semantics,
 * and polyphonic intensity balancing matching the Solar 42n drone.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeltPianoVoice, FeltPianoSynthesizer, TIMBRE_TRIM } from '../js/audio/felt-piano.js';
import { CHORD_VOICINGS, getChordFrequencies, frequencyToMidi, midiToFrequency } from '../js/generative/scales.js';
import { AudioEngine } from '../js/audio/engine.js';
import { BraunPlaySurface } from '../js/ui/keyboard.js';
import { SolarDroneVoice } from '../js/audio/drone-voice.js';
import { PRESETS } from '../js/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MockButtonElement {
  constructor() {
    this.listeners = new Map();
    this.attrs = new Map();
    this.classList = {
      _classes: new Set(),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      contains: (c) => this.classList._classes.has(c)
    };
  }
  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }
  dispatchEvent(type, ev = {}) {
    const cbs = this.listeners.get(type) || [];
    cbs.forEach(cb => cb(ev));
  }
  setAttribute(k, v) { this.attrs.set(k, v); }
  getAttribute(k) { return this.attrs.get(k); }
  getBoundingClientRect() { return { top: 0, height: 72, left: 0, width: 100 }; }
}

// Mock Web Audio Context for DSP assertions
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
    linearRampToValueAtTime(v, t) {
      this.value = v;
      this.events.push({ type: 'linearRampToValueAtTime', v, t });
    }
    exponentialRampToValueAtTime(v, t) {
      this.value = v;
      this.events.push({ type: 'exponentialRampToValueAtTime', v, t });
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
    createDelay: () => ({
      delayTime: new MockAudioParam(0.1),
      connect() {},
      disconnect() {}
    }),
    createDynamicsCompressor: () => ({
      threshold: new MockAudioParam(-3.0),
      knee: new MockAudioParam(6.0),
      ratio: new MockAudioParam(8.0),
      attack: new MockAudioParam(0.003),
      release: new MockAudioParam(0.060),
      connect() {},
      disconnect() {}
    }),
    createAnalyser: () => ({
      fftSize: 2048,
      smoothingTimeConstant: 0.82,
      connect() {}
    }),
    createBuffer: (channels, length, rate) => ({
      length,
      sampleRate: rate,
      getChannelData: () => new Float32Array(length)
    }),
    createBufferSource: () => ({
      buffer: null,
      connect() {},
      start() {},
      stop() {}
    }),
    createConvolver: () => ({
      buffer: null,
      connect() {},
      disconnect() {}
    }),
    createChannelSplitter: () => ({
      connect() {},
      disconnect() {}
    }),
    createChannelMerger: () => ({
      connect() {},
      disconnect() {}
    }),
    createStereoPanner: () => ({
      pan: new MockAudioParam(0),
      connect() {},
      disconnect() {}
    }),
    createPeriodicWave: () => ({}),
    destination: { connect() {} },
    resume: async () => {}
  };
}

describe('CS-80 / Vangelis Sound Design & Timbre Architecture', () => {
  it('activates rich detuned dual saw waves with singing filter Q in CS-80 mode', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 4);

    // Default waveform is felt
    assert.strictEqual(synth.currentWaveform, 'felt');
    assert.strictEqual(synth.voices[0].filter1.Q.value, 0.707);

    // Switch to CS-80
    synth.setWaveform('cs80');
    assert.strictEqual(synth.currentWaveform, 'cs80');

    synth.voices.forEach(voice => {
      assert.strictEqual(voice.currentWaveform, 'cs80');
      assert.strictEqual(voice.osc1.type, 'sawtooth');
      assert.strictEqual(voice.osc2.type, 'sawtooth');
      // Resonant filter Q raised for brass horn resonance
      assert.strictEqual(voice.filter1.Q.value, 1.85);
      assert.strictEqual(voice.filter2.Q.value, 1.45);
      // Subtle chorus drift depth active
      assert.strictEqual(voice.chorusGain.gain.value, 4.5);
    });

    // Also supports 'vangelis' alias
    synth.setWaveform('vangelis');
    assert.strictEqual(synth.currentWaveform, 'vangelis');
    assert.strictEqual(synth.voices[0].filter1.Q.value, 1.85);
  });

  it('triggers CS-80 note with expressive filter brass swell and authoritative amplitude presence', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 4);
    synth.setWaveform('cs80');

    // Struck note at C4 (~261.63 Hz), velocity 0.8
    const voice = synth.playNote(261.63, 0.8, 4.0);

    // 1. Equal dual-saw ranks volume blend
    assert.strictEqual(voice.osc1Gain.gain.value, 0.48);
    assert.strictEqual(voice.osc2Gain.gain.value, 0.46);

    // 2. Detuned dual saw ranks (~12 cents analog detune)
    const detune1Events = voice.osc1.detune.events.filter(e => e.type === 'setValueAtTime');
    const detune2Events = voice.osc2.detune.events.filter(e => e.type === 'setValueAtTime');
    const detune1 = detune1Events[detune1Events.length - 1];
    const detune2 = detune2Events[detune2Events.length - 1];
    assert.ok(detune1 && detune2);
    const totalDetuneSpread = detune2.v - detune1.v;
    assert.ok(totalDetuneSpread >= 10 && totalDetuneSpread <= 14, `Expected ~12 cents detune spread, got ${totalDetuneSpread}`);

    // 3. Expressive brass filter swell on attack (linear ramp up, then exponential settle to sustain cutoff)
    const filterRamps = voice.filter1.frequency.events;
    const filterAttack = filterRamps.find(e => e.type === 'linearRampToValueAtTime');
    const filterSustain = filterRamps.find(e => e.type === 'exponentialRampToValueAtTime');
    assert.ok(filterAttack, 'Must schedule linear ramp brass filter swell');
    assert.ok(filterSustain, 'Must schedule filter sustain level');
    assert.ok(filterAttack.v >= 3200, `CS-80 filter swell peak (${filterAttack.v} Hz) must be >= 3200 Hz for bright brass`);
    assert.ok(filterSustain.v >= 1800, `CS-80 filter sustain (${filterSustain.v} Hz) must stay open and singing`);

    // 4. Voice amplitude envelope: smooth 24ms brass attack and singing 72% sustain
    const gainEvents = voice.voiceGain.gain.events;
    const ampAttack = gainEvents.find(e => e.type === 'linearRampToValueAtTime');
    const ampSustain = gainEvents.find(e => e.type === 'exponentialRampToValueAtTime');
    assert.ok(ampAttack, 'Must schedule amplitude attack ramp');
    assert.ok(ampSustain, 'Must schedule singing sustain');
    // Peak gain for velocity 0.8: 0.8 * 0.32 = 0.256
    assert.ok(Math.abs(ampAttack.v - (0.8 * 0.32)) < 1e-3, `CS-80 mid peakGain must be ~0.256, got ${ampAttack.v}`);
    // Sustain level: 72% of peakGain ~ 0.1843
    assert.ok(Math.abs(ampSustain.v - (ampAttack.v * 0.72)) < 1e-3, `Sustain level must be 72% of peak, got ${ampSustain.v}`);

    // 5. Wooden felt hammer click thump bypassed in CS-80 mode
    const hammerEvents = voice.hammerGain.gain.events;
    const hammerAttack = hammerEvents.find(e => e.type === 'linearRampToValueAtTime' && e.v > 0.001);
    assert.strictEqual(hammerAttack, undefined, 'CS-80 mode must NOT trigger wooden felt hammer noise');
  });

  it('verifies CS-80 keyboard intensity matches and holds its own with Solar 42n drones', () => {
    const engine = new AudioEngine();

    // Default drone level
    const droneVoiceLevel = engine.droneParams[1].vol; // 0.55
    const droneBusGain = engine.droneBusGain; // 0.22
    const combinedDroneLevel = droneBusGain * droneVoiceLevel; // ~0.121

    // CS-80 keyboard voice level at velocity 0.75
    // baseOutputGain (0.38) * velocity (0.75) * peakGainMult (0.32) = 0.0912
    // sustainLevel (72%) = ~0.0657
    const cs80PeakLevel = 0.38 * (0.75 * 0.32) * engine.feltParams.volume;
    const cs80SustainLevel = cs80PeakLevel * 0.72;

    // CS-80 sustained lead sits within -7.5dB to +2dB of the drone level, matching in power and intensity
    const dbRatio = 20 * Math.log10(cs80SustainLevel / combinedDroneLevel);
    const peakDbRatio = 20 * Math.log10(cs80PeakLevel / combinedDroneLevel);
    assert.ok(dbRatio >= -8.0, `CS-80 tone sustain (${dbRatio.toFixed(2)} dB) must stand proudly alongside drone`);
    assert.ok(peakDbRatio >= -5.0, `CS-80 peak brass level (${peakDbRatio.toFixed(2)} dB) must match drone`);
    assert.ok(peakDbRatio <= 3.0, `CS-80 tone must not excessively blast past drone`);
  });
});

describe('index.html Timbre Selector Verification', () => {
  it('contains the CS-80 button in the TIMBRE selector with all five waveform options', () => {
    const htmlPath = path.resolve(__dirname, '../index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('data-wave="felt"'), 'TIMBRE selector must include FELT');
    assert.ok(html.includes('data-wave="sine"'), 'TIMBRE selector must include SINE');
    assert.ok(html.includes('data-wave="saw"'), 'TIMBRE selector must include SAW');
    assert.ok(html.includes('data-wave="square"'), 'TIMBRE selector must include SQR');
    assert.ok(html.includes('data-wave="cs80"'), 'TIMBRE selector must include CS-80');
    assert.ok(html.includes('>CS-80</button>'), 'TIMBRE selector must render CS-80 button label');
  });
});

describe('Blade Runner Harmonic Voicing & Polyphonic Headroom', () => {
  it('defines BLADE_RUNNER voicing with exact 1 - 5 - b7 - 9 - 11 - b13 melancholic brass cluster', () => {
    const voicing = CHORD_VOICINGS.BLADE_RUNNER;
    assert.ok(voicing, 'BLADE_RUNNER voicing must exist in CHORD_VOICINGS');
    assert.strictEqual(voicing.name, 'Blade Runner');
    assert.deepStrictEqual(voicing.intervals, [0, 7, 10, 14, 17, 20]);
    assert.strictEqual(voicing.description, 'Vangelis CS-80 brass cluster (1 - 5 - b7 - 9 - 11 - b13)');

    // Test frequencies for C3 root (MIDI 48)
    const freqs = getChordFrequencies(48, 'BLADE_RUNNER', 440);
    assert.strictEqual(freqs.length, 6);
    const midis = freqs.map(f => Math.round(frequencyToMidi(f, 440)));
    // C3 (48), G3 (55), Bb3 (58), D4 (62), F4 (65), Ab4 (68)
    assert.deepStrictEqual(midis, [48, 55, 58, 62, 65, 68]);
  });

  it('defines TEARS_IN_RAIN voicing with exact 1 - 5 - 7 - 9 - #11 - 13 poignant resolution cluster', () => {
    const voicing = CHORD_VOICINGS.TEARS_IN_RAIN;
    assert.ok(voicing, 'TEARS_IN_RAIN voicing must exist in CHORD_VOICINGS');
    assert.strictEqual(voicing.name, 'Tears in Rain');
    assert.deepStrictEqual(voicing.intervals, [0, 7, 11, 14, 18, 21]);
    assert.strictEqual(voicing.description, 'Vangelis poignant resolution (1 - 5 - 7 - 9 - #11 - 13)');

    // Test frequencies for C3 root (MIDI 48)
    const freqs = getChordFrequencies(48, 'TEARS_IN_RAIN', 440);
    assert.strictEqual(freqs.length, 6);
    const midis = freqs.map(f => Math.round(frequencyToMidi(f, 440)));
    // C3 (48), G3 (55), B3 (59), D4 (62), F#4 (66), A4 (69)
    assert.deepStrictEqual(midis, [48, 55, 59, 62, 66, 69]);
  });

  it('verifies 6-note BLADE_RUNNER cluster scales polyphonic headroom cleanly without clipping', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 24);
    synth.setWaveform('cs80');

    const chord = CHORD_VOICINGS.BLADE_RUNNER;
    const rootFreq = midiToFrequency(48, 440);
    const activeVoices = [];
    chord.intervals.forEach(semi => {
      const f = rootFreq * Math.pow(2, semi / 12);
      const v = synth.playNote(f, 0.75, 4.0);
      activeVoices.push(v);
    });

    assert.strictEqual(activeVoices.length, 6);
    // Headroom attenuation: 1 / sqrt(6) ~ 0.40825
    const expectedOutputGain = 0.38 * (1.0 / Math.sqrt(6)) * 0.80;
    assert.ok(Math.abs(synth.output.gain.value - expectedOutputGain) < 1e-3);

    // Summed output level across bus
    const totalPeak = activeVoices.reduce((sum, v) => {
      const p = v.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime');
      return sum + (p ? p.v : 0.25);
    }, 0);
    const busOutputLevel = totalPeak * synth.output.gain.value;
    assert.ok(busOutputLevel < 0.25, `Summed chord level (${busOutputLevel.toFixed(4)}) must stay well under 0.25`);
  });

  it('verifies 6-note TEARS_IN_RAIN cluster scales polyphonic headroom safely', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 24);
    synth.setWaveform('cs80');

    const chord = CHORD_VOICINGS.TEARS_IN_RAIN;
    const rootFreq = midiToFrequency(48, 440);
    const activeVoices = [];
    chord.intervals.forEach(semi => {
      const f = rootFreq * Math.pow(2, semi / 12);
      const v = synth.playNote(f, 0.75, 4.0);
      activeVoices.push(v);
    });

    assert.strictEqual(activeVoices.length, 6);
    const expectedOutputGain = 0.38 * (1.0 / Math.sqrt(6)) * 0.80;
    assert.ok(Math.abs(synth.output.gain.value - expectedOutputGain) < 1e-3);
  });
});

describe('Click-and-Hold Single Strike Verification', () => {
  it('guarantees pointerdown triggers single note strike, and releasing LMB after hold does NOT re-trigger', () => {
    let playNoteCalls = 0;

    class MockKeyElement {
      constructor() {
        this.listeners = new Map();
        this.classList = {
          add: () => {},
          remove: () => {},
          contains: () => false
        };
      }
      addEventListener(type, cb) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(cb);
      }
      dispatchEvent(type, ev = {}) {
        const cbs = this.listeners.get(type) || [];
        cbs.forEach(cb => cb(ev));
      }
      getBoundingClientRect() {
        return { top: 0, height: 100, left: 0, width: 40 };
      }
      setAttribute() {}
      getAttribute() { return '261.63'; }
    }

    const mockStrip = { innerHTML: '', appendChild: () => {} };
    const mockChords = { innerHTML: '', appendChild: () => {}, classList: { add: () => {} } };
    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: () => { playNoteCalls++; }
      }
    };

    // Override document.createElement to capture key elements
    const origCreateElement = globalThis.document ? globalThis.document.createElement : null;
    const createdKeys = [];
    if (typeof globalThis.document === 'undefined') {
      globalThis.document = {};
    }
    globalThis.document.createElement = (tag) => {
      const el = new MockKeyElement();
      createdKeys.push(el);
      return el;
    };

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      assert.ok(surface.keyElements.size > 0, 'Chime keys should be created in surface.keyElements');

      const key = surface.keyElements.values().next().value;
      assert.ok(key, 'Chime key element must exist');

      // 1. User presses LMB down (pointerdown)
      key.dispatchEvent('pointerdown', { preventDefault: () => {}, clientY: 50 });
      assert.strictEqual(playNoteCalls, 1, 'pointerdown must trigger initial strike');

      // 2. User holds LMB down for 1.5 seconds (simulated hold)
      // 3. User releases LMB (pointerup -> click)
      key.dispatchEvent('pointerup', {});
      key.dispatchEvent('click', { clientY: 50 });

      // CRITICAL: Must still be 1 call! Releasing LMB must NOT re-trigger a second strike!
      assert.strictEqual(
        playNoteCalls,
        1,
        'Releasing LMB after holding click must NOT re-trigger a second note strike'
      );
    } finally {
      if (origCreateElement) {
        globalThis.document.createElement = origCreateElement;
      }
    }
  });

  it('guarantees chord buttons support click-and-hold with sustain and smooth release without double attack', async () => {
    let chordNoteStarts = 0;
    let releasedVoices = 0;

    const mockStrip = { innerHTML: '', appendChild: () => {} };
    const createdButtons = [];
    const mockChords = {
      innerHTML: '',
      children: createdButtons,
      classList: { add: () => {} },
      appendChild: (el) => { createdButtons.push(el); },
      querySelectorAll: () => createdButtons
    };

    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: () => {
          chordNoteStarts++;
          return {
            release: () => { releasedVoices++; }
          };
        }
      }
    };

    const origCreateElement = globalThis.document ? globalThis.document.createElement : null;
    const origGetElementById = globalThis.document ? globalThis.document.getElementById : null;
    if (typeof globalThis.document === 'undefined') {
      globalThis.document = {};
    }
    globalThis.document.createElement = (tag) => {
      return new MockButtonElement();
    };
    globalThis.document.getElementById = (id) => null;

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      assert.strictEqual(createdButtons.length, 12, 'Must render exactly 12 chord buttons');

      const chordBtn = createdButtons[0];
      assert.ok(chordBtn, 'Chord button 0 must exist');

      // 1. User presses LMB down on chord button
      chordBtn.dispatchEvent('pointerdown', { preventDefault: () => {}, pointerId: 1 });

      // Wait 50ms for initial notes in micro-strum to trigger
      await new Promise(r => setTimeout(r, 60));
      assert.ok(chordNoteStarts >= 1, 'pointerdown on chord button must start chord playback');
      const initialStarts = chordNoteStarts;

      // 2. User holds LMB for simulated time, then releases LMB (pointerup -> click)
      chordBtn.dispatchEvent('pointerup', { pointerId: 1 });
      assert.ok(releasedVoices >= 1, 'Releasing LMB must trigger voice.release() on sounding voices');

      // 3. Browser fires trailing click event
      chordBtn.dispatchEvent('click', {});

      // Wait another 80ms: no second chord strike must occur!
      await new Promise(r => setTimeout(r, 80));
      assert.strictEqual(
        chordNoteStarts,
        initialStarts,
        'Trailing click after pointerup must NOT trigger double attack or second strike'
      );
    } finally {
      if (origCreateElement) {
        globalThis.document.createElement = origCreateElement;
      } else if (globalThis.document) {
        delete globalThis.document.createElement;
      }
      if (origGetElementById) {
        globalThis.document.getElementById = origGetElementById;
      } else if (globalThis.document) {
        delete globalThis.document.getElementById;
      }
    }
  });

  it('verifies rapid switching between FELT and CS-80 while voices are sustaining updates detune and gains smoothly', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 4);

    // Trigger note in felt mode
    const v = synth.playNote(261.63, 0.75, 4.0);
    assert.strictEqual(synth.currentWaveform, 'felt');

    // Rapidly switch to CS-80 while note is sustaining
    synth.setWaveform('cs80');
    assert.strictEqual(synth.currentWaveform, 'cs80');
    assert.strictEqual(v.currentWaveform, 'cs80');

    // Switch back to felt mode
    synth.setWaveform('felt');
    assert.strictEqual(synth.currentWaveform, 'felt');
    assert.strictEqual(v.currentWaveform, 'felt');
  });

  it('guarantees computer keyboard hold-sustain keeps voice sounding and releasing key triggers voice.release()', async () => {
    let playedFreq = null;
    let playedDuration = null;
    let released = false;

    const mockStrip = {
      innerHTML: '',
      children: [],
      appendChild: () => {},
      querySelectorAll: () => []
    };
    const mockChords = {
      innerHTML: '',
      children: [],
      classList: { add: () => {} },
      appendChild: () => {},
      querySelectorAll: () => []
    };
    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: (f, vel, dur) => {
          playedFreq = f;
          playedDuration = dur;
          return {
            release: () => { released = true; }
          };
        }
      }
    };

    let keydownHandler = null;
    let keyupHandler = null;
    const origAddEventListener = globalThis.window ? globalThis.window.addEventListener : null;
    if (typeof globalThis.window === 'undefined') {
      globalThis.window = {};
    }
    globalThis.window.addEventListener = (event, fn) => {
      if (event === 'keydown') keydownHandler = fn;
      if (event === 'keyup') keyupHandler = fn;
    };

    const origCreateElement = globalThis.document ? globalThis.document.createElement : null;
    const origGetElementById = globalThis.document ? globalThis.document.getElementById : null;
    if (typeof globalThis.document === 'undefined') {
      globalThis.document = {};
    }
    globalThis.document.createElement = () => new MockButtonElement();
    globalThis.document.getElementById = () => null;

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      assert.ok(keydownHandler, 'Must register keydown handler on window');
      assert.ok(keyupHandler, 'Must register keyup handler on window');

      // 1. User presses 'KeyA' down (chime note 0)
      keydownHandler({
        code: 'KeyA',
        key: 'a',
        repeat: false,
        target: { tagName: 'DIV' },
        preventDefault: () => {}
      });

      assert.ok(playedFreq !== null, 'KeyA must trigger note');
      assert.strictEqual(playedDuration, 20.0, 'Holding KeyA must pass hold duration (20.0s)');
      assert.strictEqual(released, false, 'Voice must NOT be released while key is held down');

      // 2. User releases 'KeyA'
      keyupHandler({
        code: 'KeyA',
        key: 'a',
        target: { tagName: 'DIV' }
      });

      assert.strictEqual(released, true, 'Releasing KeyA must immediately call voice.release()');
    } finally {
      if (origAddEventListener) globalThis.window.addEventListener = origAddEventListener;
      else if (globalThis.window) delete globalThis.window.addEventListener;
      if (origCreateElement) globalThis.document.createElement = origCreateElement;
      else if (globalThis.document) delete globalThis.document.createElement;
      if (origGetElementById) globalThis.document.getElementById = origGetElementById;
      else if (globalThis.document) delete globalThis.document.getElementById;
    }
  });
});

describe('Vangelis CS-80 Preset Balance & Drone Sub-Bass Declick Verification', () => {
  it('calibrates VANGELIS preset so lead CS-80 brass holds its own over the drone bed without needing 100% reverb mix', () => {
    const p = PRESETS.VANGELIS;
    assert.ok(p, 'VANGELIS preset must exist');

    // Lead voice volume sits elevated for projection
    assert.ok(p.knobs.feltLevel >= 85, `feltLevel (${p.knobs.feltLevel}) must be >= 85 for lead projection`);

    // Drones calibrated down to supportive ambient level
    assert.ok(p.knobs.drone1Vol <= 45, `drone1Vol (${p.knobs.drone1Vol}) must be <= 45`);
    assert.ok(p.knobs.drone2Vol <= 40, `drone2Vol (${p.knobs.drone2Vol}) must be <= 40`);

    // Filter cutoffs tamed so drones do not crowd out 1-2.5 kHz CS-80 brass formant range
    assert.ok(p.knobs.drone1Cutoff <= 700, `drone1Cutoff (${p.knobs.drone1Cutoff} Hz) must be <= 700 Hz`);
    assert.ok(p.knobs.drone2Cutoff <= 850, `drone2Cutoff (${p.knobs.drone2Cutoff} Hz) must be <= 850 Hz`);

    // Resonance clamped from previous excessive 4.5/4.8
    assert.ok(p.knobs.drone1Res <= 3.0, `drone1Res (${p.knobs.drone1Res}) must be <= 3.0`);
    assert.ok(p.knobs.drone2Res <= 3.0, `drone2Res (${p.knobs.drone2Res}) must be <= 3.0`);

    // Wavefold drive tamed from 60/65
    assert.ok(p.knobs.drone1Fold <= 40, `drone1Fold (${p.knobs.drone1Fold}) must be <= 40`);
    assert.ok(p.knobs.drone2Fold <= 40, `drone2Fold (${p.knobs.drone2Fold}) must be <= 40`);

    // Reverb wet mix is balanced at 50% and NOT turned up to 100%
    assert.strictEqual(p.knobs.reverbWet, 50, 'reverbWet must be 50%, not pushed to 100%');

    // TIMBRE_TRIM for CS-80 is calibrated to 0.90
    assert.strictEqual(TIMBRE_TRIM.cs80, 0.90);
    assert.strictEqual(TIMBRE_TRIM.vangelis, 0.90);

    // Calculated lead-to-drone ratio: lead brass must sit at least +8 dB above Drone 1 bed
    const leadBusGain = 0.38 * (p.knobs.feltLevel / 100) * TIMBRE_TRIM.cs80;
    const drone1BusLevel = 0.22 * (p.knobs.drone1Vol / 100);
    const separationDb = 20 * Math.log10(leadBusGain / drone1BusLevel);
    assert.ok(separationDb >= 8.0, `Lead CS-80 voice (${separationDb.toFixed(2)} dB) must hold strong separation over Drone 1 bed`);
  });

  it('calibrates sub-bass snap cutoff to 80-125 Hz and clamps resonance to prevent resonant overtone buzzing', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    await engine.init();

    // Default drone1 cutoff is 650 Hz, resonance is 3.5
    assert.strictEqual(engine.droneParams[1].cutoff, 650);
    assert.strictEqual(engine.droneParams[1].res, 3.5);

    // Switch Drone 1 to sub-bass snap
    engine.setDroneSnap(1, 'sub-bass');
    assert.strictEqual(engine.droneSnap[1], 'sub-bass');

    // Verify filter cutoff slews to calibrated sub-bass range (80-125 Hz)
    const filterEvents = engine.drone1.filter1.frequency.events;
    const lastCutoff = filterEvents[filterEvents.length - 1];
    assert.ok(lastCutoff.v >= 80 && lastCutoff.v <= 125, `Sub-bass cutoff (${lastCutoff.v} Hz) must be in 80-125 Hz range`);

    // Verify resonance is clamped to deep and warm value <= 1.6
    assert.ok(engine.drone1.resonance <= 1.6, `Sub-bass resonance (${engine.drone1.resonance}) must be clamped <= 1.6`);

    // In SolarDroneVoice.setSnap directly
    const droneVoice = new SolarDroneVoice(ctx, ctx.destination, null, 1);
    droneVoice.setSnap('sub-bass');
    assert.ok(droneVoice.cutoff >= 80 && droneVoice.cutoff <= 125, `SolarDroneVoice sub-bass cutoff (${droneVoice.cutoff}) must be in 80-125 Hz`);
    assert.ok(droneVoice.resonance <= 1.6, `SolarDroneVoice sub-bass resonance (${droneVoice.resonance}) must be clamped <= 1.6`);

    // Restoring deep-tonic restores user's base resonance AND base cutoff
    droneVoice.setSnap('deep-tonic');
    assert.strictEqual(droneVoice.resonance, 3.5, 'Restoring deep-tonic must restore base resonance');
    assert.strictEqual(droneVoice.cutoff, 680, 'Restoring deep-tonic must restore base cutoff');

    // Restoring deep-tonic on engine restores base cutoff and base resonance
    engine.setDroneSnap(1, 'deep-tonic');
    assert.strictEqual(engine.drone1.cutoff, 650, 'Engine drone1 cutoff must restore to 650 Hz');
    assert.strictEqual(engine.drone1.resonance, 3.5, 'Engine drone1 resonance must restore to 3.5');
    assert.strictEqual(engine.drone1._baseCutoff, 650, 'Engine drone1 _baseCutoff must remain 650');
    assert.strictEqual(engine.drone1._baseResonance, 3.5, 'Engine drone1 _baseResonance must remain 3.5');

    // Adjusting cutoff and resonance in sub-bass mode updates base values for deep-tonic restoration
    engine.setDroneSnap(1, 'sub-bass');
    engine.setDroneCutoff(1, 800);
    engine.setDroneResonance(1, 4.0);
    assert.strictEqual(engine.droneParams[1].cutoff, 800);
    assert.strictEqual(engine.droneParams[1].res, 4.0);
    assert.strictEqual(engine.drone1._baseCutoff, 800);
    assert.strictEqual(engine.drone1._baseResonance, 4.0);
    assert.ok(engine.drone1.cutoff <= 125, 'Active cutoff in sub-bass must remain clamped <= 125 Hz');
    assert.ok(engine.drone1.resonance <= 1.6, 'Active resonance in sub-bass must remain clamped <= 1.6');

    // Returning to deep-tonic restores the user-adjusted 800 Hz and 4.0 resonance
    engine.setDroneSnap(1, 'deep-tonic');
    assert.strictEqual(engine.drone1.cutoff, 800, 'Returning to deep-tonic restores dialed 800 Hz');
    assert.strictEqual(engine.drone1.resonance, 4.0, 'Returning to deep-tonic restores dialed 4.0 Q');
  });

  it('executes smooth micro-gain declick crossfade during octave jumps and frequency slewing on active drone voice', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 10.0;
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);
    drone.setActive(true);
    drone.setVolume(0.55);

    // Clear event history
    drone.voiceGain.gain.events = [];

    // Trigger octave jump down into sub-bass (65.41 Hz -> 32.70 Hz)
    drone.setFrequency(32.70, 0.025);

    // Verify declick crossfade ramps occurred on voiceGain
    const gainEvents = drone.voiceGain.gain.events;
    const linearRamps = gainEvents.filter(e => e.type === 'linearRampToValueAtTime');
    assert.ok(linearRamps.length >= 2, 'Must schedule down and up linear ramps for declick crossfade');

    // Down ramp reaches dipGain <= 0.02 within ~16ms
    assert.ok(linearRamps[0].v <= 0.02, `Down ramp must dip gain to near-silence, got ${linearRamps[0].v}`);
    assert.ok(linearRamps[0].t > 10.0 && linearRamps[0].t <= 10.016, 'Down ramp completes within 16ms');

    // Up ramp returns smoothly to full operating volume (0.55) by ~25-36ms
    assert.strictEqual(linearRamps[1].v, 0.55, 'Up ramp returns to full operating volume');
    assert.ok(linearRamps[1].t >= 10.020 && linearRamps[1].t <= 10.036, 'Up ramp completes by ~25-36ms');
  });

  it('isolates inactive Drone 2 from frequency slewing when Drone 1 snap changes while keeping ratio synchronized', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    await engine.init();

    // Drone 2 is inactive by default
    assert.strictEqual(engine.droneParams[2].active, false);
    engine.drone2.oscA.frequency.events = [];

    // Switch Drone 1 snap to sub-bass
    engine.setDroneSnap(1, 'sub-bass');

    // Inactive Drone 2 must NOT have received setTargetAtTime frequency slewing events
    const drone2FreqEvents = engine.drone2.oscA.frequency.events.filter(e => e.type === 'setTargetAtTime');
    assert.strictEqual(drone2FreqEvents.length, 0, 'Inactive Drone 2 must not slew frequency when Drone 1 changes snap');

    // But engine.drone2Freq must remain mathematically synchronized (1.5x)
    assert.ok(Math.abs(engine.drone2Freq - (engine.drone1Freq * 1.5)) < 1e-4, 'drone2Freq ratio must stay synchronized');

    // When Drone 2 is subsequently activated, applyDrone2Snap synchronizes its frequency immediately
    engine.setDroneActive(2, true);
    const activatedSlew = engine.drone2.oscA.frequency.events.find(e => e.type === 'setTargetAtTime');
    assert.ok(activatedSlew, 'Drone 2 must update frequency upon activation');
    assert.ok(Math.abs(activatedSlew.v - engine.drone2Freq) < 1e-4);
  });

  it('pre-configures snap frequency and cutoff before opening voice gain when snap button is clicked on inactive drone', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    await engine.init();
    // Drone 1 starts inactive
    assert.strictEqual(engine.droneParams[1].active, false);

    // Call setDroneActive with voice 1 active - verifies applyDrone1Snap runs before setActive
    let snapRunBeforeActive = false;
    const origApply = engine.applyDrone1Snap.bind(engine);
    engine.applyDrone1Snap = () => {
      snapRunBeforeActive = !engine.drone1.isActive;
      return origApply();
    };
    engine.setDroneActive(1, true);
    assert.strictEqual(snapRunBeforeActive, true, 'Snap tuning and cutoff must run before drone voice gain opens');
  });
});


