/**
 * @file webview-lifecycle-and-occlusion.test.js
 * @brief Comprehensive tests for WebView2 memory bloat remediation, canvas pausing
 * on occlusion and standby, window blur/focus lifecycle, and native UI switching.
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { setupMockBrowser } from './ui-initialization.test.js';

describe('WebView2 Memory Remediation & Canvas Lifecycle', () => {
  it('verifies crt-display.js exports BraunOscilloscope and BraunCrtDisplay', async () => {
    const { BraunOscilloscope, BraunCrtDisplay } = await import('../js/ui/crt-display.js');
    assert.ok(BraunOscilloscope, 'BraunOscilloscope must be exported');
    assert.ok(BraunCrtDisplay, 'BraunCrtDisplay alias must be exported');
    assert.strictEqual(BraunOscilloscope, BraunCrtDisplay, 'BraunCrtDisplay must be reference-identical to BraunOscilloscope');
  });

  it('verifies app.display alias points to app.scope and controls visualizer', async () => {
    const env = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    assert.ok(app.scope, 'app.scope must be instantiated');
    assert.strictEqual(app.display, app.scope, 'app.display getter must return app.scope');

    // Test setter
    const mockDisplay = { stop() {}, start() {} };
    app.display = mockDisplay;
    assert.strictEqual(app.scope, mockDisplay, 'Setting app.display must set app.scope');
    app.display = app.scope; // restore
  });

  it('verifies visualizer halts in standby mode and resumes when power is turned on', async () => {
    const env = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    // On boot, power is off -> display should NOT be running
    assert.strictEqual(app.isPowerOn, false);
    assert.strictEqual(app.display.isRunning, false, 'Display must be stopped in initial standby');

    // Power ON
    await app.startAudio();
    assert.strictEqual(app.isPowerOn, true);
    assert.strictEqual(app.display.isRunning, true, 'Display must start running when powered on');

    // Toggle power OFF (Standby)
    await app.togglePower();
    assert.strictEqual(app.isPowerOn, false);
    assert.strictEqual(app.display.isRunning, false, 'Display must stop running when powered down to standby');

    // Power ON again
    await app.togglePower();
    assert.strictEqual(app.isPowerOn, true);
    assert.strictEqual(app.display.isRunning, true, 'Display must resume running on power-on');
  });

  it('verifies display stops on document occlusion (visibilityState === hidden) and resumes on visible', async () => {
    const env = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    await app.startAudio();
    assert.strictEqual(app.display.isRunning, true);

    // Simulate tab switch or window minimize: document hidden
    env.mockDocument.visibilityState = 'hidden';
    env.mockDocument.hidden = true;
    const docVisHandlers = env.documentListeners.get('visibilitychange') || [];
    for (const h of docVisHandlers) {
      await h();
    }

    assert.strictEqual(app.display.isRunning, false, 'Display must be stopped when document is hidden/occluded');

    // Simulate returning to tab: document visible
    env.mockDocument.visibilityState = 'visible';
    env.mockDocument.hidden = false;
    for (const h of docVisHandlers) {
      await h();
    }

    assert.strictEqual(app.display.isRunning, true, 'Display must resume running when document becomes visible');
  });

  it('verifies display stops on window blur and resumes on window focus when powered on', async () => {
    const env = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    await app.startAudio();
    assert.strictEqual(app.display.isRunning, true);

    // Simulate window blur
    const blurHandlers = env.windowListeners.get('blur') || [];
    for (const h of blurHandlers) {
      h();
    }
    assert.strictEqual(app.display.isRunning, false, 'Display must be stopped when window blurs');

    // Simulate window focus
    const focusHandlers = env.windowListeners.get('focus') || [];
    for (const h of focusHandlers) {
      h();
    }
    assert.strictEqual(app.display.isRunning, true, 'Display must resume when window regains focus');
  });

  it('verifies switching to native UI mode halts display rendering immediately', async () => {
    const env = setupMockBrowser();
    const { AmbientApp } = await import('../js/app.js');
    const app = new AmbientApp();

    await app.startAudio();
    assert.strictEqual(app.display.isRunning, true);

    // Click UI Mode button to switch to native UI
    const uiBtn = env.elementsById.get('btn-ui-mode');
    assert.ok(uiBtn, 'btn-ui-mode must exist');
    uiBtn.click();

    assert.strictEqual(app.display.isRunning, false, 'Display must stop running when switching to native UI mode');
  });

  it('verifies nativeModeChange JUCE IPC event pauses and resumes visualizer', async () => {
    const env = setupMockBrowser();
    const listeners = new Map();
    globalThis.window.__JUCE__ = {
      backend: {
        _listeners: listeners,
        addEventListener(event, cb) {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event).push(cb);
        },
        emitEvent(event, data) {
          const list = listeners.get(event) || [];
          list.forEach(fn => fn(data));
        }
      }
    };

    try {
      const { AmbientApp } = await import('../js/app.js');
      const app = new AmbientApp();

      await app.startAudio();
      assert.strictEqual(app.display.isRunning, true);

      // Simulate C++ host notifying webview that Native mode is now active
      globalThis.window.__JUCE__.backend.emitEvent('nativeModeChange', { nativeMode: true });
      assert.strictEqual(app.display.isRunning, false, 'Display must pause when nativeMode: true');

      // Simulate switching back from native mode to web mode
      globalThis.window.__JUCE__.backend.emitEvent('nativeModeChange', { nativeMode: false });
      assert.strictEqual(app.display.isRunning, true, 'Display must resume when nativeMode: false');
    } finally {
      delete globalThis.window.__JUCE__;
    }
  });
});
