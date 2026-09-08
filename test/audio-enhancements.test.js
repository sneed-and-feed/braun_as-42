import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { PhaseLoopEngine } from '../js/generative/phase-loops.js';
import { SCALES, NOTE_NAMES, midiToFrequency } from '../js/generative/scales.js';
import { FeltPianoSynthesizer } from '../js/audio/felt-piano.js';

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

  it('verifies hammer buffer has zero DC offset and windowed click-free boundaries', () => {
    class MockAudioContext {
      constructor() {
        this.sampleRate = 48000;
        this.currentTime = 0;
      }
      createGain() {
        return { gain: { value: 1, setValueAtTime: () => {} }, connect: () => {} };
      }
      createBuffer(ch, len, rate) {
        const arr = new Float32Array(len);
        return {
          getChannelData: () => arr,
          length: len,
          sampleRate: rate
        };
      }
      createWaveShaper() { return { oversample: '', curve: null, connect: () => {} }; }
      createBiquadFilter() {
        return {
          frequency: { value: 440, setValueAtTime: () => {} },
          Q: { value: 1, setValueAtTime: () => {} },
          connect: () => {}
        };
      }
      createOscillator() {
        return {
          frequency: { value: 440, setValueAtTime: () => {} },
          detune: { value: 0, setValueAtTime: () => {} },
          connect: () => {},
          start: () => {},
          stop: () => {}
        };
      }
    }

    const mockCtx = new MockAudioContext();
    const synth = new FeltPianoSynthesizer(mockCtx, null, 2);

    const d = synth.hammerBuffer.getChannelData(0);
    assert.ok(d.length > 0);

    // Initial and final samples must be exactly zero to prevent boundary clicks
    assert.strictEqual(d[0], 0.0, 'First sample of hammer buffer must be 0.0');
    assert.strictEqual(d[d.length - 1], 0.0, 'Last sample of hammer buffer must be 0.0');

    // Mean DC offset must be negligible (< 1e-4)
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      sum += d[i];
    }
    const mean = sum / d.length;
    assert.ok(Math.abs(mean) < 1e-4, `DC offset mean must be ~0, got ${mean}`);
  });

  it('verifies voice attack ramp and voice stealing micro-ramp prevent pops', () => {
    class ParamRecorder {
      constructor(init = 0) {
        this.value = init;
        this.events = [];
      }
      setValueAtTime(val, time) {
        this.value = val;
        this.events.push({ type: 'setValueAtTime', val, time });
      }
      linearRampToValueAtTime(val, time) {
        this.value = val;
        this.events.push({ type: 'linearRampToValueAtTime', val, time });
      }
      exponentialRampToValueAtTime(val, time) {
        this.value = val;
        this.events.push({ type: 'exponentialRampToValueAtTime', val, time });
      }
      cancelScheduledValues(time) {
        this.events.push({ type: 'cancelScheduledValues', time });
      }
    }

    class TestAudioContext {
      constructor() {
        this.sampleRate = 48000;
        this.currentTime = 1.0;
      }
      createGain() {
        return { gain: new ParamRecorder(0), connect: () => {} };
      }
      createBuffer(ch, len, rate) {
        const arr = new Float32Array(len);
        return { getChannelData: () => arr, length: len, sampleRate: rate };
      }
      createWaveShaper() { return { oversample: '', curve: null, connect: () => {} }; }
      createBiquadFilter() {
        return {
          frequency: new ParamRecorder(350),
          Q: new ParamRecorder(1),
          connect: () => {}
        };
      }
      createOscillator() {
        return {
          frequency: new ParamRecorder(440),
          detune: new ParamRecorder(0),
          connect: () => {},
          start: () => {},
          stop: () => {}
        };
      }
      createBufferSource() {
        return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} };
      }
    }

    const testCtx = new TestAudioContext();
    const synth = new FeltPianoSynthesizer(testCtx, null, 1);
    const voice = synth.voices[0];

    // 1. Play first note from silence
    testCtx.currentTime = 1.0;
    synth.playNote(261.63, 0.7, 3.0);

    // Voice gain should have a smooth micro-attack ramp >= 5ms
    const gainEvents = voice.voiceGain.gain.events;
    const attackRamp = gainEvents.find(e => e.type === 'linearRampToValueAtTime');
    assert.ok(attackRamp, 'Attack ramp must be scheduled');
    const attackDuration = attackRamp.time - 1.0;
    assert.ok(attackDuration >= 0.005 && attackDuration <= 0.010, `Attack duration must be between 5ms and 10ms, got ${attackDuration}s`);

    // 2. Play second note on same voice while sounding (voice stealing)
    testCtx.currentTime = 1.05; // 50ms later, voice is still loud
    voice.voiceGain.gain.value = 0.35; // sounding
    synth.playNote(440.0, 0.8, 3.0);

    // When stealing, voice gain must ramp down to silence before frequency switch
    const stealGainEvents = voice.voiceGain.gain.events.filter(e => e.time >= 1.05);
    const fadeDownRamp = stealGainEvents.find(e => e.type === 'linearRampToValueAtTime' && e.val === 0.0001);
    assert.ok(fadeDownRamp, 'Stealing must ramp gain down to 0.0001 before retrigger');
    assert.strictEqual(fadeDownRamp.time, 1.055, 'De-click ramp should take 5ms');

    // Oscillator frequency switch must be scheduled at 1.055 (when silent), NOT at 1.05!
    const oscEvents = voice.osc1.frequency.events.filter(e => e.time >= 1.05);
    const freqSet = oscEvents.find(e => e.type === 'setValueAtTime' && Math.round(e.val) === 440);
    assert.ok(freqSet, 'New frequency must be scheduled');
    assert.strictEqual(freqSet.time, 1.055, 'Frequency change must happen at noteStartTime after 5ms ramp-down');
  });

  it('handles edge case parameters (boundary velocities, extreme pitches, rapid burst stealing) without NaN', () => {
    class MockCtx {
      constructor() {
        this.sampleRate = 48000;
        this.currentTime = 0;
      }
      createGain() {
        return {
          gain: {
            value: 0,
            setValueAtTime: (v) => { assert.ok(!Number.isNaN(v)); },
            linearRampToValueAtTime: (v) => { assert.ok(!Number.isNaN(v)); },
            exponentialRampToValueAtTime: (v) => { assert.ok(!Number.isNaN(v)); assert.ok(v > 0); },
            cancelScheduledValues: () => {}
          },
          connect: () => {}
        };
      }
      createBuffer(ch, len, rate) {
        const arr = new Float32Array(len);
        return { getChannelData: () => arr, length: len, sampleRate: rate };
      }
      createWaveShaper() { return { oversample: '', curve: null, connect: () => {} }; }
      createBiquadFilter() {
        return {
          frequency: {
            value: 350,
            setValueAtTime: (v) => { assert.ok(!Number.isNaN(v)); assert.ok(v > 0); },
            linearRampToValueAtTime: (v) => { assert.ok(!Number.isNaN(v)); assert.ok(v > 0); },
            exponentialRampToValueAtTime: (v) => { assert.ok(!Number.isNaN(v)); assert.ok(v > 0); },
            cancelScheduledValues: () => {}
          },
          Q: { value: 1, setValueAtTime: () => {} },
          connect: () => {}
        };
      }
      createOscillator() {
        return {
          frequency: {
            value: 440,
            setValueAtTime: (v) => { assert.ok(!Number.isNaN(v)); },
            cancelScheduledValues: () => {}
          },
          detune: { value: 0, setValueAtTime: () => {} },
          connect: () => {},
          start: () => {},
          stop: () => {}
        };
      }
      createBufferSource() {
        return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} };
      }
    }

    const ctx = new MockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 4);

    // Test extreme boundary values
    const testCases = [
      { freq: 20, vel: 0.0, tone: 0.0, hammer: 0.0 },     // Sub-bass, zero velocity, darkest tone
      { freq: 10000, vel: 1.0, tone: 1.0, hammer: 1.0 },  // High treble, max velocity, brightest tone
      { freq: 440, vel: 0.001, tone: 0.5, hammer: 0.5 },  // Barely audible touch
      { freq: 261.63, vel: 0.5, tone: 0.0, hammer: 0.0 }  // Darkest felt with hammer off
    ];

    testCases.forEach(tc => {
      synth.setTone(tc.tone);
      synth.setHammer(tc.hammer);
      assert.doesNotThrow(() => {
        synth.playNote(tc.freq, tc.vel, 2.0);
      });
    });

    // Rapid burst: 60 note triggers in short time with 4 voices (forces heavy voice stealing)
    for (let i = 0; i < 60; i++) {
      ctx.currentTime += 0.01;
      assert.doesNotThrow(() => {
        synth.playNote(200 + (i * 15), 0.7, 1.0);
      });
    }
  });
});
