import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { PoissonGenerator } from '../js/generative/poisson.js';
import { SCALES } from '../js/generative/scales.js';

describe('Poisson Point Process Generator', () => {
  it('generates intervals within minRest and maxRest bounds', () => {
    const generator = new PoissonGenerator({
      eventsPerMinute: 15,
      minRestSeconds: 0.5,
      maxRestSeconds: 8.0
    });

    for (let i = 0; i < 100; i++) {
      const dt = generator.getNextInterval();
      assert.ok(dt >= 0.5, `Interval ${dt} should be >= 0.5`);
      assert.ok(dt <= 8.0, `Interval ${dt} should be <= 8.0`);
    }
  });

  it('exponential distribution mean scales inversely with event rate lambda', () => {
    const fastGen = new PoissonGenerator({ eventsPerMinute: 60, minRestSeconds: 0.01, maxRestSeconds: 20 });
    const slowGen = new PoissonGenerator({ eventsPerMinute: 10, minRestSeconds: 0.01, maxRestSeconds: 20 });

    let sumFast = 0;
    let sumSlow = 0;
    const N = 500;
    for (let i = 0; i < N; i++) {
      sumFast += fastGen.getNextInterval();
      sumSlow += slowGen.getNextInterval();
    }
    const avgFast = sumFast / N;
    const avgSlow = sumSlow / N;

    // Average for 60 epm (1 ev/s) should be roughly ~1.0s; for 10 epm should be roughly ~5-6s.
    assert.ok(avgFast < avgSlow, `Fast avg (${avgFast}) must be shorter than slow avg (${avgSlow})`);
    assert.ok(avgFast < 2.5, `Fast avg should be around 1-2s, got ${avgFast}`);
    assert.ok(avgSlow > 3.0, `Slow avg should be > 3s, got ${avgSlow}`);
  });

  it('generates pitches strictly locked to scale intervals', () => {
    const generator = new PoissonGenerator({
      rootPitchClass: 0, // C
      scaleIntervals: SCALES.BUDD_PENTATONIC.intervals, // [0, 2, 4, 7, 9] (C, D, E, G, A)
      minMidi: 48,
      maxMidi: 84
    });

    const allowedPitchClasses = new Set([0, 2, 4, 7, 9]);

    for (let i = 0; i < 50; i++) {
      const pitch = generator.generateNextPitch();
      assert.ok(pitch >= 48 && pitch <= 84, `Pitch ${pitch} should be in range 48..84`);
      const pc = pitch % 12;
      assert.ok(allowedPitchClasses.has(pc), `Pitch class ${pc} must be in allowed pentatonic set`);
    }
  });

  it('generates valid velocities and durations', () => {
    const generator = new PoissonGenerator();
    for (let i = 0; i < 50; i++) {
      const ev = generator.generateEvent();
      assert.ok(ev.velocity >= 0.25 && ev.velocity <= 0.85);
      assert.ok(ev.duration >= 2.0 && ev.duration <= 7.0);
      assert.ok(ev.freq > 50 && ev.freq < 2000);
    }
  });

  it('modulates rubato interval spread and velocity variance via humanize parameter', () => {
    const generator = new PoissonGenerator({ humanize: 0.85 });
    assert.strictEqual(generator.humanize, 0.85);

    for (let i = 0; i < 100; i++) {
      const ev = generator.generateEvent();
      assert.ok(ev.velocity >= 0.25 && ev.velocity <= 0.85, `Velocity ${ev.velocity} out of bounds`);
      assert.ok(ev.nextInterval >= 0.5 && ev.nextInterval <= 9.0, `Interval ${ev.nextInterval} out of bounds`);
      assert.ok(!Number.isNaN(ev.velocity));
      assert.ok(!Number.isNaN(ev.nextInterval));
    }

    generator.setParameters({ humanize: 0.10 });
    assert.strictEqual(generator.humanize, 0.10);
    const lowHumEvent = generator.generateEvent();
    assert.ok(lowHumEvent.velocity >= 0.25 && lowHumEvent.velocity <= 0.85);
  });
});
