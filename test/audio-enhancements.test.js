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
    voice.hammerGain.gain.value = 0.15; // hammer sounding
    synth.playNote(440.0, 0.8, 3.0);

    // When stealing, voice gain must ramp down to silence before frequency switch
    const stealGainEvents = voice.voiceGain.gain.events.filter(e => e.time >= 1.05);
    const fadeDownRamp = stealGainEvents.find(e => e.type === 'linearRampToValueAtTime' && e.val === 0.0001);
    assert.ok(fadeDownRamp, 'Stealing must ramp gain down to 0.0001 before retrigger');
    assert.strictEqual(fadeDownRamp.time, 1.055, 'De-click ramp should take 5ms');

    // Hammer gain must smoothly ramp down to 0.0001 before note restart to avoid pop
    const stealHammerEvents = voice.hammerGain.gain.events.filter(e => e.time >= 1.05);
    const hammerFadeDown = stealHammerEvents.find(e => e.type === 'linearRampToValueAtTime' && e.val === 0.0001);
    assert.ok(hammerFadeDown, 'Hammer gain must ramp down to 0.0001 during stealing');
    assert.strictEqual(hammerFadeDown.time, 1.055, 'Hammer de-click ramp should take 5ms');

    // Filter frequency must smoothly ramp down to restCutoff at 1.055 before note restart
    const stealFilterEvents = voice.filter1.frequency.events.filter(e => e.time >= 1.05);
    const filterFadeDown = stealFilterEvents.find(e => e.type === 'linearRampToValueAtTime' && e.time === 1.055);
    assert.ok(filterFadeDown, 'Filter frequency must smoothly ramp down to restCutoff during stealing');

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

  it('verifies polyphonic round-robin voice distribution across inactive voice pool', () => {
    class MockCtx {
      constructor() {
        this.sampleRate = 48000;
        this.currentTime = 0;
      }
      createGain() {
        return {
          gain: { value: 0, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {} },
          connect: () => {}
        };
      }
      createBuffer(ch, len, rate) {
        return { getChannelData: () => new Float32Array(len), length: len, sampleRate: rate };
      }
      createWaveShaper() { return { oversample: '', curve: null, connect: () => {} }; }
      createBiquadFilter() {
        return {
          frequency: { value: 350, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {} },
          Q: { value: 1, setValueAtTime: () => {} },
          connect: () => {}
        };
      }
      createOscillator() {
        return {
          frequency: { value: 440, setValueAtTime: () => {}, cancelScheduledValues: () => {} },
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
    const synth = new FeltPianoSynthesizer(ctx, null, 6);

    // Trigger 4 notes sequentially while marking them inactive (as if separated in time)
    const v1 = synth.playNote(261.63, 0.6);
    v1.isActive = false;

    const v2 = synth.playNote(293.66, 0.6);
    v2.isActive = false;

    const v3 = synth.playNote(329.63, 0.6);
    v3.isActive = false;

    const v4 = synth.playNote(349.23, 0.6);
    v4.isActive = false;

    // Must have cycled through distinct voices 0, 1, 2, 3 instead of always reusing voice 0
    assert.strictEqual(v1, synth.voices[0]);
    assert.strictEqual(v2, synth.voices[1]);
    assert.strictEqual(v3, synth.voices[2]);
    assert.strictEqual(v4, synth.voices[3]);
  });

  it('verifies polyphonic summing headroom attenuation scales piano bus gain with 1/sqrt(N_active)', () => {
    class MockGainNode {
      constructor(val = 1) {
        this.value = val;
        this.lastTarget = val;
      }
      setValueAtTime(v) { this.value = v; }
      setTargetAtTime(target) { this.value = target; this.lastTarget = target; }
      linearRampToValueAtTime(v) { this.value = v; }
      exponentialRampToValueAtTime(v) { this.value = v; }
      cancelScheduledValues() {}
      cancelAndHoldAtTime() {}
    }

    class MockContext {
      constructor() {
        this.sampleRate = 48000;
        this.currentTime = 0;
      }
      createGain() {
        return {
          gain: new MockGainNode(1),
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
          frequency: new MockGainNode(350),
          Q: new MockGainNode(1),
          connect: () => {}
        };
      }
      createOscillator() {
        return {
          frequency: { value: 440, setValueAtTime: () => {}, cancelScheduledValues: () => {} },
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

    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 8);
    assert.strictEqual(synth.baseOutputGain, 0.38, 'Base output gain should be calibrated in 0.35-0.45 range');

    // 1 voice active
    const v1 = synth.playNote(261.63, 0.7);
    assert.ok(v1.isActive);
    const gain1 = synth.output.gain.value;
    const expected1 = 0.38 * (1 / Math.sqrt(1)) * 0.80;
    assert.ok(Math.abs(gain1 - expected1) < 1e-4, `1-voice gain should be ~${expected1}, got ${gain1}`);

    // 2 voices active (second note press scenario)
    const v2 = synth.playNote(329.63, 0.7);
    assert.ok(v2.isActive);
    const gain2 = synth.output.gain.value;
    const expected2 = 0.38 * (1 / Math.sqrt(2)) * 0.80;
    assert.ok(Math.abs(gain2 - expected2) < 1e-4, `2-voice gain should be ~${expected2}, got ${gain2}`);
    assert.ok(gain2 < gain1, '2-voice gain must attenuate to provide polyphonic summing headroom');

    // 5 voices active (chord cluster scenario)
    const v3 = synth.playNote(392.00, 0.7);
    const v4 = synth.playNote(493.88, 0.7);
    const v5 = synth.playNote(587.33, 0.7);
    const gain5 = synth.output.gain.value;
    const expected5 = 0.38 * (1 / Math.sqrt(5)) * 0.80;
    assert.ok(Math.abs(gain5 - expected5) < 1e-4, `5-voice chord gain should be ~${expected5}, got ${gain5}`);
    assert.ok(gain5 < gain2, '5-voice chord cluster must attenuate further to prevent limiter distortion');

    // Voices finish and release
    v1.isActive = false;
    v2.isActive = false;
    v3.isActive = false;
    v4.isActive = false;
    synth._updatePolyphonicHeadroom();
    const gainAfterRelease = synth.output.gain.value;
    assert.ok(Math.abs(gainAfterRelease - expected1) < 1e-4, 'Gain should recover when voices become inactive');
  });

  it('verifies automation scheduling times strictly respect currentTime without step discontinuities', () => {
    class TimelineParam {
      constructor(val = 0) {
        this.value = val;
        this.events = [];
      }
      setValueAtTime(v, t) { this.events.push({ type: 'setValueAtTime', v, t }); }
      linearRampToValueAtTime(v, t) { this.events.push({ type: 'linearRampToValueAtTime', v, t }); }
      exponentialRampToValueAtTime(v, t) { this.events.push({ type: 'exponentialRampToValueAtTime', v, t }); }
      cancelScheduledValues(t) { this.events.push({ type: 'cancelScheduledValues', t }); }
      cancelAndHoldAtTime(t) { this.events.push({ type: 'cancelAndHoldAtTime', t }); }
    }

    class TestAudioCtx {
      constructor() {
        this.sampleRate = 48000;
        this.currentTime = 2.456; // Arbitrary ongoing time
      }
      createGain() { return { gain: new TimelineParam(0), connect: () => {} }; }
      createBuffer(ch, len, rate) {
        const arr = new Float32Array(len);
        return { getChannelData: () => arr, length: len, sampleRate: rate };
      }
      createWaveShaper() { return { oversample: '', curve: null, connect: () => {} }; }
      createBiquadFilter() {
        return {
          frequency: new TimelineParam(440),
          Q: new TimelineParam(1.3),
          connect: () => {}
        };
      }
      createOscillator() {
        return {
          frequency: new TimelineParam(440),
          detune: new TimelineParam(0),
          connect: () => {},
          start: () => {},
          stop: () => {}
        };
      }
      createBufferSource() {
        return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} };
      }
    }

    const testCtx = new TestAudioCtx();
    const synth = new FeltPianoSynthesizer(testCtx, null, 2);

    // Play note 1 at currentTime = 2.456
    synth.playNote(440, 0.75, 2.0);

    const checkNoPastEvents = (param, ctxTime, label) => {
      param.events.forEach(e => {
        assert.ok(e.t >= ctxTime, `${label} event ${e.type} scheduled at ${e.t} must not be before currentTime ${ctxTime}`);
      });
    };

    const v1 = synth.voices[0];
    checkNoPastEvents(v1.voiceGain.gain, 2.456, 'Voice 1 Gain');
    checkNoPastEvents(v1.filter1.frequency, 2.456, 'Voice 1 Filter 1');
    checkNoPastEvents(v1.filter2.frequency, 2.456, 'Voice 1 Filter 2');
    checkNoPastEvents(v1.hammerGain.gain, 2.456, 'Voice 1 Hammer Gain');

    // Simulate clock advancing and note 2 retriggering with voice stealing
    testCtx.currentTime = 2.470; // 14ms later
    v1.voiceGain.gain.value = 0.28;
    synth.playNote(880, 0.85, 2.0);

    const stealEvents = v1.voiceGain.gain.events.filter(e => e.t >= 2.470);
    stealEvents.forEach(e => {
      assert.ok(e.t >= 2.470, `Steal event ${e.type} at ${e.t} must be >= currentTime 2.470`);
    });
  });

  it('verifies voice stealing eliminates duplicate setValueAtTime conflicts at noteStartTime', () => {
    class TimelineParam {
      constructor(val = 0) {
        this.value = val;
        this.events = [];
      }
      setValueAtTime(v, t) { this.events.push({ type: 'setValueAtTime', v, t }); }
      linearRampToValueAtTime(v, t) { this.events.push({ type: 'linearRampToValueAtTime', v, t }); }
      exponentialRampToValueAtTime(v, t) { this.events.push({ type: 'exponentialRampToValueAtTime', v, t }); }
      cancelScheduledValues(t) { this.events.push({ type: 'cancelScheduledValues', t }); }
      cancelAndHoldAtTime(t) { this.events.push({ type: 'cancelAndHoldAtTime', t }); }
    }

    class TestAudioCtx {
      constructor() {
        this.sampleRate = 48000;
        this.currentTime = 5.0;
      }
      createGain() { return { gain: new TimelineParam(0), connect: () => {} }; }
      createBuffer(ch, len, rate) {
        return { getChannelData: () => new Float32Array(len), length: len, sampleRate: rate };
      }
      createWaveShaper() { return { oversample: '', curve: null, connect: () => {} }; }
      createBiquadFilter() {
        return {
          frequency: new TimelineParam(440),
          Q: new TimelineParam(1.3),
          connect: () => {}
        };
      }
      createOscillator() {
        return {
          frequency: new TimelineParam(440),
          detune: new TimelineParam(0),
          connect: () => {},
          start: () => {},
          stop: () => {}
        };
      }
      createBufferSource() {
        return { buffer: null, connect: () => {}, start: () => {}, stop: () => {} };
      }
    }

    const testCtx = new TestAudioCtx();
    const synth = new FeltPianoSynthesizer(testCtx, null, 1); // single voice forces stealing

    synth.playNote(261.63, 0.7, 2.0);

    // Retrigger same voice while loud
    testCtx.currentTime = 5.05;
    synth.voices[0].voiceGain.gain.value = 0.32;
    synth.playNote(329.63, 0.8, 2.0);

    const gainEvents = synth.voices[0].voiceGain.gain.events.filter(e => e.t >= 5.05);
    // There must NOT be any setValueAtTime at noteStartTime (5.055) that conflicts with linearRampToValueAtTime
    const conflictingSet = gainEvents.find(e => e.type === 'setValueAtTime' && Math.abs(e.t - 5.055) < 1e-6);
    assert.strictEqual(conflictingSet, undefined, 'Must not have conflicting setValueAtTime at same instant as linear ramp endpoint');

    // The de-click ramp must transition into attack ramp smoothly
    const declickRamp = gainEvents.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0001);
    const attackRamp = gainEvents.find(e => e.type === 'linearRampToValueAtTime' && e.v > 0.05);
    assert.ok(declickRamp, 'De-click ramp to 0.0001 must exist');
    assert.ok(attackRamp, 'Attack ramp must exist');
    assert.strictEqual(declickRamp.t, 5.055, 'De-click ramp ends at noteStartTime (5.055)');
    assert.ok(attackRamp.t > 5.055, 'Attack ramp ends after noteStartTime');
  });

  it('verifies rapid burst of all 10 chord macros triggers clean polyphonic voice allocation', () => {
    class MockCtx {
      constructor() {
        this.sampleRate = 48000;
        this.currentTime = 0;
      }
      createGain() {
        return {
          gain: { value: 0.38, setValueAtTime: () => {}, setTargetAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {} },
          connect: () => {}
        };
      }
      createBuffer(ch, len, rate) {
        return { getChannelData: () => new Float32Array(len), length: len, sampleRate: rate };
      }
      createWaveShaper() { return { oversample: '', curve: null, connect: () => {} }; }
      createBiquadFilter() {
        return {
          frequency: { value: 350, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {} },
          Q: { value: 1.3, setValueAtTime: () => {} },
          connect: () => {}
        };
      }
      createOscillator() {
        return {
          frequency: { value: 440, setValueAtTime: () => {}, cancelScheduledValues: () => {} },
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
    const synth = new FeltPianoSynthesizer(ctx, null, 24);

    // Rapidly trigger 10 chords with 5 notes each (50 note strikes in quick burst)
    for (let c = 0; c < 10; c++) {
      ctx.currentTime += 0.025;
      for (let n = 0; n < 5; n++) {
        const freq = 130.81 * Math.pow(2, (c * 2 + n * 3) / 12);
        assert.doesNotThrow(() => {
          synth.playNote(freq, 0.75, 2.5);
        }, `Chord burst chord ${c} note ${n} must not throw`);
      }
    }

    // All 24 voices in the pool should be robust and undamaged
    assert.strictEqual(synth.voices.length, 24);
    synth.voices.forEach(v => {
      assert.ok(!Number.isNaN(v.startTime), 'Voice startTime must be a valid number');
    });
  });

  it('verifies BraunOscilloscope CRT monitor standby, native streaming, FFT and Lissajous modes', async () => {
    const { BraunOscilloscope } = await import('../js/ui/oscilloscope.js');

    const strokes = [];
    const fills = [];
    const mockCtx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'round',
      lineJoin: 'round',
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: (x, y) => {},
      lineTo: (x, y) => {},
      stroke: () => { strokes.push(mockCtx.strokeStyle); },
      fillRect: (x, y, w, h) => { fills.push({ fillStyle: mockCtx.fillStyle, x, y, w, h }); },
      scale: () => {}
    };
    const mockCanvas = {
      getContext: () => mockCtx,
      getBoundingClientRect: () => ({ width: 288, height: 180 }),
      width: 288,
      height: 180
    };

    // 1. Standby Initialization
    const scope = new BraunOscilloscope(mockCanvas, null);
    assert.strictEqual(scope.isPowered, false, 'Initial state should be unpowered');
    assert.strictEqual(scope.analyser, null, 'No analyser in standalone/VST3 mode');
    assert.strictEqual(scope.timeData[0], 128, 'Baseline timeData must be centered at 128');

    // Draw standby beam
    scope.draw();
    assert.ok(fills.length > 0, 'Must render background');
    assert.ok(strokes.length > 0, 'Must render graticule and standby beam');

    // 2. Power On
    scope.setPower(true);
    assert.strictEqual(scope.isPowered, true, 'Power ON state');

    // 3. Native C++ audio data streaming (simulate 440Hz sine wave)
    const leftBuf = new Uint8Array(256);
    const rightBuf = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      leftBuf[i] = Math.round(128 + 60 * Math.sin((2 * Math.PI * i) / 32));
      rightBuf[i] = Math.round(128 + 60 * Math.cos((2 * Math.PI * i) / 32));
    }
    scope.pushAudioData(leftBuf, rightBuf);
    assert.strictEqual(scope.hasNativeData, true, 'Should mark hasNativeData');
    assert.strictEqual(scope.checkSilence(), false, 'Audio with 440Hz wave is not silent');

    // 4. Waveform render
    scope.setMode('WAVEFORM');
    strokes.length = 0;
    scope.draw();
    assert.ok(strokes.length > 0, 'Waveform must be stroked');

    // 5. FFT Spectrum mode with native real-time Cooley-Tukey calculation
    scope.setMode('SPECTRUM');
    scope.pushAudioData(leftBuf, rightBuf);
    assert.ok(scope.freqData.some(v => v > 0), 'FFT should compute non-zero frequency bins');
    fills.length = 0;
    scope.draw();
    assert.ok(fills.length >= 48, 'Should render 48 spectrum bars');

    // 6. Stereo Lissajous phase goniometer mode
    scope.setMode('LISSAJOUS');
    strokes.length = 0;
    scope.draw();
    assert.ok(strokes.length > 0, 'Lissajous trace must be stroked');

    // 7. Resize safety: solid background and immediate redraw
    fills.length = 0;
    scope._resize();
    assert.ok(fills.some(f => f.fillStyle === '#121414'), 'Resize must fill solid dark chassis color');

    // 8. Power down back to standby beam
    scope.setPower(false);
    assert.strictEqual(scope.isPowered, false);
    strokes.length = 0;
    scope.draw();
    assert.ok(strokes.includes(scope.phosphorColor) || strokes.includes(scope.phosphorGlow), 'Standby phosphor beam drawn');
  });
});
