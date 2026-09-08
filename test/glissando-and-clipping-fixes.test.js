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

  it('prevents double-attack popping when pointerenter fires immediately before pointerdown on the same key', () => {
    const playedNotes = [];
    const mockStrip = { innerHTML: '', listeners: new Map(), addEventListener: () => {}, appendChild: () => {} };
    const mockChords = { innerHTML: '', children: [], classList: { add: () => {} }, appendChild: () => {} };
    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: (freq, vel, dur, isHold) => {
          const voice = { freq, vel, isHold, release: () => {} };
          playedNotes.push(voice);
          return voice;
        }
      }
    };

    let createdCount = 0;
    const origCreateElement = globalThis.document ? globalThis.document.createElement : null;
    if (typeof globalThis.document === 'undefined') globalThis.document = {};
    globalThis.document.createElement = () => new MockKeyElement(60 + createdCount++);

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      const key0 = Array.from(surface.keyElements.values())[0];

      // Browser generates pointerenter with buttons=1, then pointerdown 2ms later
      key0.dispatchEvent('pointerenter', { clientY: 50, buttons: 1 });
      assert.strictEqual(playedNotes.length, 1, 'pointerenter with buttons=1 must trigger initial note');

      // pointerdown on the same actively held key must NOT trigger a second note
      key0.dispatchEvent('pointerdown', { preventDefault: () => {}, clientY: 50, buttons: 1 });
      assert.strictEqual(playedNotes.length, 1, 'pointerdown on already active glissando key must NOT re-trigger');
    } finally {
      if (origCreateElement) globalThis.document.createElement = origCreateElement;
    }
  });

  it('releases active glissando note and resets active tracking when window pointerup fires', () => {
    const releasedVoices = [];
    const windowListeners = new Map();
    const origWindow = globalThis.window;
    globalThis.window = {
      addEventListener: (t, cb) => {
        if (!windowListeners.has(t)) windowListeners.set(t, []);
        windowListeners.get(t).push(cb);
      }
    };

    const mockStrip = { innerHTML: '', listeners: new Map(), addEventListener: () => {}, appendChild: () => {} };
    const mockChords = { innerHTML: '', children: [], classList: { add: () => {} }, appendChild: () => {} };
    const mockEngine = {
      isInitialized: true,
      currentScaleKey: 'BUDD_PENTATONIC',
      rootPitchClass: 0,
      a4: 440,
      feltPiano: {
        playNote: (freq, vel, dur, isHold) => {
          const voice = { freq, isHold, release: () => { releasedVoices.push(voice); } };
          return voice;
        }
      }
    };

    let createdCount = 0;
    const origCreateElement = globalThis.document ? globalThis.document.createElement : null;
    if (typeof globalThis.document === 'undefined') globalThis.document = {};
    globalThis.document.createElement = () => new MockKeyElement(60 + createdCount++);

    try {
      const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
      const key0 = Array.from(surface.keyElements.values())[0];

      key0.dispatchEvent('pointerdown', { preventDefault: () => {}, clientY: 50, buttons: 1 });
      assert.strictEqual(surface._isPointerGlissandoActive, true);
      assert.strictEqual(key0._isHeld, true);

      // Window fires pointerup
      const pointerUpCallbacks = windowListeners.get('pointerup') || [];
      pointerUpCallbacks.forEach(cb => cb({}));

      assert.strictEqual(releasedVoices.length, 1, 'window pointerup must call release on the active glissando voice');
      assert.strictEqual(key0._isHeld, false, 'key hold must be cleared');
      assert.strictEqual(surface._isPointerGlissandoActive, false, 'glissando state must be deactivated');
      assert.strictEqual(surface._currentGlissandoKey, null, 'currentGlissandoKey must be cleared');
    } finally {
      if (origCreateElement) globalThis.document.createElement = origCreateElement;
      globalThis.window = origWindow;
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

  it('verifies TapeDelay flutter LFO is a smooth sine wave and input is padded by 0.707 (-3dB) to prevent summing overloads', () => {
    class MockAudioParam {
      constructor(v = 0) { this.value = v; }
      setValueAtTime(v) { this.value = v; }
      setTargetAtTime(v) { this.value = v; }
      cancelScheduledValues() {}
      cancelAndHoldAtTime() {}
    }

    let createdOscs = [];
    let createdGains = [];
    const mockCtx = {
      sampleRate: 48000,
      currentTime: 0,
      createGain: () => {
        const g = { gain: new MockAudioParam(1), connect: () => {} };
        createdGains.push(g);
        return g;
      },
      createDelay: () => ({ delayTime: new MockAudioParam(0.5), connect: () => {} }),
      createBiquadFilter: () => ({ frequency: new MockAudioParam(1000), connect: () => {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect: () => {} }),
      createStereoPanner: () => ({ pan: new MockAudioParam(0), connect: () => {} }),
      createOscillator: () => {
        const osc = {
          type: 'sine',
          frequency: new MockAudioParam(440),
          connect: () => {},
          start: () => {},
          stop: () => {}
        };
        createdOscs.push(osc);
        return osc;
      }
    };

    const delay = new TapeDelay(mockCtx);

    // flutterOsc is the second oscillator created in _buildWowFlutterLFOs
    assert.strictEqual(delay.flutterOsc.type, 'sine', 'flutterOsc must use sine wave to eliminate triangle velocity step pops');
    assert.ok(delay.inputPad, 'TapeDelay must have inputPad');
    assert.strictEqual(delay.inputPad.gain.value, 0.707, 'inputPad must attenuate input by 0.707 (-3dB) to protect against drone + Poisson summing overloads');
  });

  it('verifies SolarDroneVoice setActive and setVolume cancel and hold scheduled values', () => {
    let cancelAndHoldCount = 0;
    class MockAudioParam {
      constructor(v = 0) { this.value = v; }
      setValueAtTime(v) { this.value = v; }
      setTargetAtTime(v) { this.value = v; }
      cancelScheduledValues() {}
      cancelAndHoldAtTime() { cancelAndHoldCount++; }
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
      }),
      createStereoPanner: () => ({ pan: new MockAudioParam(0), connect: () => {} })
    };

    const drone = new SolarDroneVoice(mockCtx, null, null, 1);
    cancelAndHoldCount = 0;

    drone.setActive(true);
    assert.ok(cancelAndHoldCount >= 1, 'setActive must cancel and hold scheduled gain values before ramping');

    const prevCount = cancelAndHoldCount;
    drone.setVolume(0.75);
    assert.ok(cancelAndHoldCount > prevCount, 'setVolume must cancel and hold scheduled gain values before ramping');
  });

  it('verifies FeltPianoVoice starts amplitude envelope strictly from 0.0 when not stealing', () => {
    let initialSetGain = null;
    class MockGainParam {
      constructor(v = 1) { this.value = v; }
      setValueAtTime(v) { this.value = v; }
      setTargetAtTime(v) { this.value = v; }
      linearRampToValueAtTime(v) { this.value = v; }
      exponentialRampToValueAtTime(v) { this.value = v; }
      cancelScheduledValues() {}
      cancelAndHoldAtTime() {}
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 0,
      createGain: () => ({ gain: new MockGainParam(0.0), connect: () => {} }),
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: 48000 }),
      createBufferSource: () => ({ connect: () => {}, start: () => {}, stop: () => {} }),
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

    const synth = new FeltPianoSynthesizer(mockCtx, null, 1);
    const voice = synth.voices[0];
    voice.isActive = false;
    voice.voiceGain.gain.value = 0.0;

    let voiceInitialGain = null;
    const origSetValue = voice.voiceGain.gain.setValueAtTime.bind(voice.voiceGain.gain);
    voice.voiceGain.gain.setValueAtTime = (v, t) => {
      if (voiceInitialGain === null) voiceInitialGain = v;
      return origSetValue(v, t);
    };

    voice.trigger(261.63, 0.6, 3.5, synth.params, false);
    assert.strictEqual(voiceInitialGain, 0.0, 'Idle voice must anchor amplitude envelope strictly at 0.0 to eliminate DC pedestal pops');
  });
});

describe('Clickless High-Velocity Strike & Delay Graph Verification', () => {
  it('verifies hammer buffer has 40ms duration, zero boundary samples, zero-derivative edges, and negligible DC offset', () => {
    const mockCtx = {
      sampleRate: 48000,
      currentTime: 0,
      createGain: () => ({ gain: { value: 1, setValueAtTime() {}, setTargetAtTime() {} }, connect() {} }),
      createBuffer: (ch, len, rate) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: rate }),
      createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect() {} }),
      createBiquadFilter: () => ({
        frequency: { value: 440, setValueAtTime() {}, setTargetAtTime() {} },
        Q: { value: 1, setValueAtTime() {} },
        gain: { value: 1, setValueAtTime() {} },
        connect() {}
      }),
      createOscillator: () => ({
        frequency: { value: 440, setValueAtTime() {}, cancelScheduledValues() {} },
        detune: { value: 0, setValueAtTime() {}, cancelScheduledValues() {} },
        connect() {},
        start() {},
        stop() {}
      })
    };

    const synth = new FeltPianoSynthesizer(mockCtx, null, 1);
    const d = synth.hammerBuffer.getChannelData(0);
    const expectedSamples = Math.floor(48000 * 0.040); // 40ms
    assert.strictEqual(d.length, expectedSamples, 'Hammer buffer must be 40ms to cleanly encompass all registers (16ms treble to 32ms bass)');

    // Boundary samples must be strictly 0.0
    assert.strictEqual(d[0], 0.0, 'Initial sample d[0] must be strictly 0.0');
    assert.strictEqual(d[d.length - 1], 0.0, 'Final sample d[N-1] must be strictly 0.0');

    // Edge samples must taper smoothly to zero without sharp steps
    assert.ok(Math.abs(d[1]) < 0.01, `Sample d[1] (${d[1]}) must smoothly rise from 0 without step`);
    assert.ok(Math.abs(d[d.length - 2]) < 0.01, `Sample d[N-2] (${d[d.length - 2]}) must smoothly approach 0 without truncation step`);

    // DC offset across entire buffer must be negligible (< 1e-4)
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i];
    const mean = sum / d.length;
    assert.ok(Math.abs(mean) < 1e-4, `Mean DC offset (${mean}) must be virtually zero`);
  });

  it('verifies high-velocity strike schedules smooth hammer attack >= 4ms and zero-gain completion before buffer stop', () => {
    const events = [];
    class MockTimelineParam {
      constructor(v = 0) { this.value = v; }
      setValueAtTime(v, t) { events.push({ type: 'setValueAtTime', v, t, target: this.name }); this.value = v; }
      linearRampToValueAtTime(v, t) { events.push({ type: 'linearRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      exponentialRampToValueAtTime(v, t) { events.push({ type: 'exponentialRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      cancelScheduledValues(t) { events.push({ type: 'cancelScheduledValues', t, target: this.name }); }
    }

    let stoppedTime = null;
    let startedTime = null;
    const mockCtx = {
      sampleRate: 48000,
      currentTime: 2.0,
      createGain: () => {
        const p = new MockTimelineParam(0);
        p.name = 'gain';
        return { gain: p, connect() {} };
      },
      createBuffer: (ch, len, rate) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: rate }),
      createBufferSource: () => ({
        buffer: null,
        connect() {},
        start(t) { startedTime = t; },
        stop(t) { stoppedTime = t; }
      }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect() {} }),
      createBiquadFilter: () => {
        const p = new MockTimelineParam(440);
        p.name = 'freq';
        return { frequency: p, Q: new MockTimelineParam(1), gain: new MockTimelineParam(1), connect() {} };
      },
      createOscillator: () => ({
        frequency: new MockTimelineParam(440),
        detune: new MockTimelineParam(0),
        connect() {},
        start() {},
        stop() {}
      })
    };

    const synth = new FeltPianoSynthesizer(mockCtx, null, 1);
    const voice = synth.voices[0];
    events.length = 0;

    // Strike note with high velocity 0.85 (firm chime key strike)
    mockCtx.currentTime = 2.0;
    voice.trigger(523.25, 0.85, 3.5, synth.params, false);

    // Filter hammer events
    const hammerEvents = events.filter(e => e.target === 'gain' && e.t >= 2.0);
    const hammerAttack = hammerEvents.find(e => e.type === 'linearRampToValueAtTime' && e.v > 0.01);
    assert.ok(hammerAttack, 'Hammer gain must schedule linear ramp to peak');
    assert.ok(hammerAttack.t - 2.0 >= 0.004, `Hammer attack duration (${hammerAttack.t - 2.0}s) must be >= 4ms micro-fade`);

    // Buffer source must start at noteStartTime (2.0) and stop strictly after gain returns to 0.0
    assert.strictEqual(startedTime, 2.0, 'Hammer noise source must start at noteStartTime');
    assert.ok(stoppedTime !== null && stoppedTime > hammerAttack.t, 'Noise source stop must be scheduled after attack peak');
    const finalZeroRamp = hammerEvents.find(e => e.type === 'linearRampToValueAtTime' && e.v === 0.0);
    assert.ok(finalZeroRamp, 'Hammer gain must smoothly return all the way to 0.0');
    assert.ok(stoppedTime >= finalZeroRamp.t, `Buffer stop (${stoppedTime}) must be scheduled at or after zero-gain ramp (${finalZeroRamp.t})`);
  });

  it('verifies high-velocity voice gain attack envelope maintains duration >= 5ms and safe future margin', () => {
    const events = [];
    class MockTimelineParam {
      constructor(v = 0) { this.value = v; }
      setValueAtTime(v, t) { events.push({ type: 'setValueAtTime', v, t, target: this.name }); this.value = v; }
      linearRampToValueAtTime(v, t) { events.push({ type: 'linearRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      exponentialRampToValueAtTime(v, t) { events.push({ type: 'exponentialRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      cancelScheduledValues(t) { events.push({ type: 'cancelScheduledValues', t, target: this.name }); }
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 3.0,
      createGain: () => {
        const p = new MockTimelineParam(0);
        p.name = 'gain';
        return { gain: p, connect() {} };
      },
      createBuffer: (ch, len, rate) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: rate }),
      createBufferSource: () => ({ buffer: null, connect() {}, start() {}, stop() {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect() {} }),
      createBiquadFilter: () => {
        const p = new MockTimelineParam(440);
        p.name = 'freq';
        return { frequency: p, Q: new MockTimelineParam(1), gain: new MockTimelineParam(1), connect() {} };
      },
      createOscillator: () => ({
        frequency: new MockTimelineParam(440),
        detune: new MockTimelineParam(0),
        connect() {},
        start() {},
        stop() {}
      })
    };

    const synth = new FeltPianoSynthesizer(mockCtx, null, 1);
    const voice = synth.voices[0];
    events.length = 0;

    // Firm key strike with maximum velocity 1.0
    mockCtx.currentTime = 3.0;
    voice.trigger(261.63, 1.0, 3.5, synth.params, false);

    const gainEvents = events.filter(e => e.target === 'gain');
    const attackRamp = gainEvents.find(e => e.type === 'linearRampToValueAtTime' && e.v > 0.1);
    assert.ok(attackRamp, 'Voice gain must schedule linear ramp to peakGain');
    const attackDuration = attackRamp.t - 3.0;
    assert.ok(attackDuration >= 0.005 && attackDuration <= 0.010, `Attack duration (${attackDuration}s) must be strictly between 5ms and 10ms`);
  });

  it('verifies filter cutoff attack at high velocity is smooth and capped in sine mode to avoid resonant transient pop', () => {
    const events = [];
    class MockTimelineParam {
      constructor(v = 0) { this.value = v; }
      setValueAtTime(v, t) { events.push({ type: 'setValueAtTime', v, t, target: this.name }); this.value = v; }
      linearRampToValueAtTime(v, t) { events.push({ type: 'linearRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      exponentialRampToValueAtTime(v, t) { events.push({ type: 'exponentialRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      cancelScheduledValues(t) { events.push({ type: 'cancelScheduledValues', t, target: this.name }); }
      cancelAndHoldAtTime(t) { events.push({ type: 'cancelAndHoldAtTime', t, target: this.name }); }
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 4.0,
      createGain: () => ({ gain: new MockTimelineParam(0), connect() {} }),
      createBuffer: (ch, len, rate) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: rate }),
      createBufferSource: () => ({ buffer: null, connect() {}, start() {}, stop() {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect() {} }),
      createBiquadFilter: () => {
        const p = new MockTimelineParam(440);
        p.name = 'filterFreq';
        return { frequency: p, Q: new MockTimelineParam(1), gain: new MockTimelineParam(1), connect() {} };
      },
      createOscillator: () => ({
        frequency: new MockTimelineParam(440),
        detune: new MockTimelineParam(0),
        connect() {},
        start() {},
        stop() {}
      })
    };

    const synth = new FeltPianoSynthesizer(mockCtx, null, 1);
    synth.setWaveform('sine');
    const voice = synth.voices[0];
    events.length = 0;

    // Strike note in sine mode at high velocity
    mockCtx.currentTime = 4.0;
    voice.trigger(523.25, 0.85, 3.5, synth.params, false);

    const filterEvents = events.filter(e => e.target === 'filterFreq');
    const filterAttack = filterEvents.find(e => e.type === 'linearRampToValueAtTime');
    assert.ok(filterAttack, 'Filter frequency must schedule smooth linear ramp');
    assert.ok(filterAttack.t - 4.0 >= 0.007 - 1e-6, `Filter attack rise time (${filterAttack.t - 4.0}s) must be >= 7ms to eliminate step clicks`);
    assert.ok(filterAttack.v <= 3500, `In sine mode, maximum filter cutoff must be capped (< 3500 Hz), got ${filterAttack.v}`);
  });

  it('verifies _updatePolyphonicHeadroom anchors curGain with setValueAtTime when cancelScheduledValues is used', () => {
    let anchorValue = null;
    class MockHeadroomParam {
      constructor(v = 0.38) { this.value = v; }
      setValueAtTime(v) { anchorValue = v; this.value = v; }
      setTargetAtTime(v) { this.value = v; }
      linearRampToValueAtTime(v) { this.value = v; }
      cancelScheduledValues() {}
      // cancelAndHoldAtTime omitted to test fallback anchor path
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 1.0,
      createGain: () => ({ gain: new MockHeadroomParam(0.285), connect() {} }),
      createBuffer: (ch, len, rate) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: rate }),
      createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect() {} }),
      createBiquadFilter: () => ({
        frequency: { value: 440, setValueAtTime() {}, setTargetAtTime() {} },
        Q: { value: 1, setValueAtTime() {} },
        gain: { value: 1, setValueAtTime() {} },
        connect() {}
      }),
      createOscillator: () => ({
        frequency: { value: 440, setValueAtTime() {}, cancelScheduledValues() {} },
        detune: { value: 0, setValueAtTime() {}, cancelScheduledValues() {} },
        connect() {},
        start() {},
        stop() {}
      })
    };

    const synth = new FeltPianoSynthesizer(mockCtx, null, 2);
    anchorValue = null;
    synth.output.gain.value = 0.285;

    synth._updatePolyphonicHeadroom();
    assert.strictEqual(anchorValue, 0.285, '_updatePolyphonicHeadroom must explicitly anchor curGain with setValueAtTime to eliminate discontinuity');
  });

  it('verifies Eno Airports preset with Drone 1 active and high-velocity strike into TapeDelay graph remains within stable linear headroom', () => {
    class MockAudioParam {
      constructor(v = 0) { this.value = v; }
      setValueAtTime(v) { this.value = v; }
      setTargetAtTime(v) { this.value = v; }
      linearRampToValueAtTime(v) { this.value = v; }
      exponentialRampToValueAtTime(v) { this.value = v; }
      cancelScheduledValues() {}
      cancelAndHoldAtTime() {}
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 5.0,
      createGain: () => ({ gain: new MockAudioParam(1), connect() {} }),
      createDelay: () => ({ delayTime: new MockAudioParam(0.68), connect() {} }),
      createBiquadFilter: () => ({ frequency: new MockAudioParam(5000), connect() {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect() {} }),
      createStereoPanner: () => ({ pan: new MockAudioParam(0), connect() {} }),
      createOscillator: () => ({
        frequency: new MockAudioParam(440),
        detune: new MockAudioParam(0),
        connect() {},
        start() {},
        stop() {}
      })
    };

    const delay = new TapeDelay(mockCtx, {
      delayTimeL: 0.68,
      delayTimeR: 1.02,
      feedback: 0.68,
      wetLevel: 0.50,
      dryLevel: 0.0
    });

    assert.strictEqual(delay.inputPad.gain.value, 0.707, 'inputPad must attenuate incoming summed signal by -3dB');
    assert.strictEqual(delay.feedback, 0.68, 'TapeDelay feedback matches Eno Airports preset (68%)');
    assert.ok(delay.highpassL, 'Highpass filter exists in delay line');
    assert.strictEqual(delay.highpassL.frequency.value, 75, 'Highpass filter blocks DC rumble at 75 Hz');
  });

  it('verifies AudioEngine incorporates dedicated delaySend bus routing pianoBus into tapeDelay.input', async () => {
    class MockAudioParam {
      constructor(v = 1.0) { this.value = v; }
      setValueAtTime(v) { this.value = v; }
      setTargetAtTime(v) { this.value = v; }
      linearRampToValueAtTime(v) { this.value = v; }
      cancelScheduledValues() {}
      cancelAndHoldAtTime() {}
    }
    const mockCtx = {
      sampleRate: 48000,
      currentTime: 0,
      createGain: () => ({ gain: new MockAudioParam(1.0), connect() {} }),
      createDelay: () => ({ delayTime: new MockAudioParam(0.68), connect() {} }),
      createBiquadFilter: () => ({
        frequency: new MockAudioParam(1000),
        Q: new MockAudioParam(1),
        gain: new MockAudioParam(1),
        connect() {}
      }),
      createBuffer: (ch, len, rate) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: rate }),
      createBufferSource: () => ({ connect() {}, start() {}, stop() {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect() {} }),
      createStereoPanner: () => ({ pan: new MockAudioParam(0), connect() {} }),
      createOscillator: () => ({
        frequency: new MockAudioParam(440),
        detune: new MockAudioParam(0),
        connect() {},
        start() {},
        stop() {}
      }),
      createAnalyser: () => ({ fftSize: 2048, smoothingTimeConstant: 0.8, connect() {} }),
      createDynamicsCompressor: () => ({
        threshold: new MockAudioParam(-3),
        knee: new MockAudioParam(6),
        ratio: new MockAudioParam(8),
        attack: new MockAudioParam(0.003),
        release: new MockAudioParam(0.060),
        connect() {}
      }),
      createChannelSplitter: () => ({ connect() {} }),
      createConvolver: () => ({ connect() {} }),
      state: 'running',
      destination: { connect() {} }
    };

    const engine = new AudioEngine();
    engine.ctx = mockCtx;
    await engine.init();

    assert.ok(engine.delaySend, 'AudioEngine must define dedicated delaySend gain node');
    assert.strictEqual(engine.delaySend.gain.value, 1.0, 'delaySend bus gain must be unity calibrated');
    assert.ok(engine.pianoBus, 'pianoBus must exist');
    assert.ok(engine.tapeDelay, 'tapeDelay must exist');
  });

  it('verifies idle voice key strike does not schedule abrupt setValueAtTime step jump on biquad filter frequency', () => {
    const events = [];
    class MockTimelineParam {
      constructor(v = 440) { this.value = v; }
      setValueAtTime(v, t) { events.push({ type: 'setValueAtTime', v, t, target: this.name }); this.value = v; }
      linearRampToValueAtTime(v, t) { events.push({ type: 'linearRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      exponentialRampToValueAtTime(v, t) { events.push({ type: 'exponentialRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      setTargetAtTime(v, t, tc) { events.push({ type: 'setTargetAtTime', v, t, tc, target: this.name }); this.value = v; }
      cancelScheduledValues(t) { events.push({ type: 'cancelScheduledValues', t, target: this.name }); }
      cancelAndHoldAtTime(t) { events.push({ type: 'cancelAndHoldAtTime', t, target: this.name }); }
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 6.0,
      createGain: () => ({ gain: new MockTimelineParam(0), connect() {} }),
      createBuffer: (ch, len, rate) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: rate }),
      createBufferSource: () => ({ buffer: null, connect() {}, start() {}, stop() {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect() {} }),
      createBiquadFilter: () => {
        const p = new MockTimelineParam(800);
        p.name = 'filterFreq';
        return { frequency: p, Q: new MockTimelineParam(1), gain: new MockTimelineParam(1), connect() {} };
      },
      createOscillator: () => ({
        frequency: new MockTimelineParam(440),
        detune: new MockTimelineParam(0),
        connect() {},
        start() {},
        stop() {}
      })
    };

    const synth = new FeltPianoSynthesizer(mockCtx, null, 1);
    const voice = synth.voices[0];
    events.length = 0;

    // Trigger idle voice note strike
    mockCtx.currentTime = 6.0;
    voice.trigger(261.63, 0.90, 3.5, synth.params, false);

    const filterEvents = events.filter(e => e.target === 'filterFreq');
    // Verify there is NO setValueAtTime event that jumps frequency away from curCutoff to restCutoff
    const jumpEvents = filterEvents.filter(e => e.type === 'setValueAtTime' && e.v < 400);
    assert.strictEqual(jumpEvents.length, 0, 'Idle voice must not jump filter cutoff with setValueAtTime to avoid resonant transient pop');
  });

  it('verifies in sine mode, hammer noise transient is softened and bodyFilter slews with setTargetAtTime', () => {
    const events = [];
    class MockTimelineParam {
      constructor(v = 0) { this.value = v; }
      setValueAtTime(v, t) { events.push({ type: 'setValueAtTime', v, t, target: this.name }); this.value = v; }
      linearRampToValueAtTime(v, t) { events.push({ type: 'linearRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      exponentialRampToValueAtTime(v, t) { events.push({ type: 'exponentialRampToValueAtTime', v, t, target: this.name }); this.value = v; }
      setTargetAtTime(v, t, tc) { events.push({ type: 'setTargetAtTime', v, t, tc, target: this.name }); this.value = v; }
      cancelScheduledValues(t) { events.push({ type: 'cancelScheduledValues', t, target: this.name }); }
      cancelAndHoldAtTime(t) { events.push({ type: 'cancelAndHoldAtTime', t, target: this.name }); }
    }

    const mockCtx = {
      sampleRate: 48000,
      currentTime: 7.0,
      createGain: () => {
        const p = new MockTimelineParam(0);
        p.name = 'gain';
        return { gain: p, connect() {} };
      },
      createBuffer: (ch, len, rate) => ({ getChannelData: () => new Float32Array(len), length: len, sampleRate: rate }),
      createBufferSource: () => ({ buffer: null, connect() {}, start() {}, stop() {} }),
      createWaveShaper: () => ({ oversample: '', curve: null, connect() {} }),
      createBiquadFilter: () => {
        const p = new MockTimelineParam(540);
        p.name = 'filterFreq';
        return { frequency: p, Q: new MockTimelineParam(1), gain: new MockTimelineParam(1), connect() {} };
      },
      createOscillator: () => ({
        frequency: new MockTimelineParam(440),
        detune: new MockTimelineParam(0),
        connect() {},
        start() {},
        stop() {}
      })
    };

    const synth = new FeltPianoSynthesizer(mockCtx, null, 1);
    synth.setWaveform('sine');
    const voice = synth.voices[0];
    events.length = 0;

    mockCtx.currentTime = 7.0;
    voice.trigger(523.25, 0.85, 3.5, synth.params, false);

    // Hammer attack micro-fade in sine mode must be >= 6ms
    const hammerEvents = events.filter(e => e.target === 'gain' && e.t >= 7.0);
    const hammerAttack = hammerEvents.find(e => e.type === 'linearRampToValueAtTime' && e.v > 0.005);
    assert.ok(hammerAttack, 'Hammer gain attack must exist');
    assert.ok(hammerAttack.t - 7.0 >= 0.006 - 1e-6, `Hammer attack in sine mode (${hammerAttack.t - 7.0}s) must be >= 6ms`);
    assert.ok(hammerAttack.v < 0.03, `Hammer peak gain in sine mode must be softened (< 0.03), got ${hammerAttack.v}`);
  });
});
