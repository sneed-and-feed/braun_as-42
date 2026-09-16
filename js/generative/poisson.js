/**
 * @file poisson.js
 * @brief True Poisson point process and organic generative engine for Harold Budd style
 * sparse contemplative piano note generation.
 */

import { quantizeToScale, midiToFrequency, SCALES } from './scales.js';

export class PoissonGenerator {
  /**
   * @param {Object} options
   * @param {number} [options.eventsPerMinute=12] - Average note rate lambda
   * @param {number} [options.minRestSeconds=0.5] - Minimum rest between notes
   * @param {number} [options.maxRestSeconds=9.0] - Maximum silence cap
   * @param {number} [options.rootPitchClass=0] - Root note (0 = C)
   * @param {number[]} [options.scaleIntervals=SCALES.BUDD_PENTATONIC.intervals]
   * @param {number} [options.minMidi=48] - C3
   * @param {number} [options.maxMidi=84] - C6
   * @param {number} [options.a4=440]
   */
  constructor(options = {}) {
    this.eventsPerMinute = (typeof options.eventsPerMinute === 'number' && Number.isFinite(options.eventsPerMinute) && options.eventsPerMinute > 0)
      ? options.eventsPerMinute
      : 12;
    this.minRestSeconds = (typeof options.minRestSeconds === 'number' && Number.isFinite(options.minRestSeconds) && options.minRestSeconds > 0)
      ? options.minRestSeconds
      : 0.6;
    this.maxRestSeconds = (typeof options.maxRestSeconds === 'number' && Number.isFinite(options.maxRestSeconds) && options.maxRestSeconds >= this.minRestSeconds)
      ? options.maxRestSeconds
      : 8.5;
    this.humanize = (typeof options.humanize === 'number' && Number.isFinite(options.humanize))
      ? Math.max(0, Math.min(1.0, options.humanize))
      : 0.50;
    this.rootPitchClass = (typeof options.rootPitchClass === 'number' && Number.isFinite(options.rootPitchClass))
      ? options.rootPitchClass
      : 0;
    this.scaleIntervals = (Array.isArray(options.scaleIntervals) && options.scaleIntervals.length > 0)
      ? options.scaleIntervals
      : SCALES.BUDD_PENTATONIC.intervals;
    this.minMidi = (typeof options.minMidi === 'number' && Number.isFinite(options.minMidi)) ? options.minMidi : 48; // C3
    this.maxMidi = (typeof options.maxMidi === 'number' && Number.isFinite(options.maxMidi)) ? options.maxMidi : 84; // C6
    this.a4 = (typeof options.a4 === 'number' && Number.isFinite(options.a4) && options.a4 > 0) ? options.a4 : 440;

    this.lastMidiNote = 60; // Start at middle C
    this.timerId = null;
    this.isRunning = false;
    this.onNoteTrigger = null; // Callback: ({ midi, freq, velocity, duration }) => void
  }

  /**
   * Compute next inter-arrival interval in seconds based on exponential distribution
   * @param {number} [customEpm] - Optional override for density
   * @returns {number} Seconds until next event
   */
  getNextInterval(customEpm) {
    const rawEpm = (customEpm !== undefined) ? customEpm : this.eventsPerMinute;
    const epm = (typeof rawEpm === 'number' && Number.isFinite(rawEpm) && rawEpm > 0) ? rawEpm : 12;

    const minRest = (typeof this.minRestSeconds === 'number' && Number.isFinite(this.minRestSeconds) && this.minRestSeconds > 0)
      ? this.minRestSeconds
      : 0.6;
    const maxRest = (typeof this.maxRestSeconds === 'number' && Number.isFinite(this.maxRestSeconds) && this.maxRestSeconds >= minRest)
      ? this.maxRestSeconds
      : 8.5;
    const hum = (typeof this.humanize === 'number' && Number.isFinite(this.humanize))
      ? Math.max(0, Math.min(1.0, this.humanize))
      : 0.50;

    const lambda = Math.max(0.1, epm) / 60.0; // events per second

    // Exponential distribution: -ln(1 - U) / lambda
    const u = Math.max(1e-7, Math.min(1 - 1e-7, Math.random()));
    const rawInterval = -Math.log(1 - u) / lambda;

    // Organic rubato timing variance scaled by humanize
    const mean = 1.0 / lambda;
    const rubato = mean + (rawInterval - mean) * (0.35 + hum * 0.65);

    // Constrain within organic ambient bounds
    const clamped = Math.max(minRest, Math.min(maxRest, rubato));
    return (Number.isFinite(clamped) && clamped > 0) ? clamped : minRest;
  }

  /**
   * Generate next note pitch with Harold Budd melodic step preference
   * @returns {number} Quantized MIDI note
   */
  generateNextPitch() {
    // 70% chance of small melodic step (-4 to +4 semitones), 30% chance of expressive leap
    const isStep = Math.random() < 0.70;
    let targetMidi;

    if (isStep) {
      const stepChoices = [-5, -4, -2, -1, 1, 2, 4, 5];
      const delta = stepChoices[Math.floor(Math.random() * stepChoices.length)];
      targetMidi = this.lastMidiNote + delta;
    } else {
      // Leap within Budd register (biased towards warm midrange 52 - 72)
      const r = Math.random();
      if (r < 0.20) {
        // Low resonant anchor (48 - 55)
        targetMidi = 48 + Math.floor(Math.random() * 8);
      } else if (r < 0.85) {
        // Sweet felt piano tenor/alto (55 - 72)
        targetMidi = 55 + Math.floor(Math.random() * 18);
      } else {
        // High acoustic chime (72 - 84)
        targetMidi = 72 + Math.floor(Math.random() * 13);
      }
    }

    // Clamp to min/max
    targetMidi = Math.max(this.minMidi, Math.min(this.maxMidi, targetMidi));

    // Quantize strictly to current modal scale
    const quantized = quantizeToScale(targetMidi, this.rootPitchClass, this.scaleIntervals);
    this.lastMidiNote = quantized;
    return quantized;
  }

  /**
   * Generate organic humanized velocity (bell-curve centered around 0.50 - 0.65)
   * @returns {number} Velocity between 0.25 and 0.85
   */
  generateVelocity() {
    // Approximate normal distribution via sum of 3 uniforms
    const u = (Math.random() + Math.random() + Math.random()) / 3;
    // When humanize is 0, velocity stays near Budd core ~0.55;
    // at humanize = 1, it explores full dynamic nuance 0.28 .. 0.82
    const varianceScale = 0.20 + (this.humanize * 0.80);
    const vel = 0.55 + (u - 0.5) * 0.54 * varianceScale;
    return Math.max(0.25, Math.min(0.85, vel));
  }

  /**
   * Generate note duration in seconds
   * @returns {number} Duration in seconds
   */
  generateDuration() {
    // 2.0 to 7.0 seconds of sustain allowing lush reverb decay
    return 2.0 + (Math.random() * 5.0);
  }

  /**
   * Compute full event packet
   */
  generateEvent() {
    const midi = this.generateNextPitch();
    const freq = midiToFrequency(midi, this.a4);
    const velocity = this.generateVelocity();
    const duration = this.generateDuration();
    const nextInterval = this.getNextInterval();

    return {
      midi,
      freq,
      velocity,
      duration,
      nextInterval
    };
  }

  /**
   * Start the real-time generative clock
   * @param {Function} onTrigger - callback receiving ({ midi, freq, velocity, duration })
   */
  start(onTrigger) {
    if (this.isRunning) return;
    this.isRunning = true;
    if (onTrigger) this.onNoteTrigger = onTrigger;

    const scheduleNext = () => {
      if (!this.isRunning) return;
      const event = this.generateEvent();

      if (this.onNoteTrigger) {
        this.onNoteTrigger(event);
      }

      const nextSec = (typeof event.nextInterval === 'number' && Number.isFinite(event.nextInterval) && event.nextInterval > 0)
        ? event.nextInterval
        : this.getNextInterval();
      const delayMs = Math.max(100, Math.round(nextSec * 1000));
      if (this.isRunning) {
        this.timerId = setTimeout(scheduleNext, delayMs);
      }
    };

    // First note triggers with short graceful prelude
    const initialInterval = this.getNextInterval();
    const firstDelayMs = Math.max(100, Math.round(initialInterval * 1000 * 0.5));
    this.timerId = setTimeout(scheduleNext, firstDelayMs);
  }

  /**
   * Stop the clock
   */
  stop() {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Update parameters live
   */
  setParameters({ eventsPerMinute, rootPitchClass, scaleIntervals, a4, humanize, minRestSeconds, maxRestSeconds } = {}) {
    if (eventsPerMinute !== undefined && Number.isFinite(eventsPerMinute) && eventsPerMinute > 0) {
      this.eventsPerMinute = eventsPerMinute;
    }
    if (rootPitchClass !== undefined && Number.isFinite(rootPitchClass)) {
      this.rootPitchClass = rootPitchClass;
    }
    if (scaleIntervals !== undefined && Array.isArray(scaleIntervals)) {
      this.scaleIntervals = scaleIntervals;
    }
    if (a4 !== undefined && Number.isFinite(a4) && a4 > 0) {
      this.a4 = a4;
    }
    if (humanize !== undefined && Number.isFinite(humanize)) {
      this.humanize = Math.max(0, Math.min(1.0, humanize));
    }
    if (minRestSeconds !== undefined && Number.isFinite(minRestSeconds) && minRestSeconds > 0) {
      this.minRestSeconds = minRestSeconds;
    }
    if (maxRestSeconds !== undefined && Number.isFinite(maxRestSeconds) && maxRestSeconds > 0) {
      this.maxRestSeconds = maxRestSeconds;
    }
  }
}
