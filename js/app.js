/**
 * @file app.js
 * @brief Main application orchestrator for the Braun Ambient Synthesizer.
 * Wires UI knobs, oscilloscopes, generative engines, and audio graph.
 */

import { AudioEngine } from './audio/engine.js';
import { BraunKnob } from './ui/knob.js';
import { BraunOscilloscope } from './ui/oscilloscope.js';
import { BraunPlaySurface, isPlayableSynthesizerKey } from './ui/keyboard.js';
import { BraunVectorPad } from './ui/vector-pad.js';
import { SCALES, NOTE_NAMES } from './generative/scales.js';

export function isWaveformMatch(attr, target) {
  if (!attr || !target) return false;
  const a = attr.trim().toLowerCase();
  const b = target.trim().toLowerCase();
  if (a === b) return true;
  if ((a === 'square' || a === 'sqr') && (b === 'square' || b === 'sqr')) return true;
  if ((a === 'saw' || a === 'sawtooth') && (b === 'saw' || b === 'sawtooth')) return true;
  if ((a === 'tri' || a === 'triangle') && (b === 'tri' || b === 'triangle')) return true;
  if ((a === 'sin' || a === 'sine') && (b === 'sin' || b === 'sine')) return true;
  return false;
}

export const PRESETS = {
  DEFAULT: {
    id: 'DEFAULT',
    name: 'CALIBRATED DEFAULT',
    scaleKey: 'BUDD_PENTATONIC',
    pianoWave: 'felt',
    drone1WaveA: 'saw',
    drone1WaveB: 'warm',
    drone1Snap: 'deep-tonic',
    drone2WaveA: 'square',
    drone2WaveB: 'triangle',
    drone2Snap: 'perfect-5th',
    vectorX: 0.50,
    vectorY: 0.50,
    chordSpeed: 'med',
    knobs: {
      masterVol: 80,
      masterDrive: 18,
      feltTone: 62,
      feltHammer: 45,
      feltSymp: 45,
      feltDecay: 1.1,
      feltLevel: 80,
      drone1Beat: 0.35,
      drone1Detune: 2.5,
      drone1Fold: 45,
      drone1Cutoff: 650,
      drone1Res: 3.5,
      drone1Lfo: 0.12,
      drone1Vol: 55,
      drone2Beat: 0.65,
      drone2Detune: -3.2,
      drone2Fold: 45,
      drone2Cutoff: 850,
      drone2Res: 3.5,
      drone2Lfo: 0.12,
      drone2Vol: 55,
      delayTime: 460,
      delayFeedback: 55,
      delayWow: 45,
      delayTone: 3600,
      delayWet: 40,
      reverbDecay: 8.5,
      reverbDamping: 60,
      reverbShimmer: 45,
      reverbWet: 45,
      poissonDensity: 12,
      poissonHumanize: 50
    }
  },
  HAROLD_BUDD: {
    id: 'HAROLD_BUDD',
    name: 'HAROLD BUDD · PAVILION',
    scaleKey: 'BUDD_PENTATONIC',
    pianoWave: 'felt',
    drone1WaveA: 'sine',
    drone1WaveB: 'warm',
    drone1Snap: 'deep-tonic',
    drone2WaveA: 'triangle',
    drone2WaveB: 'sine',
    drone2Snap: 'perfect-5th',
    vectorX: 0.25,
    vectorY: 0.60,
    chordSpeed: 'slow',
    knobs: {
      masterVol: 82,
      masterDrive: 14,
      feltTone: 35,
      feltHammer: 55,
      feltSymp: 65,
      feltDecay: 1.6,
      feltLevel: 85,
      drone1Beat: 0.20,
      drone1Detune: 1.8,
      drone1Fold: 25,
      drone1Cutoff: 480,
      drone1Res: 2.2,
      drone1Lfo: 0.08,
      drone1Vol: 48,
      drone2Beat: 0.40,
      drone2Detune: -2.0,
      drone2Fold: 20,
      drone2Cutoff: 600,
      drone2Res: 2.0,
      drone2Lfo: 0.08,
      drone2Vol: 45,
      delayTime: 520,
      delayFeedback: 60,
      delayWow: 50,
      delayTone: 2800,
      delayWet: 45,
      reverbDecay: 12.0,
      reverbDamping: 70,
      reverbShimmer: 35,
      reverbWet: 55,
      poissonDensity: 8,
      poissonHumanize: 65
    }
  },
  VANGELIS: {
    id: 'VANGELIS',
    name: 'VANGELIS · CS-80 BRASS',
    scaleKey: 'AVALON_SPIRITED',
    pianoWave: 'cs80',
    drone1WaveA: 'saw',
    drone1WaveB: 'saw',
    drone1Snap: 'deep-tonic',
    drone2WaveA: 'saw',
    drone2WaveB: 'square',
    drone2Snap: 'major-9th',
    vectorX: 0.81,
    vectorY: 0.70,
    chordSpeed: 'fast',
    knobs: {
      masterVol: 78,
      masterDrive: 28,
      feltTone: 80,
      feltHammer: 20,
      feltSymp: 30,
      feltDecay: 1.8,
      feltLevel: 88,
      drone1Beat: 0.85,
      drone1Detune: 4.5,
      drone1Fold: 32,
      drone1Cutoff: 600,
      drone1Res: 2.6,
      drone1Lfo: 0.25,
      drone1Vol: 42,
      drone2Beat: 1.20,
      drone2Detune: -5.0,
      drone2Fold: 36,
      drone2Cutoff: 750,
      drone2Res: 2.8,
      drone2Lfo: 0.30,
      drone2Vol: 38,
      delayTime: 380,
      delayFeedback: 52,
      delayWow: 40,
      delayTone: 4500,
      delayWet: 45,
      reverbDecay: 9.0,
      reverbDamping: 45,
      reverbShimmer: 65,
      reverbWet: 50,
      poissonDensity: 10,
      poissonHumanize: 40
    }
  },
  ENO_AIRPORTS: {
    id: 'ENO_AIRPORTS',
    name: 'ENO · MUSIC FOR AIRPORTS',
    scaleKey: 'BUDD_PENTATONIC',
    pianoWave: 'sine',
    drone1WaveA: 'sine',
    drone1WaveB: 'triangle',
    drone1Snap: 'sub-bass',
    drone2WaveA: 'sine',
    drone2WaveB: 'triangle',
    drone2Snap: 'beating-unison',
    vectorX: 0.68,
    vectorY: 0.75,
    chordSpeed: 'slow',
    knobs: {
      masterVol: 80,
      masterDrive: 12,
      feltTone: 70,
      feltHammer: 35,
      feltSymp: 55,
      feltDecay: 2.0,
      feltLevel: 75,
      drone1Beat: 0.35,
      drone1Detune: 1.5,
      drone1Fold: 15,
      drone1Cutoff: 550,
      drone1Res: 2.0,
      drone1Lfo: 0.05,
      drone1Vol: 45,
      drone2Beat: 0.35,
      drone2Detune: -1.5,
      drone2Fold: 15,
      drone2Cutoff: 550,
      drone2Res: 2.0,
      drone2Lfo: 0.05,
      drone2Vol: 45,
      delayTime: 680,
      delayFeedback: 68,
      delayWow: 60,
      delayTone: 5000,
      delayWet: 50,
      reverbDecay: 15.0,
      reverbDamping: 55,
      reverbShimmer: 55,
      reverbWet: 58,
      poissonDensity: 6,
      poissonHumanize: 75
    }
  }
};

export class AmbientApp {
  constructor() {
    this.engine = new AudioEngine();
    this.scope = null;
    this.playSurface = null;
    this.vectorPad = null;
    this.knobs = {};
    this.isPowerOn = false;
    this._initialized = false;
    this._knobsBuilt = false;
    this._isApplyingPreset = false;
    this._resetTimer = null;
    this._presetTimer = null;

    this.init();
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._initDom();
  }

  _setupSelectFocusRelease(selectEl) {
    if (!selectEl || selectEl._hasSelectFocusReleaseWired) return;
    selectEl._hasSelectFocusReleaseWired = true;

    const releaseFocus = () => {
      try {
        if (typeof selectEl.blur === 'function') {
          selectEl.blur();
        }
      } catch (err) {}
      try {
        if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
          document.body.focus();
        }
      } catch (err) {}
    };

    // 1. Immediately release focus upon user selection / change / input
    selectEl.addEventListener('change', releaseFocus);
    selectEl.addEventListener('input', releaseFocus);

    // 2. On mouseup / click after selecting an option
    let wasFocusedOnMouseDown = false;
    selectEl.addEventListener('mousedown', () => {
      wasFocusedOnMouseDown = (typeof document !== 'undefined' && document.activeElement === selectEl);
    });

    const handleRelease = (e) => {
      if (wasFocusedOnMouseDown || (e && e.target && e.target.tagName === 'OPTION')) {
        releaseFocus();
      }
    };

    selectEl.addEventListener('mouseup', (e) => {
      handleRelease(e);
      setTimeout(() => { wasFocusedOnMouseDown = false; }, 50);
    });

    selectEl.addEventListener('click', (e) => {
      handleRelease(e);
      setTimeout(() => { wasFocusedOnMouseDown = false; }, 50);
    });

    // 3. Keydown on the select itself:
    // If user presses any playable musical key, chord trigger, or freeze spacebar while select is focused:
    // Prevent default browser type-ahead navigation immediately and release focus to body!
    selectEl.addEventListener('keydown', (e) => {
      const activeEl = (typeof document !== 'undefined') ? document.activeElement : null;
      if (isPlayableSynthesizerKey(e)) {
        if (typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        releaseFocus();
        if (activeEl && typeof activeEl.blur === 'function' && activeEl !== document.body) {
          activeEl.blur();
        }
      }
    });

    // 4. Wire up child <option> elements if available
    if (typeof selectEl.querySelectorAll === 'function') {
      const options = selectEl.querySelectorAll('option');
      options.forEach(opt => {
        opt.addEventListener('click', releaseFocus);
        opt.addEventListener('mouseup', releaseFocus);
      });
    }
  }

  _setupButtonFocusRelease(btn) {
    if (!btn || btn._hasBtnFocusReleaseWired) return;
    btn._hasBtnFocusReleaseWired = true;

    const releaseFocus = () => {
      try {
        if (typeof btn.blur === 'function') btn.blur();
      } catch (err) {}
      try {
        if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
          document.body.focus();
        }
      } catch (err) {}
    };

    btn.addEventListener('click', releaseFocus);
    btn.addEventListener('mouseup', releaseFocus);

    btn.addEventListener('keydown', (e) => {
      const activeEl = (typeof document !== 'undefined') ? document.activeElement : null;
      if (isPlayableSynthesizerKey(e)) {
        if (typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        releaseFocus();
        if (activeEl && typeof activeEl.blur === 'function' && activeEl !== document.body) {
          activeEl.blur();
        }
      }
    });
  }

  _initDom() {
    // Theme Switcher (Apply current selected finish immediately on boot)
    const themeSelect = document.getElementById('select-theme');
    if (themeSelect && document.body) {
      document.body.setAttribute('data-theme', themeSelect.value);
      themeSelect.addEventListener('change', (e) => {
        document.body.setAttribute('data-theme', e.target.value);
        if (typeof themeSelect.blur === 'function') themeSelect.blur();
        if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
          document.body.focus();
        }
      });
      this._setupSelectFocusRelease(themeSelect);
    }

    // Populate Root note selector
    const rootSelect = document.getElementById('select-root');
    if (rootSelect) {
      rootSelect.innerHTML = '';
      NOTE_NAMES.forEach((note, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = note;
        opt.addEventListener('click', () => {
          if (typeof rootSelect.blur === 'function') rootSelect.blur();
          if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
            document.body.focus();
          }
        });
        opt.addEventListener('mouseup', () => {
          if (typeof rootSelect.blur === 'function') rootSelect.blur();
          if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
            document.body.focus();
          }
        });
        rootSelect.appendChild(opt);
      });
      rootSelect.value = this.engine.rootPitchClass;

      rootSelect.addEventListener('change', (e) => {
        const root = parseInt(e.target.value, 10);
        this.engine.setScale(this.engine.currentScaleKey, root);
        if (this.playSurface) this.playSurface.rebuildKeys();
        this.updateLoopNotes();
        if (typeof rootSelect.blur === 'function') rootSelect.blur();
        if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
          document.body.focus();
        }
      });
      this._setupSelectFocusRelease(rootSelect);
    }

    // Populate Scale selector
    const scaleSelect = document.getElementById('select-scale');
    if (scaleSelect) {
      scaleSelect.innerHTML = '';
      Object.values(SCALES).forEach(sc => {
        const opt = document.createElement('option');
        opt.value = sc.id;
        opt.textContent = sc.name;
        opt.addEventListener('click', () => {
          if (typeof scaleSelect.blur === 'function') scaleSelect.blur();
          if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
            document.body.focus();
          }
        });
        opt.addEventListener('mouseup', () => {
          if (typeof scaleSelect.blur === 'function') scaleSelect.blur();
          if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
            document.body.focus();
          }
        });
        scaleSelect.appendChild(opt);
      });
      scaleSelect.value = this.engine.currentScaleKey;

      scaleSelect.addEventListener('change', (e) => {
        const scaleKey = e.target.value;
        this.engine.setScale(scaleKey, this.engine.rootPitchClass);
        if (this.playSurface) this.playSurface.rebuildKeys();
        this.updateLoopNotes();
        if (typeof scaleSelect.blur === 'function') scaleSelect.blur();
        if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
          document.body.focus();
        }
      });
      this._setupSelectFocusRelease(scaleSelect);
    }

    // Master Power Button
    const powerBtn = document.getElementById('btn-power');
    if (powerBtn) {
      powerBtn.addEventListener('click', async () => {
        await this.togglePower();
        if (typeof powerBtn.blur === 'function') powerBtn.blur();
      });
    }

    // Harold Budd Playable Timbre Waveform Toggles (Saw / Square / Sine / Felt)
    const pianoWaveBtns = document.querySelectorAll('.piano-wave-btn');
    pianoWaveBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        pianoWaveBtns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const wave = btn.getAttribute('data-wave');
        this.engine.setFeltWaveform(wave);
        if (typeof btn.blur === 'function') btn.blur();
      });
    });

    // Master Record Button (Lossless WAV export)
    const recordBtn = document.getElementById('btn-record');
    if (recordBtn) {
      recordBtn.addEventListener('click', async () => {
        if (!this.isPowerOn) {
          await this.startAudio();
        }

        if (!this.engine.isRecording) {
          this.engine.startRecording();
          recordBtn.classList.add('is-recording');
          const textEl = recordBtn.querySelector('.braun-record-text');
          if (textEl) textEl.textContent = 'RECORDING...';
        } else {
          const wavBlob = this.engine.stopRecording();
          recordBtn.classList.remove('is-recording');
          const textEl = recordBtn.querySelector('.braun-record-text');
          if (textEl) textEl.textContent = 'RECORD WAV';

          if (wavBlob && typeof document !== 'undefined') {
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `braun-ambient-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }, 1000);
          }
        }
      });
    }

    // Tuning Pitch (440Hz / 432Hz)
    const tuningSelect = document.getElementById('select-tuning');
    if (tuningSelect) {
      tuningSelect.addEventListener('change', (e) => {
        const a4 = parseFloat(e.target.value);
        this.engine.setTuningReference(a4);
        if (this.playSurface) this.playSurface.rebuildKeys();
        this.updateLoopNotes();
        if (typeof tuningSelect.blur === 'function') tuningSelect.blur();
        if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
          document.body.focus();
        }
      });
      this._setupSelectFocusRelease(tuningSelect);
    }

    // Oscilloscope Mode Tabs
    const modeTabs = document.querySelectorAll('.braun-mode-tab');
    modeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        modeTabs.forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        if (this.scope) {
          this.scope.setMode(tab.getAttribute('data-mode'));
        }
      });
    });

    // Infinite Freeze Toggle
    const freezeBtn = document.getElementById('toggle-freeze');
    if (freezeBtn) {
      freezeBtn.addEventListener('click', () => {
        const isFrozen = this.engine.toggleReverbFreeze();
        freezeBtn.classList.toggle('is-active', isFrozen);
        const textEl = freezeBtn.querySelector('.braun-status-text');
        if (textEl) textEl.textContent = isFrozen ? 'FREEZE ON' : 'FREEZE OFF';
      });
    }

    // Generative: Poisson Auto-Evolve Toggle
    const autoEvolveBtn = document.getElementById('toggle-auto-evolve');
    if (autoEvolveBtn) {
      autoEvolveBtn.addEventListener('click', async () => {
        if (!this.isPowerOn) await this.startAudio();

        if (!this.engine.poisson.isRunning) {
          this.engine.poisson.start((ev) => {
            if (this.engine.feltPiano) {
              this.engine.feltPiano.playNote(ev.freq, ev.velocity, ev.duration);
            }
            if (this.playSurface) this.playSurface.flashKey(ev.midi);
          });
          autoEvolveBtn.classList.add('is-active');
          const textEl = autoEvolveBtn.querySelector('.braun-status-text');
          if (textEl) textEl.textContent = 'AUTO EVOLVE ON';
        } else {
          this.engine.poisson.stop();
          autoEvolveBtn.classList.remove('is-active');
          const textEl = autoEvolveBtn.querySelector('.braun-status-text');
          if (textEl) textEl.textContent = 'AUTO EVOLVE OFF';
        }
      });
    }

    // Generative: Eno Phase Loops Toggle
    const loopsBtn = document.getElementById('toggle-phase-loops');
    if (loopsBtn) {
      loopsBtn.addEventListener('click', async () => {
        if (!this.isPowerOn) await this.startAudio();

        if (!this.engine.phaseLoops.isRunning) {
          this.engine.phaseLoops.start(
            (loop, ev) => {
              if (this.engine.feltPiano) {
                this.engine.feltPiano.playNote(ev.freq, ev.velocity, ev.duration);
              }
              if (this.playSurface) this.playSurface.flashKey(ev.midi);
            },
            (loops) => {
              // Update 60fps loop progress bars
              loops.forEach(l => {
                const bar = document.getElementById(`loop-progress-${l.id}`);
                if (bar) {
                  bar.style.width = `${(l.progress * 100).toFixed(1)}%`;
                }
              });
            }
          );
          loopsBtn.classList.add('is-active');
          const textEl = loopsBtn.querySelector('.braun-status-text');
          if (textEl) textEl.textContent = 'AIRPORTS LOOPS ON';
        } else {
          this.engine.phaseLoops.stop();
          loopsBtn.classList.remove('is-active');
          const textEl = loopsBtn.querySelector('.braun-status-text');
          if (textEl) textEl.textContent = 'AIRPORTS LOOPS OFF';
          this.engine.phaseLoops.loops.forEach(l => {
            const bar = document.getElementById(`loop-progress-${l.id}`);
            if (bar) bar.style.width = '0%';
          });
        }
      });
    }

    // Render Eno Loop Progress Bars & Note Names
    this._renderLoopRows();

    // Render Oscilloscope Phosphor Vector Display
    const canvas = document.getElementById('scope-canvas');
    if (canvas && !this.scope) {
      this.scope = new BraunOscilloscope(canvas, this.engine.analyser);
      this.scope.start();
    }

    // Render Playable Chime Strip & Macro Chord Buttons
    const stripContainer = document.getElementById('chime-strip');
    const chordsContainer = document.getElementById('chord-macros');
    if (stripContainer && chordsContainer && !this.playSurface) {
      this.playSurface = new BraunPlaySurface(stripContainer, chordsContainer, this.engine);
      this.playSurface.onPlay = async () => {
        if (!this.isPowerOn || (this.engine.ctx && this.engine.ctx.state === 'suspended')) {
          await this.startAudio();
        }
      };
    }

    // Render Braun AS 42 Precision Vector Touchpad
    const vectorContainer = document.getElementById('vector-pad');
    if (vectorContainer && !this.vectorPad) {
      this.vectorPad = new BraunVectorPad(vectorContainer, {
        engine: this.engine,
        onEngage: async () => {
          if (!this.isPowerOn || (this.engine.ctx && this.engine.ctx.state === 'suspended')) {
            await this.startAudio();
          }
        },
        onChange: (data) => {
          this._syncKnobsFromVectorPad(data);
        }
      });
    }

    // Curated Sound Presets Selector
    const presetSelect = document.getElementById('select-preset');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        this.applyPreset(e.target.value, { animate: true, duration: 350 });
        if (typeof presetSelect.blur === 'function') presetSelect.blur();
        if (typeof document !== 'undefined' && document.body && typeof document.body.focus === 'function') {
          document.body.focus();
        }
      });
      this._setupSelectFocusRelease(presetSelect);
    }

    // Master Preset / Reset Switch (Dieter Rams "Reset All")
    const resetBtn = document.getElementById('btn-reset-all');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetAllKnobs({ animate: true, duration: 350 });
        if (typeof resetBtn.blur === 'function') resetBtn.blur();
      });
    }

    // Export & Load Patch
    const btnExportPatch = document.getElementById('btn-export-patch');
    if (btnExportPatch) {
      btnExportPatch.addEventListener('click', () => {
        this.exportPatch();
        if (typeof btnExportPatch.blur === 'function') btnExportPatch.blur();
      });
    }

    const btnLoadPatch = document.getElementById('btn-load-patch');
    const inputLoadPatch = document.getElementById('input-load-patch');
    if (btnLoadPatch && inputLoadPatch) {
      btnLoadPatch.addEventListener('click', () => {
        inputLoadPatch.value = '';
        inputLoadPatch.click();
        if (typeof btnLoadPatch.blur === 'function') btnLoadPatch.blur();
      });
      inputLoadPatch.addEventListener('change', (e) => {
        this._handleLoadPatchFile(e);
      });
    }

    // Render All Rotary Knobs immediately
    this._buildKnobs();

    // Calibrate all parameters, knobs, and vector pad to pristine default preset on boot
    this.applyPreset('DEFAULT', { animate: false });

    // Ensure all dropdown selects and buttons release focus on selection and prevent key interception
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const allSelects = document.querySelectorAll('select, .braun-select');
      allSelects.forEach(sel => this._setupSelectFocusRelease(sel));

      const allButtons = document.querySelectorAll('button');
      allButtons.forEach(btn => this._setupButtonFocusRelease(btn));
    }

    // Attach iOS Safari audio autoplay unlock and interruption recovery listeners
    this._attachAudioUnlockListeners();
  }

  /**
   * Synchronously unlock Web Audio for iOS / iPad Safari
   * @returns {AudioContext|null}
   */
  unlockAudio() {
    if (this.engine && typeof this.engine.unlockAudio === 'function') {
      return this.engine.unlockAudio();
    }
    return null;
  }

  _attachAudioUnlockListeners() {
    if (this._hasAudioUnlockListeners) return;
    this._hasAudioUnlockListeners = true;

    const unlockEvents = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click'];
    const unlockHandler = () => {
      try {
        if (this.engine && typeof this.engine.unlockAudio === 'function') {
          this.engine.unlockAudio();
        }
      } catch (e) {}
      this._isAudioUnlocked = true;
      unlockEvents.forEach(evt => {
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener(evt, unlockHandler, true);
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener(evt, unlockHandler, true);
        }
      });
    };

    unlockEvents.forEach(evt => {
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener(evt, unlockHandler, { capture: true, passive: true });
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener(evt, unlockHandler, { capture: true, passive: true });
      }
    });

    // Interruption recovery for iPadOS Safari (screen lock, tab switch, app backgrounding)
    const handleInterruptionRecovery = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (this.engine && this.engine.ctx && (this.engine.ctx.state === 'suspended' || this.engine.ctx.state === 'interrupted')) {
        try {
          if (typeof this.engine.ctx.resume === 'function') {
            await this.engine.ctx.resume();
          }
        } catch (e) {
          console.warn('Interruption recovery resume error:', e);
        }
      }
    };

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleInterruptionRecovery);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('visibilitychange', handleInterruptionRecovery);
      window.addEventListener('pageshow', handleInterruptionRecovery);
    }
  }

  /**
   * Apply a curated preset across all knobs, toggles, vector pad, and audio engine
   * @param {string} presetKey - One of DEFAULT, HAROLD_BUDD, VANGELIS, ENO_AIRPORTS
   * @param {Object} [options]
   * @param {boolean} [options.animate=true]
   * @param {number} [options.duration=300]
   */
  applyPreset(presetKey, { animate = true, duration = 300 } = {}) {
    const preset = PRESETS[presetKey] || PRESETS.DEFAULT;
    this._isApplyingPreset = true;
    if (this._presetTimer) {
      clearTimeout(this._presetTimer);
      this._presetTimer = null;
    }

    // 1. Update preset selector dropdown if out of sync
    const presetSelect = document.getElementById('select-preset');
    if (presetSelect && presetSelect.value !== preset.id) {
      presetSelect.value = preset.id;
    }

    // 2. Animate all rotary knobs to preset values (or snap immediately if not animating or in test environment)
    if (preset.knobs) {
      const shouldAnimate = animate && duration > 0 && typeof requestAnimationFrame === 'function';
      Object.entries(preset.knobs).forEach(([k, targetVal]) => {
        const knob = this.knobs[k];
        if (knob) {
          if (shouldAnimate && typeof knob.animateTo === 'function') {
            knob.animateTo(targetVal, duration, null, false, false);
          } else {
            knob.setValue(targetVal, false);
          }
        }
      });

      // Update engine immediately
      if (preset.knobs.masterVol !== undefined) this.engine.setMasterVolume(preset.knobs.masterVol / 100);
      if (preset.knobs.masterDrive !== undefined) this.engine.setTapeDrive(preset.knobs.masterDrive / 100);
      if (preset.knobs.feltTone !== undefined) this.engine.setFeltTone(preset.knobs.feltTone / 100);
      if (preset.knobs.feltHammer !== undefined) this.engine.setFeltHammer(preset.knobs.feltHammer / 100);
      if (preset.knobs.feltSymp !== undefined) this.engine.setFeltSympathetic(preset.knobs.feltSymp / 100);
      if (preset.knobs.feltDecay !== undefined) this.engine.setFeltDecay(preset.knobs.feltDecay);
      if (preset.knobs.feltLevel !== undefined) this.engine.setFeltVolume(preset.knobs.feltLevel / 100);
      if (preset.knobs.drone1Beat !== undefined) this.engine.setDroneBeating(1, preset.knobs.drone1Beat);
      if (preset.knobs.drone1Detune !== undefined) this.engine.setDroneDetune(1, preset.knobs.drone1Detune);
      if (preset.knobs.drone1Fold !== undefined) this.engine.setDroneWavefold(1, preset.knobs.drone1Fold);
      if (preset.knobs.drone1Cutoff !== undefined) this.engine.setDroneCutoff(1, preset.knobs.drone1Cutoff);
      if (preset.knobs.drone1Res !== undefined) this.engine.setDroneResonance(1, preset.knobs.drone1Res);
      if (preset.knobs.drone1Lfo !== undefined) this.engine.setDroneLfo(1, preset.knobs.drone1Lfo);
      if (preset.knobs.drone1Vol !== undefined) this.engine.setDroneVolume(1, preset.knobs.drone1Vol / 100);
      if (preset.knobs.drone2Beat !== undefined) this.engine.setDroneBeating(2, preset.knobs.drone2Beat);
      if (preset.knobs.drone2Detune !== undefined) this.engine.setDroneDetune(2, preset.knobs.drone2Detune);
      if (preset.knobs.drone2Fold !== undefined) this.engine.setDroneWavefold(2, preset.knobs.drone2Fold);
      if (preset.knobs.drone2Cutoff !== undefined) this.engine.setDroneCutoff(2, preset.knobs.drone2Cutoff);
      if (preset.knobs.drone2Res !== undefined) this.engine.setDroneResonance(2, preset.knobs.drone2Res);
      if (preset.knobs.drone2Lfo !== undefined) this.engine.setDroneLfo(2, preset.knobs.drone2Lfo);
      if (preset.knobs.drone2Vol !== undefined) this.engine.setDroneVolume(2, preset.knobs.drone2Vol / 100);
      if (preset.knobs.delayTime !== undefined) this.engine.setDelayTime(preset.knobs.delayTime / 1000);
      if (preset.knobs.delayFeedback !== undefined) this.engine.setDelayFeedback(preset.knobs.delayFeedback / 100);
      if (preset.knobs.delayWow !== undefined) this.engine.setDelayWow(preset.knobs.delayWow / 100);
      if (preset.knobs.delayTone !== undefined) this.engine.setDelayTone(preset.knobs.delayTone);
      if (preset.knobs.delayWet !== undefined) this.engine.setDelayWet(preset.knobs.delayWet / 100);
      if (preset.knobs.reverbDecay !== undefined) this.engine.setReverbDecay(preset.knobs.reverbDecay);
      if (preset.knobs.reverbDamping !== undefined) this.engine.setReverbDamping(preset.knobs.reverbDamping / 100);
      if (preset.knobs.reverbShimmer !== undefined) this.engine.setReverbShimmer(preset.knobs.reverbShimmer / 100);
      if (preset.knobs.reverbWet !== undefined) this.engine.setReverbWet(preset.knobs.reverbWet / 100);
      if (preset.knobs.poissonDensity !== undefined && this.engine.poisson) this.engine.poisson.setParameters({ eventsPerMinute: preset.knobs.poissonDensity });
      if (preset.knobs.poissonHumanize !== undefined) this.engine.setPoissonHumanize(preset.knobs.poissonHumanize / 100);
    }

    // 3. Timbre waveform button and engine setting
    if (preset.pianoWave) {
      const pianoWaveBtns = document.querySelectorAll('.piano-wave-btn');
      pianoWaveBtns.forEach(btn => {
        const match = btn.getAttribute('data-wave') === preset.pianoWave;
        btn.classList.toggle('is-active', match);
      });
      this.engine.setFeltWaveform(preset.pianoWave);
    }

    // 4. Drone waveform toggles & snap tuning
    [1, 2].forEach(id => {
      const pfx = `drone${id}`;
      const waveA = preset[`${pfx}WaveA`];
      const waveB = preset[`${pfx}WaveB`];
      if (waveA) {
        const btnsA = document.querySelectorAll(`.${pfx}-wave-a`);
        btnsA.forEach(btn => {
          btn.classList.toggle('is-active', isWaveformMatch(btn.getAttribute('data-wave'), waveA));
        });
        this.engine.setDroneWaveA(id, waveA);
      }
      if (waveB) {
        const btnsB = document.querySelectorAll(`.${pfx}-wave-b`);
        btnsB.forEach(btn => {
          btn.classList.toggle('is-active', isWaveformMatch(btn.getAttribute('data-wave'), waveB));
        });
        this.engine.setDroneWaveB(id, waveB);
      }

      const snap = preset[`${pfx}Snap`];
      if (snap) {
        const snapBtns = document.querySelectorAll(`.${pfx}-snap-btn`);
        snapBtns.forEach(btn => btn.classList.toggle('is-active', btn.getAttribute('data-snap') === snap));
        this.engine.setDroneSnap(id, snap);
      }
    });

    // 5. Vector Pad Coordinates (sync visual coordinates without stomping calibrated preset knobs)
    if (this.vectorPad && preset.vectorX !== undefined && preset.vectorY !== undefined) {
      const shouldAnimate = animate && duration > 0 && typeof requestAnimationFrame === 'function';
      if (shouldAnimate && typeof this.vectorPad.animateTo === 'function') {
        this.vectorPad.animateTo(preset.vectorX, preset.vectorY, duration, false);
      } else {
        this.vectorPad.setCoordinates(preset.vectorX, preset.vectorY, false);
      }
    }

    // 6. Scale Selector (optional)
    if (preset.scaleKey && preset.scaleKey !== this.engine.currentScaleKey) {
      const scaleSelect = document.getElementById('select-scale');
      if (scaleSelect) scaleSelect.value = preset.scaleKey;
      this.engine.setScale(preset.scaleKey, this.engine.rootPitchClass);
      if (this.playSurface) this.playSurface.rebuildKeys();
      this.updateLoopNotes();
    }

    // 7. Chord Trigger / Strum Speed
    if (preset.chordSpeed && this.playSurface && typeof this.playSurface.setChordSpeed === 'function') {
      this.playSurface.setChordSpeed(preset.chordSpeed);
    }

    // Release applying preset flag once animation finishes
    const releaseDelay = (animate && duration > 0) ? (duration + 50) : 0;
    if (releaseDelay > 0) {
      this._presetTimer = setTimeout(() => {
        this._isApplyingPreset = false;
        this._presetTimer = null;
      }, releaseDelay);
    } else {
      this._isApplyingPreset = false;
    }
  }

  /**
   * Reset all rotary knobs, wave toggles, and vector pad to pristine calibrated defaults
   * @param {Object} [options]
   * @param {boolean} [options.animate=true]
   * @param {number} [options.duration=350]
   */
  resetAllKnobs({ animate = true, duration = 350 } = {}) {
    const resetBtn = document.getElementById('btn-reset-all');
    if (resetBtn) {
      if (this._resetTimer) {
        clearTimeout(this._resetTimer);
        this._resetTimer = null;
      }
      resetBtn.classList.remove('is-active');
      if (typeof resetBtn.offsetWidth === 'number') {
        void resetBtn.offsetWidth; // Force CSS reflow to re-trigger smooth rotation cleanly
      }
      resetBtn.classList.add('is-active');
      this._resetTimer = setTimeout(() => {
        resetBtn.classList.remove('is-active');
        this._resetTimer = null;
      }, duration);
    }

    // Turn off reverb freeze if active
    if (this.engine.reverbParams.freeze) {
      const freezeBtn = document.getElementById('toggle-freeze');
      if (freezeBtn) {
        freezeBtn.click();
      } else {
        this.engine.toggleReverbFreeze();
      }
    }

    // Apply DEFAULT calibrated preset
    this.applyPreset('DEFAULT', { animate, duration });

    // Center Vector Pad to origin without stomping calibrated preset knobs
    if (this.vectorPad) {
      this.vectorPad.resetToCenter(false, animate, duration);
    }
  }

  /**
   * Export all synthesizer settings (knobs, waveforms, scale, drones, vector pad) to a JSON patch object and download
   * @returns {Object} Patch data object
   */
  exportPatch() {
    const knobValues = {};
    if (this.knobs) {
      Object.keys(this.knobs).forEach(key => {
        if (this.knobs[key] && this.knobs[key].value !== undefined) {
          knobValues[key] = this.knobs[key].value;
        }
      });
    }

    const activePianoWaveBtn = (typeof document !== 'undefined' && typeof document.querySelector === 'function')
      ? document.querySelector('.piano-wave-btn.is-active')
      : null;
    const pianoWave = activePianoWaveBtn ? activePianoWaveBtn.getAttribute('data-wave') : (this.engine?.feltParams?.waveform || 'felt');

    const timestampId = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const patchId = this.engine?.currentScaleKey ? `${this.engine.currentScaleKey}-${timestampId}` : timestampId;

    const patch = {
      format: 'BRAUN_AS42_PATCH',
      version: 1,
      name: `AS-42 Preset ${patchId}`,
      timestamp: new Date().toISOString(),
      theme: (typeof document !== 'undefined' && document.body) ? (document.body.getAttribute('data-theme') || 'light') : 'light',
      rootPitchClass: this.engine ? this.engine.rootPitchClass : 0,
      currentScaleKey: this.engine ? this.engine.currentScaleKey : 'BUDD_PENTATONIC',
      a4: this.engine ? this.engine.a4 : 440,
      pianoWave,
      chordSpeed: this.playSurface ? this.playSurface.chordSpeed : 'med',
      knobs: knobValues,
      drone1: {
        active: this.engine?.droneParams?.[1]?.active ?? false,
        waveA: this.engine?.droneParams?.[1]?.waveA ?? 'saw',
        waveB: this.engine?.droneParams?.[1]?.waveB ?? 'warm',
        snap: this.engine?.droneSnap?.[1] || 'deep-tonic'
      },
      drone2: {
        active: this.engine?.droneParams?.[2]?.active ?? false,
        waveA: this.engine?.droneParams?.[2]?.waveA ?? 'square',
        waveB: this.engine?.droneParams?.[2]?.waveB ?? 'triangle',
        snap: this.engine?.droneSnap?.[2] || 'perfect-5th'
      },
      vectorPad: {
        x: this.vectorPad ? this.vectorPad.x : 0.5,
        y: this.vectorPad ? this.vectorPad.y : 0.5
      }
    };

    if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
      const jsonStr = JSON.stringify(patch, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      if (a.style) a.style.display = 'none';
      a.href = url;
      a.download = `AS-42 Preset ${patchId}.json`;
      if (document.body && typeof document.body.appendChild === 'function') {
        document.body.appendChild(a);
      }
      if (typeof a.click === 'function') {
        a.click();
      }
      setTimeout(() => {
        try {
          if (typeof document !== 'undefined' && document && document.body && typeof document.body.removeChild === 'function') {
            document.body.removeChild(a);
          }
          if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(url);
          }
        } catch (e) {}
      }, 1000);
    }

    return patch;
  }

  /**
   * Load and apply a patch object across all knobs, selectors, and audio engines
   * @param {Object} patch
   * @param {Object} [options]
   * @param {boolean} [options.animate=true]
   * @param {number} [options.duration=350]
   * @returns {boolean} Success status
   */
  loadPatch(patch, { animate = true, duration = 350 } = {}) {
    if (!patch || typeof patch !== 'object') return false;

    this._isApplyingPreset = true;
    if (this._presetTimer) {
      clearTimeout(this._presetTimer);
      this._presetTimer = null;
    }

    // 1. Root, Scale, and Tuning
    if (this.engine) {
      const root = patch.rootPitchClass !== undefined ? patch.rootPitchClass : this.engine.rootPitchClass;
      const scaleKey = patch.currentScaleKey || this.engine.currentScaleKey;
      this.engine.setScale(scaleKey, root);

      if (typeof document !== 'undefined') {
        const rootSelect = document.getElementById('select-root');
        if (rootSelect) rootSelect.value = root;

        const scaleSelect = document.getElementById('select-scale');
        if (scaleSelect) scaleSelect.value = scaleKey;
      }

      if (this.playSurface && typeof this.playSurface.rebuildKeys === 'function') {
        this.playSurface.rebuildKeys();
      }
      if (typeof this.updateLoopNotes === 'function') {
        this.updateLoopNotes();
      }

      if (patch.a4 !== undefined) {
        this.engine.setTuningReference(patch.a4);
        if (typeof document !== 'undefined') {
          const tuningSelect = document.getElementById('select-tuning');
          if (tuningSelect) tuningSelect.value = String(patch.a4);
        }
      }
    }

    // Theme finish
    if (patch.theme && typeof document !== 'undefined' && document.body) {
      document.body.setAttribute('data-theme', patch.theme);
      const themeSelect = document.getElementById('select-theme');
      if (themeSelect) themeSelect.value = patch.theme;
    }

    // Chord Trigger / Strum Speed
    if (patch.chordSpeed && this.playSurface && typeof this.playSurface.setChordSpeed === 'function') {
      this.playSurface.setChordSpeed(patch.chordSpeed);
    }

    // 2. Knobs
    if (this.knobs && patch.knobs && typeof patch.knobs === 'object') {
      Object.entries(patch.knobs).forEach(([key, val]) => {
        if (this.knobs[key]) {
          if (animate && typeof this.knobs[key].animateTo === 'function') {
            this.knobs[key].animateTo(val, duration, null, false, false);
          } else if (typeof this.knobs[key].setValue === 'function') {
            this.knobs[key].setValue(val, false);
          }
        }
      });
      if (patch.knobs.masterVolume !== undefined && this.knobs.masterVol && patch.knobs.masterVol === undefined) {
        if (animate && typeof this.knobs.masterVol.animateTo === 'function') {
          this.knobs.masterVol.animateTo(patch.knobs.masterVolume, duration, null, false, false);
        } else if (typeof this.knobs.masterVol.setValue === 'function') {
          this.knobs.masterVol.setValue(patch.knobs.masterVolume, false);
        }
      }

      // Also update engine immediately to guarantee parameters are synchronized
      if (this.engine) {
        const k = patch.knobs;
        if (k.masterVol !== undefined) this.engine.setMasterVolume(k.masterVol / 100);
        else if (k.masterVolume !== undefined) this.engine.setMasterVolume(k.masterVolume / 100);
        if (k.masterDrive !== undefined) this.engine.setTapeDrive(k.masterDrive / 100);
        if (k.feltTone !== undefined) this.engine.setFeltTone(k.feltTone / 100);
        if (k.feltHammer !== undefined) this.engine.setFeltHammer(k.feltHammer / 100);
        if (k.feltSymp !== undefined) this.engine.setFeltSympathetic(k.feltSymp / 100);
        if (k.feltDecay !== undefined) this.engine.setFeltDecay(k.feltDecay);
        if (k.feltLevel !== undefined) this.engine.setFeltVolume(k.feltLevel / 100);
        if (k.drone1Beat !== undefined) this.engine.setDroneBeating(1, k.drone1Beat);
        if (k.drone1Detune !== undefined) this.engine.setDroneDetune(1, k.drone1Detune);
        if (k.drone1Fold !== undefined) this.engine.setDroneWavefold(1, k.drone1Fold);
        if (k.drone1Cutoff !== undefined) this.engine.setDroneCutoff(1, k.drone1Cutoff);
        if (k.drone1Res !== undefined) this.engine.setDroneResonance(1, k.drone1Res);
        if (k.drone1Lfo !== undefined) this.engine.setDroneLfo(1, k.drone1Lfo);
        if (k.drone1Vol !== undefined) this.engine.setDroneVolume(1, k.drone1Vol / 100);
        if (k.drone2Beat !== undefined) this.engine.setDroneBeating(2, k.drone2Beat);
        if (k.drone2Detune !== undefined) this.engine.setDroneDetune(2, k.drone2Detune);
        if (k.drone2Fold !== undefined) this.engine.setDroneWavefold(2, k.drone2Fold);
        if (k.drone2Cutoff !== undefined) this.engine.setDroneCutoff(2, k.drone2Cutoff);
        if (k.drone2Res !== undefined) this.engine.setDroneResonance(2, k.drone2Res);
        if (k.drone2Lfo !== undefined) this.engine.setDroneLfo(2, k.drone2Lfo);
        if (k.drone2Vol !== undefined) this.engine.setDroneVolume(2, k.drone2Vol / 100);
        if (k.delayTime !== undefined) this.engine.setDelayTime(k.delayTime / 1000);
        if (k.delayFeedback !== undefined) this.engine.setDelayFeedback(k.delayFeedback / 100);
        if (k.delayWow !== undefined) this.engine.setDelayWow(k.delayWow / 100);
        if (k.delayTone !== undefined) this.engine.setDelayTone(k.delayTone);
        if (k.delayWet !== undefined) this.engine.setDelayWet(k.delayWet / 100);
        if (k.reverbDecay !== undefined) this.engine.setReverbDecay(k.reverbDecay);
        if (k.reverbDamping !== undefined) this.engine.setReverbDamping(k.reverbDamping / 100);
        if (k.reverbShimmer !== undefined) this.engine.setReverbShimmer(k.reverbShimmer / 100);
        if (k.reverbWet !== undefined) this.engine.setReverbWet(k.reverbWet / 100);
        if (k.poissonDensity !== undefined && this.engine.poisson) this.engine.poisson.setParameters({ eventsPerMinute: k.poissonDensity });
        if (k.poissonHumanize !== undefined) this.engine.setPoissonHumanize(k.poissonHumanize / 100);
      }
    }

    // 3. Piano Waveform
    if (patch.pianoWave && this.engine) {
      const pianoWaveBtns = (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function')
        ? document.querySelectorAll('.piano-wave-btn')
        : [];
      pianoWaveBtns.forEach(btn => {
        const match = btn.getAttribute('data-wave') === patch.pianoWave;
        btn.classList.toggle('is-active', match);
      });
      this.engine.setFeltWaveform(patch.pianoWave);
    }

    // 4. Drone settings
    if (this.engine) {
      [1, 2].forEach(id => {
        const droneData = patch[`drone${id}`];
        if (droneData) {
          if (droneData.waveA) {
            const btnsA = (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function')
              ? document.querySelectorAll(`.drone${id}-wave-a`)
              : [];
            btnsA.forEach(b => {
              b.classList.toggle('is-active', isWaveformMatch(b.getAttribute('data-wave'), droneData.waveA));
            });
            this.engine.setDroneWaveA(id, droneData.waveA);
          }
          if (droneData.waveB) {
            const btnsB = (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function')
              ? document.querySelectorAll(`.drone${id}-wave-b`)
              : [];
            btnsB.forEach(b => {
              b.classList.toggle('is-active', isWaveformMatch(b.getAttribute('data-wave'), droneData.waveB));
            });
            this.engine.setDroneWaveB(id, droneData.waveB);
          }
          if (droneData.snap) {
            const snapBtns = (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function')
              ? document.querySelectorAll(`.drone${id}-snap-btn`)
              : [];
            snapBtns.forEach(b => b.classList.toggle('is-active', b.getAttribute('data-snap') === droneData.snap));
            this.engine.setDroneSnap(id, droneData.snap);
          }
          if (droneData.active !== undefined) {
            this.engine.setDroneActive(id, !!droneData.active);
            const toggleBtn = document.getElementById(`btn-drone${id}-active`) || document.getElementById(`toggle-drone-${id}`);
            if (toggleBtn) {
              toggleBtn.classList.toggle('is-active', !!droneData.active);
              const textEl = toggleBtn.querySelector('.braun-status-text');
              if (textEl) textEl.textContent = droneData.active ? `DRONE ${id} ON` : `DRONE ${id} OFF`;
            }
          }
        }
      });
    }

    // 5. Vector Pad
    if (patch.vectorPad && this.vectorPad) {
      const shouldAnimate = animate && duration > 0 && typeof requestAnimationFrame === 'function';
      if (shouldAnimate && typeof this.vectorPad.animateTo === 'function') {
        this.vectorPad.animateTo(patch.vectorPad.x, patch.vectorPad.y, duration, false);
      } else {
        this.vectorPad.setCoordinates(patch.vectorPad.x, patch.vectorPad.y, false);
      }
    }

    // Release applying preset flag once animation finishes so vector pad isn't clobbered
    const releaseDelay = (animate && duration > 0) ? (duration + 50) : 0;
    if (releaseDelay > 0) {
      this._presetTimer = setTimeout(() => {
        this._isApplyingPreset = false;
        this._presetTimer = null;
      }, releaseDelay);
    } else {
      this._isApplyingPreset = false;
    }

    return true;
  }

  _handleLoadPatchFile(e) {
    const file = e.target?.files?.[0];
    if (!file) return;

    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const patch = JSON.parse(evt.target.result);
          this.loadPatch(patch, { animate: true, duration: 350 });
        } catch (err) {
          console.error('Failed to parse patch JSON:', err);
        }
      };
      reader.readAsText(file);
    }
  }

  _syncKnobsFromVectorPad(data) {
    if (!this.knobs) return;
    if (this.knobs.feltTone && data.feltTone !== undefined) {
      this.knobs.feltTone.setValue(Math.round(data.feltTone * 100), false);
    }
    if (this.knobs.reverbShimmer && data.shimmerAmount !== undefined) {
      this.knobs.reverbShimmer.setValue(Math.round(data.shimmerAmount * 100), false);
    }
    if (this.knobs.reverbWet && data.reverbWet !== undefined) {
      this.knobs.reverbWet.setValue(Math.round(data.reverbWet * 100), false);
    }
    if (this.knobs.delayWet && data.delayWet !== undefined) {
      this.knobs.delayWet.setValue(Math.round(data.delayWet * 100), false);
    }
    if (this.knobs.delayFeedback && data.delayFeedback !== undefined) {
      this.knobs.delayFeedback.setValue(Math.round(data.delayFeedback * 100), false);
    }
  }

  _renderLoopRows() {
    const list = document.getElementById('loops-list');
    if (!list) return;
    list.innerHTML = '';

    const periods = [13.7, 17.3, 21.1, 26.9];
    periods.forEach((period, idx) => {
      const row = document.createElement('div');
      row.className = 'braun-loop-row';
      row.innerHTML = `
        <span class="braun-loop-id">TAPE ${idx + 1}</span>
        <span class="braun-loop-note" id="loop-note-${idx + 1}">---</span>
        <div class="braun-loop-bar-container">
          <div class="braun-loop-progress" id="loop-progress-${idx + 1}"></div>
        </div>
        <span class="braun-loop-period">${period}s</span>
      `;
      list.appendChild(row);
    });

    this.updateLoopNotes();
  }

  updateLoopNotes() {
    if (!this.engine || !this.engine.phaseLoops) return;
    this.engine.phaseLoops.loops.forEach(l => {
      const el = document.getElementById(`loop-note-${l.id}`);
      if (el && l.noteName) {
        el.textContent = l.noteName;
      }
    });
  }

  async startAudio() {
    if (this.isPowerOn && this.engine.isInitialized && this.engine.ctx && this.engine.ctx.state === 'running') return;
    if (this._startingAudio) return;
    this._startingAudio = true;

    try {
      await this.engine.init();
      this.isPowerOn = true;

      // Connect audio analyser to active CRT oscilloscope
      if (this.scope) {
        this.scope.setAnalyser(this.engine.analyser);
        this.scope.start();
      }

      // Update power button UI
      const powerBtn = document.getElementById('btn-power');
      if (powerBtn) {
        powerBtn.classList.add('is-active');
        const textEl = powerBtn.querySelector('.braun-status-text');
        if (textEl) textEl.textContent = 'SYSTEM ON';
      }

      this.updateLoopNotes();
    } finally {
      this._startingAudio = false;
    }
  }

  async togglePower() {
    const powerBtn = document.getElementById('btn-power');
    const autoEvolveBtn = document.getElementById('toggle-auto-evolve');
    const loopsBtn = document.getElementById('toggle-phase-loops');

    if (!this.isPowerOn) {
      await this.startAudio();
    } else {
      this.isPowerOn = false;

      // Immediately update power button UI
      if (powerBtn) {
        powerBtn.classList.remove('is-active');
        const textEl = powerBtn.querySelector('.braun-status-text');
        if (textEl) textEl.textContent = 'POWER ON';
      }

      // Reset oscilloscope back to standby phosphor beam
      if (this.scope) {
        this.scope.setAnalyser(null);
      }

      // Stop recording if active when powering down
      if (this.engine.isRecording) {
        const recordBtn = document.getElementById('btn-record');
        this.engine.stopRecording();
        if (recordBtn) {
          recordBtn.classList.remove('is-recording');
          const textEl = recordBtn.querySelector('.braun-record-text');
          if (textEl) textEl.textContent = 'RECORD WAV';
        }
      }

      // Gracefully disengage generative engines when powered down
      if (this.engine.poisson && this.engine.poisson.isRunning) {
        this.engine.poisson.stop();
        if (autoEvolveBtn) {
          autoEvolveBtn.classList.remove('is-active');
          const textEl = autoEvolveBtn.querySelector('.braun-status-text');
          if (textEl) textEl.textContent = 'EVOLVE OFF';
        }
      }
      if (this.engine.phaseLoops && this.engine.phaseLoops.isRunning) {
        this.engine.phaseLoops.stop();
        if (loopsBtn) {
          loopsBtn.classList.remove('is-active');
          const textEl = loopsBtn.querySelector('.braun-status-text');
          if (textEl) textEl.textContent = 'LOOPS OFF';
        }
        // Reset loop progress meters to zero
        this.engine.phaseLoops.loops.forEach(l => {
          const bar = document.getElementById(`loop-progress-${l.id}`);
          if (bar) bar.style.width = '0%';
        });
      }

      if (this.engine.ctx) {
        try {
          if (typeof this.engine.powerOff === 'function') {
            await this.engine.powerOff();
          } else {
            const now = this.engine.ctx.currentTime;
            const rampDuration = 0.050;
            const busses = [
              this.engine.masterGain,
              this.engine.droneBus,
              this.engine.pianoBus,
              this.engine.delayReturn,
              this.engine.delaySend,
              this.engine.drone1 && this.engine.drone1.voiceGain,
              this.engine.drone2 && this.engine.drone2.voiceGain
            ].filter(b => b && b.gain);
            busses.forEach(bus => {
              let held = false;
              if (typeof bus.gain.cancelAndHoldAtTime === 'function') {
                try {
                  bus.gain.cancelAndHoldAtTime(now);
                  held = true;
                } catch (e) {
                  held = false;
                }
              }
              if (!held) {
                if (typeof bus.gain.cancelScheduledValues === 'function') {
                  bus.gain.cancelScheduledValues(now);
                }
                const cur = (typeof bus.gain.value === 'number' && isFinite(bus.gain.value)) ? bus.gain.value : 1.0;
                if (typeof bus.gain.setValueAtTime === 'function') {
                  bus.gain.setValueAtTime(cur, now);
                }
              }
              if (typeof bus.gain.linearRampToValueAtTime === 'function') {
                bus.gain.linearRampToValueAtTime(0.0, now + rampDuration);
              } else if (typeof bus.gain.setTargetAtTime === 'function') {
                bus.gain.setTargetAtTime(0.0, now, rampDuration / 3);
              } else if (typeof bus.gain.setValueAtTime === 'function') {
                bus.gain.setValueAtTime(0.0, now + rampDuration);
              }
            });
            await new Promise(r => setTimeout(r, 80));
            const endT = Math.max(this.engine.ctx.currentTime, now + rampDuration);
            busses.forEach(bus => {
              if (typeof bus.gain.setValueAtTime === 'function') {
                bus.gain.setValueAtTime(0.0, endT);
              }
            });
            await this.engine.ctx.suspend();
          }
        } catch (e) {
          console.warn('AudioContext suspend error:', e);
        }
      }
    }
  }

  _buildKnobs() {
    if (this._knobsBuilt) return;
    this._knobsBuilt = true;

    // --- Master Knobs ---
    this.knobs.masterVol = new BraunKnob(document.getElementById('knob-master-vol'), {
      label: 'MASTER',
      min: 0,
      max: 100,
      value: 80,
      unit: '%',
      size: 'medium',
      onChange: (v) => this.engine.setMasterVolume(v / 100)
    });

    this.knobs.masterDrive = new BraunKnob(document.getElementById('knob-master-drive'), {
      label: 'TAPE DRIVE',
      min: 0,
      max: 100,
      value: 18,
      unit: '%',
      size: 'medium',
      onChange: (v) => this.engine.setTapeDrive(v / 100)
    });

    // --- Harold Budd Felt Piano Knobs ---
    this.knobs.feltTone = new BraunKnob(document.getElementById('knob-felt-tone'), {
      label: 'FELT DAMP',
      min: 0,
      max: 100,
      value: 62,
      unit: '%',
      size: 'medium',
      onChange: (v) => {
        this.engine.setFeltTone(v / 100);
        if (!this._isApplyingPreset && this.vectorPad && !this.vectorPad.isEngaged) {
          const normX = Math.max(0, Math.min(1, (v / 100 - 0.15) / 0.80));
          this.vectorPad.setCoordinates(normX, this.vectorPad.y, false);
        }
      }
    });

    this.knobs.feltHammer = new BraunKnob(document.getElementById('knob-felt-hammer'), {
      label: 'HAMMER',
      min: 0,
      max: 100,
      value: 45,
      unit: '%',
      size: 'small',
      onChange: (v) => this.engine.setFeltHammer(v / 100)
    });

    this.knobs.feltSymp = new BraunKnob(document.getElementById('knob-felt-symp'), {
      label: 'SYMP RESONANCE',
      min: 0,
      max: 100,
      value: 45,
      unit: '%',
      size: 'small',
      onChange: (v) => this.engine.setFeltSympathetic(v / 100)
    });

    this.knobs.feltDecay = new BraunKnob(document.getElementById('knob-felt-decay'), {
      label: 'DECAY',
      min: 0.5,
      max: 2.5,
      step: 0.1,
      value: 1.1,
      unit: 'x',
      size: 'small',
      onChange: (v) => this.engine.setFeltDecay(v)
    });

    this.knobs.feltLevel = new BraunKnob(document.getElementById('knob-felt-level'), {
      label: 'PIANO LVL',
      min: 0,
      max: 100,
      value: 80,
      unit: '%',
      size: 'medium',
      onChange: (v) => this.engine.setFeltVolume(v / 100)
    });

    // --- Solar 42n Drone Voice 1 Knobs ---
    this._setupDroneVoiceControls(1);

    // --- Solar 42n Drone Voice 2 Knobs ---
    this._setupDroneVoiceControls(2);

    // --- Brian Eno Tape Delay Knobs ---
    this.knobs.delayTime = new BraunKnob(document.getElementById('knob-delay-time'), {
      label: 'TAPE TIME',
      min: 100,
      max: 1500,
      value: 460,
      step: 1,
      unit: 'ms',
      size: 'medium',
      onChange: (v) => {
        this.engine.setDelayTime(v / 1000);
      }
    });

    this.knobs.delayFeedback = new BraunKnob(document.getElementById('knob-delay-fb'), {
      label: 'FEEDBACK',
      min: 0,
      max: 90,
      value: 55,
      unit: '%',
      size: 'medium',
      onChange: (v) => this.engine.setDelayFeedback(v / 100)
    });

    this.knobs.delayWow = new BraunKnob(document.getElementById('knob-delay-wow'), {
      label: 'WOW/FLUTTER',
      min: 0,
      max: 100,
      value: 45,
      unit: '%',
      size: 'small',
      onChange: (v) => this.engine.setDelayWow(v / 100)
    });

    this.knobs.delayTone = new BraunKnob(document.getElementById('knob-delay-tone'), {
      label: 'TAPE TONE',
      min: 1000,
      max: 10000,
      isLog: true,
      value: 3600,
      unit: 'Hz',
      size: 'small',
      onChange: (v) => this.engine.setDelayTone(v)
    });

    this.knobs.delayWet = new BraunKnob(document.getElementById('knob-delay-wet'), {
      label: 'DELAY MIX',
      min: 0,
      max: 100,
      value: 40,
      unit: '%',
      size: 'medium',
      onChange: (v) => this.engine.setDelayWet(v / 100)
    });

    // --- Shimmer Diffusion Reverb Knobs ---
    this.knobs.reverbDecay = new BraunKnob(document.getElementById('knob-reverb-decay'), {
      label: 'DIFFUSION',
      min: 1.0,
      max: 20.0,
      step: 0.5,
      value: 8.5,
      unit: 's',
      size: 'medium',
      onChange: (v) => this.engine.setReverbDecay(v)
    });

    this.knobs.reverbDamping = new BraunKnob(document.getElementById('knob-reverb-damping'), {
      label: 'AIR DAMP',
      min: 10,
      max: 95,
      value: 60,
      unit: '%',
      size: 'small',
      onChange: (v) => this.engine.setReverbDamping(v / 100)
    });

    this.knobs.reverbShimmer = new BraunKnob(document.getElementById('knob-reverb-shimmer'), {
      label: 'SHIMMER +12',
      min: 0,
      max: 100,
      value: 45,
      unit: '%',
      size: 'medium',
      onChange: (v) => {
        this.engine.setReverbShimmer(v / 100);
        if (!this._isApplyingPreset && this.vectorPad && !this.vectorPad.isEngaged) {
          const normY = Math.max(0, Math.min(1, (v / 100 - 0.15) / 0.70));
          this.vectorPad.setCoordinates(this.vectorPad.x, normY, false);
        }
      }
    });

    this.knobs.reverbWet = new BraunKnob(document.getElementById('knob-reverb-wet'), {
      label: 'REVERB MIX',
      min: 0,
      max: 100,
      value: 45,
      unit: '%',
      size: 'medium',
      onChange: (v) => this.engine.setReverbWet(v / 100)
    });

    // --- Generative Poisson Density & Humanize Knobs ---
    this.knobs.poissonDensity = new BraunKnob(document.getElementById('knob-poisson-density'), {
      label: 'NOTE RATE',
      min: 4,
      max: 30,
      step: 1,
      value: 12,
      unit: '/min',
      size: 'small',
      onChange: (v) => {
        if (this.engine.poisson) {
          this.engine.poisson.setParameters({ eventsPerMinute: v });
        }
      }
    });

    this.knobs.poissonHumanize = new BraunKnob(document.getElementById('knob-poisson-humanize'), {
      label: 'HUMANIZE',
      min: 0,
      max: 100,
      value: 50,
      unit: '%',
      size: 'small',
      onChange: (v) => {
        this.engine.setPoissonHumanize(v / 100);
      }
    });
  }

  _setupDroneVoiceControls(id) {
    const prefix = `drone${id}`;

    // Active switch
    const activeBtn = document.getElementById(`btn-${prefix}-active`);
    if (activeBtn) {
      activeBtn.addEventListener('click', async () => {
        const nextActive = !this.engine.droneParams[id].active;
        if (nextActive && !this.isPowerOn) {
          await this.startAudio();
        }
        this.engine.setDroneActive(id, nextActive);
        activeBtn.classList.toggle('is-active', nextActive);
        const textEl = activeBtn.querySelector('.braun-status-text');
        if (textEl) textEl.textContent = nextActive ? `DRONE ${id} ON` : `DRONE ${id} OFF`;
      });
    }

    // Waveform buttons for Osc A & B
    const waveBtnsA = document.querySelectorAll(`.${prefix}-wave-a`);
    waveBtnsA.forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!this.isPowerOn) {
          await this.startAudio();
        }
        waveBtnsA.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.engine.setDroneWaveA(id, btn.getAttribute('data-wave'));
        if (typeof btn.blur === 'function') btn.blur();
      });
    });

    const waveBtnsB = document.querySelectorAll(`.${prefix}-wave-b`);
    waveBtnsB.forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!this.isPowerOn) {
          await this.startAudio();
        }
        waveBtnsB.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.engine.setDroneWaveB(id, btn.getAttribute('data-wave'));
        if (typeof btn.blur === 'function') btn.blur();
      });
    });

    // Microtonal Beating (Continuous sub-hertz offset)
    this.knobs[`${prefix}Beat`] = new BraunKnob(document.getElementById(`knob-${prefix}-beat`), {
      label: 'BEATING',
      min: 0.0,
      max: 5.0,
      step: 0.05,
      value: id === 1 ? 0.35 : 0.65,
      precision: 2,
      unit: 'Hz',
      size: 'small',
      onChange: (v) => this.engine.setDroneBeating(id, v)
    });

    // Fine Detune Cents
    this.knobs[`${prefix}Detune`] = new BraunKnob(document.getElementById(`knob-${prefix}-detune`), {
      label: 'DETUNE',
      min: -35,
      max: 35,
      step: 0.5,
      value: id === 1 ? 2.5 : -3.2,
      precision: 1,
      unit: '¢',
      size: 'small',
      onChange: (v) => this.engine.setDroneDetune(id, v)
    });

    // Wavefold
    this.knobs[`${prefix}Fold`] = new BraunKnob(document.getElementById(`knob-${prefix}-fold`), {
      label: 'WAVEFOLD',
      min: 0,
      max: 100,
      value: 45,
      unit: '%',
      size: 'small',
      onChange: (v) => this.engine.setDroneWavefold(id, v)
    });

    // Cutoff
    this.knobs[`${prefix}Cutoff`] = new BraunKnob(document.getElementById(`knob-${prefix}-cutoff`), {
      label: 'LADDER LPF',
      min: 50,
      max: 8000,
      isLog: true,
      value: id === 1 ? 650 : 850,
      unit: 'Hz',
      size: 'medium',
      onChange: (v) => this.engine.setDroneCutoff(id, v)
    });

    // Resonance
    this.knobs[`${prefix}Res`] = new BraunKnob(document.getElementById(`knob-${prefix}-res`), {
      label: 'RESONANCE',
      min: 0.5,
      max: 10.0,
      step: 0.1,
      value: 3.5,
      unit: 'Q',
      size: 'small',
      onChange: (v) => this.engine.setDroneResonance(id, v)
    });

    // LFO Drift
    this.knobs[`${prefix}Lfo`] = new BraunKnob(document.getElementById(`knob-${prefix}-lfo`), {
      label: 'LFO DRIFT',
      min: 0.02,
      max: 1.5,
      step: 0.02,
      value: 0.12,
      unit: 'Hz',
      size: 'small',
      onChange: (v) => this.engine.setDroneLfo(id, v)
    });

    // Quick-Snap Tuning Presets
    const snapBtns = document.querySelectorAll(`.${prefix}-snap-btn`);
    snapBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!this.isPowerOn) {
          await this.startAudio();
        }
        snapBtns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const snapKey = btn.getAttribute('data-snap');
        this.engine.setDroneSnap(id, snapKey);
        if (id === 2 && snapKey === 'beating-unison') {
          const beatKnob = this.knobs[`${prefix}Beat`];
          if (beatKnob) beatKnob.setValue(0.35, false);
        }
        // Auto-activate drone voice so user immediately hears the snapped note
        if (!this.engine.droneParams[id].active) {
          this.engine.setDroneActive(id, true);
          if (activeBtn) {
            activeBtn.classList.add('is-active');
            const textEl = activeBtn.querySelector('.braun-status-text');
            if (textEl) textEl.textContent = `DRONE ${id} ON`;
          }
        }
      });
    });

    // Volume (Calibrated default 55% for lush, non-overpowering ambient underbed)
    this.knobs[`${prefix}Vol`] = new BraunKnob(document.getElementById(`knob-${prefix}-vol`), {
      label: 'LEVEL',
      min: 0,
      max: 100,
      value: 55,
      unit: '%',
      size: 'medium',
      onChange: (v) => this.engine.setDroneVolume(id, v / 100)
    });
  }
}

// Resilient browser bootloader (handles early, deferred, or dynamic execution across all engines)
function boot() {
  if (typeof window !== 'undefined' && !window.app) {
    window.app = new AmbientApp();
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
    window.addEventListener('DOMContentLoaded', boot);
    window.addEventListener('load', boot);
  } else {
    boot();
  }
}
