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
  SEMITONE_KEY_MAP,
  SEMITONE_CHAR_MAP,
  CHIME_KEY_MAP,
  CHIME_CHAR_MAP,
  getSemitoneKeyIndex,
  getChimeKeyIndex,
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
}

describe('WERTU Semitone Keys Architecture & Dieter Rams Chime Strip', () => {
  it('maps W, E, R, T, Y, U keys to exact sequential semitone indices', () => {
    assert.strictEqual(SEMITONE_KEY_MAP['KeyW'], 0, 'KeyW must map to semitone index 0');
    assert.strictEqual(SEMITONE_KEY_MAP['KeyE'], 1, 'KeyE must map to semitone index 1');
    assert.strictEqual(SEMITONE_KEY_MAP['KeyR'], 2, 'KeyR must map to semitone index 2');
    assert.strictEqual(SEMITONE_KEY_MAP['KeyT'], 3, 'KeyT must map to semitone index 3');
    assert.strictEqual(SEMITONE_KEY_MAP['KeyY'], 4, 'KeyY must map to semitone index 4');
    assert.strictEqual(SEMITONE_KEY_MAP['KeyU'], 5, 'KeyU must map to semitone index 5');
    assert.strictEqual(SEMITONE_KEY_MAP['KeyI'], 6, 'KeyI must map to semitone index 6');
    assert.strictEqual(SEMITONE_KEY_MAP['KeyO'], 7, 'KeyO must map to semitone index 7');
    assert.strictEqual(SEMITONE_KEY_MAP['KeyP'], 8, 'KeyP must map to semitone index 8');
    assert.strictEqual(SEMITONE_KEY_MAP['BracketLeft'], 9, 'BracketLeft must map to semitone index 9');
  });

  it('correctly resolves semitones by event code and event key case-insensitively', () => {
    assert.strictEqual(getSemitoneKeyIndex({ code: 'KeyW' }), 0);
    assert.strictEqual(getSemitoneKeyIndex({ key: 'W' }), 0);
    assert.strictEqual(getSemitoneKeyIndex({ key: 'w' }), 0);
    assert.strictEqual(getSemitoneKeyIndex({ code: 'KeyE' }), 1);
    assert.strictEqual(getSemitoneKeyIndex({ key: 'E' }), 1);
    assert.strictEqual(getSemitoneKeyIndex({ key: 'e' }), 1);
    assert.strictEqual(getSemitoneKeyIndex({ code: 'KeyR' }), 2);
    assert.strictEqual(getSemitoneKeyIndex({ key: 'r' }), 2);
    assert.strictEqual(getSemitoneKeyIndex({ code: 'KeyT' }), 3);
    assert.strictEqual(getSemitoneKeyIndex({ key: 't' }), 3);
    assert.strictEqual(getSemitoneKeyIndex({ code: 'KeyU' }), 5);
    assert.strictEqual(getSemitoneKeyIndex({ key: 'u' }), 5);
  });

  it('identifies W, E, R, T, U as playable synthesizer keys to blur UI controls and prevent default', () => {
    ['KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'].forEach(code => {
      assert.strictEqual(isPlayableSynthesizerKey({ code }), true, `${code} must be a playable synth key`);
    });
    // Non-synth keys
    ['KeyQ', 'Tab', 'Escape', 'Enter'].forEach(code => {
      assert.strictEqual(isPlayableSynthesizerKey({ code }), false, `${code} must not be a playable synth key`);
    });
  });

  it('rebuilds chime strip with dual-tier grid: Semitones on Row 1, Diatonics on Row 2', () => {
    const mockStrip = new MockElement('div');
    const mockChords = new MockElement('div');
    const playedNotes = [];
    const releasedVoices = [];

    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0, // C
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

      // In Budd Pentatonic (5 notes/octave * 2 octaves = 10 notes)
      assert.strictEqual(surface.diatonicKeys.length, 10, 'Must have 10 diatonic keys');
      assert.strictEqual(surface.semitoneKeys.length, 10, 'Must have 10 semitone keys');
      // Strip container contains 20 total keys (10 diatonic + 10 semitones)
      assert.strictEqual(mockStrip.children.length, 20, 'Strip container must have 20 children');

      // First child is Note 0 Diatonic (C3)
      const firstDiatonic = mockStrip.children[0];
      assert.strictEqual(firstDiatonic.getAttribute('data-midi'), '48', 'First child must be C3 (MIDI 48)');
      assert.strictEqual(firstDiatonic.classList.contains('braun-diatonic-key'), true, 'Must have braun-diatonic-key class');
      assert.strictEqual(firstDiatonic.style.gridRow, '2', 'Diatonic key must be on grid row 2');
      assert.strictEqual(firstDiatonic.style.gridColumn, '1', 'Diatonic key 0 must be in grid column 1');

      // Semitone keys are on Row 1
      const firstSemitone = surface.semitoneKeys[0];
      assert.strictEqual(firstSemitone.getAttribute('data-midi'), '49', 'First semitone must be C#3 (MIDI 49)');
      assert.strictEqual(firstSemitone.classList.contains('braun-semitone-key'), true, 'Must have braun-semitone-key class');
      assert.strictEqual(firstSemitone.style.gridRow, '1', 'Semitone key must be on grid row 1');
      assert.strictEqual(firstSemitone.style.gridColumn, '1', 'Semitone key 0 must align with column 1');

      // Verify second pair (D3 on bottom, D#3 on top)
      const secondDiatonic = surface.diatonicKeys[1];
      const secondSemitone = surface.semitoneKeys[1];
      assert.strictEqual(secondDiatonic.getAttribute('data-midi'), '50', 'Second diatonic must be D3 (MIDI 50)');
      assert.strictEqual(secondSemitone.getAttribute('data-midi'), '51', 'Second semitone must be D#3 (MIDI 51)');
      assert.strictEqual(secondDiatonic.style.gridColumn, '2');
      assert.strictEqual(secondSemitone.style.gridColumn, '2');

      // Verify third pair (E3 on bottom, F3 on top for singing 4th suspension)
      const thirdDiatonic = surface.diatonicKeys[2];
      const thirdSemitone = surface.semitoneKeys[2];
      assert.strictEqual(thirdDiatonic.getAttribute('data-midi'), '52', 'Third diatonic must be E3 (MIDI 52)');
      assert.strictEqual(thirdSemitone.getAttribute('data-midi'), '53', 'Third semitone must be F3 (MIDI 53)');
      assert.strictEqual(thirdSemitone.innerHTML.includes('>R<') || thirdSemitone.innerHTML.includes('[R]'), true, 'Shortcut R must be displayed on semitone 2');

      // Verify keyboard shortcuts match badges
      assert.strictEqual(surface._getShortcutKey(0), 'A');
      assert.strictEqual(surface._getShortcutKey(1), 'S');
      assert.strictEqual(surface._getShortcutKey(2), 'D');
      assert.strictEqual(surface._getSemitoneShortcutKey(0), 'W');
      assert.strictEqual(surface._getSemitoneShortcutKey(1), 'E');
      assert.strictEqual(surface._getSemitoneShortcutKey(2), 'R');
      assert.strictEqual(surface._getSemitoneShortcutKey(3), 'T');
      assert.strictEqual(surface._getSemitoneShortcutKey(4), 'Y');
      assert.strictEqual(surface._getSemitoneShortcutKey(5), 'U');
    } finally {
      globalThis.document = origDoc;
    }
  });

  it('triggers and releases semitone notes with continuous hold-sustain via WERTU keys', () => {
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
      body: new MockElement('body')
    };

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      assert.ok(keydownHandler, 'keydown handler must be registered');
      assert.ok(keyupHandler, 'keyup handler must be registered');

      // 1. Press KeyW (C#3 semitone)
      keydownHandler({
        code: 'KeyW',
        key: 'w',
        repeat: false,
        target: { tagName: 'DIV' },
        preventDefault: () => {}
      });

      assert.strictEqual(playedNotes.length, 1, 'KeyW must trigger note');
      const voiceW = playedNotes[0];
      assert.strictEqual(Math.round(frequencyToMidi(voiceW.freq, 440)), 49, 'KeyW must sound C#3 (MIDI 49)');
      assert.strictEqual(voiceW.isHold, true, 'Holding KeyW must engage isHold');
      assert.strictEqual(releasedVoices.length, 0, 'Note must not be released while held');

      const semitoneKeyW = surface.semitoneKeys[0];
      assert.strictEqual(semitoneKeyW._isHeld, true, 'Semitone key element must be marked held');
      assert.strictEqual(semitoneKeyW.classList.contains('is-active'), true, 'Semitone key must have is-active class');

      // 2. Release KeyW
      keyupHandler({
        code: 'KeyW',
        key: 'w',
        target: { tagName: 'DIV' }
      });

      assert.strictEqual(releasedVoices.length, 1, 'Releasing KeyW must release voice');
      assert.strictEqual(releasedVoices[0], voiceW, 'Released voice must match KeyW voice');
      assert.strictEqual(semitoneKeyW._isHeld, false, 'Semitone key must no longer be held');
      assert.strictEqual(semitoneKeyW.classList.contains('is-active'), false, 'Semitone key is-active must be removed');

      // 3. Press KeyE (D#3 semitone, index 1)
      keydownHandler({
        code: 'KeyE',
        key: 'e',
        repeat: false,
        target: { tagName: 'DIV' },
        preventDefault: () => {}
      });

      assert.strictEqual(playedNotes.length, 2, 'KeyE must trigger note');
      const voiceE = playedNotes[1];
      assert.strictEqual(Math.round(frequencyToMidi(voiceE.freq, 440)), 51, 'KeyE must sound D#3 (MIDI 51)');

      // 4. Press KeyR (F3 semitone, index 2)
      keydownHandler({
        code: 'KeyR',
        key: 'r',
        repeat: false,
        target: { tagName: 'DIV' },
        preventDefault: () => {}
      });

      assert.strictEqual(playedNotes.length, 3, 'KeyR must trigger note');
      const voiceR = playedNotes[2];
      assert.strictEqual(Math.round(frequencyToMidi(voiceR.freq, 440)), 53, 'KeyR must sound F3 (MIDI 53)');

      // 5. Release KeyE and KeyR
      keyupHandler({ code: 'KeyE', key: 'e', target: { tagName: 'DIV' } });
      keyupHandler({ code: 'KeyR', key: 'r', target: { tagName: 'DIV' } });
      assert.strictEqual(releasedVoices.length, 3, 'All voices must be released cleanly');
    } finally {
      globalThis.window = origWin;
      globalThis.document = origDoc;
    }
  });

  it('supports mouse/touch glissando swiping across semitone accidental keys', () => {
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
      const semitone1 = surface.semitoneKeys[0]; // C#3
      const semitone2 = surface.semitoneKeys[1]; // D#3

      // 1. Pointerdown on Semitone 1
      semitone1.dispatchEvent('pointerdown', { buttons: 1, clientY: 50, preventDefault: () => {} });
      assert.strictEqual(playedNotes.length, 1, 'Semitone 1 must sound');
      assert.strictEqual(semitone1._isHeld, true);
      assert.strictEqual(semitone1.classList.contains('is-pressed'), true);

      // 2. Glissando enter Semitone 2
      semitone2.dispatchEvent('pointerenter', { buttons: 1, clientY: 48 });
      assert.strictEqual(playedNotes.length, 2, 'Semitone 2 must sound on glissando swipe');
      assert.strictEqual(releasedVoices.length, 1, 'Semitone 1 must be released');
      assert.strictEqual(semitone1._isHeld, false);
      assert.strictEqual(semitone2._isHeld, true);

      // 3. Pointerup releases active semitone
      semitone2.dispatchEvent('pointerup', {});
      assert.strictEqual(releasedVoices.length, 2, 'Semitone 2 must be released on pointerup');
      assert.strictEqual(semitone2._isHeld, false);
    } finally {
      globalThis.document = origDoc;
    }
  });

  it('verifies CSS style rules for braun-chime-strip grid and braun-semitone-key contrast', () => {
    const cssPath = path.join(__dirname, '..', 'css', 'style.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // 1. Grid layout for dual-tier chime strip
    assert.ok(
      css.includes('.braun-chime-strip {') &&
      css.includes('display: grid;') &&
      css.includes('grid-template-rows: 32px 58px;'),
      'Chime strip must use CSS Grid with 32px semitone row and 58px diatonic row'
    );

    // 2. Semitone accidental key styling
    assert.ok(
      css.includes('.braun-chime-key.braun-semitone-key {') &&
      css.includes('height: 32px;'),
      'Semitone keys must have dedicated height 32px'
    );

    // 3. Signal orange active/pressed state
    assert.ok(
      css.includes('.braun-chime-key.braun-semitone-key.is-pressed') &&
      css.includes('background: var(--braun-orange);'),
      'Active semitone keys must illuminate in Braun signal orange'
    );

    // 4. Dark theme high contrast
    assert.ok(
      css.includes('[data-theme="dark"] .braun-chime-key.braun-semitone-key') &&
      css.includes('border-color: #2F323A;'),
      'Dark theme semitone keys must have high-contrast border and anthracite background'
    );
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
