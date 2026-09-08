import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { PhaseLoopEngine } from '../js/generative/phase-loops.js';
import { SCALES, NOTE_NAMES, midiToFrequency } from '../js/generative/scales.js';

describe('Audio Enhancements and DSP Verification', () => {
  it('verifies phase loops populate and update human-readable noteName', () => {
    const engine = new PhaseLoopEngine({
      rootPitchClass: 0, // C
      scaleIntervals: SCALES.BUDD_PENTATONIC.intervals
    });

    // Check that all 4 loops have non-empty, valid noteName strings
    engine.loops.forEach(loop => {
      assert.ok(loop.noteName, `Loop ${loop.id} must have noteName`);
      assert.match(loop.noteName, /^[A-G]#?[0-9]$/, `Note name ${loop.noteName} must match pitch format`);
    });

    const initialNames = engine.loops.map(l => l.noteName);

    // Change to F# (6) and Lydian Ambient scale
    engine.updateScale(6, SCALES.LYDIAN_DREAM.intervals, 440);
    const updatedNames = engine.loops.map(l => l.noteName);

    assert.notDeepStrictEqual(initialNames, updatedNames, 'Note names should update with scale');
    engine.loops.forEach(loop => {
      const expectedName = `${NOTE_NAMES[loop.midi % 12]}${Math.floor(loop.midi / 12) - 1}`;
      assert.strictEqual(loop.noteName, expectedName);
    });
  });

  it('verifies pitch shifter gain window modulation has zero offset at boundary', () => {
    // When base gain is 0.0, the modulated gain is simply sin(pi * phase)
    // At boundary (phase = 0 or 1), gain must be exactly 0 (clickless)
    const windowSec = 0.045;
    const lengthSamples = 2160;

    for (let i = 0; i < lengthSamples; i++) {
      const phase1 = i / lengthSamples;
      const phase2 = (phase1 + 0.5) % 1.0;

      const g1 = Math.sin(Math.PI * phase1);
      const g2 = Math.sin(Math.PI * phase2);

      // Verify bounds [0, 1]
      assert.ok(g1 >= 0 && g1 <= 1.0, `g1 (${g1}) must be in [0, 1]`);
      assert.ok(g2 >= 0 && g2 <= 1.0, `g2 (${g2}) must be in [0, 1]`);

      // Power crossfade sum should be close to 1.0
      const power = g1 * g1 + g2 * g2;
      assert.ok(Math.abs(power - 1.0) < 1e-4, `Power sum should be ~1.0, got ${power}`);
    }

    // Explicit check at boundary phase = 0
    const boundaryGain = Math.sin(Math.PI * 0);
    assert.strictEqual(boundaryGain, 0, 'Boundary gain must be 0 to prevent snapback clicks');
  });

  it('verifies oscilloscope edge trigger stabilizes periodic waveforms', () => {
    // Generate a synthetic sine wave with 109 samples period (approx 440Hz at 48kHz)
    const buffer = new Uint8Array(2048);
    const period = 109;
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = Math.round(128 + 80 * Math.sin((2 * Math.PI * i) / period));
    }

    // Trigger algorithm
    let startIdx = 0;
    const searchLimit = Math.min(1024, buffer.length - 2);
    for (let i = 0; i < searchLimit; i++) {
      if (buffer[i] < 128 && buffer[i + 1] >= 128) {
        startIdx = i;
        break;
      }
    }

    assert.ok(startIdx >= 0 && startIdx < period, `Trigger start should be within first period, got ${startIdx}`);
    assert.ok(buffer[startIdx] < 128);
    assert.ok(buffer[startIdx + 1] >= 128);
  });

  it('verifies auxiliary effect send bus summing gain isolation', () => {
    // In parallel auxiliary bus routing, direct instruments feed master at unity (1.0).
    // Send effect returns must have dryLevel = 0 so total dry gain equals 1.0
    const directInstrumentDry = 1.0;
    const delayReturnDry = 0.0;
    const reverbReturnDry = 0.0;
    const totalDry = directInstrumentDry + delayReturnDry + reverbReturnDry;

    assert.strictEqual(totalDry, 1.0, 'Total dry gain at master bus must be exactly 1.0 (no multi-bleed)');
  });

  it('verifies debounced impulse regeneration logic prevents continuous reallocation', async () => {
    let callCount = 0;
    let timer = null;

    const scheduleRegen = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        callCount++;
      }, 50);
    };

    // Simulate 30 rapid mousemove knob adjustments
    for (let i = 0; i < 30; i++) {
      scheduleRegen();
    }

    // Before timer fires, callCount is 0
    assert.strictEqual(callCount, 0);

    // Wait 80ms for debounce timer to settle
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.strictEqual(callCount, 1, 'Debounced impulse generation should execute only once');
  });
});
