/**
 * @file quick-succession-and-voicing.test.js
 * @brief Verification tests for:
 * 1. Rapid note re-triggering & voice stealing de-clicking (no clip-pops).
 * 2. Hammer transient anchoring & graceful cut-off prevention.
 * 3. Polyphonic headroom stability (no gain jitter on steady chords).
 * 4. Drone frequency slewing & voicing crackle prevention (tau = 25ms).
 * 5. Timbre level balancing across felt, sine, saw, square, and CS-80.
 * 6. WAV recording multi-channel safety and sample sanitization.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AudioEngine } from '../js/audio/engine.js';
import { FeltPianoVoice, FeltPianoSynthesizer, TIMBRE_TRIM } from '../js/audio/felt-piano.js';
import { SolarDroneVoice } from '../js/audio/drone-voice.js';

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
    createScriptProcessor: (bufSize, inCh, outCh) => ({
      bufferSize: bufSize,
      numberOfInputs: inCh,
      numberOfOutputs: outCh,
      connect() {},
      disconnect() {}
    }),
    createPeriodicWave: () => ({}),
    destination: { connect() {} },
    resume: async () => {}
  };
}

describe('Rapid Note Re-Triggering & Voice Stealing De-Clicking', () => {
  it('re-uses releasing voice of same pitch to prevent beating oscillator build-up and clicks', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx);

    // Initial note trigger
    synth.playNote(440, 0.8);
    assert.strictEqual(synth.voices.filter(v => v.isActive).length, 1);
    const initialVoice = synth.voices.find(v => v.isActive);
    assert.ok(initialVoice);
    assert.strictEqual(initialVoice.currentFreq, 440);

    // Release note into release phase
    synth.release(440);
    assert.strictEqual(initialVoice.isActive, true);
    assert.strictEqual(initialVoice._isReleased, true);

    // Advance time slightly and re-trigger same pitch in quick succession
    ctx.currentTime = 1.05;
    synth.playNote(440, 0.9);

    // Must re-use initialVoice without allocating an extra voice
    assert.strictEqual(synth.voices.filter(v => v.isActive).length, 1);
    assert.strictEqual(synth.voices.find(v => v.isActive), initialVoice);
    assert.strictEqual(initialVoice._isReleased, false);

    // Verify de-click ramp occurred on voiceGain
    const events = initialVoice.voiceGain.gain.events;
    const linearRamps = events.filter(e => e.type === 'linearRampToValueAtTime');
    assert.ok(linearRamps.some(e => Math.abs(e.v - 0.0001) < 0.00001), 'Voice gain should de-click down to 0.0001 on retrigger');
  });

  it('anchors hammerGain at noteStartTime before attack ramp to prevent clicks', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx);

    ctx.currentTime = 2.0;
    synth.playNote(261.63, 0.85);

    const voice = synth.voices.find(v => v.isActive);
    assert.ok(voice, 'Voice must be active');
    const hammerEvents = voice.hammerGain.gain.events;

    // Check that hammerGain is explicitly anchored at noteStartTime
    const anchor = hammerEvents.find(e => e.type === 'setValueAtTime' && e.t === 2.0);
    assert.ok(anchor, 'Hammer gain must have setValueAtTime at noteStartTime');
    assert.strictEqual(anchor.v, 0.0001);

    // Check linear ramp up to transient peak
    const rampUp = hammerEvents.find(e => e.type === 'linearRampToValueAtTime');
    assert.ok(rampUp, 'Hammer gain must linear ramp up');
    assert.ok(rampUp.t > 2.0, 'Hammer ramp must be scheduled after noteStartTime');
  });

  it('de-clicks stolen voice smoothly when polyphony limit is reached', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx, null, 8); // Pool of 8 voices

    // Play 8 distinct notes to saturate maxPolyphony = 8
    const pitches = [220, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00, 440];
    for (const p of pitches) {
      synth.playNote(p, 0.7);
    }
    assert.strictEqual(synth.voices.filter(v => v.isActive).length, 8);

    // Now play 9th note: must steal oldest voice without a clip-pop
    ctx.currentTime = 3.0;
    synth.playNote(523.25, 0.8);

    assert.strictEqual(synth.voices.filter(v => v.isActive).length, 8);
    const stolenVoice = synth.voices.find(v => v.currentFreq === 523.25);
    assert.ok(stolenVoice, 'New note was assigned a voice');

    const events = stolenVoice.voiceGain.gain.events;
    // Verify linear ramp down to 0.0001 before new note start
    const declickRamps = events.filter(e => e.type === 'linearRampToValueAtTime' && Math.abs(e.v - 0.0001) < 0.00001);
    assert.ok(declickRamps.length >= 1, 'Stolen voice must ramp down to near-zero before retriggering');

    // Verify hammerGain does not have duplicate setValueAtTime collision at noteStartTime when stealing
    const hammerEvents = stolenVoice.hammerGain.gain.events;
    const noteStartTime = 3.005;
    const duplicateSet = hammerEvents.filter(e => e.type === 'setValueAtTime' && Math.abs(e.t - noteStartTime) < 1e-4);
    assert.strictEqual(duplicateSet.length, 0, 'hammerGain must not schedule duplicate setValueAtTime collision at noteStartTime when stealing');
  });

  it('safely de-clicks voice when stolen mid-attack without jumping to 1.0', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx);

    ctx.currentTime = 1.0;
    synth.playNote(440, 0.8);
    const voice = synth.voices.find(v => v.isActive);

    // Voice is mid-attack at 1.003s (attack takes ~8ms)
    ctx.currentTime = 1.003;
    synth.playNote(440, 0.9);

    const gainEvents = voice.voiceGain.gain.events;
    // Ensure no event set gain to 1.0
    const jumpTo1 = gainEvents.find(e => e.type === 'setValueAtTime' && e.t >= 1.003 && e.v >= 1.0);
    assert.strictEqual(jumpTo1, undefined, 'Gain must not jump to 1.0 when interrupted mid-attack');
  });

  it('stabilizes polyphonic headroom calculation and eliminates gain jitter on steady chords', () => {
    const ctx = createDSPMockCtx();
    const synth = new FeltPianoSynthesizer(ctx);

    // 1st note triggers headroom calculation on synth.output.gain
    synth.playNote(261.63, 0.7);
    const events1 = synth.output.gain.events.length;

    // Triggering another note changes active count -> updates headroom
    synth.playNote(329.63, 0.7);
    const events2 = synth.output.gain.events.length;
    assert.ok(events2 > events1, 'Headroom should update when active voice count changes');

    // Calling _updatePolyphonicHeadroom directly when active count is unchanged must early return
    synth._updatePolyphonicHeadroom();
    assert.strictEqual(synth.output.gain.events.length, events2, 'Headroom must NOT schedule duplicate events when target is unchanged');
  });
});

describe('Drone Frequency Slewing & Voicing Crackle Prevention', () => {
  it('slews oscillator frequency exponentially with tau = 25ms instead of abrupt step', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 5.0;
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

    // Initial frequency was set
    assert.ok(drone.oscA.frequency.value > 0);

    // Update frequency across two octaves (e.g. 55 -> 220)
    drone.setFrequency(220, 0.025);

    const oscAEvents = drone.oscA.frequency.events;
    const setTargetEvent = oscAEvents.find(e => e.type === 'setTargetAtTime');
    assert.ok(setTargetEvent, 'oscA frequency must use setTargetAtTime for smooth slewing');
    assert.strictEqual(setTargetEvent.v, 220);
    assert.strictEqual(setTargetEvent.t, 5.0);
    assert.strictEqual(setTargetEvent.tau, 0.025);

    // Check oscB frequency also received smooth slew with subHertzBeat offset
    const oscBEvents = drone.oscB.frequency.events;
    const oscBTarget = oscBEvents.find(e => e.type === 'setTargetAtTime');
    assert.ok(oscBTarget, 'oscB frequency must also use setTargetAtTime');
    assert.strictEqual(oscBTarget.v, 220 + drone.subHertzBeat);
    assert.strictEqual(oscBTarget.tau, 0.025);
  });

  it('slews detune and beating hz smoothly with 25ms time constant', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 6.0;
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

    drone.setDetuneCents(14, 0.025);
    const detuneEvents = drone.oscB.detune.events;
    const detuneTarget = detuneEvents.find(e => e.type === 'setTargetAtTime');
    assert.ok(detuneTarget, 'oscB detune must use setTargetAtTime');
    assert.strictEqual(detuneTarget.tau, 0.025);

    drone.setBeatingHz(2.5, 0.025);
    const beatTarget = drone.oscB.frequency.events.find(e => e.type === 'setTargetAtTime' && e.tau === 0.025);
    assert.ok(beatTarget, 'setBeatingHz must use setTargetAtTime with tau = 0.025');
  });

  it('deduplicates setWavefold calls to prevent recreating wave shaper curves on duplicate settings', () => {
    const ctx = createDSPMockCtx();
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

    drone.setWavefold(1.5, 0.5);
    const initialCurve = drone.shaper.curve;
    assert.ok(initialCurve !== null);

    // Call again with same parameters
    drone.setWavefold(1.5, 0.5);
    assert.strictEqual(drone.shaper.curve, initialCurve, 'Curve reference should remain identical when drive and fold do not change');
  });

  it('passes smooth time constant during drone snap note changes in AudioEngine', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    await engine.init();

    ctx.currentTime = 10.0;
    engine.drone1RootNote = 'A';
    engine.drone1Octave = 2;
    engine.drone1Snap = 'root';
    engine.applyDrone1Snap();

    // oscA in drone1 should have setTargetAtTime with tau = 0.025
    const events = engine.drone1.oscA.frequency.events;
    const snapSlew = events.find(e => e.type === 'setTargetAtTime' && e.tau === 0.025);
    assert.ok(snapSlew, 'Drone 1 snap note change must use smooth slewing with tau = 0.025');

    // filter1 in drone1 should also have smooth cutoff slew
    const filterEvents = engine.drone1.filter1.frequency.events;
    const cutoffSlew = filterEvents.find(e => e.type === 'setTargetAtTime' && e.tau === 0.025);
    assert.ok(cutoffSlew, 'Drone 1 filter cutoff must slew smoothly during snap note changes');
  });

  it('preserves fundamental rootFreq across multiple setSnap calls without compounding octave multiplication', () => {
    const ctx = createDSPMockCtx();
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);
    const initialRoot = drone.rootFreq;
    assert.ok(initialRoot > 0);

    // Snap to warm-root (2x root)
    const freq1 = drone.setSnap('warm-root');
    assert.strictEqual(freq1, initialRoot * 2.0);

    // Calling warm-root again must NOT double again to 4x!
    const freq2 = drone.setSnap('warm-root');
    assert.strictEqual(freq2, initialRoot * 2.0, 'Subsequent setSnap call must calculate from rootFreq without compounding');

    // Calling sub-bass must go to 0.5x root, NOT 0.5 * 2x!
    const freqSub = drone.setSnap('sub-bass');
    assert.strictEqual(freqSub, initialRoot * 0.5, 'sub-bass must be 0.5x rootFreq');

    // Calling deep-tonic restores exact root
    const freqTonic = drone.setSnap('deep-tonic');
    assert.strictEqual(freqTonic, initialRoot, 'deep-tonic must restore initial rootFreq');
  });

  it('supports setDetune alias and setHarmonyRatio relative to root frequency', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 8.0;
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 2);
    const initialRoot = drone.rootFreq;

    // setDetune alias
    drone.setDetune(18, 0.025);
    assert.strictEqual(drone.detuneCents, 18);
    const detuneEvent = drone.oscB.detune.events.find(e => e.type === 'setTargetAtTime' && e.v === 18);
    assert.ok(detuneEvent, 'setDetune must schedule smooth setTargetAtTime');

    // setHarmonyRatio
    const targetFreq = drone.setHarmonyRatio(1.5, 0.025);
    assert.strictEqual(targetFreq, initialRoot * 1.5);
    // Calling again should not multiply by 1.5 * 1.5
    const targetFreq2 = drone.setHarmonyRatio(1.5, 0.025);
    assert.strictEqual(targetFreq2, initialRoot * 1.5, 'setHarmonyRatio must calculate from rootFreq');
  });

  it('slews filter cutoff smoothly with timeConstant and tracks previous cutoff', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 12.0;
    const drone = new SolarDroneVoice(ctx, ctx.destination, null, 1);

    drone.setCutoff(420, 0.025);
    assert.strictEqual(drone.cutoff, 420);

    const fEvents = drone.filter1.frequency.events;
    const slew = fEvents.find(e => e.type === 'setTargetAtTime' && e.v === 420 && e.tau === 0.025);
    assert.ok(slew, 'setCutoff must schedule setTargetAtTime with tau = 0.025');
  });
});

describe('Timbre Level Balancing & Perceived Loudness Trim', () => {
  it('exports calibrated TIMBRE_TRIM constants with proper relative gains', () => {
    assert.ok(TIMBRE_TRIM, 'TIMBRE_TRIM must be exported');
    assert.ok(TIMBRE_TRIM.felt >= 1.4, `felt trim (${TIMBRE_TRIM.felt}) should be >= 1.4 to balance against drone`);
    assert.ok(TIMBRE_TRIM.sine >= 1.5, `sine trim (${TIMBRE_TRIM.sine}) should be >= 1.5 to balance against drone`);
    assert.ok(TIMBRE_TRIM.cs80 <= 0.9, `cs80 trim (${TIMBRE_TRIM.cs80}) should be <= 0.9 to tame harshness`);
    assert.ok(TIMBRE_TRIM.felt > TIMBRE_TRIM.cs80, 'felt must have higher trim than cs80');
    assert.ok(TIMBRE_TRIM.sine > TIMBRE_TRIM.cs80, 'sine must have higher trim than cs80');
  });

  it('routes voice through timbreTrim gain node and updates smoothly on waveform change', () => {
    const ctx = createDSPMockCtx();
    ctx.currentTime = 15.0;
    const synth = new FeltPianoSynthesizer(ctx);

    const voice = synth.voices[0];
    assert.ok(voice.timbreTrim, 'FeltPianoVoice must contain a timbreTrim GainNode');

    // Change waveform to cs80
    synth.setWaveform('cs80');
    const trimEvents = voice.timbreTrim.gain.events;
    const slewEvent = trimEvents.filter(e => e.type === 'setTargetAtTime').pop();
    assert.ok(slewEvent, 'timbreTrim must smoothly slew target gain on waveform change');
    assert.strictEqual(slewEvent.v, TIMBRE_TRIM.cs80);
    assert.strictEqual(slewEvent.tau, 0.025);
  });
});

describe('Lossless WAV Recorder Multi-Channel Safety & Sample Sanitization', () => {
  it('handles multi-channel and mono buffers safely without throwing', async () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);
    await engine.init();

    engine.startRecording();
    assert.strictEqual(engine.isRecording, true);

    // Simulate audio process event with mono buffer
    const monoEvent = {
      inputBuffer: {
        numberOfChannels: 1,
        getChannelData: (ch) => new Float32Array([0.1, -0.2, 0.3])
      }
    };
    assert.doesNotThrow(() => {
      engine.recorderNode.onaudioprocess(monoEvent);
    });

    // Simulate audio process event with stereo buffer
    const stereoEvent = {
      inputBuffer: {
        numberOfChannels: 2,
        getChannelData: (ch) => new Float32Array([ch === 0 ? 0.2 : -0.2, 0.0, 0.1])
      }
    };
    assert.doesNotThrow(() => {
      engine.recorderNode.onaudioprocess(stereoEvent);
    });

    assert.strictEqual(engine.recordedBuffersL.length, 2);
    assert.strictEqual(engine.recordedBuffersR.length, 2);
  });

  it('sanitizes NaN and Infinity samples when encoding WAV blob', () => {
    const ctx = createDSPMockCtx();
    const engine = new AudioEngine(ctx);

    const corruptL = new Float32Array([0.5, NaN, Infinity, -Infinity, -0.5]);
    const corruptR = new Float32Array([NaN, 0.2, -0.2, NaN, 0.0]);

    const blob = engine.encodeWAV(corruptL, corruptR, 48000);
    assert.ok(blob, 'encodeWAV returned a Blob');
    // Buffer length check: 44 bytes header + 5 samples * 2 channels * 2 bytes = 64 bytes
    assert.strictEqual(blob.size, 44 + 5 * 4);
  });
});
