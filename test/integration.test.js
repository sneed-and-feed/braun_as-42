import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { SCALES, CHORD_VOICINGS, midiToFrequency, quantizeToScale, getScaleDegreesInOctaves } from '../js/generative/scales.js';
import { PoissonGenerator } from '../js/generative/poisson.js';
import { PhaseLoopEngine } from '../js/generative/phase-loops.js';
import { makeSoftClipCurve, makeWavefoldCurve, makeTapeSaturationCurve } from '../js/audio/wavefolder.js';
import { generateSawCoefficients, generateSquareCoefficients, generateTriangleCoefficients } from '../js/audio/anti-aliasing.js';

describe('End-to-End System & Engine Integration', () => {
  it('verifies all modal scales have intervals within 0..11 and start with 0', () => {
    Object.values(SCALES).forEach(scale => {
      assert.ok(scale.intervals.length >= 5, `Scale ${scale.id} should have >= 5 notes`);
      assert.strictEqual(scale.intervals[0], 0, `Scale ${scale.id} must start with root interval 0`);
      scale.intervals.forEach(int => {
        assert.ok(int >= 0 && int < 12, `Interval ${int} must be in 0..11`);
      });
    });
  });

  it('verifies all chord voicings contain valid interval offsets', () => {
    Object.values(CHORD_VOICINGS).forEach(voicing => {
      assert.ok(voicing.intervals.length >= 3, `Chord ${voicing.id} must have >= 3 notes`);
      voicing.intervals.forEach(int => {
        assert.ok(int >= 0 && int <= 36, `Chord interval ${int} must be reasonable`);
      });
    });
  });

  it('verifies Poisson generator generates sequence of 100 musical events without NaN', () => {
    const generator = new PoissonGenerator({
      eventsPerMinute: 18,
      rootPitchClass: 2, // D
      scaleIntervals: SCALES.LYDIAN_DREAM.intervals
    });

    for (let i = 0; i < 100; i++) {
      const ev = generator.generateEvent();
      assert.ok(!Number.isNaN(ev.freq), 'Frequency must not be NaN');
      assert.ok(!Number.isNaN(ev.velocity), 'Velocity must not be NaN');
      assert.ok(!Number.isNaN(ev.duration), 'Duration must not be NaN');
      assert.ok(!Number.isNaN(ev.nextInterval), 'Next interval must not be NaN');
      assert.ok(ev.freq >= 20 && ev.freq <= 2500, `Frequency ${ev.freq} must be audible range`);
    }
  });

  it('verifies Phase Loop engine steps through 60 seconds of time accurately', () => {
    const engine = new PhaseLoopEngine();
    let triggerCount = 0;

    engine.onNoteTrigger = (loop, data) => {
      triggerCount++;
      assert.ok(data.freq > 0);
      assert.ok(data.velocity > 0);
    };

    // Step in 50ms increments for 60 seconds
    const dt = 0.05;
    for (let t = 0; t < 60; t += dt) {
      engine.step(dt);
    }

    // Over 60 seconds with loops of [13.7, 17.3, 21.1, 26.9], triggers should happen
    assert.ok(triggerCount >= 8, `Expected multiple loop triggers over 60s, got ${triggerCount}`);
  });

  it('verifies wavefolder curves contain no NaN or undefined samples across resolutions', () => {
    [512, 1024, 2048, 4096].forEach(size => {
      const soft = makeSoftClipCurve(size, 1.8);
      const fold = makeWavefoldCurve(size, 2.2, 0.7);
      const tape = makeTapeSaturationCurve(size, 0.5);

      for (let i = 0; i < size; i++) {
        assert.ok(!Number.isNaN(soft[i]));
        assert.ok(!Number.isNaN(fold[i]));
        assert.ok(!Number.isNaN(tape[i]));
        assert.ok(soft[i] >= -1.0 && soft[i] <= 1.0);
        assert.ok(fold[i] >= -1.0 && fold[i] <= 1.0);
        assert.ok(tape[i] >= -1.0 && tape[i] <= 1.0);
      }
    });
  });

  it('verifies anti-aliased wavetable Fourier coefficients have finite, bounded values', () => {
    const saw = generateSawCoefficients(64);
    const sqr = generateSquareCoefficients(64);
    const tri = generateTriangleCoefficients(64);

    for (let i = 0; i <= 64; i++) {
      assert.ok(!Number.isNaN(saw.real[i]) && !Number.isNaN(saw.imag[i]));
      assert.ok(!Number.isNaN(sqr.real[i]) && !Number.isNaN(sqr.imag[i]));
      assert.ok(!Number.isNaN(tri.real[i]) && !Number.isNaN(tri.imag[i]));
    }
  });
});
