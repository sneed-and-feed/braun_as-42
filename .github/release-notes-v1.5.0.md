# BRAUN AS 42 · Release v1.5.0

## Release Title
**BRAUN AS-42 v1.5.0: Standalone Silent Cold-Boot Guard, Click-Free 15ms Drone Gate, Multi-Steal Filter Hygiene, Ultra-High SR FDN Scaling & Lifecycle Hardening**

---

## Musician & Developer Release Notes

**BRAUN AS-42 v1.5.0** is a major audio stability, desktop/DAW lifecycle hardening, and documentation synchronization release. Most prominently, it resolves a critical user-reported Windows Standalone (`BRAUN_AS42.exe`) startup issue where closing the standalone app with active drones or freeze caused the next launch to immediately auto-wake and sound drones. It also introduces a 15 ms anti-click active gate on Twin Drone ON/OFF transitions, hardens Felt Piano multi-steal pitch preservation and biquad state hygiene, dynamically scales the 8-line FDN shimmer reverb for ultra-high sample rates (192 kHz / 384 kHz+), adds dynamic VST3/AU tail reporting so hosts never auto-suspend ambient drone beds, and aligns all 38 APVTS parameter tables across the documentation and wiki.

---

### 🌟 Key Highlights & Engineering Changes

#### 1. 🛡️ Critical Standalone Silent Cold-Boot Guard (`BRAUN_AS42.exe` / `.app`)
* **Root Cause Identified & Eliminated (`PluginProcessor.h`, `PluginProcessor.cpp`)**:
  * JUCE's `StandaloneFilterWindow` automatically saves plugin state to `%APPDATA%\BRAUN_AS42.settings` on exit and calls `setStateInformation()` on the next cold launch prior to `createEditor()`. Previously, if a user closed `BRAUN_AS42.exe` with Drone 1, Drone 2, or Shimmer Freeze active, reloading that `.settings` file invoked `setDrone1Active(true)` / `setDrone2Active(true)`, which triggered v1.4.2 Power Auto-Wake (`isPoweredOn = true`) and immediately blasted drones out of studio monitors on launch.
  * **Wrapper-Aware State Machine**: `BRAUN_AS42AudioProcessor` now initializes `isPoweredOn = false` when `wrapperType == wrapperType_Standalone` and intercepts the initial cold-boot `setStateInformation()` reload (`!standaloneStartupStateConsumed`). All 38 user parameter calibrations, oscillator waveforms, `currentProgram`, and `droneTrackMidi` preferences are faithfully restored, while `drone1Active`, `drone2Active`, `shimmer_freeze`, and `isPoweredOn` are strictly disarmed (`Standby` + scope flush + deferred `dspEngine.reset()`).
  * **Full DAW Session Recall Preserved**: Under `wrapperType_VST3` and `wrapperType_AudioUnit`, `setStateInformation()` continues to restore active drones, freeze latch, and power states transparently so DAW project reloads and offline bounces render identically.
* **WebView2 Storage, Standby/BFCache & `loadPatch` Sync Hygiene (`index.html`, `js/app.js`, `js/audio/engine.js`, `js/midi/midi-manager.js`)**:
  * Purged residual `localStorage` / `sessionStorage` drone or freeze keys on JUCE bridge initialization, disarmed both JS/DOM drone toggles prior to `requestSync`, added `autocomplete="off"` on all `<select>` and `<input>` elements, guarded `scopeFrame` telemetry and Web Audio `ctx.resume()` behind `this.isPowerOn` (with BFCache `pageshow`/`pagehide` disarming), wired full C++ APVTS IPC synchronization across knobs/waveforms/pitches/sub-bass in `loadPatch()`, and implemented multi-voice `_noteVoiceMap` + `triggerId` stolen-voice protection for Web Audio `CC 64` sustain pedal latching.

#### 2. 🎛️ Click-Free 15 ms Drone Gate, Multi-Steal Pitch Lock & Biquad Hygiene
* **15 ms Anti-Click Drone ON/OFF Gate (`DroneVoiceDsp.h`)**:
  * Added `OnePoleSmoother mActiveGateSmoother` ($\tau = 15\text{ ms}$) on `SolarDroneVoice` so toggling Drone 1 or Drone 2 ON/OFF ramps smoothly instead of hard-switching mid-waveform.
  * Pre-aligned continuous smoothers (`mFreqSmoother`, `mCutoffSmoother`, `mGainSmoother`, `mResonanceSmoother`, `mFoldSmoother`) while inactive so adjusting pitch or cutoff with a drone turned off never produces a pitch/filter swoop upon activation, and flushed biquad/DC-blocker states to exact zero once the gate tail settles.
* **Felt Piano Multi-Steal & Filter State Hygiene (`FeltPianoDsp.h`)**:
  * Preserved the active outgoing `mStealFreq` when a voice already mid-way through its 5 ms de-click steal ramp is stolen a second time (`oldFreq = mIsStealing ? mStealFreq : mCurrentFreq`), preventing mid-ramp pitch snaps under extreme chord bursts.
  * Explicitly cleared all 4 per-voice biquads (`mFilter1`, `mFilter2`, `mBodyFilter`, `mHammerFilter`) on both idle note triggers and steal-trough completion so residual DF2T filter states never kick.
  * Synchronized `FeltPianoVoice::updateDecay()` filter decay scaling (`mFilterDecaySec`) across CS-80 (`0.50x`), Bass (`< MIDI 48`), Treble (`>= MIDI 72`), and Mid registers; smoothed `mHeadroomSmoother` fade-down when `felt_volume` is zeroed; and flushed `mSymDelayBuffer` + sympathetic resonators when `mSymTailSamples` reaches `0`.
* **Continuous CC 1 Mod-Wheel Brightness, Safe Wavetable Fallback & Web Audio DSP Parity (`DspEngine.cpp`, `Wavetables.h`, `js/audio/*`)**:
  * Replaced the discontinuous `mCurrentModWheel > 0.001f` branch (which abruptly halved `felt_tone` at `CC 1 = 1`) with continuous $C^0/C^1$-smooth interpolation `felt_tone + modWheel * (1 - felt_tone)`, clamped waveform indices to valid bounds, added a safe `default` sine table fallback in `WavetableBank::readSample()`, clamped `|y| >= 1.0 -> sgn(y)` in `js/audio/wavefolder.js` `applySmoothBoundaryKnee` (eliminating Hermite foldback above `0.88` in `makeFreezeLimiterCurve` + zero-drive `NaN` guard), preserved RT60 `decayScale` in `ShimmerReverb.setShimmer()`, and preserved live `voiceGain` fade state + `1.70x` Sub-Bass gain trim across `SolarDroneVoice` & `AudioEngine`.

#### 3. 🌌 Ultra-High Sample Rate FDN Scaling, Host Tail Reporting & Security Hardening
* **192 kHz / 384 kHz+ Dynamic FDN Capacity (`ShimmerReverbDsp.h`)**:
  * Dynamically scaled power-of-two FDN buffer capacity (`mFdnCapacity`, `mFdnMask`, minimum `32768`) in `ShimmerReverbDsp::prepare(double sampleRate)` and clamped modulated Hermite delay reads within `[4.0f, mFdnCapacity - 8]`, preventing buffer wraparound at ultra-high studio mastering rates.
* **Dynamic DAW Tail Length & 0-Sample MIDI Safety (`PluginProcessor.cpp`)**:
  * Implemented dynamic `getTailLengthSeconds()` returning `0.0` in Standby, `infinity` while Drone 1, Drone 2, or Shimmer Freeze is engaged (preventing VST3/AU hosts from auto-suspending `processBlock` on tracks without active MIDI regions), and `max(8.0, reverbDecay + delayTail)` otherwise.
  * Guaranteed 0-sample `processBlock` calls still execute `resetRequested` and drain queued UI/host Note-Off events so notes never hang across transport stops.
* **Bidirectional Program Sync, Windows PE Metadata, Resource Path Confinement & Clean Checksums (`CMakeLists.txt`, `PluginEditor.cpp`, `WebResourceManager.cpp`, `scripts/package_release.py`)**:
  * Added `fullSyncRequested` state-recall synchronization and bidirectional `currentProgram` sync (`setCurrentProgramIndexOnly`) between C++ APVTS, Native UI, and WebView2 without parameter echo loops, and zeroed Native UI CRT scope & `OUT L`/`OUT R` meters in Standby.
  * Hardened `WebResourceManager::getResource()` to reject relative path traversal (`..`, `:`) and enforce `isAChildOf(rootDir)` confinement.
  * Fixed JUCE 8 incremental Windows `.rc` caching in `CMakeLists.txt` (`BRAUN_AS42_resources.rc` regeneration + `OBJECT_DEPENDS`) and added `ctypes` Windows PE `VERSIONINFO` verification (`1.5.0` / `Sneed's Feed & Seed Ltd.`), stale `.zip` pruning, and clean `SHA256SUMS.txt` generation in `scripts/package_release.py`.

---

### 🔬 Certified Quality & Verification Matrix (592 Core Tests + 64 Probes = 100% PASS)

| Test Harness / Suite | Assertions | Result | Status |
| :--- | :--- | :--- | :--- |
| **Node.js Web Audio, UI & MIDI Automation (`npm test`)** | 519 tests (111 suites) | 519 Passed, 0 Failed | **PASS** |
| **Native C++ Real-Time DSP Units (`dsp_tests.exe`)** | 48 tests | 48 Passed, 0 Failed | **PASS** |
| **Adversarial Challenger Stress Suite (`challenger_stress_tests.exe`)** | 10 tests | 10 Passed, 0 Failed | **PASS** |
| **Adversarial Empirical Challenge Suite (`adversarial_challenge_suite.exe`)** | 11 tests | 11 Passed, 0 Failed | **PASS** |
| **JUCE AudioProcessor Lifecycle Suite (`plugin_lifecycle_tests.exe`)** | 4 tests | 4 Passed, 0 Failed | **PASS** |
| **Core Automated Test Total (`npm test` + Native C++ `ctest`)** | **592 Tests** | **592 Passed, 0 Failed** | **100% PASS** |
| **Standalone Fast Verification Checklist (`npm run verify:checklist`)** | 16 criteria | 16 Passed, 0 Errors | **PASS** |
| **Embedded Web Assets & APVTS Roundtrip (`web-assets-and-mime-stress.mjs`)** | 48 checks | 48 Passed, 0 Errors | **PASS** |

* Real-Time Safety: 0 leaks, 0 heap allocations in `processBlock()`, 0 NaNs, 0 Infinities, and strict FTZ/DAZ denormal protection across 44.1 kHz – 384 kHz.

---

### 📦 Distribution Packages & SHA-256 Checksums

| Package Archive | Size | SHA-256 Checksum |
| :--- | :--- | :--- |
| **`BRAUN_AS42-v1.5.0-Windows-x64.zip`** | 7,190,123 bytes (~6.86 MiB / 7.19 MB) | `848296771c9bb4ba4b32ffe37f404ec187a24c7803b2fe16c7b1f3098a96f9bf` |
| **`BRAUN_AS42-v1.5.0-VST3-Windows-x64.zip`** | 3,611,435 bytes (~3.44 MiB / 3.61 MB) | `20d5b34fa51f91d69966960f2e9edb58d31be9101c451ef8f6c1bf7337dce9a2` |
| **`BRAUN_AS42-v1.5.0-macOS-Universal.zip`** | Target Binary | *(Generated on macOS Universal CI/CD runner)* |

---

### 🌐 Live In-Browser Web Audio Demonstration
Experience the synthesizer directly in your web browser with 100% client-side Web Audio & Web MIDI execution:  
👉 **[https://sneed-and-feed.github.io/](https://sneed-and-feed.github.io/)**

---

> *Legal Homage Notice: Not affiliated with Braun GmbH. Dieter Rams inspired design homage. Published by Sneed's Feed & Seed Ltd.*
