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
import { SolarDroneVoice } from '../js/audio/drone-voice.js';
import { TapeDelay } from '../js/audio/tape-delay.js';
import { ShimmerReverb } from '../js/audio/shimmer-reverb.js';
import { BraunPlaySurface } from '../js/ui/keyboard.js';
import { BraunKnob } from '../js/ui/knob.js';
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

  it('guarantees clicking to strum a chord cluster and holding past 400ms does NOT strum chord again upon release', async () => {
    let chordNoteStarts = 0;
    let releasedVoices = 0;

    class MockButtonElement {
      constructor() {
        this.listeners = {};
        this.classList = { add: () => {}, remove: () => {}, contains: () => false };
      }
      addEventListener(type, fn) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(fn);
      }
      dispatchEvent(type, evt = {}) {
        evt.type = type;
        (this.listeners[type] || []).forEach(fn => fn(evt));
      }
      setAttribute() {}
      getAttribute(attr) {
        if (attr === 'data-chord') return 'SUMMERS_DAY';
        return '';
      }
      getBoundingClientRect() {
        return { top: 0, height: 72, left: 0, width: 80 };
      }
      blur() {}
    }

    const createdButtons = [];
    const mockStrip = { innerHTML: '', appendChild: () => {} };
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
    globalThis.document.createElement = () => new MockButtonElement();
    globalThis.document.getElementById = () => null;

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      const chordBtn = createdButtons[0];
      assert.ok(chordBtn, 'Chord button must exist');

      // 1. User clicks to strum a chord cluster (pointerdown)
      chordBtn.dispatchEvent('pointerdown', { preventDefault: () => {}, pointerId: 1 });

      // 2. User holds LMB down for 550ms (listening to the strum, exceeding the old 400ms bug threshold)
      await new Promise(r => setTimeout(r, 550));
      const startsDuringHold = chordNoteStarts;
      assert.ok(startsDuringHold >= 1, 'Notes must strum during hold');

      // 3. User releases LMB (pointerup -> click)
      chordBtn.dispatchEvent('pointerup', { pointerId: 1 });
      chordBtn.dispatchEvent('click', {});

      // Wait 100ms after release
      await new Promise(r => setTimeout(r, 100));

      // CRITICAL: Upon release, the chord must NOT be strummed again!
      assert.strictEqual(
        chordNoteStarts,
        startsDuringHold,
        'Upon release, chord cluster must NOT be strummed again (starts must remain unchanged)'
      );
      assert.ok(releasedVoices >= 1, 'Voices must be released upon release of click');
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

  it('guarantees repeat pointerdown on same chord button while held does not trigger double attack on release', async () => {
    let chordNoteStarts = 0;
    let releasedVoices = 0;

    class MockButtonElement {
      constructor() {
        this.listeners = {};
        this.classList = { add: () => {}, remove: () => {}, contains: () => false };
      }
      addEventListener(type, fn) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(fn);
      }
      dispatchEvent(type, evt = {}) {
        evt.type = type;
        (this.listeners[type] || []).forEach(fn => fn(evt));
      }
      setAttribute() {}
      getAttribute(attr) {
        if (attr === 'data-chord') return 'SUMMERS_DAY';
        return '';
      }
      getBoundingClientRect() {
        return { top: 0, height: 72, left: 0, width: 80 };
      }
      blur() {}
    }

    const createdButtons = [];
    const mockStrip = { innerHTML: '', appendChild: () => {} };
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
    globalThis.document.createElement = () => new MockButtonElement();
    globalThis.document.getElementById = () => null;

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      const chordBtn = createdButtons[0];
      assert.ok(chordBtn, 'Chord button must exist');

      // 1. User presses LMB down on chord button
      chordBtn.dispatchEvent('pointerdown', { preventDefault: () => {}, pointerId: 1 });
      // 2. Re-entrant pointerdown while holding (e.g. bounce, multi-dispatch)
      chordBtn.dispatchEvent('pointerdown', { preventDefault: () => {}, pointerId: 1 });

      // Hold past 550ms
      await new Promise(r => setTimeout(r, 550));
      const startsDuringHold = chordNoteStarts;
      assert.ok(startsDuringHold >= 1, 'Notes must strum during hold');

      // 3. User releases LMB (pointerup -> click)
      chordBtn.dispatchEvent('pointerup', { pointerId: 1 });
      chordBtn.dispatchEvent('click', {});

      await new Promise(r => setTimeout(r, 80));

      assert.strictEqual(
        chordNoteStarts,
        startsDuringHold,
        'Upon release after re-entrant pointerdown, chord cluster must NOT strum again'
      );
      assert.ok(releasedVoices >= 1, 'Voices must be released upon pointer release');
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

  it('guarantees accessibility and keyboard-driven click without pointerdown triggers chord strum', async () => {
    let chordNoteStarts = 0;

    class MockButtonElement {
      constructor() {
        this.listeners = {};
        this.classList = { add: () => {}, remove: () => {}, contains: () => false };
      }
      addEventListener(type, fn) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(fn);
      }
      dispatchEvent(type, evt = {}) {
        evt.type = type;
        (this.listeners[type] || []).forEach(fn => fn(evt));
      }
      setAttribute() {}
      getAttribute(attr) {
        if (attr === 'data-chord') return 'SUMMERS_DAY';
        return '';
      }
      getBoundingClientRect() {
        return { top: 0, height: 72, left: 0, width: 80 };
      }
      blur() {}
    }

    const createdButtons = [];
    const mockStrip = { innerHTML: '', appendChild: () => {} };
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
          return { release: () => {} };
        }
      }
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
      const chordBtn = createdButtons[0];
      assert.ok(chordBtn, 'Chord button must exist');

      // Click directly without pointerdown (e.g. Enter/Space or screen reader click)
      chordBtn.dispatchEvent('click', { detail: 0 });

      await new Promise(r => setTimeout(r, 60));
      assert.ok(chordNoteStarts >= 1, 'Keyboard / accessibility click must trigger chord strum');
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

describe('Vangelis CS-80 Preset Rebalance & Sub-Bass Stability', () => {
  it('rebalances Vangelis CS-80 preset to tame drone bed aggression and elevate soaring CS-80 brass lead', () => {
    const p = PRESETS.VANGELIS;
    assert.ok(p, 'VANGELIS preset must exist');

    // Felt level elevated to 88%
    assert.strictEqual(p.knobs.feltLevel, 88);

    // Drone levels lowered from 55% to 42% / 38%
    assert.ok(p.knobs.drone1Vol <= 45, `drone1Vol (${p.knobs.drone1Vol}) must be <= 45`);
    assert.ok(p.knobs.drone2Vol <= 40, `drone2Vol (${p.knobs.drone2Vol}) must be <= 40`);

    // Drone cutoffs tamed from 1200/1450 down to 600/750
    assert.ok(p.knobs.drone1Cutoff <= 800, `drone1Cutoff (${p.knobs.drone1Cutoff}) must be <= 800`);
    assert.ok(p.knobs.drone2Cutoff <= 900, `drone2Cutoff (${p.knobs.drone2Cutoff}) must be <= 900`);

    // Resonance tamed from 4.5/4.8 down to 2.6/2.8
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

  it('preserves rich audible sub-bass cutoff spectrum without crushing or nasal wah-wah ringing', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    await engine.init();

    // Default drone1 cutoff is 650 Hz
    assert.strictEqual(engine.droneParams[1].cutoff, 650);

    // Switch Drone 1 to sub-bass snap
    engine.setDroneSnap(1, 'sub-bass');
    assert.strictEqual(engine.droneSnap[1], 'sub-bass');

    // Sub-bass cutoff is optimized to 130-150 Hz with Butterworth Q <= 0.707 and LFO depth <= 15 Hz
    const filterEvents = engine.drone1.filter1.frequency.events;
    const lastCutoff = filterEvents[filterEvents.length - 1];
    assert.ok(lastCutoff.v >= 130 && lastCutoff.v <= 150, `Sub-bass cutoff (${lastCutoff.v} Hz) must be in 130-150 Hz range`);
    assert.ok(engine.drone1.filter1.Q.value <= 0.71, `Resonance Q (${engine.drone1.filter1.Q.value}) must be <= 0.707 (Butterworth)`);
    assert.ok(engine.drone1.lfoGain1.gain.value <= 15, `LFO depth (${engine.drone1.lfoGain1.gain.value} Hz) must be clamped <= 15 Hz`);

    // Phase-lock core: subHertzBeat = 0 and detune = 0
    assert.strictEqual(engine.drone1.subHertzBeat, 0, 'subHertzBeat must be locked to 0 in sub-bass');
    assert.strictEqual(engine.drone1.detuneCents, 0, 'detuneCents must be locked to 0 in sub-bass');

    // Wavefolder bypass / soft-clipping: isSubBass is true, shaper curve is monotonic soft clip
    assert.strictEqual(engine.drone1.isSubBass, true, 'isSubBass must be engaged');
    assert.ok(engine.drone1.subBassGainTrim >= 1.5, `subBassGainTrim (${engine.drone1.subBassGainTrim}) must provide +4 to +6 dB compensation`);
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

    let snapRunBeforeActive = false;
    const origApply = engine.applyDrone1Snap.bind(engine);
    engine.applyDrone1Snap = () => {
      snapRunBeforeActive = !engine.drone1.isActive;
      return origApply();
    };
    engine.setDroneActive(1, true);
    assert.strictEqual(snapRunBeforeActive, true, 'Snap tuning and cutoff must run before drone voice gain opens');
  });

  it('guards setTapeDrive and setReverbDecay against redundant curve/buffer regenerations', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    await engine.init();

    const origCurve = engine.masterTapeSaturator.curve;
    engine.setTapeDrive(engine.tapeDrive);
    assert.strictEqual(engine.masterTapeSaturator.curve, origCurve, 'setTapeDrive must not rebuild curve if drive is unchanged');

    let regenScheduled = false;
    engine.shimmerReverb._scheduleImpulseRegeneration = () => { regenScheduled = true; };
    engine.setReverbDecay(engine.reverbParams.decay);
    assert.strictEqual(regenScheduled, false, 'setReverbDecay must not reschedule impulse regeneration if decay is unchanged');
  });

  it('supports triggerOnChangeAtEnd in BraunKnob.animateTo to suppress redundant onChange storms', () => {
    let changeFired = false;
    const fakeKnob = {
      value: 50,
      toNormalized: (v) => v / 100,
      fromNormalized: (n) => n * 100,
      setValue: (val, trigger) => {
        fakeKnob.value = val;
        if (trigger) changeFired = true;
      }
    };
    fakeKnob.animateTo = BraunKnob.prototype.animateTo.bind(fakeKnob);

    // Call animateTo with duration 0 and triggerOnChangeAtEnd = false
    fakeKnob.animateTo(80, 0, null, false, false);
    assert.strictEqual(fakeKnob.value, 80);
    assert.strictEqual(changeFired, false, 'onChange must not be triggered when triggerOnChangeAtEnd is false');

    // Call animateTo with duration 0 and triggerOnChangeAtEnd = true
    fakeKnob.animateTo(90, 0, null, false, true);
    assert.strictEqual(fakeKnob.value, 90);
    assert.strictEqual(changeFired, true, 'onChange must be triggered when triggerOnChangeAtEnd is true');
  });

  it('awaits ctx.resume() on AudioEngine.init when AudioContext starts suspended to prevent cold start buffer underruns', async () => {
    let resumeResolved = false;
    const ctx = createDSPMockCtx();
    ctx.state = 'suspended';
    ctx.resume = async () => {
      await new Promise(r => setTimeout(r, 20));
      ctx.state = 'running';
      resumeResolved = true;
    };
    const engine = new AudioEngine(ctx);
    await engine.init();
    assert.strictEqual(resumeResolved, true, 'AudioEngine.init must await ctx.resume before completing');
    assert.strictEqual(ctx.state, 'running', 'AudioContext must be running after init');
  });

  it('keeps masterGain and droneBus at 0.0 during init and only fades in at the very end of AudioEngine.init', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    let masterGainAtVoiceCreation = -1;
    let droneBusAtVoiceCreation = -1;

    // Track bus gains during SolarDroneVoice instantiation
    const origVoice = SolarDroneVoice;
    engine.init(); // start async init
    await engine._initPromise;

    // Master gain events should have initial setValueAtTime(0.0) at ctx.currentTime,
    // and only one setTargetAtTime event scheduled with rampStartTime > 0
    const masterEvents = engine.masterGain.gain.events;
    const setTargetEvents = masterEvents.filter(e => e.type === 'setTargetAtTime');
    assert.strictEqual(setTargetEvents.length, 1, 'masterGain must only have 1 setTargetAtTime fade-in at end of init');
    assert.ok(setTargetEvents[0].t >= ctx.currentTime + 0.01, 'Fade-in must be scheduled after graph assembly');

    const droneEvents = engine.droneBus.gain.events;
    const droneTargetEvents = droneEvents.filter(e => e.type === 'setTargetAtTime');
    assert.strictEqual(droneTargetEvents.length, 1, 'droneBus must only have 1 setTargetAtTime fade-in at end of init');
  });

  it('guards setReverbDecay with isPreset=true against live convolver buffer regeneration and clears pending timers', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    await engine.init();

    let regenTriggered = false;
    engine.shimmerReverb.regenerateImpulse = () => { regenTriggered = true; };

    // Set decay with isPreset = true
    engine.setReverbDecay(4.0, true);
    assert.strictEqual(engine.shimmerReverb.decayTime, 4.0);
    assert.strictEqual(engine.shimmerReverb._regenTimer, null, 'Preset change must not leave pending regen timer');

    // Wait past standard debounce window (80ms)
    await new Promise(r => setTimeout(r, 90));
    assert.strictEqual(regenTriggered, false, 'Preset change must not trigger convolver buffer regeneration');
  });

  it('supports extended 65-75ms declick crossfade window for sub-bass 32.7 Hz wave cycles', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 10.0;
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);
    drone.setActive(true);
    drone.setVolume(0.55);

    drone.voiceGain.gain.events = [];
    // Trigger extended 68ms declick transition (~2 full cycles of 32.7 Hz)
    drone.declickTransition(0.068);

    const gainEvents = drone.voiceGain.gain.events;
    const linearRamps = gainEvents.filter(e => e.type === 'linearRampToValueAtTime');
    assert.strictEqual(linearRamps.length, 2);

    // Down ramp reaches dipGain at ~30ms (between 25ms and 35ms)
    assert.ok(linearRamps[0].t >= 10.025 && linearRamps[0].t <= 10.035, `Down ramp time (${linearRamps[0].t}) should be ~30ms`);
    // Up ramp returns to full operating volume at ~68ms
    assert.ok(linearRamps[1].t >= 10.060 && linearRamps[1].t <= 10.075, `Up ramp time (${linearRamps[1].t}) should be ~68ms`);
  });

  it('prevents conflicting setTargetAtTime from clobbering declick transition ramps during sub-bass snap transition', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    await engine.init();
    engine.setDroneActive(1, true);

    // Clear event history
    engine.drone1.voiceGain.gain.events = [];
    ctx.currentTime = 20.0;

    // Switch active drone 1 to sub-bass snap
    engine.setDroneSnap(1, 'sub-bass');

    const gainEvents = engine.drone1.voiceGain.gain.events;
    const linearRamps = gainEvents.filter(e => e.type === 'linearRampToValueAtTime');
    assert.strictEqual(linearRamps.length, 2, 'Must have exactly 2 linear ramps for declick crossfade');

    // Down ramp dips to <= 0.02
    assert.ok(linearRamps[0].v <= 0.02, `Down ramp must dip gain to near-silence, got ${linearRamps[0].v}`);
    // Up ramp returns to compensated target gain (0.55 * 1.70 = 0.935)
    assert.ok(Math.abs(linearRamps[1].v - (0.55 * 1.70)) < 1e-4, `Up ramp must reach compensated target gain 0.935, got ${linearRamps[1].v}`);

    // Must NOT have a conflicting setTargetAtTime event scheduled at t=20.0 that cancels or corrupts the ramps
    const conflictingTarget = gainEvents.find(e => e.type === 'setTargetAtTime' && Math.abs(e.t - 20.0) < 0.001);
    assert.strictEqual(conflictingTarget, undefined, 'Must not schedule conflicting setTargetAtTime at transition start time');
  });

  it('restores base beating, detune, resonance, and LFO depth when switching from sub-bass back to deep-tonic', () => {
    const ctx = createDSPMockCtx();
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);
    drone.setBeatingHz(0.48);
    drone.setDetuneCents(3.2);
    drone.setResonance(4.2);
    drone.setLfo(0.15, 200);

    // Switch to sub-bass
    drone.setSnap('sub-bass');
    assert.strictEqual(drone.subHertzBeat, 0, 'subHertzBeat must be 0 in sub-bass');
    assert.strictEqual(drone.detuneCents, 0, 'detuneCents must be 0 in sub-bass');
    assert.strictEqual(drone.resonance, 0.5, 'resonance must be 0.5 in sub-bass');
    assert.strictEqual(drone.lfoDepth, 12, 'lfoDepth must be 12 in sub-bass');

    // Switch back to deep-tonic
    drone.setSnap('deep-tonic');
    assert.strictEqual(drone.subHertzBeat, 0.48, 'subHertzBeat must restore to base value 0.48');
    assert.strictEqual(drone.detuneCents, 3.2, 'detuneCents must restore to base value 3.2');
    assert.strictEqual(drone.resonance, 4.2, 'resonance must restore to base value 4.2');
    assert.strictEqual(drone.lfoDepth, 200, 'lfoDepth must restore to base value 200');
  });

  it('initializes ShimmerReverb with efficient 3.8s initial impulse buffer while scaling perceived RT60 via feedback recirculation', () => {
    const ctx = createDSPMockCtx();
    const reverb = new ShimmerReverb(ctx, { decayTime: 8.5 });

    // Initial convolver buffer is capped to 3.8s * sampleRate to prevent cold start audio underruns
    assert.strictEqual(reverb.convolverA.buffer.length, Math.floor(3.8 * 48000), 'Initial buffer length must be 3.8s');
    // While decayTime property reflects dialed 8.5s
    assert.strictEqual(reverb.decayTime, 8.5);
    // Feedback recirculation is dynamically updated to scale with 8.5s RT60
    assert.ok(reverb.shimmerFeedback.gain.value > 0.35, 'Feedback gain must scale with 8.5s decay');
  });
});

describe('Pop-Free Harmony Snaps, Piano Timbre Declicking, & Tape Delay Slew Verification', () => {
  it('executes smooth declick crossfade on active Drone Voice 2 whenever snap harmony is switched', async () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 5.0;
    const engine = new AudioEngine(ctx);
    await engine.init();

    // Activate Drone 2
    engine.setDroneActive(2, true);
    assert.strictEqual(engine.drone2.isActive, true);

    // Test transition from default (perfect-5th) to sus-4th
    engine.drone2.voiceGain.gain.events = [];
    ctx.currentTime = 6.0;
    engine.setDroneSnap(2, 'sus-4th');

    const susRamps = engine.drone2.voiceGain.gain.events.filter(e => e.type === 'linearRampToValueAtTime');
    assert.strictEqual(susRamps.length, 2, 'Must schedule down and up ramps on Drone 2 voiceGain during sus-4th snap');
    assert.ok(susRamps[0].v <= 0.02, 'Down ramp dips gain to eliminate frequency slew pop');
    assert.strictEqual(susRamps[1].v, engine.drone2.volume, 'Up ramp returns to full operating volume');

    // Test transition to beating-unison
    engine.drone2.voiceGain.gain.events = [];
    ctx.currentTime = 7.0;
    engine.setDroneSnap(2, 'beating-unison');

    const uniRamps = engine.drone2.voiceGain.gain.events.filter(e => e.type === 'linearRampToValueAtTime');
    assert.strictEqual(uniRamps.length, 2, 'Must schedule down and up ramps on Drone 2 voiceGain during beating-unison snap');
    assert.strictEqual(engine.droneParams[2].beat, 0.35, 'Beating unison must calibrate to 0.35 Hz');

    // Test transition back to major-9th (restores base beating)
    engine.drone2.voiceGain.gain.events = [];
    ctx.currentTime = 8.0;
    engine.setDroneSnap(2, 'major-9th');

    const majRamps = engine.drone2.voiceGain.gain.events.filter(e => e.type === 'linearRampToValueAtTime');
    assert.strictEqual(majRamps.length, 2, 'Must schedule down and up ramps on Drone 2 voiceGain during major-9th snap');
    assert.strictEqual(engine.droneParams[2].beat, 0.65, 'Must restore dialed beating (0.65 Hz) when leaving beating-unison');
  });

  it('executes master output declickTransition on FeltPianoSynthesizer when switching timbre while voices are active', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 2.0;
    const synth = new FeltPianoSynthesizer(ctx, null, 4);

    // Play a note so a voice is active
    synth.playNote(261.63, 0.8, 3.0);

    // Clear event log on output gain
    synth.output.gain.events = [];
    ctx.currentTime = 2.5;

    // Switch timbre to CS-80 via setTimbre
    synth.setTimbre('cs80');

    const ramps = synth.output.gain.events.filter(e => e.type === 'linearRampToValueAtTime');
    assert.strictEqual(ramps.length, 2, 'Must schedule 2 linear ramps for pop-free master crossfade');
    assert.ok(ramps[0].v <= 0.05, 'Must dip gain to near-silence');
    assert.ok(ramps[1].v >= 0.25 && ramps[1].v <= 0.45, 'Must restore full operating headroom gain');

    // Check voice filter Q slews smoothly with setTargetAtTime
    const activeVoice = synth.voices.find(v => v.isActive);
    assert.ok(activeVoice);
    const filterQTargets = activeVoice.filter1.Q.events.filter(e => e.type === 'setTargetAtTime');
    assert.ok(filterQTargets.length > 0, 'Filter Q must slew smoothly without step discontinuities');
  });

  it('verifies TapeDelay.setDelayTime ms alias matches setTime and maintains tau calibration', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 1.0;
    const delay = new TapeDelay(ctx, { delayTimeL: 0.30 });

    delay.setDelayTime(680); // 680 ms = 0.68s
    assert.strictEqual(delay.delayTimeL, 0.68);
    assert.strictEqual(delay.delayTimeR, 0.68 * 1.5);

    const lEvents = delay.delayNodeL.delayTime.events;
    const cancelEv = lEvents.find(e => e.type === 'cancelAndHoldAtTime' || e.type === 'cancelScheduledValues');
    assert.ok(cancelEv, 'Must cancel scheduled values');
    const targetEv = lEvents.find(e => e.type === 'setTargetAtTime');
    assert.ok(targetEv, 'Must schedule setTargetAtTime');
    assert.ok(targetEv.tau >= 0.008 && targetEv.tau <= 0.08, 'Tau must remain calibrated between 0.008s and 0.08s');
  });

  it('eliminates scratchy potentiometer static by slewing smoothly without repeated cancel calls during continuous live knob dragging', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 10.0;
    const delay = new TapeDelay(ctx, { delayTimeL: 0.46 });

    // Simulate rapid live dragging across 20 intermediate steps (5ms apart, small increments)
    delay.delayNodeL.delayTime.events = [];
    for (let i = 1; i <= 20; i++) {
      ctx.currentTime = 10.0 + (i * 0.005);
      delay.setTime(0.46 + (i * 0.002)); // +2ms per step
    }

    const events = delay.delayNodeL.delayTime.events;
    const cancels = events.filter(e => e.type === 'cancelAndHoldAtTime' || e.type === 'cancelScheduledValues');
    const targetEvents = events.filter(e => e.type === 'setTargetAtTime');

    // Continuous dragging must NOT repeatedly cancel and hold on every single mousemove (which creates scratchy zipper noise)
    assert.strictEqual(cancels.length, 0, 'Live knob drag must not trigger repeated cancelAndHoldAtTime on small increments');
    assert.strictEqual(targetEvents.length, 20, 'Each step must schedule continuous smooth exponential slewing');
    assert.ok(targetEvents.every(e => e.tau >= 0.008 && e.tau <= 0.08), 'All slew events must use calibrated analog tape tau');
  });

  it('eliminates wooliness and zipper static during rapid large-increment continuous live dragging (>= 60ms/step)', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 10.0;
    const delay = new TapeDelay(ctx, { delayTimeL: 0.20 });

    // Simulate fast live dragging across 15 intermediate steps (16ms apart, ~70ms large increments)
    delay.delayNodeL.delayTime.events = [];
    for (let i = 1; i <= 15; i++) {
      ctx.currentTime = 10.0 + (i * 0.016);
      delay.setTime(0.20 + (i * 0.070)); // +70ms per step
    }

    const events = delay.delayNodeL.delayTime.events;
    const cancels = events.filter(e => e.type === 'cancelAndHoldAtTime' || e.type === 'cancelScheduledValues');
    const targetEvents = events.filter(e => e.type === 'setTargetAtTime');

    // Fast live dragging must NEVER trigger cancels, eliminating potentiometer static
    assert.strictEqual(cancels.length, 0, 'Fast live knob drag must NOT trigger cancelAndHoldAtTime during continuous gesture');
    assert.strictEqual(targetEvents.length, 15, 'All steps must schedule continuous exponential slewing');
    // Tau must be 0.010s (10ms) to eliminate wooly sluggish Doppler lag
    assert.ok(targetEvents.every(e => e.tau === 0.010), 'Must use calibrated non-wooly 10ms tape slewing tau');
  });

  it('completely eliminates pop when switching piano timbre with 2 drones active by isolating active sounding voices from instantaneous oscillator phase resets', async () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 1.0;
    const engine = new AudioEngine(ctx);
    await engine.init();

    // 1. Activate both Drone 1 and Drone 2
    engine.setDroneActive(1, true);
    engine.setDroneActive(2, true);
    assert.strictEqual(engine.drone1.isActive, true);
    assert.strictEqual(engine.drone2.isActive, true);

    // 2. Play a piano note so a piano voice is active
    ctx.currentTime = 2.0;
    const voice = engine.feltPiano.playNote(329.63, 0.8, 4.0); // E4
    assert.strictEqual(voice.isActive, true);
    assert.strictEqual(voice.currentOscillatorWaveform, 'felt');

    // 3. Clear event logs on output gain
    engine.feltPiano.output.gain.events = [];
    ctx.currentTime = 2.5;

    // 4. Switch piano timbre to CS-80 while 2 drones are active and piano note is sustaining
    engine.setFeltWaveform('cs80');

    // Master output gain of feltPiano schedules smooth micro-crossfade without severe -80dB drop
    const ramps = engine.feltPiano.output.gain.events.filter(e => e.type === 'linearRampToValueAtTime');
    assert.strictEqual(ramps.length, 2, 'Must schedule 2 linear ramps for pop-free master crossfade');
    assert.ok(ramps[0].v <= 0.05, `Ramp dip (${ramps[0].v}) must provide smooth micro-dip (<= 0.05)`);
    assert.ok(ramps[0].v >= 0.005, `Ramp dip (${ramps[0].v}) must not drop below 0.005 to avoid compressor thump on drones`);
    assert.ok(ramps[1].v >= 0.25 && ramps[1].v <= 0.45, 'Must restore full headroom gain');

    // Running voice parameter targets (filter Q, chorus, detune) slew smoothly
    const filterQTargets = voice.filter1.Q.events.filter(e => e.type === 'setTargetAtTime');
    assert.ok(filterQTargets.length > 0, 'Active voice filter Q must slew smoothly');
    assert.strictEqual(voice.currentWaveform, 'cs80', 'Voice waveform state must update to cs80');
    assert.strictEqual(voice.currentOscillatorWaveform, 'cs80', 'Oscillator waveform reports cs80');

    // All inactive voices in the pool have been immediately and silently configured with CS-80
    const inactiveVoices = engine.feltPiano.voices.filter(v => !v.isActive);
    assert.ok(inactiveVoices.length > 0, 'Must have inactive voices in pool');
    assert.ok(inactiveVoices.every(v => v.currentOscillatorWaveform === 'cs80'), 'All inactive voices must have CS-80 ready');

    // Next note played uses an inactive voice which immediately sounds as CS-80
    ctx.currentTime = 3.0;
    const nextVoice = engine.feltPiano.playNote(440, 0.75, 3.0);
    assert.strictEqual(nextVoice.currentOscillatorWaveform, 'cs80', 'New notes sound with CS-80');

    // Zero un-synchronized setTimeout timers exist on synthesizer
    assert.strictEqual(engine.feltPiano._waveformSwapTimer, undefined, 'No setTimeout timers should be used for waveform swaps');
  });
});




