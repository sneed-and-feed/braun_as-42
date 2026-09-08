/**
 * @file wavefolder.js
 * @brief Analog wavefolder, soft clipping, and tape saturation transfer functions
 * for Elta Solar 42n drone voices and tape delay emulation.
 */

/**
 * Smooth Hermite soft-knee boundary shaping.
 * Ensures the derivative smoothly glides to 0.0 at +/-1.0, eliminating
 * slope-discontinuity clipping and crackle when Web Audio clamps signals at +/-1.0.
 * @param {number} y - Input value in [-1, 1]
 * @param {number} [knee=0.70] - Threshold where soft knee engages
 * @returns {number}
 */
function applySmoothBoundaryKnee(y, knee = 0.70) {
  if (y > knee) {
    const u = (y - knee) / (1 - knee);
    return knee + (1 - knee) * (u + u * u - u * u * u);
  } else if (y < -knee) {
    const absY = -y;
    const u = (absY - knee) / (1 - knee);
    return -(knee + (1 - knee) * (u + u * u - u * u * u));
  }
  return y;
}

/**
 * Generate a soft-clipping tanh transfer curve with C1-smooth boundary knee
 * @param {number} [samples=2048] - Curve sample resolution
 * @param {number} [drive=1.5] - Input overdrive factor
 * @returns {Float32Array}
 */
export function makeSoftClipCurve(samples = 2048, drive = 1.5) {
  const curve = new Float32Array(samples);
  const half = (samples - 1) / 2;
  const norm = Math.tanh(drive);

  for (let i = 0; i < samples; i++) {
    const x = (i - half) / half; // -1 to +1
    // Hyperbolic tangent soft saturation smoothly normalized to unity bounds
    const raw = Math.tanh(drive * x) / norm;
    // Apply C1 smooth boundary knee so derivative at +/-1.0 is exactly 0
    curve[i] = applySmoothBoundaryKnee(raw, 0.70);
  }

  return curve;
}

/**
 * Generate a West-Coast analog wavefolding transfer curve (Solar 42n style)
 * Folds signal peaks inward to generate complex harmonic overtones from simple sines.
 * @param {number} [samples=2048]
 * @param {number} [drive=1.8] - Drive gain
 * @param {number} [fold=0.6] - Wavefolding depth (0.0 = clean, 1.0 = deep multi-fold)
 * @returns {Float32Array}
 */
export function makeWavefoldCurve(samples = 2048, drive = 1.8, fold = 0.6) {
  const curve = new Float32Array(samples);
  const half = (samples - 1) / 2;

  for (let i = 0; i < samples; i++) {
    const x = (i - half) / half; // -1.0 to +1.0
    const driven = x * drive;

    // Folding formula combining sinusoidal inversion and second-stage fold
    const stage1 = Math.sin(Math.PI * 0.5 * driven);
    const stage2 = stage1 - fold * Math.sin(Math.PI * 1.5 * driven);

    // Soft limiting to guarantee no harsh clipping outside [-1, +1]
    const clamped = Math.tanh(stage2);
    curve[i] = clamped;
  }

  return curve;
}

/**
 * Generate an analog tape saturation transfer curve
 * Features soft tape compression, asymmetrical warm bias, and high-level soft saturation
 * with C1-smooth boundary headroom to prevent flat-topping pops in feedback loops.
 * @param {number} [samples=2048]
 * @param {number} [warmth=0.35]
 * @returns {Float32Array}
 */
export function makeTapeSaturationCurve(samples = 2048, warmth = 0.35) {
  const curve = new Float32Array(samples);
  const half = (samples - 1) / 2;

  // Transparent linear response at zero warmth
  if (warmth <= 0.001) {
    for (let i = 0; i < samples; i++) {
      curve[i] = (i - half) / half;
    }
    return curve;
  }

  // Pre-calculate endpoint normalization factor so peak headroom is preserved at +/-1.0
  const posDrive = 1.0 + warmth * 1.5;
  const asymPos = 1.0 + warmth * 0.25;
  const maxOut = (2 / Math.PI) * Math.atan(posDrive * asymPos);

  for (let i = 0; i < samples; i++) {
    const x = (i - half) / half; // -1 to +1
    // Tape magnetic hysteresis simulation with asymmetrical 2nd harmonic warmth
    const asym = x + warmth * 0.25 * x * x * Math.sign(x);
    // Soft saturation knee with drive scaling
    const saturated = (2 / Math.PI) * Math.atan(posDrive * asym);
    // Normalized to unity peak bounds
    const normalized = Math.max(-1, Math.min(1, saturated / maxOut));
    // Apply C1 smooth boundary knee so derivative at +/-1.0 is 0, eliminating flat-top clicks
    curve[i] = applySmoothBoundaryKnee(normalized, 0.72);
  }

  return curve;
}
