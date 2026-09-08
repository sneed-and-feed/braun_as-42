/**
 * @file app.js
 * @brief Main application orchestrator for the Braun Ambient Synthesizer.
 * Wires UI knobs, oscilloscopes, generative engines, and audio graph.
 */

import { AudioEngine } from './audio/engine.js';
import { BraunKnob } from './ui/knob.js';
import { BraunOscilloscope } from './ui/oscilloscope.js';
import { BraunPlaySurface } from './ui/keyboard.js';
import { BraunVectorPad } from './ui/vector-pad.js';
import { SCALES, NOTE_NAMES } from './generative/scales.js';

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

    this.init();
  }

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._initDom();
  }

  _initDom() {
    // Theme Switcher (Apply current selected finish immediately on boot)
    const themeSelect = document.getElementById('select-theme');
    if (themeSelect && document.body) {
      document.body.setAttribute('data-theme', themeSelect.value);
      themeSelect.addEventListener('change', (e) => {
        document.body.setAttribute('data-theme', e.target.value);
      });
    }

    // Populate Root note selector
    const rootSelect = document.getElementById('select-root');
    if (rootSelect) {
      rootSelect.innerHTML = '';
      NOTE_NAMES.forEach((note, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = note;
        rootSelect.appendChild(opt);
      });
      rootSelect.value = this.engine.rootPitchClass;

      rootSelect.addEventListener('change', (e) => {
        const root = parseInt(e.target.value, 10);
        this.engine.setScale(this.engine.currentScaleKey, root);
        if (this.playSurface) this.playSurface.rebuildKeys();
        this.updateLoopNotes();
      });
    }

    // Populate Scale selector
    const scaleSelect = document.getElementById('select-scale');
    if (scaleSelect) {
      scaleSelect.innerHTML = '';
      Object.values(SCALES).forEach(sc => {
        const opt = document.createElement('option');
        opt.value = sc.id;
        opt.textContent = sc.name;
        scaleSelect.appendChild(opt);
      });
      scaleSelect.value = this.engine.currentScaleKey;

      scaleSelect.addEventListener('change', (e) => {
        const scaleKey = e.target.value;
        this.engine.setScale(scaleKey, this.engine.rootPitchClass);
        if (this.playSurface) this.playSurface.rebuildKeys();
        this.updateLoopNotes();
      });
    }

    // Master Power Button
    const powerBtn = document.getElementById('btn-power');
    if (powerBtn) {
      powerBtn.addEventListener('click', async () => {
        await this.togglePower();
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
      });
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
        if (!this.isPowerOn) {
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
          if (!this.isPowerOn) {
            await this.startAudio();
          }
        },
        onChange: (data) => {
          this._syncKnobsFromVectorPad(data);
        }
      });
    }

    // Render All Rotary Knobs immediately
    this._buildKnobs();
  }

  _syncKnobsFromVectorPad(data) {
    if (!this.knobs) return;
    if (this.knobs.feltTone) {
      this.knobs.feltTone.setValue(Math.round(data.feltTone * 100), false);
    }
    if (this.knobs.delayTime) {
      this.knobs.delayTime.setValue(Math.round(data.delayTimeSec * 1000), false);
    }
    if (this.knobs.reverbShimmer) {
      this.knobs.reverbShimmer.setValue(Math.round(data.shimmerAmount * 100), false);
    }
    if (this.knobs.reverbWet) {
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
    if (this.isPowerOn && this.engine.isInitialized) return;
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
      if (this.engine.ctx) {
        try {
          await this.engine.ctx.suspend();
        } catch (e) {
          console.warn('AudioContext suspend error:', e);
        }
      }
      this.isPowerOn = false;

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

      if (powerBtn) {
        powerBtn.classList.remove('is-active');
        const textEl = powerBtn.querySelector('.braun-status-text');
        if (textEl) textEl.textContent = 'POWER ON';
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
    }
  }

  _buildKnobs() {
    if (this._knobsBuilt) return;
    this._knobsBuilt = true;

    // --- Master Knobs ---
    new BraunKnob(document.getElementById('knob-master-vol'), {
      label: 'MASTER',
      min: 0,
      max: 100,
      value: 85,
      unit: '%',
      size: 'medium',
      onChange: (v) => this.engine.setMasterVolume(v / 100)
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
        if (this.vectorPad && !this.vectorPad.isEngaged) {
          const normX = Math.max(0, Math.min(1, (v / 100 - 0.15) / 0.80));
          this.vectorPad.setCoordinates(normX, this.vectorPad.y, false);
        }
      }
    });

    new BraunKnob(document.getElementById('knob-felt-hammer'), {
      label: 'HAMMER',
      min: 0,
      max: 100,
      value: 45,
      unit: '%',
      size: 'small',
      onChange: (v) => this.engine.setFeltHammer(v / 100)
    });

    new BraunKnob(document.getElementById('knob-felt-decay'), {
      label: 'DECAY',
      min: 0.5,
      max: 2.5,
      step: 0.1,
      value: 1.1,
      unit: 'x',
      size: 'small',
      onChange: (v) => this.engine.setFeltDecay(v)
    });

    new BraunKnob(document.getElementById('knob-felt-level'), {
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
      step: 10,
      unit: 'ms',
      size: 'medium',
      onChange: (v) => {
        this.engine.setDelayTime(v / 1000);
        if (this.vectorPad && !this.vectorPad.isEngaged) {
          const normY = Math.max(0, Math.min(1, (v / 1000 - 0.10) / 0.85));
          this.vectorPad.setCoordinates(this.vectorPad.x, normY, false);
        }
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

    new BraunKnob(document.getElementById('knob-delay-wow'), {
      label: 'WOW/FLUTTER',
      min: 0,
      max: 100,
      value: 45,
      unit: '%',
      size: 'small',
      onChange: (v) => this.engine.setDelayWow(v / 100)
    });

    new BraunKnob(document.getElementById('knob-delay-tone'), {
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
    new BraunKnob(document.getElementById('knob-reverb-decay'), {
      label: 'DIFFUSION',
      min: 1.0,
      max: 20.0,
      step: 0.5,
      value: 8.5,
      unit: 's',
      size: 'medium',
      onChange: (v) => this.engine.setReverbDecay(v)
    });

    new BraunKnob(document.getElementById('knob-reverb-damping'), {
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
        if (this.vectorPad && !this.vectorPad.isEngaged) {
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

    // --- Generative Poisson Density Knob ---
    new BraunKnob(document.getElementById('knob-poisson-density'), {
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
      btn.addEventListener('click', () => {
        waveBtnsA.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.engine.setDroneWaveA(id, btn.getAttribute('data-wave'));
      });
    });

    const waveBtnsB = document.querySelectorAll(`.${prefix}-wave-b`);
    waveBtnsB.forEach(btn => {
      btn.addEventListener('click', () => {
        waveBtnsB.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this.engine.setDroneWaveB(id, btn.getAttribute('data-wave'));
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
    new BraunKnob(document.getElementById(`knob-${prefix}-detune`), {
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
    new BraunKnob(document.getElementById(`knob-${prefix}-fold`), {
      label: 'WAVEFOLD',
      min: 0,
      max: 100,
      value: 45,
      unit: '%',
      size: 'small',
      onChange: (v) => this.engine.setDroneWavefold(id, v)
    });

    // Cutoff
    new BraunKnob(document.getElementById(`knob-${prefix}-cutoff`), {
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
    new BraunKnob(document.getElementById(`knob-${prefix}-res`), {
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
    new BraunKnob(document.getElementById(`knob-${prefix}-lfo`), {
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
        // Auto-activate drone voice so user immediately hears the snapped note
        if (!this.engine.droneParams[id].active) {
          this.engine.setDroneActive(id, true);
          if (activeBtn) {
            activeBtn.classList.add('is-active');
            const textEl = activeBtn.querySelector('.braun-status-text');
            if (textEl) textEl.textContent = `DRONE ${id} ON`;
          }
        }
        snapBtns.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const snapKey = btn.getAttribute('data-snap');
        this.engine.setDroneSnap(id, snapKey);
        if (id === 2 && snapKey === 'beating-unison') {
          const beatKnob = this.knobs[`${prefix}Beat`];
          if (beatKnob) beatKnob.setValue(0.35, false);
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
