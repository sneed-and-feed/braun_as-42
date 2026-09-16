/**
 * @file phase-loops.js
 * @brief Brian Eno "Music for Airports" asynchronous tape phase loop generator.
 * Uses incommensurable prime periods so polyphonic combinations never repeat.
 */

import { midiToFrequency, quantizeToScale, SCALES, NOTE_NAMES } from './scales.js';

export const DEFAULT_LOOP_PERIODS = [13.7, 17.3, 21.1, 26.9]; // Prime-fractional seconds

export class PhaseLoopEngine {
  /**
   * @param {Object} options
   * @param {number} [options.rootPitchClass=0]
   * @param {number[]} [options.scaleIntervals=SCALES.LYDIAN_DREAM.intervals]
   * @param {number} [options.a4=440]
   * @param {number[]} [options.loopPeriods=DEFAULT_LOOP_PERIODS]
   */
  constructor(options = {}) {
    this.rootPitchClass = options.rootPitchClass ?? 0;
    this.scaleIntervals = options.scaleIntervals ?? SCALES.LYDIAN_DREAM.intervals;
    this.a4 = options.a4 ?? 440;
    this.speedMultiplier = 1.0;

    const periods = options.loopPeriods ?? DEFAULT_LOOP_PERIODS;

    // Musical note offsets for each loop (in semitones relative to root C4 = 60)
    // Selected for sublime Brian Eno ambient counterpoint
    const noteOffsets = [0, 4, 7, 11]; // Tonic, 3rd, 5th, 7th (or modal equivalents)
    const octaves = [3, 4, 4, 5];
    const pans = [-0.65, 0.45, -0.30, 0.70];

    this.loops = periods.map((period, index) => {
      const baseMidi = (octaves[index] + 1) * 12 + this.rootPitchClass + noteOffsets[index % noteOffsets.length];
      const quantizedMidi = quantizeToScale(baseMidi, this.rootPitchClass, this.scaleIntervals);
      const noteName = `${NOTE_NAMES[quantizedMidi % 12]}${Math.floor(quantizedMidi / 12) - 1}`;

      return {
        id: index + 1,
        periodSeconds: period,
        elapsedSeconds: Math.random() * period * 0.8, // Initial phase offset
        baseMidi,
        midi: quantizedMidi,
        noteName,
        freq: midiToFrequency(quantizedMidi, this.a4),
        pan: pans[index % pans.length],
        velocity: 0.42 + (index * 0.08),
        duration: 3.5 + (index * 0.8),
        active: true,
        progress: 0.0 // 0.0 to 1.0 for UI display
      };
    });

    this.isRunning = false;
    this.lastTimestamp = null;
    this.animationFrameId = null;
    this.onNoteTrigger = null; // Callback: (loop, eventData) => void
    this.onPhaseUpdate = null; // Callback: (loops) => void for 60fps UI meters
  }

  /**
   * Advance time by deltaSeconds
   * @param {number} deltaSeconds
   */
  step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const effectiveDelta = deltaSeconds * (Number.isFinite(this.speedMultiplier) && this.speedMultiplier > 0 ? this.speedMultiplier : 1.0);

    for (const loop of this.loops) {
      if (!loop.active || !Number.isFinite(loop.periodSeconds) || loop.periodSeconds <= 0) continue;

      const prevTime = loop.elapsedSeconds;
      loop.elapsedSeconds += effectiveDelta;

      // Check for period wrap-around (note strike event)
      const prevCycles = Math.floor(prevTime / loop.periodSeconds);
      const currCycles = Math.floor(loop.elapsedSeconds / loop.periodSeconds);

      // Normalized progress in [0.0, 1.0)
      loop.progress = Math.max(0.0, Math.min(1.0, (loop.elapsedSeconds % loop.periodSeconds) / loop.periodSeconds));

      if (currCycles > prevCycles) {
        if (this.onNoteTrigger) {
          this.onNoteTrigger(loop, {
            midi: loop.midi,
            freq: loop.freq,
            pan: loop.pan,
            velocity: loop.velocity,
            duration: loop.duration
          });
        }
      }

      // Bound elapsedSeconds to avoid large floating point accumulation
      if (loop.elapsedSeconds >= loop.periodSeconds * 100) {
        loop.elapsedSeconds = loop.elapsedSeconds % loop.periodSeconds;
      }
    }
  }

  /**
   * Start loop clock using high-precision performance.now()
   */
  start(onTrigger, onPhaseUpdate) {
    if (this.isRunning) return;
    this.isRunning = true;
    if (onTrigger) this.onNoteTrigger = onTrigger;
    if (onPhaseUpdate) this.onPhaseUpdate = onPhaseUpdate;

    this.lastTimestamp = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();

    const loopLoop = () => {
      if (!this.isRunning) return;
      const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();

      if (this.lastTimestamp === null || !Number.isFinite(this.lastTimestamp)) {
        this.lastTimestamp = now;
      }

      const rawDt = (now - this.lastTimestamp) / 1000;
      const dt = (Number.isFinite(rawDt) && rawDt > 0) ? Math.min(0.2, rawDt) : 0;
      this.lastTimestamp = now;

      if (dt > 0) {
        this.step(dt);
      }

      if (this.onPhaseUpdate) {
        this.onPhaseUpdate(this.loops);
      }

      if (this.isRunning) {
        if (typeof requestAnimationFrame !== 'undefined') {
          this.animationFrameId = requestAnimationFrame(loopLoop);
        } else {
          this.animationFrameId = setTimeout(loopLoop, 30);
        }
      }
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      this.animationFrameId = requestAnimationFrame(loopLoop);
    } else {
      this.animationFrameId = setTimeout(loopLoop, 30);
    }
  }

  /**
   * Stop loop clock
   */
  stop() {
    this.isRunning = false;
    if (typeof cancelAnimationFrame !== 'undefined' && this.animationFrameId !== null) {
      try {
        cancelAnimationFrame(this.animationFrameId);
      } catch (e) {}
    }
    if (this.animationFrameId !== null) {
      try {
        clearTimeout(this.animationFrameId);
      } catch (e) {}
    }
    this.animationFrameId = null;
    this.lastTimestamp = null;
  }

  /**
   * Requantize all loop notes when root or scale changes
   */
  updateScale(rootPitchClass, scaleIntervals, a4 = 440) {
    this.rootPitchClass = rootPitchClass;
    this.scaleIntervals = scaleIntervals;
    this.a4 = a4;

    for (const loop of this.loops) {
      loop.midi = quantizeToScale(loop.baseMidi, this.rootPitchClass, this.scaleIntervals);
      loop.noteName = `${NOTE_NAMES[loop.midi % 12]}${Math.floor(loop.midi / 12) - 1}`;
      loop.freq = midiToFrequency(loop.midi, this.a4);
    }
  }

  /**
   * Toggle loop mute
   */
  setLoopActive(index, active) {
    if (this.loops[index]) {
      this.loops[index].active = active;
    }
  }
}
