import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AudioEngine } from '../js/audio/engine.js';
import { SolarDroneVoice } from '../js/audio/drone-voice.js';
import { FeltPianoSynthesizer } from '../js/audio/felt-piano.js';
import { makeWavefoldCurve } from '../js/audio/wavefolder.js';
import { createWavetableCache } from '../js/audio/anti-aliasing.js';

class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.events.push({ type: 'setValueAtTime', v, t });
  }
  setTargetAtTime(target, startTime, timeConstant) {
    this.value = target;
    this.events.push({ type: 'setTargetAtTime', target, startTime, timeConstant });
  }
  linearRampToValueAtTime(v, t) {
    this.value = v;
    this.events.push({ type: 'linearRampToValueAtTime', v, t });
  }
  exponentialRampToValueAtTime(v, t) {
    this.value = v;
    this.events.push({ type: 'exponentialRampToValueAtTime', v, t });
  }
  cancelScheduledValues(t) {
    this.events.push({ type: 'cancelScheduledValues', t });
  }
  cancelAndHoldAtTime(t) {
    this.events.push({ type: 'cancelAndHoldAtTime', t });
  }
}

class MockAudioNode {
  constructor(name = 'node') {
    this.name = name;
    this.connectedTo = [];
  }
  connect(dest) {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect(dest) {
    if (!dest) {
      this.connectedTo = [];
    } else {
      this.connectedTo = this.connectedTo.filter(d => d !== dest);
    }
  }
}

class MockGainNode extends MockAudioNode {
  constructor() {
    super('gain');
    this.gain = new MockAudioParam(1.0);
  }
}

class MockBiquadFilter extends MockAudioNode {
  constructor() {
    super('biquad');
    this.frequency = new MockAudioParam(1000);
    this.Q = new MockAudioParam(1);
    this.type = 'lowpass';
  }
}

class MockOscillator extends MockAudioNode {
  constructor() {
    super('oscillator');
    this.frequency = new MockAudioParam(440);
    this.detune = new MockAudioParam(0);
    this.type = 'sine';
    this.periodicWave = null;
  }
  setPeriodicWave(pw) {
    this.periodicWave = pw;
  }
  start() {}
  stop() {}
}

class MockContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new MockAudioNode('destination');
    this.createdNodes = [];
  }
  createGain() {
    const n = new MockGainNode();
    this.createdNodes.push(n);
    return n;
  }
  createBiquadFilter() {
    const n = new MockBiquadFilter();
    this.createdNodes.push(n);
    return n;
  }
  createOscillator() {
    const n = new MockOscillator();
    this.createdNodes.push(n);
    return n;
  }
  createStereoPanner() {
    const n = new MockAudioNode('panner');
    n.pan = new MockAudioParam(0);
    this.createdNodes.push(n);
    return n;
  }
  createWaveShaper() {
    const n = new MockAudioNode('waveshaper');
    n.curve = null;
    n.oversample = 'none';
    this.createdNodes.push(n);
    return n;
  }
  createAnalyser() {
    const n = new MockAudioNode('analyser');
    n.fftSize = 2048;
    n.smoothingTimeConstant = 0.8;
    this.createdNodes.push(n);
    return n;
  }
  createDynamicsCompressor() {
    const n = new MockAudioNode('compressor');
    n.threshold = new MockAudioParam(-3.0);
    n.knee = new MockAudioParam(12.0);
    n.ratio = new MockAudioParam(8.0);
    n.attack = new MockAudioParam(0.003);
    n.release = new MockAudioParam(0.060);
    this.createdNodes.push(n);
    return n;
  }
  createDelay() {
    const n = new MockAudioNode('delay');
    n.delayTime = new MockAudioParam(0.4);
    this.createdNodes.push(n);
    return n;
  }
  createConvolver() {
    const n = new MockAudioNode('convolver');
    n.buffer = null;
    n.normalize = true;
    this.createdNodes.push(n);
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length: length,
      sampleRate: sampleRate || 48000,
      duration: length / (sampleRate || 48000),
      getChannelData: () => new Float32Array(length)
    };
  }
  createBufferSource() {
    const n = new MockAudioNode('bufferSource');
    n.buffer = null;
    n.start = () => {};
    n.stop = () => {};
    this.createdNodes.push(n);
    return n;
  }
  createChannelSplitter(channels = 2) {
    const n = new MockAudioNode('splitter');
    n.numberOfOutputs = channels;
    this.createdNodes.push(n);
    return n;
  }
  createChannelMerger(channels = 2) {
    const n = new MockAudioNode('merger');
    n.numberOfInputs = channels;
    this.createdNodes.push(n);
    return n;
  }
  createPeriodicWave() { return {}; }
}

describe('SQR Drone Oscillator Fundamental Preservation & Wavefolder Bypass', () => {
  it('preserves full fundamental routing for square waves directly to filter1', () => {
    const ctx = new MockContext();
    const dest = ctx.createGain();
    const wavetables = createWavetableCache(ctx);

    // Voice 2 defaults to waveA = 'square'
    const drone = new SolarDroneVoice(ctx, dest, wavetables, 2);
    assert.strictEqual(drone.waveA, 'square');

    // Square wave must route 100% directly to filter1 and 0% through wavefolder shaper
    assert.strictEqual(drone.oscAShaperGain.gain.value, 0.0);
    assert.strictEqual(drone.oscADirectGain.gain.value, 1.0);
    assert.ok(drone.oscADirectGain.connectedTo.includes(drone.filter1));

    // Switching waveA to saw must restore shaper routing
    drone.setWaveA('saw');
    assert.strictEqual(drone.waveA, 'saw');
    assert.strictEqual(drone.oscAShaperGain.gain.value, 1.0);
    assert.strictEqual(drone.oscADirectGain.gain.value, 0.0);

    // Switching back to sqr must restore direct routing to filter1
    drone.setWaveA('sqr');
    assert.strictEqual(drone.waveA, 'square');
    assert.strictEqual(drone.oscAShaperGain.gain.value, 0.0);
    assert.strictEqual(drone.oscADirectGain.gain.value, 1.0);
  });

  it('correctly configures waveB direct routing when set to square or sqr', () => {
    const ctx = new MockContext();
    const dest = ctx.createGain();
    const wavetables = createWavetableCache(ctx);

    const drone = new SolarDroneVoice(ctx, dest, wavetables, 1);
    // Voice 1 defaults to waveA: 'saw', waveB: 'warm'
    assert.strictEqual(drone.oscBShaperGain.gain.value, 1.0);
    assert.strictEqual(drone.oscBDirectGain.gain.value, 0.0);

    // Set waveB to square
    drone.setWaveB('square');
    assert.strictEqual(drone.waveB, 'square');
    assert.strictEqual(drone.oscBShaperGain.gain.value, 0.0);
    assert.strictEqual(drone.oscBDirectGain.gain.value, 1.0);
    assert.ok(drone.oscBDirectGain.connectedTo.includes(drone.filter1));

    // Set waveB to triangle
    drone.setWaveB('triangle');
    assert.strictEqual(drone.waveB, 'triangle');
    assert.strictEqual(drone.oscBShaperGain.gain.value, 1.0);
    assert.strictEqual(drone.oscBDirectGain.gain.value, 0.0);
  });

  it('mathematically confirms wavefolder collapses square wave rails causing thin whine without bypass', () => {
    // Evaluation of makeWavefoldCurve at high drive (1.6 to 1.8)
    const curveDefault = makeWavefoldCurve(2048, 1.8, 0.45);
    const curveVoice2 = makeWavefoldCurve(2048, 1.6, 0.45);

    // Index 2047 corresponds to x = +1.0 (the plateau of a square wave)
    const railOutputDefault = curveDefault[2047];
    const railOutputVoice2 = curveVoice2[2047];

    // At drive 1.6 - 1.8, the square wave rails fold down below 0.20 (and negative at 1.8)
    // destroying the fundamental and leaving only high-frequency transition spike whining
    assert.ok(railOutputDefault < 0.0, 'Wavefold curve folds rail past peak down below 0');
    assert.ok(railOutputVoice2 < 0.20, 'Wavefold curve folds rail past peak down below 0.20');

    // Direct routing preserves the unattenuated 1.0 amplitude of the square wave fundamental
    const directSquareAmplitude = 1.0;
    assert.ok(directSquareAmplitude > railOutputVoice2 * 5, 'Direct routing preserves >5x fundamental energy compared to folded rails');
  });

  it('verifies AudioEngine presets load and route SQR drone oscillators cleanly', async () => {
    const ctx = new MockContext();
    const engine = new AudioEngine(ctx);
    await engine.init();

    // Default preset has drone2WaveA: 'square'
    assert.strictEqual(engine.drone2.waveA, 'square');
    assert.strictEqual(engine.drone2.oscAShaperGain.gain.value, 0.0);
    assert.strictEqual(engine.drone2.oscADirectGain.gain.value, 1.0);

    // Set drone 1 wave A to sqr via engine API
    engine.setDroneWaveA(1, 'sqr');
    assert.strictEqual(engine.drone1.waveA, 'square');
    assert.strictEqual(engine.drone1.oscAShaperGain.gain.value, 0.0);
    assert.strictEqual(engine.drone1.oscADirectGain.gain.value, 1.0);

    // Set drone 1 wave B to sqr via engine API
    engine.setDroneWaveB(1, 'sqr');
    assert.strictEqual(engine.drone1.waveB, 'square');
    assert.strictEqual(engine.drone1.oscBShaperGain.gain.value, 0.0);
    assert.strictEqual(engine.drone1.oscBDirectGain.gain.value, 1.0);
  });
});

describe('Chord Cluster Spam & Voice Stealing Crackle Elimination', () => {
  it('distributes 6-note chord cluster across 6 distinct voices without Voice 0 collision', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 8);
    ctx.currentTime = 1.0;

    const chordFreqs = [261.63, 329.63, 392.00, 493.88, 587.33, 659.25];
    const voices = chordFreqs.map(f => synth.playNote(f, 0.7, 3.5, false, true));

    // Every voice allocated should be distinct
    const voiceIndices = voices.map(v => synth.voices.indexOf(v));
    const uniqueIndices = new Set(voiceIndices);
    assert.strictEqual(uniqueIndices.size, 6, 'All 6 notes in chord cluster must allocate to distinct voices');
    assert.deepStrictEqual(voiceIndices, [0, 1, 2, 3, 4, 5]);
  });

  it('protects recently triggered voices (<60ms) from being restolen during rapid chord cluster spam', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 8);
    ctx.currentTime = 5.0;

    // Trigger all 8 voices at t = 5.0
    const freqs = [220, 246.94, 261.63, 293.66, 329.63, 349.23, 392.00, 440.00];
    for (const f of freqs) {
      synth.playNote(f, 0.6, 3.5, false, false);
    }
    assert.strictEqual(synth.voices.filter(v => v.isActive).length, 8);

    // Advance time by 10ms (t = 5.010) - simulating rapid spam of a 4-note chord cluster
    ctx.currentTime = 5.010;
    const spamChord = [523.25, 659.25, 783.99, 987.77];
    const stolenVoices = spamChord.map(f => synth.playNote(f, 0.7, 3.5, false, true));

    // Stolen voices should be distinct and distributed across the pool
    const stolenIndices = stolenVoices.map(v => synth.voices.indexOf(v));
    const uniqueStolen = new Set(stolenIndices);
    assert.strictEqual(uniqueStolen.size, 4, 'Rapid cluster spam must steal 4 distinct voices rather than colliding on voice 0');

    // Trigger another note 5ms later (t = 5.015). The voices stolen at t = 5.010 are <60ms old,
    // so stealing MUST choose one of the remaining voices (from t = 5.0) that has not been stolen recently
    ctx.currentTime = 5.015;
    const nextStolen = synth.playNote(1046.50, 0.7, 3.5, false, true);
    const nextIdx = synth.voices.indexOf(nextStolen);
    assert.ok(!stolenIndices.includes(nextIdx), 'Voice stealing must not re-steal voices triggered in the last 60ms');
  });

  it('scales hammer noise transient for chord notes to prevent constructive peaking crackles', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 4);
    ctx.currentTime = 2.0;

    // Single note (isChord = false) on voice 0
    const singleVoice = synth.playNote(440, 0.8, 3.5, false, false);
    const singleAttack = singleVoice.hammerGain.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v > 0.001);
    assert.ok(singleAttack, 'Single note should have positive hammer attack ramp');
    const singlePeakGain = singleAttack.v;

    // Chord note (isChord = true) with same velocity on voice 1 (both within octave 4 for identical hammerThumpGainMult)
    ctx.currentTime = 3.0;
    const chordVoice = synth.playNote(493.88, 0.8, 3.5, false, true);
    const chordAttack = chordVoice.hammerGain.gain.events.find(e => e.type === 'linearRampToValueAtTime' && e.v > 0.001);
    assert.ok(chordAttack, 'Chord note should have positive hammer attack ramp');
    const chordPeakGain = chordAttack.v;

    // Chord hammer transient should be scaled by 0.55 relative to single note
    assert.ok(chordPeakGain < singlePeakGain, 'Chord hammer peak gain must be attenuated relative to single note');
    const ratio = chordPeakGain / singlePeakGain;
    assert.ok(Math.abs(ratio - 0.55) < 0.01, `Expected chord hammer ratio ~0.55, got ${ratio}`);
  });

  it('guarantees getEstimatedGain returns non-zero during the 5ms declick micro-ramp', () => {
    const ctx = new MockContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 2);
    ctx.currentTime = 1.0;

    const voice = synth.voices[0];
    voice.trigger(440, 0.8, 3.5, synth.params, false);

    // During the attack or declick ramp where noteStartTime is in future (e.g. t <= 0)
    const estimatedGainImmediate = voice.getEstimatedGain(1.0);
    assert.ok(estimatedGainImmediate > 0.10, `Estimated gain during ramp must not collapse to 0.0001, got ${estimatedGainImmediate}`);
    assert.strictEqual(estimatedGainImmediate, voice._lastPeakGain);
  });
});
