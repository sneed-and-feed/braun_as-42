/**
 * @file anti-aliasing.js
 * @brief Band-limited Fourier series wavetable generators for Web Audio PeriodicWave.
 * Prevents high-frequency aliasing foldover on saw, square, and triangle waves.
 */

/**
 * Generate Fourier coefficients for a band-limited sawtooth wave
 * @param {number} [numHarmonics=64] - Number of harmonics
 * @returns {{ real: Float32Array, imag: Float32Array }}
 */
export function generateSawCoefficients(numHarmonics = 64) {
  const real = new Float32Array(numHarmonics + 1);
  const imag = new Float32Array(numHarmonics + 1);

  for (let n = 1; n <= numHarmonics; n++) {
    // Lanczos window attenuation to eliminate Gibbs overshoot
    const window = Math.sin((Math.PI * n) / numHarmonics) / ((Math.PI * n) / numHarmonics);
    // Sawtooth Fourier: b_n = - (2 / (n * PI)) * (-1)^n
    imag[n] = -(2 / (n * Math.PI)) * Math.pow(-1, n) * window;
  }

  return { real, imag };
}

/**
 * Generate Fourier coefficients for a band-limited square wave
 * @param {number} [numHarmonics=64] - Number of harmonics
 * @returns {{ real: Float32Array, imag: Float32Array }}
 */
export function generateSquareCoefficients(numHarmonics = 64) {
  const real = new Float32Array(numHarmonics + 1);
  const imag = new Float32Array(numHarmonics + 1);

  for (let n = 1; n <= numHarmonics; n += 2) {
    const window = Math.sin((Math.PI * n) / numHarmonics) / ((Math.PI * n) / numHarmonics);
    // Square Fourier: b_n = 4 / (n * PI) for odd n
    imag[n] = (4 / (n * Math.PI)) * window;
  }

  return { real, imag };
}

/**
 * Generate Fourier coefficients for a band-limited triangle wave
 * @param {number} [numHarmonics=64] - Number of harmonics
 * @returns {{ real: Float32Array, imag: Float32Array }}
 */
export function generateTriangleCoefficients(numHarmonics = 64) {
  const real = new Float32Array(numHarmonics + 1);
  const imag = new Float32Array(numHarmonics + 1);

  for (let n = 1; n <= numHarmonics; n += 2) {
    const k = (n - 1) / 2;
    // Triangle Fourier: b_n = (8 / (PI^2 * n^2)) * (-1)^k
    imag[n] = (8 / (Math.PI * Math.PI * n * n)) * Math.pow(-1, k);
  }

  return { real, imag };
}

/**
 * Generate warm analog discrete core oscillator wave (Elta Solar 42n style)
 * Features subtle even harmonic warmth and soft rounded crests
 * @param {number} [numHarmonics=64]
 * @returns {{ real: Float32Array, imag: Float32Array }}
 */
export function generateWarmAnalogCoefficients(numHarmonics = 64) {
  const real = new Float32Array(numHarmonics + 1);
  const imag = new Float32Array(numHarmonics + 1);

  for (let n = 1; n <= numHarmonics; n++) {
    const window = Math.cos((Math.PI * n) / (2 * numHarmonics));
    // Asymmetric odd/even harmonic ratio
    const amp = (1.0 / Math.pow(n, 1.25)) * window;
    imag[n] = amp * (n % 2 === 0 ? 0.22 : 0.95);
    real[n] = amp * 0.08; // Subtle phase skew
  }

  return { real, imag };
}

/**
 * Cache and create Web Audio PeriodicWave objects on an AudioContext
 * @param {AudioContext} ctx
 * @returns {Record<string, PeriodicWave>}
 */
export function createWavetableCache(ctx) {
  if (!ctx || !ctx.createPeriodicWave) return {};

  const sawCoeffs = generateSawCoefficients(64);
  const squareCoeffs = generateSquareCoefficients(64);
  const triCoeffs = generateTriangleCoefficients(64);
  const warmCoeffs = generateWarmAnalogCoefficients(64);

  const saw = ctx.createPeriodicWave(sawCoeffs.real, sawCoeffs.imag, { disableNormalization: false });
  const square = ctx.createPeriodicWave(squareCoeffs.real, squareCoeffs.imag, { disableNormalization: false });
  const triangle = ctx.createPeriodicWave(triCoeffs.real, triCoeffs.imag, { disableNormalization: false });
  const warm = ctx.createPeriodicWave(warmCoeffs.real, warmCoeffs.imag, { disableNormalization: false });

  return {
    saw,
    sawtooth: saw,
    square,
    sqr: square,
    triangle,
    tri: triangle,
    warm
  };
}
