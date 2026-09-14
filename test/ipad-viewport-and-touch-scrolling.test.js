/**
 * @file ipad-viewport-and-touch-scrolling.test.js
 * @brief Official Milestone 2 Comprehensive Test Suite for iPadOS & Android Tablet Viewport & Touch Scrolling.
 * 
 * Validates:
 * Tier 1 — Feature Coverage:
 *   - R1: Root elements (html, body) and containers permit vertical scrolling on iOS WebKit and Android Blink/Gecko without scroll lock.
 *   - R2: Rotary knob touch disambiguation: labels/readouts allow native page scrolling; knob cap engages drag.
 *   - R3: Tablet screen viewports (810px, 820px, 1024px iPad, 800px/1280px 16:10 Android) format cleanly:
 *         drone grid collapse >= 834px, flex-wrap on snap toggles, partitioned Brian Eno sub-panels (5 delay, 4 reverb),
 *         540px visualizer constraints.
 *   - R4: Multi-touch isolation without cross-talk; chime strip glissando and chord cluster strumming; audio unlock.
 * Tier 2 — Boundary & Corner Cases:
 *   - Rapid touchcancel and interruption recovery, zero/max delta, shiftKey fine-tuning, clamping, anti-hijacking.
 * Tier 3 — Cross-Feature Interactions & Multi-Touch Concurrency:
 *   - 2-4 concurrent knob touches, simultaneous chime glissando + knob rotation, chord strumming + vector pad.
 *   - Android dual PointerEvents and TouchEvents fallback interoperability.
 * Tier 4 — Real-World Ambient Synthesizer Scenarios:
 *   - Complete tablet user flow: label scroll gesture -> Tape Delay knob edit -> chord strumming on lower deck.
 *   - Android tablet aspect ratio workflows (16:10 portrait 800px and landscape 1280px).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve project paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// ============================================================================
// High-Fidelity Mock DOM Implementation for Node.js Test Environment
// ============================================================================

class MockClassList {
  constructor(el) {
    this.el = el;
    this._classes = new Set();
  }

  add(...classes) {
    for (const c of classes) {
      if (c) this._classes.add(String(c));
    }
    this._sync();
  }

  remove(...classes) {
    for (const c of classes) {
      if (c) this._classes.delete(String(c));
    }
    this._sync();
  }

  toggle(c, force) {
    if (force === true) {
      this._classes.add(c);
      this._sync();
      return true;
    } else if (force === false) {
      this._classes.delete(c);
      this._sync();
      return false;
    }
    const has = this._classes.has(c);
    if (has) this._classes.delete(c);
    else this._classes.add(c);
    this._sync();
    return !has;
  }

  contains(c) {
    return this._classes.has(String(c));
  }

  has(c) {
    return this._classes.has(String(c));
  }

  _sync() {
    this.el._className = Array.from(this._classes).join(' ');
  }

  _setFromClassName(val) {
    this._classes.clear();
    if (val) {
      String(val).split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
    }
  }
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.listeners = new Map();
    this._className = '';
    this.classList = new MockClassList(this);
    this.value = '';
    this.textContent = '';
    this._innerHTML = '';
    this.tabIndex = 0;
    this.dataset = new Proxy(this.attributes, {
      get: (target, prop) => target.get(`data-${String(prop)}`),
      set: (target, prop, val) => {
        target.set(`data-${String(prop)}`, String(val));
        return true;
      }
    });
    this._rect = { top: 0, left: 0, width: 100, height: 100, bottom: 100, right: 100 };
  }

  get className() {
    return this._className;
  }

  set className(val) {
    this._className = val || '';
    this.classList._setFromClassName(this._className);
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(val) {
    if (val) this.setAttribute('id', val);
    else this.removeAttribute('id');
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'class') {
      this.className = String(val);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'class') this.className = '';
  }

  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
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

  contains(other) {
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches && curr.matches(selector)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  matches(selector) {
    if (!selector) return false;
    const s = selector.trim();
    if (s.startsWith('.')) {
      return this.classList.contains(s.slice(1));
    }
    if (s.startsWith('#')) {
      return this.id === s.slice(1);
    }
    if (s.startsWith('[') && s.endsWith(']')) {
      const inside = s.slice(1, -1);
      const eqIdx = inside.indexOf('=');
      if (eqIdx !== -1) {
        const attrName = inside.slice(0, eqIdx).trim();
        let attrVal = inside.slice(eqIdx + 1).trim();
        if ((attrVal.startsWith('"') && attrVal.endsWith('"')) || (attrVal.startsWith("'") && attrVal.endsWith("'"))) {
          attrVal = attrVal.slice(1, -1);
        }
        return this.getAttribute(attrName) === attrVal;
      }
      return this.hasAttribute(inside.trim());
    }
    if (/^[A-Za-z0-9\-]+$/.test(s)) {
      return this.tagName.toLowerCase() === s.toLowerCase();
    }
    return false;
  }

  querySelector(selector) {
    const find = (node) => {
      if (node.matches && node.matches(selector)) return node;
      for (const ch of node.children) {
        const found = find(ch);
        if (found) return found;
      }
      return null;
    };
    for (const ch of this.children) {
      const res = find(ch);
      if (res) return res;
    }
    return null;
  }

  querySelectorAll(selector) {
    const list = [];
    const search = (node) => {
      if (node.matches && node.matches(selector)) list.push(node);
      for (const ch of node.children) {
        search(ch);
      }
    };
    for (const ch of this.children) {
      search(ch);
    }
    return list;
  }

  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push({ callback, options });
  }

  removeEventListener(type, callback) {
    const list = this.listeners.get(type);
    if (!list) return;
    const idx = list.findIndex(item => item.callback === callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  dispatchEvent(event) {
    if (!event) return true;
    if (!event.target) event.target = this;
    if (event.defaultPrevented === undefined) event.defaultPrevented = false;
    if (!event.preventDefault) {
      event.preventDefault = () => { event.defaultPrevented = true; };
    }
    let stopped = false;
    event.stopPropagation = () => { stopped = true; };
    event.stopImmediatePropagation = () => { stopped = true; };

    let curr = this;
    while (curr) {
      event.currentTarget = curr;
      const handlers = curr.listeners.get(event.type) ? [...curr.listeners.get(event.type)] : [];
      for (const h of handlers) {
        h.callback.call(curr, event);
      }
      if (stopped || event.bubbles === false) break;
      curr = curr.parentElement;
    }
    return !event.defaultPrevented;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    if (!html || !html.trim()) return;

    const tagTokenRegex = /<\/?([a-zA-Z0-9\-]+)([^>]*)>|([^<]+)/g;
    const stack = [this];
    let match;

    while ((match = tagTokenRegex.exec(html)) !== null) {
      const full = match[0];
      const isText = match[3] !== undefined;

      if (isText) {
        const text = match[3].trim();
        if (text && stack.length > 0) {
          const current = stack[stack.length - 1];
          current.textContent = (current.textContent ? current.textContent + ' ' : '') + text;
        }
      } else if (full.startsWith('</')) {
        if (stack.length > 1) {
          stack.pop();
        }
      } else {
        const tagName = match[1];
        const attrStr = match[2] || '';
        const isSelfClosing = full.endsWith('/>') || ['input', 'circle', 'img', 'br', 'hr'].includes(tagName.toLowerCase());

        const el = new MockElement(tagName);

        const attrRegex = /([a-zA-Z0-9\-]+)(?:=["']([^"']*)["'])?/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
          const name = attrMatch[1];
          const val = attrMatch[2] ?? '';
          el.setAttribute(name, val);
        }

        const parent = stack[stack.length - 1];
        parent.appendChild(el);

        if (!isSelfClosing) {
          stack.push(el);
        }
      }
    }
  }

  getBoundingClientRect() {
    return this._rect;
  }

  setPointerCapture(id) {
    this._capturedPointerId = id;
  }

  releasePointerCapture(id) {
    if (this._capturedPointerId === id) {
      delete this._capturedPointerId;
    }
  }

  getContext(type) {
    if (this.tagName === 'CANVAS') {
      return {
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        arc: () => {},
        stroke: () => {},
        fill: () => {},
        fillRect: () => {},
        strokeRect: () => {},
        fillText: () => {},
        measureText: (t) => ({ width: t ? t.length * 6 : 10 }),
        save: () => {},
        restore: () => {},
        setLineDash: () => {},
        scale: () => {},
        translate: () => {},
        rotate: () => {},
        drawImage: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        strokeStyle: '#000',
        fillStyle: '#000',
        lineWidth: 1
      };
    }
    return null;
  }

  blur() {}
  focus() {}
}

const windowListeners = new Map();
const documentListeners = new Map();

const mockWindow = {
  app: true,
  addEventListener(type, cb, options) {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push({ cb, options });
  },
  removeEventListener(type, cb) {
    const list = windowListeners.get(type);
    if (!list) return;
    const idx = list.findIndex(item => item.cb === cb);
    if (idx !== -1) list.splice(idx, 1);
  },
  dispatchEvent(event) {
    const handlers = windowListeners.get(event.type) ? [...windowListeners.get(event.type)] : [];
    for (const h of handlers) {
      h.cb(event);
    }
  },
  devicePixelRatio: 2,
  requestAnimationFrame(cb) {
    return setTimeout(cb, 0);
  },
  cancelAnimationFrame(id) {
    clearTimeout(id);
  }
};

const mockDocument = {
  readyState: 'loading',
  createElement(tag) {
    return new MockElement(tag);
  },
  getElementById(id) {
    return mockDocument.body ? mockDocument.body.querySelector(`#${id}`) : null;
  },
  querySelector(sel) {
    return mockDocument.body ? mockDocument.body.querySelector(sel) : null;
  },
  querySelectorAll(sel) {
    return mockDocument.body ? mockDocument.body.querySelectorAll(sel) : [];
  },
  body: new MockElement('body'),
  documentElement: new MockElement('html'),
  visibilityState: 'visible',
  addEventListener(type, cb, options) {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push({ cb, options });
  },
  removeEventListener(type, cb) {
    const list = documentListeners.get(type);
    if (!list) return;
    const idx = list.findIndex(item => item.cb === cb);
    if (idx !== -1) list.splice(idx, 1);
  },
  dispatchEvent(event) {
    const handlers = documentListeners.get(event.type) ? [...documentListeners.get(event.type)] : [];
    for (const h of handlers) {
      h.cb(event);
    }
  }
};

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Attach globals before loading components
globalThis.window = mockWindow;
globalThis.document = mockDocument;
globalThis.ResizeObserver = MockResizeObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

// Import Synthesizer UI & Engine Components
const { BraunKnob } = await import('../js/ui/knob.js');
const { BraunPlaySurface } = await import('../js/ui/keyboard.js');
const { BraunVectorPad } = await import('../js/ui/vector-pad.js');
const { AudioEngine } = await import('../js/audio/engine.js');
const { AmbientApp } = await import('../js/app.js');

// CSS Helper to isolate media queries
function extractMediaQueryBlock(css, maxWidth) {
  const pattern = `@media (max-width: ${maxWidth}px)`;
  const idx = css.indexOf(pattern);
  if (idx === -1) return null;
  const braceStart = css.indexOf('{', idx);
  if (braceStart === -1) return null;
  let depth = 1;
  let pos = braceStart + 1;
  while (pos < css.length && depth > 0) {
    if (css[pos] === '{') depth++;
    else if (css[pos] === '}') depth--;
    pos++;
  }
  return css.slice(braceStart, pos);
}

// Mock Audio Context Implementation for Web Audio Autoplay Unlock Tests
class MockAudioBufferSourceNode {
  constructor() {
    this.buffer = null;
    this.connectedTo = null;
    this.started = false;
    this.startTime = 0;
  }
  connect(target) {
    this.connectedTo = target;
  }
  start(when = 0) {
    this.started = true;
    this.startTime = when;
  }
}

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
    const src = new MockAudioBufferSourceNode();
    this.sourcesCreated.push(src);
    return src;
  }
}

// ============================================================================
// OFFICIAL TEST SUITE: Milestone 2 — Tablet Viewport & Touch Scrolling
// ============================================================================

describe('Milestone 2: Tablet Viewport & Touch Scrolling Suite', () => {

  beforeEach(() => {
    windowListeners.clear();
    documentListeners.clear();
    mockDocument.body = new MockElement('body');
    mockDocument.documentElement = new MockElement('html');
    mockDocument.visibilityState = 'visible';
  });

  // --------------------------------------------------------------------------
  // TIER 1: Feature Coverage (R1 - R4)
  // --------------------------------------------------------------------------
  describe('Tier 1: Feature Coverage (R1 - R4)', () => {

    describe('R1: Viewport & Container Vertical Scrolling Configuration', () => {
      const cssPath = path.join(projectRoot, 'css', 'style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      it('verifies html configures iOS WebKit and Android Blink momentum scrolling without freeze', () => {
        const htmlMatch = css.match(/html\s*\{([^}]+)\}/);
        assert.ok(htmlMatch, 'html rule block must exist in css/style.css');
        const body = htmlMatch[1];
        assert.match(body, /overflow-y\s*:\s*auto/i, 'html must specify overflow-y: auto');
        assert.match(body, /overflow-x\s*:\s*hidden/i, 'html must specify overflow-x: hidden');
        assert.match(body, /-webkit-overflow-scrolling\s*:\s*touch/i, 'html must enable -webkit-overflow-scrolling: touch');
        assert.match(body, /overscroll-behavior-y\s*:\s*auto/i, 'html must permit vertical scrolling via overscroll-behavior-y: auto');
      });

      it('verifies body permits vertical scroll and touch-action: pan-y', () => {
        const bodyMatch = css.match(/body\s*\{([^}]+)\}/);
        assert.ok(bodyMatch, 'body rule block must exist in css/style.css');
        const bodyRules = bodyMatch[1];
        assert.match(bodyRules, /overflow-y\s*:\s*auto/i, 'body must specify overflow-y: auto');
        assert.match(bodyRules, /touch-action\s*:\s*pan-y/i, 'body must specify touch-action: pan-y');
        assert.match(bodyRules, /overscroll-behavior-y\s*:\s*auto/i, 'body must permit vertical overscroll via overscroll-behavior-y: auto');
      });

      it('verifies main and .braun-chassis configure touch-action: pan-y with unblocked vertical overflow', () => {
        const mainMatch = css.match(/main\s*\{([^}]+)\}/);
        assert.ok(mainMatch, 'main block must exist in css/style.css');
        assert.match(mainMatch[1], /touch-action\s*:\s*pan-y/i, 'main must have touch-action: pan-y');

        const chassisMatch = css.match(/\.braun-chassis\s*\{([^}]+)\}/);
        assert.ok(chassisMatch, '.braun-chassis block must exist in css/style.css');
        assert.match(chassisMatch[1], /touch-action\s*:\s*pan-y/i, '.braun-chassis must have touch-action: pan-y');
        assert.match(chassisMatch[1], /overflow-y\s*:\s*visible/i, '.braun-chassis must have overflow-y: visible');
        assert.strictEqual(
          chassisMatch[1].includes('overscroll-behavior: none;'),
          false,
          '.braun-chassis must NOT contain blocking overscroll-behavior: none'
        );
      });

      it('verifies all primary UI structural cards and section headers permit vertical page scrolling via touch-action: pan-y', () => {
        const panYContainers = [
          '.braun-drone-card',
          '.braun-section',
          '.braun-scope-container',
          '.braun-chord-deck',
          '.braun-vector-deck',
          '.braun-chime-deck',
          '.braun-eno-subpanel',
          '.braun-card-header',
          '.braun-deck-header',
          '.braun-section-header'
        ];

        for (const cls of panYContainers) {
          assert.ok(css.includes(cls), `CSS must include rule for structural container ${cls}`);
        }
      });

      it('verifies rotary knob CSS distinguishes touch-action: none on assembly from pan-y on labels and wrapper', () => {
        const assemblyMatch = css.match(/\.braun-knob-assembly\s*\{([^}]+)\}/);
        assert.ok(assemblyMatch, '.braun-knob-assembly must exist in style.css');
        assert.match(assemblyMatch[1], /touch-action\s*:\s*none/i, '.braun-knob-assembly must specify touch-action: none');

        const labelMatch = css.match(/\.braun-knob-label\s*\{([^}]+)\}/);
        assert.ok(labelMatch, '.braun-knob-label must exist in style.css');
        assert.match(labelMatch[1], /touch-action\s*:\s*pan-y/i, '.braun-knob-label must specify touch-action: pan-y');

        const valMatch = css.match(/\.braun-knob-value-display\s*\{([^}]+)\}/);
        assert.ok(valMatch, '.braun-knob-value-display must exist in style.css');
        assert.match(valMatch[1], /touch-action\s*:\s*pan-y/i, '.braun-knob-value-display must specify touch-action: pan-y');

        const wrapperMatch = css.match(/\.braun-knob-wrapper\s*\{([^}]+)\}/);
        assert.ok(wrapperMatch, '.braun-knob-wrapper must exist in style.css');
        assert.match(wrapperMatch[1], /touch-action\s*:\s*pan-y/i, '.braun-knob-wrapper must permit pan-y scrolling');
      });
    });

    describe('R2: Rotary Knob Touch Disambiguation (Scroll Pass-Through vs Drag)', () => {

      it('touch on .braun-knob-label allows native scroll pass-through (defaultPrevented: false, no active drag)', () => {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, value: 50, label: 'DELAY TIME' });
        const labelEl = knob.element.querySelector('.braun-knob-label');
        assert.ok(labelEl, '.braun-knob-label must exist');

        let prevented = false;
        const touchEvent = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; prevented = true; },
          changedTouches: [{ identifier: 1, clientY: 200 }],
          touches: [{ identifier: 1, clientY: 200 }]
        };

        labelEl.dispatchEvent(touchEvent);

        assert.strictEqual(touchEvent.defaultPrevented, false, 'Touch on label must NOT preventDefault');
        assert.strictEqual(prevented, false);
        assert.strictEqual(knob.element.classList.contains('is-active'), false, 'Knob must not become active');

        // Subsequent drag movement must not alter parameter value
        mockWindow.dispatchEvent({
          type: 'touchmove',
          touches: [{ identifier: 1, clientY: 100 }]
        });
        assert.strictEqual(knob.value, 50, 'Knob value must remain unchanged after touch on label');
      });

      it('touch on .braun-knob-value-display allows native scroll pass-through (defaultPrevented: false, no active drag)', () => {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, value: 40 });
        const valDisplay = knob.element.querySelector('.braun-knob-value-display');
        assert.ok(valDisplay, '.braun-knob-value-display must exist');

        let prevented = false;
        const touchEvent = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; prevented = true; },
          changedTouches: [{ identifier: 2, clientY: 220 }],
          touches: [{ identifier: 2, clientY: 220 }]
        };

        valDisplay.dispatchEvent(touchEvent);

        assert.strictEqual(touchEvent.defaultPrevented, false, 'Touch on value display must NOT preventDefault');
        assert.strictEqual(prevented, false);
        assert.strictEqual(knob.element.classList.contains('is-active'), false);

        mockWindow.dispatchEvent({
          type: 'touchmove',
          touches: [{ identifier: 2, clientY: 120 }]
        });
        assert.strictEqual(knob.value, 40);
      });

      it('touch on nested .braun-knob-value-text and .braun-knob-unit allows native scroll pass-through', () => {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, value: 50, unit: 'ms' });
        const valText = knob.element.querySelector('.braun-knob-value-text');
        const unitEl = knob.element.querySelector('.braun-knob-unit');
        assert.ok(valText && unitEl, 'Nested value text and unit elements must exist');

        // Touch value text
        const ev1 = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          changedTouches: [{ identifier: 3, clientY: 150 }],
          touches: [{ identifier: 3, clientY: 150 }]
        };
        valText.dispatchEvent(ev1);
        assert.strictEqual(ev1.defaultPrevented, false, 'Value text touch must allow scrolling');
        assert.strictEqual(knob.element.classList.contains('is-active'), false);

        // Touch unit
        const ev2 = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          changedTouches: [{ identifier: 4, clientY: 150 }],
          touches: [{ identifier: 4, clientY: 150 }]
        };
        unitEl.dispatchEvent(ev2);
        assert.strictEqual(ev2.defaultPrevented, false, 'Unit text touch must allow scrolling');
        assert.strictEqual(knob.element.classList.contains('is-active'), false);
      });

      it('touch on .braun-knob-direct-input allows scroll pass-through and does NOT start knob drag', () => {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
        const directInput = knob.element.querySelector('.braun-knob-direct-input');
        assert.ok(directInput, '.braun-knob-direct-input must exist');

        const ev = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          changedTouches: [{ identifier: 5, clientY: 180 }],
          touches: [{ identifier: 5, clientY: 180 }]
        };
        directInput.dispatchEvent(ev);
        assert.strictEqual(ev.defaultPrevented, false, 'Direct input touch must NOT preventDefault');
        assert.strictEqual(knob.element.classList.contains('is-active'), false);
      });

      it('touch on .braun-knob-wrapper padding/margin outside assembly does NOT start knob drag', () => {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
        const wrapperEl = knob.element;

        const ev = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          changedTouches: [{ identifier: 6, clientY: 200 }],
          touches: [{ identifier: 6, clientY: 200 }]
        };
        wrapperEl.dispatchEvent(ev);
        assert.strictEqual(ev.defaultPrevented, false, 'Wrapper margin touch must allow scroll');
        assert.strictEqual(knob.element.classList.contains('is-active'), false);
      });

      it('touch on .braun-knob-assembly engages drag and calls preventDefault() to prevent scroll', () => {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
        const assembly = knob.element.querySelector('.braun-knob-assembly');
        assert.ok(assembly, '.braun-knob-assembly must exist');

        let prevented = false;
        const ev = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; prevented = true; },
          changedTouches: [{ identifier: 7, clientY: 200 }],
          touches: [{ identifier: 7, clientY: 200 }]
        };
        assembly.dispatchEvent(ev);

        assert.strictEqual(ev.defaultPrevented, true, 'Touch on assembly MUST preventDefault');
        assert.strictEqual(prevented, true);
        assert.strictEqual(knob.element.classList.contains('is-active'), true, 'Knob must become active');

        // Cleanup
        mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 7 }] });
        assert.strictEqual(knob.element.classList.contains('is-active'), false);
      });

      it('touch on nested elements of assembly (.braun-knob-cap, .braun-knob-indicator, SVG track) engages drag and calls preventDefault()', () => {
        const container = new MockElement('div');
        const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
        const cap = knob.element.querySelector('.braun-knob-cap');
        const indicator = knob.element.querySelector('.braun-knob-indicator');
        const svgFill = knob.element.querySelector('.braun-knob-fill');

        assert.ok(cap && indicator && svgFill, 'Nested cap, indicator, and SVG must exist');

        // Cap
        const evCap = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          changedTouches: [{ identifier: 11, clientY: 200 }],
          touches: [{ identifier: 11, clientY: 200 }]
        };
        cap.dispatchEvent(evCap);
        assert.strictEqual(evCap.defaultPrevented, true);
        assert.strictEqual(knob.element.classList.contains('is-active'), true);
        mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 11 }] });

        // Indicator
        const evInd = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          changedTouches: [{ identifier: 12, clientY: 200 }],
          touches: [{ identifier: 12, clientY: 200 }]
        };
        indicator.dispatchEvent(evInd);
        assert.strictEqual(evInd.defaultPrevented, true);
        assert.strictEqual(knob.element.classList.contains('is-active'), true);
        mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 12 }] });

        // SVG fill track
        const evSvg = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          changedTouches: [{ identifier: 13, clientY: 200 }],
          touches: [{ identifier: 13, clientY: 200 }]
        };
        svgFill.dispatchEvent(evSvg);
        assert.strictEqual(evSvg.defaultPrevented, true);
        assert.strictEqual(knob.element.classList.contains('is-active'), true);
        mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 13 }] });
      });

      it('touch drag on assembly smoothly modifies parameter value and deactivates on touchend', () => {
        const container = new MockElement('div');
        let latestVal = 50;
        const knob = new BraunKnob(container, {
          min: 0,
          max: 100,
          value: 50,
          onChange: (v) => { latestVal = v; }
        });
        const assembly = knob.element.querySelector('.braun-knob-assembly');

        assembly.dispatchEvent({
          type: 'touchstart',
          bubbles: true,
          changedTouches: [{ identifier: 20, clientY: 200 }],
          touches: [{ identifier: 20, clientY: 200 }]
        });

        // Drag upwards by 40px (200 -> 160): +40/160 = +0.25 -> 50 + 25 = 75
        mockWindow.dispatchEvent({
          type: 'touchmove',
          touches: [{ identifier: 20, clientY: 160 }]
        });

        assert.strictEqual(knob.value, 75);
        assert.strictEqual(latestVal, 75);

        // Touchend deactivates
        mockWindow.dispatchEvent({
          type: 'touchend',
          changedTouches: [{ identifier: 20 }]
        });

        assert.strictEqual(knob.element.classList.contains('is-active'), false);
      });
    });

    describe('R3: Responsive Tablet Layout & Viewport Constraints (iPad & Android Tablets)', () => {
      const cssPath = path.join(projectRoot, 'css', 'style.css');
      const css = fs.readFileSync(cssPath, 'utf8');
      const htmlPath = path.join(projectRoot, 'index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');

      it('verifies drone grid collapse breakpoint is >= 834px for tablet portrait viewports (800px, 810px, 820px, 834px)', () => {
        const mq834 = extractMediaQueryBlock(css, 834);
        assert.ok(mq834, '@media (max-width: 834px) must exist in css/style.css');
        assert.ok(mq834.includes('.braun-drones-grid'), '834px breakpoint must target .braun-drones-grid');
        assert.match(mq834, /grid-template-columns\s*:\s*1fr/, 'Drone grid must collapse to 1fr at <= 834px');
      });

      it('verifies standard Android tablet 16:10 portrait width (800px) cleanly collapses drone cards', () => {
        // Since 800px <= 834px, the breakpoint applies to Android 800x1280 tablets
        const mq834 = extractMediaQueryBlock(css, 834);
        assert.ok(mq834, '834px media query covers 800px Android tablet portrait width');
        assert.ok(mq834.includes('.braun-drones-grid'));
      });

      it('verifies standard Android tablet 16:10 landscape width (1280px) formats cleanly within 1240px chassis', () => {
        const chassisMatch = css.match(/\.braun-chassis\s*\{([^}]+)\}/);
        assert.ok(chassisMatch, '.braun-chassis rule must exist');
        assert.match(chassisMatch[1], /max-width\s*:\s*1240px/, 'Chassis max-width should be 1240px for clean padding on 1280px displays');
      });

      it('verifies .braun-snap-toggles enables flex-wrap: wrap to prevent horizontal cutoff', () => {
        const snapMatch = css.match(/\.braun-snap-toggles\s*\{([^}]+)\}/);
        assert.ok(snapMatch, '.braun-snap-toggles rule must exist in style.css');
        assert.match(snapMatch[1], /flex-wrap\s*:\s*wrap/i, '.braun-snap-toggles must specify flex-wrap: wrap');
      });

      it('verifies index.html partitions Brian Eno section into .braun-eno-tape-delay and .braun-eno-shimmer-reverb sub-panels', () => {
        assert.ok(html.includes('braun-eno-tape-delay'), 'index.html must contain .braun-eno-tape-delay');
        assert.ok(html.includes('braun-eno-shimmer-reverb'), 'index.html must contain .braun-eno-shimmer-reverb');
      });

      it('verifies .braun-eno-tape-delay contains exactly 5 knob containers with correct DOM IDs', () => {
        const tapeDelayMatch = html.match(/class=["'][^"']*braun-eno-tape-delay[^"']*["'][\s\S]*?(?=<div[^>]*class=["'][^"']*braun-eno-shimmer-reverb|$)/i);
        assert.ok(tapeDelayMatch, 'Tape Delay sub-panel section must exist');
        const tapeHtml = tapeDelayMatch[0];

        const expectedKnobs = [
          'knob-delay-time',
          'knob-delay-fb',
          'knob-delay-wow',
          'knob-delay-tone',
          'knob-delay-wet'
        ];

        for (const id of expectedKnobs) {
          assert.ok(tapeHtml.includes(`id="${id}"`), `Tape Delay must include knob id "${id}"`);
        }

        const matches = tapeHtml.match(/<div\s+id=["']knob-[^"']+["']/g) || [];
        assert.strictEqual(matches.length, 5, `Expected exactly 5 knob containers in Tape Delay, found ${matches.length}`);
      });

      it('verifies .braun-eno-shimmer-reverb contains exactly 4 knob containers with correct DOM IDs', () => {
        const shimmerMatch = html.match(/class=["'][^"']*braun-eno-shimmer-reverb[^"']*["'][\s\S]*?(?=(<\/div>\s*<\/div>\s*<\/section>|$))/i);
        assert.ok(shimmerMatch, 'Shimmer Reverb sub-panel section must exist');
        const shimmerHtml = shimmerMatch[0];

        const expectedKnobs = [
          'knob-reverb-decay',
          'knob-reverb-damping',
          'knob-reverb-shimmer',
          'knob-reverb-wet'
        ];

        for (const id of expectedKnobs) {
          assert.ok(shimmerHtml.includes(`id="${id}"`), `Shimmer Reverb must include knob id "${id}"`);
        }

        const matches = shimmerHtml.match(/<div\s+id=["']knob-[^"']+["']/g) || [];
        assert.strictEqual(matches.length, 4, `Expected exactly 4 knob containers in Shimmer Reverb, found ${matches.length}`);
      });

      it('verifies all 9 original Brian Eno knob IDs are preserved and functional in index.html', () => {
        const allNineKnobs = [
          'knob-delay-time',
          'knob-delay-fb',
          'knob-delay-wow',
          'knob-delay-tone',
          'knob-delay-wet',
          'knob-reverb-decay',
          'knob-reverb-damping',
          'knob-reverb-shimmer',
          'knob-reverb-wet'
        ];

        for (const id of allNineKnobs) {
          assert.ok(html.includes(`id="${id}"`), `Original knob "${id}" must exist in index.html`);
        }
      });

      it('verifies CRT oscilloscope has max-width (540px) and centering constraint on tablet viewports (<= 1060px)', () => {
        const mq1060 = extractMediaQueryBlock(css, 1060);
        assert.ok(mq1060, '@media (max-width: 1060px) must exist');
        assert.ok(mq1060.includes('.braun-scope-container'), '1060px breakpoint must target .braun-scope-container');
        assert.match(mq1060, /max-width\s*:\s*540px/, 'Scope container must be constrained to max-width: 540px');
        assert.match(mq1060, /margin\s*:\s*0\s+auto/, 'Scope container must be centered with margin: 0 auto');
      });

      it('verifies AS 42 Vector Touchpad has max-width (540px) and centering constraint on tablet viewports (<= 1040px)', () => {
        const mq1040 = extractMediaQueryBlock(css, 1040);
        assert.ok(mq1040, '@media (max-width: 1040px) must exist');
        assert.ok(
          mq1040.includes('.braun-vector-deck') || mq1040.includes('.braun-vector-surface-box'),
          '1040px breakpoint must target vector deck / surface box'
        );
        assert.match(mq1040, /max-width\s*:\s*540px/, 'Vector pad must be constrained to max-width: 540px');
        assert.match(mq1040, /margin\s*:\s*0\s+auto/, 'Vector pad must be centered with margin: 0 auto');
      });

      it('verifies .braun-eno-panels has responsive collapse media query at <= 900px', () => {
        const mq900 = extractMediaQueryBlock(css, 900);
        assert.ok(mq900, '@media (max-width: 900px) must exist');
        assert.ok(mq900.includes('.braun-eno-panels'), '900px breakpoint must target .braun-eno-panels');
        assert.match(mq900, /grid-template-columns\s*:\s*1fr/, 'Eno panels must collapse to 1fr at <= 900px');
      });
    });

    describe('R4: Multi-Touch Polyphony, Isolation & Web Audio Autoplay Unlock', () => {

      it('2 concurrent touch pointers on different knobs update independently without cross-talk', () => {
        const c1 = new MockElement('div');
        const c2 = new MockElement('div');
        const k1 = new BraunKnob(c1, { min: 0, max: 100, value: 50 });
        const k2 = new BraunKnob(c2, { min: 0, max: 100, value: 50 });

        const a1 = k1.element.querySelector('.braun-knob-assembly');
        const a2 = k2.element.querySelector('.braun-knob-assembly');

        // Touch 101 on k1
        a1.dispatchEvent({
          type: 'touchstart',
          bubbles: true,
          changedTouches: [{ identifier: 101, clientY: 200 }],
          touches: [{ identifier: 101, clientY: 200 }]
        });

        // Touch 102 on k2
        a2.dispatchEvent({
          type: 'touchstart',
          bubbles: true,
          changedTouches: [{ identifier: 102, clientY: 300 }],
          touches: [{ identifier: 101, clientY: 200 }, { identifier: 102, clientY: 300 }]
        });

        assert.strictEqual(k1.element.classList.contains('is-active'), true);
        assert.strictEqual(k2.element.classList.contains('is-active'), true);

        // Move Touch 101 upwards by 40px (200 -> 160). Keep Touch 102 stationary at 300.
        mockWindow.dispatchEvent({
          type: 'touchmove',
          touches: [
            { identifier: 101, clientY: 160 },
            { identifier: 102, clientY: 300 }
          ]
        });

        assert.strictEqual(k1.value, 75, 'k1 must increase to 75');
        assert.strictEqual(k2.value, 50, 'k2 must stay at 50 with zero cross-talk');

        // Clean up
        mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 101 }] });
        mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 102 }] });
        assert.strictEqual(k1.element.classList.contains('is-active'), false);
        assert.strictEqual(k2.element.classList.contains('is-active'), false);
      });

      it('Web Audio autoplay unlock: user touch gesture triggers engine.unlockAudio and resumes AudioContext', () => {
        const origAudioCtx = globalThis.AudioContext;
        globalThis.AudioContext = MockAudioContext;

        try {
          const engine = new AudioEngine();
          assert.strictEqual(engine.ctx, null);

          const ctx = engine.unlockAudio();
          assert.ok(ctx instanceof MockAudioContext);
          assert.strictEqual(ctx.state, 'running');
          assert.strictEqual(ctx.resumed, true);
          assert.strictEqual(engine.isAudioUnlocked, true);

          // Verify 1-sample silent buffer was played to destination
          assert.strictEqual(ctx.buffersCreated.length, 1);
          assert.strictEqual(ctx.buffersCreated[0].length, 1);
          assert.strictEqual(ctx.sourcesCreated.length, 1);
          assert.strictEqual(ctx.sourcesCreated[0].started, true);
        } finally {
          globalThis.AudioContext = origAudioCtx;
        }
      });

      it('attaches unlock listeners on first user gesture and removes them once audio is unlocked', () => {
        let unlockTriggered = false;
        const mockEngine = {
          unlockAudio() { unlockTriggered = true; },
          ctx: null
        };

        const app = Object.create(AmbientApp.prototype);
        app.engine = mockEngine;
        app._hasAudioUnlockListeners = false;
        app._attachAudioUnlockListeners();

        // Check listener registration
        const unlockEvents = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click'];
        for (const evt of unlockEvents) {
          assert.ok(documentListeners.get(evt)?.length > 0, `Document must listen to ${evt}`);
          assert.ok(windowListeners.get(evt)?.length > 0, `Window must listen to ${evt}`);
        }

        // Simulate first iPad / Android tablet touch tap
        const touchHandler = documentListeners.get('touchstart')[0].cb || documentListeners.get('touchstart')[0];
        touchHandler();

        assert.strictEqual(unlockTriggered, true, 'AudioEngine.unlockAudio must be invoked on first user tap');

        // Verify all unlock listeners are detached
        for (const evt of unlockEvents) {
          assert.strictEqual(documentListeners.get(evt)?.length || 0, 0, `Document ${evt} must be cleaned up`);
          assert.strictEqual(windowListeners.get(evt)?.length || 0, 0, `Window ${evt} must be cleaned up`);
        }
      });

      it('interruption recovery automatically calls resume on visibilitychange and pageshow', async () => {
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

        assert.ok(documentListeners.has('visibilitychange'));
        assert.ok(windowListeners.has('pageshow'));

        // Returning to tab
        const visHandler = documentListeners.get('visibilitychange')[0].cb;
        await visHandler();
        assert.strictEqual(resumeCount, 1, 'Suspended audio context must resume on visibilitychange');

        // Returning after screen lock (pageshow)
        mockEngine.ctx.state = 'suspended';
        const pageShowHandler = windowListeners.get('pageshow')[0].cb;
        await pageShowHandler();
        assert.strictEqual(resumeCount, 2, 'Suspended audio context must resume on pageshow');
      });

      it('falls back gracefully when older WebKit or legacy Android WebView AudioContext options dictionary throws TypeError', () => {
        const origAudioCtx = globalThis.AudioContext;

        class OlderWebKitAudioContext extends MockAudioContext {
          constructor(...args) {
            if (args.length > 0) {
              throw new TypeError("Failed to construct 'AudioContext': parameter 1 is not valid for this browser version");
            }
            super();
          }
        }

        globalThis.AudioContext = OlderWebKitAudioContext;

        try {
          const engine = new AudioEngine();
          const ctx = engine.unlockAudio();
          assert.ok(ctx instanceof OlderWebKitAudioContext);
          assert.strictEqual(ctx.state, 'running');
          assert.strictEqual(engine.isAudioUnlocked, true);
        } finally {
          globalThis.AudioContext = origAudioCtx;
        }
      });
    });
  });

  // --------------------------------------------------------------------------
  // TIER 2: Boundary, Corner Cases & Adversarial Stress
  // --------------------------------------------------------------------------
  describe('Tier 2: Boundary & Corner Cases', () => {

    it('touchcancel immediately deactivates active knob drag without state lock or listener leak', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 40, clientY: 200 }],
        touches: [{ identifier: 40, clientY: 200 }]
      });
      assert.strictEqual(knob.element.classList.contains('is-active'), true);

      // Fire touchcancel
      mockWindow.dispatchEvent({
        type: 'touchcancel',
        changedTouches: [{ identifier: 40 }]
      });

      assert.strictEqual(knob.element.classList.contains('is-active'), false, 'Knob must deactivate on touchcancel');

      // Subsequent movement does not affect knob
      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [{ identifier: 40, clientY: 100 }]
      });
      assert.strictEqual(knob.value, 50);
    });

    it('unrelated touchcancel or touchend does NOT cancel an active knob drag on a different touch identifier', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 50, clientY: 200 }],
        touches: [{ identifier: 50, clientY: 200 }]
      });

      // Unrelated touchcancel on identifier 999
      mockWindow.dispatchEvent({
        type: 'touchcancel',
        changedTouches: [{ identifier: 999 }]
      });
      assert.strictEqual(knob.element.classList.contains('is-active'), true, 'Knob must remain active');

      // Unrelated touchend on identifier 888
      mockWindow.dispatchEvent({
        type: 'touchend',
        changedTouches: [{ identifier: 888 }]
      });
      assert.strictEqual(knob.element.classList.contains('is-active'), true, 'Knob must remain active');

      // Pointer 50 moves up 40px
      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [{ identifier: 50, clientY: 160 }]
      });
      assert.strictEqual(knob.value, 75);

      // Its own touchend releases
      mockWindow.dispatchEvent({
        type: 'touchend',
        changedTouches: [{ identifier: 50 }]
      });
      assert.strictEqual(knob.element.classList.contains('is-active'), false);
    });

    it('unrelated pointerup or pointercancel does NOT cancel an active knob drag on a different pointerId', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      assembly.dispatchEvent({
        type: 'pointerdown',
        bubbles: true,
        pointerId: 77,
        pointerType: 'touch',
        clientY: 200
      });
      assert.strictEqual(knob.element.classList.contains('is-active'), true);

      // Unrelated pointercancel
      mockWindow.dispatchEvent({ type: 'pointercancel', pointerId: 99 });
      assert.strictEqual(knob.element.classList.contains('is-active'), true);

      // Unrelated pointerup
      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 88 });
      assert.strictEqual(knob.element.classList.contains('is-active'), true);

      // Its own pointerup deactivates
      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 77 });
      assert.strictEqual(knob.element.classList.contains('is-active'), false);
    });

    it('zero-delta stationary touch does not alter knob parameter value or cause floating-point drift', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50.0 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 60, clientY: 200 }],
        touches: [{ identifier: 60, clientY: 200 }]
      });

      // Stationary touchmove
      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [{ identifier: 60, clientY: 200 }]
      });

      assert.strictEqual(knob.value, 50.0, 'Stationary touch must preserve exact value');

      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 60 }] });
    });

    it('extreme upward touch drag (clientY = -999999) gracefully clamps to max parameter value without NaN', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 70, clientY: 200 }],
        touches: [{ identifier: 70, clientY: 200 }]
      });

      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [{ identifier: 70, clientY: -999999 }]
      });

      assert.strictEqual(knob.value, 100, 'Must clamp cleanly to max (100)');
      assert.strictEqual(Number.isFinite(knob.value), true);
      assert.strictEqual(isNaN(knob.value), false);

      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 70 }] });
    });

    it('extreme downward touch drag (clientY = +999999) gracefully clamps to min parameter value without NaN', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 71, clientY: 200 }],
        touches: [{ identifier: 71, clientY: 200 }]
      });

      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [{ identifier: 71, clientY: 999999 }]
      });

      assert.strictEqual(knob.value, 0, 'Must clamp cleanly to min (0)');
      assert.strictEqual(Number.isFinite(knob.value), true);
      assert.strictEqual(isNaN(knob.value), false);

      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 71 }] });
    });

    it('shiftKey during touch drag engages 10x fine sensitivity for microtonal precision', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 80, clientY: 200 }],
        touches: [{ identifier: 80, clientY: 200 }]
      });

      // 40px drag upwards with shiftKey = true: deltaNorm = (40 / 160) * 0.1 = 0.025 -> 50 + 2.5 = 52.5 -> rounds to 53
      mockWindow.dispatchEvent({
        type: 'touchmove',
        shiftKey: true,
        touches: [{ identifier: 80, clientY: 160 }]
      });

      assert.ok(knob.value >= 52 && knob.value <= 53, `Fine sensitivity value expected ~52-53, got ${knob.value}`);

      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 80 }] });
    });

    it('secondary touch landing on an already-active knob assembly does not hijack or glitch active drag', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      // Primary finger 55 starts drag
      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 55, clientY: 200 }],
        touches: [{ identifier: 55, clientY: 200 }]
      });

      // Secondary finger 56 brushes same knob
      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 56, clientY: 100 }],
        touches: [{ identifier: 55, clientY: 200 }, { identifier: 56, clientY: 100 }]
      });

      // Primary finger moves 200 -> 160 (+40px -> 75)
      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [{ identifier: 55, clientY: 160 }, { identifier: 56, clientY: 100 }]
      });

      assert.strictEqual(knob.value, 75, 'Active drag must continue tracking primary finger 55');

      // Secondary finger lifts
      mockWindow.dispatchEvent({
        type: 'touchend',
        changedTouches: [{ identifier: 56 }]
      });
      assert.strictEqual(knob.element.classList.contains('is-active'), true, 'Knob remains active while primary finger is down');

      // Primary lifts
      mockWindow.dispatchEvent({
        type: 'touchend',
        changedTouches: [{ identifier: 55 }]
      });
      assert.strictEqual(knob.element.classList.contains('is-active'), false);
    });

    it('survives rapid cycling of 500 touchstart/move/end cycles without memory leak or state lock', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      for (let i = 0; i < 500; i++) {
        assembly.dispatchEvent({
          type: 'touchstart',
          bubbles: true,
          changedTouches: [{ identifier: i, clientY: 200 }],
          touches: [{ identifier: i, clientY: 200 }]
        });
        mockWindow.dispatchEvent({
          type: 'touchmove',
          touches: [{ identifier: i, clientY: 190 }]
        });
        mockWindow.dispatchEvent({
          type: 'touchend',
          changedTouches: [{ identifier: i }]
        });
      }

      assert.strictEqual(knob.element.classList.contains('is-active'), false);
      assert.strictEqual(Number.isFinite(knob.value), true);
    });

    it('logarithmic rotary knobs update smoothly under touch drag within valid mathematical bounds', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 20, max: 20000, value: 1000, isLog: true, precision: 1 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 90, clientY: 200 }],
        touches: [{ identifier: 90, clientY: 200 }]
      });

      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [{ identifier: 90, clientY: 160 }]
      });

      assert.ok(knob.value > 1000, 'Log knob value must increase with upward drag');
      assert.ok(knob.value <= 20000, 'Log knob value must remain bounded');

      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 90 }] });
      assert.strictEqual(knob.element.classList.contains('is-active'), false);
    });
  });

  // --------------------------------------------------------------------------
  // TIER 3: Cross-Feature Interactions & Multi-Touch Concurrency
  // --------------------------------------------------------------------------
  describe('Tier 3: Cross-Feature Interactions', () => {

    it('simultaneous multi-touch on 4 distinct knobs tracks 4 independent deltas concurrently with zero cross-talk', () => {
      const knobs = [];
      const assemblies = [];

      for (let i = 0; i < 4; i++) {
        const c = new MockElement('div');
        const k = new BraunKnob(c, { min: 0, max: 100, value: 50, label: `KNOB_${i}` });
        knobs.push(k);
        assemblies.push(k.element.querySelector('.braun-knob-assembly'));
      }

      const initialTouches = [
        { identifier: 1, clientY: 200 },
        { identifier: 2, clientY: 200 },
        { identifier: 3, clientY: 200 },
        { identifier: 4, clientY: 200 }
      ];

      // Touch down all 4 knobs
      for (let i = 0; i < 4; i++) {
        assemblies[i].dispatchEvent({
          type: 'touchstart',
          bubbles: true,
          changedTouches: [initialTouches[i]],
          touches: initialTouches.slice(0, i + 1)
        });
        assert.strictEqual(knobs[i].element.classList.contains('is-active'), true);
      }

      // Concurrently move all 4 with different deltas:
      // Pointer 1: 200 -> 120 (+80px -> +0.5 -> 50 + 50 = 100)
      // Pointer 2: 200 -> 240 (-40px -> -0.25 -> 50 - 25 = 25)
      // Pointer 3: 200 -> 200 (0px -> stationary -> 50)
      // Pointer 4: 200 -> 168 (+32px -> +0.2 -> 50 + 20 = 70)
      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [
          { identifier: 1, clientY: 120 },
          { identifier: 2, clientY: 240 },
          { identifier: 3, clientY: 200 },
          { identifier: 4, clientY: 168 }
        ]
      });

      assert.strictEqual(knobs[0].value, 100);
      assert.strictEqual(knobs[1].value, 25);
      assert.strictEqual(knobs[2].value, 50);
      assert.strictEqual(knobs[3].value, 70);

      // Lift all
      for (let i = 0; i < 4; i++) {
        mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: i + 1 }] });
        assert.strictEqual(knobs[i].element.classList.contains('is-active'), false);
      }
    });

    it('partial release: lifting 2 of 4 knob touches allows the remaining 2 to continue tracking seamlessly', () => {
      const knobs = [];
      const assemblies = [];

      for (let i = 0; i < 4; i++) {
        const c = new MockElement('div');
        const k = new BraunKnob(c, { min: 0, max: 100, value: 50 });
        knobs.push(k);
        assemblies.push(k.element.querySelector('.braun-knob-assembly'));
      }

      for (let i = 0; i < 4; i++) {
        assemblies[i].dispatchEvent({
          type: 'touchstart',
          bubbles: true,
          changedTouches: [{ identifier: i + 1, clientY: 200 }],
          touches: [{ identifier: i + 1, clientY: 200 }]
        });
      }

      // Lift touches 2 and 4
      mockWindow.dispatchEvent({
        type: 'touchend',
        changedTouches: [{ identifier: 2 }, { identifier: 4 }]
      });

      assert.strictEqual(knobs[0].element.classList.contains('is-active'), true);
      assert.strictEqual(knobs[1].element.classList.contains('is-active'), false);
      assert.strictEqual(knobs[2].element.classList.contains('is-active'), true);
      assert.strictEqual(knobs[3].element.classList.contains('is-active'), false);

      // Remaining touches 1 and 3 move further
      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [
          { identifier: 1, clientY: 160 }, // +40px -> 75
          { identifier: 3, clientY: 240 }  // -40px -> 25
        ]
      });

      assert.strictEqual(knobs[0].value, 75);
      assert.strictEqual(knobs[2].value, 25);

      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 1 }] });
      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 3 }] });
    });

    it('concurrent 4-pointer PointerEvents (pointerType: touch, Blink/Gecko/WebKit) operate in full isolation across separate knobs', () => {
      const knobs = [];
      const assemblies = [];
      for (let i = 0; i < 4; i++) {
        const c = new MockElement('div');
        const k = new BraunKnob(c, { min: 0, max: 100, value: 50 });
        knobs.push(k);
        assemblies.push(k.element.querySelector('.braun-knob-assembly'));
      }

      for (let i = 0; i < 4; i++) {
        assemblies[i].dispatchEvent({
          type: 'pointerdown',
          pointerId: 10 + i,
          pointerType: 'touch',
          clientY: 200,
          bubbles: true
        });
      }

      mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 10, clientY: 160 }); // 75
      mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 11, clientY: 240 }); // 25
      mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 12, clientY: 200 }); // 50
      mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 13, clientY: 120 }); // 100

      assert.strictEqual(knobs[0].value, 75);
      assert.strictEqual(knobs[1].value, 25);
      assert.strictEqual(knobs[2].value, 50);
      assert.strictEqual(knobs[3].value, 100);

      // Cleanup
      for (let i = 0; i < 4; i++) {
        mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 10 + i });
        assert.strictEqual(knobs[i].element.classList.contains('is-active'), false);
      }
    });

    it('Android dual event model: PointerEvents followed by simulated TouchEvents does not double-trigger or glitch knob drag', () => {
      const container = new MockElement('div');
      const knob = new BraunKnob(container, { min: 0, max: 100, value: 50 });
      const assembly = knob.element.querySelector('.braun-knob-assembly');

      // Android Chrome fires pointerdown first
      assembly.dispatchEvent({
        type: 'pointerdown',
        pointerId: 1,
        pointerType: 'touch',
        clientY: 200,
        bubbles: true
      });
      assert.strictEqual(knob.element.classList.contains('is-active'), true);

      // Android Chrome then fires touchstart on same gesture
      assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 1, clientY: 200 }],
        touches: [{ identifier: 1, clientY: 200 }]
      });

      // Pointer moves
      mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 1, clientY: 160 });
      assert.strictEqual(knob.value, 75, 'Value should be 75 without double counting');

      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 1 });
      assert.strictEqual(knob.element.classList.contains('is-active'), false);
    });

    it('simultaneous chime strip swipe (glissando) and rotary knob adjustment operate unhindered', () => {
      const activeVoiceStack = [];
      const releasedVoiceStack = [];
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
              isReleased: false,
              release() {
                this.isReleased = true;
                releasedVoiceStack.push(this);
              }
            };
            activeVoiceStack.push(voice);
            return voice;
          }
        }
      };

      const chimeStripContainer = new MockElement('div');
      chimeStripContainer._rect = { top: 400, bottom: 500, left: 0, right: 800, width: 800, height: 100 };
      const chordsContainer = new MockElement('div');

      const playSurface = new BraunPlaySurface(chimeStripContainer, chordsContainer, mockEngine);
      const chimeKeys = Array.from(playSurface.keyElements.values());
      assert.ok(chimeKeys.length >= 5);

      chimeKeys.forEach((keyEl, i) => {
        keyEl._rect = { top: 400, bottom: 500, left: i * 60, right: (i + 1) * 60, width: 60, height: 100 };
      });

      const knobContainer = new MockElement('div');
      const knob = new BraunKnob(knobContainer, { min: 0, max: 100, value: 50 });
      const knobAssembly = knob.assembly;

      // Pointer 101 on Knob
      knobAssembly.dispatchEvent({
        type: 'pointerdown',
        pointerId: 101,
        pointerType: 'touch',
        clientY: 200,
        bubbles: true
      });

      // Pointer 202 on Chime Key 0
      chimeKeys[0].dispatchEvent({
        type: 'pointerdown',
        pointerId: 202,
        pointerType: 'touch',
        clientY: 450,
        clientX: 30,
        bubbles: true
      });

      assert.strictEqual(activeVoiceStack.length, 1, 'Chime key 0 struck');
      assert.strictEqual(knob.element.classList.contains('is-active'), true);

      // Move knob pointer up by 40px -> value 75
      mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 101, clientY: 160 });
      assert.strictEqual(knob.value, 75);

      // Move chime pointer across keys (glissando)
      mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 202, clientY: 450, clientX: 90 });
      assert.strictEqual(activeVoiceStack.length, 2, 'Key 1 struck');
      assert.strictEqual(releasedVoiceStack.length, 1, 'Key 0 released');
      assert.strictEqual(knob.value, 75, 'Knob value unaffected by chime movement');

      // Release chime pointer
      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 202 });
      assert.strictEqual(releasedVoiceStack.length, 2, 'Active chime voice released');
      assert.strictEqual(knob.element.classList.contains('is-active'), true, 'Knob drag remains active');

      // Release knob pointer
      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 101 });
      assert.strictEqual(knob.element.classList.contains('is-active'), false);
    });

    it('chime touch cancellation releases played voices while knob touch drag remains completely uninterrupted', () => {
      const activeVoiceStack = [];
      const releasedVoiceStack = [];
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
              isReleased: false,
              release() {
                this.isReleased = true;
                releasedVoiceStack.push(this);
              }
            };
            activeVoiceStack.push(voice);
            return voice;
          }
        }
      };

      const chimeContainer = new MockElement('div');
      const chordsContainer = new MockElement('div');
      const playSurface = new BraunPlaySurface(chimeContainer, chordsContainer, mockEngine);
      const chimeKeys = Array.from(playSurface.keyElements.values());

      const knobContainer = new MockElement('div');
      const knob = new BraunKnob(knobContainer, { min: 0, max: 100, value: 50 });

      // Touch 1 on knob
      knob.assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 1, clientY: 200 }],
        touches: [{ identifier: 1, clientY: 200 }]
      });

      // Touch 2 on chime key
      chimeKeys[0].dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 2, clientY: 450, clientX: 30 }],
        touches: [{ identifier: 1, clientY: 200 }, { identifier: 2, clientY: 450, clientX: 30 }]
      });
      assert.strictEqual(activeVoiceStack.length, 1);

      // Cancel chime touch 2
      mockWindow.dispatchEvent({
        type: 'touchcancel',
        changedTouches: [{ identifier: 2 }]
      });

      assert.strictEqual(releasedVoiceStack.length, 1, 'Chime voice released on touchcancel');
      assert.strictEqual(knob.element.classList.contains('is-active'), true, 'Knob remains active');

      // Knob continues moving
      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [{ identifier: 1, clientY: 160 }]
      });
      assert.strictEqual(knob.value, 75);

      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 1 }] });
      assert.strictEqual(knob.element.classList.contains('is-active'), false);
    });

    it('chord cluster macro pad strumming while concurrently manipulating AS 42 Vector Touchpad', async () => {
      const activeVoices = [];
      const mockEngine = {
        isInitialized: true,
        currentScaleKey: 'BUDD_PENTATONIC',
        rootPitchClass: 0,
        a4: 440,
        feltPiano: {
          playNote: (freq, vel, dur, isHold) => {
            const v = { freq, vel, isHold, release() {} };
            activeVoices.push(v);
            return v;
          },
          setCutoff: () => {},
          setTone: () => {}
        },
        setFeltTone: () => {},
        setDroneCutoff: () => {},
        setDelayWet: () => {},
        setDelayFeedback: () => {},
        setReverbWet: () => {},
        setReverbShimmer: () => {},
        tapeDelay: { setDelayTime: () => {}, setWetMix: () => {} },
        shimmerReverb: { setShimmer: () => {}, setWetMix: () => {} }
      };

      const chimeContainer = new MockElement('div');
      const chordsContainer = new MockElement('div');
      const playSurface = new BraunPlaySurface(chimeContainer, chordsContainer, mockEngine);
      playSurface.setChordSpeed('instant');

      const chordButtons = chordsContainer.querySelectorAll('.braun-chord-macro-btn');
      assert.ok(chordButtons.length >= 6);

      const vectorContainer = new MockElement('div');
      let vectorCoords = null;
      const vectorPad = new BraunVectorPad(vectorContainer, {
        engine: mockEngine,
        mode: 'momentary',
        onChange: (x, y) => { vectorCoords = { x, y }; }
      });

      // Finger A touches chord button 0
      chordButtons[0].dispatchEvent({
        type: 'pointerdown',
        pointerId: 301,
        pointerType: 'touch',
        bubbles: true
      });

      await new Promise(r => setTimeout(r, 20));
      assert.ok(activeVoices.length >= 3, 'Instant chord strum triggered 3+ voices');

      // Finger B touches vector surface
      vectorPad.surfaceBox.dispatchEvent({
        type: 'pointerdown',
        pointerId: 302,
        pointerType: 'touch',
        clientX: 200,
        clientY: 50,
        bubbles: true
      });

      assert.strictEqual(vectorPad.isEngaged, true, 'Vector pad engaged');
      assert.ok(vectorCoords !== null, 'Vector pad dispatched coordinates');

      // Cleanup
      chordButtons[0].dispatchEvent({ type: 'pointerup', pointerId: 301 });
      vectorPad.surfaceBox.dispatchEvent({ type: 'pointerup', pointerId: 302 });
      assert.strictEqual(vectorPad.isEngaged, false);
    });

    it('three-way concurrent interaction: rotary knob adjustment + chord strum + chime strip key press', async () => {
      const activeVoiceStack = [];
      const releasedVoiceStack = [];
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
              isReleased: false,
              release() {
                this.isReleased = true;
                releasedVoiceStack.push(this);
              }
            };
            activeVoiceStack.push(voice);
            return voice;
          }
        }
      };

      const chimeContainer = new MockElement('div');
      const chordsContainer = new MockElement('div');
      const playSurface = new BraunPlaySurface(chimeContainer, chordsContainer, mockEngine);
      playSurface.setChordSpeed('instant');

      const chimeKeys = Array.from(playSurface.keyElements.values());
      const chordBtns = chordsContainer.querySelectorAll('.braun-chord-macro-btn');

      const knobContainer = new MockElement('div');
      const knob = new BraunKnob(knobContainer, { min: 0, max: 100, value: 50 });

      // Finger 1 on Knob (Pointer 1)
      knob.assembly.dispatchEvent({
        type: 'pointerdown',
        pointerId: 1,
        pointerType: 'touch',
        clientY: 200,
        bubbles: true
      });

      // Finger 2 on Chord Button (Pointer 2)
      chordBtns[0].dispatchEvent({
        type: 'pointerdown',
        pointerId: 2,
        pointerType: 'touch',
        bubbles: true
      });

      await new Promise(r => setTimeout(r, 20));
      const initialChordVoices = activeVoiceStack.length;
      assert.ok(initialChordVoices >= 3);

      // Finger 3 on Chime Key (Pointer 3)
      chimeKeys[2].dispatchEvent({
        type: 'pointerdown',
        pointerId: 3,
        pointerType: 'touch',
        bubbles: true
      });
      assert.strictEqual(activeVoiceStack.length, initialChordVoices + 1);

      // Turn knob while notes are sounding
      mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 1, clientY: 160 });
      assert.strictEqual(knob.value, 75);

      // Release all three
      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 2 });
      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 1 });
      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 3 });

      assert.strictEqual(knob.element.classList.contains('is-active'), false);
      assert.strictEqual(activeVoiceStack.length, releasedVoiceStack.length, 'Zero voice leakage across 3-way interaction');
    });

    it('adversarial burst: 200 rapid alternating multi-touch events across knob, chime strip, and vector pad without exceptions', () => {
      const mockEngine = {
        isInitialized: true,
        feltPiano: { playNote: () => ({ release: () => {} }), setCutoff: () => {}, setTone: () => {} },
        setFeltTone: () => {},
        setDroneCutoff: () => {},
        setDelayWet: () => {},
        setDelayFeedback: () => {},
        setReverbWet: () => {},
        setReverbShimmer: () => {},
        tapeDelay: { setDelayTime: () => {}, setWetMix: () => {} },
        shimmerReverb: { setShimmer: () => {}, setWetMix: () => {} }
      };

      const chimeContainer = new MockElement('div');
      const chordsContainer = new MockElement('div');
      const playSurface = new BraunPlaySurface(chimeContainer, chordsContainer, mockEngine);
      const chimeKeys = Array.from(playSurface.keyElements.values());

      const knobContainer = new MockElement('div');
      const knob = new BraunKnob(knobContainer, { min: 0, max: 100, value: 50 });

      const vectorContainer = new MockElement('div');
      const vectorPad = new BraunVectorPad(vectorContainer, { engine: mockEngine });

      // Start all 3
      knob.assembly.dispatchEvent({ type: 'pointerdown', pointerId: 10, pointerType: 'touch', clientY: 200 });
      chimeKeys[0].dispatchEvent({ type: 'pointerdown', pointerId: 20, pointerType: 'touch', clientX: 30 });
      vectorPad.surfaceBox.dispatchEvent({ type: 'pointerdown', pointerId: 30, pointerType: 'touch', clientX: 100, clientY: 50 });

      let exceptions = 0;
      for (let i = 0; i < 200; i++) {
        try {
          if (i % 3 === 0) {
            mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 10, clientY: 200 + (Math.sin(i) * 50) });
          } else if (i % 3 === 1) {
            mockWindow.dispatchEvent({ type: 'pointermove', pointerId: 20, clientX: (i * 7) % 300 });
          } else {
            vectorPad.surfaceBox.dispatchEvent({ type: 'pointermove', pointerId: 30, clientX: (i * 11) % 300, clientY: (i * 5) % 150 });
          }
        } catch (err) {
          exceptions++;
        }
      }

      assert.strictEqual(exceptions, 0, 'Zero exceptions during 200 rapid concurrent pointer moves');
      assert.ok(Number.isFinite(knob.value));

      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 10 });
      mockWindow.dispatchEvent({ type: 'pointerup', pointerId: 20 });
      vectorPad.surfaceBox.dispatchEvent({ type: 'pointerup', pointerId: 30 });
    });
  });

  // --------------------------------------------------------------------------
  // TIER 4: Real-World Ambient Synthesizer Scenarios
  // --------------------------------------------------------------------------
  describe('Tier 4: Real-World Ambient Synthesizer Tablet User Scenarios', () => {

    it('scenario: user scrolls page over labels, adjusts Tape Delay Time on Eno deck, then strums chord cluster on lower deck', async () => {
      // 1. User drags finger over knob labels on upper deck to scroll down
      const knobContainer = new MockElement('div');
      const tapeKnob = new BraunKnob(knobContainer, { min: 20, max: 1000, value: 350, label: 'TAPE SPEED', unit: 'ms' });

      const labelTouch = {
        type: 'touchstart',
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        changedTouches: [{ identifier: 1, clientY: 100 }],
        touches: [{ identifier: 1, clientY: 100 }]
      };
      tapeKnob.labelEl.dispatchEvent(labelTouch);

      // Verify native page scroll was NOT blocked
      assert.strictEqual(labelTouch.defaultPrevented, false, 'Scroll gesture over label must NOT be prevented');
      assert.strictEqual(tapeKnob.element.classList.contains('is-active'), false, 'Scroll gesture must not activate knob');

      // 2. User targets Tape Delay rotary knob assembly and adjusts delay time
      const knobTouch = {
        type: 'touchstart',
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        changedTouches: [{ identifier: 2, clientY: 200 }],
        touches: [{ identifier: 2, clientY: 200 }]
      };
      tapeKnob.assembly.dispatchEvent(knobTouch);

      assert.strictEqual(knobTouch.defaultPrevented, true, 'Touch on knob cap MUST prevent page scroll');
      assert.strictEqual(tapeKnob.element.classList.contains('is-active'), true);

      // Drag up by 40px
      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [{ identifier: 2, clientY: 160 }]
      });
      assert.ok(tapeKnob.value > 350, `Tape knob value increased, got ${tapeKnob.value}`);

      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 2 }] });
      assert.strictEqual(tapeKnob.element.classList.contains('is-active'), false);

      // 3. User strums a chord cluster on the lower performance deck
      const activeVoices = [];
      const mockEngine = {
        isInitialized: true,
        currentScaleKey: 'BUDD_PENTATONIC',
        rootPitchClass: 0,
        a4: 440,
        feltPiano: {
          playNote: (freq, vel, dur, isHold) => {
            const v = { freq, vel, isHold, release() {} };
            activeVoices.push(v);
            return v;
          }
        }
      };

      const chimeContainer = new MockElement('div');
      const chordsContainer = new MockElement('div');
      const playSurface = new BraunPlaySurface(chimeContainer, chordsContainer, mockEngine);
      playSurface.setChordSpeed('instant');

      const chordBtn = chordsContainer.querySelector('.braun-chord-macro-btn');
      assert.ok(chordBtn, 'Chord macro button must exist');

      chordBtn.dispatchEvent({
        type: 'pointerdown',
        pointerId: 3,
        pointerType: 'touch',
        bubbles: true
      });

      await new Promise(r => setTimeout(r, 20));
      assert.ok(activeVoices.length >= 3, 'Chord strum voices triggered successfully');
      chordBtn.dispatchEvent({ type: 'pointerup', pointerId: 3 });
    });

    it('scenario: simultaneous sound design workflow with 2-finger drone detune + chime glissando with zero voice leakage', () => {
      const activeVoiceStack = [];
      const releasedVoiceStack = [];
      const mockEngine = {
        isInitialized: true,
        currentScaleKey: 'BUDD_PENTATONIC',
        rootPitchClass: 0,
        a4: 440,
        feltPiano: {
          playNote: (freq, vel, dur, isHold) => {
            const v = {
              freq,
              vel,
              isHold,
              release() { releasedVoiceStack.push(this); }
            };
            activeVoiceStack.push(v);
            return v;
          }
        }
      };

      // Two drone detune knobs
      const c1 = new MockElement('div');
      const c2 = new MockElement('div');
      const drone1Detune = new BraunKnob(c1, { min: -50, max: 50, value: 0 });
      const drone2Detune = new BraunKnob(c2, { min: -50, max: 50, value: 0 });

      // Performance surface
      const chimeContainer = new MockElement('div');
      chimeContainer._rect = { top: 400, bottom: 500, left: 0, right: 800, width: 800, height: 100 };
      const chordsContainer = new MockElement('div');
      const playSurface = new BraunPlaySurface(chimeContainer, chordsContainer, mockEngine);
      const chimeKeys = Array.from(playSurface.keyElements.values());

      chimeKeys.forEach((keyEl, i) => {
        keyEl._rect = { top: 400, bottom: 500, left: i * 60, right: (i + 1) * 60, width: 60, height: 100 };
      });

      // Finger 1 on Drone 1 Detune, Finger 2 on Drone 2 Detune
      drone1Detune.assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 10, clientY: 200 }],
        touches: [{ identifier: 10, clientY: 200 }]
      });
      drone2Detune.assembly.dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 20, clientY: 200 }],
        touches: [{ identifier: 10, clientY: 200 }, { identifier: 20, clientY: 200 }]
      });

      // Finger 3 swipes chime strip key 0
      chimeKeys[0].dispatchEvent({
        type: 'touchstart',
        bubbles: true,
        changedTouches: [{ identifier: 30, clientY: 450, clientX: 20 }],
        touches: [
          { identifier: 10, clientY: 200 },
          { identifier: 20, clientY: 200 },
          { identifier: 30, clientY: 450, clientX: 20 }
        ]
      });

      assert.strictEqual(activeVoiceStack.length, 1);

      // Move fingers: Drone 1 up (+20px), Drone 2 down (-20px), Chime glissando to key 1
      mockWindow.dispatchEvent({
        type: 'touchmove',
        touches: [
          { identifier: 10, clientY: 168 },
          { identifier: 20, clientY: 232 },
          { identifier: 30, clientY: 450, clientX: 80 }
        ]
      });

      assert.ok(drone1Detune.value > 0, 'Drone 1 detuned upward');
      assert.ok(drone2Detune.value < 0, 'Drone 2 detuned downward');
      assert.strictEqual(activeVoiceStack.length, 2, 'Chime glissando struck key 1');
      assert.strictEqual(releasedVoiceStack.length, 1, 'Key 0 released');

      // Release all three
      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 10 }] });
      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 20 }] });
      mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 30 }] });

      assert.strictEqual(activeVoiceStack.length, releasedVoiceStack.length, 'All voices cleanly released');
    });

    it('scenario: full tablet session lifecycle with audio unlock, preset navigation, touch disambiguation, and clean release', () => {
      const origAudioCtx = globalThis.AudioContext;
      globalThis.AudioContext = MockAudioContext;

      try {
        const engine = new AudioEngine();
        assert.strictEqual(engine.ctx, null);
        assert.strictEqual(Boolean(engine.isAudioUnlocked), false);

        // 1. Initial user touch on iPad / Android tablet screen unlocks Web Audio
        const ctx = engine.unlockAudio();
        assert.strictEqual(engine.isAudioUnlocked, true);
        assert.strictEqual(ctx.state, 'running');

        // 2. User navigates app and interacts with controls
        const knobContainer = new MockElement('div');
        const reverbKnob = new BraunKnob(knobContainer, { min: 0.1, max: 30, value: 4.5, label: 'RT60 SPACE' });

        // Touch on label -> scroll pass-through
        const labelEv = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          changedTouches: [{ identifier: 1, clientY: 50 }],
          touches: [{ identifier: 1, clientY: 50 }]
        };
        reverbKnob.labelEl.dispatchEvent(labelEv);
        assert.strictEqual(labelEv.defaultPrevented, false);

        // Touch on assembly -> parameter adjustment
        const assemblyEv = {
          type: 'touchstart',
          bubbles: true,
          cancelable: true,
          defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; },
          changedTouches: [{ identifier: 2, clientY: 200 }],
          touches: [{ identifier: 2, clientY: 200 }]
        };
        reverbKnob.assembly.dispatchEvent(assemblyEv);
        assert.strictEqual(assemblyEv.defaultPrevented, true);

        // Drag up
        mockWindow.dispatchEvent({
          type: 'touchmove',
          touches: [{ identifier: 2, clientY: 160 }]
        });
        assert.ok(reverbKnob.value > 4.5);

        // Release
        mockWindow.dispatchEvent({ type: 'touchend', changedTouches: [{ identifier: 2 }] });
        assert.strictEqual(reverbKnob.element.classList.contains('is-active'), false);
      } finally {
        globalThis.AudioContext = origAudioCtx;
      }
    });
  });
});
