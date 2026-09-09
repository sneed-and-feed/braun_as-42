import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCALES,
  CHORD_VOICINGS,
  midiToFrequency,
  frequencyToMidi,
  getChordFrequencies,
  getScaleDegreesInOctaves
} from '../js/generative/scales.js';

import {
  BraunPlaySurface,
  CHORD_SPEEDS,
  CHIME_KEY_MAP,
  CHIME_CHAR_MAP,
  getChimeKeyIndex,
  getChordKeyIndex,
  isPlayableSynthesizerKey
} from '../js/ui/keyboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.style = {};
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
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

  get className() {
    return this._className;
  }

  set className(val) {
    this._className = val;
    if (typeof val === 'string') {
      val.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = val;
    if (val === '') {
      this.children = [];
    }
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }

  getAttribute(k) {
    return this.attributes.get(k) || null;
  }

  addEventListener(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(cb);
  }

  dispatchEvent(type, ev = {}) {
    const cbs = this.listeners.get(type) || [];
    cbs.forEach(cb => cb(ev));
  }

  click() {
    this.dispatchEvent('click', { clientY: 50 });
  }

  blur() {
    this._blurred = true;
  }

  focus() {
    this._focused = true;
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

describe('Single-Row 11-Key Modal Chime Strip Architecture & Dieter Rams Strum Control', () => {
  it('maps A through \' keys across single-row 11-key chime strip (11 modal keys)', () => {
    // 11-key range: A, S, D, F, G, H, J, K, L, ;, '
    const expectedShortcuts = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
    expectedShortcuts.forEach((code, idx) => {
      assert.strictEqual(CHIME_KEY_MAP[code], idx, `Code ${code} must map to chime index ${idx}`);
      assert.strictEqual(getChimeKeyIndex({ code }), idx, `getChimeKeyIndex({ code: '${code}' }) must return ${idx}`);
      assert.strictEqual(isPlayableSynthesizerKey({ code }), true, `Code ${code} must be recognized as playable synth key`);
    });

    // Keys W, E, R, T, Y, U, etc. must not trigger notes or be playable synth keys
    const semitoneCodes = ['KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'];
    semitoneCodes.forEach((code) => {
      assert.strictEqual(getChimeKeyIndex({ code }), null, `Code ${code} must not map to chime index`);
      assert.strictEqual(isPlayableSynthesizerKey({ code }), false, `Code ${code} must not be a playable synth key`);
    });
  });

  it('correctly resolves chime keys case-insensitively by key character', () => {
    assert.strictEqual(getChimeKeyIndex({ key: 'a' }), 0);
    assert.strictEqual(getChimeKeyIndex({ key: 'A' }), 0);
    assert.strictEqual(getChimeKeyIndex({ key: 's' }), 1);
    assert.strictEqual(getChimeKeyIndex({ key: 'S' }), 1);
    assert.strictEqual(getChimeKeyIndex({ key: ';' }), 9);
    assert.strictEqual(getChimeKeyIndex({ key: '\'' }), 10);
    assert.strictEqual(getChimeKeyIndex({ key: 'w' }), null);
    assert.strictEqual(getChimeKeyIndex({ key: 'W' }), null);
  });

  it('identifies chime keys, chord keys, and spacebar as playable synthesizer keys while ignoring non-synth keys', () => {
    ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'].forEach(code => {
      assert.strictEqual(isPlayableSynthesizerKey({ code }), true, `${code} must be a playable synth key`);
    });
    ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'].forEach(code => {
      assert.strictEqual(isPlayableSynthesizerKey({ code }), true, `${code} must be a playable chord key`);
    });
    assert.strictEqual(isPlayableSynthesizerKey({ code: 'Space' }), true, 'Space must be freeze key');

    // Non-synth keys
    ['KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyQ', 'Tab', 'Escape', 'Enter'].forEach(code => {
      assert.strictEqual(isPlayableSynthesizerKey({ code }), false, `${code} must not be a playable synth key`);
    });
  });

  it('rebuilds chime strip as serene single-row 11-key layout with clean DEG typography and no semitones', () => {
    const mockStrip = new MockElement('div');
    const mockChords = new MockElement('div');

    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0, // C
      a4: 440,
      feltPiano: {
        playNote: () => ({ release: () => {} })
      }
    };

    const origDoc = globalThis.document;
    globalThis.document = {
      createElement: (tag) => new MockElement(tag),
      activeElement: null,
      body: new MockElement('body'),
      getElementById: () => null,
      querySelectorAll: () => []
    };

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);

      // Exactly 11 keys (octaves 3 through 5 in Budd Pentatonic)
      assert.strictEqual(surface.diatonicKeys.length, 11, 'Must have 11 diatonic keys');
      assert.strictEqual(surface.semitoneKeys.length, 0, 'Must have 0 semitone keys');
      assert.strictEqual(mockStrip.children.length, 11, 'Strip container must have exactly 11 children');

      // Check each of the 11 keys
      const expectedMidis = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72]; // Budd Pentatonic C3..C5
      const expectedBadges = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"];

      surface.diatonicKeys.forEach((keyEl, idx) => {
        assert.strictEqual(keyEl.getAttribute('data-midi'), String(expectedMidis[idx]), `Key ${idx} MIDI mismatch`);
        assert.strictEqual(keyEl.classList.contains('braun-chime-key'), true, `Key ${idx} must have braun-chime-key class`);
        assert.strictEqual(keyEl.classList.contains('braun-semitone-key'), false, `Key ${idx} must not have semitone class`);
        assert.strictEqual(keyEl.classList.contains('braun-diatonic-key'), false, `Key ${idx} must not have dual-tier class`);

        // Check shortcut badge
        assert.strictEqual(surface._getShortcutKey(idx), expectedBadges[idx]);
        assert.ok(keyEl.innerHTML.includes(expectedBadges[idx]), `Key ${idx} must display shortcut badge ${expectedBadges[idx]}`);

        // Degree label must be clean DEG X without chromatic accidental offsets
        assert.ok(keyEl.innerHTML.includes('DEG '), `Key ${idx} must display DEG label`);
      });
    } finally {
      globalThis.document = origDoc;
    }
  });

  it('provides 4-position Dieter Rams STRUM speed switch: SLOW (120ms), MED (50ms), FAST (20ms), INSTANT (0ms)', () => {
    assert.strictEqual(CHORD_SPEEDS.slow.rateMs, 120);
    assert.strictEqual(CHORD_SPEEDS.slow.label, 'SLOW');
    assert.strictEqual(CHORD_SPEEDS.med.rateMs, 50);
    assert.strictEqual(CHORD_SPEEDS.med.label, 'MED');
    assert.strictEqual(CHORD_SPEEDS.fast.rateMs, 20);
    assert.strictEqual(CHORD_SPEEDS.fast.label, 'FAST');
    assert.strictEqual(CHORD_SPEEDS.instant.rateMs, 0);
    assert.strictEqual(CHORD_SPEEDS.instant.label, 'INSTANT');

    const mockStrip = new MockElement('div');
    const mockChords = new MockElement('div');
    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: { playNote: () => ({ release: () => {} }) }
    };

    // Build mock speed switch with 4 buttons
    const speedSwitch = new MockElement('div');
    speedSwitch.setAttribute('id', 'chord-speed-switch');
    const btnSlow = new MockElement('button');
    btnSlow.className = 'braun-speed-btn';
    btnSlow.setAttribute('data-speed', 'slow');
    const btnMed = new MockElement('button');
    btnMed.className = 'braun-speed-btn is-active';
    btnMed.setAttribute('data-speed', 'med');
    const btnFast = new MockElement('button');
    btnFast.className = 'braun-speed-btn';
    btnFast.setAttribute('data-speed', 'fast');
    const btnInstant = new MockElement('button');
    btnInstant.className = 'braun-speed-btn';
    btnInstant.setAttribute('data-speed', 'instant');
    speedSwitch.appendChild(btnSlow);
    speedSwitch.appendChild(btnMed);
    speedSwitch.appendChild(btnFast);
    speedSwitch.appendChild(btnInstant);

    const origDoc = globalThis.document;
    globalThis.document = {
      createElement: (tag) => new MockElement(tag),
      activeElement: null,
      body: new MockElement('body'),
      getElementById: (id) => id === 'chord-speed-switch' ? speedSwitch : null,
      querySelectorAll: (sel) => sel === '.braun-speed-btn' ? [btnSlow, btnMed, btnFast, btnInstant] : []
    };

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      assert.strictEqual(surface.chordSpeed, 'med', 'Default speed must be med');
      assert.strictEqual(btnMed.classList.contains('is-active'), true);
      assert.strictEqual(btnSlow.classList.contains('is-active'), false);

      // Change to slow
      surface.setChordSpeed('slow');
      assert.strictEqual(surface.chordSpeed, 'slow');
      assert.strictEqual(btnSlow.classList.contains('is-active'), true);
      assert.strictEqual(btnMed.classList.contains('is-active'), false);
      assert.strictEqual(btnSlow.getAttribute('aria-checked'), 'true');

      // Click fast button
      btnFast.click();
      assert.strictEqual(surface.chordSpeed, 'fast');
      assert.strictEqual(btnFast.classList.contains('is-active'), true);
      assert.strictEqual(btnSlow.classList.contains('is-active'), false);

      // Instant button
      btnInstant.click();
      assert.strictEqual(surface.chordSpeed, 'instant');
      assert.strictEqual(btnInstant.classList.contains('is-active'), true);

      // Fallback on invalid input
      surface.setChordSpeed('hyperspeed');
      assert.strictEqual(surface.chordSpeed, 'med');
    } finally {
      globalThis.document = origDoc;
    }
  });

  it('triggers chord clusters with appropriate strum delay according to chordSpeed', () => {
    const mockStrip = new MockElement('div');
    const mockChords = new MockElement('div');

    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: () => ({ release: () => {} })
      }
    };

    const origDoc = globalThis.document;
    globalThis.document = {
      createElement: (tag) => new MockElement(tag),
      activeElement: null,
      body: new MockElement('body'),
      getElementById: () => null,
      querySelectorAll: () => []
    };

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);

      // 1. Instant speed: rateMs = 0 -> all notes triggered in 0ms timers
      surface.setChordSpeed('instant');
      const sessionInstant = surface.startChord('ETHEREAL_11TH');
      assert.ok(sessionInstant);
      assert.strictEqual(sessionInstant.timers.length, 6, 'Cluster 4 (6 notes) must create 6 timers');
      surface.stopChordSession(sessionInstant);

      // 2. Slow speed: rateMs = 120 -> 6 timers created
      surface.setChordSpeed('slow');
      const sessionSlow = surface.startChord('NOSTALGIA_11TH');
      assert.ok(sessionSlow);
      assert.strictEqual(sessionSlow.timers.length, 6);
      surface.stopChordSession(sessionSlow);
      assert.strictEqual(sessionSlow.isReleased, true);
    } finally {
      globalThis.document = origDoc;
    }
  });

  it('supports mouse/touch glissando swiping across single-row 11 chime keys', () => {
    const mockStrip = new MockElement('div');
    const mockChords = new MockElement('div');
    const playedNotes = [];
    const releasedVoices = [];

    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: (freq, vel, dur, isHold) => {
          const voice = {
            freq,
            vel,
            dur,
            isHold,
            released: false,
            release: () => {
              voice.released = true;
              releasedVoices.push(voice);
            }
          };
          playedNotes.push(voice);
          return voice;
        }
      }
    };

    const origDoc = globalThis.document;
    globalThis.document = {
      createElement: (tag) => new MockElement(tag),
      activeElement: null,
      body: new MockElement('body')
    };

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      const key0 = surface.diatonicKeys[0]; // C3
      const key1 = surface.diatonicKeys[1]; // D3

      // 1. Pointerdown on Key 0
      key0.dispatchEvent('pointerdown', { buttons: 1, clientY: 50, preventDefault: () => {} });
      assert.strictEqual(playedNotes.length, 1, 'Key 0 must sound');
      assert.strictEqual(key0._isHeld, true);
      assert.strictEqual(key0.classList.contains('is-pressed'), true);

      // 2. Glissando swipe into Key 1
      key1.dispatchEvent('pointerenter', { buttons: 1, clientY: 48 });
      assert.strictEqual(playedNotes.length, 2, 'Key 1 must sound on glissando swipe');
      assert.strictEqual(releasedVoices.length, 1, 'Key 0 must be released');
      assert.strictEqual(key0._isHeld, false);
      assert.strictEqual(key1._isHeld, true);

      // 3. Pointerup releases active key
      key1.dispatchEvent('pointerup', {});
      assert.strictEqual(releasedVoices.length, 2, 'Key 1 must be released on pointerup');
      assert.strictEqual(key1._isHeld, false);
    } finally {
      globalThis.document = origDoc;
    }
  });

  it('guarantees window pointerup does not clear keys held by physical computer keyboard', () => {
    const mockStrip = new MockElement('div');
    const mockChords = new MockElement('div');
    const playedNotes = [];
    const releasedVoices = [];

    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: (freq, vel, dur, isHold) => {
          const voice = {
            freq,
            vel,
            dur,
            isHold,
            released: false,
            release: () => {
              voice.released = true;
              releasedVoices.push(voice);
            }
          };
          playedNotes.push(voice);
          return voice;
        }
      }
    };

    let keydownHandler = null;
    let keyupHandler = null;
    let windowPointerupHandler = null;

    const origWin = globalThis.window;
    globalThis.window = {
      addEventListener: (type, cb) => {
        if (type === 'keydown') keydownHandler = cb;
        if (type === 'keyup') keyupHandler = cb;
        if (type === 'pointerup') windowPointerupHandler = cb;
      },
      removeEventListener: () => {}
    };

    const origDoc = globalThis.document;
    globalThis.document = {
      createElement: (tag) => new MockElement(tag),
      activeElement: null,
      body: new MockElement('body'),
      getElementById: () => null,
      querySelectorAll: () => []
    };

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      const keyA = surface.diatonicKeys[0]; // C3

      // 1. Press and hold KeyA via physical keyboard
      keydownHandler({
        code: 'KeyA',
        key: 'a',
        repeat: false,
        target: { tagName: 'DIV' },
        preventDefault: () => {}
      });

      assert.strictEqual(playedNotes.length, 1);
      assert.strictEqual(keyA._isHeld, true);
      assert.strictEqual(keyA.classList.contains('is-active'), true);
      assert.strictEqual(keyA.classList.contains('is-pressed'), true);

      // 2. User clicks somewhere else in the UI and pointerup fires on window
      windowPointerupHandler({});

      // 3. Key must STILL be held and visually illuminated because KeyA is still physically pressed
      assert.strictEqual(keyA._isHeld, true, 'Key must remain held despite window pointerup');
      assert.strictEqual(keyA.classList.contains('is-active'), true, 'Key must retain is-active class');
      assert.strictEqual(keyA.classList.contains('is-pressed'), true, 'Key must retain is-pressed class');
      assert.strictEqual(releasedVoices.length, 0, 'Voice must not be prematurely released');

      // 4. Physical keyup finally arrives
      keyupHandler({ code: 'KeyA', key: 'a', target: { tagName: 'DIV' } });
      assert.strictEqual(keyA._isHeld, false, 'Key must be released on keyup');
      assert.strictEqual(keyA.classList.contains('is-active'), false);
      assert.strictEqual(keyA.classList.contains('is-pressed'), false);
      assert.strictEqual(releasedVoices.length, 1, 'Voice must be released on keyup');
    } finally {
      globalThis.window = origWin;
      globalThis.document = origDoc;
    }
  });

  it('safely releases prior voice when re-triggering an already held keyboard key without voice leaks', () => {
    const mockStrip = new MockElement('div');
    const mockChords = new MockElement('div');
    const playedNotes = [];
    const releasedVoices = [];

    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: (freq, vel, dur, isHold) => {
          const voice = {
            freq,
            vel,
            dur,
            isHold,
            released: false,
            release: () => {
              voice.released = true;
              releasedVoices.push(voice);
            }
          };
          playedNotes.push(voice);
          return voice;
        }
      }
    };

    let keydownHandler = null;
    let keyupHandler = null;

    const origWin = globalThis.window;
    globalThis.window = {
      addEventListener: (type, cb) => {
        if (type === 'keydown') keydownHandler = cb;
        if (type === 'keyup') keyupHandler = cb;
      },
      removeEventListener: () => {}
    };

    const origDoc = globalThis.document;
    globalThis.document = {
      createElement: (tag) => new MockElement(tag),
      activeElement: null,
      body: new MockElement('body'),
      getElementById: () => null,
      querySelectorAll: () => []
    };

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);

      // First keydown
      keydownHandler({
        code: 'KeyA',
        key: 'a',
        repeat: false,
        target: { tagName: 'DIV' },
        preventDefault: () => {}
      });
      assert.strictEqual(playedNotes.length, 1);
      assert.strictEqual(releasedVoices.length, 0);

      // Second keydown on same key before keyup
      keydownHandler({
        code: 'KeyA',
        key: 'a',
        repeat: false,
        target: { tagName: 'DIV' },
        preventDefault: () => {}
      });
      assert.strictEqual(playedNotes.length, 2);
      assert.strictEqual(releasedVoices.length, 1, 'Re-triggering KeyA must release prior sounding voice');
      assert.strictEqual(releasedVoices[0], playedNotes[0]);

      // Release keyup
      keyupHandler({ code: 'KeyA', key: 'a', target: { tagName: 'DIV' } });
      assert.strictEqual(releasedVoices.length, 2, 'Releasing KeyA must release second voice');
      assert.strictEqual(releasedVoices[1], playedNotes[1]);
    } finally {
      globalThis.window = origWin;
      globalThis.document = origDoc;
    }
  });

  it('verifies CSS style rules for single-row flex chime strip and Dieter Rams strum toggle switch', () => {
    const cssPath = path.join(__dirname, '..', 'css', 'style.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // 1. Single-row flex layout for serene chime strip
    assert.ok(
      css.includes('.braun-chime-strip {') &&
      css.includes('display: flex;') &&
      css.includes('gap: 4px;'),
      'Chime strip must use clean single-row flex layout'
    );

    // 2. Chime key styling
    assert.ok(
      css.includes('.braun-chime-key {') &&
      css.includes('height: 74px;'),
      'Chime keys must have 74px height'
    );

    // 3. Strum speed switch styling
    assert.ok(
      css.includes('.braun-chord-speed-switch {') &&
      css.includes('.braun-speed-btn {') &&
      css.includes('.braun-speed-btn.is-active {'),
      'Dieter Rams strum speed toggle switch must be styled'
    );

    // 4. Dark theme high contrast for strum toggles
    assert.ok(
      css.includes('[data-theme="dark"] .braun-speed-btn.is-active'),
      'Dark theme must style active strum toggle'
    );
  });

  it('integrates chordSpeed with patch export, load, and curated sound presets', async () => {
    const { PRESETS, AmbientApp } = await import('../js/app.js');

    assert.strictEqual(PRESETS.DEFAULT.chordSpeed, 'med');
    assert.strictEqual(PRESETS.HAROLD_BUDD.chordSpeed, 'slow');
    assert.strictEqual(PRESETS.VANGELIS.chordSpeed, 'fast');
    assert.strictEqual(PRESETS.ENO_AIRPORTS.chordSpeed, 'slow');

    // Test patch export and load
    const mockApp = {
      engine: {
        rootPitchClass: 0,
        currentScaleKey: 'BUDD_PENTATONIC',
        a4: 440,
        setScale(scaleKey, root) { this.currentScaleKey = scaleKey; this.rootPitchClass = root; },
        feltParams: { waveform: 'felt' },
        droneParams: { 1: {}, 2: {} }
      },
      knobs: {},
      vectorPad: { x: 0.5, y: 0.5 },
      playSurface: {
        chordSpeed: 'slow',
        setChordSpeed(s) { this.chordSpeed = s; },
        rebuildKeys() {}
      },
      updateLoopNotes() {},
      exportPatch: AmbientApp.prototype.exportPatch,
      loadPatch: AmbientApp.prototype.loadPatch
    };

    const exported = mockApp.exportPatch();
    assert.strictEqual(exported.chordSpeed, 'slow');

    // Change and reload
    mockApp.playSurface.chordSpeed = 'fast';
    mockApp.loadPatch({ chordSpeed: 'instant' });
    assert.strictEqual(mockApp.playSurface.chordSpeed, 'instant');
  });
});

describe('Chord Cluster 4 vs 0 Diversification Verification', () => {
  it('guarantees Cluster 4 (Ethereal 11th) and Cluster 0 (Nostalgia 11th) are distinctly diversified', () => {
    const cluster4 = CHORD_VOICINGS.ETHEREAL_11TH;
    const cluster0 = CHORD_VOICINGS.NOSTALGIA_11TH;

    assert.ok(cluster4, 'Cluster 4 (ETHEREAL_11TH) must exist');
    assert.ok(cluster0, 'Cluster 0 (NOSTALGIA_11TH) must exist');

    // Cluster 4 is Major 11th with octave bloom shimmer (1 - 5 - 7 - 9 - 11 - 15ma)
    assert.deepStrictEqual(cluster4.intervals, [0, 7, 11, 14, 17, 24]);
    assert.strictEqual(cluster4.name, 'Ethereal 11th');
    assert.strictEqual(cluster4.description, 'Eno celestial shimmer voicing (1 - 5 - 7 - 9 - 11 - 15ma)');

    // Cluster 0 is Lush Bittersweet Minor 11th (1 - 5 - b7 - 9 - b10 - 11)
    assert.deepStrictEqual(cluster0.intervals, [0, 7, 10, 14, 15, 17]);
    assert.strictEqual(cluster0.name, 'Nostalgia 11th');
    assert.strictEqual(cluster0.description, 'Lush bittersweet minor 11th (1 - 5 - b7 - 9 - b10 - 11)');

    // Contrast analysis:
    // Cluster 4 has interval 11 (Maj7), Cluster 0 has interval 10 (m7)
    assert.strictEqual(cluster4.intervals.includes(11), true, 'Cluster 4 must feature Major 7th');
    assert.strictEqual(cluster4.intervals.includes(10), false, 'Cluster 4 must not contain minor 7th');
    assert.strictEqual(cluster0.intervals.includes(10), true, 'Cluster 0 must feature minor 7th');
    assert.strictEqual(cluster0.intervals.includes(11), false, 'Cluster 0 must not contain Major 7th');

    // Cluster 4 has interval 24 (high octave shimmer), Cluster 0 has interval 15 (minor 10th rub)
    assert.strictEqual(cluster4.intervals.includes(24), true, 'Cluster 4 must feature high octave shimmer');
    assert.strictEqual(cluster4.intervals.includes(15), false, 'Cluster 4 must not contain minor 10th');
    assert.strictEqual(cluster0.intervals.includes(15), true, 'Cluster 0 must feature minor 10th');
    assert.strictEqual(cluster0.intervals.includes(24), false, 'Cluster 0 must not contain high octave shimmer');

    // Note frequencies from C3 root (MIDI 48)
    const freqs4 = getChordFrequencies(48, 'ETHEREAL_11TH', 440);
    const freqs0 = getChordFrequencies(48, 'NOSTALGIA_11TH', 440);
    const midis4 = freqs4.map(f => Math.round(frequencyToMidi(f, 440)));
    const midis0 = freqs0.map(f => Math.round(frequencyToMidi(f, 440)));

    assert.deepStrictEqual(midis4, [48, 55, 59, 62, 65, 72]); // C3, G3, B3, D4, F4, C5
    assert.deepStrictEqual(midis0, [48, 55, 58, 62, 63, 65]); // C3, G3, Bb3, D4, Eb4, F4
  });
});
