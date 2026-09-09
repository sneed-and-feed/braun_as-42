import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeCreatePeriodicWave, createWavetableCache } from '../js/audio/anti-aliasing.js';
import { AudioEngine } from '../js/audio/engine.js';
import { BraunKnob } from '../js/ui/knob.js';
import { BraunPlaySurface } from '../js/ui/keyboard.js';
import { AmbientApp } from '../js/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

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

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(v) {
    this._textContent = v;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = String(val);
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

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  removeEventListener(event, callback) {
    const list = this.listeners.get(event) || [];
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event = {}) {
    if (!event.target) event.target = this;
    const handlers = this.listeners.get(event.type) || [];
    for (const h of handlers) {
      h.call(this, event);
    }
  }

  querySelector(sel) {
    const find = (node) => {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        if (node.classList && node.classList.contains(cls)) return node;
      }
      for (const ch of node.children) {
        const res = find(ch);
        if (res) return res;
      }
      return null;
    };
    return find(this);
  }

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
  }

  setPointerCapture() {}
  releasePointerCapture() {}
}

describe('iPadOS / Mobile Safari Compatibility Suite', () => {

  describe('1. Viewport Meta and CSS Touch Constraints', () => {
    it('verifies index.html has user-scalable=no and viewport-fit=cover in viewport meta', () => {
      const htmlPath = path.join(projectRoot, 'index.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');

      const metaViewportMatch = htmlContent.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i);
      assert.ok(metaViewportMatch, 'Viewport meta tag should exist in index.html');

      const content = metaViewportMatch[1];
      assert.ok(content.includes('width=device-width'), 'Viewport must specify width=device-width');
      assert.ok(content.includes('initial-scale=1.0'), 'Viewport must specify initial-scale=1.0');
      assert.ok(content.includes('user-scalable=no'), 'Viewport must prevent double-tap zoom via user-scalable=no');
      assert.ok(content.includes('viewport-fit=cover'), 'Viewport must support edge-to-edge iPad displays via viewport-fit=cover');
    });

    it('verifies css/style.css prevents rubber-band scrolling via overscroll-behavior: none', () => {
      const cssPath = path.join(projectRoot, 'css', 'style.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      assert.ok(cssContent.includes('overscroll-behavior: none;'), 'CSS must specify overscroll-behavior: none');
    });

    it('verifies css/style.css applies overscroll-behavior: none to html as well', () => {
      const cssPath = path.join(projectRoot, 'css', 'style.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      const htmlRuleMatch = cssContent.match(/html\s*\{([^}]+)\}/);
      assert.ok(htmlRuleMatch, 'html rule must exist in style.css');
      assert.ok(htmlRuleMatch[1].includes('overscroll-behavior: none;'), 'html must have overscroll-behavior: none');
    });

    it('verifies css/style.css applies touch-action: none and user-select: none to .braun-knob-wrapper', () => {
      const cssPath = path.join(projectRoot, 'css', 'style.css');
      const cssContent = fs.readFileSync(cssPath, 'utf8');

      const knobRuleMatch = cssContent.match(/\.braun-knob-wrapper\s*\{([^}]+)\}/);
      assert.ok(knobRuleMatch, '.braun-knob-wrapper rule must exist');
      const knobBody = knobRuleMatch[1];

      assert.ok(knobBody.includes('touch-action: none;'), 'Knob wrapper must have touch-action: none');
      assert.ok(knobBody.includes('-webkit-user-select: none;'), 'Knob wrapper must have -webkit-user-select: none');
      assert.ok(knobBody.includes('user-select: none;'), 'Knob wrapper must have user-select: none');
      assert.ok(knobBody.includes('-webkit-touch-callout: none;'), 'Knob wrapper must have -webkit-touch-callout: none');
    });
  });

  describe('2. Older WebKit createPeriodicWave Defensive Fallback', () => {
    it('uses 3-arg dictionary call when supported', () => {
      let calledWith = null;
      const mockCtx = {
        createPeriodicWave(real, imag, options) {
          calledWith = { real, imag, options };
          return { type: 'PeriodicWave', real, imag, options };
        }
      };

      const real = new Float32Array([0, 0]);
      const imag = new Float32Array([0, 1]);
      const wave = safeCreatePeriodicWave(mockCtx, real, imag);

      assert.ok(wave, 'PeriodicWave should be returned');
      assert.deepStrictEqual(calledWith.options, { disableNormalization: false });
    });

    it('falls back to 2-arg createPeriodicWave when 3-arg dictionary call throws (older WebKit)', () => {
      let callCount = 0;
      let lastArgs = null;
      const mockCtx = {
        createPeriodicWave(...args) {
          callCount++;
          lastArgs = args;
          if (args.length === 3 && typeof args[2] === 'object') {
            // Mimic WebKit TypeError: Dictionary not supported
            throw new TypeError("Failed to execute 'createPeriodicWave' on 'AudioContext': parameter 3 is not of type...");
          }
          return { type: 'PeriodicWaveFallback', args };
        }
      };

      const real = new Float32Array([0, 0]);
      const imag = new Float32Array([0, 1]);
      const wave = safeCreatePeriodicWave(mockCtx, real, imag);

      assert.ok(wave, 'Fallback PeriodicWave should be returned');
      assert.strictEqual(wave.type, 'PeriodicWaveFallback');
      assert.strictEqual(callCount, 2, 'Should attempt 3-arg first, then fall back to 2-arg');
      assert.strictEqual(lastArgs.length, 2, 'Fallback must be called with exactly 2 arguments');
    });

    it('returns null safely if ctx does not support createPeriodicWave or both calls throw', () => {
      assert.strictEqual(safeCreatePeriodicWave(null, new Float32Array([0]), new Float32Array([0])), null);

      const throwingCtx = {
        createPeriodicWave() {
          throw new Error('Fatal audio context error');
        }
      };
      const wave = safeCreatePeriodicWave(throwingCtx, new Float32Array([0]), new Float32Array([0]));
      assert.strictEqual(wave, null, 'Should return null gracefully on complete failure');
    });

    it('verifies createWavetableCache succeeds and provides all waveforms using safeCreatePeriodicWave', () => {
      const mockCtx = {
        createPeriodicWave(real, imag) {
          return { real, imag };
        }
      };
      const cache = createWavetableCache(mockCtx);
      assert.ok(cache.saw, 'saw wave cached');
      assert.ok(cache.square, 'square wave cached');
      assert.ok(cache.triangle, 'triangle wave cached');
      assert.ok(cache.warm, 'warm analog wave cached');
    });
  });

  describe('3. Web Audio iOS Autoplay Unlock & Interruption Recovery', () => {
    class MockAudioContext {
      constructor(options = {}) {
        this.options = options;
        this.state = 'suspended';
        this.currentTime = 0;
        this.destination = { type: 'AudioDestination' };
        this.buffersCreated = [];
        this.sourcesCreated = [];
        this.resumed = false;
      }

      async resume() {
        this.resumed = true;
        this.state = 'running';
        return Promise.resolve();
      }

      createBuffer(channels, length, sampleRate) {
        const buf = { channels, length, sampleRate };
        this.buffersCreated.push(buf);
        return buf;
      }

      createBufferSource() {
        const src = {
          buffer: null,
          connectedTo: null,
          started: false,
          connect(target) {
            this.connectedTo = target;
          },
          start(when = 0) {
            this.started = true;
            this.startTime = when;
          }
        };
        this.sourcesCreated.push(src);
        return src;
      }
    }

    it('unlockAudio creates AudioContext if absent, resumes it, and plays a 1-sample silent buffer', () => {
      const origAudioCtx = globalThis.AudioContext;
      const origWebkitAudioCtx = globalThis.webkitAudioContext;

      globalThis.AudioContext = MockAudioContext;
      delete globalThis.webkitAudioContext;

      try {
        const engine = new AudioEngine();
        assert.strictEqual(engine.ctx, null);

        const ctx = engine.unlockAudio();
        assert.ok(ctx instanceof MockAudioContext);
        assert.strictEqual(ctx.state, 'running');
        assert.strictEqual(ctx.resumed, true);
        assert.strictEqual(engine.isAudioUnlocked, true);

        // Verify 1-sample silent buffer was created and played to destination
        assert.strictEqual(ctx.buffersCreated.length, 1);
        assert.strictEqual(ctx.buffersCreated[0].channels, 1);
        assert.strictEqual(ctx.buffersCreated[0].length, 1);
        assert.strictEqual(ctx.buffersCreated[0].sampleRate, 22050);

        assert.strictEqual(ctx.sourcesCreated.length, 1);
        assert.strictEqual(ctx.sourcesCreated[0].connectedTo, ctx.destination);
        assert.strictEqual(ctx.sourcesCreated[0].started, true);
      } finally {
        globalThis.AudioContext = origAudioCtx;
        globalThis.webkitAudioContext = origWebkitAudioCtx;
      }
    });

    it('attaches unlock listeners on first user gesture and removes them once unlocked', () => {
      const documentListeners = new Map();
      const windowListeners = new Map();

      const mockDoc = {
        visibilityState: 'visible',
        addEventListener(event, cb) {
          if (!documentListeners.has(event)) documentListeners.set(event, []);
          documentListeners.get(event).push(cb);
        },
        removeEventListener(event, cb) {
          const list = documentListeners.get(event) || [];
          const idx = list.indexOf(cb);
          if (idx !== -1) list.splice(idx, 1);
        }
      };

      const mockWin = {
        addEventListener(event, cb) {
          if (!windowListeners.has(event)) windowListeners.set(event, []);
          windowListeners.get(event).push(cb);
        },
        removeEventListener(event, cb) {
          const list = windowListeners.get(event) || [];
          const idx = list.indexOf(cb);
          if (idx !== -1) list.splice(idx, 1);
        }
      };

      const origDoc = globalThis.document;
      const origWin = globalThis.window;
      const origAudioCtx = globalThis.AudioContext;

      globalThis.document = mockDoc;
      globalThis.window = mockWin;
      globalThis.AudioContext = MockAudioContext;

      try {
        let unlockCalled = false;
        const mockEngine = {
          unlockAudio() {
            unlockCalled = true;
          },
          ctx: null
        };

        const app = Object.create(AmbientApp.prototype);
        app.engine = mockEngine;
        app._hasAudioUnlockListeners = false;
        app._attachAudioUnlockListeners();

        // Verify listeners were added for touchstart, touchend, pointerdown, mousedown, click
        ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click'].forEach(evt => {
          assert.ok(documentListeners.get(evt)?.length > 0, `document must listen to ${evt}`);
          assert.ok(windowListeners.get(evt)?.length > 0, `window must listen to ${evt}`);
        });

        // Trigger touchstart to simulate first iPad tap
        const touchHandler = documentListeners.get('touchstart')[0];
        touchHandler();

        assert.strictEqual(unlockCalled, true, 'engine.unlockAudio must be called on first touch');

        // Verify unlock listeners are removed
        ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click'].forEach(evt => {
          assert.strictEqual(documentListeners.get(evt)?.length || 0, 0, `document ${evt} listener should be removed`);
          assert.strictEqual(windowListeners.get(evt)?.length || 0, 0, `window ${evt} listener should be removed`);
        });
      } finally {
        globalThis.document = origDoc;
        globalThis.window = origWin;
        globalThis.AudioContext = origAudioCtx;
      }
    });

    it('interruption recovery automatically calls resume on visibilitychange and pageshow', async () => {
      const documentListeners = new Map();
      const windowListeners = new Map();

      const mockDoc = {
        visibilityState: 'visible',
        addEventListener(event, cb) {
          if (!documentListeners.has(event)) documentListeners.set(event, []);
          documentListeners.get(event).push(cb);
        },
        removeEventListener: () => {}
      };

      const mockWin = {
        addEventListener(event, cb) {
          if (!windowListeners.has(event)) windowListeners.set(event, []);
          windowListeners.get(event).push(cb);
        },
        removeEventListener: () => {}
      };

      const origDoc = globalThis.document;
      const origWin = globalThis.window;

      globalThis.document = mockDoc;
      globalThis.window = mockWin;

      try {
        let resumeCount = 0;
        const mockEngine = {
          ctx: {
            state: 'suspended',
            async resume() {
              resumeCount++;
              this.state = 'running';
            }
          }
        };

        const app = Object.create(AmbientApp.prototype);
        app.engine = mockEngine;
        app._hasAudioUnlockListeners = false;
        app._attachAudioUnlockListeners();

        assert.ok(documentListeners.has('visibilitychange'), 'Must listen to visibilitychange');
        assert.ok(windowListeners.has('pageshow'), 'Must listen to pageshow');

        // Simulate returning to tab: visibilitychange
        const visHandler = documentListeners.get('visibilitychange')[0];
        await visHandler();
        assert.strictEqual(resumeCount, 1, 'Should resume suspended context on visibilitychange');

        // Simulate lock/unlock or pageshow
        mockEngine.ctx.state = 'suspended';
        const pageShowHandler = windowListeners.get('pageshow')[0];
        await pageShowHandler();
        assert.strictEqual(resumeCount, 2, 'Should resume suspended context on pageshow');
      } finally {
        globalThis.document = origDoc;
        globalThis.window = origWin;
      }
    });

    it('falls back to parameterless new AudioContext() when options dictionary throws TypeError (older WebKit)', () => {
      const origAudioCtx = globalThis.AudioContext;
      const origWebkitAudioCtx = globalThis.webkitAudioContext;

      class OlderWebKitAudioContext extends MockAudioContext {
        constructor(...args) {
          if (args.length > 0) {
            throw new TypeError("Failed to construct 'AudioContext': parameter 1 is not valid for this browser version");
          }
          super();
        }
      }

      globalThis.AudioContext = OlderWebKitAudioContext;
      delete globalThis.webkitAudioContext;

      try {
        const engine = new AudioEngine();
        const ctx = engine.unlockAudio();
        assert.ok(ctx instanceof OlderWebKitAudioContext);
        assert.strictEqual(ctx.state, 'running');
        assert.strictEqual(engine.isAudioUnlocked, true);
      } finally {
        globalThis.AudioContext = origAudioCtx;
        globalThis.webkitAudioContext = origWebkitAudioCtx;
      }
    });

    it('interruption recovery automatically resumes AudioContext when state is interrupted', async () => {
      const documentListeners = new Map();
      const windowListeners = new Map();

      const mockDoc = {
        visibilityState: 'visible',
        addEventListener: (event, cb) => {
          if (!documentListeners.has(event)) documentListeners.set(event, []);
          documentListeners.get(event).push(cb);
        },
        removeEventListener: () => {}
      };

      const mockWin = {
        addEventListener: (event, cb) => {
          if (!windowListeners.has(event)) windowListeners.set(event, []);
          windowListeners.get(event).push(cb);
        },
        removeEventListener: () => {}
      };

      const origDoc = globalThis.document;
      const origWin = globalThis.window;
      globalThis.document = mockDoc;
      globalThis.window = mockWin;

      try {
        let resumeCount = 0;
        const mockEngine = {
          ctx: {
            state: 'interrupted',
            async resume() {
              resumeCount++;
              this.state = 'running';
            }
          }
        };

        const app = Object.create(AmbientApp.prototype);
        app.engine = mockEngine;
        app._hasAudioUnlockListeners = false;
        app._attachAudioUnlockListeners();

        const visHandler = documentListeners.get('visibilitychange')[0];
        await visHandler();
        assert.strictEqual(resumeCount, 1, 'Should resume interrupted context on visibilitychange');

        mockEngine.ctx.state = 'interrupted';
        const pageShowHandler = windowListeners.get('pageshow')[0];
        await pageShowHandler();
        assert.strictEqual(resumeCount, 2, 'Should resume interrupted context on pageshow');
      } finally {
        globalThis.document = origDoc;
        globalThis.window = origWin;
      }
    });
  });

  describe('4. Knob Multi-Touch Independence & Touch/Pointer Cancel Handling', () => {
    it('isolates multiple knobs manipulated by separate touches without ev.touches[0] crosstalk', () => {
      const windowListeners = new Map();
      const mockWin = {
        addEventListener(evt, cb) {
          if (!windowListeners.has(evt)) windowListeners.set(evt, []);
          windowListeners.get(evt).push(cb);
        },
        removeEventListener(evt, cb) {
          const list = windowListeners.get(evt) || [];
          const idx = list.indexOf(cb);
          if (idx !== -1) list.splice(idx, 1);
        }
      };

      const origWin = globalThis.window;
      const origDoc = globalThis.document;
      globalThis.window = mockWin;
      globalThis.document = {
        createElement: (tag) => new MockElement(tag)
      };

      try {
        const container1 = new MockElement('div');
        const container2 = new MockElement('div');

        const knob1 = new BraunKnob(container1, { min: 0, max: 100, default: 50 });
        const knob2 = new BraunKnob(container2, { min: 0, max: 100, default: 50 });

        const el1 = knob1.element;
        const el2 = knob2.element;

        // Touch 1 touches Knob 1 (identifier 10, y = 200)
        el1.dispatchEvent({
          type: 'touchstart',
          changedTouches: [{ identifier: 10, clientY: 200 }],
          preventDefault: () => {}
        });
        assert.strictEqual(el1.classList.contains('is-active'), true);

        // Touch 2 touches Knob 2 (identifier 20, y = 150)
        el2.dispatchEvent({
          type: 'touchstart',
          changedTouches: [{ identifier: 20, clientY: 150 }],
          preventDefault: () => {}
        });
        assert.strictEqual(el2.classList.contains('is-active'), true);

        // A touchmove event occurs with both touches
        // Touch 1 moves from 200 -> 160 (moved up by 40px -> knob1 should increase)
        // Touch 2 stays at 150 (did not move -> knob2 should remain 50)
        const touchMoveHandlers = windowListeners.get('touchmove') || [];
        touchMoveHandlers.forEach(cb => {
          cb({
            touches: [
              { identifier: 10, clientY: 160 },
              { identifier: 20, clientY: 150 }
            ]
          });
        });

        // Knob 1 increased, Knob 2 did NOT change
        assert.ok(knob1.value > 50, `Knob 1 value should increase, got ${knob1.value}`);
        assert.strictEqual(knob2.value, 50, `Knob 2 value should remain 50, got ${knob2.value}`);

        // Now move Touch 2 from 150 -> 190 (moved down by 40px -> knob2 should decrease)
        touchMoveHandlers.forEach(cb => {
          cb({
            touches: [
              { identifier: 10, clientY: 160 },
              { identifier: 20, clientY: 190 }
            ]
          });
        });

        assert.ok(knob2.value < 50, `Knob 2 value should decrease, got ${knob2.value}`);

        // Touch 1 lifts (touchend on identifier 10)
        const touchEndHandlers = windowListeners.get('touchend') || [];
        touchEndHandlers.forEach(cb => {
          cb({
            changedTouches: [{ identifier: 10 }]
          });
        });

        assert.strictEqual(el1.classList.contains('is-active'), false, 'Knob 1 should deactivate on its touch lift');
        assert.strictEqual(el2.classList.contains('is-active'), true, 'Knob 2 should still remain active');

        // Touch 2 cancels (touchcancel on identifier 20)
        const touchCancelHandlers = windowListeners.get('touchcancel') || [];
        touchCancelHandlers.forEach(cb => {
          cb({
            changedTouches: [{ identifier: 20 }]
          });
        });

        assert.strictEqual(el2.classList.contains('is-active'), false, 'Knob 2 should deactivate on touchcancel');
      } finally {
        globalThis.window = origWin;
        globalThis.document = origDoc;
      }
    });

    it('cleans up active dragging state when pointercancel fires', () => {
      const windowListeners = new Map();
      const mockWin = {
        addEventListener(evt, cb) {
          if (!windowListeners.has(evt)) windowListeners.set(evt, []);
          windowListeners.get(evt).push(cb);
        },
        removeEventListener(evt, cb) {
          const list = windowListeners.get(evt) || [];
          const idx = list.indexOf(cb);
          if (idx !== -1) list.splice(idx, 1);
        }
      };

      const origWin = globalThis.window;
      const origDoc = globalThis.document;
      globalThis.window = mockWin;
      globalThis.document = {
        createElement: (tag) => new MockElement(tag)
      };

      try {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, default: 50 });
        const el = knob.element;

        el.dispatchEvent({
          type: 'pointerdown',
          pointerId: 77,
          clientY: 100,
          preventDefault: () => {}
        });

        assert.strictEqual(el.classList.contains('is-active'), true);

        // Fire pointercancel for pointerId 77
        const cancelHandlers = windowListeners.get('pointercancel') || [];
        cancelHandlers.forEach(cb => cb({ pointerId: 77 }));

        assert.strictEqual(el.classList.contains('is-active'), false, 'Knob must clean up on pointercancel');
      } finally {
        globalThis.window = origWin;
        globalThis.document = origDoc;
      }
    });

    it('guarantees pointer drag on knob is NOT cancelled by unrelated touchend or touchcancel', () => {
      const windowListeners = new Map();
      const mockWin = {
        addEventListener(evt, cb) {
          if (!windowListeners.has(evt)) windowListeners.set(evt, []);
          windowListeners.get(evt).push(cb);
        },
        removeEventListener(evt, cb) {
          const list = windowListeners.get(evt) || [];
          const idx = list.indexOf(cb);
          if (idx !== -1) list.splice(idx, 1);
        }
      };

      const origWin = globalThis.window;
      const origDoc = globalThis.document;
      globalThis.window = mockWin;
      globalThis.document = {
        createElement: (tag) => new MockElement(tag)
      };

      try {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, default: 50 });
        const el = knob.element;

        el.dispatchEvent({
          type: 'pointerdown',
          pointerId: 1,
          clientY: 100,
          preventDefault: () => {}
        });

        assert.strictEqual(el.classList.contains('is-active'), true);

        // Unrelated touchend (finger lifted from chime key or chord button)
        const touchEndHandlers = windowListeners.get('touchend') || [];
        touchEndHandlers.forEach(cb => cb({ changedTouches: [{ identifier: 99 }] }));
        assert.strictEqual(el.classList.contains('is-active'), true, 'Knob must remain active after unrelated touchend');

        // Unrelated touchcancel
        const touchCancelHandlers = windowListeners.get('touchcancel') || [];
        touchCancelHandlers.forEach(cb => cb({ changedTouches: [{ identifier: 99 }] }));
        assert.strictEqual(el.classList.contains('is-active'), true, 'Knob must remain active after unrelated touchcancel');

        // Pointer move updates knob value
        const pointerMoveHandlers = windowListeners.get('pointermove') || [];
        pointerMoveHandlers.forEach(cb => cb({ pointerId: 1, clientY: 60 }));
        assert.ok(knob.value > 50, 'Knob value should have increased');

        // Its own pointerup deactivates it
        const pointerUpHandlers = windowListeners.get('pointerup') || [];
        pointerUpHandlers.forEach(cb => cb({ pointerId: 1 }));
        assert.strictEqual(el.classList.contains('is-active'), false, 'Knob must deactivate on its own pointerup');
      } finally {
        globalThis.window = origWin;
        globalThis.document = origDoc;
      }
    });

    it('guarantees touch drag on knob is NOT cancelled by unrelated pointerup or pointercancel', () => {
      const windowListeners = new Map();
      const mockWin = {
        addEventListener(evt, cb) {
          if (!windowListeners.has(evt)) windowListeners.set(evt, []);
          windowListeners.get(evt).push(cb);
        },
        removeEventListener(evt, cb) {
          const list = windowListeners.get(evt) || [];
          const idx = list.indexOf(cb);
          if (idx !== -1) list.splice(idx, 1);
        }
      };

      const origWin = globalThis.window;
      const origDoc = globalThis.document;
      globalThis.window = mockWin;
      globalThis.document = {
        createElement: (tag) => new MockElement(tag)
      };

      try {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, default: 50 });
        const el = knob.element;

        el.dispatchEvent({
          type: 'touchstart',
          changedTouches: [{ identifier: 15, clientY: 100 }],
          touches: [{ identifier: 15, clientY: 100 }],
          preventDefault: () => {}
        });

        assert.strictEqual(el.classList.contains('is-active'), true);

        // Unrelated pointerup
        const pointerUpHandlers = windowListeners.get('pointerup') || [];
        pointerUpHandlers.forEach(cb => cb({ pointerId: 88 }));
        assert.strictEqual(el.classList.contains('is-active'), true, 'Knob must remain active after unrelated pointerup');

        // Unrelated pointercancel
        const pointerCancelHandlers = windowListeners.get('pointercancel') || [];
        pointerCancelHandlers.forEach(cb => cb({ pointerId: 88 }));
        assert.strictEqual(el.classList.contains('is-active'), true, 'Knob must remain active after unrelated pointercancel');

        // Its own touchend deactivates it
        const touchEndHandlers = windowListeners.get('touchend') || [];
        touchEndHandlers.forEach(cb => cb({ changedTouches: [{ identifier: 15 }] }));
        assert.strictEqual(el.classList.contains('is-active'), false, 'Knob must deactivate on its own touchend');
      } finally {
        globalThis.window = origWin;
        globalThis.document = origDoc;
      }
    });
  });

  describe('5. Play Surface Multi-Touch Polyphony and Glissando Tracking', () => {
    it('tracks simultaneous independent chime keys with distinct pointers/touches', () => {
      const windowListeners = new Map();
      const mockWin = {
        addEventListener(type, cb) {
          if (!windowListeners.has(type)) windowListeners.set(type, []);
          windowListeners.get(type).push(cb);
        }
      };

      const origWin = globalThis.window;
      const origDoc = globalThis.document;
      globalThis.window = mockWin;
      globalThis.document = {
        createElement: (tag) => new MockElement(tag)
      };

      try {
        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');

        const activeNotes = [];
        const releasedNotes = [];

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
                  releasedNotes.push(voice);
                }
              };
              activeNotes.push(voice);
              return voice;
            }
          }
        };

        const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
        const keys = Array.from(surface.keyElements.values());
        assert.ok(keys.length >= 2, 'Should have created keys');

        const key1 = keys[0];
        const key2 = keys[1];

        // Touch 1 strikes Key 1 (pointerId 1)
        surface._activatePointerKey(1, key1, 0.8);
        assert.ok(surface.activeTouches.has(1), 'Pointer 1 should be active');
        assert.strictEqual(surface.activeTouches.get(1).keyEl, key1);
        assert.strictEqual(activeNotes.length, 1);

        // Touch 2 strikes Key 2 (pointerId 2) simultaneously
        surface._activatePointerKey(2, key2, 0.9);
        assert.ok(surface.activeTouches.has(2), 'Pointer 2 should be active');
        assert.strictEqual(surface.activeTouches.get(2).keyEl, key2);
        assert.strictEqual(activeNotes.length, 2);

        // Release Touch 1 only
        surface._releasePointerKey(1);
        assert.strictEqual(surface.activeTouches.has(1), false);
        assert.strictEqual(surface.activeTouches.has(2), true, 'Touch 2 must remain sounding');
        assert.strictEqual(releasedNotes.length, 1);

        // Release Touch 2
        surface._releasePointerKey(2);
        assert.strictEqual(surface.activeTouches.has(2), false);
        assert.strictEqual(releasedNotes.length, 2);
      } finally {
        globalThis.window = origWin;
        globalThis.document = origDoc;
      }
    });

    it('handles multi-touch glissando via touchmove and elementFromPoint cleanly', () => {
      const windowListeners = new Map();
      const mockWin = {
        addEventListener(type, cb) {
          if (!windowListeners.has(type)) windowListeners.set(type, []);
          windowListeners.get(type).push(cb);
        }
      };

      const origWin = globalThis.window;
      const origDoc = globalThis.document;

      try {
        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');

        const triggered = [];
        const released = [];

        const mockEngine = {
          isInitialized: true,
          currentScaleKey: 'BUDD_PENTATONIC',
          rootPitchClass: 0,
          a4: 440,
          feltPiano: {
            playNote: (freq) => {
              const voice = {
                freq,
                release: () => released.push(freq)
              };
              triggered.push(freq);
              return voice;
            }
          }
        };

        let currentTarget = null;
        globalThis.window = mockWin;
        globalThis.document = {
          createElement: (tag) => new MockElement(tag),
          elementFromPoint: () => currentTarget
        };

        const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
        const keys = Array.from(surface.keyElements.values());
        const keyA = keys[0];
        const keyB = keys[1];

        // Touch starts on Key A (pointerId: 'touch-1')
        surface._activatePointerKey('touch-1', keyA, 0.8);
        assert.strictEqual(triggered.length, 1);

        // Now finger moves over to Key B
        currentTarget = keyB;

        // Simulate touchmove
        const touchMoveHandlers = windowListeners.get('touchmove') || [];
        touchMoveHandlers.forEach(cb => {
          cb({
            touches: [{ identifier: 1, clientX: 25, clientY: 50 }]
          });
        });

        // Key A should have been released and Key B triggered
        assert.strictEqual(released.length, 1, 'Key A voice released');
        assert.strictEqual(triggered.length, 2, 'Key B voice triggered');
        assert.strictEqual(surface.activeTouches.get('touch-1').keyEl, keyB);

        // Lifting touch
        const touchEndHandlers = windowListeners.get('touchend') || [];
        touchEndHandlers.forEach(cb => {
          cb({
            changedTouches: [{ identifier: 1 }]
          });
        });

        assert.strictEqual(released.length, 2, 'Key B voice released on lift');
        assert.strictEqual(surface.activeTouches.has('touch-1'), false);
      } finally {
        globalThis.window = origWin;
        globalThis.document = origDoc;
      }
    });

    it('releases all active chime keys and chord clusters cleanly on touchcancel', () => {
      const windowListeners = new Map();
      const mockWin = {
        addEventListener(type, cb) {
          if (!windowListeners.has(type)) windowListeners.set(type, []);
          windowListeners.get(type).push(cb);
        }
      };

      const origWin = globalThis.window;
      const origDoc = globalThis.document;
      globalThis.window = mockWin;
      globalThis.document = {
        createElement: (tag) => new MockElement(tag)
      };

      try {
        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');

        const releasedKeys = [];
        let chordVoicesReleased = 0;

        const mockEngine = {
          isInitialized: true,
          currentScaleKey: 'BUDD_PENTATONIC',
          rootPitchClass: 0,
          a4: 440,
          feltPiano: {
            playNote: (freq) => {
              return {
                freq,
                release: () => releasedKeys.push(freq)
              };
            }
          },
          playChordVoicing: () => {
            return [
              { release: () => chordVoicesReleased++ },
              { release: () => chordVoicesReleased++ }
            ];
          }
        };

        const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
        const keys = Array.from(surface.keyElements.values());
        const chordBtns = mockChords.querySelectorAll ? mockChords.querySelectorAll('.braun-chord-btn') : mockChords.children;
        const key = keys[0];
        const chordBtn = chordBtns[0] || new MockElement('button');
        chordBtn.setAttribute('data-chord-idx', '0');

        // Touch 1 hits key, Touch 2 hits chord
        surface._activatePointerKey('touch-5', key, 0.8);
        const chordSession = surface._activatePointerChord('touch-6', chordBtn, 'BUDD_PENTATONIC');

        assert.strictEqual(surface.activeTouches.has('touch-5'), true);
        assert.strictEqual(surface.activeChordTouches.has('touch-6'), true);
        assert.strictEqual(chordBtn.classList.contains('is-active'), true);
        assert.strictEqual(chordSession.isReleased, false);

        // Fire window touchcancel for touch 5 and touch 6
        const touchCancelHandlers = windowListeners.get('touchcancel') || [];
        touchCancelHandlers.forEach(cb => {
          cb({
            changedTouches: [
              { identifier: 5 },
              { identifier: 6 }
            ]
          });
        });

        assert.strictEqual(surface.activeTouches.has('touch-5'), false, 'Key touch 5 must be released');
        assert.strictEqual(surface.activeChordTouches.has('touch-6'), false, 'Chord touch 6 must be released');
        assert.strictEqual(chordBtn.classList.contains('is-active'), false, 'Chord button must reset is-active');
        assert.strictEqual(chordSession.isReleased, true, 'Chord session must be marked isReleased');
        assert.strictEqual(releasedKeys.length, 1);
      } finally {
        globalThis.window = origWin;
        globalThis.document = origDoc;
      }
    });

    it('suppresses duplicate note strikes when Safari fires pointerdown followed by touchstart on a chime key', () => {
      const windowListeners = new Map();
      const mockWin = {
        addEventListener(type, cb) {
          if (!windowListeners.has(type)) windowListeners.set(type, []);
          windowListeners.get(type).push(cb);
        }
      };

      const origWin = globalThis.window;
      const origDoc = globalThis.document;
      globalThis.window = mockWin;
      globalThis.document = {
        createElement: (tag) => new MockElement(tag)
      };

      try {
        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');

        const playedNotes = [];
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

        const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
        const keys = Array.from(surface.keyElements.values());
        const key = keys[0];

        // Mobile Safari fires pointerdown followed by touchstart on the same touch
        key.dispatchEvent({ type: 'pointerdown', pointerId: 1, clientY: 50, button: 0, preventDefault: () => {} });
        key.dispatchEvent({ type: 'touchstart', changedTouches: [{ identifier: 0, clientY: 50 }], preventDefault: () => {} });

        assert.strictEqual(playedNotes.length, 1, 'Exactly one note strike must sound on Safari touch gesture');
      } finally {
        globalThis.window = origWin;
        globalThis.document = origDoc;
      }
    });

    it('suppresses duplicate chord session triggering when Safari fires pointerdown followed by touchstart on chord button', () => {
      const windowListeners = new Map();
      const mockWin = {
        addEventListener(type, cb) {
          if (!windowListeners.has(type)) windowListeners.set(type, []);
          windowListeners.get(type).push(cb);
        }
      };

      const origWin = globalThis.window;
      const origDoc = globalThis.document;
      globalThis.window = mockWin;
      globalThis.document = {
        createElement: (tag) => new MockElement(tag)
      };

      try {
        const mockStrip = new MockElement('div');
        const mockChords = new MockElement('div');

        let chordSessionsStarted = 0;
        const mockEngine = {
          isInitialized: true,
          currentScaleKey: 'BUDD_PENTATONIC',
          rootPitchClass: 0,
          a4: 440,
          feltPiano: {
            playNote: () => ({ release: () => {} })
          }
        };

        const surface = new BraunPlaySurface(mockStrip, mockChords, mockEngine);
        const origStartChord = surface.startChord.bind(surface);
        surface.startChord = (...args) => {
          chordSessionsStarted++;
          return origStartChord(...args);
        };

        const chordBtns = mockChords.children;
        const chordBtn = chordBtns[0];

        chordBtn.dispatchEvent({ type: 'pointerdown', pointerId: 2, button: 0, preventDefault: () => {} });
        chordBtn.dispatchEvent({ type: 'touchstart', changedTouches: [{ identifier: 1 }], preventDefault: () => {} });

        assert.strictEqual(chordSessionsStarted, 1, 'Exactly one chord session must start on Safari chord touch');
      } finally {
        globalThis.window = origWin;
        globalThis.document = origDoc;
      }
    });
  });
});
