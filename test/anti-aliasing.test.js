import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateSawCoefficients,
  generateSquareCoefficients,
  generateTriangleCoefficients,
  generateWarmAnalogCoefficients,
  generateFeltCoefficients
} from '../js/audio/anti-aliasing.js';

describe('Anti-Aliased Wavetable Synthesis', () => {
  it('generates saw coefficients with correct DC offset and fundamental', () => {
    const { real, imag } = generateSawCoefficients(64);
    assert.strictEqual(real.length, 65);
    assert.strictEqual(imag.length, 65);
    assert.strictEqual(real[0], 0); // No DC offset
    assert.strictEqual(imag[0], 0);
    // Fundamental imag[1] should be positive and non-zero
    assert.ok(Math.abs(imag[1]) > 0.5);
    // Higher harmonics should decay (64th harmonic much smaller than 1st)
    assert.ok(Math.abs(imag[64]) < Math.abs(imag[1]) * 0.05);
  });

  it('generates square wave coefficients with zero even harmonics', () => {
    const { real, imag } = generateSquareCoefficients(64);
    assert.strictEqual(imag[0], 0);
    assert.strictEqual(imag[2], 0);
    assert.strictEqual(imag[4], 0);
    assert.strictEqual(imag[6], 0);
    // Odd harmonics present
    assert.ok(imag[1] > 0);
    assert.ok(imag[3] > 0);
    assert.ok(imag[5] > 0);
  });

  it('generates triangle wave coefficients with inverse square decay', () => {
    const { real, imag } = generateTriangleCoefficients(64);
    assert.strictEqual(imag[2], 0); // Even harmonic is zero
    assert.ok(imag[1] > 0);
    // 3rd harmonic of triangle is ~ 1/9 of fundamental
    const ratio = Math.abs(imag[3] / imag[1]);
    assert.ok(ratio > 0.08 && ratio < 0.14, `Ratio should be ~1/9, got ${ratio}`);
  });

  it('generates warm analog coefficients with even harmonic presence', () => {
    const { real, imag } = generateWarmAnalogCoefficients(64);
    // 2nd harmonic should be non-zero for warm analog color
    assert.ok(imag[2] > 0);
  });

  it('generates felt piano coefficients with rich fundamental and octave harmonics', () => {
    const { real, imag } = generateFeltCoefficients(64);
    assert.strictEqual(real.length, 65);
    assert.strictEqual(imag.length, 65);
    assert.strictEqual(real[0], 0); // Zero DC offset
    assert.strictEqual(imag[0], 0);
    // Fundamental present
    assert.ok(imag[1] > 0.8);
    // 2nd harmonic present (~0.58 scaled with Lanczos)
    assert.ok(imag[2] > 0.50);
    // 3rd harmonic present (~0.28)
    assert.ok(imag[3] > 0.20);
    // Harmonics beyond 5th are zero
    assert.strictEqual(imag[6], 0);
    assert.strictEqual(imag[64], 0);
  });
});
