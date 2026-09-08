/**
 * @file multisample-blend-and-drones.test.js
 * @brief Unit tests for volume output balancing, multisampled acoustic blend modeling,
 * drone quick-snap tuning buttons, and vector modulation audio smoothing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AudioEngine } from '../js/audio/engine.js';
import { FeltPianoSynthesizer, FeltPianoVoice } from '../js/audio/felt-piano.js';
import { midiToFrequency } from '../js/generative/scales.js';

describe('Volume Output Balancing and Drone Ambient Underbed', () => {
  it('calibrates drone bus gain to sit -6dB to -9dB relative to keys output bus', () => {
    const engine = new AudioEngine();

    const keysBusGain = engine.feltPiano ? engine.feltPiano.baseOutputGain * engine.feltParams.volume : 0.38 * 0.80;
    const droneVoiceLevel = engine.droneParams[1].vol; // 0.55
    const droneBusGain = engine.droneBusGain; // 0.22

    const combinedDroneLevel = droneBusGain * droneVoiceLevel;
    const dbRatio = 20 * Math.log10(combinedDroneLevel / keysBusGain);

    assert.ok(dbRatio <= -6.0, `Drone level must sit at least -6dB below keys, got ${dbRatio.toFixed(2)} dB`);
    assert.ok(dbRatio >= -9.5, `Drone level should not be quieter than -9.5dB, got ${dbRatio.toFixed(2)} dB`);
  });

  it('verifies default drone parameters maintain calm, warm background levels without overpowering chords', () => {
    const engine = new AudioEngine();
    assert.strictEqual(engine.droneParams[1].vol, 0.55);
    assert.strictEqual(engine.droneParams[2].vol, 0.55);
    assert.strictEqual(engine.droneBusGain, 0.22);
  });
});

describe('Multisampled / Acoustic Blend Modeling (Teenage Engineering EP-1320 Style)', () => {
  // Mock Web Audio Context
  function createMockCtx() {
    return {
      currentTime: 0.1,
      sampleRate: 48000,
      createGain: () => ({
        gain: {
          value: 1.0,
          setValueAtTime(v) { this.value = v; },
          linearRampToValueAtTime(v) { this.value = v; },
          exponentialRampToValueAtTime(v) { this.value = v; },
          setTargetAtTime(v) { this.value = v; },
          cancelScheduledValues() {},
          cancelAndHoldAtTime() {}
        },
        connect() {}
      }),
      createBiquadFilter: () => ({
        type: 'lowpass',
        frequency: {
          value: 440,
          setValueAtTime(v) { this.value = v; },
          linearRampToValueAtTime(v) { this.value = v; },
          exponentialRampToValueAtTime(v) { this.value = v; },
          setTargetAtTime(v) { this.value = v; },
          cancelScheduledValues() {},
          cancelAndHoldAtTime() {}
        },
        Q: {
          value: 1.0,
          setValueAtTime(v) { this.value = v; },
          setTargetAtTime(v) { this.value = v; }
        },
        gain: {
          value: 0.0,
          setValueAtTime(v) { this.value = v; }
        },
        connect() {}
      }),
      createWaveShaper: () => ({
        oversample: '4x',
        curve: null,
        connect() {}
      }),
      createOscillator: () => ({
        frequency: {
          value: 440,
          setValueAtTime(v) { this.value = v; },
          setTargetAtTime(v) { this.value = v; },
          cancelScheduledValues() {}
        },
        detune: {
          value: 0,
          setValueAtTime(v) { this.value = v; },
          cancelScheduledValues() {}
        },
        connect() {},
        start() {},
        stop() {},
        setPeriodicWave() {}
      }),
      createBuffer: (channels, length, rate) => ({
        length,
        sampleRate: rate,
        getChannelData: () => new Float32Array(length)
      }),
      createBufferSource: () => ({
        buffer: null,
        connect() {},
        start() {},
        stop() {}
      })
    };
  }

  it('verifies register-dependent acoustic character across Bass, Mid, and Treble ranges', () => {
    const ctx = createMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 6);

    // 1. Bass Note: C2 (MIDI 36, ~65.4 Hz)
    const bassVoice = synth.playNote(midiToFrequency(36, 440), 0.7);
    assert.strictEqual(bassVoice.currentMidi, 36);
    assert.ok(bassVoice.currentMidi < 48, 'C2 is in bass register');
    // Bass has deep hammer cutoff (<= 220 Hz)
    assert.ok(bassVoice.hammerFilter.frequency.value <= 220, `Bass hammer cutoff must be <= 220 Hz, got ${bassVoice.hammerFilter.frequency.value}`);
    // Bass body formant in low soundboard range
    assert.ok(bassVoice.bodyFilter.frequency.value >= 280 && bassVoice.bodyFilter.frequency.value <= 420);
    // Bass fundamental reinforcement
    assert.ok(bassVoice.osc1Gain.gain.value >= 0.60, 'Bass voice must reinforce fundamental sub-weight');

    // 2. Mid Note: C4 (MIDI 60, ~261.63 Hz)
    const midVoice = synth.playNote(midiToFrequency(60, 440), 0.7);
    assert.strictEqual(midVoice.currentMidi, 60);
    assert.ok(midVoice.currentMidi >= 48 && midVoice.currentMidi < 72, 'C4 is in mid register');
    // Mid spruce soundboard body formant peak around 480-610 Hz
    assert.ok(midVoice.bodyFilter.frequency.value >= 480 && midVoice.bodyFilter.frequency.value <= 620, `Mid body formant should be ~540 Hz, got ${midVoice.bodyFilter.frequency.value}`);

    // 3. Treble Note: C6 (MIDI 84, ~1046.5 Hz)
    const trebleVoice = synth.playNote(midiToFrequency(84, 440), 0.7);
    assert.strictEqual(trebleVoice.currentMidi, 84);
    assert.ok(trebleVoice.currentMidi >= 72, 'C6 is in treble register');
    // Treble has percussive chime hammer cutoff (>= 550 Hz)
    assert.ok(trebleVoice.hammerFilter.frequency.value >= 550, `Treble hammer cutoff must be >= 550 Hz, got ${trebleVoice.hammerFilter.frequency.value}`);
    // Treble filter has brighter rest cutoff
    assert.ok(trebleVoice.filter1.frequency.value >= 1000, 'Treble note must have bright crystalline presence');
  });

  it('verifies natural voice micro-dispersion in cents across voice pool so chords blend acoustically', () => {
    const ctx = createMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 12);

    const dispersionValues = synth.voices.map(v => v.dispersionOffset);
    const uniqueValues = new Set(dispersionValues);

    // Ensure all voices have micro-tuning variation
    assert.ok(uniqueValues.size >= 10, 'Voices must have distinct acoustic dispersion offsets');

    // Verify dispersion stays within subtle microtonal musical bounds (±2.5 cents)
    dispersionValues.forEach((cents, idx) => {
      assert.ok(Math.abs(cents) <= 2.5, `Voice ${idx} detuning (${cents}c) must stay within subtle acoustic range`);
    });

    // Check overtone spreads
    const overtoneSpreads = synth.voices.map(v => v.overtoneSpread);
    overtoneSpreads.forEach(spread => {
      assert.ok(spread >= 1.4 && spread <= 2.6, 'Overtone spread must be within 1.4-2.6 cents');
    });
  });

  it('verifies real-time setTone smoothly modulates active sounding voices', () => {
    const ctx = createMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 4);

    const v1 = synth.playNote(261.63, 0.7);
    assert.ok(v1.isActive);

    // Calling setTone should modulate active voice's lowpass filter
    synth.setTone(0.95);
    assert.strictEqual(synth.params.tone, 0.95);
    assert.ok(v1.filter1.frequency.value > 100);
  });
});

describe('Solar 42n Drone Quick-Snap Tuning Presets', () => {
  it('correctly sets Voice 1 tonic snap presets (Sub Bass, Deep Tonic, Warm Root, Octave Up)', () => {
    const engine = new AudioEngine();

    // 1. Sub Bass (C1, MIDI 24 ~ 32.70 Hz)
    const fSub = engine.setDroneSnap(1, 'sub-bass');
    assert.strictEqual(engine.droneSnap[1], 'sub-bass');
    assert.ok(Math.abs(fSub - 32.70) < 0.2, `Sub Bass should be ~32.70 Hz, got ${fSub}`);

    // 2. Deep Tonic (C2, MIDI 36 ~ 65.41 Hz)
    const fDeep = engine.setDroneSnap(1, 'deep-tonic');
    assert.strictEqual(engine.droneSnap[1], 'deep-tonic');
    assert.ok(Math.abs(fDeep - 65.41) < 0.2, `Deep Tonic should be ~65.41 Hz, got ${fDeep}`);

    // 3. Warm Root (C3, MIDI 48 ~ 130.81 Hz)
    const fWarm = engine.setDroneSnap(1, 'warm-root');
    assert.strictEqual(engine.droneSnap[1], 'warm-root');
    assert.ok(Math.abs(fWarm - 130.81) < 0.2, `Warm Root should be ~130.81 Hz, got ${fWarm}`);

    // 4. Octave Up (C4, MIDI 60 ~ 261.63 Hz)
    const fOct = engine.setDroneSnap(1, 'octave-up');
    assert.strictEqual(engine.droneSnap[1], 'octave-up');
    assert.ok(Math.abs(fOct - 261.63) < 0.2, `Octave Up should be ~261.63 Hz, got ${fOct}`);
  });

  it('correctly sets Voice 2 harmonic ratio presets (Perfect 5th, Sus 4th, Major 9th, Beating Unison)', () => {
    const engine = new AudioEngine();
    engine.setDroneSnap(1, 'deep-tonic'); // 65.41 Hz
    const f1 = engine.drone1Freq;

    // 1. Perfect 5th (3:2 ratio = 1.5x)
    const f5th = engine.setDroneSnap(2, 'perfect-5th');
    assert.strictEqual(engine.droneSnap[2], 'perfect-5th');
    assert.ok(Math.abs(f5th - (f1 * 1.5)) < 1e-4, 'Perfect 5th must be exact 3:2 ratio');

    // 2. Sus 4th (4:3 ratio)
    const f4th = engine.setDroneSnap(2, 'sus-4th');
    assert.strictEqual(engine.droneSnap[2], 'sus-4th');
    assert.ok(Math.abs(f4th - (f1 * 4 / 3)) < 1e-4, 'Sus 4th must be exact 4:3 ratio');

    // 3. Major 9th (9:8 ratio)
    const f9th = engine.setDroneSnap(2, 'major-9th');
    assert.strictEqual(engine.droneSnap[2], 'major-9th');
    assert.ok(Math.abs(f9th - (f1 * 9 / 8)) < 1e-4, 'Major 9th must be exact 9:8 ratio');

    // 4. Beating Unison (1:1 with ~0.35 Hz beat offset)
    const fUni = engine.setDroneSnap(2, 'beating-unison');
    assert.strictEqual(engine.droneSnap[2], 'beating-unison');
    assert.ok(Math.abs(fUni - f1) < 1e-4, 'Beating Unison must match Voice 1 fundamental');
    assert.ok(Math.abs(engine.droneParams[2].beat - 0.35) < 1e-4, 'Beating unison must set ~0.35 Hz offset');
  });

  it('automatically preserves harmonic ratios when modal scale root or pitch reference changes', () => {
    const engine = new AudioEngine();
    engine.setDroneSnap(1, 'sub-bass'); // Sub bass
    engine.setDroneSnap(2, 'perfect-5th'); // 3:2

    // Change root from C (0) to D (2)
    engine.setScale('BUDD_PENTATONIC', 2);
    // D1 is MIDI 26 (~36.71 Hz)
    assert.strictEqual(engine.droneSnap[1], 'sub-bass');
    assert.strictEqual(engine.droneSnap[2], 'perfect-5th');
    assert.ok(Math.abs(engine.drone1Freq - midiToFrequency(26, 440)) < 0.1);
    assert.ok(Math.abs(engine.drone2Freq - (engine.drone1Freq * 1.5)) < 1e-4);

    // Switch to 432 Hz Verdi tuning reference
    engine.setTuningReference(432);
    assert.strictEqual(engine.a4, 432);
    assert.ok(Math.abs(engine.drone1Freq - midiToFrequency(26, 432)) < 0.1);
    assert.ok(Math.abs(engine.drone2Freq - (engine.drone1Freq * 1.5)) < 1e-4);
  });
});
