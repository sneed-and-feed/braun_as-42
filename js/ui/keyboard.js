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
    this.activePointerVoices = new Set();
    this.activePointerChordSessions = new Set();
    this._isPointerGlissandoActive = false;
    this._currentGlissandoKey = null;
    this._currentGlissandoVoice = null;
    this._releaseCurrentGlissando = null;

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

      let activeVoice = null;
      let handledByPointer = false;
      let clearPointerTimer = null;

      keyEl.setAttribute('draggable', 'false');
      keyEl.addEventListener('dragstart', (e) => e.preventDefault());

      // Pointer event for velocity-sensitive strike
      const triggerStrike = (clientY, clientRect, isHold = false) => {
        let velocity = 0.60;
        if (clientY !== undefined && clientY > 0 && clientRect && clientRect.height > 0) {
          const relY = Math.max(0, Math.min(1, (clientY - clientRect.top) / clientRect.height));
          // Lower hit gives firmer touch (0.45 .. 0.85)
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
        this._isPointerGlissandoActive = true;
        activateKey(e.clientY, keyEl.getBoundingClientRect ? keyEl.getBoundingClientRect() : null);
      });

      keyEl.addEventListener('pointerenter', (e) => {
        // Expressive glissando: slide horizontally across keys while holding mouse button
        if ((e.buttons === 1 || this._isPointerGlissandoActive) && this._currentGlissandoKey !== keyEl) {
          activateKey(e.clientY, keyEl.getBoundingClientRect ? keyEl.getBoundingClientRect() : null);
        }
      });

      keyEl.addEventListener('pointerup', () => {
        this._isPointerGlissandoActive = false;
        handleKeyRelease();
      });

      keyEl.addEventListener('pointercancel', () => {
        this._isPointerGlissandoActive = false;
        handleKeyRelease();
      });

      keyEl.addEventListener('click', (e) => {
        // Single strike on pointerdown: releasing LMB must NOT re-trigger a second strike
        if (handledByPointer) {
          return;
        }
        triggerStrike(e.clientY, keyEl.getBoundingClientRect ? keyEl.getBoundingClientRect() : null, false);
      });

      this.stripContainer.appendChild(keyEl);
      this.keyElements.set(note.midi, keyEl);
    });

    // Support container-level drag tracking for smooth glissando on touch & mouse swipe
    if (this.stripContainer && typeof this.stripContainer.addEventListener === 'function') {
      this.stripContainer.addEventListener('pointermove', (e) => {
        if (e.buttons === 1 || this._isPointerGlissandoActive) {
          if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const targetKey = el ? (el.classList && el.classList.contains && el.classList.contains('braun-chime-key') ? el : (el.closest ? el.closest('.braun-chime-key') : null)) : null;
            if (targetKey && targetKey !== this._currentGlissandoKey && typeof targetKey._activateGlissando === 'function') {
              targetKey._activateGlissando(e.clientY);
            }
          }
        }
      });

      this.stripContainer.addEventListener('pointerleave', (e) => {
        if (this._isPointerGlissandoActive && e.buttons === 0) {
          this._isPointerGlissandoActive = false;
          if (typeof this._releaseCurrentGlissando === 'function') {
            this._releaseCurrentGlissando();
          }
        }
      });
    }
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
      });

      btn.addEventListener('pointercancel', (e) => {
        try {
          if (btn.releasePointerCapture && e.pointerId != null) {
            btn.releasePointerCapture(e.pointerId);
          }
        } catch (err) {}
        triggerChordRelease();
      });

      btn.addEventListener('pointerleave', (e) => {
        if (activeSession && e.buttons === 0) {
          triggerChordRelease();
        }
      });

      btn.addEventListener('click', () => {
        // Single strike on pointerdown: releasing LMB must NOT re-trigger a second strike
        if (handledByPointer) {
          return;
        }
        this.playChord(voicing.id);
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
    const keyEl = this.keyElements.get(Math.round(midi));
    if (keyEl) {
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
        const voice = piano.playNote(freq, vel, duration, isHold);
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

    freqs.forEach((freq, idx) => {
      // Humanized micro-strum delay (18ms to 38ms per note)
      const delayMs = idx * (22 + Math.random() * 14);
      const timerId = setTimeout(() => {
        if (session.isReleased && isHold) {
          return;
        }
        const vel = 0.55 + Math.random() * 0.22;
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
    const keyMap = {
      'KeyA': 0, 'KeyS': 1, 'KeyD': 2, 'KeyF': 3,
      'KeyG': 4, 'KeyH': 5, 'KeyJ': 6, 'KeyK': 7,
      'KeyL': 8, 'Semicolon': 9, 'Quote': 10,
      'KeyZ': 11, 'KeyX': 12, 'KeyC': 13, 'KeyV': 14
    };

    const chordKeyMap = {
      'Digit1': 0, 'Digit2': 1, 'Digit3': 2, 'Digit4': 3, 'Digit5': 4, 'Digit6': 5,
      'Digit7': 6, 'Digit8': 7, 'Digit9': 8, 'Digit0': 9,
      'Minus': 10, 'Equal': 11
    };

    const getKeyIndex = (e) => {
      if (keyMap[e.code] !== undefined) return keyMap[e.code];
      const charMap = {
        'a': 0, 's': 1, 'd': 2, 'f': 3, 'g': 4, 'h': 5, 'j': 6, 'k': 7,
        'l': 8, ';': 9, "'": 10, 'z': 11, 'x': 12, 'c': 13, 'v': 14
      };
      const lower = e.key ? e.key.toLowerCase() : '';
      return charMap[lower] !== undefined ? charMap[lower] : null;
    };

    const getChordIndex = (e) => {
      if (chordKeyMap[e.code] !== undefined) return chordKeyMap[e.code];
      if (e.key >= '1' && e.key <= '9') return parseInt(e.key, 10) - 1;
      if (e.key === '0') return 9;
      if (e.key === '-' || e.key === '_') return 10;
      if (e.key === '=' || e.key === '+') return 11;
      return null;
    };

    this.activeHeldKeys = new Map();
    this.activeHeldChords = new Map();

    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      // Ignore if user is in an input field
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;

      const chimeIdx = getKeyIndex(e);
      const chordIdx = getChordIndex(e);

      // Prevent key repeat machine-gun bursts, but preventDefault to stop browser hotkeys/scrolling
      if (e.repeat) {
        if (chimeIdx !== null || chordIdx !== null || e.code === 'Space') {
          e.preventDefault();
        }
        return;
      }

      // Playable chime keys with continuous hold sustain
      if (chimeIdx !== null) {
        const keys = Array.from(this.keyElements.values());
        const keyEl = keys[chimeIdx];
        if (keyEl) {
          e.preventDefault();
          const freq = parseFloat(keyEl.getAttribute('data-freq'));
          const midi = parseInt(keyEl.getAttribute('data-midi'), 10);
          keyEl._isHeld = true;
          keyEl.classList.add('is-active');
          keyEl.classList.add('is-pressed');
          const voiceOrPromise = this.playNote(freq, midi, 0.65, 20.0, true);
          const keyIdentifier = e.code || e.key;
          this.activeHeldKeys.set(keyIdentifier, { keyEl, voiceOrPromise, code: e.code, key: e.key });
        }
        return;
      }

      // Chord clusters with continuous hold sustain
      if (chordIdx !== null) {
        const chordBtns = this.chordsContainer ? this.chordsContainer.querySelectorAll('.braun-chord-macro-btn') : [];
        const btn = chordBtns[chordIdx];
        if (btn) {
          e.preventDefault();
          const voicingId = btn.getAttribute('data-chord');
          btn._isHeld = true;
          btn.classList.add('is-active');
          const session = this.startChord(voicingId, true);
          const chordIdentifier = e.code || e.key;
          this.activeHeldChords.set(chordIdentifier, { btn, session, code: e.code, key: e.key });
        }
        return;
      }

      // Spacebar toggles freeze
      if (e.code === 'Space') {
        e.preventDefault();
        const freezeToggle = document.getElementById('toggle-freeze');
        if (freezeToggle) freezeToggle.click();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;

      const code = e.code;
      const key = e.key;

      // Find held chime key
      let heldKeyEntry = null;
      let heldKeyId = null;
      for (const [id, entry] of this.activeHeldKeys.entries()) {
        if (id === code || id === key || (entry && (entry.code === code || entry.key === key))) {
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
        if (id === code || id === key || (entry && (entry.code === code || entry.key === key))) {
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

      if (this.chordsContainer) {
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
      this.keyElements.forEach(keyEl => {
        keyEl._isHeld = false;
        keyEl.classList.remove('is-pressed');
        keyEl.classList.remove('is-active');
      });

      if (this.chordsContainer) {
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
  }
}
