import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(idx) { return Array.from(map.keys())[idx] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); }
  };
}

function setupMockJuceDom({ storageEntries = {} } = {}) {
  const elementsById = new Map();
  const listeners = new Map();
  const emittedToNative = [];

  const makeEl = (id, tag = 'div') => {
    const classes = new Set();
    const children = [];
    const el = {
      id,
      tagName: tag.toUpperCase(),
      value: '',
      textContent: '',
      style: {},
      dataset: {},
      children,
      classList: {
        add: (...c) => c.forEach(x => classes.add(x)),
        remove: (...c) => c.forEach(x => classes.delete(x)),
        toggle: (c, force) => {
          const next = force !== undefined ? Boolean(force) : !classes.has(c);
          if (next) classes.add(c);
          else classes.delete(c);
          return next;
        },
        contains: (c) => classes.has(c)
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      appendChild: (child) => { children.push(child); return child; },
      querySelector: (sel) => {
        if (sel === '.braun-status-text') return el._statusText || (el._statusText = makeEl(`${id}-text`, 'span'));
        if (sel === '.braun-led') return el._led || (el._led = makeEl(`${id}-led`, 'span'));
        if (sel === '.braun-vector-canvas') {
          if (!el._vecCanvas) {
            el._vecCanvas = makeEl(`${id}-canvas`, 'canvas');
            el._vecCanvas.getContext = () => ({
              clearRect: () => {}, fillRect: () => {}, beginPath: () => {},
              moveTo: () => {}, lineTo: () => {}, stroke: () => {},
              arc: () => {}, fill: () => {}, fillText: () => {},
              createLinearGradient: () => ({ addColorStop: () => {} })
            });
          }
          return el._vecCanvas;
        }
        if (!el._queries) el._queries = {};
        if (!el._queries[sel]) el._queries[sel] = makeEl(`${id}-${sel}`, 'div');
        return el._queries[sel];
      },
      querySelectorAll: () => [],
      getAttribute: () => null,
      setAttribute: () => {},
      blur: () => {},
      focus: () => {},
      getBoundingClientRect: () => ({ width: 320, height: 140, left: 0, top: 0 })
    };
    return el;
  };

  for (const id of ['btn-power', 'btn-drone1-active', 'btn-drone2-active', 'toggle-freeze', 'toggle-drone-track']) {
    const btn = makeEl(id, 'button');
    btn._statusText = makeEl(`${id}-text`, 'span');
    btn._led = makeEl(`${id}-led`, 'span');
    elementsById.set(id, btn);
  }
  const presetSelect = makeEl('select-preset', 'select');
  presetSelect.value = 'DEFAULT';
  elementsById.set('select-preset', presetSelect);

  const scopeCanvas = makeEl('oscilloscope', 'canvas');
  scopeCanvas.getContext = () => ({
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    arc: () => {},
    fill: () => {},
    fillText: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} })
  });
  elementsById.set('oscilloscope', scopeCanvas);

  const localStorage = createMockStorage(storageEntries);
  const sessionStorage = createMockStorage(storageEntries);

  const backend = {
    addEventListener(eventName, cb) {
      if (!listeners.has(eventName)) listeners.set(eventName, []);
      listeners.get(eventName).push(cb);
    },
    emitEvent(eventName, payload) {
      emittedToNative.push({ eventName, payload });
    }
  };

  globalThis.window = {
    __IS_JUCE__: true,
    __JUCE__: { backend },
    location: { hostname: 'juce.backend' },
    devicePixelRatio: 1,
    localStorage,
    sessionStorage,
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  globalThis.document = {
    readyState: 'complete',
    visibilityState: 'visible',
    activeElement: null,
    body: {
      focus: () => {},
      getAttribute: () => 'light',
      setAttribute: () => {},
      appendChild: () => {},
      removeChild: () => {}
    },
    getElementById: (id) => {
      if (!elementsById.has(id)) {
        elementsById.set(id, makeEl(id, 'div'));
      }
      return elementsById.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(`dyn-${tag}`, tag),
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');

  const emitFromNative = (eventName, payload) => {
    for (const cb of (listeners.get(eventName) || [])) {
      cb(payload);
    }
  };

  return { elementsById, emittedToNative, emitFromNative, localStorage, sessionStorage };
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

describe('Standalone WebView2 Startup Drone Disarm, Minimize/Reopen & Power-Off Guard (v1.5.1)', () => {
  it('purges residual WebView2 drone/freeze storage keys and boots with both drones OFF', async () => {
    const { elementsById, emittedToNative, emitFromNative, localStorage, sessionStorage } = setupMockJuceDom({
      storageEntries: {
        braun_drone1_active: 'true',
        drone2Active: '1',
        as42_shimmer_freeze: '1',
        unrelated_user_note: 'keep-me'
      }
    });

    // Simulate active class left on DOM buttons prior to bridge init
    elementsById.get('btn-drone1-active').classList.add('is-active');
    elementsById.get('btn-drone2-active').classList.add('is-active');

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    // Residual synth keys purged while unrelated keys remain intact
    assert.strictEqual(localStorage.getItem('braun_drone1_active'), null);
    assert.strictEqual(localStorage.getItem('drone2Active'), null);
    assert.strictEqual(sessionStorage.getItem('as42_shimmer_freeze'), null);
    assert.strictEqual(localStorage.getItem('unrelated_user_note'), 'keep-me');

    // Both drones and power start strictly OFF
    assert.strictEqual(app.isPowerOn, false);
    assert.strictEqual(app.engine.droneParams[1].active, false);
    assert.strictEqual(app.engine.droneParams[2].active, false);
    assert.strictEqual(elementsById.get('btn-drone1-active').classList.contains('is-active'), false);
    assert.strictEqual(elementsById.get('btn-drone2-active').classList.contains('is-active'), false);

    // Simulate C++ Standalone startup sync response (Standby, drones disarmed, program 2 restored)
    const countBeforeSync = emittedToNative.length;
    emitFromNative('paramUpdate', { id: 'power', value: 0.0 });
    emitFromNative('paramUpdate', { id: 'drone1_active', value: 0.0 });
    emitFromNative('paramUpdate', { id: 'drone2_active', value: 0.0 });
    emitFromNative('paramUpdate', { id: 'shimmer_freeze', value: 0.0 });
    emitFromNative('paramUpdate', { id: 'currentProgram', value: 2.0 });

    assert.strictEqual(app.isPowerOn, false);
    assert.strictEqual(app.engine.droneParams[1].active, false);
    assert.strictEqual(app.engine.droneParams[2].active, false);
    assert.strictEqual(app.currentPresetKey, 'VANGELIS');
    assert.strictEqual(elementsById.get('select-preset').value, 'VANGELIS');
    assert.strictEqual(emittedToNative.length, countBeforeSync, 'Host sync must not echo paramChange back to C++');
  });

  it('ignores late scopeFrame packets while powered off in Standby', async () => {
    const { emitFromNative } = setupMockJuceDom();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    assert.strictEqual(app.isPowerOn, false);
    assert.strictEqual(app.scope.isPowered, false);

    const silentBytes = Buffer.alloc(64, 128).toString('base64');
    emitFromNative('scopeFrame', { l: silentBytes, r: silentBytes });

    assert.strictEqual(app.scope.isPowered, false, 'Standby scope must not wake from in-flight scopeFrame');
  });

  it('prevents Hermite foldback above +/-1.0 in applySmoothBoundaryKnee & makeFreezeLimiterCurve', async () => {
    const { applySmoothBoundaryKnee, makeFreezeLimiterCurve, makeSoftClipCurve } = await import('../js/audio/wavefolder.js');
    assert.strictEqual(applySmoothBoundaryKnee(1.25, 0.70), 1.0);
    assert.strictEqual(applySmoothBoundaryKnee(-1.25, 0.70), -1.0);
    assert.strictEqual(applySmoothBoundaryKnee(Number.NaN, 0.70), 0.0);

    const freezeCurve = makeFreezeLimiterCurve(2048, 0.88, 0.70);
    for (let i = 1; i < freezeCurve.length; i++) {
      assert.ok(freezeCurve[i] >= freezeCurve[i - 1] - 1e-6, `Freeze limiter folded back at index ${i}`);
    }
    assert.ok(Math.abs(freezeCurve[freezeCurve.length - 1] - 0.88) < 1e-5);
    assert.ok(Math.abs(freezeCurve[0] + 0.88) < 1e-5);

    const zeroDrive = makeSoftClipCurve(256, 0.0);
    for (let i = 0; i < zeroDrive.length; i++) {
      assert.ok(Number.isFinite(zeroDrive[i]), 'Zero-drive soft clip must never emit NaN');
    }
  });

  it('preserves RT60 decayScale in ShimmerReverb.setShimmer and in-flight fade gain in DroneVoice._getInstantGain', async () => {
    const { ShimmerReverb } = await import('../js/audio/shimmer-reverb.js');
    const { DroneVoice } = await import('../js/audio/drone-voice.js');

    let lastShimmerFb = 0;
    const mockParam = (initVal = 0) => ({
      value: initVal,
      setValueAtTime(v) { this.value = v; },
      setTargetAtTime(v) { this.value = v; },
      linearRampToValueAtTime(v) { this.value = v; },
      cancelScheduledValues() {},
      cancelAndHoldAtTime() {}
    });
    const makeNode = () => ({
      gain: mockParam(1.0),
      frequency: mockParam(1000),
      Q: mockParam(0.707),
      delayTime: mockParam(0.05),
      detune: mockParam(0),
      pan: mockParam(0),
      connect() {},
      disconnect() {},
      start() {},
      stop() {}
    });
    const mockCtx = {
      currentTime: 1.0,
      sampleRate: 48000,
      createGain: makeNode,
      createBiquadFilter: makeNode,
      createDelay: makeNode,
      createWaveShaper: makeNode,
      createOscillator: makeNode,
      createStereoPanner: makeNode,
      createPeriodicWave: () => ({}),
      createConvolver: () => ({ normalize: true, buffer: null, connect() {}, disconnect() {} }),
      createBuffer: (_ch, len) => ({
        getChannelData: () => new Float32Array(len)
      })
    };

    const reverb = new ShimmerReverb(mockCtx);
    reverb.shimmerFeedback.gain.setTargetAtTime = (v) => { lastShimmerFb = v; };
    reverb.setDecay(17.0, true); // decayScale = min(1.35, 17.0 / 8.5) = 1.35
    reverb.setShimmer(0.50);
    const expectedFb = Math.min(0.75, (0.2 + 0.50 * 0.45) * 1.35);
    assert.ok(Math.abs(lastShimmerFb - expectedFb) < 1e-6, `Expected ${expectedFb}, got ${lastShimmerFb}`);

    const drone = new DroneVoice(mockCtx, null, { voiceId: 1 });
    drone.isActive = false;
    drone.voiceGain.gain.value = 0.42;
    assert.ok(Math.abs(drone._getInstantGain(1.0) - 0.42) < 1e-6, 'Inactive fading drone must report live voiceGain');
  });

  it('synchronizes all knobs, waveforms, drone pitches, and sub-bass to C++ APVTS in loadPatch()', async () => {
    const { emittedToNative } = setupMockJuceDom();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    emittedToNative.length = 0;
    const ok = app.loadPatch({
      name: 'Custom Studio Patch',
      rootPitchClass: 2, // D
      currentScaleKey: 'LYDIAN_AMBIENT',
      a4: 432,
      pianoWave: 'cs80',
      knobs: {
        feltTone: 74,
        feltDecay: 1.6,
        drone1Cutoff: 620,
        drone2Fold: 0.48,
        delayTime: 520,
        reverbShimmer: 62,
        masterVolume: 78
      },
      drone1: { active: true, waveA: 'triangle', waveB: 'sine', snap: 'sub-bass' },
      drone2: { active: false, waveA: 'saw', waveB: 'warm', snap: 'perfect-5th' }
    }, { animate: false });

    assert.strictEqual(ok, true);
    const byId = new Map();
    for (const evt of emittedToNative) {
      if (evt.eventName === 'paramChange' && evt.payload) {
        byId.set(evt.payload.id, evt.payload.value);
      }
    }

    assert.strictEqual(byId.get('feltTone'), 74);
    assert.strictEqual(byId.get('feltDecay'), 1.6);
    assert.strictEqual(byId.get('drone1Cutoff'), 620);
    assert.strictEqual(byId.get('drone2Fold'), 0.48);
    assert.strictEqual(byId.get('delayTime'), 520);
    assert.strictEqual(byId.get('reverbShimmer'), 62);
    assert.strictEqual(byId.get('masterVol'), 78);
    assert.strictEqual(byId.get('felt_waveform'), 'cs80');
    assert.strictEqual(byId.get('drone1_waveA'), 'triangle');
    assert.strictEqual(byId.get('drone1_waveB'), 'sine');
    assert.strictEqual(byId.get('drone2_waveA'), 'saw');
    assert.strictEqual(byId.get('drone2_waveB'), 'warm');
    assert.strictEqual(byId.get('drone1_active'), 1.0);
    assert.strictEqual(byId.get('drone2_active'), 0.0);
    assert.strictEqual(byId.get('drone1_isSubBass'), 1.0);
    assert.ok(typeof byId.get('drone1_pitch') === 'number' && byId.get('drone1_pitch') > 20);
    assert.ok(typeof byId.get('drone2_pitch') === 'number' && byId.get('drone2_pitch') > 20);
  });

  it('sustains MIDI notes under CC 64 damper pedal without premature noteOff kill or retuned re-strike orphans', async () => {
    const { AudioEngine } = await import('../js/audio/engine.js');
    const { BraunMidiManager } = await import('../js/midi/midi-manager.js');

    const engine = new AudioEngine();
    const voices = Array.from({ length: 8 }, (_, idx) => ({
      idx,
      isActive: false,
      isHold: false,
      _isReleased: false,
      currentFreq: 0,
      triggerId: 0,
      releaseCalls: 0,
      release() {
        this.isHold = false;
        this._isReleased = true;
        this.isActive = false;
        this.releaseCalls += 1;
      }
    }));
    let nextId = 0;
    engine.feltPiano = {
      voices,
      playNote(freq, _vel, _dur, isHold) {
        let v = voices.find(x => x.isActive && !x.isHold && Math.abs(x.currentFreq - freq) < 0.5);
        if (!v) v = voices.find(x => !x.isActive) || voices[0];
        v.isActive = true;
        v.isHold = Boolean(isHold);
        v._isReleased = false;
        v.currentFreq = freq;
        v.triggerId = ++nextId;
        return v;
      },
      release(freq) {
        for (const v of voices) {
          if (v.isActive && Math.abs(v.currentFreq - freq) < 0.5) v.release();
        }
      },
      releaseAllNotes() {
        for (const v of voices) if (v.isActive) v.release();
      }
    };

    const midi = new BraunMidiManager(engine, null);

    // 1. Engage CC 64 sustain pedal, play MIDI 60, then release physical key -> voice MUST stay sustained!
    midi.handleMidiMessage({ data: new Uint8Array([0xB0, 64, 127]) }); // CC 64 down
    midi.handleMidiMessage({ data: new Uint8Array([0x90, 60, 100]) }); // Note-On 60
    const v0 = voices[0];
    assert.strictEqual(v0.isActive, true);
    assert.strictEqual(v0._isReleased, false);

    midi.handleMidiMessage({ data: new Uint8Array([0x80, 60, 0]) }); // Note-Off 60 while pedal down
    assert.strictEqual(v0.isActive, true, 'CC 64 must keep voice active after physical Note-Off');
    assert.strictEqual(v0._isReleased, false);
    assert.strictEqual(v0.releaseCalls, 0);

    // 2. Retune 440 -> 432 Hz while MIDI 60 is pedal-latched and re-strike MIDI 60 -> prior v0 must release cleanly!
    engine.a4 = 432;
    midi.handleMidiMessage({ data: new Uint8Array([0x90, 60, 100]) });
    const v1 = voices[1];
    assert.strictEqual(v0.releaseCalls, 1, 'Retuned pedal-latched voice must not be orphaned on re-strike');
    assert.strictEqual(v1.isActive, true);
    midi.handleMidiMessage({ data: new Uint8Array([0x80, 60, 0]) });
    assert.strictEqual(v1.isActive, true, 'Re-struck note must remain latched while pedal is down');

    // 3. Lift CC 64 -> latched voice releases exactly once
    midi.handleMidiMessage({ data: new Uint8Array([0xB0, 64, 0]) });
    assert.strictEqual(v1.isActive, false);
    assert.strictEqual(v1.releaseCalls, 1);
  });

  it('never resumes Web Audio context in Standby on visibility/pageshow and disarms on BFCache restore', async () => {
    const windowListeners = new Map();
    const { elementsById } = setupMockJuceDom();
    globalThis.window.__IS_JUCE__ = false;
    delete globalThis.window.__JUCE__;
    globalThis.window.location.hostname = 'localhost';
    globalThis.window.addEventListener = (evt, cb) => {
      if (!windowListeners.has(evt)) windowListeners.set(evt, []);
      windowListeners.get(evt).push(cb);
    };

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    assert.strictEqual(app.isJuce, false);

    let resumeCalls = 0;
    let suspendCalls = 0;
    app.engine.ctx = {
      state: 'suspended',
      currentTime: 0,
      resume: async () => { resumeCalls += 1; app.engine.ctx.state = 'running'; },
      suspend: async () => { suspendCalls += 1; app.engine.ctx.state = 'suspended'; }
    };
    app.isPowerOn = false;

    // 1. Visibility/pageshow while Standby (isPowerOn === false) must NEVER resume AudioContext
    for (const cb of (windowListeners.get('visibilitychange') || [])) {
      await cb({ type: 'visibilitychange' });
    }
    for (const cb of (windowListeners.get('pageshow') || [])) {
      await cb({ type: 'pageshow', persisted: false });
    }
    assert.strictEqual(resumeCalls, 0, 'Standby AudioContext must never auto-resume on visibilitychange/pageshow');

    // 2. BFCache restore (pageshow with persisted === true) must disarm active power & drones
    app.isPowerOn = true;
    app.engine.ctx.state = 'running';
    app.engine.droneParams[1].active = true;
    elementsById.get('btn-drone1-active').classList.add('is-active');
    elementsById.get('btn-power').classList.add('is-active');

    for (const cb of (windowListeners.get('pageshow') || [])) {
      await cb({ type: 'pageshow', persisted: true });
    }
    assert.strictEqual(app.isPowerOn, false);
    assert.strictEqual(app.engine.droneParams[1].active, false);
    assert.strictEqual(elementsById.get('btn-drone1-active').classList.contains('is-active'), false);
    assert.strictEqual(elementsById.get('btn-power').classList.contains('is-active'), false);
    assert.ok(suspendCalls >= 1 || app.engine.ctx.state === 'suspended');

    // 3. Tear down globalThis.window and wait >120ms so _initJuceBridge's 100ms poll tick self-clears without ReferenceError
    delete globalThis.window;
    await new Promise(r => setTimeout(r, 130));
    assert.strictEqual(app._juceBridgePoll, null);
  });

  it('never overwrites C++ APVTS with PRESETS.DEFAULT on WebView boot/reopen and restores extended UI state', async () => {
    const windowListeners = new Map();
    const { elementsById, emittedToNative, emitFromNative } = setupMockJuceDom();
    let bodyTheme = 'light';
    globalThis.document.body.getAttribute = (k) => (k === 'data-theme' ? bodyTheme : null);
    globalThis.document.body.setAttribute = (k, v) => { if (k === 'data-theme') bodyTheme = v; };
    globalThis.window.addEventListener = (evt, cb) => {
      if (!windowListeners.has(evt)) windowListeners.set(evt, []);
      windowListeners.get(evt).push(cb);
    };

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    // CRITICAL REGRESSION GUARD:
    // Constructing AmbientApp inside JUCE WebView MUST ONLY emit requestSync,
    // and MUST NEVER emit PRESETS.DEFAULT knob/program/waveform values that clobber C++ APVTS!
    assert.strictEqual(emittedToNative.length, 1,
      `Expected only requestSync on JUCE boot, got: ${JSON.stringify(emittedToNative)}`);
    assert.strictEqual(emittedToNative[0].eventName, 'paramChange');
    assert.strictEqual(emittedToNative[0].payload.id, 'requestSync');

    // Simulate C++ syncAllParametersToWeb() restoring custom user session after minimize/reopen
    emitFromNative('paramUpdate', { id: 'uiTheme', value: 'dark' });
    emitFromNative('paramUpdate', { id: 'rootPitchClass', value: 6 });
    emitFromNative('paramUpdate', { id: 'scaleKey', value: 'AVALON_SPIRITED' });
    emitFromNative('paramUpdate', { id: 'tuningA4', value: 432 });
    emitFromNative('paramUpdate', { id: 'masterDrive', value: 44 });
    emitFromNative('paramUpdate', { id: 'poissonDensity', value: 22 });
    emitFromNative('paramUpdate', { id: 'poissonHumanize', value: 81 });
    emitFromNative('paramUpdate', { id: 'chordSpeed', value: 'slow' });
    emitFromNative('paramUpdate', { id: 'vectorX', value: 0.77 });
    emitFromNative('paramUpdate', { id: 'vectorY', value: 0.33 });
    emitFromNative('paramUpdate', { id: 'currentProgram', value: 2 });
    emitFromNative('paramUpdate', { id: 'feltTone', value: 84 });
    emitFromNative('paramUpdate', { id: 'drone1Cutoff', value: 1950 });
    emitFromNative('paramUpdate', { id: 'drone1_active', value: 1.0 });
    emitFromNative('paramUpdate', { id: 'power', value: 1.0 });

    assert.strictEqual(bodyTheme, 'dark');
    assert.strictEqual(app.engine.rootPitchClass, 6);
    assert.strictEqual(app.engine.currentScaleKey, 'AVALON_SPIRITED');
    assert.strictEqual(app.engine.a4, 432);
    assert.strictEqual(app.knobs.masterDrive.value, 44);
    assert.strictEqual(app.knobs.poissonDensity.value, 22);
    assert.strictEqual(app.knobs.poissonHumanize.value, 81);
    assert.strictEqual(app.knobs.feltTone.value, 84);
    assert.strictEqual(app.knobs.drone1Cutoff.value, 1950);
    assert.strictEqual(app.vectorPad.x, 0.77, 'vectorPad.x must NOT be clobbered by feltTone during host sync');
    assert.strictEqual(app.vectorPad.y, 0.33, 'vectorPad.y must NOT be clobbered by reverbShimmer during host sync');
    assert.strictEqual(app.currentPresetKey, 'VANGELIS');
    assert.strictEqual(app.isPowerOn, true);
    assert.strictEqual(app.engine.droneParams[1].active, true);
    assert.strictEqual(emittedToNative.length, 1, 'Restoring state from C++ must produce zero feedback emissions');

    // Even if WebView fires a BFCache pageshow(persisted=true) inside JUCE, it must requestSync instead of resetting!
    for (const cb of (windowListeners.get('pageshow') || [])) {
      await cb({ type: 'pageshow', persisted: true });
    }
    assert.strictEqual(app.isPowerOn, true, 'JUCE WebView pageshow must not unilaterally disarm power');
    assert.strictEqual(app.knobs.feltTone.value, 84, 'JUCE WebView pageshow must not reset knobs');
    assert.strictEqual(emittedToNative.at(-1).payload.id, 'requestSync');
  });

  it('cancels in-flight slow chord strum timers on togglePower() OFF so delayed notes never re-wake power', async () => {
    const { emittedToNative } = setupMockJuceDom();
    const { AmbientApp } = await import('../js/app.js');
    const { BraunPlaySurface } = await import('../js/ui/keyboard.js');
    const app = new AmbientApp();

    const strip = globalThis.document.getElementById('chime-strip');
    const chords = globalThis.document.getElementById('chord-macros');
    app.playSurface = new BraunPlaySurface(strip, chords, app.engine);
    app.playSurface.setChordSpeed('slow'); // 120ms between chord tones

    await app.startAudio();
    app.engine.setDroneActive(1, true);
    assert.strictEqual(app.isPowerOn, true);

    // Start a slow multi-note chord strum, then immediately turn Power OFF 20ms later
    app.playSurface.playChord('BUDD_FIFTHS');
    await new Promise(r => setTimeout(r, 20));
    await app.togglePower({ emitToNative: true });
    assert.strictEqual(app.isPowerOn, false);

    const emittedCountAtPowerOff = emittedToNative.length;

    // Wait 350ms past all scheduled strum delays (120ms, 240ms, 360ms...)
    await new Promise(r => setTimeout(r, 380));

    const lateNoteOns = emittedToNative.slice(emittedCountAtPowerOff).filter(e => e.eventName === 'noteOn');
    assert.strictEqual(lateNoteOns.length, 0, 'Zero delayed strum noteOn events may fire after Power OFF');
    assert.strictEqual(app.isPowerOn, false, 'Power must remain strictly OFF');
  });

  it('preserves latched Vector Pad, CUSTOM patch, engine knob cache, Freeze disarm, and async startAudio cancellation', async () => {
    const { elementsById, emittedToNative, emitFromNative } = setupMockJuceDom();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const customPatch = {
      format: 'BRAUN_AS42_PATCH',
      version: 1,
      name: 'Minimize Restore Custom',
      knobs: { feltTone: 79, drone2Beat: 2.4 }
    };

    // 1. Simulate full C++ syncAllParametersToWeb() sequence (syncBegin -> params -> vectorMode/X/Y -> syncEnd)
    emitFromNative('paramUpdate', { id: 'syncBegin', value: 1.0 });
    emitFromNative('paramUpdate', { id: 'currentProgram', value: 0 });
    emitFromNative('paramUpdate', { id: 'customPatchJson', value: JSON.stringify(customPatch) });
    emitFromNative('paramUpdate', { id: 'felt_tone', value: 0.79 });
    emitFromNative('paramUpdate', { id: 'shimmer_amount', value: 0.64 });
    emitFromNative('paramUpdate', { id: 'drone2_beat', value: 2.40 });
    emitFromNative('paramUpdate', { id: 'vectorMode', value: 'latch' });
    emitFromNative('paramUpdate', { id: 'vectorX', value: 0.82 });
    emitFromNative('paramUpdate', { id: 'vectorY', value: 0.22 });
    emitFromNative('paramUpdate', { id: 'syncEnd', value: 1.0 });

    assert.strictEqual(app.currentPresetKey, 'CUSTOM');
    assert.strictEqual(elementsById.get('select-preset').value, 'CUSTOM');
    assert.strictEqual(app.vectorPad.mode, 'latch');
    assert.strictEqual(app.vectorPad.x, 0.82);
    assert.strictEqual(app.vectorPad.y, 0.22);

    // Verify knob._localOnChange updated JS AudioEngine internal cache (droneParams[2].beat === 2.40, NOT 0.65!)
    assert.strictEqual(app.engine.droneParams[2].beat, 2.40,
      'Host paramUpdate must update engine.droneParams[2].beat via _localOnChange');

    // Moving vector pad in latch mode emits vectorState + exact 5 paramChanges
    emittedToNative.length = 0;
    app.vectorPad.setCoordinates(0.68, 0.41, true);
    const paramChanges = emittedToNative.filter(e => e.eventName === 'paramChange');
    const vecStates = emittedToNative.filter(e => e.eventName === 'vectorState');
    assert.strictEqual(paramChanges.length, 5, 'Vector modulation must emit exact 5 knob paramChanges');
    assert.strictEqual(vecStates.length, 1, 'Vector modulation must emit vectorState to C++');
    assert.strictEqual(vecStates[0].payload.mode, 'latch');
    assert.strictEqual(vecStates[0].payload.x, 0.68);
    assert.strictEqual(vecStates[0].payload.y, 0.41);

    // 2. Engage Freeze + Power ON, then press Power OFF -> Freeze UI and shimmer_freeze MUST disarm!
    await app.startAudio();
    app.engine.setReverbFreeze(true);
    app._syncFreezeUI(true);
    assert.strictEqual(elementsById.get('toggle-freeze').classList.contains('is-active'), true);

    emittedToNative.length = 0;
    await app.togglePower({ emitToNative: true });
    assert.strictEqual(app.isPowerOn, false);
    assert.strictEqual(app.engine.reverbParams.freeze, false);
    assert.strictEqual(elementsById.get('toggle-freeze').classList.contains('is-active'), false,
      'togglePower() OFF must disarm #toggle-freeze button UI');
    assert.ok(emittedToNative.some(e => e.eventName === 'paramChange' && e.payload.id === 'shimmer_freeze' && e.payload.value === 0.0),
      'togglePower() OFF must emit shimmer_freeze: 0.0 to C++');
    assert.strictEqual(app._startingAudioPromise, null,
      'Synchronous JUCE startAudio() IIFE must not leave _startingAudioPromise stuck non-null');

    // Verify repeated Power ON -> OFF -> ON cycles in JUCE mode never Wedge _startingAudioPromise!
    emittedToNative.length = 0;
    await app.togglePower({ emitToNative: true });
    assert.strictEqual(app.isPowerOn, true, 'Second Power ON in JUCE mode must succeed');
    assert.ok(emittedToNative.some(e => e.eventName === 'paramChange' && e.payload.id === 'power' && e.payload.value === 1.0));
    await app.togglePower({ emitToNative: true });
    assert.strictEqual(app.isPowerOn, false);

    // 3. Cancel an in-flight async startAudio() via togglePower() OFF -> power must NOT flip back ON!
    globalThis.window.__IS_JUCE__ = false;
    delete globalThis.window.__JUCE__;
    globalThis.window.location.hostname = 'localhost';
    app.isJuce = false;
    let resolveInit;
    app.engine.init = () => new Promise(r => { resolveInit = r; });
    const startP = app.startAudio({ emitToNative: false });
    assert.strictEqual(app._startingAudio, true);
    await app.togglePower({ emitToNative: false });
    resolveInit();
    await startP;
    assert.strictEqual(app.isPowerOn, false, 'Cancelled in-flight startAudio() must not flip isPowerOn back to true');
  });
});
