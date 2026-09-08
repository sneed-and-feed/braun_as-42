import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const userDataDir = path.join(os.tmpdir(), `edge_test_${Date.now()}`);

const proc = spawn(edgePath, [
  '--headless',
  '--remote-debugging-port=9222',
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  'http://localhost:3000'
], { stdio: 'pipe' });

let resolved = false;

async function run() {
  await new Promise(r => setTimeout(r, 2000));
  const listRes = await fetch('http://127.0.0.1:9222/json/list');
  const tabs = await listRes.json();
  const targetTab = tabs.find(t => t.url.includes('localhost:3000')) || tabs[0];

  const ws = new WebSocket(targetTab.webSocketDebuggerUrl);
  let id = 10;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      console.error('PAGE EXCEPTION:', JSON.stringify(msg.params.exceptionDetails, null, 2));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  function evaluate(expr) {
    return call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      .then(res => {
        if (res.exceptionDetails) {
          throw new Error('Eval exception: ' + JSON.stringify(res.exceptionDetails));
        }
        return res.result.value;
      });
  }

  ws.onopen = async () => {
    try {
      await call('Runtime.enable');
      await call('Log.enable');

      // 1. Initial State Checks
      const initCheck = await evaluate(`({
        rootOptions: document.getElementById('select-root')?.children.length,
        scaleOptions: document.getElementById('select-scale')?.children.length,
        knobsCount: document.querySelectorAll('.braun-knob-wrapper').length,
        chimeKeys: document.querySelectorAll('.braun-chime-key').length,
        chordButtons: document.querySelectorAll('.braun-chord-macro-btn').length,
        tapeLoops: document.querySelectorAll('.braun-loop-row').length,
        bodyTheme: document.body.getAttribute('data-theme'),
        isPowerOn: window.app?.isPowerOn,
        hasApp: !!window.app
      })`);
      console.log('1. Initial DOM check:', initCheck);

      // 2. Test Palette / Theme Switch
      const themeSwitchResult = await evaluate(`(() => {
        const themeSelect = document.getElementById('select-theme');
        themeSelect.value = 'dark';
        themeSelect.dispatchEvent(new Event('change'));
        const darkAttr = document.body.getAttribute('data-theme');
        themeSelect.value = 'light';
        themeSelect.dispatchEvent(new Event('change'));
        const lightAttr = document.body.getAttribute('data-theme');
        return { darkAttr, lightAttr };
      })()`);
      console.log('2. Theme switch check:', themeSwitchResult);

      // 3. Test Power ON
      const powerOnClickResult = await evaluate(`(async () => {
        const powerBtn = document.getElementById('btn-power');
        powerBtn.click();
        await new Promise(r => setTimeout(r, 150));
        return {
          isPowerOn: window.app.isPowerOn,
          btnText: powerBtn.querySelector('.braun-status-text')?.textContent,
          audioCtxState: window.app.engine.ctx?.state,
          hasLimiter: !!window.app.engine.masterLimiter,
          hasAnalyser: !!window.app.engine.analyser,
          scopeAnalyserSet: !!window.app.scope?.analyser
        };
      })()`);
      console.log('3. Power ON check:', powerOnClickResult);

      // 4. Test Key & Chord Playing with Audio running
      const soundTriggerResult = await evaluate(`(async () => {
        const firstKey = document.querySelector('.braun-chime-key');
        firstKey.click();
        const firstChord = document.querySelector('.braun-chord-macro-btn');
        firstChord.click();
        await new Promise(r => setTimeout(r, 100));
        return {
          firstKeyMidi: firstKey.getAttribute('data-midi'),
          firstKeyFreq: firstKey.getAttribute('data-freq')
        };
      })()`);
      console.log('4. Sound trigger check:', soundTriggerResult);

      // 5. Test Reverb Decay Adjustment (Impulse regeneration)
      const reverbCheck = await evaluate(`(async () => {
        window.app.engine.setReverbDecay(4.0);
        await new Promise(r => setTimeout(r, 150));
        return {
          convolverBufferLength: window.app.engine.shimmerReverb.convolver.buffer.length
        };
      })()`);
      console.log('5. Reverb impulse check:', reverbCheck);

      // 6. Test Generative Engines (Poisson & Phase Loops)
      const generativeCheck = await evaluate(`(async () => {
        const autoEvolveBtn = document.getElementById('toggle-auto-evolve');
        const loopsBtn = document.getElementById('toggle-phase-loops');
        autoEvolveBtn.click();
        loopsBtn.click();
        await new Promise(r => setTimeout(r, 100));
        const evolveActive = autoEvolveBtn.classList.contains('is-active');
        const loopsActive = loopsBtn.classList.contains('is-active');
        const poissonRunning = window.app.engine.poisson.isRunning;
        const loopsRunning = window.app.engine.phaseLoops.isRunning;
        return { evolveActive, loopsActive, poissonRunning, loopsRunning };
      })()`);
      console.log('6. Generative engines check:', generativeCheck);

      // 7. Test Power OFF
      const powerOffCheck = await evaluate(`(async () => {
        const powerBtn = document.getElementById('btn-power');
        powerBtn.click();
        await new Promise(r => setTimeout(r, 100));
        return {
          isPowerOn: window.app.isPowerOn,
          btnText: powerBtn.querySelector('.braun-status-text')?.textContent,
          audioCtxState: window.app.engine.ctx?.state,
          poissonRunning: window.app.engine.poisson.isRunning,
          loopsRunning: window.app.engine.phaseLoops.isRunning,
          scopeAnalyserIsCleared: window.app.scope?.analyser === null
        };
      })()`);
      console.log('7. Power OFF check:', powerOffCheck);

      resolved = true;
    } catch (e) {
      console.error('Test step failed:', e);
    } finally {
      cleanup();
    }
  };

  ws.onerror = (err) => {
    console.error('WS error:', err);
    cleanup();
  };
}

function cleanup() {
  try {
    proc.kill();
  } catch (e) {}
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (e) {}
  process.exit(resolved ? 0 : 1);
}

run().catch(err => {
  console.error('Fatal test error:', err);
  cleanup();
});
