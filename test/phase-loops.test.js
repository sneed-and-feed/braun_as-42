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

  it('handles zero, negative, and invalid delta values without moving backwards or triggering false events', () => {
    const engine = new PhaseLoopEngine({ loopPeriods: [10.0] });
    engine.loops[0].elapsedSeconds = 5.0;

    let triggeredCount = 0;
    engine.onNoteTrigger = () => { triggeredCount++; };

    engine.step(0);
    assert.strictEqual(engine.loops[0].elapsedSeconds, 5.0);
    assert.strictEqual(triggeredCount, 0);

    engine.step(-1.0);
    assert.strictEqual(engine.loops[0].elapsedSeconds, 5.0);
    assert.strictEqual(triggeredCount, 0);

    engine.step(NaN);
    assert.strictEqual(engine.loops[0].elapsedSeconds, 5.0);
    assert.strictEqual(triggeredCount, 0);
  });

  it('keeps elapsedSeconds and progress bounded over extended run times', () => {
    const engine = new PhaseLoopEngine({ loopPeriods: [13.7] });
    engine.loops[0].elapsedSeconds = 0;

    // Simulate 2 hours of playback (7200 seconds in 16ms steps)
    const dt = 0.016;
    const steps = Math.floor(7200 / dt);
    let triggerCount = 0;
    engine.onNoteTrigger = () => { triggerCount++; };

    for (let i = 0; i < steps; i++) {
      engine.step(dt);
      assert.ok(engine.loops[0].progress >= 0.0 && engine.loops[0].progress <= 1.0);
      assert.ok(Number.isFinite(engine.loops[0].elapsedSeconds));
    }

    // Expected triggers: ~7200 / 13.7 = ~525 triggers
    assert.ok(triggerCount >= 520 && triggerCount <= 530, `Expected ~525 triggers, got ${triggerCount}`);
  });

  it('cleans up animationFrame / timers on stop()', () => {
    const engine = new PhaseLoopEngine();
    let updates = 0;
    engine.start(null, () => { updates++; });
    assert.strictEqual(engine.isRunning, true);

    engine.stop();
    assert.strictEqual(engine.isRunning, false);
    assert.strictEqual(engine.animationFrameId, null);
    assert.strictEqual(engine.lastTimestamp, null);
  });
});
