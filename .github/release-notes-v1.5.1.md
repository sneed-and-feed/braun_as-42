# BRAUN AS 42 · Release v1.5.1

## Release Title
**BRAUN AS-42 v1.5.1: Minimize/Reopen Parameter Persistence, Click-Free 45ms Hermite Power-Off With Active Drones & Race-Free Host Tail Guard**

---

## Musician & Developer Release Notes

**BRAUN AS-42 v1.5.1** resolves two user-reported desktop/DAW bugs in the Standalone (`BRAUN_AS42.exe` / `.app`) and VST3/AU editions while hardening cross-thread state serialization and WebView2 / Native UI synchronization:
1. **Minimize / Reopen & Editor Reopen State Preservation:** Eliminates the bug where minimizing and reopening the Standalone or VST3 window caused JUCE's `WebBrowserComponent` to unload the hidden page (`about:blank`), reload `index.html` on restore, and overwrite C++ APVTS parameters with `PRESETS.DEFAULT`—while also persisting all 16 non-APVTS extended UI settings across editor reopen and DAW session recall.
2. **Click-Free Power-Off With Active Drones:** Eliminates the bug where pressing Power Off while Drone 1, Drone 2, or Sub-Bass was running clicked/popped (`dspEngine.reset()` mid-waveform) and immediately re-enabled power on the next audio block (`drone1Active` / `drone2Active` steady-state wake check), replacing it with rising-edge-only wake logic, a 45 ms $C^1$-smooth Hermite power-off ramp, and a 50 ms VST3/AU tail guard.

---

### 🌟 Key Highlights & Engineering Changes

#### 1. 🪟 Minimize / Reopen & Editor Reopen State Preservation
* **Persistent Hidden WebView2 (`PluginEditor.h`, `PluginEditor.cpp`)**:
  * JUCE 8's `WebBrowserComponent` defaults to `unloadPageWhenHidden = true`, which navigates WebView2 to `about:blank` whenever `!isShowing()` (e.g. minimizing the window to the taskbar or hiding a DAW plugin window) and calls `goBack()` on restore—re-executing `index.html` and cold-DOM initialization.
  * Enabled `.withKeepPageLoadedWhenBrowserIsHidden()` and `--disable-http-cache` in `BRAUN_AS42AudioProcessorEditor::createWebOptions()`, tracked `wasWebShowing` across `timerCallback()`, and automatically triggered `syncAllParametersToWeb()` upon window visibility restoration (`justRestored = !wasWebShowing`).
* **Echo-Free Cold-DOM Calibration & Binary-First Asset Resolution (`js/app.js`, `WebResourceManager.cpp`)**:
  * Passed `{ emitToNative: false }` to cold-DOM `applyPreset('DEFAULT', { animate: false, emitToNative: false })` and routed JUCE BFCache `pageshow` (`event.persisted`) to `requestSync`, ensuring WebView2 initialization or page reload can never overwrite C++ APVTS parameters with `PRESETS.DEFAULT`.
  * Updated `WebResourceManager::getResource()` to serve embedded `BinaryData::web_assets_zip` as the primary authoritative source before local disk fallback.
* **Complete 16-Property `UIExtendedState` Serialization & `masterDrive` DSP Wiring (`PluginProcessor.h/.cpp`, `DspEngine.h/.cpp`, `js/ui/*`)**:
  * Persisted all 16 non-APVTS Web UI settings (`uiTheme`, `rootPitchClass`, `scaleKey`, `tuningA4`, `masterDrive`, `poissonDensity`, `poissonHumanize`, `chordSpeed`, `scopeMode`, `drone1Snap`, `drone2Snap`, `vectorMode`, `vectorX`, `vectorY`, `isCustomPatch`, `customPatchJson`) across editor close/reopen and VST3/AU/Standalone state chunks, with clean default reset when loading legacy presets.
  * Wired `masterDrive` (`TAPE DRIVE`) into C++ `MasterLimiterDsp.tapeWarmth`, synchronized Native UI `BraunLookAndFeel` dark/light theme on preset recall, and updated internal JS engine caches via `knob._localOnChange` during host `paramUpdate` syncs.

#### 2. 🔇 Click-Free Power-Off With Active Drones & Race-Free Host Tail Guard
* **Rising-Edge-Only Auto-Wake (`PluginProcessor.cpp`)**:
  * Removed steady-state `drone1Active` / `drone2Active` checks from `PluginProcessor::processBlock()` power gating while retaining rising-edge auto-wake in `setDrone1Active(true)`, `setDrone2Active(true)`, and genuine `Note-On` (`velocity > 0`). Pressing Power Off while drones are running now reliably powers down into silent Standby while keeping the user's drone switches armed for when power is turned back on.
* **Sample-Accurate 45 ms $C^1$ Hermite Power Envelope (`PluginProcessor.h/.cpp`)**:
  * Added a 45 ms $C^1$-continuous Hermite power-off fade $(g(p) = p^2(3 - 2p))$ and 15 ms Hermite power-on fade in `processBlock()`, deferring `dspEngine.reset()` and scope buffer clearing until `powerLinear <= 0.0f` reaches bit-exact `0.0f` silence.
* **Lock-Free State Recall, VST3 Tail Guard & UI Teardown Parity (`PluginProcessor.h/.cpp`, `PluginEditor.cpp`, `js/app.js`, `js/audio/engine.js`)**:
  * Eliminated cross-thread races between `setStateInformation()` (message thread) and `processBlock()` (audio thread) via `std::atomic<bool> dspSilent` and lock-free `pendingSilentPowerSnap`.
  * Updated `getTailLengthSeconds()` to report `0.05 s` while `!isPoweredOn && !dspSilent` and `0.0 s` once `dspSilent == true`, preventing VST3/AU hosts (`IAudioProcessor::getTailSamples()`) from auto-suspending `processBlock()` mid-fade.
  * Cancelled in-flight chord-strum timers (`cancelAllActive()`), disarmed Shimmer Freeze, stopped active WAV recording on power-off across both Web and Native UIs, added `_powerEpoch` async `startAudio()` cancellation, and guarded `webComponent.isShowing()` under `#if JUCE_WEB_BROWSER` for headless Linux (`AS42_USE_WEBVIEW=OFF`) builds.

---

### 🔬 Certified Quality & Verification Matrix (600 Core Tests + 64 Probes = 100% PASS)

| Test Harness / Suite | Assertions | Result | Status |
| :--- | :--- | :--- | :--- |
| **Node.js Web Audio, UI & MIDI Automation (`npm test`)** | 522 tests (111 suites) | 522 Passed, 0 Failed | **PASS** |
| **Native C++ Real-Time DSP Units (`dsp_tests.exe`)** | 48 tests | 48 Passed, 0 Failed | **PASS** |
| **Adversarial Challenger Stress Suite (`challenger_stress_tests.exe`)** | 10 tests | 10 Passed, 0 Failed | **PASS** |
| **Adversarial Empirical Challenge Suite (`adversarial_challenge_suite.exe`)** | 11 tests | 11 Passed, 0 Failed | **PASS** |
| **JUCE AudioProcessor Lifecycle Suite (`plugin_lifecycle_tests.exe`)** | 9 tests | 9 Passed, 0 Failed | **PASS** |
| **Core Automated Test Total (`npm test` + Native C++ `ctest`)** | **600 Tests** | **600 Passed, 0 Failed** | **100% PASS** |
| **Standalone Fast Verification Checklist (`npm run verify:checklist`)** | 16 criteria | 16 Passed, 0 Errors | **PASS** |
| **Embedded Web Assets & APVTS Roundtrip (`web-assets-and-mime-stress.mjs`)** | 48 checks | 48 Passed, 0 Errors | **PASS** |

* Real-Time Safety: 0 leaks, 0 heap allocations in `processBlock()`, 0 NaNs, 0 Infinities, 0 cross-thread races, and strict FTZ/DAZ denormal protection across 44.1 kHz – 384 kHz.

---

### 📦 Distribution Packages & SHA-256 Checksums

| Package Archive | Size | SHA-256 Checksum |
| :--- | :--- | :--- |
| **`BRAUN_AS42-v1.5.1-Windows-x64.zip`** | 7,216,482 bytes (~6.88 MiB / 7.22 MB) | `36777604709dcdc3dbeb846458163d282649846e109f7a79bc95f7351ef04aee` |
| **`BRAUN_AS42-v1.5.1-VST3-Windows-x64.zip`** | 3,624,792 bytes (~3.46 MiB / 3.62 MB) | `d08d979379a06e3e78a0754fb89ba1e03b67cb4de1a2055a0d5a0bad00780c3d` |
| **`BRAUN_AS42-v1.5.1-macOS-Universal.zip`** | Target Binary | *(Generated on macOS Universal CI/CD runner)* |
| **`BRAUN_AS42-v1.5.1-Linux-x64.tar.gz`** | Target Binary | *(Generated on Linux x64 CI/CD runner)* |

---

### 🌐 Live In-Browser Web Audio Demonstration
Experience the synthesizer directly in your web browser with 100% client-side Web Audio & Web MIDI execution:  
👉 **[https://sneed-and-feed.github.io/](https://sneed-and-feed.github.io/)**

---

> *Legal Homage Notice: Not affiliated with Braun GmbH. Dieter Rams inspired design homage. Published by Sneed's Feed & Seed Ltd.*
