/**
 * @file drones-off-and-generative-timing.test.js
 * @brief Unit and integration tests verifying:
 * 1. Both Drone 1 and Drone 2 are OFF on initial boot and when Power is toggled ON.
 * 2. Eno Phase Loops and Poisson Auto-Evolve generative timing and ambient pacing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AudioEngine } from '../js/audio/engine.js';
import { PhaseLoopEngine } from '../js/generative/phase-loops.js';
import { PoissonGenerator } from '../js/generative/poisson.js';

// Minimal mock DOM for testing UI state orchestration
function setupMockBrowser() {
  const elementsById = new Map();
  const listeners = new Map();

  class MockElement {
    constructor(id, tagName = 'div') {
      this.id = id;
      this.tagName = tagName.toUpperCase();
      this.classList = new Set();
      this.classList.add = (c) => this.classList.addRaw(c);
      this.classList.remove = (c) => this.classList.delete(c);
      this.classList.toggle = (c, force) => {
        if (force === undefined) {
          if (this.classList.has(c)) { this.classList.delete(c); return false; }
          else { this.classList.addRaw(c); return true; }
        }
        if (force) this.classList.addRaw(c);
        else this.classList.delete(c);
        return force;
      };
      this.classList.contains = (c) => this.classList.has(c);
      this.classList.addRaw = (c) => Set.prototype.add.call(this.classList, c);

      this.children = [];
      this.attributes = new Map();
      this.textContent = '';
      this.value = '';
      this.style = {};
    }

    appendChild(child) {
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      return child;
    }

    setAttribute(k, v) {
      this.attributes.set(k, String(v));
    }

    getAttribute(k) {
      return this.attributes.get(k) || null;
    }

    addEventListener(event, fn) {
      if (!listeners.has(this)) listeners.set(this, new Map());
      const elListeners = listeners.get(this);
      if (!elListeners.has(event)) elListeners.set(event, []);
      elListeners.get(event).push(fn);
    }

    click() {
      const elListeners = listeners.get(this);
      if (elListeners && elListeners.has('click')) {
        elListeners.get('click').forEach(fn => fn({ target: this, preventDefault: () => {} }));
      }
    }

    querySelector(sel) {
      if (sel === '.braun-status-text') {
        let span = this.children.find(c => c.classList && c.classList.contains('braun-status-text'));
        if (!span) {
          span = new MockElement('', 'span');
          span.classList.add('braun-status-text');
          span.textContent = this.textContent;
          this.children.push(span);
        }
        return span;
      }
      return null;
    }

    querySelectorAll() {
      return [];
    }
  }

  const register = (id, tag = 'div') => {
    const el = new MockElement(id, tag);
    elementsById.set(id, el);
    return el;
  };

  // Header / Utility
  register('select-theme', 'select');
  register('select-root', 'select');
  register('select-scale', 'select');
  register('select-tuning', 'select');
  register('select-preset', 'select');
  register('btn-reset-all', 'button');
  register('btn-record', 'button');
  register('btn-export-patch', 'button');
  register('btn-load-patch', 'button');
  register('input-load-patch', 'input');
  register('btn-power', 'button');

  // Master & Generative
  register('knob-master-vol');
  register('knob-master-drive');
  register('toggle-phase-loops', 'button');
  register('loops-list');
  register('toggle-auto-evolve', 'button');
  register('knob-poisson-density');
  register('knob-poisson-humanize');

  // Drones
  register('toggle-drone-track', 'button');
  register('btn-drone1-active', 'button');
  register('knob-drone1-beat');
  register('knob-drone1-detune');
  register('knob-drone1-fold');
  register('knob-drone1-cutoff');
  register('knob-drone1-res');
  register('knob-drone1-lfo');
  register('knob-drone1-vol');

  register('btn-drone2-active', 'button');
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

  // FX
  register('toggle-freeze', 'button');
  register('knob-delay-time');
  register('knob-delay-fb');
  register('knob-delay-wow');
  register('knob-delay-tone');
  register('knob-delay-wet');
  register('knob-reverb-decay');
  register('knob-reverb-damping');
  register('knob-reverb-shimmer');
  register('knob-reverb-wet');

  // Play section
  register('chord-macros');
  register('chord-speed-switch');
  register('chord-readout-name');
  register('chord-readout-desc');
  register('chord-status-led');
  register('chord-status-text');
  register('vector-pad');
  register('chime-strip');
  register('scope-canvas', 'canvas');

  // Set initial button text
  elementsById.get('btn-drone1-active').textContent = 'DRONE 1 OFF';
  elementsById.get('btn-drone2-active').textContent = 'DRONE 2 OFF';
  elementsById.get('btn-power').textContent = 'POWER ON';
  elementsById.get('toggle-auto-evolve').textContent = 'EVOLVE OFF';
  elementsById.get('toggle-phase-loops').textContent = 'LOOPS OFF';

  const mockDocument = {
    getElementById: (id) => elementsById.get(id) || null,
    querySelector: (sel) => null,
    querySelectorAll: (sel) => [],
    createElement: (tag) => new MockElement('', tag),
    body: new MockElement('body', 'body')
  };

  globalThis.document = mockDocument;
  globalThis.window = {
    document: mockDocument,
    location: { hostname: 'localhost' },
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  return { elementsById, mockDocument };
}

describe('Requirement 1: Both Drones OFF on Startup & Power-Up', () => {
  it('AudioEngine initializes with both drone voices inactive (active === false)', () => {
    const engine = new AudioEngine();
    assert.strictEqual(engine.droneParams[1].active, false, 'Drone 1 must start inactive');
    assert.strictEqual(engine.droneParams[2].active, false, 'Drone 2 must start inactive');
  });

  it('AmbientApp boots with both drone buttons deactivated (DRONE 1 OFF, DRONE 2 OFF)', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    const d1Btn = elementsById.get('btn-drone1-active');
    const d2Btn = elementsById.get('btn-drone2-active');

    assert.strictEqual(app.engine.droneParams[1].active, false);
    assert.strictEqual(app.engine.droneParams[2].active, false);
    assert.strictEqual(d1Btn.classList.contains('is-active'), false, 'Drone 1 button must not have is-active on startup');
    assert.strictEqual(d2Btn.classList.contains('is-active'), false, 'Drone 2 button must not have is-active on startup');
  });

  it('Toggling power ON keeps both drones OFF by default', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    assert.strictEqual(app.isPowerOn, false);
    await app.startAudio();
    assert.strictEqual(app.isPowerOn, true);

    // Both drones must remain inactive
    assert.strictEqual(app.engine.droneParams[1].active, false, 'Drone 1 must remain OFF after power-on');
    assert.strictEqual(app.engine.droneParams[2].active, false, 'Drone 2 must remain OFF after power-on');

    const d1Btn = elementsById.get('btn-drone1-active');
    const d2Btn = elementsById.get('btn-drone2-active');
    assert.strictEqual(d1Btn.classList.contains('is-active'), false);
    assert.strictEqual(d2Btn.classList.contains('is-active'), false);
  });

  it('Powering down and powering back up preserves inactive drone states', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    await app.startAudio();
    assert.strictEqual(app.isPowerOn, true);

    await app.togglePower();
    assert.strictEqual(app.isPowerOn, false);

    await app.togglePower();
    assert.strictEqual(app.isPowerOn, true);

    assert.strictEqual(app.engine.droneParams[1].active, false);
    assert.strictEqual(app.engine.droneParams[2].active, false);
  });
});

describe('Requirement 2: Generative Loops & Poisson Ambient Pacing in Standalone', () => {
  it('PhaseLoopEngine initializes with prime periods in the 12s–38s range', () => {
    const engine = new PhaseLoopEngine();
    assert.strictEqual(engine.loops.length, 4);

    engine.loops.forEach(loop => {
      assert.ok(loop.periodSeconds >= 12.0 && loop.periodSeconds <= 38.0,
        `Loop period ${loop.periodSeconds}s must be within 12s–38s range`);
    });
  });

  it('PhaseLoopEngine step advances elapsed time accurately and ignores non-positive delta', () => {
    const engine = new PhaseLoopEngine({ loopPeriods: [20.0] });
    engine.loops[0].elapsedSeconds = 5.0;

    let triggers = 0;
    engine.onNoteTrigger = () => { triggers++; };

    // Valid delta
    engine.step(0.016);
    assert.ok(Math.abs(engine.loops[0].elapsedSeconds - 5.016) < 1e-5);
    assert.strictEqual(triggers, 0);

    // Invalid / zero delta does not alter state
    engine.step(-0.5);
    assert.ok(Math.abs(engine.loops[0].elapsedSeconds - 5.016) < 1e-5);
    engine.step(0);
    assert.ok(Math.abs(engine.loops[0].elapsedSeconds - 5.016) < 1e-5);
    engine.step(NaN);
    assert.ok(Math.abs(engine.loops[0].elapsedSeconds - 5.016) < 1e-5);
    assert.strictEqual(triggers, 0);
  });

  it('PoissonGenerator initializes with 12 events/min and 0.6s–8.5s rest bounds', () => {
    const generator = new PoissonGenerator();
    assert.strictEqual(generator.eventsPerMinute, 12);
    assert.strictEqual(generator.minRestSeconds, 0.6);
    assert.strictEqual(generator.maxRestSeconds, 8.5);

    for (let i = 0; i < 200; i++) {
      const interval = generator.getNextInterval();
      assert.ok(interval >= 0.6, `Interval ${interval}s must be >= 0.6s`);
      assert.ok(interval <= 8.5, `Interval ${interval}s must be <= 8.5s`);
      assert.ok(Number.isFinite(interval));
    }
  });

  it('PoissonGenerator handles invalid / NaN inputs safely without machine gun bursts', () => {
    const generator = new PoissonGenerator();
    generator.setParameters({ eventsPerMinute: NaN, humanize: NaN, minRestSeconds: NaN });

    for (let i = 0; i < 100; i++) {
      const interval = generator.getNextInterval();
      assert.ok(Number.isFinite(interval));
      assert.ok(interval >= 0.6 && interval <= 8.5);
    }
  });

  it('Toggling power OFF in Standalone cleanly stops running Poisson and Phase Loops', async () => {
    const { elementsById } = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = true; // Simulate Standalone JUCE WebView2 environment

    await app.startAudio();
    assert.strictEqual(app.isPowerOn, true);

    // Start Poisson and Phase Loops
    const evolveBtn = elementsById.get('toggle-auto-evolve');
    const loopsBtn = elementsById.get('toggle-phase-loops');

    evolveBtn.click();
    loopsBtn.click();

    assert.strictEqual(app.engine.poisson.isRunning, true);
    assert.strictEqual(app.engine.phaseLoops.isRunning, true);
    assert.strictEqual(evolveBtn.classList.contains('is-active'), true);
    assert.strictEqual(loopsBtn.classList.contains('is-active'), true);

    // Power off
    await app.togglePower();
    assert.strictEqual(app.isPowerOn, false);

    // Both generative engines must be stopped even in isJuce mode
    assert.strictEqual(app.engine.poisson.isRunning, false, 'Poisson must stop on power-off in standalone');
    assert.strictEqual(app.engine.phaseLoops.isRunning, false, 'Phase loops must stop on power-off in standalone');
    assert.strictEqual(evolveBtn.classList.contains('is-active'), false, 'Auto evolve button must deactivate');
    assert.strictEqual(loopsBtn.classList.contains('is-active'), false, 'Phase loops button must deactivate');
  });
});
