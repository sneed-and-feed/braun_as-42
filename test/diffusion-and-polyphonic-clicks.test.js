import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ShimmerReverb } from '../js/audio/shimmer-reverb.js';
import { FeltPianoSynthesizer } from '../js/audio/felt-piano.js';
import { AudioEngine } from '../js/audio/engine.js';
import { TapeDelay } from '../js/audio/tape-delay.js';

class MockAudioParam {
  constructor(initialValue = 0) {
    this.value = initialValue;
    this.events = [];
  }
  setValueAtTime(val, time) {
    this.value = val;
    this.events.push({ type: 'setValueAtTime', val, time });
  }
  setTargetAtTime(target, time, timeConstant) {
    this.value = target;
    this.events.push({ type: 'setTargetAtTime', target, time, timeConstant });
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
  cancelAndHoldAtTime(time) {
    this.events.push({ type: 'cancelAndHoldAtTime', time });
  }
}

class MockAudioNode {
  constructor(name = 'node') {
    this.name = name;
    this.connections = [];
  }
  connect(dest) {
    this.connections.push(dest);
    return dest;
  }
  disconnect(dest) {
    if (dest) {
      this.connections = this.connections.filter(c => c !== dest);
    } else {
      this.connections = [];
    }
  }
}

class MockGainNode extends MockAudioNode {
  constructor(initialVal = 1) {
    super('gain');
    this.gain = new MockAudioParam(initialVal);
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(freq = 1000) {
    super('biquad');
    this.frequency = new MockAudioParam(freq);
    this.Q = new MockAudioParam(1);
    this.gain = new MockAudioParam(0);
    this.type = 'lowpass';
  }
}

class MockConvolverNode extends MockAudioNode {
  constructor() {
    super('convolver');
    this.normalize = true;
    this._buffer = null;
  }
  get buffer() {
    return this._buffer;
  }
  set buffer(buf) {
    this._buffer = buf;
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  constructor() {
    super('dynamicsCompressor');
    this.threshold = new MockAudioParam(-3.0);
    this.knee = new MockAudioParam(12.0);
    this.ratio = new MockAudioParam(8.0);
    this.attack = new MockAudioParam(0.003);
    this.release = new MockAudioParam(0.060);
  }
}

class MockAudioContext {
  constructor() {
    this.sampleRate = 48000;
    this.currentTime = 0;
    this.destination = new MockAudioNode('destination');
  }
  createGain() {
    return new MockGainNode(1);
  }
  createBiquadFilter() {
    return new MockBiquadFilterNode(1000);
  }
  createConvolver() {
    return new MockConvolverNode();
  }
  createDelay(max = 1.0) {
    const node = new MockAudioNode('delay');
    node.delayTime = new MockAudioParam(0);
    return node;
  }
  createDynamicsCompressor() {
    return new MockDynamicsCompressorNode();
  }
  createAnalyser() {
    const node = new MockAudioNode('analyser');
    node.fftSize = 2048;
    node.smoothingTimeConstant = 0.82;
    return node;
  }
  createBuffer(channels, length, rate) {
    const channelData = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate: rate || 48000,
      duration: length / (rate || 48000),
      getChannelData: (ch) => channelData[ch]
    };
  }
  createBufferSource() {
    const node = new MockAudioNode('bufferSource');
    node.buffer = null;
    node.loop = false;
    node.start = () => {};
    node.stop = () => {};
    return node;
  }
  createChannelSplitter(channels) {
    const node = new MockAudioNode('splitter');
    node.numberOfOutputs = channels;
    return node;
  }
  createOscillator() {
    const node = new MockAudioNode('oscillator');
    node.frequency = new MockAudioParam(440);
    node.detune = new MockAudioParam(0);
    node.start = () => {};
    node.stop = () => {};
    node.setPeriodicWave = () => {};
    return node;
  }
  createWaveShaper() {
    const node = new MockAudioNode('waveshaper');
    node.curve = null;
    node.oversample = 'none';
    return node;
  }
}

describe('Bug 1 Regression: Reverb Diffusion & Air Damp Smoothness', () => {
  it('instantiates dampingFilter in shimmer wet path with Butterworth Q and maps damping to filter cutoff', () => {
    const ctx = new MockAudioContext();
    const reverb = new ShimmerReverb(ctx, { damping: 0.60 });

    assert.ok(reverb.dampingFilter, 'ShimmerReverb must have a dedicated dampingFilter');
    assert.strictEqual(reverb.dampingFilter.type, 'lowpass');
    assert.strictEqual(reverb.dampingFilter.Q.value, 0.707);

    // Initial cutoff for damping=0.60 should be in the acoustic air absorption range (~3000-4000 Hz)
    const initialFreq = reverb.dampingFilter.frequency.value;
    assert.ok(initialFreq >= 2500 && initialFreq <= 5000, `Initial cutoff expected ~3500 Hz, got ${initialFreq}`);
  });

  it('modulates dampingFilter smoothly in real time via setDamping / setDamp without hot-swapping active convolver buffer', () => {
    const ctx = new MockAudioContext();
    const reverb = new ShimmerReverb(ctx, { damping: 0.60 });

    const activeConvolverBefore = reverb.convolver;
    assert.ok(activeConvolverBefore && activeConvolverBefore.buffer, 'Convolver must have initial impulse');

    // Modulate damping to dark / high absorption (0.95)
    ctx.currentTime = 1.0;
    reverb.setDamping(0.95);

    // Damping filter should be updated immediately with a setTargetAtTime event
    const dampEvents = reverb.dampingFilter.frequency.events.filter(e => e.time >= 1.0);
    const targetEvent = dampEvents.find(e => e.type === 'setTargetAtTime');
    assert.ok(targetEvent, 'setDamping must schedule setTargetAtTime on dampingFilter.frequency');
    assert.ok(targetEvent.target <= 2000, `High damping must set low cutoff <= 2000 Hz, got ${targetEvent.target}`);
    assert.strictEqual(targetEvent.timeConstant, 0.025, 'Cutoff modulation time constant should be 25ms');

    // setDamp alias check
    reverb.setDamp(0.20);
    assert.strictEqual(reverb.damping, 0.20);
    const lowDampEvent = reverb.dampingFilter.frequency.events[reverb.dampingFilter.frequency.events.length - 1];
    assert.ok(lowDampEvent.target >= 8000, `Low damping must set high cutoff >= 8000 Hz, got ${lowDampEvent.target}`);
  });

  it('executes dual-convolver clickless crossfading when decay / diffusion changes instead of active buffer replacement', async () => {
    const ctx = new MockAudioContext();
    const reverb = new ShimmerReverb(ctx, { decayTime: 8.5 });

    const primaryConvolver = reverb.convolver;
    assert.strictEqual(reverb.activeConvolver, 'A');
    assert.ok(reverb.convolverGainA.gain.value === 1.0);
    assert.ok(reverb.convolverGainB.gain.value === 0.0);

    // Update diffusion / decay
    ctx.currentTime = 2.0;
    reverb.setDiffusion(4.0);
    assert.strictEqual(reverb.decayTime, 4.0);

    // Wait for debounced impulse regeneration (60ms)
    await new Promise(r => setTimeout(r, 90));

    // After regeneration, active convolver should be B with clickless crossfade gains scheduled
    assert.strictEqual(reverb.activeConvolver, 'B');
    assert.notStrictEqual(reverb.convolver, primaryConvolver, 'Must have switched to new convolver node');
    assert.strictEqual(reverb.convolver.buffer.length, 4.0 * 48000, 'New convolver buffer must match updated decay time');

    // Check crossfade gain schedules
    const gainAEvents = reverb.convolverGainA.gain.events.filter(e => e.time >= 2.0);
    const gainBEvents = reverb.convolverGainB.gain.events.filter(e => e.time >= 2.0);

    const fadeOutA = gainAEvents.find(e => e.type === 'setTargetAtTime' && e.target === 0.0);
    const fadeInB = gainBEvents.find(e => e.type === 'setTargetAtTime' && e.target === 1.0);

    assert.ok(fadeOutA, 'Convolver A gain must fade out toward 0.0');
    assert.ok(fadeInB, 'Convolver B gain must fade in toward 1.0');
    assert.strictEqual(fadeOutA.timeConstant, 0.05, 'Crossfade time constant should be 50ms');
  });

  it('verifies AudioEngine exposes setReverbDiffusion and setReverbDamp aliases for UI bindings', () => {
    const engine = new AudioEngine();
    assert.strictEqual(typeof engine.setReverbDiffusion, 'function');
    assert.strictEqual(typeof engine.setReverbDamp, 'function');

    engine.setReverbDiffusion(12.5);
    assert.strictEqual(engine.reverbParams.decay, 12.5);

    engine.setReverbDamp(0.40);
    assert.strictEqual(engine.reverbParams.damping, 0.40);
  });

  it('guarantees setDamping does NOT schedule or trigger impulse regeneration even after debounce delay', async () => {
    const ctx = new MockAudioContext();
    const reverb = new ShimmerReverb(ctx, { damping: 0.60 });

    const initialConvolver = reverb.convolver;
    assert.strictEqual(reverb.activeConvolver, 'A');

    // Rapidly turn damping knob multiple times
    reverb.setDamping(0.20);
    reverb.setDamping(0.85);
    reverb.setDamp(0.40);

    // Wait 120ms (well past any 60ms debounce window)
    await new Promise(r => setTimeout(r, 120));

    // Convolver must remain completely untouched (no impulse regeneration, no convolver swap)
    assert.strictEqual(reverb.convolver, initialConvolver, 'Convolver node must remain untouched on damping changes');
    assert.strictEqual(reverb.activeConvolver, 'A', 'Active convolver must stay on A without crossfading');
    assert.strictEqual(reverb._regenTimer, null, 'No regeneration timer should be active');
  });
});

describe('Bug 2 Regression: Held Chords & Clickless Note Triggers', () => {
  it('protects held chord voices from voice stealing and prioritizes non-held voices', () => {
    const ctx = new MockAudioContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 8);

    // Hold a 4-voice chord cluster
    const heldChordVoices = [];
    for (let i = 0; i < 4; i++) {
      const v = synth.playNote(261.63 + i * 30, 0.7, 20.0, true);
      heldChordVoices.push(v);
    }
    assert.strictEqual(heldChordVoices.length, 4);
    heldChordVoices.forEach(v => assert.strictEqual(v.isHold, true));

    // Play 4 non-held notes filling the pool of 8 voices
    const nonHeldVoices = [];
    for (let i = 0; i < 4; i++) {
      const v = synth.playNote(523.25 + i * 40, 0.6, 3.5, false);
      nonHeldVoices.push(v);
    }
    assert.strictEqual(synth.voices.filter(v => v.isActive).length, 8);

    // Now trigger another single note: voice stealing MUST steal from non-held voices, NEVER a held chord voice
    const stolenVoice = synth.playNote(880.0, 0.8, 3.5, false);
    assert.ok(stolenVoice, 'A voice must be allocated');
    assert.strictEqual(
      heldChordVoices.includes(stolenVoice),
      false,
      'Held chord voices must be strictly protected from voice stealing'
    );
    assert.ok(
      nonHeldVoices.includes(stolenVoice),
      'Stolen voice must be selected from the non-held voice pool'
    );
  });

  it('scales polyphonic headroom smoothly with 75ms time constant without step discontinuities', () => {
    const ctx = new MockAudioContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 12);

    // Trigger chord
    ctx.currentTime = 1.0;
    synth.playNote(220, 0.7, 20.0, true);
    synth.playNote(277.18, 0.7, 20.0, true);
    synth.playNote(329.63, 0.7, 20.0, true);

    const initialGain = synth.output.gain.value;
    const expectedInitial = 0.38 * (1.0 / Math.sqrt(3)) * 0.80;
    assert.ok(Math.abs(initialGain - expectedInitial) < 1e-4);

    // Now strike a note on top of held chord
    ctx.currentTime = 1.5;
    synth.playNote(440, 0.8, 3.5, false);

    const gainEvents = synth.output.gain.events.filter(e => e.time >= 1.5);
    const targetEvent = gainEvents.find(e => e.type === 'setTargetAtTime');
    assert.ok(targetEvent, 'Headroom update must schedule setTargetAtTime');
    assert.strictEqual(targetEvent.timeConstant, 0.075, 'Time constant must be smooth 75ms (0.075s) to eliminate clicks on held chords');

    // Verify fallback does not introduce an amplitude step jump
    assert.strictEqual(synth._currentHeadroomGain, targetEvent.target);
  });

  it('guarantees voice stealing de-click ramp transitions smoothly without conflicting setValueAtTime at noteStartTime', () => {
    const ctx = new MockAudioContext();
    ctx.currentTime = 10.0;
    const synth = new FeltPianoSynthesizer(ctx, null, 1); // 1 voice forces stealing

    synth.playNote(261.63, 0.7, 2.0);

    // Retrigger voice 50ms later while sounding loud
    ctx.currentTime = 10.05;
    synth.voices[0].voiceGain.gain.value = 0.28;
    synth.playNote(392.00, 0.8, 2.0);

    const gainEvents = synth.voices[0].voiceGain.gain.events.filter(e => e.time >= 10.05);

    // De-click ramp down to 0.0001
    const declickRamp = gainEvents.find(e => e.type === 'linearRampToValueAtTime' && e.val === 0.0001);
    assert.ok(declickRamp, 'Must schedule linearRampToValueAtTime to 0.0001');
    assert.ok(Math.abs(declickRamp.time - 10.055) < 1e-6, `De-click ramp duration must be 5ms, got ${declickRamp.time}`);

    // Attack ramp up to peakGain
    const attackRamp = gainEvents.find(e => e.type === 'linearRampToValueAtTime' && e.val > 0.1);
    assert.ok(attackRamp, 'Must schedule attack ramp after de-click ramp');
    assert.ok(attackRamp.time > 10.055, 'Attack ramp must start after de-click ramp completes');
  });

  it('strictly protects held chord voices from voice stealing even when all pool voices are held', () => {
    const ctx = new MockAudioContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 6); // Small pool of 6 voices

    // Trigger and hold 3-voice chord cluster (marked isChord = true)
    const chordVoices = [];
    for (let i = 0; i < 3; i++) {
      const v = synth.playNote(261.63 + i * 40, 0.7, 20.0, true, true);
      chordVoices.push(v);
    }

    // Trigger and hold 3 melody notes (isChord = false, isHold = true)
    const melodyVoices = [];
    for (let i = 0; i < 3; i++) {
      const v = synth.playNote(523.25 + i * 50, 0.6, 20.0, true, false);
      melodyVoices.push(v);
    }

    assert.strictEqual(synth.voices.filter(v => v.isActive).length, 6);
    // All 6 voices are held
    synth.voices.forEach(v => assert.strictEqual(v.isHold, true));

    // Now user strikes an additional chime note: voice stealing MUST steal from melodyVoices, NEVER chordVoices!
    const stolenVoice = synth.playNote(880.0, 0.8, 3.5, false, false);
    assert.ok(stolenVoice, 'A voice must be allocated');
    assert.strictEqual(chordVoices.includes(stolenVoice), false, 'Held chord voice must not be stolen');
    assert.ok(melodyVoices.includes(stolenVoice), 'Melody note must be stolen instead of chord');
  });

  it('calculates continuous getEstimatedGain during sustain preventing upward amplitude jumps on release', () => {
    const ctx = new MockAudioContext();
    ctx.currentTime = 5.0;
    const synth = new FeltPianoSynthesizer(ctx, null, 2);

    const voice = synth.playNote(440.0, 0.8, 20.0, true);
    // Advance to 6.0s (in steady hold sustain)
    ctx.currentTime = 6.0;

    const estimated = voice.getEstimatedGain(6.0);
    assert.ok(estimated > 0.05 && estimated <= 0.16, `Estimated gain in sustain expected ~0.12, got ${estimated}`);

    // Call release at 6.0
    voice.release();

    const gainEvents = voice.voiceGain.gain.events.filter(e => e.time >= 6.0);
    // When cancelScheduledValues runs, value set at cancelTime must be <= 0.16 (never peakGain ~0.24)
    const setEvent = gainEvents.find(e => e.type === 'setValueAtTime');
    if (setEvent) {
      assert.ok(setEvent.val <= 0.16, `Release cancelTime gain must reflect sustain level <= 0.16, got ${setEvent.val}`);
    }
  });

  it('smoothly anchors and ramps filter cutoffs in CS-80 mode during voice stealing', () => {
    const ctx = new MockAudioContext();
    ctx.currentTime = 20.0;
    const synth = new FeltPianoSynthesizer(ctx, null, 1);
    synth.setWaveform('cs80');

    synth.playNote(220.0, 0.7, 5.0);

    // Steal voice at 20.05s
    ctx.currentTime = 20.05;
    synth.playNote(440.0, 0.8, 5.0);

    const filterEvents = synth.voices[0].filter1.frequency.events.filter(e => e.time >= 20.05);
    // Filter must ramp down smoothly to brassStartCutoff at noteStartTime (20.055)
    const rampEvent = filterEvents.find(e => e.type === 'linearRampToValueAtTime' && Math.abs(e.time - 20.055) < 1e-4);
    assert.ok(rampEvent, 'CS-80 filter must ramp smoothly to brassStartCutoff over de-click window');
  });

  it('verifies FeltPianoSynthesizer exposes pianoBus alias and masterCompressor has 12dB soft knee', async () => {
    const ctx = new MockAudioContext();
    const synth = new FeltPianoSynthesizer(ctx, null, 4);
    assert.strictEqual(synth.pianoBus, synth.output, 'synth.pianoBus must alias synth.output');

    const engine = new AudioEngine(ctx);
    await engine.init();
    assert.strictEqual(engine.masterCompressor.knee.value, 12.0, 'masterCompressor must have 12 dB soft knee');
  });
});
