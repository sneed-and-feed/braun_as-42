# BRAUN AS 42 · Release v1.4.3

## Release Title
**BRAUN AS-42 v1.4.3: Real-Time DSP CPU & Trig Optimizations, Freeze Reset & Bass Decay Hardening, Native Factory Presets & Bidirectional Discrete Sync**

---

## Musician & Developer Release Notes

**BRAUN AS-42 v1.4.3** is a comprehensive real-time DSP optimization, synthesis accuracy, and plugin integration release. It eliminates hundreds of thousands of redundant per-second transcendental math evaluations (`std::exp`, `std::cos`, `std::sin`, `std::pow`) on the real-time audio thread, hardens Shimmer Freeze reset and Felt Piano bass decay/envelope state management, adds proper mono bus downmixing, implements all 4 curated factory programs natively in `BRAUN_AS42AudioProcessor`, and completes full bidirectional synchronization for discrete parameters between the C++ APVTS host layer and the WebView2 UI.

---

### 🌟 Key Highlights & Engineering Changes

#### 1. ⚡ Real-Time DSP CPU & Transcendental Math Optimizations
* **Shimmer Reverb Freeze Smoother Transition Guard (`ShimmerReverbDsp.h`)**:
  * Guarded `mFreezeFeedbackSmoother`, `mFreezeWetSmoother`, and `mFreezeInputSmoother` time-constant (`setTimeConstant`) and target updates behind `if (params.freeze != mWasFrozen)` instead of recalculating `std::exp()` 3 times on every sample (eliminating **144,000 `std::exp()` calls/sec** at 48 kHz).
* **Precomputed Early Reflection Taps (`ShimmerReverbDsp.h`)**:
  * Precomputed sample-rate-scaled tap delay lengths (`mEarlyTapDelays[10]`) and stereo pan gains (`mEarlyTapGainL[10]`, `mEarlyTapGainR[10]`) in `prepare()`, removing 10 float-to-int casts and 20 multiplications per sample.
* **Solar Drone Voice Trig & Power Caching (`DroneVoiceDsp.h`)**:
  * Precomputed constant-power stereo panner gains (`mPanLeftGain`, `mPanRightGain`, `kCenterPanGain = 0.70710678f`) in `SolarDroneVoice::prepare()` and cached `mCachedDetuneRatio = std::pow(2.0f, detuneCents / 1200.0f)` per voice, eliminating **192,000 `std::cos`/`std::sin` and `std::pow` calls/sec** at 48 kHz across the twin drone oscillators.
* **Sympathetic String Filter Coefficient Caching (`FeltPianoDsp.h`)**:
  * Cached `mLastSymTone` in `FeltPianoSynthesizer::updateSympatheticFilters()` so the dual sympathetic bandpass resonators only recompute biquad coefficients when the `felt_tone` parameter changes.

#### 2. 🎹 Shimmer Freeze Reset & Felt Piano Envelope Hardening
* **Freeze Smoother Reset Integrity (`ShimmerReverbDsp.h`)**:
  * Explicitly reset `mFreezeFeedbackSmoother` (`0.0f`), `mFreezeWetSmoother` (`0.0f`), and `mFreezeInputSmoother` (`1.0f`) inside `ShimmerReverbDsp::reset()`. Previously, resetting the processor while Freeze was engaged left `mFreezeInputSmoother` ducked at `0.08f` (-22 dB) after unfreezing.
* **Bass Register Decay Knob Consistency (`FeltPianoDsp.h`)**:
  * Updated `FeltPianoVoice::updateDecay(float newDecay)` to include the bass register multiplier (`mCurrentMidi < 48` $\rightarrow 1.45 + (48 - \text{midi}) \times 0.04$), matching `FeltPianoVoice::trigger()`. Turning the Decay knob while holding a bass note now transitions smoothly without an abrupt drop in decay time.
* **Zero-Volume Active Voice Advancement (`FeltPianoDsp.h`)**:
  * Fixed `FeltPianoSynthesizer::process()` when `volume < 1.0e-5f` so active or releasing voices continue advancing their envelopes to natural completion while outputting silence, rather than freezing in time and audibly resuming later when volume is raised.

#### 3. 🔊 True Mono Bus Downmixing & MIDI Sample Offset Clamping
* **Balanced Mono Output (`DspEngine.cpp`)**:
  * Fixed `DspEngine::process()` when `left == right` (mono bus layout) to output a proper mono downmix `0.5f * (finalL + finalR)` instead of overwriting `left[s]` with `right[s]`.
* **Sample-Accurate MIDI Offset Clamping (`PluginProcessor.cpp`, `DspEngine.cpp`)**:
  * Clamped incoming `juce::MidiBuffer` event sample positions to `[0, std::max(0, numSamples - 1)]` to ensure out-of-range host MIDI timestamps never miss sample triggers or stall subsequent intra-block events.

#### 4. 🎛️ Native JUCE Factory Presets, Audition Note-Off Gate & Bidirectional Discrete Sync
* **4 Curated Native Factory Programs (`PluginProcessor.cpp`)**:
  * Implemented `getNumPrograms() == 4`, `getCurrentProgram()`, `setCurrentProgram()`, and `getProgramName()` for **Calibrated Default**, **Harold Budd · Pavilion**, **Vangelis · CS-80 Brass**, and **Eno · Music for Airports**, with full program index persistence in `getStateInformation()` and `setStateInformation()`.
* **Native UI Audition Note-Off Gate & Dynamic Sample Rate Telemetry (`PluginEditor.cpp`)**:
  * Added automatic timed `pushUINoteOff` release (`juce::Timer::callAfterDelay` with `SafePointer`) for the Native UI **AMBIENT CHORD** (650 ms) and **DIRAC IMPULSE** (150 ms) audition buttons, preventing stuck notes in CS-80 continuous mode and MIDI-tracked drone mode.
  * Updated the Native UI chassis and CRT Phosphor Oscilloscope headers to dynamically display the active DAW host sample rate (`44.1 KHZ`, `48 KHZ`, `88.2 KHZ`, `96 KHZ`, etc.).
* **Bidirectional Discrete Parameter Sync (`js/app.js`)**:
  * Extended the `paramUpdate` listener in `js/app.js` to synchronize discrete APVTS parameters (`feltWaveform`, `drone1WaveA`, `drone1WaveB`, `drone2WaveA`, `drone2WaveB`, `drone1SubBass`, `reverbFreeze`) from DAW host automation and Native UI changes directly into the WebView2 UI and JS audio engine.

---

### 🔬 Certified Quality & Verification Matrix (580 PASS)

| Test Harness / Suite | Assertions | Result | Status |
| :--- | :--- | :--- | :--- |
| **Node.js Web Audio, UI & MIDI Automation (`npm test`)** | 512 tests (110 suites) | 512 Passed, 0 Failed | **PASS** |
| **Native C++ Real-Time DSP Units (`dsp_tests.exe`)** | 47 tests | 47 Passed, 0 Failed | **PASS** |
| **Adversarial Challenger Stress Suite (`challenger_stress_tests.exe`)** | 10 tests | 10 Passed, 0 Failed | **PASS** |
| **Adversarial Empirical Challenge Suite (`adversarial_challenge_suite.exe`)** | 11 tests | 11 Passed, 0 Failed | **PASS** |
| **Standalone Fast Verification Checklist (`npm run verify:checklist`)** | 16 criteria | 16 Passed, 0 Errors | **PASS** |
| **Total Automated Tests** | **580 Tests** | **580 Passed, 0 Failed** | **100% PASS** |

* Real-Time Safety: 0 leaks, 0 heap allocations in `processBlock()`, 0 NaNs, 0 Infinities, and strict FTZ/DAZ denormal protection.

---

### 📦 Distribution Packages & SHA-256 Checksums

| Package Archive | Size | SHA-256 Checksum |
| :--- | :--- | :--- |
| **`BRAUN_AS42-v1.4.3-Windows-x64.zip`** | 7,184,237 bytes (~6.85 MiB / 7.18 MB) | `819fab6a2999ee593b2fd86dd5fd68312ed13b173194b7f1e3ce1756b28a9e30` |
| **`BRAUN_AS42-v1.4.3-VST3-Windows-x64.zip`** | 3,608,613 bytes (~3.44 MiB / 3.61 MB) | `614141a7e04f9de5932545f35b7ff23820b607ece18c0fba2f9ba4ef40ab63ed` |
| **`BRAUN_AS42-v1.4.3-macOS-Universal.zip`** | Target Binary | *(Generated on macOS Universal CI/CD runner)* |

---

### 🌐 Live In-Browser Web Audio Demonstration
Experience the synthesizer directly in your web browser with 100% client-side Web Audio & Web MIDI execution:  
👉 **[https://sneed-and-feed.github.io/](https://sneed-and-feed.github.io/)**

---

> *Legal Homage Notice: Not affiliated with Braun GmbH. Dieter Rams inspired design homage. Published by Sneed's Feed & Seed Ltd.*
