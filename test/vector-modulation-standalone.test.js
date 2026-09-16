/**
 * @file vector-modulation-standalone.test.js
 * @brief Unit and end-to-end integration verification tests for Braun AS 42
 * vector touchpad modulation across Web Audio and standalone JUCE / C++ environments.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BraunVectorPad } from '../js/ui/vector-pad.js';
import { AmbientApp } from '../js/app.js';

// Minimal mock DOM for headless testing
function setupMockDOM() {
  const elements = {};
  const createElement = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        toggle(c, force) {
          if (force !== undefined) {
            if (force) this._classes.add(c);
            else this._classes.delete(c);
            return force;
          }
          if (this._classes.has(c)) {
            this._classes.delete(c);
            return false;
          }
          this._classes.add(c);
          return true;
        },
        contains(c) { return this._classes.has(c); }
      },
      style: {},
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      removeAttribute(k) { delete this.attributes[k]; },
      innerHTML: '',
      textContent: '',
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        return child;
      },
      querySelector: (selector) => {
        if (selector === '.braun-vector-canvas') return { getContext: () => ({ fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {}, fillText() {} }) };
        return createElement('div');
      },
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 340, height: 152, right: 340, bottom: 152 })
    };
    return el;
  };

  globalThis.document = {
    createElement,
    getElementById: (id) => elements[id] || (elements[id] = createElement('div')),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: createElement('body'),
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id)
  };

  return elements;
}

describe('BraunVectorPad Modulation Logic & Engine Fallback', () => {
  it('calls onChange with full modulation payload even when engine is null', () => {
    setupMockDOM();
    const container = document.createElement('div');
    let emittedData = null;

    const pad = new BraunVectorPad(container, {
      engine: null,
      onChange: (data) => { emittedData = data; }
    });

    // Move to (0.75, 0.40)
    pad.setCoordinates(0.75, 0.40, true);

    assert.ok(emittedData !== null, 'onChange must be called even when engine is null');
    assert.strictEqual(emittedData.x, 0.75);
    assert.strictEqual(emittedData.y, 0.40);

    // X Axis: Felt Tone (0.15 + 0.75 * 0.80 = 0.75)
    assert.ok(Math.abs(emittedData.feltTone - 0.75) < 1e-4);

    // Drone Cutoff Tracking
    // drone1Cutoff: 200 + 0.75 * 3200 = 2600
    assert.strictEqual(emittedData.drone1Cutoff, 2600);
    // drone2Cutoff: 350 + 0.75 * 3800 = 3200
    assert.strictEqual(emittedData.drone2Cutoff, 3200);

    // Y Axis: Space & Shimmer Wash
    // delayWet: 0.40 * 0.75 = 0.30
    assert.ok(Math.abs(emittedData.delayWet - 0.30) < 1e-4);
    // delayFeedback: 0.25 + 0.40 * 0.45 = 0.43
    assert.ok(Math.abs(emittedData.delayFeedback - 0.43) < 1e-4);
    // reverbWet: 0.40 * 0.85 = 0.34
    assert.ok(Math.abs(emittedData.reverbWet - 0.34) < 1e-4);
    // shimmerAmount: 0.40 * 0.80 = 0.32
    assert.ok(Math.abs(emittedData.shimmerAmount - 0.32) < 1e-4);
  });

  it('safely calls engine methods when engine is provided and handles missing methods gracefully', () => {
    setupMockDOM();
    const container = document.createElement('div');
    const called = {};

    const mockEngine = {
      setFeltTone: (v) => { called.feltTone = v; },
      setDroneCutoff: (id, f) => { called[`drone${id}Cutoff`] = f; },
      setDelayWet: (v) => { called.delayWet = v; },
      setDelayFeedback: (v) => { called.delayFeedback = v; },
      setReverbWet: (v) => { called.reverbWet = v; },
      setReverbShimmer: (v) => { called.reverbShimmer = v; }
    };

    const pad = new BraunVectorPad(container, { engine: mockEngine });
    pad.setCoordinates(0.5, 0.5, true);

    assert.ok(Math.abs(called.feltTone - 0.55) < 1e-4);
    assert.strictEqual(called.drone1Cutoff, 1800);
    assert.strictEqual(called.drone2Cutoff, 2250);
    assert.ok(Math.abs(called.delayWet - 0.375) < 1e-4);
    assert.ok(Math.abs(called.delayFeedback - 0.475) < 1e-4);
    assert.ok(Math.abs(called.reverbWet - 0.425) < 1e-4);
    assert.ok(Math.abs(called.reverbShimmer - 0.40) < 1e-4);

    // Graceful degradation when engine has partial methods
    const partialEngine = { setFeltTone: () => {} };
    const pad2 = new BraunVectorPad(container, { engine: partialEngine });
    assert.doesNotThrow(() => pad2.setCoordinates(0.2, 0.8, true));
  });
});

describe('JUCE IPC Bridge & Standalone Vector Modulation Forwarding', () => {
  it('forwards all 7 modulated parameters to JUCE backend without triggering knob onChange feedback loop', () => {
    setupMockDOM();
    const app = new AmbientApp();

    const emittedEvents = [];
    globalThis.window.__JUCE__ = {
      backend: {
        emitEvent: (event, payload) => {
          emittedEvents.push({ event, payload });
        },
        addEventListener: () => {}
      }
    };

    // Initialize mock knobs with change spy
    let knobCallbacksFired = 0;
    const makeMockKnob = (initialVal) => ({
      value: initialVal,
      setValue(val, triggerCallback) {
        this.value = val;
        if (triggerCallback && typeof this.onChange === 'function') {
          this.onChange(val);
        }
      },
      onChange: () => { knobCallbacksFired++; }
    });

    app.knobs = {
      feltTone: makeMockKnob(62),
      reverbShimmer: makeMockKnob(45),
      reverbWet: makeMockKnob(45),
      delayWet: makeMockKnob(40),
      delayFeedback: makeMockKnob(55),
      drone1Cutoff: makeMockKnob(650),
      drone2Cutoff: makeMockKnob(850)
    };

    // Vector pad modulation at X=0.80, Y=0.60
    // feltTone = 0.15 + 0.80 * 0.80 = 0.79 -> 79%
    // shimmerAmount = 0.60 * 0.80 = 0.48 -> 48%
    // reverbWet = 0.60 * 0.85 = 0.51 -> 51%
    // delayWet = 0.60 * 0.75 = 0.45 -> 45%
    // delayFeedback = 0.25 + 0.60 * 0.45 = 0.52 -> 52%
    // drone1Cutoff = 200 + 0.80 * 3200 = 2760 Hz
    // drone2Cutoff = 350 + 0.80 * 3800 = 3390 Hz
    const modulationData = {
      x: 0.80,
      y: 0.60,
      feltTone: 0.79,
      shimmerAmount: 0.48,
      reverbWet: 0.51,
      delayWet: 0.45,
      delayFeedback: 0.52,
      drone1Cutoff: 2760,
      drone2Cutoff: 3390
    };

    app._syncKnobsFromVectorPad(modulationData);

    // 1. Verify knobs were updated visually
    assert.strictEqual(app.knobs.feltTone.value, 79);
    assert.strictEqual(app.knobs.reverbShimmer.value, 48);
    assert.strictEqual(app.knobs.reverbWet.value, 51);
    assert.strictEqual(app.knobs.delayWet.value, 45);
    assert.strictEqual(app.knobs.delayFeedback.value, 52);
    assert.strictEqual(app.knobs.drone1Cutoff.value, 2760);
    assert.strictEqual(app.knobs.drone2Cutoff.value, 3390);

    // 2. Verify knob onChange callbacks were NOT triggered (no feedback loop)
    assert.strictEqual(knobCallbacksFired, 0, 'Knob callbacks must not fire to prevent echo loops');

    // 3. Verify all 7 paramChange events were emitted to JUCE backend
    const paramChanges = emittedEvents.filter(e => e.event === 'paramChange');
    assert.strictEqual(paramChanges.length, 7, 'Must emit exactly 7 paramChange events for all modulated parameters');

    const map = {};
    paramChanges.forEach(e => { map[e.payload.id] = e.payload.value; });

    assert.strictEqual(map.feltTone, 79);
    assert.strictEqual(map.reverbShimmer, 48);
    assert.strictEqual(map.reverbWet, 51);
    assert.strictEqual(map.delayWet, 45);
    assert.strictEqual(map.delayFeedback, 52);
    assert.strictEqual(map.drone1Cutoff, 2760);
    assert.strictEqual(map.drone2Cutoff, 3390);
  });

  it('verifies real reverbShimmer and feltTone knob onChange callbacks update vector pad inverse coordinates', () => {
    setupMockDOM();
    const app = new AmbientApp();
    app._buildKnobs();

    let padX = 0.5;
    let padY = 0.5;
    app.vectorPad = {
      get x() { return padX; },
      get y() { return padY; },
      isEngaged: false,
      isAnimating: false,
      setCoordinates: (x, y) => {
        padX = x;
        padY = y;
      }
    };
    app._isApplyingPreset = false;

    // Test real knob callbacks on app.knobs
    assert.ok(typeof app.knobs.reverbShimmer?.onChange === 'function', 'reverbShimmer.onChange must be a function');
    assert.ok(typeof app.knobs.feltTone?.onChange === 'function', 'feltTone.onChange must be a function');

    // 1. Shimmer at 0% -> normY = 0
    app.knobs.reverbShimmer.onChange(0);
    assert.strictEqual(padY, 0);

    // 2. Shimmer at 40% -> normY = 0.50 (40/100 / 0.80 = 0.50)
    app.knobs.reverbShimmer.onChange(40);
    assert.strictEqual(padY, 0.50);

    // 3. Shimmer at 80% -> normY = 1.00 (80/100 / 0.80 = 1.00)
    app.knobs.reverbShimmer.onChange(80);
    assert.strictEqual(padY, 1.00);

    // 4. Shimmer clamped at 100% -> normY = 1.00
    app.knobs.reverbShimmer.onChange(100);
    assert.strictEqual(padY, 1.00);

    // 5. Felt Tone at 15% -> normX = 0 ((0.15 - 0.15) / 0.80 = 0.0)
    app.knobs.feltTone.onChange(15);
    assert.ok(Math.abs(padX - 0.0) < 1e-4);

    // 6. Felt Tone at 55% -> normX = 0.50 ((0.55 - 0.15) / 0.80 = 0.50)
    app.knobs.feltTone.onChange(55);
    assert.ok(Math.abs(padX - 0.50) < 1e-4);

    // 7. Felt Tone at 95% -> normX = 1.00 ((0.95 - 0.15) / 0.80 = 1.00)
    app.knobs.feltTone.onChange(95);
    assert.ok(Math.abs(padX - 1.00) < 1e-4);

    // 8. Felt Tone clamped at 0% -> normX = 0.0
    app.knobs.feltTone.onChange(0);
    assert.strictEqual(padX, 0.0);

    // 9. Felt Tone clamped at 100% -> normX = 1.00
    app.knobs.feltTone.onChange(100);
    assert.strictEqual(padX, 1.00);
  });

  it('syncs vector reticle and knob states during host automation in paramUpdate with APVTS and alias mappings', () => {
    setupMockDOM();
    const app = new AmbientApp();

    let padX = 0.5;
    let padY = 0.5;
    let padAnimating = false;
    app.vectorPad = {
      get x() { return padX; },
      get y() { return padY; },
      isEngaged: false,
      get isAnimating() { return padAnimating; },
      setCoordinates: (x, y) => {
        padX = x;
        padY = y;
      }
    };
    app._isApplyingPreset = false;
    const makeKnob = (val) => ({
      value: val,
      setValue(v) { this.value = v; }
    });
    app.knobs = {
      feltTone: makeKnob(62),
      reverbShimmer: makeKnob(45),
      reverbWet: makeKnob(45),
      delayWet: makeKnob(40),
      delayFeedback: makeKnob(55),
      drone1Cutoff: makeKnob(650),
      drone2Cutoff: makeKnob(850)
    };

    let paramUpdateHandler = null;
    globalThis.window.__JUCE__ = {
      backend: {
        emitEvent: () => {},
        addEventListener: (name, cb) => {
          if (name === 'paramUpdate') paramUpdateHandler = cb;
        }
      }
    };

    app._initJuceBridge();
    assert.ok(typeof paramUpdateHandler === 'function', 'paramUpdate handler must be registered');

    // 1. Host automates feltTone to 95% (feltTone = 0.95 -> normX = (0.95 - 0.15) / 0.80 = 1.0)
    paramUpdateHandler({ id: 'feltTone', value: 95 });
    assert.ok(Math.abs(padX - 1.0) < 1e-4, 'Vector reticle X must sync with host automation');
    assert.strictEqual(app.knobs.feltTone.value, 95);

    // 2. Host automates APVTS felt_tone as normalized float 0.75 -> normX = 0.75, knob = 75
    paramUpdateHandler({ id: 'felt_tone', value: 0.75 });
    assert.ok(Math.abs(padX - 0.75) < 1e-4);
    assert.strictEqual(app.knobs.feltTone.value, 75);

    // 3. Host automates reverbShimmer to 40% (normY = 0.40 / 0.80 = 0.50)
    paramUpdateHandler({ id: 'reverbShimmer', value: 40 });
    assert.strictEqual(padY, 0.50, 'Vector reticle Y must sync with host automation');
    assert.strictEqual(app.knobs.reverbShimmer.value, 40);

    // 4. Host automates APVTS shimmer_amount as normalized float 0.40 -> normY = 0.50, knob = 40
    paramUpdateHandler({ id: 'shimmer_amount', value: 0.40 });
    assert.strictEqual(padY, 0.50);
    assert.strictEqual(app.knobs.reverbShimmer.value, 40);

    // 5. Host automates shimmerAmount alias as normalized float 0.64 -> normY = 0.80, knob = 64
    paramUpdateHandler({ id: 'shimmerAmount', value: 0.64 });
    assert.ok(Math.abs(padY - 0.80) < 1e-4);
    assert.strictEqual(app.knobs.reverbShimmer.value, 64);

    // 6. Host automates APVTS tape_mix as normalized float 0.60 -> knob = 60
    paramUpdateHandler({ id: 'tape_mix', value: 0.60 });
    assert.strictEqual(app.knobs.delayWet.value, 60);

    // 7. When vector pad IS engaged, host automation must NOT clobber user touch
    app.vectorPad.isEngaged = true;
    paramUpdateHandler({ id: 'feltTone', value: 30 });
    assert.ok(Math.abs(padX - 0.75) < 1e-4, 'Engaged vector pad must ignore host automation to prevent fighting touch input');
    paramUpdateHandler({ id: 'reverbShimmer', value: 80 });
    assert.ok(Math.abs(padY - 0.80) < 1e-4, 'Engaged vector pad must ignore host automation');
    app.vectorPad.isEngaged = false;

    // 8. When vector pad IS animating, host automation must NOT interrupt animation
    padAnimating = true;
    paramUpdateHandler({ id: 'feltTone', value: 20 });
    assert.ok(Math.abs(padX - 0.75) < 1e-4, 'Animating vector pad must ignore host automation to prevent tearing');
    padAnimating = false;
  });

  it('verifies BraunVectorPad animation helpers, isAnimating state, and headless safety', () => {
    setupMockDOM();
    const container = document.createElement('div');
    const pad = new BraunVectorPad(container, {
      defaultX: 0.5,
      defaultY: 0.5,
      mode: 'momentary'
    });

    assert.strictEqual(pad.isAnimating, false);

    // Move away from center and verify resetToCenter
    pad.setCoordinates(0.9, 0.2, true);
    assert.strictEqual(pad.x, 0.9);
    assert.strictEqual(pad.y, 0.2);

    pad.resetToCenter(true, false);
    assert.strictEqual(pad.x, 0.5);
    assert.strictEqual(pad.y, 0.5);
    assert.strictEqual(pad.isAnimating, false);
  });
});
