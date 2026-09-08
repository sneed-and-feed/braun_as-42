import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import {
  makeSoftClipCurve,
  makeWavefoldCurve,
  makeTapeSaturationCurve
} from '../js/audio/wavefolder.js';

describe('Wavefolder and Saturation Transfer Curves', () => {
  it('soft clip curve is monotonic, bounded, and odd-symmetric', () => {
    const curve = makeSoftClipCurve(2048, 2.0);
    assert.strictEqual(curve.length, 2048);

    // Center should be approximately 0
    const mid = Math.floor(curve.length / 2);
    assert.ok(Math.abs(curve[mid]) < 0.01);

    // Endpoints bounded in [-1, 1]
    assert.ok(curve[0] >= -1 && curve[0] <= 0);
    assert.ok(curve[curve.length - 1] >= 0 && curve[curve.length - 1] <= 1);

    // Monotonicity check
    for (let i = 1; i < curve.length; i++) {
      assert.ok(curve[i] >= curve[i - 1] - 1e-6);
    }
  });

  it('wavefold curve exhibits folding (non-monotonicity) at high drive/fold', () => {
    const curve = makeWavefoldCurve(2048, 2.5, 0.8);
    assert.strictEqual(curve.length, 2048);

    // Wavefold should have local extrema (peaks and valleys where the wave folds)
    let extremaCount = 0;
    for (let i = 1; i < curve.length - 1; i++) {
      if ((curve[i] > curve[i - 1] && curve[i] > curve[i + 1]) ||
          (curve[i] < curve[i - 1] && curve[i] < curve[i + 1])) {
        extremaCount++;
      }
    }

    assert.ok(extremaCount >= 2, `Wavefolding curve should have folding peaks, found ${extremaCount}`);
  });

  it('tape saturation curve is bounded, smooth, and unity-normalized', () => {
    const curve = makeTapeSaturationCurve(2048, 0.4);
    assert.strictEqual(curve.length, 2048);

    for (let i = 0; i < curve.length; i++) {
      assert.ok(curve[i] >= -1.0 && curve[i] <= 1.0);
      assert.ok(!Number.isNaN(curve[i]));
    }

    // Endpoint unity bounds check
    assert.ok(Math.abs(curve[curve.length - 1] - 1.0) < 1e-4, 'Peak positive saturation should reach unity 1.0');
    assert.ok(curve[0] <= -0.95, 'Peak negative saturation should reach negative unity headroom');

    // Zero-warmth should be perfectly transparent linear response
    const linearCurve = makeTapeSaturationCurve(2048, 0);
    assert.strictEqual(linearCurve.length, 2048);
    assert.ok(Math.abs(linearCurve[0] - (-1.0)) < 1e-5);
    assert.ok(Math.abs(linearCurve[linearCurve.length - 1] - 1.0) < 1e-5);
    const mid = Math.floor(linearCurve.length / 2);
    assert.ok(Math.abs(linearCurve[mid]) < 1e-3);
  });
});
