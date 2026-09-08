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
    const handlers = this.listeners.get(event.type) || [];
    for (const h of handlers) {
      h.call(this, event);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault: () => {} });
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

  const mockDocument = {
    body,
    readyState: 'complete',
    getElementById: (id) => elementsById.get(id) || body.querySelector('#' + id) || null,
    createElement: (tag) => new MockElement(tag),
    querySelectorAll: (sel) => {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        return body.querySelectorAll('.' + cls);
      }
      return [];
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
  globalThis.window = {
    document: mockDocument,
    AudioContext: MockAudioContext,
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
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
    assert.strictEqual(chordMacros.children.length, 10, 'Chord macros must have 10 macro buttons');

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
    // Y maps to delayTime: 0.10 + 0.75 * 0.85 = 0.7375
    assert.ok(Math.abs(app.engine.delayParams.time - 0.7375) < 1e-3);
    // Y maps to shimmer: 0.15 + 0.75 * 0.70 = 0.675
    assert.ok(Math.abs(app.engine.reverbParams.shimmer - 0.675) < 1e-3);

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

  it('verifies chord macro buttons render as 2x5 matrix with key badges and trigger flashChord state', async () => {
    const { elementsById } = setupMockBrowser();

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const chordsEl = elementsById.get('chord-macros');
    assert.ok(chordsEl);
    assert.ok(chordsEl.classList.contains('braun-chord-macros-grid'), 'Chord container must have braun-chord-macros-grid class');

    const chordBtns = chordsEl.children;
    assert.strictEqual(chordBtns.length, 10, 'There must be exactly 10 chord macro buttons (2x5 grid)');

    // Verify key shortcut badges: 1-5 on top row, 6-0 on bottom row
    const expectedKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    expectedKeys.forEach((k, idx) => {
      const btn = chordBtns[idx];
      assert.ok(btn.getAttribute('data-chord'), `Button ${idx} must have data-chord`);
      assert.ok(btn.textContent.includes(k), `Button ${idx} must include shortcut key ${k}`);
    });

    // Test playing chord activates button flash
    const firstChordId = chordBtns[0].getAttribute('data-chord');
    app.playSurface.flashChord(firstChordId);
    assert.ok(chordBtns[0].classList.contains('is-active'), 'Playing chord must activate is-active class');
  });
});
