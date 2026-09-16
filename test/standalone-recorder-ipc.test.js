/**
 * @file standalone-recorder-ipc.test.js
 * @brief Comprehensive tests for standalone JUCE WAV recorder IPC bridge and browser recording fallback.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

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
      _queries: null,
      _listeners: null,
      querySelector(selector) {
        if (selector === '.braun-record-text') {
          if (!this._recordText) {
            this._recordText = createElement('span');
            this._recordText.textContent = 'RECORD WAV';
          }
          return this._recordText;
        }
        if (selector === '.braun-status-text') {
          if (!this._statusText) {
            this._statusText = createElement('span');
            this._statusText.textContent = 'SYSTEM STANDBY';
          }
          return this._statusText;
        }
        if (selector === '.braun-vector-canvas') {
          return {
            getContext: () => ({
              fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {},
              lineTo() {}, stroke() {}, arc() {}, fill() {}, fillText() {}
            })
          };
        }
        if (!this._queries) this._queries = {};
        if (!this._queries[selector]) this._queries[selector] = createElement('div');
        return this._queries[selector];
      },
      querySelectorAll: () => [],
      addEventListener(evt, fn) {
        if (!this._listeners) this._listeners = {};
        if (!this._listeners[evt]) this._listeners[evt] = [];
        this._listeners[evt].push(fn);
      },
      removeEventListener(evt, fn) {
        if (this._listeners && this._listeners[evt]) {
          this._listeners[evt] = this._listeners[evt].filter(f => f !== fn);
        }
      },
      async click() {
        if (this._listeners && this._listeners.click) {
          const e = { stopPropagation() {}, preventDefault() {}, target: this };
          for (const fn of this._listeners.click) {
            await fn(e);
          }
        }
      },
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

  if (!globalThis.URL) {
    globalThis.URL = {
      createObjectURL: () => 'blob:mock-url',
      revokeObjectURL: () => {}
    };
  }

  return elements;
}

describe('Standalone JUCE WAV Recorder IPC and Browser Fallback', () => {
  it('verifies browser mode (isJuce=false) delegates recording to Web Audio engine', async () => {
    const elements = setupMockDOM();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = false;
    app.isPowerOn = true;

    let engineStartCalled = 0;
    let engineStopCalled = 0;
    app.engine.startRecording = () => {
      engineStartCalled++;
      app.engine.isRecording = true;
    };
    app.engine.stopRecording = () => {
      engineStopCalled++;
      app.engine.isRecording = false;
      return null;
    };

    const recordBtn = elements['btn-record'];
    const textEl = recordBtn.querySelector('.braun-record-text');

    // 1. Click to start recording
    await recordBtn.click();
    assert.strictEqual(engineStartCalled, 1, 'Engine startRecording must be called in browser mode');
    assert.ok(recordBtn.classList.contains('is-recording'), 'Record button must have is-recording class');
    assert.strictEqual(textEl.textContent, 'RECORDING...');

    // 2. Click to stop recording
    await recordBtn.click();
    assert.strictEqual(engineStopCalled, 1, 'Engine stopRecording must be called in browser mode');
    assert.ok(!recordBtn.classList.contains('is-recording'), 'is-recording class must be removed');
    assert.strictEqual(textEl.textContent, 'RECORD WAV');
  });

  it('verifies standalone JUCE mode (isJuce=true) dispatches startRecording and stopRecording IPC without touching Web Audio engine', async () => {
    const elements = setupMockDOM();

    const emittedEvents = [];
    globalThis.window.__JUCE__ = {
      backend: {
        emitEvent: (name, payload) => {
          emittedEvents.push({ name, payload });
        },
        addEventListener: () => {}
      }
    };

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = true;
    app.isPowerOn = true;

    let engineStartCalled = 0;
    let engineStopCalled = 0;
    app.engine.startRecording = () => { engineStartCalled++; };
    app.engine.stopRecording = () => { engineStopCalled++; return null; };

    const recordBtn = elements['btn-record'];
    const textEl = recordBtn.querySelector('.braun-record-text');

    assert.strictEqual(app._isJuceRecording, false, '_isJuceRecording must initially be false');

    // 1. Click to start standalone recording
    await recordBtn.click();

    assert.strictEqual(app._isJuceRecording, true, '_isJuceRecording must become true');
    assert.ok(recordBtn.classList.contains('is-recording'), 'Record button must gain is-recording class');
    assert.strictEqual(textEl.textContent, 'RECORDING...');
    assert.strictEqual(engineStartCalled, 0, 'Web Audio engine startRecording must NOT be called in JUCE mode');

    const startEvents = emittedEvents.filter(e => e.name === 'startRecording');
    assert.strictEqual(startEvents.length, 1, 'Must dispatch startRecording event to JUCE backend');

    // 2. Click to stop standalone recording
    await recordBtn.click();

    assert.strictEqual(app._isJuceRecording, false, '_isJuceRecording must become false');
    assert.ok(!recordBtn.classList.contains('is-recording'), 'is-recording class must be removed');
    assert.strictEqual(textEl.textContent, 'RECORD WAV');
    assert.strictEqual(engineStopCalled, 0, 'Web Audio engine stopRecording must NOT be called in JUCE mode');

    const stopEvents = emittedEvents.filter(e => e.name === 'stopRecording');
    assert.strictEqual(stopEvents.length, 1, 'Must dispatch stopRecording event to JUCE backend');
  });

  it('verifies unpowered click auto-wakes synthesizer power before recording', async () => {
    const elements = setupMockDOM();

    const emittedEvents = [];
    globalThis.window.__JUCE__ = {
      backend: {
        emitEvent: (name, payload) => {
          emittedEvents.push({ name, payload });
        },
        addEventListener: () => {}
      }
    };

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = true;
    app.isPowerOn = false;

    const recordBtn = elements['btn-record'];
    await recordBtn.click();

    assert.strictEqual(app.isPowerOn, true, 'Synthesizer power must be turned on');
    assert.strictEqual(app._isJuceRecording, true, 'Recording must be engaged');
    assert.ok(recordBtn.classList.contains('is-recording'));
  });

  it('verifies power-down cleanly terminates active standalone recording via stopRecording IPC', async () => {
    const elements = setupMockDOM();

    const emittedEvents = [];
    globalThis.window.__JUCE__ = {
      backend: {
        emitEvent: (name, payload) => {
          emittedEvents.push({ name, payload });
        },
        addEventListener: () => {}
      }
    };

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = true;
    app.isPowerOn = true;

    const recordBtn = elements['btn-record'];
    const textEl = recordBtn.querySelector('.braun-record-text');

    // Start recording
    await recordBtn.click();
    assert.strictEqual(app._isJuceRecording, true);
    assert.ok(recordBtn.classList.contains('is-recording'));

    // Trigger system power-down
    await app.togglePower({ emitToNative: true });

    assert.strictEqual(app.isPowerOn, false, 'Synthesizer power must be off');
    assert.strictEqual(app._isJuceRecording, false, 'Standalone recording must be terminated on power-down');
    assert.ok(!recordBtn.classList.contains('is-recording'), 'is-recording class must be removed on power-down');
    assert.strictEqual(textEl.textContent, 'RECORD WAV');

    const stopEvents = emittedEvents.filter(e => e.name === 'stopRecording');
    assert.strictEqual(stopEvents.length, 1, 'Must dispatch stopRecording IPC upon power-down');
  });

  it('verifies recordingSaved event from JUCE C++ backend resets UI state and logs path safely', async () => {
    const elements = setupMockDOM();

    const listeners = new Map();
    globalThis.window.__JUCE__ = {
      backend: {
        emitEvent: () => {},
        addEventListener: (name, cb) => {
          listeners.set(name, cb);
        }
      }
    };

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = true;
    app._initJuceBridge();

    const recordingSavedHandler = listeners.get('recordingSaved');
    assert.ok(typeof recordingSavedHandler === 'function', 'recordingSaved listener must be registered in _initJuceBridge');

    const recordBtn = elements['btn-record'];
    const textEl = recordBtn.querySelector('.braun-record-text');

    // Simulate active recording state
    app._isJuceRecording = true;
    recordBtn.classList.add('is-recording');
    textEl.textContent = 'RECORDING...';

    // JUCE backend emits recordingSaved
    recordingSavedHandler({ path: 'C:\\Users\\test\\Music\\Braun AS-42 Recordings\\braun-ambient-2026-09-16.wav' });

    assert.strictEqual(app._isJuceRecording, false, '_isJuceRecording must be reset to false');
    assert.ok(!recordBtn.classList.contains('is-recording'), 'is-recording class must be removed');
    assert.strictEqual(textEl.textContent, 'RECORD WAV');

    // Edge case: null or empty payload
    assert.doesNotThrow(() => recordingSavedHandler(null), 'Should handle null payload gracefully');
    assert.doesNotThrow(() => recordingSavedHandler({}), 'Should handle empty payload gracefully');
  });

  it('handles rapid toggling and missing backend gracefully without uncaught exceptions', async () => {
    const elements = setupMockDOM();
    globalThis.window.__JUCE__ = null; // No JUCE backend available

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = true;
    app.isPowerOn = true;

    const recordBtn = elements['btn-record'];

    // Rapidly toggle 10 times without window.__JUCE__ throwing
    for (let i = 0; i < 10; i++) {
      await recordBtn.click();
    }
    assert.strictEqual(app._isJuceRecording, false, 'Even number of clicks must end in unrecorded state');
  });

  it('swallows promise rejection from startAudio during record button click gracefully', async () => {
    const elements = setupMockDOM();
    globalThis.window.__JUCE__ = {
      backend: {
        emitEvent: () => {},
        addEventListener: () => {}
      }
    };

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = true;
    app.isPowerOn = false;

    // Simulate startAudio throwing / rejecting (e.g. audio device initialization failure)
    app.startAudio = async () => {
      throw new Error('Simulated Web Audio device acquisition failure');
    };

    const recordBtn = elements['btn-record'];
    // Must not throw an unhandled promise rejection
    await assert.doesNotReject(async () => {
      await recordBtn.click();
    });
    assert.strictEqual(app._isJuceRecording, true, 'Recording is still toggled safely');
  });

  it('verifies paramUpdate with isRecording/recording synchronizes UI and internal state', async () => {
    const elements = setupMockDOM();
    const listeners = new Map();
    globalThis.window.__JUCE__ = {
      backend: {
        emitEvent: () => {},
        addEventListener: (name, cb) => {
          listeners.set(name, cb);
        }
      }
    };

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = true;
    app._initJuceBridge();

    const paramUpdateHandler = listeners.get('paramUpdate');
    assert.ok(typeof paramUpdateHandler === 'function', 'paramUpdate handler must be registered');

    const recordBtn = elements['btn-record'];
    const textEl = recordBtn.querySelector('.braun-record-text');

    // 1. Sync isRecording: 1.0
    paramUpdateHandler({ id: 'isRecording', value: 1.0 });
    assert.strictEqual(app._isJuceRecording, true);
    assert.ok(recordBtn.classList.contains('is-recording'));
    assert.strictEqual(textEl.textContent, 'RECORDING...');

    // 2. Sync isRecording: 0.0
    paramUpdateHandler({ id: 'isRecording', value: 0.0 });
    assert.strictEqual(app._isJuceRecording, false);
    assert.ok(!recordBtn.classList.contains('is-recording'));
    assert.strictEqual(textEl.textContent, 'RECORD WAV');

    // 3. Alias 'recording' ID
    paramUpdateHandler({ id: 'recording', value: 1.0 });
    assert.strictEqual(app._isJuceRecording, true);
    assert.ok(recordBtn.classList.contains('is-recording'));
    assert.strictEqual(textEl.textContent, 'RECORDING...');

    paramUpdateHandler({ id: 'recording', value: 0.0 });
    assert.strictEqual(app._isJuceRecording, false);
    assert.ok(!recordBtn.classList.contains('is-recording'));
    assert.strictEqual(textEl.textContent, 'RECORD WAV');
  });

  it('verifies path with spaces, Unicode, and Windows backslashes in recordingSaved does not throw', async () => {
    const elements = setupMockDOM();
    const listeners = new Map();
    globalThis.window.__JUCE__ = {
      backend: {
        emitEvent: () => {},
        addEventListener: (name, cb) => {
          listeners.set(name, cb);
        }
      }
    };

    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();
    app.isJuce = true;
    app._initJuceBridge();

    const recordingSavedHandler = listeners.get('recordingSaved');
    const recordBtn = elements['btn-record'];
    const textEl = recordBtn.querySelector('.braun-record-text');

    app._isJuceRecording = true;
    recordBtn.classList.add('is-recording');
    textEl.textContent = 'RECORDING...';

    const testPath = 'C:\\Users\\Artist Name (Studio)\\Music\\Braun AS-42 Recordings\\braun-ambient-2026-09-16-08-30-00 (日本語).wav';
    assert.doesNotThrow(() => {
      recordingSavedHandler({ path: testPath });
    });

    assert.strictEqual(app._isJuceRecording, false);
    assert.ok(!recordBtn.classList.contains('is-recording'));
    assert.strictEqual(textEl.textContent, 'RECORD WAV');
  });
});
