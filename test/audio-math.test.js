import { test, describe, it } from 'node:test';
import assert from 'node:assert';

describe('Audio DSP Calculations and Pitch Shift Math', () => {
  it('calculates cents to frequency ratio', () => {
    const centsToRatio = (cents) => Math.pow(2, cents / 1200);
    // +1200 cents = 1 octave = 2.0x
    assert.strictEqual(centsToRatio(1200), 2.0);
    // 0 cents = 1.0x
    assert.strictEqual(centsToRatio(0), 1.0);
    // -1200 cents = 0.5x
    assert.strictEqual(centsToRatio(-1200), 0.5);
    // +100 cents (1 semitone) ~ 1.05946
    assert.strictEqual(centsToRatio(100).toFixed(5), '1.05946');
  });

  it('calculates octave-up pitch-shifter delay ramp period and window offsets', () => {
    // Pitch shift ratio r = 2.0 (+1 octave)
    // Delay window W = 50ms (0.050s)
    // Period T = W / (r - 1) = 0.050 / (2.0 - 1.0) = 0.050s (20 Hz)
    const W = 0.050;
    const r = 2.0;
    const T = W / (r - 1.0);
    assert.strictEqual(T, 0.050);

    // Verify window crossfade power sum: sin^2(theta) + sin^2(theta + pi/2) = 1.0
    for (let theta = 0; theta <= Math.PI; theta += 0.1) {
      const g1 = Math.sin(theta);
      const g2 = Math.cos(theta);
      const power = g1 * g1 + g2 * g2;
      assert.ok(Math.abs(power - 1.0) < 1e-6);
    }
  });

  it('calculates exponential reverb damping coefficient', () => {
    const decaySeconds = 6.0;
    const sampleRate = 48000;
    const totalSamples = decaySeconds * sampleRate;

    // RT60 means decay by -60dB, i.e., amplitude drops to 0.001 (10^-3)
    const decayFactor = Math.pow(0.001, 1.0 / totalSamples);

    let amp = 1.0;
    for (let i = 0; i < totalSamples; i++) {
      amp *= decayFactor;
    }

    assert.ok(Math.abs(amp - 0.001) < 1e-5);
  });

  it('verifies WAV RIFF structure and sample count calculations', () => {
    const numSamples = 1000;
    const numChannels = 2;
    const bytesPerSample = 2;
    const dataSize = numSamples * numChannels * bytesPerSample;
    const totalFileSize = 44 + dataSize;

    assert.strictEqual(totalFileSize, 4044);
    assert.strictEqual(dataSize, 4000);
  });
});
