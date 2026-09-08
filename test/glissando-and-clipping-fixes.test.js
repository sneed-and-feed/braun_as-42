import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { BraunPlaySurface } from '../js/ui/keyboard.js';
import { makeTapeSaturationCurve, makeSoftClipCurve } from '../js/audio/wavefolder.js';
import { AudioEngine } from '../js/audio/engine.js';
import { SolarDroneVoice } from '../js/audio/drone-voice.js';
import { TapeDelay } from '../js/audio/tape-delay.js';
import { FeltPianoSynthesizer } from '../js/audio/felt-piano.js';

describe('Mouse Click + Drag Glissando on Chime Strip', () => {
  class MockKeyElement {
    constructor(midi = 60) {
      this.midi = midi;
      this.listeners = new Map();
      const set = new Set();
      this.classList = {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c)
      };
      this.attributes = new Map();
      this.attributes.set('data-midi', String(midi));
      this.attributes.set('data-freq', String(261.63));
    }
    addEventListener(type, cb) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(cb);
    }
    dispatchEvent(type, ev = {}) {
      const cbs = this.listeners.get(type) || [];
      cbs.forEach(cb => cb(ev));
    }
    getBoundingClientRect() {
      return { top: 0, height: 100, left: 0, width: 40 };
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k); }
  }

  it('expressively triggers sequential glissando notes while mouse is clicked and dragged across keys', () => {
    const playedNotes = [];
    const releasedVoices = [];

    const mockStrip = {
      innerHTML: '',
      listeners: new Map(),
      addEventListener(type, cb) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(cb);
      },
      dispatchEvent(type, ev = {}) {
        const cbs = this.listeners.get(type) || [];
        cbs.forEach(cb => cb(ev));
      },
      appendChild: () => {}
    };

    const mockChords = {
      innerHTML: '',
      children: [],
      classList: { add: () => {} },
      appendChild: () => {}
    };

    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: (freq, vel, dur, isHold) => {
          const voice = {
            freq,
            vel,
            isHold,
            released: false,
            release: () => {
              voice.released = true;
              releasedVoices.push(voice);
            }
          };
          playedNotes.push(voice);
          return voice;
        }
      }
    };

    let createdCount = 0;
    const origCreateElement = globalThis.document ? globalThis.document.createElement : null;
    if (typeof globalThis.document === 'undefined') {
      globalThis.document = {};
    }
    globalThis.document.createElement = () => {
      const el = new MockKeyElement(60 + createdCount++);
      return el;
    };

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      const keys = Array.from(surface.keyElements.values());
      assert.ok(keys.length >= 5, 'Must generate multiple chime keys');

      const key1 = keys[0];
      const key2 = keys[1];
      const key3 = keys[2];

      // 1. Mouse down on Key 1 (Click)
      key1.dispatchEvent('pointerdown', { preventDefault: () => {}, clientY: 50, buttons: 1 });
      assert.strictEqual(playedNotes.length, 1, 'Key 1 must trigger initial note');
      assert.strictEqual(key1._isHeld, true, 'Key 1 must be held');
      assert.ok(key1.classList.contains('is-pressed'), 'Key 1 must have is-pressed');
      assert.strictEqual(releasedVoices.length, 0, 'Initial note must not be released yet');

      // 2. Drag mouse into Key 2 (Glissando transition)
      key2.dispatchEvent('pointerenter', { clientY: 45, buttons: 1 });
      assert.strictEqual(playedNotes.length, 2, 'Key 2 must trigger glissando strike');
      assert.strictEqual(releasedVoices.length, 1, 'Key 1 voice must be smoothly released on glissando move');
      assert.strictEqual(releasedVoices[0], playedNotes[0], 'First note voice must have received release()');
      assert.strictEqual(key1._isHeld, false, 'Key 1 must no longer be held');
      assert.strictEqual(key1.classList.contains('is-pressed'), false, 'Key 1 is-pressed must be removed');
      assert.strictEqual(key2._isHeld, true, 'Key 2 must be held');
      assert.ok(key2.classList.contains('is-pressed'), 'Key 2 must have is-pressed');

      // 3. Drag mouse into Key 3 (Second glissando transition)
      key3.dispatchEvent('pointerenter', { clientY: 60, buttons: 1 });
      assert.strictEqual(playedNotes.length, 3, 'Key 3 must trigger glissando strike');
      assert.strictEqual(releasedVoices.length, 2, 'Key 2 voice must be smoothly released');
      assert.strictEqual(releasedVoices[1], playedNotes[1], 'Second note voice must have received release()');
      assert.strictEqual(key3._isHeld, true, 'Key 3 must be held');

      // 4. Release mouse button on Key 3
      key3.dispatchEvent('pointerup', {});
      assert.strictEqual(releasedVoices.length, 3, 'Releasing mouse on Key 3 must release final note');
      assert.strictEqual(key3._isHeld, false, 'Key 3 hold must clear on pointerup');

      // 5. Trailing click on Key 3 must not re-trigger
      key3.dispatchEvent('click', {});
      assert.strictEqual(playedNotes.length, 3, 'Trailing click after glissando must not trigger 4th strike');
    } finally {
      if (origCreateElement) {
        globalThis.document.createElement = origCreateElement;
      }
    }
  });

  it('releases active glissando note when pointer leaves the keyboard strip', () => {
    const playedNotes = [];
    const releasedVoices = [];

    const mockStrip = {
      innerHTML: '',
      listeners: new Map(),
      addEventListener(type, cb) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(cb);
      },
      dispatchEvent(type, ev = {}) {
        const cbs = this.listeners.get(type) || [];
        cbs.forEach(cb => cb(ev));
      },
      appendChild: () => {}
    };

    const mockChords = {
      innerHTML: '',
      children: [],
      classList: { add: () => {} },
      appendChild: () => {}
    };

    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: (freq, vel, dur, isHold) => {
          const voice = {
            freq,
            vel,
            isHold,
            release: () => { releasedVoices.push(voice); }
          };
          playedNotes.push(voice);
          return voice;
        }
      }
    };

    let createdCount = 0;
    const origCreateElement = globalThis.document ? globalThis.document.createElement : null;
    if (typeof globalThis.document === 'undefined') {
      globalThis.document = {};
    }
    globalThis.document.createElement = () => new MockKeyElement(60 + createdCount++);

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      const keys = Array.from(surface.keyElements.values());
      const key1 = keys[0];

      key1.dispatchEvent('pointerdown', { preventDefault: () => {}, clientY: 50, buttons: 1 });
      assert.strictEqual(playedNotes.length, 1);
      assert.strictEqual(releasedVoices.length, 0);

      // Pointer leaves strip container with buttons = 0 (user moved mouse out and released)
      mockStrip.dispatchEvent('pointerleave', { buttons: 0 });
      assert.strictEqual(releasedVoices.length, 1, 'Leaving strip container must release active voice');
    } finally {
      if (origCreateElement) {
        globalThis.document.createElement = origCreateElement;
      }
    }
  });
});

describe('Anti-Clipping, Headroom & DSP Continuity Verification', () => {
  it('verifies makeTapeSaturationCurve has zero derivative at +/-1.0 boundaries', () => {
    const samples = 2048;
    const curve = makeTapeSaturationCurve(samples, 0.35);

    // Check derivative near positive boundary x = 1.0
    const dPos = Math.abs(curve[samples - 1] - curve[samples - 2]);
    assert.ok(dPos < 0.001, `Positive boundary slope must approach 0 to prevent flat-top clicks, got delta ${dPos}`);

    // Check derivative near negative boundary x = -1.0
    const dNeg = Math.abs(curve[1] - curve[0]);
    assert.ok(dNeg < 0.001, `Negative boundary slope must approach 0, got delta ${dNeg}`);

    // Exact bounds
    assert.strictEqual(curve[samples - 1], 1.0);
    assert.ok(curve[0] <= -0.95);
  });

  it('verifies makeSoftClipCurve has zero derivative at +/-1.0 boundaries', () => {
    const samples = 2048;
    const curve = makeSoftClipCurve(samples, 1.5);

    // Check derivative near positive boundary
    const dPos = Math.abs(curve[samples - 1] - curve[samples - 2]);
    assert.ok(dPos < 0.001, `Soft clip positive boundary slope must approach 0, got delta ${dPos}`);

    const dNeg = Math.abs(curve[1] - curve[0]);
    assert.ok(dNeg < 0.001, `Soft clip negative boundary slope must approach 0, got delta ${dNeg}`);

    // Odd-symmetry and bounded
    assert.strictEqual(curve[samples - 1], 1.0);
    assert.strictEqual(curve[0], -1.0);
  });

  it('verifies masterCompressor precedes masterTapeSaturator in engine master bus audio graph', async () => {
    const connections = [];

    class MockAudioParam {
      constructor(v = 0) { this.value = v; }
      setValueAtTime(v) { this.value = v; }
      setTargetAtTime(v) { this.value = v; }
      linearRampToValueAtTime(v) { this.value = v; }
      cancelScheduledValues() {}
      cancelAndHoldAtTime() {}
    }

    class MockNode {
      constructor(name) {
        this.name = name;
        this.gain = new MockAudioParam(1);
        this.threshold = new MockAudioParam(-3.0);
        this.knee = new MockAudioParam(6.0);
        this.ratio = new MockAudioParam(8.0);
        this.attack = new MockAudioParam(0.003);
        this.release = new MockAudioParam(0.060);
      }
      connect(dest) {
        connections.push({ from: this.name, to: dest?.name || 'unknown' });
      }
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 0,
      state: 'running',
      createGain: () => new MockNode('gain'),
      createDynamicsCompressor: () => new MockNode('compressor'),
      createWaveShaper: () => new MockNode('shaper'),
      createAnalyser: () => new MockNode('analyser'),
      createDelay: () => {
        const d = new MockNode('delay');
        d.delayTime = new MockAudioParam(0.48);
        return d;
      },
      createBiquadFilter: () => {
        const n = new MockNode('filter');
        n.frequency = new MockAudioParam(1000);
        n.Q = new MockAudioParam(1);
        return n;
      },
      createOscillator: () => {
        const n = new MockNode('osc');
        n.frequency = new MockAudioParam(440);
        n.detune = new MockAudioParam(0);
        n.start = () => {};
        n.stop = () => {};
        return n;
      },
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: 48000 }),
      createBufferSource: () => ({ connect: () => {}, start: () => {}, stop: () => {} }),
      createChannelSplitter: () => new MockNode('splitter'),
      createConvolver: () => new MockNode('convolver'),
      destination: new MockNode('destination')
    };

    const origCtx = globalThis.AudioContext;
    globalThis.AudioContext = class {
      constructor() { return mockCtx; }
    };

    try {
      const engine = new AudioEngine();
      await engine.init();

      // Master chain: masterGain -> masterCompressor -> masterTapeSaturator -> masterLimiter
      assert.strictEqual(engine.masterGain.name, 'gain');
      assert.strictEqual(engine.masterCompressor.name, 'compressor');
      assert.strictEqual(engine.masterTapeSaturator.name, 'shaper');
      assert.strictEqual(engine.masterLimiter.name, 'shaper');

      // Verify compressor is connected before saturator in graph
      const gainToComp = connections.some(c => c.from === engine.masterGain.name && c.to === engine.masterCompressor.name);
      assert.ok(gainToComp, 'masterGain must connect directly to masterCompressor');

      const compToSat = connections.some(c => c.from === engine.masterCompressor.name && c.to === engine.masterTapeSaturator.name);
      assert.ok(compToSat, 'masterCompressor must connect directly to masterTapeSaturator');

      const satToLimiter = connections.some(c => c.from === engine.masterTapeSaturator.name && c.to === engine.masterLimiter.name);
      assert.ok(satToLimiter, 'masterTapeSaturator must connect directly to masterLimiter');
    } finally {
      globalThis.AudioContext = origCtx;
    }
  });

  it('clamps SolarDroneVoice LFO modulation depth so biquad cutoff never drops below 25 Hz', () => {
    class MockAudioParam {
      constructor(v = 0) { this.value = v; }
      setValueAtTime(v) { this.value = v; }
      setTargetAtTime(v) { this.value = v; }
      cancelScheduledValues() {}
      cancelAndHoldAtTime() {}
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 0,
      createGain: () => ({ gain: new MockAudioParam(1), connect: () => {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect: () => {} }),
      createBiquadFilter: () => ({
        frequency: new MockAudioParam(500),
        Q: new MockAudioParam(1),
        connect: () => {}
      }),
      createOscillator: () => ({
        frequency: new MockAudioParam(440),
        detune: new MockAudioParam(0),
        connect: () => {},
        start: () => {},
        stop: () => {}
      })
    };

    const drone = new SolarDroneVoice(mockCtx, null, null, 1);

    // Extreme low cutoff test (40 Hz) with large LFO depth (180 Hz)
    drone.setCutoff(40);
    drone.setLfo(0.12, 180);

    // The effective LFO depth applied to lfoGain1 must be clamped so (cutoff - depth) >= 25 Hz
    const maxSafeDepth = (40 - 30) * 0.85; // 8.5 Hz
    assert.ok(drone._appliedLfoDepth <= maxSafeDepth, `Applied LFO depth must be <= ${maxSafeDepth}, got ${drone._appliedLfoDepth}`);
    assert.ok(40 - drone._appliedLfoDepth >= 25, 'Cutoff minus applied LFO depth must be >= 25 Hz to eliminate filter blowup');
  });

  it('cancels pending target values in FeltPianoSynthesizer._updatePolyphonicHeadroom', () => {
    let cancelCount = 0;
    class MockGainParam {
      constructor(v = 1) { this.value = v; }
      setValueAtTime(v) { this.value = v; }
      setTargetAtTime(v) { this.value = v; }
      linearRampToValueAtTime(v) { this.value = v; }
      cancelScheduledValues() { cancelCount++; }
      cancelAndHoldAtTime() { cancelCount++; }
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 0,
      createGain: () => ({ gain: new MockGainParam(0.38), connect: () => {} }),
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: 48000 }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect: () => {} }),
      createBiquadFilter: () => ({
        frequency: new MockGainParam(440),
        Q: new MockGainParam(1),
        gain: new MockGainParam(1),
        connect: () => {}
      }),
      createOscillator: () => ({
        frequency: new MockGainParam(440),
        detune: new MockGainParam(0),
        connect: () => {},
        start: () => {},
        stop: () => {}
      })
    };

    const synth = new FeltPianoSynthesizer(mockCtx, null, 2);
    cancelCount = 0;

    synth._updatePolyphonicHeadroom();
    assert.ok(cancelCount >= 1, '_updatePolyphonicHeadroom must cancel pending values before scheduling target');
  });
});
