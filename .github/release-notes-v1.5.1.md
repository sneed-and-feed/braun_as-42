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
* **Persistent Hidden WebView2, Child-HWND Visibility & Multi-Host Isolation (`PluginEditor.h`, `PluginEditor.cpp`)**:
  * JUCE 8's `WebBrowserComponent` defaults to `unloadPageWhenHidden = true`, which navigates WebView2 to `about:blank` whenever `!isShowing()` (e.g. minimizing the window to the taskbar or hiding a DAW plugin window) and calls `goBack()` on restore—re-executing `index.html` and cold-DOM initialization.
  * Enabled `.withKeepPageLoadedWhenBrowserIsHidden()` and `--disable-http-cache`, scoped WebView2 `UserDataFolder` per host executable + browser-flag signature, implemented `isWebViewActuallyShowing()` checking Win32 `::IsWindowVisible` and `GA_ROOT` `::IsIconic` across VST3 child windows, and automatically triggered `syncAllParametersToWeb()` upon window visibility restoration (`justRestored = !wasWebShowing`).
* **VST3 Host Program Sync, Echo-Free Boot & Binary-First Assets (`PluginProcessor.cpp`, `js/app.js`, `WebResourceManager.cpp`)**:
  * Synchronized VST3 `ProgramChangeParameter` via `updateHostDisplay()` on program/state updates so host parameter flushes never reset customized presets back to `CALIBRATED DEFAULT` (`0`).
  * Passed `{ emitToNative: false }` to cold-DOM `applyPreset('DEFAULT', { animate: false, emitToNative: false })`, routed JUCE BFCache `pageshow` (`event.persisted`) to `requestSync`, and updated `WebResourceManager::getResource()` to serve embedded `BinaryData::web_assets_zip` as the primary authoritative source before local disk fallback.
* **Complete 16-Property `UIExtendedState` Serialization, Octave-Up Pitch Range & `masterDrive` DSP Wiring (`PluginProcessor.h/.cpp`, `Parameters.h`, `DspEngine.h/.cpp`, `js/ui/*`)**:
  * Persisted all 16 non-APVTS Web UI settings (`uiTheme`, `rootPitchClass`, `scaleKey`, `tuningA4`, `masterDrive`, `poissonDensity`, `poissonHumanize`, `chordSpeed`, `scopeMode`, `drone1Snap`, `drone2Snap`, `vectorMode`, `vectorX`, `vectorY`, `isCustomPatch`, `customPatchJson`) across editor close/reopen and VST3/AU/Standalone state chunks, with clean default reset when loading legacy presets.
  * Widened `drone1_pitch` and `drone2_pitch` to `20.0–1000.0 Hz` (`0.01 Hz` step) so Octave-Up + Perfect-5th snaps never clamp at `400 Hz`, wired `masterDrive` (`TAPE DRIVE`) into C++ `MasterLimiterDsp.tapeWarmth`, synchronized Native UI `BraunLookAndFeel` dark/light theme on preset recall, and updated internal JS engine caches via `knob._localOnChange` during host `paramUpdate` syncs.

#### 2. 🔇 Click-Free Power-Off With Active Drones & Race-Free Host Tail Guard
* **Rising-Edge-Only Auto-Wake & Cold-Drone Fade Guard (`PluginProcessor.cpp`)**:
  * Removed steady-state `drone1Active` / `drone2Active` checks from `PluginProcessor::processBlock()` power gating while retaining rising-edge auto-wake in `setDrone1Active(true)`, `setDrone2Active(true)`, and genuine `Note-On` (`velocity > 0`), gated cold armed drones during `!powered` fades, and preserved `dspSilent` across silent idle blocks so recalling Standby states never emits a 45 ms drone burst.
* **Sample-Accurate 45 ms $C^1$ Hermite Power Envelope (`PluginProcessor.h/.cpp`)**:
  * Added a 45 ms $C^1$-continuous Hermite power-off fade $(g(p) = p^2(3 - 2p))$ and 15 ms Hermite power-on fade in `processBlock()`, deferring `dspEngine.reset()` and scope buffer clearing until `powerLinear <= 0.0f` reaches bit-exact `0.0f` silence.
* **Lock-Free Real-Time Hygiene, VST3 Tail Guard & UI Teardown Parity (`PluginProcessor.h/.cpp`, `PluginEditor.cpp`, `js/app.js`, `js/audio/engine.js`, `js/ui/keyboard.js`)**:
  * Eliminated cross-thread races across `dspSilent`, `scopeBufferL`/`R`, `pendingSilentPowerSnap`, and `pendingSubBassSnap` (keeping `PluginEditor::parameterChanged()` 100% lock-free and allocation-free on the real-time audio thread).
  * Updated `getTailLengthSeconds()` to report `0.05 s` while `!isPoweredOn && !dspSilent` and `0.0 s` once `dspSilent == true`, preventing VST3/AU hosts (`IAudioProcessor::getTailSamples()`) from auto-suspending `processBlock()` mid-fade.
  * Cancelled in-flight chord-strum timers (`cancelAllActive()`), released held keyboard/touch notes via `engine.noteOff(midi)`, guarded `window.blur` so clicking outside WebView2 never kills DAW MIDI notes when no UI keys are held, awaited pending `_initPromise` inside Web Audio `powerOff()`, epoch-guarded generative/audition note-off timers, disarmed Shimmer Freeze, stopped active WAV recording on power-off across both Web and Native UIs, and ensured warning-free `AS42_USE_WEBVIEW=OFF` headless compilation.

---

### 🔬 Certified Quality & Verification Matrix (602 Core Tests + 64 Probes = 100% PASS)

| Test Harness / Suite | Assertions | Result | Status |
| :--- | :--- | :--- | :--- |
| **Node.js Web Audio, UI & MIDI Automation (`npm test`)** | 523 tests (111 suites) | 523 Passed, 0 Failed | **PASS** |
| **Native C++ Real-Time DSP Units (`dsp_tests.exe`)** | 48 tests | 48 Passed, 0 Failed | **PASS** |
| **Adversarial Challenger Stress Suite (`challenger_stress_tests.exe`)** | 10 tests | 10 Passed, 0 Failed | **PASS** |
| **Adversarial Empirical Challenge Suite (`adversarial_challenge_suite.exe`)** | 11 tests | 11 Passed, 0 Failed | **PASS** |
| **JUCE AudioProcessor Lifecycle Suite (`plugin_lifecycle_tests.exe`)** | 10 tests | 10 Passed, 0 Failed | **PASS** |
| **Core Automated Test Total (`npm test` + Native C++ `ctest`)** | **602 Tests** | **602 Passed, 0 Failed** | **100% PASS** |
| **Standalone Fast Verification Checklist (`npm run verify:checklist`)** | 16 criteria | 16 Passed, 0 Errors | **PASS** |
| **Embedded Web Assets & APVTS Roundtrip (`web-assets-and-mime-stress.mjs`)** | 48 checks | 48 Passed, 0 Errors | **PASS** |

* Real-Time Safety: 0 leaks, 0 heap allocations in `processBlock()`, 0 NaNs, 0 Infinities, 0 cross-thread races, and strict FTZ/DAZ denormal protection across 44.1 kHz – 384 kHz.

---

### 📦 Distribution Packages & SHA-256 Checksums

| Package Archive | Size | SHA-256 Checksum |
| :--- | :--- | :--- |
| **`BRAUN_AS42-v1.5.1-Windows-x64.zip`** | 7,219,635 bytes (~6.89 MiB / 7.22 MB) | `ba578757bd968bedb4e30d557014ae92f1aa71c812f19820e1d077be43eb9161` |
| **`BRAUN_AS42-v1.5.1-VST3-Windows-x64.zip`** | 3,626,385 bytes (~3.46 MiB / 3.63 MB) | `d71c42885457a7ddf567d04900cdbecbba823002d5f6e32d9493bc9ce6836779` |
| **`BRAUN_AS42-v1.5.1-macOS-Universal.zip`** | Target Binary | *(Generated on macOS Universal CI/CD runner)* |
| **`BRAUN_AS42-v1.5.1-Linux-x64.tar.gz`** | Target Binary | *(Generated on Linux x64 CI/CD runner)* |

---

### 🌐 Live In-Browser Web Audio Demonstration
Experience the synthesizer directly in your web browser with 100% client-side Web Audio & Web MIDI execution:  
👉 **[https://sneed-and-feed.github.io/](https://sneed-and-feed.github.io/)**

---

> *Legal Homage Notice: Not affiliated with Braun GmbH. Dieter Rams inspired design homage. Published by Sneed's Feed & Seed Ltd.*
