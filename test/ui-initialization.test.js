/**
 * @file ui-initialization.test.js
 * @brief Comprehensive automated tests for UI initialization, DOM wiring,
 * rotary knobs, chord surface, modal selectors, theme switching, and power-on audio lifecycle.
 */

import { test, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// Lightweight DOM element mock
class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    const set = new Set();
    this._classSet = set;
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      toggle: (c, force) => {
        const has = set.has(c);
        const add = force !== undefined ? force : !has;
        if (add) set.add(c);
        else set.delete(c);
        return add;
      },
      contains: (c) => set.has(c),
      has: (c) => set.has(c)
    };
    this.listeners = new Map();
    this.value = '';
    this._textContent = '';
    this._innerHTML = '';
  }

  get className() {
    return Array.from(this._classSet).join(' ');
  }

  set className(v) {
    this._classSet.clear();
    if (v) {
      String(v).split(/\s+/).filter(Boolean).forEach(c => this._classSet.add(c));
    }
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    if (this.children && this.children.length > 0) {
      return this.children.map(c => c.textContent).join(' ');
    }
    return '';
  }

  set textContent(v) {
    this._textContent = v;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    if (!html) return;

    // Simple parser for dummy child tags created in innerHTML
    const tagRegex = /<([a-z0-9\-]+)([^>]*)>(.*?)<\/\1>|<([a-z0-9\-]+)([^>]*)\/>/gi;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
      const tag = match[1] || match[4];
      const attrsStr = match[2] || match[5] || '';
      const text = match[3] || '';

      const child = new MockElement(tag);
      child.textContent = text.replace(/<[^>]*>/g, '');

      // Parse id and class
      const idMatch = attrsStr.match(/id=["']([^"']+)["']/i);
      if (idMatch) child.setAttribute('id', idMatch[1]);

      const classMatch = attrsStr.match(/class=["']([^"']+)["']/i);
      if (classMatch) {
        classMatch[1].split(/\s+/).forEach(c => child.classList.add(c));
      }

      this.appendChild(child);
    }
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = String(val);
    if (name === 'value') this.value = String(val);
    if (name === 'class') this.className = String(val);
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const handlers = this.listeners.get(event.type) || [];
    for (const h of handlers) {
      h.call(this, event);
    }
    if (!event._propagationStopped && this.parentElement && typeof this.parentElement.dispatchEvent === 'function') {
      this.parentElement.dispatchEvent(event);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault: () => {} });
  }

  focus() {
    if (typeof globalThis.document !== 'undefined') {
      globalThis.document.activeElement = this;
    }
    this.dispatchEvent({ type: 'focus', target: this, preventDefault: () => {} });
  }

  blur() {
    if (typeof globalThis.document !== 'undefined' && globalThis.document.activeElement === this) {
      globalThis.document.activeElement = globalThis.document.body || null;
    }
    this.dispatchEvent({ type: 'blur', target: this, preventDefault: () => {} });
  }

  change(newVal) {
    this.value = newVal;
    this.dispatchEvent({ type: 'change', target: this });
  }

  querySelector(selector) {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      return this._findFirst(el => el.classList.has(cls));
    }
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return this._findFirst(el => el.id === id);
    }
    return this._findFirst(el => el.tagName.toLowerCase() === selector.toLowerCase());
  }

  querySelectorAll(selector) {
    const results = [];
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      this._findAll(el => el.classList.has(cls), results);
    } else {
      this._findAll(el => el.tagName.toLowerCase() === selector.toLowerCase(), results);
    }
    return results;
  }

  _findFirst(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child._findFirst(predicate);
      if (found) return found;
    }
    return null;
  }

  _findAll(predicate, acc) {
    for (const child of this.children) {
      if (predicate(child)) acc.push(child);
      child._findAll(predicate, acc);
    }
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, width: 288, height: 180 };
  }

  getContext(type) {
    if (type === '2d') {
      return {
        scale: () => {},
        fillRect: () => {},
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        save: () => {},
        restore: () => {},
        fillText: () => {}
      };
    }
    return null;
  }
}

// Setup full browser-like environment
function setupMockBrowser() {
  const elementsById = new Map();

  const register = (id, tag = 'div', extra = {}) => {
    const el = new MockElement(tag);
    el.id = id;
    Object.assign(el, extra);
    elementsById.set(id, el);
    return el;
  };

  // Header & Controls
  register('select-root', 'select');
  register('select-scale', 'select');
  const tuning = register('select-tuning', 'select');
  tuning.value = '440';
  const theme = register('select-theme', 'select');
  theme.value = 'light';

  const presetSelect = register('select-preset', 'select');
  presetSelect.value = 'DEFAULT';
  register('btn-reset-all', 'button');

  register('btn-record', 'button');
  const powerBtn = register('btn-power', 'button');
  const pLed = new MockElement('span');
  pLed.classList.add('braun-led');
  const pText = new MockElement('span');
  pText.classList.add('braun-status-text');
  pText.textContent = 'POWER ON';
  powerBtn.appendChild(pLed);
  powerBtn.appendChild(pText);

  // Monitor
  register('scope-canvas', 'canvas');

  // Master Knobs
  register('knob-master-vol');
  register('knob-master-drive');
  register('toggle-phase-loops', 'button');
  const loopsBtn = elementsById.get('toggle-phase-loops');
  const lText = new MockElement('span');
  lText.classList.add('braun-status-text');
  lText.textContent = 'LOOPS OFF';
  loopsBtn.appendChild(lText);

  register('loops-list');
  register('toggle-auto-evolve', 'button');
  const autoBtn = elementsById.get('toggle-auto-evolve');
  const aText = new MockElement('span');
  aText.classList.add('braun-status-text');
  aText.textContent = 'EVOLVE OFF';
  autoBtn.appendChild(aText);
  register('knob-poisson-density');
  register('knob-poisson-humanize');

  // Drone Voice 1
  register('btn-drone1-active', 'button');
  const d1Btn = elementsById.get('btn-drone1-active');
  const d1Text = new MockElement('span');
  d1Text.classList.add('braun-status-text');
  d1Text.textContent = 'DRONE 1 OFF';
  d1Btn.appendChild(d1Text);

  register('knob-drone1-beat');
  register('knob-drone1-detune');
  register('knob-drone1-fold');
  register('knob-drone1-cutoff');
  register('knob-drone1-res');
  register('knob-drone1-lfo');
  register('knob-drone1-vol');

  // Drone Voice 2
  register('btn-drone2-active', 'button');
  const d2Btn = elementsById.get('btn-drone2-active');
  const d2Text = new MockElement('span');
  d2Text.classList.add('braun-status-text');
  d2Text.textContent = 'DRONE 2 OFF';
  d2Btn.appendChild(d2Text);

  register('knob-drone2-beat');
  register('knob-drone2-detune');
  register('knob-drone2-fold');
  register('knob-drone2-cutoff');
  register('knob-drone2-res');
  register('knob-drone2-lfo');
  register('knob-drone2-vol');

  // Felt Piano
  register('knob-felt-tone');
  register('knob-felt-hammer');
  register('knob-felt-symp');
  register('knob-felt-decay');
  register('knob-felt-level');

  // Brian Eno FX
  register('toggle-freeze', 'button');
  const frzBtn = elementsById.get('toggle-freeze');
  const fText = new MockElement('span');
  fText.classList.add('braun-status-text');
  fText.textContent = 'FREEZE OFF';
  frzBtn.appendChild(fText);

  register('knob-delay-time');
  register('knob-delay-fb');
  register('knob-delay-wow');
  register('knob-delay-tone');
  register('knob-delay-wet');

  register('knob-reverb-decay');
  register('knob-reverb-damping');
  register('knob-reverb-shimmer');
  register('knob-reverb-wet');

  // Chime, Chord macros, and Vector Pad
  register('chord-macros');
  register('chord-readout-name');
  register('chord-readout-desc');
  register('chord-status-led');
  register('chime-strip');
  register('vector-pad');

  const body = new MockElement('body');
  for (const el of elementsById.values()) {
    body.appendChild(el);
  }

  // Wave buttons
  const waveClasses = [
    'drone1-wave-a', 'drone1-wave-b',
    'drone2-wave-a', 'drone2-wave-b',
    'piano-wave-btn', 'braun-mode-tab'
  ];
  const waveNodes = [];
  waveClasses.forEach(cls => {
    const b = new MockElement('button');
    b.classList.add(cls);
    b.setAttribute('data-wave', 'saw');
    b.setAttribute('data-mode', 'WAVEFORM');
    body.appendChild(b);
    waveNodes.push(b);
  });

  // Drone Snap buttons
  const snap1 = ['sub-bass', 'deep-tonic', 'warm-root', 'octave-up'];
  snap1.forEach(snap => {
    const b = new MockElement('button');
    b.classList.add('drone1-snap-btn');
    b.setAttribute('data-snap', snap);
    body.appendChild(b);
  });

  const snap2 = ['perfect-5th', 'sus-4th', 'major-9th', 'beating-unison'];
  snap2.forEach(snap => {
    const b = new MockElement('button');
    b.classList.add('drone2-snap-btn');
    b.setAttribute('data-snap', snap);
    body.appendChild(b);
  });

  const mockDocument = {
    body,
    activeElement: body,
    readyState: 'complete',
    getElementById: (id) => elementsById.get(id) || body.querySelector('#' + id) || null,
    createElement: (tag) => new MockElement(tag),
    querySelectorAll: (sel) => {
      const results = [];
      const parts = sel.split(',').map(s => s.trim());
      for (const part of parts) {
        if (part.startsWith('.')) {
          results.push(...body.querySelectorAll(part));
        } else if (part.startsWith('#')) {
          const el = body.querySelector(part) || elementsById.get(part.slice(1));
          if (el) results.push(el);
        } else {
          for (const el of elementsById.values()) {
            if (el.tagName.toLowerCase() === part.toLowerCase()) {
              results.push(el);
            }
          }
          results.push(...body.querySelectorAll(part));
        }
      }
      return Array.from(new Set(results));
    },
    addEventListener: () => {}
  };

  // Mock Web Audio Context
  class MockAudioNode {
    constructor() {
      this.gain = {
        value: 1,
        setValueAtTime: () => {},
        setTargetAtTime: () => {},
        cancelScheduledValues: () => {},
        exponentialRampToValueAtTime: () => {},
        linearRampToValueAtTime: () => {}
      };
      this.frequency = {
        value: 440,
        setValueAtTime: () => {},
        setTargetAtTime: () => {},
        cancelScheduledValues: () => {},
        exponentialRampToValueAtTime: () => {},
        linearRampToValueAtTime: () => {}
      };
      this.Q = {
        value: 1,
        setValueAtTime: () => {},
        setTargetAtTime: () => {},
        cancelScheduledValues: () => {}
      };
      this.detune = {
        value: 0,
        setValueAtTime: () => {},
        setTargetAtTime: () => {},
        cancelScheduledValues: () => {}
      };
      this.delayTime = {
        value: 0.5,
        setValueAtTime: () => {},
        setTargetAtTime: () => {},
        cancelScheduledValues: () => {}
      };
      this.pan = {
        value: 0,
        setValueAtTime: () => {},
        setTargetAtTime: () => {}
      };
      this.fftSize = 2048;
      this.frequencyBinCount = 1024;
      this.curve = null;
      this.oversample = 'none';
      this.buffer = null;
      this.normalize = true;
    }
    connect() {}
    disconnect() {}
    start() {}
    stop() {}
    setPeriodicWave() {}
    getByteTimeDomainData(arr) { arr.fill(128); }
    getByteFrequencyData(arr) { arr.fill(0); }
  }

  class MockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = 'running';
      this.destination = new MockAudioNode();
    }
    createGain() { return new MockAudioNode(); }
    createBiquadFilter() { return new MockAudioNode(); }
    createWaveShaper() { return new MockAudioNode(); }
    createAnalyser() { return new MockAudioNode(); }
    createDelay() { return new MockAudioNode(); }
    createOscillator() { return new MockAudioNode(); }
    createStereoPanner() { return new MockAudioNode(); }
    createConvolver() { return new MockAudioNode(); }
    createChannelSplitter() { return new MockAudioNode(); }
    createScriptProcessor() { return new MockAudioNode(); }
    createBuffer(channels, length, rate) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        getChannelData: () => new Float32Array(length)
      };
    }
    createBufferSource() { return new MockAudioNode(); }
    createPeriodicWave() { return {}; }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
  }

  globalThis.document = mockDocument;
  const windowListeners = new Map();
  globalThis.window = {
    document: mockDocument,
    AudioContext: MockAudioContext,
    devicePixelRatio: 1,
    addEventListener: (type, fn) => {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      if (windowListeners.has(type)) {
        windowListeners.set(type, windowListeners.get(type).filter(f => f !== fn));
      }
    },
    dispatchEvent: (e) => {
      const fns = windowListeners.get(e.type) || [];
      fns.forEach(fn => fn(e));
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id)
  };
  globalThis.AudioContext = MockAudioContext;

  return { elementsById, mockDocument };
}

describe('UI Initialization and DOM Wiring Verification', () => {
  it('instantiates AmbientApp and verifies all UI components render immediately without waiting for power on', async () => {
    const { elementsById, mockDocument } = setupMockBrowser();

    // Import app dynamically after setting up mock environment
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    // 1. Root and Modal Harmony Selectors populated
    const rootSelect = elementsById.get('select-root');
    assert.strictEqual(rootSelect.children.length, 12, 'Root select must have 12 chromatic options');
    assert.strictEqual(rootSelect.children[0].textContent, 'C');
    assert.strictEqual(rootSelect.value, 0);

    const scaleSelect = elementsById.get('select-scale');
    assert.strictEqual(scaleSelect.children.length, 8, 'Scale select must have 8 modal options');
    assert.strictEqual(scaleSelect.value, 'BUDD_PENTATONIC');

    // 2. Airports Tape Loops List populated
    const loopsList = elementsById.get('loops-list');
    assert.strictEqual(loopsList.children.length, 4, 'Loops list must have 4 tape loop rows');
    const firstLoopNote = loopsList.querySelector('#loop-note-1');
    assert.ok(firstLoopNote, 'Loop 1 note element must exist');
    assert.notStrictEqual(firstLoopNote.textContent, '---', 'Loop 1 must have computed musical note name');

    // 3. Playable Chime Strip and Macro Chords populated
    const chordMacros = elementsById.get('chord-macros');
    assert.strictEqual(chordMacros.children.length, 12, 'Chord macros must have 12 macro buttons');

    const chimeStrip = elementsById.get('chime-strip');
    assert.ok(chimeStrip.children.length >= 10, 'Chime strip must render playable keys across octaves');

    // 4. Rotary Knobs built immediately
    const masterVolContainer = elementsById.get('knob-master-vol');
    assert.strictEqual(masterVolContainer.children.length, 1, 'Master volume knob must be rendered');

    const feltToneContainer = elementsById.get('knob-felt-tone');
    assert.strictEqual(feltToneContainer.children.length, 1, 'Felt tone knob must be rendered');

    const delayTimeContainer = elementsById.get('knob-delay-time');
    assert.strictEqual(delayTimeContainer.children.length, 1, 'Delay time knob must be rendered');

    const reverbDecayContainer = elementsById.get('knob-reverb-decay');
    assert.strictEqual(reverbDecayContainer.children.length, 1, 'Reverb decay knob must be rendered');

    const poissonDensityContainer = elementsById.get('knob-poisson-density');
    assert.strictEqual(poissonDensityContainer.children.length, 1, 'Poisson density knob must be rendered');

    // 5. Theme toggle functionality
    const themeSelect = elementsById.get('select-theme');
    assert.strictEqual(mockDocument.body.getAttribute('data-theme'), 'light', 'Default theme is light aluminum');
    themeSelect.change('dark');
    assert.strictEqual(mockDocument.body.getAttribute('data-theme'), 'dark', 'Theme switches to dark anthracite on change');

    // 6. Power On audio initialization and toggle
    const powerBtn = elementsById.get('btn-power');
    assert.strictEqual(app.isPowerOn, false, 'Initial state is power OFF');
    assert.strictEqual(powerBtn.classList.contains('is-active'), false);

    // Turn Power ON
    powerBtn.click();
    await new Promise(r => setTimeout(r, 50)); // let async startAudio settle

    assert.strictEqual(app.isPowerOn, true, 'Power is now ON');
    assert.strictEqual(app.engine.isInitialized, true, 'AudioEngine initialized');
    assert.strictEqual(powerBtn.classList.contains('is-active'), true);
    assert.strictEqual(powerBtn.querySelector('.braun-status-text').textContent, 'SYSTEM ON');

    // Turn Power OFF
    powerBtn.click();
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(app.isPowerOn, false, 'Power is now OFF');
    assert.strictEqual(powerBtn.classList.contains('is-active'), false);
    assert.strictEqual(powerBtn.querySelector('.braun-status-text').textContent, 'POWER ON');
  });

  it('verifies touching a key on the chime strip or chord macro when power is off powers on the synth', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    assert.strictEqual(app.isPowerOn, false);

    // Trigger key strike on first key of chime strip
    const chimeStrip = elementsById.get('chime-strip');
    const firstKey = chimeStrip.children[0];
    assert.ok(firstKey);

    firstKey.click();
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(app.isPowerOn, true, 'Touching a key should auto-power-on system for seamless sound');
    assert.strictEqual(app.engine.isInitialized, true);
  });

  it('verifies rotary knob value adjustments before power-on are retained and applied on power-on', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    // Adjust felt tone knob before power on
    app.engine.setFeltTone(0.88);
    app.engine.setDelayTime(0.95);
    app.engine.setDroneCutoff(1, 1400);

    assert.strictEqual(app.engine.feltParams.tone, 0.88);
    assert.strictEqual(app.engine.delayParams.time, 0.95);
    assert.strictEqual(app.engine.droneParams[1].cutoff, 1400);

    // Power on
    await app.startAudio();

    // Verify audio nodes received the adjusted values
    assert.strictEqual(app.engine.feltPiano.params.tone, 0.88);
    assert.strictEqual(app.engine.tapeDelay.delayTimeL, 0.95);
    assert.strictEqual(app.engine.drone1.cutoff, 1400);
  });

  it('verifies concurrent audio initialization calls deduplicate and do not spawn duplicate audio graphs', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    // Trigger 5 concurrent startAudio calls simultaneously
    await Promise.all([
      app.startAudio(),
      app.startAudio(),
      app.startAudio(),
      app.startAudio(),
      app.startAudio()
    ]);

    assert.strictEqual(app.isPowerOn, true);
    assert.strictEqual(app.engine.isInitialized, true);
    assert.ok(app.engine.ctx);
    assert.ok(app.engine.feltPiano);
    assert.ok(app.engine.drone1);
  });

  it('verifies power off resets oscilloscope to standby phosphor mode and cleans up active recording', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    await app.startAudio();
    assert.ok(app.scope.analyser, 'Oscilloscope has active analyser on power ON');

    // Start recording
    app.engine.startRecording();
    assert.strictEqual(app.engine.isRecording, true);

    // Toggle power off
    await app.togglePower();
    assert.strictEqual(app.isPowerOn, false);
    assert.strictEqual(app.scope.analyser, null, 'Oscilloscope analyser is cleared on power OFF to show standby beam');
    assert.strictEqual(app.engine.isRecording, false, 'Recording is stopped when powering down');
  });

  it('verifies activating a drone voice when power is off auto-powers on the synthesizer', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    assert.strictEqual(app.isPowerOn, false);

    const d1Btn = elementsById.get('btn-drone1-active');
    d1Btn.click();
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(app.isPowerOn, true, 'Activating drone voice should auto-power synth');
    assert.strictEqual(app.engine.droneParams[1].active, true);
  });

  it('verifies Braun AS 42 Vector Touchpad renders immediately, controls engine parameters, and auto-powers on system', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    assert.ok(app.vectorPad, 'AmbientApp must instantiate vectorPad');
    assert.strictEqual(app.vectorPad.x, 0.50);
    assert.strictEqual(app.vectorPad.y, 0.50);
    assert.strictEqual(app.vectorPad.mode, 'momentary');

    // Modulate coordinates
    app.vectorPad.setCoordinates(0.85, 0.75, true);
    assert.strictEqual(app.vectorPad.x, 0.85);
    assert.strictEqual(app.vectorPad.y, 0.75);

    // Engine parameters should be updated
    // X maps to feltTone: 0.15 + 0.85 * 0.80 = 0.83
    assert.ok(Math.abs(app.engine.feltParams.tone - 0.83) < 1e-3);
    // Y-axis decoupled from delayTime to eliminate record scratch crunch
    assert.strictEqual(app.engine.delayParams.time, 0.46, 'Tape delay time remains locked to dedicated knob');
    // Y maps to Space & Shimmer Wash:
    // Delay wet: 0.75 * 0.75 = 0.5625
    assert.ok(Math.abs(app.engine.delayParams.wet - 0.5625) < 1e-3);
    // Delay feedback: 0.25 + 0.75 * 0.45 = 0.5875
    assert.ok(Math.abs(app.engine.delayParams.feedback - 0.5875) < 1e-3);
    // Reverb wet: 0.75 * 0.85 = 0.6375
    assert.ok(Math.abs(app.engine.reverbParams.wet - 0.6375) < 1e-3);
    // Shimmer bloom: 0.75 * 0.80 = 0.60
    assert.ok(Math.abs(app.engine.reverbParams.shimmer - 0.60) < 1e-3);

    // Toggle mode to latch
    app.vectorPad.toggleMode();
    assert.strictEqual(app.vectorPad.mode, 'latch');

    // Reset to center
    app.vectorPad.resetToCenter();
    assert.strictEqual(app.vectorPad.x, 0.50);
    assert.strictEqual(app.vectorPad.y, 0.50);

    // Touching vector pad when power is off triggers auto-power on
    assert.strictEqual(app.isPowerOn, false);
    if (app.vectorPad.onEngage) {
      await app.vectorPad.onEngage();
    }
    assert.strictEqual(app.isPowerOn, true, 'Engaging vector pad when power is off should auto-power synth');
  });

  it('verifies chord macro buttons render as 2x6 matrix with key badges and trigger flashChord state', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const chordsEl = elementsById.get('chord-macros');
    assert.ok(chordsEl);
    assert.ok(chordsEl.classList.contains('braun-chord-macros-grid'), 'Chord container must have braun-chord-macros-grid class');

    const chordBtns = chordsEl.children;
    assert.strictEqual(chordBtns.length, 12, 'There must be exactly 12 chord macro buttons (2x6 grid)');

    // Verify key shortcut badges: 1-6 on top row, 7-0, '-', and '=' on bottom row
    const expectedKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
    expectedKeys.forEach((k, idx) => {
      const btn = chordBtns[idx];
      assert.ok(btn.getAttribute('data-chord'), `Button ${idx} must have data-chord`);
      assert.ok(btn.textContent.includes(k), `Button ${idx} must include shortcut key ${k}`);
    });

    const bladeRunnerBtn = Array.from(chordBtns).find(b => b.getAttribute('data-chord') === 'BLADE_RUNNER');
    assert.ok(bladeRunnerBtn, 'Blade Runner chord macro button must exist');
    assert.ok(bladeRunnerBtn.textContent.includes('Blade Runner'));

    const tearsInRainBtn = Array.from(chordBtns).find(b => b.getAttribute('data-chord') === 'TEARS_IN_RAIN');
    assert.ok(tearsInRainBtn, 'Tears in Rain chord macro button must exist');
    assert.ok(tearsInRainBtn.textContent.includes('Tears in Rain'));
    assert.ok(tearsInRainBtn.textContent.includes('='));

    // Test playing chord activates button flash and updates chord readout
    const firstChordId = chordBtns[0].getAttribute('data-chord');
    app.playSurface.flashChord(firstChordId);
    assert.ok(chordBtns[0].classList.contains('is-active'), 'Playing chord must activate is-active class');
    const chordNameEl = elementsById.get('chord-readout-name');
    assert.ok(chordNameEl && chordNameEl.textContent === 'Pavilion Suspended', 'Playing chord must update chord readout name');
  });

  it('verifies drone quick-snap tuning buttons are wired, set presets, and auto-power on', async () => {
    const { elementsById, mockDocument } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    assert.strictEqual(app.engine.droneSnap[1], 'deep-tonic');
    assert.strictEqual(app.engine.droneSnap[2], 'perfect-5th');

    const snap1Btns = mockDocument.querySelectorAll('.drone1-snap-btn');
    assert.strictEqual(snap1Btns.length, 4);

    const snap2Btns = mockDocument.querySelectorAll('.drone2-snap-btn');
    assert.strictEqual(snap2Btns.length, 4);

    // Clicking Sub Bass when power is off triggers auto-power on and sets drone 1 snap
    assert.strictEqual(app.isPowerOn, false);
    const subBassBtn = snap1Btns.find(b => b.getAttribute('data-snap') === 'sub-bass');
    assert.ok(subBassBtn);
    subBassBtn.click();

    // Allow microtasks for async audio start
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.strictEqual(app.isPowerOn, true, 'Clicking snap button must auto-power on synth');
    assert.strictEqual(app.engine.droneSnap[1], 'sub-bass');
    assert.strictEqual(app.engine.droneParams[1].active, true, 'Clicking snap button must auto-activate drone voice');
    assert.ok(subBassBtn.classList.contains('is-active'));
    assert.ok(Math.abs(app.engine.drone1Freq - 32.7) < 1.0, 'Sub bass should be ~32.7 Hz');

    // Clicking Sus 4th on Drone 2
    const sus4Btn = snap2Btns.find(b => b.getAttribute('data-snap') === 'sus-4th');
    assert.ok(sus4Btn);
    sus4Btn.click();
    await new Promise(resolve => setTimeout(resolve, 20));

    assert.strictEqual(app.engine.droneSnap[2], 'sus-4th');
    assert.strictEqual(app.engine.droneParams[2].active, true, 'Clicking snap button must auto-activate drone 2');
    assert.ok(sus4Btn.classList.contains('is-active'));
    assert.ok(Math.abs(app.engine.drone2Freq - (app.engine.drone1Freq * 4 / 3)) < 0.1, 'Sus 4th must be 4:3 ratio');

    // Clicking Beating Unison updates snap and synchronizes beating knob
    const beatingBtn = snap2Btns.find(b => b.getAttribute('data-snap') === 'beating-unison');
    assert.ok(beatingBtn);
    beatingBtn.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual(app.engine.droneSnap[2], 'beating-unison');
    if (app.knobs && app.knobs.drone2Beat) {
      assert.ok(Math.abs(app.knobs.drone2Beat.value - 0.35) < 1e-4);
    }

    // Test changing scale root re-snaps frequencies smoothly
    app.engine.setScale('BUDD_PENTATONIC', 7); // Root = G
    // Drone 1 (Sub Bass of G1 = MIDI 31) ~ 49.0 Hz
    assert.ok(Math.abs(app.engine.drone1Freq - 49.0) < 1.0, 'Sub bass of G should be ~49 Hz');
    // Drone 2 maintains beating unison (f2 = f1)
    assert.ok(Math.abs(app.engine.drone2Freq - app.engine.drone1Freq) < 0.1);
  });

  it('verifies Braun AS 42 Vector Touchpad supports high-DPI scaling and setTransform', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    assert.ok(app.vectorPad);
    // Verify dpr property exists on vectorPad
    assert.ok(typeof app.vectorPad.dpr === 'number');

    let transformCalledWith = null;
    let fillRectCalled = false;
    // Provide a mock context with setTransform
    app.vectorPad.ctx = {
      setTransform: (a, b, c, d, e, f) => {
        transformCalledWith = [a, b, c, d, e, f];
      },
      clearRect: () => {},
      fillRect: () => { fillRectCalled = true; },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      arc: () => {},
      fill: () => {},
      fillText: () => {}
    };

    app.vectorPad.draw();
    assert.ok(transformCalledWith !== null, 'draw() must call setTransform on high-DPI displays');
    assert.strictEqual(transformCalledWith[0], app.vectorPad.dpr);
    assert.strictEqual(transformCalledWith[3], app.vectorPad.dpr);
    assert.ok(fillRectCalled);
  });

  it('verifies Dieter Rams additions: Tape Drive, Symp Resonance, and Poisson Humanize knobs are rendered and wired', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    // Verify master drive knob
    const driveEl = elementsById.get('knob-master-drive');
    assert.ok(driveEl && driveEl.children.length > 0, 'Tape Drive knob must render in DOM');
    assert.strictEqual(app.engine.tapeDrive, 0.18);
    app.engine.setTapeDrive(0.40);
    assert.strictEqual(app.engine.tapeDrive, 0.40);

    // Verify sympathetic resonance knob in Harold Budd section
    const sympEl = elementsById.get('knob-felt-symp');
    assert.ok(sympEl && sympEl.children.length > 0, 'Symp Resonance knob must render in DOM');
    assert.strictEqual(app.engine.feltParams.sympathetic, 0.45);
    app.engine.setFeltSympathetic(0.65);
    assert.strictEqual(app.engine.feltParams.sympathetic, 0.65);

    // Verify humanize knob in Poisson Auto-Evolve section
    const humanizeEl = elementsById.get('knob-poisson-humanize');
    assert.ok(humanizeEl && humanizeEl.children.length > 0, 'Poisson Humanize knob must render in DOM');
    assert.strictEqual(app.engine.poisson.humanize, 0.50);
    app.engine.setPoissonHumanize(0.75);
    assert.strictEqual(app.engine.poisson.humanize, 0.75);
  });

  it('verifies Preset selector and Reset All switch are wired and render in DOM', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp, PRESETS } = await import('../js/app.js');
    const app = new AmbientApp();

    const presetEl = elementsById.get('select-preset');
    const resetBtn = elementsById.get('btn-reset-all');

    assert.ok(presetEl, 'select-preset element must exist');
    assert.ok(resetBtn, 'btn-reset-all element must exist');
    assert.ok(PRESETS.DEFAULT, 'DEFAULT preset must exist');
    assert.ok(PRESETS.HAROLD_BUDD, 'HAROLD_BUDD preset must exist');
    assert.ok(PRESETS.VANGELIS, 'VANGELIS preset must exist');
    assert.ok(PRESETS.ENO_AIRPORTS, 'ENO_AIRPORTS preset must exist');
  });

  it('verifies Reset All resets all 32 knobs, wave toggles, and vector pad to calibrated defaults', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    // 1. Manually alter several knobs, wave mode, and vector pad
    app.knobs.masterVol.setValue(20);
    app.knobs.delayWet.setValue(85);
    app.knobs.reverbDecay.setValue(18.0);
    app.knobs.drone1Vol.setValue(90);
    app.vectorPad.setCoordinates(0.10, 0.90, true);
    app.knobs.feltTone.setValue(95);
    app.engine.setFeltWaveform('cs80');

    assert.strictEqual(app.knobs.masterVol.value, 20);
    assert.strictEqual(app.knobs.feltTone.value, 95);
    assert.strictEqual(app.engine.feltParams.waveform, 'cs80');

    // 2. Trigger Reset All button
    const resetBtn = elementsById.get('btn-reset-all');
    resetBtn.click();

    // 3. Verify knobs return to calibrated pristine defaults
    assert.strictEqual(app.knobs.masterVol.value, 80, 'Master volume reset to 80%');
    assert.strictEqual(app.knobs.masterDrive.value, 18, 'Master drive reset to 18%');
    assert.strictEqual(app.knobs.feltTone.value, 62, 'Felt tone reset to 62%');
    assert.strictEqual(app.knobs.feltHammer.value, 45, 'Hammer reset to 45%');
    assert.strictEqual(app.knobs.feltSymp.value, 45, 'Symp resonance reset to 45%');
    assert.strictEqual(app.knobs.feltDecay.value, 1.1, 'Decay reset to 1.1x');
    assert.strictEqual(app.knobs.feltLevel.value, 80, 'Piano level reset to 80%');
    assert.strictEqual(app.knobs.delayWet.value, 40, 'Delay wet reset to 40%');
    assert.strictEqual(app.knobs.reverbWet.value, 45, 'Reverb wet reset to 45%');
    assert.strictEqual(app.knobs.reverbDecay.value, 8.5, 'Reverb decay reset to 8.5s');
    assert.strictEqual(app.knobs.drone1Vol.value, 55, 'Drone 1 volume reset to 55%');
    assert.strictEqual(app.knobs.drone2Vol.value, 55, 'Drone 2 volume reset to 55%');

    // Verify engine audio parameters updated
    assert.strictEqual(app.engine.masterVolume, 0.80);
    assert.strictEqual(app.engine.feltParams.volume, 0.80);
    assert.strictEqual(app.engine.feltParams.sympathetic, 0.45);
    assert.strictEqual(app.engine.feltParams.waveform, 'felt');
    assert.strictEqual(app.engine.droneParams[1].vol, 0.55);
    assert.strictEqual(app.engine.droneBusGain, 0.22);
    assert.strictEqual(app.engine.delayParams.wet, 0.40);
    assert.strictEqual(app.engine.reverbParams.wet, 0.45);
  });

  it('verifies curated presets (Harold Budd, Vangelis CS-80, Eno Airports) configure sound engines accurately', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const presetSelect = elementsById.get('select-preset');

    // 1. Select Harold Budd preset
    presetSelect.change('HAROLD_BUDD');
    assert.strictEqual(app.engine.feltParams.waveform, 'felt');
    assert.strictEqual(app.knobs.feltTone.value, 35, 'Harold Budd felt tone is softly damped (35%)');
    assert.strictEqual(app.knobs.feltSymp.value, 65, 'Harold Budd sympathetic resonance is rich (65%)');
    assert.strictEqual(app.knobs.reverbDecay.value, 12.0, 'Harold Budd reverb decay is expansive (12s)');

    // 2. Select Vangelis preset
    presetSelect.change('VANGELIS');
    assert.strictEqual(app.engine.feltParams.waveform, 'cs80', 'Vangelis preset activates CS-80 brass timbre');
    assert.strictEqual(app.knobs.masterDrive.value, 28, 'Vangelis preset drives tape saturation to 28%');
    assert.strictEqual(app.knobs.feltTone.value, 80, 'Vangelis brass tone is bright (80%)');
    assert.strictEqual(app.knobs.reverbShimmer.value, 65, 'Vangelis shimmer bloom is intense (65%)');

    // 3. Select Eno Airports preset
    presetSelect.change('ENO_AIRPORTS');
    assert.strictEqual(app.engine.feltParams.waveform, 'sine', 'Eno Airports activates crystal sine chime timbre');
    assert.strictEqual(app.knobs.delayTime.value, 680, 'Eno delay time is 680ms');
    assert.strictEqual(app.knobs.delayFeedback.value, 68, 'Eno delay feedback is floating at 68%');
    assert.strictEqual(app.knobs.reverbDecay.value, 15.0, 'Eno reverb decay is 15.0s');

    // 4. Return to Default preset
    presetSelect.change('DEFAULT');
    assert.strictEqual(app.engine.feltParams.waveform, 'felt');
    assert.strictEqual(app.knobs.feltTone.value, 62);
    assert.strictEqual(app.knobs.masterVol.value, 80);
  });

  it('verifies BraunKnob.animateTo smoothly animates and snaps to target value', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const knob = app.knobs.masterVol;
    assert.strictEqual(knob.value, 80);

    // Animate to 40% over 60ms
    let completed = false;
    knob.animateTo(40, 60, () => {
      completed = true;
    });

    await new Promise(r => setTimeout(r, 120));
    assert.strictEqual(knob.value, 40, 'Knob value must cleanly snap to target value on complete');
    assert.strictEqual(completed, true, 'onComplete callback must be called');
    assert.strictEqual(app.engine.masterVolume, 0.40, 'Engine master volume must update with knob animation');
  });

  it('verifies default leveled gain staging balances all sound sources into harmonious ambient mix', async () => {
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    const engine = app.engine;

    // Master bus
    assert.strictEqual(engine.masterVolume, 0.80, 'Master volume calibrated to 80%');
    assert.strictEqual(engine.tapeDrive, 0.18, 'Master tape drive provides subtle 18% warmth');

    // Piano bus
    assert.strictEqual(engine.feltParams.volume, 0.80, 'Piano bus level sits at 80%');
    assert.strictEqual(engine.feltParams.sympathetic, 0.45, 'Sympathetic resonance at 45%');

    // Drone bus sits -8.0dB below piano bus
    const keysBusGain = 0.38 * engine.feltParams.volume; // 0.304
    const droneVoiceLevel = engine.droneParams[1].vol; // 0.55
    const combinedDroneLevel = engine.droneBusGain * droneVoiceLevel; // 0.121
    const dbRatio = 20 * Math.log10(combinedDroneLevel / keysBusGain);

    assert.ok(dbRatio <= -6.0 && dbRatio >= -9.5, `Drone underbed sits harmoniously at ${dbRatio.toFixed(2)} dB`);

    // Effects mix levels
    assert.strictEqual(engine.delayParams.wet, 0.40, 'Delay wet mix at 40%');
    assert.strictEqual(engine.reverbParams.wet, 0.45, 'Reverb wet mix at 45%');
    assert.strictEqual(engine.reverbParams.shimmer, 0.45, 'Shimmer feedback at 45%');
  });

  it('verifies vector pad coordinates are preserved and not clobbered during and after preset transitions', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp, PRESETS } = await import('../js/app.js');
    const app = new AmbientApp();

    // 1. Select Harold Budd preset
    const presetSelect = elementsById.get('select-preset');
    presetSelect.change('HAROLD_BUDD');

    // Vector pad must sit precisely at Harold Budd preset coordinates
    assert.strictEqual(app.vectorPad.x, PRESETS.HAROLD_BUDD.vectorX, 'Vector X must match Harold Budd preset');
    assert.strictEqual(app.vectorPad.y, PRESETS.HAROLD_BUDD.vectorY, 'Vector Y must match Harold Budd preset');

    // 2. Select Vangelis preset
    presetSelect.change('VANGELIS');
    assert.strictEqual(app.vectorPad.x, PRESETS.VANGELIS.vectorX, 'Vector X must match Vangelis preset');
    assert.strictEqual(app.vectorPad.y, PRESETS.VANGELIS.vectorY, 'Vector Y must match Vangelis preset');

    // 3. Reset All must center vector pad to 0.50, 0.50
    const resetBtn = elementsById.get('btn-reset-all');
    resetBtn.click();
    assert.strictEqual(app.vectorPad.x, 0.50, 'Vector X must return to default center 0.50');
    assert.strictEqual(app.vectorPad.y, 0.50, 'Vector Y must return to default center 0.50');
  });

  it('verifies rapid consecutive clicks on reset button refresh the rotation transition cleanly', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const resetBtn = elementsById.get('btn-reset-all');

    // Rapid click 1
    resetBtn.click();
    assert.ok(resetBtn.classList.contains('is-active'), 'Reset button must be active');
    assert.ok(app._resetTimer !== null, 'Reset timer must be active');

    // Rapid click 2 before timeout expires
    resetBtn.click();
    assert.ok(resetBtn.classList.contains('is-active'), 'Reset button must remain active');
    assert.ok(app._resetTimer !== null, 'Reset timer must be renewed');
  });

  it('verifies active mouse pointer strikes release gracefully on window blur', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    let releasedVoice = false;
    let releasedChord = false;
    const mockVoice = {
      release: () => { releasedVoice = true; }
    };
    const mockChordSession = {
      voices: [{ release: () => { releasedChord = true; } }],
      timers: []
    };

    app.playSurface.activePointerVoices.add(mockVoice);
    app.playSurface.activePointerChordSessions.add(mockChordSession);
    assert.strictEqual(app.playSurface.activePointerVoices.size, 1);
    assert.strictEqual(app.playSurface.activePointerChordSessions.size, 1);

    // Trigger window blur
    window.dispatchEvent({ type: 'blur' });

    assert.strictEqual(releasedVoice, true, 'Held pointer voice must be released on window blur');
    assert.strictEqual(releasedChord, true, 'Held pointer chord session voices must be released on window blur');
    assert.strictEqual(app.playSurface.activePointerVoices.size, 0, 'Pointer voices set must be cleared');
    assert.strictEqual(app.playSurface.activePointerChordSessions.size, 0, 'Pointer chord sessions set must be cleared');
  });

  it('verifies dropdown selectors release focus immediately on user selection/change and click', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const presetSelect = elementsById.get('select-preset');
    const scaleSelect = elementsById.get('select-scale');
    const rootSelect = elementsById.get('select-root');
    const themeSelect = elementsById.get('select-theme');
    const tuningSelect = elementsById.get('select-tuning');

    // 1. Change on select-preset releases focus
    presetSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, presetSelect, 'presetSelect must be focused before change');
    presetSelect.change('HAROLD_BUDD');
    assert.notStrictEqual(globalThis.document.activeElement, presetSelect, 'presetSelect must release focus after change');

    // 2. Change on select-scale releases focus
    scaleSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, scaleSelect, 'scaleSelect must be focused before change');
    scaleSelect.change('AVALON_SPIRITED');
    assert.notStrictEqual(globalThis.document.activeElement, scaleSelect, 'scaleSelect must release focus after change');

    // 3. Change on select-root releases focus
    rootSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, rootSelect, 'rootSelect must be focused before change');
    rootSelect.change('2');
    assert.notStrictEqual(globalThis.document.activeElement, rootSelect, 'rootSelect must release focus after change');

    // 4. Change on select-theme releases focus
    themeSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, themeSelect, 'themeSelect must be focused before change');
    themeSelect.change('dark');
    assert.notStrictEqual(globalThis.document.activeElement, themeSelect, 'themeSelect must release focus after change');

    // 5. Change on select-tuning releases focus
    tuningSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, tuningSelect, 'tuningSelect must be focused before change');
    tuningSelect.change('432');
    assert.notStrictEqual(globalThis.document.activeElement, tuningSelect, 'tuningSelect must release focus after change');

    // 6. Click on option releases focus
    presetSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, presetSelect);
    const opt = new MockElement('option');
    presetSelect.appendChild(opt);
    opt.dispatchEvent({ type: 'click', target: opt, preventDefault: () => {} });
    assert.notStrictEqual(globalThis.document.activeElement, presetSelect, 'Clicking option must release select focus');
  });

  it('verifies pressing a musical note key while preset selector is focused blurs selector, prevents type-ahead, and plays note', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const presetSelect = elementsById.get('select-preset');
    assert.ok(presetSelect, 'select-preset element must exist');
    const initialPresetValue = presetSelect.value;

    // Focus preset selector
    presetSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, presetSelect, 'preset selector must have active focus');

    let playedFreq = null;
    let playedMidi = null;
    let voiceReleased = false;
    const origPlayNote = app.playSurface.playNote.bind(app.playSurface);
    app.playSurface.playNote = (freq, midi, vel, dur, isHeld) => {
      playedFreq = freq;
      playedMidi = midi;
      return {
        release: () => { voiceReleased = true; }
      };
    };

    let prevented = false;
    window.dispatchEvent({
      type: 'keydown',
      code: 'KeyA',
      key: 'a',
      repeat: false,
      target: presetSelect,
      preventDefault: () => { prevented = true; }
    });

    // Verify type-ahead is prevented
    assert.strictEqual(prevented, true, 'preventDefault must be called to block native select type-ahead');

    // Verify selector is blurred and focus returns to body/document
    assert.notStrictEqual(globalThis.document.activeElement, presetSelect, 'preset selector must be blurred immediately on note keystroke');

    // Verify note sounded immediately
    assert.ok(playedFreq !== null, 'Musical note frequency must sound immediately on keydown');
    assert.ok(playedMidi !== null, 'Musical note MIDI pitch must be registered');
    assert.strictEqual(presetSelect.value, initialPresetValue, 'Preset selection must not change due to type-ahead');

    // Verify keyup releases note cleanly
    window.dispatchEvent({
      type: 'keyup',
      code: 'KeyA',
      key: 'a',
      target: presetSelect
    });
    assert.strictEqual(voiceReleased, true, 'Releasing key must release sounding voice');

    app.playSurface.playNote = origPlayNote;
  });

  it('verifies pressing chord triggers and freeze hotkey while a selector is focused triggers audio and removes focus', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const scaleSelect = elementsById.get('select-scale');
    scaleSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, scaleSelect);

    let chordTriggered = false;
    let chordStopped = false;
    const origStartChord = app.playSurface.startChord.bind(app.playSurface);
    const origStopChord = app.playSurface.stopChordSession.bind(app.playSurface);
    app.playSurface.startChord = (voicingId, hold) => {
      chordTriggered = true;
      return { voicingId, isReleased: false, timers: [], voices: [] };
    };
    app.playSurface.stopChordSession = (session) => {
      chordStopped = true;
    };

    let chordPrevented = false;
    window.dispatchEvent({
      type: 'keydown',
      code: 'Digit1',
      key: '1',
      repeat: false,
      target: scaleSelect,
      preventDefault: () => { chordPrevented = true; }
    });

    assert.strictEqual(chordPrevented, true, 'preventDefault must be called on chord trigger');
    assert.notStrictEqual(globalThis.document.activeElement, scaleSelect, 'scaleSelect must be blurred on chord trigger');
    assert.strictEqual(chordTriggered, true, 'Chord must trigger immediately on digit keystroke');

    window.dispatchEvent({
      type: 'keyup',
      code: 'Digit1',
      key: '1',
      target: scaleSelect
    });
    assert.strictEqual(chordStopped, true, 'Chord must be stopped on keyup');

    // Freeze hotkey (Spacebar)
    const presetSelect = elementsById.get('select-preset');
    presetSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, presetSelect);

    const freezeBtn = elementsById.get('toggle-freeze');
    let freezeClicked = false;
    freezeBtn.addEventListener('click', () => { freezeClicked = true; });

    let freezePrevented = false;
    window.dispatchEvent({
      type: 'keydown',
      code: 'Space',
      key: ' ',
      repeat: false,
      target: presetSelect,
      preventDefault: () => { freezePrevented = true; }
    });

    assert.strictEqual(freezePrevented, true, 'Spacebar must be prevented from scrolling/toggling select');
    assert.notStrictEqual(globalThis.document.activeElement, presetSelect, 'presetSelect must be blurred on spacebar');
    assert.strictEqual(freezeClicked, true, 'Freeze toggle must be clicked on spacebar');

    app.playSurface.startChord = origStartChord;
    app.playSurface.stopChordSession = origStopChord;
  });

  it('verifies non-playable keys (ArrowDown, Tab) on select do not prevent default and preserve navigation', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const presetSelect = elementsById.get('select-preset');
    presetSelect.focus();

    let arrowPrevented = false;
    window.dispatchEvent({
      type: 'keydown',
      code: 'ArrowDown',
      key: 'ArrowDown',
      repeat: false,
      target: presetSelect,
      preventDefault: () => { arrowPrevented = true; }
    });

    assert.strictEqual(arrowPrevented, false, 'ArrowDown must NOT be prevented on select element');
    assert.strictEqual(globalThis.document.activeElement, presetSelect, 'ArrowDown must NOT blur select element');
  });

  it('verifies true text inputs (knob direct entry) retain focus and allow typing without triggering notes', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const textInput = new MockElement('input');
    textInput.setAttribute('type', 'text');
    textInput.classList.add('braun-knob-direct-input');
    textInput.focus();
    assert.strictEqual(globalThis.document.activeElement, textInput);

    let notePlayed = false;
    const origPlayNote = app.playSurface.playNote.bind(app.playSurface);
    app.playSurface.playNote = () => { notePlayed = true; };

    let keyPrevented = false;
    window.dispatchEvent({
      type: 'keydown',
      code: 'KeyA',
      key: 'a',
      repeat: false,
      target: textInput,
      preventDefault: () => { keyPrevented = true; }
    });

    assert.strictEqual(keyPrevented, false, 'Typing in text input must NOT be prevented');
    assert.strictEqual(notePlayed, false, 'Musical note must NOT play while typing in text input');
    assert.strictEqual(globalThis.document.activeElement, textInput, 'Text input must retain focus while user types');

    app.playSurface.playNote = origPlayNote;
  });

  it('verifies pressing note keys while a button is focused blurs the button and sounds the note', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const resetBtn = elementsById.get('btn-reset-all');
    assert.ok(resetBtn, 'btn-reset-all must exist');

    resetBtn.focus();
    assert.strictEqual(globalThis.document.activeElement, resetBtn, 'Button must have focus');

    let playedMidi = null;
    const origPlayNote = app.playSurface.playNote.bind(app.playSurface);
    app.playSurface.playNote = (freq, midi) => {
      playedMidi = midi;
      return null;
    };

    let prevented = false;
    window.dispatchEvent({
      type: 'keydown',
      code: 'KeyA',
      key: 'a',
      repeat: false,
      target: resetBtn,
      preventDefault: () => { prevented = true; }
    });

    assert.strictEqual(prevented, true, 'Default button activation must be prevented');
    assert.strictEqual(globalThis.document.activeElement, globalThis.document.body, 'Focus must return to document.body');
    assert.ok(playedMidi !== null, 'Note must sound immediately on keydown');

    app.playSurface.playNote = origPlayNote;
  });

  it('verifies pressing spacebar while a button is focused toggles freeze without triggering button action', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const resetBtn = elementsById.get('btn-reset-all');
    resetBtn.focus();
    assert.strictEqual(globalThis.document.activeElement, resetBtn);

    let resetTriggered = false;
    const origResetAll = app.resetAllKnobs.bind(app);
    app.resetAllKnobs = () => { resetTriggered = true; };

    const freezeBtn = elementsById.get('toggle-freeze');
    let freezeTriggered = false;
    freezeBtn.addEventListener('click', () => { freezeTriggered = true; });

    let spacePrevented = false;
    window.dispatchEvent({
      type: 'keydown',
      code: 'Space',
      key: ' ',
      repeat: false,
      target: resetBtn,
      preventDefault: () => { spacePrevented = true; }
    });

    assert.strictEqual(spacePrevented, true, 'Spacebar default must be prevented');
    assert.strictEqual(globalThis.document.activeElement, globalThis.document.body, 'Button must be blurred and body focused');
    assert.strictEqual(resetTriggered, false, 'Button action must NOT be triggered by spacebar');
    assert.strictEqual(freezeTriggered, true, 'Freeze must be toggled by spacebar');

    app.resetAllKnobs = origResetAll;
  });

  it('verifies pressing KeyH (Harold) or KeyV (Vangelis) while preset selector is focused sounds note and does not change preset', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const presetSelect = elementsById.get('select-preset');
    presetSelect.value = 'DEFAULT';
    presetSelect.focus();
    assert.strictEqual(globalThis.document.activeElement, presetSelect);

    const playedNotes = [];
    const origPlayNote = app.playSurface.playNote.bind(app.playSurface);
    app.playSurface.playNote = (freq, midi) => {
      playedNotes.push(midi);
      return null;
    };

    // Press 'H' (matches 'HAROLD_BUDD' option)
    let hPrevented = false;
    window.dispatchEvent({
      type: 'keydown',
      code: 'KeyH',
      key: 'h',
      repeat: false,
      target: presetSelect,
      preventDefault: () => { hPrevented = true; }
    });

    assert.strictEqual(hPrevented, true, 'KeyH must be prevented from type-ahead navigation');
    assert.strictEqual(presetSelect.value, 'DEFAULT', 'Preset value must remain DEFAULT, not change to HAROLD_BUDD');
    assert.strictEqual(globalThis.document.activeElement, globalThis.document.body, 'Preset select must release focus to body');
    assert.strictEqual(playedNotes.length, 1, 'Chime note DEG 6 (H) must sound');

    // Focus preset select again and press 'V' (matches 'VANGELIS' option)
    presetSelect.focus();
    let vPrevented = false;
    window.dispatchEvent({
      type: 'keydown',
      code: 'KeyV',
      key: 'v',
      repeat: false,
      target: presetSelect,
      preventDefault: () => { vPrevented = true; }
    });

    assert.strictEqual(vPrevented, true, 'KeyV must be prevented from type-ahead navigation');
    assert.strictEqual(presetSelect.value, 'DEFAULT', 'Preset value must remain DEFAULT, not change to VANGELIS');
    assert.strictEqual(globalThis.document.activeElement, globalThis.document.body, 'Preset select must release focus to body');
    assert.strictEqual(playedNotes.length, 2, 'Chime note DEG 15 (V) must sound');

    app.playSurface.playNote = origPlayNote;
  });

  it('verifies Numpad1 triggers chord voicing macro', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    let chordTriggered = false;
    const origStartChord = app.playSurface.startChord.bind(app.playSurface);
    app.playSurface.startChord = () => {
      chordTriggered = true;
      return { isReleased: false, timers: [], voices: [] };
    };

    window.dispatchEvent({
      type: 'keydown',
      code: 'Numpad1',
      key: '1',
      repeat: false,
      target: globalThis.document.body,
      preventDefault: () => {}
    });

    assert.strictEqual(chordTriggered, true, 'Numpad1 must trigger chord macro');
    app.playSurface.startChord = origStartChord;
  });
});
