/**
 * @file keyboard.js
 * @brief Playable harmonic touch strip, tactile chord cluster macro buttons,
 * visual voice illumination, and computer keyboard mapping.
 */

import { getScaleDegreesInOctaves, CHORD_VOICINGS, getChordFrequencies, SCALES } from '../generative/scales.js';

export class BraunPlaySurface {
  /**
   * @param {HTMLElement} stripContainer
   * @param {HTMLElement} chordsContainer
   * @param {AudioEngine} engine
   */
  constructor(stripContainer, chordsContainer, engine) {
    this.stripContainer = stripContainer;
    this.chordsContainer = chordsContainer;
    this.engine = engine;
    this.onPlay = null;

    this.keyElements = new Map(); // midi -> HTMLElement
    this.activeTouches = new Map();

    this._renderChords();
    this.rebuildKeys();
    this._attachKeyboardShortcuts();
  }

  rebuildKeys() {
    if (!this.stripContainer) return;
    this.stripContainer.innerHTML = '';
    this.keyElements.clear();

    const scale = SCALES[this.engine.currentScaleKey] || SCALES.BUDD_PENTATONIC;
    // 2 octaves from Octave 3 to 4
    const notes = getScaleDegreesInOctaves(this.engine.rootPitchClass, scale.intervals, 3, 4, this.engine.a4);

    notes.forEach((note, idx) => {
      const keyEl = document.createElement('button');
      keyEl.className = 'braun-chime-key';
      keyEl.setAttribute('data-midi', note.midi);
      keyEl.setAttribute('data-freq', note.freq);
      keyEl.setAttribute('aria-label', `Play ${note.name}`);

      keyEl.innerHTML = `
        <div class="braun-key-indicator"></div>
        <div class="braun-key-info">
          <span class="braun-key-name">${note.name}</span>
          <span class="braun-key-degree">DEG ${note.degree}</span>
        </div>
        <div class="braun-key-shortcut">${this._getShortcutKey(idx)}</div>
      `;

      // Pointer event for velocity-sensitive strike
      const triggerStrike = (clientY, clientRect) => {
        let velocity = 0.60;
        if (clientY !== undefined && clientY > 0 && clientRect && clientRect.height > 0) {
          const relY = Math.max(0, Math.min(1, (clientY - clientRect.top) / clientRect.height));
          // Lower hit gives firmer touch (0.45 .. 0.85)
          velocity = 0.35 + relY * 0.50;
        }
        this.playNote(note.freq, note.midi, velocity);
      };

      let handledByPointer = false;
      let clearPointerTimer = null;

      keyEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handledByPointer = true;
        if (clearPointerTimer) {
          clearTimeout(clearPointerTimer);
          clearPointerTimer = null;
        }
        triggerStrike(e.clientY, keyEl.getBoundingClientRect());
      });

      keyEl.addEventListener('pointerup', () => {
        // Retain handledByPointer flag across trailing synthetic click event so releasing LMB does NOT re-trigger
        if (clearPointerTimer) clearTimeout(clearPointerTimer);
        clearPointerTimer = setTimeout(() => {
          handledByPointer = false;
          clearPointerTimer = null;
        }, 400);
      });

      keyEl.addEventListener('pointercancel', () => {
        handledByPointer = false;
        if (clearPointerTimer) {
          clearTimeout(clearPointerTimer);
          clearPointerTimer = null;
        }
      });

      keyEl.addEventListener('click', (e) => {
        // Single strike on pointerdown: releasing LMB must NOT re-trigger a second strike
        if (handledByPointer) {
          return;
        }
        triggerStrike(e.clientY, keyEl.getBoundingClientRect());
      });

      // Allow glissando swiping across keys while mouse button is held down
      let lastEnterTime = -Infinity;
      keyEl.addEventListener('pointerenter', (e) => {
        if (e.buttons === 1) {
          const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
          if (now - lastEnterTime < 140) return;
          lastEnterTime = now;
          triggerStrike(e.clientY, keyEl.getBoundingClientRect());
        }
      });

      this.stripContainer.appendChild(keyEl);
      this.keyElements.set(note.midi, keyEl);
    });
  }

  _getShortcutKey(index) {
    const keys = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Z', 'X', 'C', 'V'];
    return keys[index] || '';
  }

  _renderChords() {
    if (!this.chordsContainer) return;
    this.chordsContainer.innerHTML = '';
    this.chordsContainer.classList.add('braun-chord-macros-grid');

    const chordList = Object.values(CHORD_VOICINGS);
    chordList.forEach((voicing, idx) => {
      const btn = document.createElement('button');
      btn.className = 'braun-chord-macro-btn';
      btn.setAttribute('data-chord', voicing.id);
      const shortcutKey = idx < 9 ? `${idx + 1}` : (idx === 9 ? '0' : (idx === 10 ? '-' : ''));
      btn.innerHTML = `
        <div class="braun-chord-header">
          <span class="braun-chord-title">${voicing.name}</span>
          ${shortcutKey ? `<span class="braun-chord-shortcut">${shortcutKey}</span>` : ''}
        </div>
        <span class="braun-chord-desc">${voicing.description}</span>
      `;

      btn.addEventListener('mouseenter', () => {
        this._updateChordReadout(voicing, false);
      });

      btn.addEventListener('click', () => {
        this.playChord(voicing.id);
      });

      this.chordsContainer.appendChild(btn);
    });
  }

  _updateChordReadout(voicing, isTriggered = false) {
    if (typeof document === 'undefined') return;
    const nameEl = document.getElementById('chord-readout-name');
    const descEl = document.getElementById('chord-readout-desc');
    const ledEl = document.getElementById('chord-status-led');
    if (voicing && nameEl) {
      nameEl.textContent = voicing.name;
    }
    if (voicing && descEl) {
      descEl.textContent = voicing.description;
    }
    if (isTriggered && ledEl) {
      ledEl.style.backgroundColor = 'var(--braun-orange)';
      ledEl.style.boxShadow = '0 0 6px var(--braun-orange)';
      if (ledEl._timer) clearTimeout(ledEl._timer);
      ledEl._timer = setTimeout(() => {
        ledEl.style.backgroundColor = '';
        ledEl.style.boxShadow = '';
      }, 700);
    }
  }

  /**
   * Play single note with visual feedback
   */
  async playNote(freq, midi, velocity = 0.6) {
    this.flashKey(midi);
    if (this.onPlay) {
      await this.onPlay(freq, midi, velocity);
    }
    if (!this.engine || !this.engine.isInitialized || !this.engine.feltPiano) return;

    this.engine.feltPiano.playNote(freq, velocity, 3.5);
  }

  /**
   * Flash LED indicator on the key corresponding to midi note
   */
  flashKey(midi) {
    const keyEl = this.keyElements.get(Math.round(midi));
    if (keyEl) {
      if (keyEl._flashTimer) {
        clearTimeout(keyEl._flashTimer);
      }
      keyEl.classList.add('is-pressed');
      keyEl._flashTimer = setTimeout(() => {
        keyEl.classList.remove('is-pressed');
        keyEl._flashTimer = null;
      }, 250);
    }
  }

  /**
   * Flash active state on chord macro button
   */
  flashChord(voicingId) {
    if (!this.chordsContainer) return;
    const btns = this.chordsContainer.children && this.chordsContainer.children.length > 0
      ? this.chordsContainer.children
      : (this.chordsContainer.querySelectorAll ? this.chordsContainer.querySelectorAll('.braun-chord-macro-btn') : []);
    const btn = Array.from(btns).find(b => b.getAttribute && b.getAttribute('data-chord') === voicingId);
    if (btn) {
      if (btn._flashTimer) {
        clearTimeout(btn._flashTimer);
      }
      btn.classList.add('is-active');
      btn._flashTimer = setTimeout(() => {
        btn.classList.remove('is-active');
        btn._flashTimer = null;
      }, 250);
    }
    const voicing = CHORD_VOICINGS[voicingId] || Object.values(CHORD_VOICINGS).find(v => v.id === voicingId);
    if (voicing) {
      this._updateChordReadout(voicing, true);
    }
  }

  /**
   * Play Harold Budd style chord cluster with subtle strum rubato
   */
  async playChord(voicingId) {
    this.flashChord(voicingId);
    if (this.onPlay) {
      await this.onPlay();
    }

    const rootMidi = 48 + (this.engine ? this.engine.rootPitchClass : 0); // C3 root
    const freqs = getChordFrequencies(rootMidi, voicingId, this.engine ? this.engine.a4 : 440);
    const voicing = CHORD_VOICINGS[voicingId];

    freqs.forEach((freq, idx) => {
      // Humanized micro-strum delay (18ms to 38ms per note)
      const delayMs = idx * (22 + Math.random() * 14);
      setTimeout(() => {
        const vel = 0.55 + Math.random() * 0.22;
        const midi = rootMidi + (voicing ? voicing.intervals[idx] : 0);
        this.flashKey(midi);
        if (this.engine && this.engine.isInitialized && this.engine.feltPiano) {
          this.engine.feltPiano.playNote(freq, vel, 3.5);
        }
      }, delayMs);
    });
  }

  _attachKeyboardShortcuts() {
    const keyMap = {
      'KeyA': 0, 'KeyS': 1, 'KeyD': 2, 'KeyF': 3,
      'KeyG': 4, 'KeyH': 5, 'KeyJ': 6, 'KeyK': 7,
      'KeyL': 8, 'Semicolon': 9, 'Quote': 10,
      'KeyZ': 11, 'KeyX': 12, 'KeyC': 13, 'KeyV': 14
    };

    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      // Ignore if user is in an input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      // Prevent key repeat machine-gun note bursts
      if (e.repeat) return;

      if (keyMap[e.code] !== undefined) {
        const keys = Array.from(this.keyElements.values());
        const keyEl = keys[keyMap[e.code]];
        if (keyEl) {
          e.preventDefault();
          const freq = parseFloat(keyEl.getAttribute('data-freq'));
          const midi = parseInt(keyEl.getAttribute('data-midi'), 10);
          this.playNote(freq, midi, 0.65);
        }
      }

      // 1 to 9, 0, and - triggers chord macros
      if (e.key >= '1' && e.key <= '9') {
        const chordBtns = this.chordsContainer.querySelectorAll('.braun-chord-macro-btn');
        const idx = parseInt(e.key, 10) - 1;
        if (chordBtns[idx]) {
          e.preventDefault();
          chordBtns[idx].click();
        }
      } else if (e.key === '0') {
        const chordBtns = this.chordsContainer.querySelectorAll('.braun-chord-macro-btn');
        if (chordBtns[9]) {
          e.preventDefault();
          chordBtns[9].click();
        }
      } else if (e.key === '-' || e.key === '_') {
        const chordBtns = this.chordsContainer.querySelectorAll('.braun-chord-macro-btn');
        if (chordBtns[10]) {
          e.preventDefault();
          chordBtns[10].click();
        }
      }

      // Spacebar toggles freeze
      if (e.code === 'Space') {
        e.preventDefault();
        const freezeToggle = document.getElementById('toggle-freeze');
        if (freezeToggle) freezeToggle.click();
      }
    });
  }
}
