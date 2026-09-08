/**
 * @file chord-clusters-and-vector-wash.test.js
 * @brief Verification tests for chord button height & layout symmetry,
 * chord cluster polyphonic headroom, tamed filter resonance, master compressor/limiter calibration,
 * and vector touchpad Y-axis Space & Shimmer Wash (decoupled from delayTime).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioEngine } from '../js/audio/engine.js';
import { FeltPianoVoice, FeltPianoSynthesizer } from '../js/audio/felt-piano.js';
import { BraunVectorPad } from '../js/ui/vector-pad.js';
import { CHORD_VOICINGS, midiToFrequency } from '../js/generative/scales.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock Web Audio Context for DSP assertions
function createDSPMockCtx() {
  class MockAudioParam {
    constructor(val = 0) {
      this.value = val;
      this.events = [];
    }
    setValueAtTime(v, t) {
      this.value = v;
      this.events.push({ type: 'setValueAtTime', v, t });
    }
    linearRampToValueAtTime(v, t) {
      this.value = v;
      this.events.push({ type: 'linearRampToValueAtTime', v, t });
    }
    exponentialRampToValueAtTime(v, t) {
      this.value = v;
      this.events.push({ type: 'exponentialRampToValueAtTime', v, t });
    }
    setTargetAtTime(v, t, tau) {
      this.value = v;
      this.events.push({ type: 'setTargetAtTime', v, t, tau });
    }
    cancelScheduledValues(t) {
      this.events.push({ type: 'cancelScheduledValues', t });
    }
    cancelAndHoldAtTime(t) {
      this.events.push({ type: 'cancelAndHoldAtTime', t });
    }
  }

  return {
    currentTime: 1.0,
    sampleRate: 48000,
    state: 'running',
    createGain: () => ({
      gain: new MockAudioParam(1.0),
      connect() {},
      disconnect() {}
    }),
    createBiquadFilter: () => ({
      type: 'lowpass',
      frequency: new MockAudioParam(440),
      Q: new MockAudioParam(0.707),
      gain: new MockAudioParam(0.0),
      connect() {},
      disconnect() {}
    }),
    createWaveShaper: () => ({
      oversample: '4x',
      curve: null,
      connect() {},
      disconnect() {}
    }),
    createOscillator: () => ({
      frequency: new MockAudioParam(440),
      detune: new MockAudioParam(0),
      connect() {},
      start() {},
      stop() {},
      setPeriodicWave() {}
    }),
    createDelay: (maxDelay = 1.0) => ({
      delayTime: new MockAudioParam(0.1),
      connect() {},
      disconnect() {}
    }),
    createDynamicsCompressor: () => ({
      threshold: new MockAudioParam(-3.0),
      knee: new MockAudioParam(6.0),
      ratio: new MockAudioParam(8.0),
      attack: new MockAudioParam(0.003),
      release: new MockAudioParam(0.060),
      connect() {},
      disconnect() {}
    }),
    createAnalyser: () => ({
      fftSize: 2048,
      smoothingTimeConstant: 0.82,
      connect() {}
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
    }),
    createConvolver: () => ({
      buffer: null,
      connect() {},
      disconnect() {}
    }),
    createChannelSplitter: (n = 2) => ({
      connect() {},
      disconnect() {}
    }),
    createChannelMerger: (n = 2) => ({
      connect() {},
      disconnect() {}
    }),
    createStereoPanner: () => ({
      pan: new MockAudioParam(0),
      connect() {},
      disconnect() {}
    }),
    createPeriodicWave: () => ({}),
    destination: { connect() {} },
    resume: async () => {}
  };
}

describe('Chord Macro Button Height & Vector Pad Layout Symmetry', () => {
  it('verifies style.css specifies 72px chord buttons, 152px matrix, and 152px vector surface box', () => {
    const cssPath = path.resolve(__dirname, '../css/style.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // 1. Chord macros grid height
    assert.ok(
      css.includes('grid-template-rows: repeat(2, 72px)'),
      'Chord macros grid must specify 2 rows of 72px buttons'
    );
    assert.ok(
      css.includes('height: 152px') && css.includes('min-height: 152px'),
      'Chord macros container height must be 152px (2 * 72px + 8px gap)'
    );

    // 2. Chord macro button height
    assert.ok(
      css.includes('.braun-chord-macro-btn {') && css.includes('height: 72px;'),
      'Individual chord macro button height must be 72px'
    );

    // 3. Chord description line clamp and line height
    assert.ok(
      css.includes('-webkit-line-clamp: 3;'),
      'Chord description must allow up to 3 lines without text clipping'
    );
    assert.ok(
      css.includes('line-height: 1.35;'),
      'Chord description must have generous line-height for descenders'
    );

    // 4. Vector surface box symmetry
    assert.ok(
      css.includes('.braun-vector-surface-box {') && css.includes('height: 152px;'),
      'Vector surface box must have 152px height to match chord deck symmetrically'
    );
  });
});

describe('Chord Clusters Headroom & Voice Gain Staging Calibration', () => {
  it('verifies cascaded biquad filters have tamed resonance (Q=0.707) avoiding resonant gain spikes', () => {
    const ctx = createDSPMockCtx();
    const voice = new FeltPianoVoice(ctx, ctx.createGain(), null, null, null, 0);

    assert.strictEqual(voice.filter1.type, 'lowpass');
    assert.strictEqual(voice.filter2.type, 'lowpass');
    assert.strictEqual(voice.filter1.Q.value, 0.707, 'Filter 1 Q must be 0.707 (critically damped)');
    assert.strictEqual(voice.filter2.Q.value, 0.707, 'Filter 2 Q must be 0.707 (critically damped)');
    assert.strictEqual(voice.bodyFilter.Q.value, 1.2, 'Body formant Q must be tamed to 1.2');
    assert.strictEqual(voice.bodyFilter.gain.value, 1.5, 'Body formant gain must be gentle (1.5 dB)');
  });

  it('verifies internal voice oscillator levels and peakGain are calibrated for dense chords', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 12);

    // Test Mid Voice (C4, ~261.63 Hz)
    const midVoice = synth.playNote(261.63, 0.7, 2.0);
    assert.strictEqual(midVoice.osc1Gain.gain.value, 0.48, 'Mid voice osc1Gain must be calibrated to 0.48');
    assert.strictEqual(midVoice.osc2Gain.gain.value, 0.16, 'Mid voice osc2Gain must be calibrated to 0.16');
    const midPeak = midVoice.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime');
    assert.ok(midPeak, 'Must schedule linear ramp to peakGain');
    // Mid peakGain = velocity (0.7) * 0.24 = 0.168
    assert.ok(Math.abs(midPeak.v - (0.7 * 0.24)) < 1e-3, `Mid peakGain must be ~0.168, got ${midPeak.v}`);

    // Test Bass Voice (C2, ~65.4 Hz)
    const bassVoice = synth.playNote(65.4, 0.7, 2.0);
    assert.strictEqual(bassVoice.osc1Gain.gain.value, 0.60, 'Bass voice osc1Gain must be >= 0.60');
    assert.strictEqual(bassVoice.osc2Gain.gain.value, 0.12, 'Bass voice osc2Gain must be 0.12');
    const bassPeak = bassVoice.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime');
    assert.ok(Math.abs(bassPeak.v - (0.7 * 0.28)) < 1e-3, `Bass peakGain must be ~0.196, got ${bassPeak.v}`);

    // Test Treble Voice (C6, ~1046.5 Hz)
    const trebleVoice = synth.playNote(1046.5, 0.7, 2.0);
    assert.strictEqual(trebleVoice.osc1Gain.gain.value, 0.44, 'Treble voice osc1Gain must be 0.44');
    assert.strictEqual(trebleVoice.osc2Gain.gain.value, 0.18, 'Treble voice osc2Gain must be 0.18');
    const treblePeak = trebleVoice.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime');
    assert.ok(Math.abs(treblePeak.v - (0.7 * 0.26)) < 1e-3, `Treble peakGain must be ~0.182, got ${treblePeak.v}`);
  });

  it('verifies 6-voice chord clusters scale polyphonic headroom safely without clipping', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 24);

    // Trigger Lush Bittersweet Minor 11th (6 notes: 1, 5, b7, 9, b10, 11)
    const chord = CHORD_VOICINGS.NOSTALGIA_11TH;
    assert.ok(chord, 'NOSTALGIA_11TH must exist');
    assert.strictEqual(chord.intervals.length, 6, 'Chord must contain exactly 6 notes');

    const rootFreq = midiToFrequency(36, 440); // C2
    const activeVoices = [];
    chord.intervals.forEach(semi => {
      const f = rootFreq * Math.pow(2, semi / 12);
      const v = synth.playNote(f, 0.75, 4.0);
      activeVoices.push(v);
    });

    assert.strictEqual(activeVoices.length, 6, 'All 6 voices must be allocated');
    activeVoices.forEach(v => assert.ok(v.isActive, 'Voice must be active'));

    // Dynamic polyphonic headroom for N=6 active voices:
    // headroom = 1.0 / sqrt(6) ~ 0.40825
    // output gain = baseOutputGain (0.38) * polyHeadroom * volume (0.80) ~ 0.1241
    const expectedOutputGain = 0.38 * (1.0 / Math.sqrt(6)) * 0.80;
    assert.ok(
      Math.abs(synth.output.gain.value - expectedOutputGain) < 1e-3,
      `Output gain must scale to ~${expectedOutputGain.toFixed(4)}, got ${synth.output.gain.value}`
    );

    // Sum of peak gains across all 6 voices multiplied by output gain stays under 0.25 (vast headroom below 1.0 clipping)
    const totalPeak = activeVoices.reduce((sum, v) => {
      const p = v.voiceGain.gain.events.find(e => e.type === 'linearRampToValueAtTime');
      return sum + (p ? p.v : 0.2);
    }, 0);

    const busOutputLevel = totalPeak * synth.output.gain.value;
    assert.ok(
      busOutputLevel < 0.25,
      `Summed chord level at bus (${busOutputLevel.toFixed(4)}) must be well below 0.25 to prevent clipping`
    );
  });
});

describe('Master Engine Bus Routing & Compressor / Limiter Tuning', () => {
  it('verifies engine has pianoBus, calibrated master volume, -3dBFS masterCompressor, and soft limiter', async () => {
    const engine = new AudioEngine();
    const origCtx = globalThis.AudioContext;
    globalThis.AudioContext = class extends (createDSPMockCtx().constructor) {
      constructor() {
        super();
        return createDSPMockCtx();
      }
    };

    try {
      await engine.init();
      assert.ok(engine.isInitialized, 'Engine must be initialized');
      assert.strictEqual(engine.masterVolume, 0.80, 'Master volume default headroom must be calibrated to 0.80');

      // Calibrated pianoBus exists
      assert.ok(engine.pianoBus, 'pianoBus GainNode must exist in audio graph');
      assert.strictEqual(engine.pianoBus.gain.value, 1.0, 'pianoBus gain must be unity');

      // Master Compressor tuning: -3 dBFS threshold, 8:1 ratio, 3ms attack
      assert.ok(engine.masterCompressor, 'masterCompressor must be instantiated');
      assert.strictEqual(engine.masterCompressor.threshold.value, -3.0, 'Compressor threshold must be -3.0 dBFS');
      assert.strictEqual(engine.masterCompressor.ratio.value, 8.0, 'Compressor ratio must be 8:1');
      assert.strictEqual(engine.masterCompressor.attack.value, 0.003, 'Compressor attack must be 3ms (0.003s)');
      assert.strictEqual(engine.masterCompressor.release.value, 0.060, 'Compressor release must be 60ms (0.060s)');

      // Master Limiter soft clipping curve
      assert.ok(engine.masterLimiter, 'masterLimiter must be instantiated');
      assert.strictEqual(engine.masterLimiter.oversample, '4x', 'Limiter must use 4x oversampling');
      assert.ok(engine.masterLimiter.curve instanceof Float32Array, 'Limiter must have Float32Array transfer curve');
    } finally {
      globalThis.AudioContext = origCtx;
    }
  });
});

describe('Vector Touchpad Y-Axis Decoupling & Space / Shimmer Wash', () => {
  it('verifies vector pad Y-axis is decoupled from delayTime to eliminate record scratch crunch', () => {
    let delayTimeModulated = false;
    let paramsSet = {};

    const mockEngine = {
      setFeltTone: (v) => { paramsSet.feltTone = v; },
      setDroneCutoff: () => {},
      setDelayTime: () => { delayTimeModulated = true; },
      setDelayWet: (v) => { paramsSet.delayWet = v; },
      setDelayFeedback: (v) => { paramsSet.delayFeedback = v; },
      setReverbWet: (v) => { paramsSet.reverbWet = v; },
      setReverbShimmer: (v) => { paramsSet.shimmerAmount = v; }
    };

    const mockContainer = {
      innerHTML: '',
      appendChild: () => {},
      querySelector: () => null
    };

    const pad = new BraunVectorPad(mockContainer, { engine: mockEngine });

    // Move to 4 different coordinate positions (including rapid jumps across the pad)
    const testPoints = [
      { x: 0.0, y: 0.0 },
      { x: 1.0, y: 1.0 },
      { x: 0.2, y: 0.8 },
      { x: 0.7, y: 0.4 }
    ];

    testPoints.forEach(pt => {
      pad.setCoordinates(pt.x, pt.y, true);

      // CRITICAL: delayTime must NEVER be called from vector pad
      assert.strictEqual(
        delayTimeModulated,
        false,
        'setDelayTime must NEVER be called by vector pad, preventing Doppler vinyl record scratch crunch'
      );

      // Verify Space & Bloom formulas:
      // Delay wet: 0% to 75%
      const expectedDelayWet = pt.y * 0.75;
      assert.ok(Math.abs(paramsSet.delayWet - expectedDelayWet) < 1e-3);

      // Delay feedback: 0.25 to 0.70
      const expectedFeedback = 0.25 + pt.y * 0.45;
      assert.ok(Math.abs(paramsSet.delayFeedback - expectedFeedback) < 1e-3);

      // Reverb wet: 0% to 85%
      const expectedReverbWet = pt.y * 0.85;
      assert.ok(Math.abs(paramsSet.reverbWet - expectedReverbWet) < 1e-3);

      // Shimmer bloom: 0% to 80%
      const expectedShimmer = pt.y * 0.80;
      assert.ok(Math.abs(paramsSet.shimmerAmount - expectedShimmer) < 1e-3);
    });
  });

  it('verifies vector pad readout displays SPACE and BLOOM percentages on Y-axis', () => {
    let readoutYText = '';
    const mockContainer = {
      innerHTML: '',
      appendChild: () => {},
      querySelector: (sel) => {
        if (sel === '#readout-y') {
          return {
            set textContent(t) { readoutYText = t; },
            get textContent() { return readoutYText; }
          };
        }
        return null;
      }
    };

    const pad = new BraunVectorPad(mockContainer, { engine: null });
    pad.readoutY = {
      set textContent(t) { readoutYText = t; },
      get textContent() { return readoutYText; }
    };
    pad.setCoordinates(0.5, 0.8, false);

    // At Y=0.80: space = 80%, bloom = 80% * 80 = 64%
    assert.strictEqual(readoutYText, 'SPACE 80% · BLOOM 64%');

    pad.setCoordinates(0.5, 0.0, false);
    assert.strictEqual(readoutYText, 'SPACE 0% · BLOOM 0%');

    pad.setCoordinates(0.5, 1.0, false);
    assert.strictEqual(readoutYText, 'SPACE 100% · BLOOM 80%');
  });
});
