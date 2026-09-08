import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { PhaseLoopEngine } from '../js/generative/phase-loops.js';
import { SCALES } from '../js/generative/scales.js';

describe('Brian Eno Phase Loop Engine', () => {
  it('initializes asynchronous loops with prime periods', () => {
    const engine = new PhaseLoopEngine();
    assert.strictEqual(engine.loops.length, 4);
    assert.strictEqual(engine.loops[0].periodSeconds, 13.7);
    assert.strictEqual(engine.loops[1].periodSeconds, 17.3);
    assert.strictEqual(engine.loops[2].periodSeconds, 21.1);
    assert.strictEqual(engine.loops[3].periodSeconds, 26.9);
  });

  it('triggers notes on period boundary wrap-around', () => {
    const engine = new PhaseLoopEngine({ loopPeriods: [2.0] });
    engine.loops[0].elapsedSeconds = 1.95;

    let triggered = false;
    engine.onNoteTrigger = (loop, eventData) => {
      triggered = true;
      assert.strictEqual(loop.id, 1);
      assert.ok(eventData.freq > 0);
    };

    // Step by 0.1s: elapsed becomes 2.05, crossing 2.0 boundary
    engine.step(0.1);
    assert.strictEqual(triggered, true);
    assert.ok(engine.loops[0].progress < 0.1);
  });

  it('updates loop pitches when scale changes', () => {
    const engine = new PhaseLoopEngine({
      rootPitchClass: 0,
      scaleIntervals: SCALES.BUDD_PENTATONIC.intervals
    });

    const oldFreqs = engine.loops.map(l => l.freq);

    // Change to F# root (6)
    engine.updateScale(6, SCALES.LYDIAN_DREAM.intervals, 440);
    const newFreqs = engine.loops.map(l => l.freq);

    assert.notDeepStrictEqual(oldFreqs, newFreqs);
  });
});
