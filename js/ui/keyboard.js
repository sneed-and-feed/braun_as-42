/**
 * @file keyboard.js
 * @brief Playable harmonic touch strip, tactile chord cluster macro buttons,
 * visual voice illumination, computer keyboard mapping, and chord strum speed control.
 */

import { getScaleDegreesInOctaves, CHORD_VOICINGS, getChordFrequencies, SCALES, NOTE_NAMES, midiToFrequency } from '../generative/scales.js';

export const CHIME_KEY_MAP = {
  'KeyA': 0, 'KeyS': 1, 'KeyD': 2, 'KeyF': 3,
  'KeyG': 4, 'KeyH': 5, 'KeyJ': 6, 'KeyK': 7,
  'KeyL': 8, 'Semicolon': 9, 'Quote': 10,
  'KeyZ': 11, 'KeyX': 12, 'KeyC': 13, 'KeyV': 14
};

export const CHIME_CHAR_MAP = {
  'a': 0, 's': 1, 'd': 2, 'f': 3, 'g': 4, 'h': 5, 'j': 6, 'k': 7,
  'l': 8, ';': 9, "'": 10, 'z': 11, 'x': 12, 'c': 13, 'v': 14
};

export const CHORD_KEY_MAP = {
  'Digit1': 0, 'Digit2': 1, 'Digit3': 2, 'Digit4': 3, 'Digit5': 4, 'Digit6': 5,
  'Digit7': 6, 'Digit8': 7, 'Digit9': 8, 'Digit0': 9,
  'Minus': 10, 'Equal': 11,
  'Numpad1': 0, 'Numpad2': 1, 'Numpad3': 2, 'Numpad4': 3, 'Numpad5': 4, 'Numpad6': 5,
  'Numpad7': 6, 'Numpad8': 7, 'Numpad9': 8, 'Numpad0': 9,
  'NumpadSubtract': 10, 'NumpadAdd': 11
};

export const CHORD_SPEEDS = {
  slow: {
    id: 'slow',
    name: 'SLOW',
    label: 'SLOW',
    rateMs: 120,
    jitterMs: 10,
    description: 'Slow ambient drone wash (120ms strum)'
  },
  med: {
    id: 'med',
    name: 'MED',
    label: 'MED',
    rateMs: 50,
    jitterMs: 6,
    description: 'Gentle roll (50ms strum)'
  },
  fast: {
    id: 'fast',
    name: 'FAST',
    label: 'FAST',
    rateMs: 20,
    jitterMs: 4,
    description: 'Quick flourish (20ms strum)'
  },
  instant: {
    id: 'instant',
    name: 'INSTANT',
    label: 'INSTANT',
    rateMs: 0,
    jitterMs: 0,
    description: 'Simultaneous block strike (0ms)'
  }
};

export function getChimeKeyIndex(e) {
  if (!e) return null;
  if (e.code && CHIME_KEY_MAP[e.code] !== undefined) return CHIME_KEY_MAP[e.code];
  const lower = e.key ? e.key.toLowerCase() : '';
  return CHIME_CHAR_MAP[lower] !== undefined ? CHIME_CHAR_MAP[lower] : null;
}

export function getChordKeyIndex(e) {
  if (!e) return null;
  if (e.code && CHORD_KEY_MAP[e.code] !== undefined) return CHORD_KEY_MAP[e.code];
  if (e.key >= '1' && e.key <= '9') return parseInt(e.key, 10) - 1;
  if (e.key === '0') return 9;
  if (e.key === '-' || e.key === '_') return 10;
  if (e.key === '=' || e.key === '+') return 11;
  return null;
}

export function isFreezeHotkey(e) {
  if (!e) return false;
  return e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
}

export function isPlayableSynthesizerKey(e) {
  return getChimeKeyIndex(e) !== null || getChordKeyIndex(e) !== null || isFreezeHotkey(e);
}

export function isTextInputElement(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (el.type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type);
  }
  if (el.isContentEditable) return true;
  return false;
}

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
    this.allKeysByMidi = new Map(); // midi -> HTMLElement[]
    this.diatonicKeys = [];
    this.semitoneKeys = []; // kept empty for backward compatibility
    this.chordSpeed = 'med'; // 'slow' | 'med' | 'fast' | 'instant'
    this.activeTouches = new Map();
    this.activePointerVoices = new Set();
    this.activePointerChordSessions = new Set();
    this._isPointerGlissandoActive = false;
    this._currentGlissandoKey = null;
    this._currentGlissandoVoice = null;
    this._releaseCurrentGlissando = null;

    this._renderChords();
    this._attachChordSpeedControls();
    this.rebuildKeys();
    this._attachKeyboardShortcuts();
  }

  _getShortcutKey(index) {
    const keys = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"];
    return keys[index] || '';
  }

  _registerKeyByMidi(midi, keyEl) {
    const roundMidi = Math.round(midi);
    if (!this.allKeysByMidi.has(roundMidi)) {
      this.allKeysByMidi.set(roundMidi, []);
    }
    this.allKeysByMidi.get(roundMidi).push(keyEl);
  }

  _attachChordSpeedControls() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const speedSwitch = document.getElementById('chord-speed-switch');
    const speedBtns = speedSwitch
      ? (speedSwitch.querySelectorAll ? speedSwitch.querySelectorAll('.braun-speed-btn') : (speedSwitch.children || []))
      : (typeof document.querySelectorAll === 'function' ? document.querySelectorAll('.braun-speed-btn') : []);

    Array.from(speedBtns).forEach(btn => {
      if (btn._hasSpeedListener) return;
      btn._hasSpeedListener = true;
      btn.addEventListener('click', (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const speed = btn.getAttribute('data-speed');
        if (speed) {
          this.setChordSpeed(speed);
        }
        if (typeof btn.blur === 'function') btn.blur();
      });
    });

    this._updateSpeedButtonsUI();
  }

  /**
   * Set chord cluster trigger speed: 'slow', 'med', 'fast', or 'instant'
   * @param {string} speed
   */
  setChordSpeed(speed) {
    const valid = CHORD_SPEEDS[speed] ? speed : 'med';
    this.chordSpeed = valid;
    this._updateSpeedButtonsUI();
  }

  _updateSpeedButtonsUI() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const speedSwitch = document.getElementById('chord-speed-switch');
    const speedBtns = speedSwitch
      ? (speedSwitch.querySelectorAll ? speedSwitch.querySelectorAll('.braun-speed-btn') : (speedSwitch.children || []))
      : (typeof document.querySelectorAll === 'function' ? document.querySelectorAll('.braun-speed-btn') : []);

    Array.from(speedBtns).forEach(btn => {
      const match = btn.getAttribute && btn.getAttribute('data-speed') === this.chordSpeed;
      if (btn.classList) {
        btn.classList.toggle('is-active', match);
      }
      if (typeof btn.setAttribute === 'function') {
        btn.setAttribute('aria-checked', match ? 'true' : 'false');
      }
    });
  }

  rebuildKeys() {
    if (!this.stripContainer) return;
    this.stripContainer.innerHTML = '';
    this.keyElements.clear();
    this.allKeysByMidi.clear();
    this.diatonicKeys = [];
    this.semitoneKeys = [];

    const scale = SCALES[this.engine?.currentScaleKey] || SCALES.BUDD_PENTATONIC;
    // Generate scale degrees across octaves 3 to 5 and slice exactly the 11 diatonic/modal keys (A through ')
    const allNotes = getScaleDegreesInOctaves(this.engine?.rootPitchClass ?? 0, scale.intervals, 3, 5, this.engine?.a4 ?? 440);
    const notes = allNotes.slice(0, 11);

    notes.forEach((note, idx) => {
      const keyEl = document.createElement('button');
      keyEl.className = 'braun-chime-key';
      keyEl.setAttribute('data-midi', note.midi);
      keyEl.setAttribute('data-freq', note.freq);
      keyEl.setAttribute('aria-label', `Play ${note.name}`);
      keyEl.setAttribute('draggable', 'false');

      const shortcutKey = this._getShortcutKey(idx);

      keyEl.innerHTML = `
        <div class="braun-key-indicator"></div>
        <div class="braun-key-info">
          <span class="braun-key-name">${note.name}</span>
          <span class="braun-key-degree">DEG ${note.degree}</span>
        </div>
        <div class="braun-key-shortcut">${shortcutKey}</div>
      `;

      let activeVoice = null;
      let handledByPointer = false;
      let clearPointerTimer = null;

      keyEl.addEventListener('dragstart', (e) => e.preventDefault());

      // Pointer event for velocity-sensitive strike
      const triggerStrike = (clientY, clientRect, isHold = false) => {
        let velocity = 0.60;
        if (clientY !== undefined && clientY > 0 && clientRect && clientRect.height > 0) {
          const relY = Math.max(0, Math.min(1, (clientY - clientRect.top) / clientRect.height));
          // Lower hit gives firmer touch (0.35 .. 0.85)
          velocity = 0.35 + relY * 0.50;
        }
        return this.playNote(note.freq, note.midi, velocity, isHold ? 20.0 : 3.5, isHold);
      };

      const handleKeyRelease = () => {
        keyEl._isHeld = false;
        if (activeVoice) {
          this.activePointerVoices.delete(activeVoice);
          if (typeof activeVoice.release === 'function') {
            activeVoice.release();
          } else if (activeVoice && typeof activeVoice.then === 'function') {
            activeVoice.then(v => { if (v && typeof v.release === 'function') v.release(); });
          }
          activeVoice = null;
        }
        keyEl.classList.remove('is-pressed');
        keyEl.classList.remove('is-active');
        if (this._currentGlissandoKey === keyEl) {
          this._currentGlissandoKey = null;
          this._currentGlissandoVoice = null;
          this._releaseCurrentGlissando = null;
        }
        if (clearPointerTimer) clearTimeout(clearPointerTimer);
        clearPointerTimer = setTimeout(() => {
          handledByPointer = false;
          clearPointerTimer = null;
        }, 400);
      };

      const activateKey = (clientY, clientRect) => {
        // Prevent duplicate trigger if key is already actively held
        if (this._currentGlissandoKey === keyEl && keyEl._isHeld) {
          return;
        }
        // If transitioning from another key during glissando swipe, release previous key smoothly
        if (this._currentGlissandoKey && this._currentGlissandoKey !== keyEl) {
          if (typeof this._releaseCurrentGlissando === 'function') {
            this._releaseCurrentGlissando();
          }
        }
        handledByPointer = true;
        if (clearPointerTimer) {
          clearTimeout(clearPointerTimer);
          clearPointerTimer = null;
        }
        if (activeVoice) {
          this.activePointerVoices.delete(activeVoice);
          if (typeof activeVoice.release === 'function') {
            activeVoice.release();
          } else if (activeVoice && typeof activeVoice.then === 'function') {
            activeVoice.then(v => { if (v && typeof v.release === 'function') v.release(); });
          }
          activeVoice = null;
        }
        keyEl._isHeld = true;
        keyEl.classList.add('is-pressed');
        keyEl.classList.add('is-active');
        activeVoice = triggerStrike(clientY, clientRect || (keyEl.getBoundingClientRect ? keyEl.getBoundingClientRect() : null), true);
        if (activeVoice) {
          this.activePointerVoices.add(activeVoice);
        }
        this._currentGlissandoKey = keyEl;
        this._currentGlissandoVoice = activeVoice;
        this._releaseCurrentGlissando = handleKeyRelease;
      };

      keyEl._activateGlissando = (clientY) => {
        if (this._currentGlissandoKey !== keyEl) {
          activateKey(clientY, keyEl.getBoundingClientRect ? keyEl.getBoundingClientRect() : null);
        }
      };

      keyEl.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (e.preventDefault) e.preventDefault();
        try {
          if (e.target && e.target.releasePointerCapture && e.pointerId != null) {
            e.target.releasePointerCapture(e.pointerId);
          }
        } catch (err) {}
        this._isPointerGlissandoActive = true;
        activateKey(e.clientY, keyEl.getBoundingClientRect ? keyEl.getBoundingClientRect() : null);
      });

      keyEl.addEventListener('pointerenter', (e) => {
        // Expressive glissando: slide horizontally across keys while holding mouse button
        if ((e.buttons === 1 || this._isPointerGlissandoActive) && this._currentGlissandoKey !== keyEl) {
          this._isPointerGlissandoActive = true;
          activateKey(e.clientY, keyEl.getBoundingClientRect ? keyEl.getBoundingClientRect() : null);
        }
      });

      keyEl.addEventListener('pointerup', () => {
        this._isPointerGlissandoActive = false;
        handleKeyRelease();
        if (typeof keyEl.blur === 'function') keyEl.blur();
      });

      keyEl.addEventListener('pointercancel', () => {
        this._isPointerGlissandoActive = false;
        handleKeyRelease();
        if (typeof keyEl.blur === 'function') keyEl.blur();
      });

      keyEl.addEventListener('click', (e) => {
        // Single strike on pointerdown: releasing LMB must NOT re-trigger a second strike
        if (handledByPointer) {
          if (typeof keyEl.blur === 'function') keyEl.blur();
          return;
        }
        triggerStrike(e.clientY, keyEl.getBoundingClientRect ? keyEl.getBoundingClientRect() : null, false);
        if (typeof keyEl.blur === 'function') keyEl.blur();
      });

      this.diatonicKeys.push(keyEl);
      this.keyElements.set(note.midi, keyEl);
      this._registerKeyByMidi(note.midi, keyEl);
      this.stripContainer.appendChild(keyEl);
    });

    // Support container & window level drag tracking for smooth glissando on touch & mouse swipe
    const findKeyAtPoint = (clientX, clientY) => {
      if (typeof document === 'undefined') return null;
      // 1. Direct hit via elementFromPoint
      if (typeof document.elementFromPoint === 'function') {
        const el = document.elementFromPoint(clientX, clientY);
        const target = el ? (el.classList && el.classList.contains && el.classList.contains('braun-chime-key') ? el : (el.closest ? el.closest('.braun-chime-key') : null)) : null;
        if (target) return target;
      }
      // 2. Fallback: horizontal hit test across keys in chime strip
      if (this.stripContainer && typeof this.stripContainer.getBoundingClientRect === 'function') {
        const stripRect = this.stripContainer.getBoundingClientRect();
        if (stripRect && clientY >= stripRect.top - 40 && clientY <= stripRect.bottom + 40) {
          const keys = (this.stripContainer.children && this.stripContainer.children.length > 0)
            ? Array.from(this.stripContainer.children)
            : this.diatonicKeys;

          for (const keyEl of keys) {
            if (typeof keyEl.getBoundingClientRect === 'function') {
              const r = keyEl.getBoundingClientRect();
              if (r && clientX >= r.left && clientX <= r.right) {
                return keyEl;
              }
            }
          }
        }
      }
      return null;
    };

    const handlePointerMove = (e) => {
      if (e.buttons === 0 && (e.pointerType === 'mouse' || e.pointerType === undefined)) {
        if (this._isPointerGlissandoActive) {
          this._isPointerGlissandoActive = false;
          if (typeof this._releaseCurrentGlissando === 'function') {
            this._releaseCurrentGlissando();
          }
        }
        return;
      }
      if (e.buttons === 1 || this._isPointerGlissandoActive) {
        const targetKey = findKeyAtPoint(e.clientX, e.clientY);
        if (targetKey && targetKey !== this._currentGlissandoKey && typeof targetKey._activateGlissando === 'function') {
          targetKey._activateGlissando(e.clientY);
        }
      }
    };

    if (this.stripContainer && typeof this.stripContainer.addEventListener === 'function') {
      this.stripContainer.addEventListener('pointermove', handlePointerMove);

      this.stripContainer.addEventListener('pointerleave', (e) => {
        if (this._isPointerGlissandoActive && e.buttons === 0) {
          this._isPointerGlissandoActive = false;
          if (typeof this._releaseCurrentGlissando === 'function') {
            this._releaseCurrentGlissando();
          }
        }
      });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pointermove', (e) => {
        if (this._isPointerGlissandoActive) {
          handlePointerMove(e);
        }
      });
    }
  }

  _renderChords() {
    if (!this.chordsContainer) return;
    this.chordsContainer.innerHTML = '';
    this.chordsContainer.classList.add('braun-chord-macros-grid');

    const chordList = Object.values(CHORD_VOICINGS);
    const chordShortcuts = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

    chordList.forEach((voicing, idx) => {
      const btn = document.createElement('button');
      btn.className = 'braun-chord-macro-btn';
      btn.setAttribute('data-chord', voicing.id);
      const shortcutKey = chordShortcuts[idx] || '';
      btn.innerHTML = `
        <div class="braun-chord-header">
          <span class="braun-chord-title">${voicing.name}</span>
          ${shortcutKey ? `<span class="braun-chord-shortcut">${shortcutKey}</span>` : ''}
        </div>
        <span class="braun-chord-desc">${voicing.description}</span>
      `;

      btn.setAttribute('draggable', 'false');
      btn.addEventListener('dragstart', (e) => e.preventDefault());

      btn.addEventListener('mouseenter', () => {
        this._updateChordReadout(voicing, false);
      });

      let activeSession = null;
      let handledByPointer = false;
      let clearPointerTimer = null;

      const triggerChordRelease = () => {
        btn._isHeld = false;
        btn.classList.remove('is-active');
        if (activeSession) {
          this.activePointerChordSessions.delete(activeSession);
          this.stopChordSession(activeSession);
          activeSession = null;
        }
        if (clearPointerTimer) clearTimeout(clearPointerTimer);
        clearPointerTimer = setTimeout(() => {
          handledByPointer = false;
          clearPointerTimer = null;
        }, 400);
      };

      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (e.preventDefault) e.preventDefault();
        handledByPointer = true;
        if (clearPointerTimer) {
          clearTimeout(clearPointerTimer);
          clearPointerTimer = null;
        }
        if (activeSession) {
          this.activePointerChordSessions.delete(activeSession);
          this.stopChordSession(activeSession);
          activeSession = null;
        }
        try {
          if (btn.setPointerCapture && e.pointerId != null) {
            btn.setPointerCapture(e.pointerId);
          }
        } catch (err) {}

        btn._isHeld = true;
        btn.classList.add('is-active');
        activeSession = this.startChord(voicing.id, true);
        if (activeSession) {
          this.activePointerChordSessions.add(activeSession);
        }
      });

      btn.addEventListener('pointerup', (e) => {
        try {
          if (btn.releasePointerCapture && e.pointerId != null) {
            btn.releasePointerCapture(e.pointerId);
          }
        } catch (err) {}
        triggerChordRelease();
        if (typeof btn.blur === 'function') btn.blur();
      });

      btn.addEventListener('pointercancel', (e) => {
        try {
          if (btn.releasePointerCapture && e.pointerId != null) {
            btn.releasePointerCapture(e.pointerId);
          }
        } catch (err) {}
        triggerChordRelease();
        if (typeof btn.blur === 'function') btn.blur();
      });

      btn.addEventListener('pointerleave', (e) => {
        if (activeSession && e.buttons === 0) {
          triggerChordRelease();
          if (typeof btn.blur === 'function') btn.blur();
        }
      });

      btn.addEventListener('click', () => {
        // Single strike on pointerdown: releasing LMB must NOT re-trigger a second strike
        if (handledByPointer) {
          if (typeof btn.blur === 'function') btn.blur();
          return;
        }
        this.playChord(voicing.id);
        if (typeof btn.blur === 'function') btn.blur();
      });

      this.chordsContainer.appendChild(btn);
    });
  }

  _updateChordReadout(voicing, isTriggered = false) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
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
  playNote(freq, midi, velocity = 0.6, duration = 3.5, isHold = false) {
    this.flashKey(midi);
    if (this.onPlay) {
      this.onPlay(freq, midi, velocity);
    }
    if (!this.engine || !this.engine.isInitialized || !this.engine.feltPiano) {
      if (this.engine && this.engine._initPromise) {
        return this.engine._initPromise.then(() => {
          if (this.engine && this.engine.feltPiano) {
            return this.engine.feltPiano.playNote(freq, velocity, duration, isHold);
          }
          return null;
        });
      }
      return null;
    }

    return this.engine.feltPiano.playNote(freq, velocity, duration, isHold);
  }

  /**
   * Flash LED indicator on the key corresponding to midi note
   */
  flashKey(midi) {
    const roundMidi = Math.round(midi);
    const elements = this.allKeysByMidi ? this.allKeysByMidi.get(roundMidi) : null;
    if (elements && elements.length > 0) {
      elements.forEach(keyEl => this._flashElement(keyEl));
    } else {
      const keyEl = this.keyElements.get(roundMidi);
      if (keyEl) this._flashElement(keyEl);
    }
  }

  _flashElement(keyEl) {
    if (!keyEl) return;
    if (keyEl._flashTimer) {
      clearTimeout(keyEl._flashTimer);
      keyEl._flashTimer = null;
    }
    keyEl.classList.add('is-pressed');
    if (!keyEl._isHeld) {
      keyEl._flashTimer = setTimeout(() => {
        if (!keyEl._isHeld) {
          keyEl.classList.remove('is-pressed');
        }
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
        btn._flashTimer = null;
      }
      btn.classList.add('is-active');
      if (!btn._isHeld) {
        btn._flashTimer = setTimeout(() => {
          if (!btn._isHeld) {
            btn.classList.remove('is-active');
          }
          btn._flashTimer = null;
        }, 250);
      }
    }
    const voicing = CHORD_VOICINGS[voicingId] || Object.values(CHORD_VOICINGS).find(v => v.id === voicingId);
    if (voicing) {
      this._updateChordReadout(voicing, true);
    }
  }

  /**
   * Start playing a chord cluster with optional sustain holding
   * @param {string} voicingId
   * @param {boolean} [isHold=false]
   * @returns {Object} chordSession
   */
  startChord(voicingId, isHold = false) {
    this.flashChord(voicingId);
    if (this.onPlay) {
      this.onPlay();
    }

    const rootMidi = 48 + (this.engine ? this.engine.rootPitchClass : 0); // C3 root
    const freqs = getChordFrequencies(rootMidi, voicingId, this.engine ? this.engine.a4 : 440);
    const voicing = CHORD_VOICINGS[voicingId];
    const duration = isHold ? 20.0 : 3.5;

    const session = {
      voicingId,
      isReleased: false,
      voices: [],
      timers: []
    };

    const triggerChordVoice = (freq, vel, midi) => {
      this.flashKey(midi);
      const playVoice = (piano) => {
        const voice = piano.playNote(freq, vel, duration, isHold, true);
        if (voice) {
          session.voices.push(voice);
          if (session.isReleased) {
            if (typeof voice.release === 'function') voice.release();
            else if (voice && typeof voice.then === 'function') voice.then(v => v?.release?.());
          }
        }
      };

      if (this.engine && this.engine.isInitialized && this.engine.feltPiano) {
        playVoice(this.engine.feltPiano);
      } else if (this.engine && this.engine._initPromise) {
        this.engine._initPromise.then(() => {
          if (this.engine && this.engine.feltPiano) {
            playVoice(this.engine.feltPiano);
          }
        });
      }
    };

    const speedConfig = CHORD_SPEEDS[this.chordSpeed] || CHORD_SPEEDS.med;
    const isInstant = speedConfig.rateMs === 0;

    freqs.forEach((freq, idx) => {
      // Strum delay based on selected chord speed
      const baseDelay = idx * speedConfig.rateMs;
      const jitter = (idx > 0 && speedConfig.jitterMs > 0) ? Math.random() * speedConfig.jitterMs : 0;
      const delayMs = isInstant ? 0 : (baseDelay + jitter);

      const timerId = setTimeout(() => {
        if (session.isReleased && isHold) {
          return;
        }
        // For slow strum, slightly soften the initial attack velocity so it blooms gently over drone beds
        const velBase = speedConfig.rateMs >= 100 ? 0.50 : 0.55;
        const vel = velBase + Math.random() * 0.20;
        const midi = rootMidi + (voicing ? voicing.intervals[idx] : 0);
        triggerChordVoice(freq, vel, midi);
      }, delayMs);
      session.timers.push(timerId);
    });

    return session;
  }

  stopChordSession(session) {
    if (!session || session.isReleased) return;
    session.isReleased = true;
    session.timers.forEach(t => clearTimeout(t));
    session.timers = [];
    session.voices.forEach(voice => {
      if (voice) {
        if (typeof voice.release === 'function') {
          voice.release();
        } else if (typeof voice.then === 'function') {
          voice.then(v => { if (v && typeof v.release === 'function') v.release(); });
        }
      }
    });
    session.voices = [];
  }

  /**
   * Play Harold Budd style chord cluster with subtle strum rubato
   */
  async playChord(voicingId) {
    return this.startChord(voicingId, false);
  }

  _attachKeyboardShortcuts() {
    const getKeyIndex = (e) => getChimeKeyIndex(e);
    const getChordIndex = (e) => getChordKeyIndex(e);

    this.activeHeldKeys = new Map();
    this.activeHeldChords = new Map();

    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      // 1. Ignore if user is in a true text input field (e.g. knob direct numerical input)
      if (isTextInputElement(e.target) || (typeof document !== 'undefined' && isTextInputElement(document.activeElement))) {
        return;
      }

      const chimeIdx = getKeyIndex(e);
      const chordIdx = getChordIndex(e);
      const isFreeze = isFreezeHotkey(e);
      const isPlayable = (chimeIdx !== null || chordIdx !== null || isFreeze);

      // If not a playable synthesizer key or hotkey, allow native input/select behavior (arrow navigation, tab, enter)
      if (!isPlayable) {
        if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
        if (typeof document !== 'undefined' && document.activeElement &&
            (document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'INPUT')) {
          return;
        }
        return;
      }

      // 2. Playable note key, chord trigger, or hotkey was pressed!
      // If the active element or target is a <select>, button, or non-text-input,
      // release focus immediately and prevent default type-ahead navigation / scrolling / clicking.
      const activeEl = (typeof document !== 'undefined') ? document.activeElement : null;
      if (activeEl && typeof activeEl.blur === 'function' && activeEl !== document.body) {
        if (!isTextInputElement(activeEl)) {
          activeEl.blur();
        }
      }
      if (e.target && typeof e.target.blur === 'function') {
        if (typeof document === 'undefined' || (e.target !== document.body && !isTextInputElement(e.target))) {
          e.target.blur();
        }
      }
      if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
        document.body.focus();
      }

      if (typeof e.preventDefault === 'function') {
        e.preventDefault();
      }

      // Prevent key repeat machine-gun bursts
      if (e.repeat) {
        return;
      }

      // Playable chime keys with continuous hold sustain (A, S, D, F, G, H...)
      if (chimeIdx !== null) {
        const keys = (this.diatonicKeys && this.diatonicKeys.length > 0) ? this.diatonicKeys : Array.from(this.keyElements.values());
        const keyEl = keys[chimeIdx] || (keys.length > 0 ? keys[chimeIdx % keys.length] : null);
        if (keyEl) {
          const freq = parseFloat(keyEl.getAttribute('data-freq'));
          const midi = parseInt(keyEl.getAttribute('data-midi'), 10);
          keyEl._isHeld = true;
          keyEl.classList.add('is-active');
          keyEl.classList.add('is-pressed');
          const voiceOrPromise = this.playNote(freq, midi, 0.65, 20.0, true);
          const keyIdentifier = e.code || e.key;
          const existing = this.activeHeldKeys.get(keyIdentifier);
          if (existing && existing.voiceOrPromise) {
            if (typeof existing.voiceOrPromise.release === 'function') existing.voiceOrPromise.release();
            else if (existing.voiceOrPromise && typeof existing.voiceOrPromise.then === 'function') existing.voiceOrPromise.then(v => v?.release?.());
          }
          this.activeHeldKeys.set(keyIdentifier, { keyEl, voiceOrPromise, code: e.code, key: e.key });
        }
        return;
      }

      // Chord clusters with continuous hold sustain (1-9, 0, -, =)
      if (chordIdx !== null) {
        const chordBtns = this.chordsContainer ? this.chordsContainer.querySelectorAll('.braun-chord-macro-btn') : [];
        const btn = chordBtns[chordIdx] || (chordBtns.length > 0 ? chordBtns[chordIdx % chordBtns.length] : null);
        if (btn) {
          const voicingId = btn.getAttribute('data-chord');
          btn._isHeld = true;
          btn.classList.add('is-active');
          const session = this.startChord(voicingId, true);
          const chordIdentifier = e.code || e.key;
          const existingChord = this.activeHeldChords.get(chordIdentifier);
          if (existingChord && existingChord.session) {
            this.stopChordSession(existingChord.session);
          }
          this.activeHeldChords.set(chordIdentifier, { btn, session, code: e.code, key: e.key });
        }
        return;
      }

      // Spacebar toggles freeze
      if (isFreeze) {
        const freezeToggle = (typeof document !== 'undefined') ? document.getElementById('toggle-freeze') : null;
        if (freezeToggle && typeof freezeToggle.click === 'function') freezeToggle.click();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (isTextInputElement(e.target) || (typeof document !== 'undefined' && isTextInputElement(document.activeElement))) {
        return;
      }

      const activeUpEl = (typeof document !== 'undefined') ? document.activeElement : null;
      if (activeUpEl && typeof activeUpEl.blur === 'function' && activeUpEl !== document.body) {
        if (!isTextInputElement(activeUpEl)) {
          activeUpEl.blur();
        }
      }
      if (e.target && typeof e.target.blur === 'function') {
        if (typeof document === 'undefined' || (e.target !== document.body && !isTextInputElement(e.target))) {
          e.target.blur();
        }
      }
      if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
        document.body.focus();
      }

      const code = e.code;
      const key = e.key;

      // Find held chime key
      let heldKeyEntry = null;
      let heldKeyId = null;
      for (const [id, entry] of this.activeHeldKeys.entries()) {
        const matchCode = (code && (id === code || (entry && entry.code === code)));
        const matchKey = (key && (id === key || (entry && (entry.key === key || (entry.key && entry.key.toLowerCase() === key.toLowerCase())))));
        if (matchCode || matchKey) {
          heldKeyEntry = entry;
          heldKeyId = id;
          break;
        }
      }

      if (heldKeyEntry) {
        const { keyEl, voiceOrPromise } = heldKeyEntry;
        if (keyEl) {
          keyEl._isHeld = false;
          keyEl.classList.remove('is-active');
          keyEl.classList.remove('is-pressed');
        }
        if (voiceOrPromise) {
          if (typeof voiceOrPromise.release === 'function') {
            voiceOrPromise.release();
          } else if (typeof voiceOrPromise.then === 'function') {
            voiceOrPromise.then(v => {
              if (v && typeof v.release === 'function') v.release();
            });
          }
        }
        this.activeHeldKeys.delete(heldKeyId);
      }

      // Find held chord
      let heldChordEntry = null;
      let heldChordId = null;
      for (const [id, entry] of this.activeHeldChords.entries()) {
        const matchCode = (code && (id === code || (entry && entry.code === code)));
        const matchKey = (key && (id === key || (entry && (entry.key === key || (entry.key && entry.key.toLowerCase() === key.toLowerCase())))));
        if (matchCode || matchKey) {
          heldChordEntry = entry;
          heldChordId = id;
          break;
        }
      }

      if (heldChordEntry) {
        const { btn, session } = heldChordEntry;
        if (btn) {
          btn._isHeld = false;
          btn.classList.remove('is-active');
        }
        if (session) {
          this.stopChordSession(session);
        }
        this.activeHeldChords.delete(heldChordId);
      }
    });

    window.addEventListener('blur', () => {
      this.activeHeldKeys.forEach(({ keyEl, voiceOrPromise }) => {
        if (keyEl) {
          keyEl._isHeld = false;
          keyEl.classList.remove('is-active');
          keyEl.classList.remove('is-pressed');
        }
        if (voiceOrPromise) {
          if (typeof voiceOrPromise.release === 'function') voiceOrPromise.release();
          else if (typeof voiceOrPromise.then === 'function') voiceOrPromise.then(v => v?.release?.());
        }
      });
      this.activeHeldKeys.clear();

      this.activeHeldChords.forEach(({ btn, session }) => {
        if (btn) {
          btn._isHeld = false;
          btn.classList.remove('is-active');
        }
        if (session) this.stopChordSession(session);
      });
      this.activeHeldChords.clear();

      this.keyElements.forEach(keyEl => {
        keyEl._isHeld = false;
        keyEl.classList.remove('is-pressed');
        keyEl.classList.remove('is-active');
      });
      if (this.semitoneKeys) {
        this.semitoneKeys.forEach(keyEl => {
          keyEl._isHeld = false;
          keyEl.classList.remove('is-pressed');
          keyEl.classList.remove('is-active');
        });
      }

      if (this.chordsContainer && typeof this.chordsContainer.querySelectorAll === 'function') {
        const chordBtns = this.chordsContainer.querySelectorAll('.braun-chord-macro-btn');
        chordBtns.forEach(btn => {
          btn._isHeld = false;
          btn.classList.remove('is-active');
        });
      }

      this.activePointerVoices.forEach(voiceOrPromise => {
        if (voiceOrPromise) {
          if (typeof voiceOrPromise.release === 'function') voiceOrPromise.release();
          else if (typeof voiceOrPromise.then === 'function') voiceOrPromise.then(v => v?.release?.());
        }
      });
      this.activePointerVoices.clear();

      this.activePointerChordSessions.forEach(session => {
        if (session) this.stopChordSession(session);
      });
      this.activePointerChordSessions.clear();

      this._isPointerGlissandoActive = false;
      this._currentGlissandoKey = null;
      this._currentGlissandoVoice = null;
      this._releaseCurrentGlissando = null;
    });

    window.addEventListener('pointerup', () => {
      if (typeof this._releaseCurrentGlissando === 'function') {
        this._releaseCurrentGlissando();
      }

      const isKeyHeldByKeyboard = (el) => {
        if (!this.activeHeldKeys || this.activeHeldKeys.size === 0) return false;
        for (const entry of this.activeHeldKeys.values()) {
          if (entry && entry.keyEl === el) return true;
        }
        return false;
      };

      const isChordHeldByKeyboard = (btnEl) => {
        if (!this.activeHeldChords || this.activeHeldChords.size === 0) return false;
        for (const entry of this.activeHeldChords.values()) {
          if (entry && entry.btn === btnEl) return true;
        }
        return false;
      };

      this.keyElements.forEach(keyEl => {
        if (!isKeyHeldByKeyboard(keyEl)) {
          keyEl._isHeld = false;
          keyEl.classList.remove('is-pressed');
          keyEl.classList.remove('is-active');
        }
      });
      if (this.semitoneKeys) {
        this.semitoneKeys.forEach(keyEl => {
          if (!isKeyHeldByKeyboard(keyEl)) {
            keyEl._isHeld = false;
            keyEl.classList.remove('is-pressed');
            keyEl.classList.remove('is-active');
          }
        });
      }

      if (this.chordsContainer && typeof this.chordsContainer.querySelectorAll === 'function') {
        const chordBtns = this.chordsContainer.querySelectorAll('.braun-chord-macro-btn');
        chordBtns.forEach(btn => {
          if (!isChordHeldByKeyboard(btn)) {
            btn._isHeld = false;
            btn.classList.remove('is-active');
          }
        });
      }

      this.activePointerVoices.forEach(voiceOrPromise => {
        if (voiceOrPromise) {
          if (typeof voiceOrPromise.release === 'function') voiceOrPromise.release();
          else if (typeof voiceOrPromise.then === 'function') voiceOrPromise.then(v => v?.release?.());
        }
      });
      this.activePointerVoices.clear();

      this.activePointerChordSessions.forEach(session => {
        if (session) this.stopChordSession(session);
      });
      this.activePointerChordSessions.clear();

      this._isPointerGlissandoActive = false;
      this._currentGlissandoKey = null;
      this._currentGlissandoVoice = null;
      this._releaseCurrentGlissando = null;
    });
  }
}
