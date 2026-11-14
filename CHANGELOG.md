# BRAUN AS 42 · Changelog & Release Notes

All notable changes, architectural modernizations, DSP optimizations, and bug remediations for the BRAUN AS 42 ambient synthesizer are documented in this file.

## What's New in v1.5.0

* **Critical Standalone Silent Cold-Boot Guard (`BRAUN_AS42.exe` / `wrapperType_Standalone`):**
  * **Root-Cause Remediation:** Resolved a user-reported Standalone startup bug where closing `BRAUN_AS42.exe` with Drone 1, Drone 2, or Shimmer Freeze engaged caused JUCE's `StandalonePluginHolder` auto-saved `.settings` state to call `setDrone1Active(true)` / `setDrone2Active(true)` on the next cold launch—triggering v1.4.2 Power Auto-Wake (`isPoweredOn = true`) and immediately blasting drones before the user touched any control.
  * **Wrapper-Aware State Restoration (`PluginProcessor.h/.cpp`):** Initialized `isPoweredOn = false` on `wrapperType_Standalone` construction and guarded initial cold-boot `setStateInformation()` reload (`!standaloneStartupStateConsumed`) so Standalone restores all 38 user parameter calibrations, waveform choices, `currentProgram`, and `droneTrackMidi` while explicitly disarming `drone1Active = false`, `drone2Active = false`, `shimmer_freeze = false`, and `isPoweredOn = false` (Standby + scope buffer flush + deferred `dspEngine.reset()`). `wrapperType_VST3` and `wrapperType_AudioUnit` DAW sessions continue to recall active drones, freeze, and power states faithfully.
  * **WebView2 Storage, Standby/BFCache & `loadPatch` Sync Hygiene (`index.html`, `js/app.js`, `js/audio/engine.js`, `js/midi/midi-manager.js`):** Purged residual `localStorage`/`sessionStorage` drone/freeze keys on JUCE bridge initialization, forced both UI/engine drone flags OFF prior to `requestSync`, added `autocomplete="off"` across all `<select>` and `<input>` elements, guarded `scopeFrame` telemetry and Web Audio `ctx.resume()` behind `this.isPowerOn` (with BFCache `pageshow`/`pagehide` disarming), wired full C++ APVTS IPC synchronization in `loadPatch()`, and implemented multi-voice `_noteVoiceMap` + `triggerId` stolen-voice protection for Web Audio `CC 64` sustain pedal latching.
* **Click-Free Drone Gate, Multi-Steal Pitch Preservation & Filter Hygiene:**
  * **15 ms Anti-Click Drone Gate (`DroneVoiceDsp.h`):** Added `OnePoleSmoother mActiveGateSmoother` ($\tau = 15\text{ ms}$) across Drone 1 and Drone 2 ON/OFF transitions instead of abruptly cutting or starting mid-waveform, pre-aligned continuous smoothers (`mFreqSmoother`, `mCutoffSmoother`, `mGainSmoother`, `mResonanceSmoother`, `mFoldSmoother`) while inactive so cold starts never pitch/cutoff-swoop, and flushed filter/DC-blocker states once the gate tail settles.
  * **Multi-Steal & Biquad Hygiene (`FeltPianoDsp.h`):** Preserved outgoing `mStealFreq` when a voice already inside its 5 ms steal ramp is stolen again (`oldFreq = mIsStealing ? mStealFreq : mCurrentFreq`), cleared all 4 per-voice biquads (`mFilter1`, `mFilter2`, `mBodyFilter`, `mHammerFilter`) on both idle trigger and steal-trough completion, aligned `updateDecay()` filter decay scaling across CS-80, Bass (`< 48`), and Treble (`>= 72`) registers, smoothed `mHeadroomSmoother` transitions when `felt_volume` drops to zero, and zeroed `mSymDelayBuffer` + sympathetic resonators when `mSymTailSamples` finishes.
  * **Continuous CC 1 Mod-Wheel Mapping, Safe Enum Bounds & Web Audio DSP Parity (`DspEngine.cpp`, `Wavetables.h`, `js/audio/*`):** Replaced the discontinuous `mCurrentModWheel > 0.001f` step jump (which dropped `felt_tone` by 50% at `CC 1 = 1`) with continuous $C^0/C^1$-smooth interpolation `felt_tone + modWheel * (1 - felt_tone)`, clamped waveform indices to valid enum bounds, added a defensive `default` sine fallback in `WavetableBank::readSample()`, clamped `|y| >= 1.0 -> sgn(y)` in `js/audio/wavefolder.js` `applySmoothBoundaryKnee` (eliminating Hermite foldback above `0.88` in `makeFreezeLimiterCurve` + zero-drive `NaN` guard), preserved RT60 `decayScale` inside `ShimmerReverb.setShimmer()`, and preserved live `voiceGain` fade state + `1.70x` Sub-Bass gain trim across `SolarDroneVoice` & `AudioEngine`.
* **Ultra-High Sample Rate FDN Scaling, Lifecycle Sync & Packaging Hardening:**
  * **Dynamic Power-of-Two FDN Capacity (`ShimmerReverbDsp.h`):** Dynamically scaled FDN buffer capacity (`mFdnCapacity`, `mFdnMask`) for 192 kHz and 384 kHz+ hosts so scaled FDN line lengths plus modulation excursions never wrap or alias, with clamped 4-point Hermite read bounds.
  * **Dynamic Host Tail Reporting & 0-Sample Block Safety (`PluginProcessor.cpp`):** Implemented `getTailLengthSeconds()` returning `0.0` in Standby, `infinity` while Drone 1/2 or Shimmer Freeze is active (preventing DAW auto-sleep on drone tracks), and `max(8.0, reverbDecay + delayTail)` otherwise; ensured 0-sample `processBlock` calls still service `resetRequested` and queued Note-Off events.
  * **Echo-Free Bidirectional Sync, PE Metadata & Security (`CMakeLists.txt`, `PluginEditor.cpp`, `WebResourceManager.cpp`, `scripts/package_release.py`):** Added `fullSyncRequested` trigger on state/program recall, synchronized `currentProgram` bidirectionally without parameter echo loops, zeroed Native UI CRT scope & level meters in Standby, hardened `WebResourceManager` against relative path traversal (`..`, `:`), enforced CMake regeneration + `ctypes` PE `VERSIONINFO` verification (`1.5.0` / `Sneed's Feed & Seed Ltd.`) across Windows binaries, and fixed `scripts/package_release.py` to remove stale `.zip` archives and write clean `SHA256SUMS.txt` entries for active release artifacts only.
* **Certified 592-Test Pass Benchmark (+ 64 Asset/Checklist Probes):**
  * 100% pass rate across **592 core automated tests**: **519** Node.js Web Audio, UI & MIDI assertions (`111` suites, including `standalone-startup-drone-guard.test.js`) and **73** real-time native C++20 assertions across **4** CTest suites (`dsp_tests` 48, `challenger_stress_tests` 10, `adversarial_challenge_suite` 11, and new `plugin_lifecycle_tests` 4), plus 16 fast checklist criteria and 48 embedded web-asset/APVTS roundtrip probes.

---

## What's New in v1.4.3

* **Real-Time DSP CPU & Transcendental Math Optimizations:**
  * **Shimmer Reverb Freeze Smoother Guarding:** Guarded `mFreezeFeedbackSmoother`, `mFreezeWetSmoother`, and `mFreezeInputSmoother` time-constant (`setTimeConstant`) and target updates behind `params.freeze != mWasFrozen` transitions in `ShimmerReverbDsp.h`, eliminating ~144,000 redundant `std::exp()` evaluations per second at 48 kHz.
  * **Precomputed Early Reflection Taps:** Precomputed sample-rate-scaled delay offsets (`mEarlyTapDelays`) and stereo pan gains (`mEarlyTapGainL`, `mEarlyTapGainR`) across all 10 early reflection taps in `ShimmerReverbDsp::prepare()`.
  * **Drone Voice Trig & Power Caching:** Precomputed constant-power stereo panner gains (`mPanLeftGain`, `mPanRightGain`, `kCenterPanGain`) in `SolarDroneVoice::prepare()` and cached `mCachedDetuneRatio = std::pow(2.0f, detuneCents / 1200.0f)` in `DroneVoiceDsp.h`, eliminating ~192,000 per-second `std::cos`/`std::sin` and `std::pow` calls.
  * **Sympathetic Filter Coefficient Caching:** Cached `mLastSymTone` in `FeltPianoSynthesizer::updateSympatheticFilters()` so the dual sympathetic bandpass resonators only recompute coefficients when `tone` changes.
* **DSP Stability, Envelope & Bus Routing Fixes:**
  * **Freeze Smoother Reset Integrity:** Explicitly reset `mFreezeFeedbackSmoother` (`0.0f`), `mFreezeWetSmoother` (`0.0f`), and `mFreezeInputSmoother` (`1.0f`) inside `ShimmerReverbDsp::reset()` so resetting while frozen never leaves reverb input ducked at `0.08f`.
  * **Bass Register Decay Knob Consistency:** Updated `FeltPianoVoice::updateDecay()` in `FeltPianoDsp.h` to apply the exact bass register multiplier (`mCurrentMidi < 48` $\rightarrow 1.45 + (48 - \text{midi}) \times 0.04$) matching `FeltPianoVoice::trigger()`, preventing sudden decay drops when turning the Decay knob while holding a bass note.
  * **Zero-Volume Voice Envelope Advancement:** Fixed `FeltPianoSynthesizer::process()` when `volume < 1e-5` so active/releasing voices advance naturally to completion rather than freezing in time while muted.
  * **True Mono Bus Downmixing:** Fixed `DspEngine::process()` when `left == right` (mono bus layout) to output a balanced mono sum `0.5f * (finalL + finalR)` instead of overwriting the left channel with the right channel.
  * **MIDI Sample Offset Clamping:** Clamped `juce::MidiBuffer` event sample positions to `[0, numSamples - 1]` in `PluginProcessor::processBlock` and `DspEngine::process`.
* **Native JUCE Program Presets, Audition Gate & Bidirectional WebView Sync:**
  * **4 Curated Factory Programs:** Implemented `CALIBRATED DEFAULT`, `HAROLD BUDD · PAVILION`, `VANGELIS · CS-80 BRASS`, and `ENO · MUSIC FOR AIRPORTS` in `PluginProcessor` (`getNumPrograms`, `getCurrentProgram`, `setCurrentProgram`, `getProgramName`) with full state serialization in `getStateInformation` / `setStateInformation`.
  * **Native UI Audition Note-Off Gate & Dynamic Sample Rate Display:** Added automatic timed `pushUINoteOff` release (`Timer::callAfterDelay` with `SafePointer`) to `AMBIENT CHORD` and `DIRAC IMPULSE` audition buttons (preventing stuck notes in CS-80 and MIDI-tracked drone modes) and dynamically formatted the host sample rate in kHz on the Native UI chassis and CRT display.
  * **Bidirectional Discrete Parameter Sync:** Extended the `paramUpdate` listener in `js/app.js` to synchronize `feltWaveform`, `drone1WaveA`, `drone1WaveB`, `drone2WaveA`, `drone2WaveB`, `drone1SubBass`, and `reverbFreeze` from C++ host automation and Native UI changes into the WebView UI and JS engine.
* **Certified 580-Test Pass Benchmark:**
  * 100% pass rate across 580 automated tests: 512 Node.js Web Audio, UI & MIDI assertions and 68 real-time native C++ DSP assertions (including new Test 47 `test_audit_fixes_freeze_reset_bass_decay_zero_vol_and_mono_downmix`).

---

## What's New in v1.4.2

* **Power Auto-Wake, Apple Silicon Universal Build, Gatekeeper Signing & WebView2 Occlusion Management:**
  * Automatic synthesizer power-on when triggering MIDI notes or activating drones from standby.
  * Universal macOS binary build workflow (`arm64;x86_64`) with ad-hoc Gatekeeper signing and one-line installer scripts (`scripts/macos/`).
  * WebView2 memory and CPU lifecycle management pausing canvas rendering when occluded, minimized, or switched to Native UI mode.

---

## What's New in v1.4.1

* **Documentation Re-Architecture & Tri-Split:**
  * Cleanly separated the monolithic documentation into a focused, 1-page [`README.md`](README.md), an exhaustive technical [`ARCHITECTURE.md`](ARCHITECTURE.md) datasheet (physical modeling mechanics, Zavalishin biquad cascades, 8-line FDN shimmer matrix, and complete 38-parameter APVTS mapping), and an authoritative [`CHANGELOG.md`](CHANGELOG.md).
* **Dieter Rams Legal Homage & Sneed's Feed & Seed Ltd. Manufacturer Metadata:**
  * Formalized Dieter Rams functionalist homage disclaimers (*"Not affiliated with Braun GmbH. Dieter Rams inspired design homage. Published by Sneed's Feed & Seed Ltd."*) across all repository entrypoints, manifests, source headers, and bundle plists.
  * Synchronized native plugin manufacturer attributes (`PLUGIN_MANUFACTURER_CODE Brun`, `PLUGIN_CODE As42`, `BUNDLE_ID com.sneedandfeed.braun_as42`, `COMPANY_NAME Sneed's Feed & Seed Ltd.`).
* **SoftCompressor Knee, Ratio & Timing Dynamic Response Test Suite:**
  * Extended C++ DSP test suite with dedicated `test_soft_compressor_knee_ratio_and_timing` verifying hyperbolic tangent soft-knee inflection, variable compression ratio dynamics, program-dependent attack/release timing, and click-free envelope smoothing.
* **Deterministic 0-Sample Dry Latency vs Acoustic Wet Pre-Delays:**
  * Formally verified exact 0-sample algorithmic dry latency across all host buffer sizes (32–2048 samples) with zero lookahead overhead.
  * Preserved organic acoustic pre-delays across the 8-line FDN reverberation core and tape echo matrix, ensuring immediate transient attack definition while maintaining deep ambient spatialization.
* **Linux WebView Default Configuration (`AS42_USE_WEBVIEW=OFF`):**
  * Set default CMake build configuration on Linux to `-DAS42_USE_WEBVIEW=OFF` for lightweight, dependency-free native VST3 and standalone compilation without WebKitGTK or Edge WebView2 requirements.
* **Automated Cryptographic Release Packaging & SHA-256 Checksums:**
  * Introduced Python-driven release automation (`scripts/package_release.py`) generating standalone archives, VST3 bundles, and cryptographic digest verification tables (`SHA256SUMS.txt`).
* **Certified 540-Test Pass Benchmark:**
  * 100% test pass rate certifying 540 total automated tests: 473 Node.js Web Audio & MIDI assertions and 67 real-time native C++ DSP assertions across unit, challenger, and stress suites with zero memory leaks, zero denormals, and zero NaNs.

---

## What's New in v1.4.0

* **RB-26 Breakthrough Shimmer Reverb Engine Modernization:**
  * **Golden-Ratio Multi-Phase Tail Modulation:** Ported `TailModulator` to modulate all 8 FDN delay lines via an incommensurate multi-phase golden-ratio prime LFO network (0.45 Hz rate, 0.35 ms depth, 120 ms bloom). Continuously rotates loop eigenmodes to eradicate metallic comb filtering and standing-wave ringing on sustained felt piano notes.
  * **Transient Bloom Ducking & Rock-Solid Pitch Stability:** Integrated dual envelope follower (7 ms fast, 50 ms slow) that dynamically ducks modulation on note strikes ($tr > 1.5$). Keeps felt piano attack pitch drift $< 3.1\text{ cents}$ (well below the 5–6 cent human JND threshold) while allowing the tail to bloom into lush spatial diffusion ($< 3.4\text{ cents}$ drift).
  * **True Stereo Shimmer Loop:** Replaced legacy mono-summed shimmer loop with dual independent `DualDelayPitchShifter` engines and dual bandpasses (1600 Hz, $Q = 0.85$). Retains $>63\%$ stereo decorrelation without center image collapse.
  * **Hann Raised-Cosine Grain Windows:** Upgraded pitch shifter crossfades to $\sin^2(\pi\phi_1) + \sin^2(\pi\phi_2) \equiv 1.0$, completely eliminating the 22.2 Hz amplitude throb and phase modulation sidebands.
  * **4-Point Catmull-Rom Hermite Cubic Interpolation:** Replaced linear delay reading, preserving high-frequency shimmer sheen ($C^1$ continuity, noise floor $<-115\text{ dBFS}$).
  * **5 Hz DC Blockers & C1 Knee Limiting:** Zero-latency 1st-order DC rejection filters across all 8 lines (~14x cleaner DC) paired with smooth Hermite boundary knee saturation (`applySmoothBoundaryKnee`) to prevent feedback runaway and digital clipping.
  * **Low-End Decoupling & Sub-Bass Centering:** Cascaded 4th-order 120 Hz highpass on drone reverb send ($>40\text{ dB}$ sub-bass rejection) and $120\text{ Hz}$ M/S elliptical filter with automatic drone panner centering, keeping sub-bass punch focused dead-center.
  * **Comprehensive Verification:** Certified by 46 C++ real-time DSP unit tests (`dsp_tests.exe`), 10 adversarial stress tests (`challenger_stress_tests.exe`), 11 adversarial challenge tests (`adversarial_challenge_suite.exe`), and 473 JavaScript regression tests (`npm test`) with 0 failures and 0 memory allocations.

---

## What's New in v1.3.9

* **Freeze Recirculation Engine Restoration & Standalone Audio Fix:**
  * Diagnosed and eliminated fatal delay buffer zeroing bug (`std::fill` in `ShimmerReverbDsp.h` audio processing loop) that repeatedly wiped the circular freeze memory every ~0.387s / 0.491s when writing to index 0, causing silent or broken freeze behavior in the standalone application and VST3 plugin.
  * **Continuous Audio Recording:** Ensured freeze delay buffers continuously record rolling incoming audio (`inL`, `inR`) with `freezeInGain = 1.0f`, `freezeFb = 0.0f`, and `freezeWet = 0.0f` while freeze is disengaged.
  * **Lush Infinite Sustained Ambient Pad:** Configured `freezeFb` target to 0.988 (strictly bounded < 1.0, soft-limited at 0.88 with 75 Hz HPF sub-bass cutoff and 3200 Hz LPF damping) with `freezeWet = 0.85` and ducked `freezeInGain = 0.08`, delivering an endlessly sustaining ambient texture.
  * **Natural Click-Free Release:** Removed premature quench and double-ducking artifacts; unfreezing now smoothly slews `freezeFb -> 0.0f` (~0.05s), `freezeWet -> 0.0f` (~0.08s), and `freezeInGain -> 1.0f` (~0.08s) for a natural, clickless decay to silence within 200 ms.
  * **C++ & Web Audio Parity:** Synchronized exact freeze behavior across C++ DSP (`ShimmerReverbDsp.h`) and Web Audio (`shimmer-reverb.js`), verified with standalone C++ unit tests in `dsp_tests.cpp` (Test 44).

---

## What's New in v1.3.8

* **Sub-Bass Freeze Trapped Feedback Loop Elimination:**
  * Resolved critical DSP feedback bug where freezing in sub-bass drone mode (Voice 1 C1 ~32.7 Hz with 1.70x volume boost) accumulated resonant standing waves in the recirculating freeze delay lines (`freezeDelayL` 0.387s / `freezeDelayR` 0.491s), trapping the user in an endless sub-bass roar.
  * **Dedicated 75 Hz Sub-Bass Roll-off:** Inserted 2-pole Butterworth 75 Hz highpass filtering (`freezeInputHpFilter` and `freezeSubCutFilterL/R`) on freeze input and inside the cross-coupled recirculation matrix, completely eliminating subsonic energy accumulation while preserving dual 25 Hz DC blockers.
  * **Freeze Loop Soft Limiting:** Added smooth C1 soft limiter bounding maximum recirculating energy $\le 0.88$ (strictly below 0 dBFS digital full scale).
  * **Contractive Feedback Bounding:** Capped freeze feedback target to 0.982 (strictly contractive, down from 0.992).
  * **Rapid & Reliable Unfreeze Quench:** Replaced sluggish slow release with instant in-flight cancellation (`cancelAndHoldAtTime`), input ducking, and rapid decay strictly silenced ($\le 0.0$) within 50 ms.
  * **Clean Panic & Reset Integration:** Connected freeze quenching directly into `AudioEngine.releaseAllNotes()` and `AudioEngine.panic()`.
* **Master Verification Suite:**
  * Certified all 529 automated tests (100% pass) including regression suite `test/sub-bass-freeze-safeguard.test.js`.

---

## What's New in v1.3.7

* **Rotary Knob NaN Angle & Drag Remediation:**
  * Restored `this.startAngle = -140;` in `js/ui/knob.js` constructor, fixing broken `angleRange` evaluation (which had evaluated to NaN).
  * Rotary dials now render at their exact rotation angles with smooth SVG arc tracks and full mouse/touch drag functionality across all 32 parameters.
* **Robust Windows Native UI Transition (Zero Window Corruption):**
  * Eliminated destructive `EnumChildWindows` calls and `SetWindowLongPtr` style manipulations in `PluginEditor.cpp` that previously corrupted the main application and DAW wrapper windows.
  * Retained `webComponent` as a permanent child component of `PluginEditor` (eliminating `removeChildComponent`), collapsing its bounds to `(0, 0, 0, 0)` and setting `setVisible(false)` and `toBack()` in Native Mode.
  * When collapsed and hidden, WebView2 automatically minimizes occlusion and `WS_CLIPCHILDREN` clips zero pixels from the parent canvas, ensuring native JUCE vector graphics render completely unobstructed without tampering with host window styles.
* **Master Verification Suite:**
  * Added unified `tests/verify.mjs` test runner certifying all 523 tests across the entire test suite with 100% pass rate.

---

## What's New in v1.3.6

* **Runtime Native UI Occlusion Fix (Zero Black Screen):**
  * Fixed WebView2 HWND occlusion bug where switching from Web UI to Native JUCE mode left the child Win32 `Chrome_WidgetWin_0` window occluding the peer window.
  * Corrected detachment ordering in `setNativeMode(true)`: bounds are zeroed and visibility set to false before detaching from peer, child windows are explicitly hidden (`SW_HIDE`), and `WS_CLIPCHILDREN` is safely removed from the parent peer HWND so JUCE's native Dieter Rams vector rendering is never clipped.
  * When switching back to Web UI (`setNativeMode(false)`), child windows and `WS_CLIPCHILDREN` styles are cleanly restored.
* **DAW Host Context Menu Parity (`showNativeMenu`):**
  * Parameter right-clicks now query the DAW host context (`getHostContext()->getContextMenuForParameter(param)->showNativeMenu(localPos)`), presenting native automation lanes, MIDI learn, and modulation assign menus in Reaper, Ableton Live, FL Studio, and Cubase.
  * Standalone execution and unsupported hosts cleanly fall back to Dieter Rams popup menus with Default/Min/Max reset and direct exact numeric entry.
  * Added `showContextMenu` IPC event bridge between Web UI and C++ editor, extending host DAW context menu access to Web UI controls.
* **Release Artifact & Build Infrastructure:**
  * Synchronized version bump to v1.3.6 across CMake, Node.js packages, HTML scripts, and verification suites.

---

## What's New in v1.3.5

* **Native UI WebView2 Occlusion Elimination:**
  * Removed legacy Win32 child window visibility toggle (`setChildHwndsVisible` / `EnumChildWindows(..., SW_HIDE)`), resolving the persistent black-screen bug when switching between Web UI and Native UI modes.
  * Replaced window handle manipulation with clean JUCE component hierarchy management: `removeChildComponent(&webComponent)` when activating Native mode, and `addAndMakeVisible(webComponent)` when restoring Web mode.
  * Collapsed `webComponent.setBounds(0, 0, 0, 0)` in Native mode to guarantee zero window occlusion or input interception over native UI controls.
* **DAW Host Parameter Context Menu & Automation Parity:**
  * Integrated `getHostContext()->getContextMenuForParameter(param)` into `BraunKnob::showKnobContextMenu` alongside Dieter Rams preset values and direct text entry.
  * Provides first-class DAW automation envelopes, parameter assignment, and MIDI learn popup menus across Ableton Live, FL Studio, Reaper, Bitwig, Cubase, and Studio One.
  * Extended to Web UI via synchronized bidirectional parameter bindings.
* **Multi-Platform Test Verification:**
  * Certified 100% pass rate across all 523 automated assertions (459 Node.js tests across 98 suites, 43 DSP tests, 10 challenger stress tests, and 11 adversarial tests).

---

## What's New in v1.3.4

* **Cross-Platform Compiler Optimization Parity:**
  * Strict parity across toolchains with aggressive real-time performance flags: `/O2 /fp:precise /arch:AVX2` on MSVC, and `-O3 -Wall -Wextra` on Clang/GCC with IEEE-754 NaN/Inf safety and deterministic floating-point precision.
* **Sub-Bass DSP Stabilization Formalization:**
  * 6-pillar pipeline featuring phase-locking, DC-blocking (15Hz highpass), stereo monofication (pan = 0), Butterworth damping ($Q = 0.7071$), 140Hz lowpass ceiling, and monotonic soft-knee saturation with +4.6dB gain trim.
  * Click-free 25ms Hann crossfade dip on mode switching for seamless sonic transitions without transient thump.
* **Predictable Polyphonic Voice-Stealing Architecture:**
  * 4-tier hierarchical allocation lifecycle (`Inactive` -> `Released` -> `Pedal-Latched` -> `Physically Held`).
  * `VoiceStealPolicy` framework (default `OldestNoteFirst`), double-strike elimination (`mHammerPending`), and sustain pedal churn resilience (`releasePedalLatchedVoices`).
* **"RESET ALL" Preset Preservation:**
  * Recalibrates all 32 knobs, vector coordinates, and freeze status to the active preset or custom patch instead of forcing default, protecting sound design sessions.

---

## What's New in v1.3.3

* **Full Uncompressed Default Viewport (1240x780):**
  * Default window opens in full uncompressed side-by-side view (1240x780, matching `.braun-chassis` max-width) with resizable bounds (`960x600` to `2560x1440`).
* **Complete C++ JUCE Native Presentation Layer (`BraunLookAndFeel`):**
  * Hardware-accelerated Dieter Rams functionalist UI rendering with 38 APVTS parameter rotary sliders, buttons, and combo boxes.
  * Native DAW host context menu support for parameter automation, MIDI learn, and automation envelopes in Ableton Live, FL Studio, Reaper, Cubase, and Bitwig.
* **Real-Time Vector CRT Oscilloscope & Level Meters:**
  * 48 kHz phosphor vector waveform visualizer and stereo RMS peak level meters with hardware power indicator and MIDI activity monitors.
* **Persistent Dual-Mode GUI Switching:**
  * Seamless runtime switching between Web UI and Native DAW UI (`UI: NATIVE / WEB`), with state persistently saved to `%APPDATA%/Braun/AS42_settings.xml`.
* **Context Menu Hardening:**
  * Right-click Chromium/Edge context menu suppression in Web view to eliminate inadvertent developer tool popups during performance.

---

## What's New in v1.3.2

* **Elimination of Web Audio Transient Click Discontinuity:**
  * Resolved 1-sample rectangular impulse spike caused by idle `AudioParam.value` persistence in WebKit/Chromium re-triggering stale gain values.
  * Idle voices strictly anchor at `0.0` with full `_hammerEndTime` lifecycle tracking, preventing stale gain resurrection.
* **Warm Wooden Modal Soundboard & Velvety Felt Transient Synthesis:**
  * Replaced synthetic white noise with a physically-modeled ~135 Hz damped wooden soundboard modal impulse blended with 2-pole lowpass-filtered Brownian felt texture.
  * Tightened hammer lowpass filter transition to a 0.5 ms time constant (`setTargetAtTime(hammerCutoff, cancelTime, 0.0005)`), locking cutoffs instantly before the transient peak.
* **Browser Cache Busting:**
  * Updated web deployment with module versioning (`app.js?v=1.3.2`) to prevent stale browser disk caching.

---

## What's New in v1.3.1

* **Acoustic Hammer Transient Decoupling & Tactile Punch:**
  * Rerouted hammer impact burst around the string attack amplitude envelope directly into the piano soundboard peaking formant filter, eliminating severe envelope attenuation and increasing transient punch ~4x (+11.3 dB).
  * Retuned acoustic register multipliers (Bass: `3.20`, Mid: `2.80`, Treble: `2.00`) and widened bandpass $Q$ to `1.2` for warm, physical wooden thud at high hammer settings while keeping zero impact at minimum.
* **Continuous Acoustic Decay & Dynamic Release Scaling:**
  * Dynamic release time formula: $t_{\text{rel}} = 0.10\text{s} + 0.32\text{s} \times (\text{relScale})^{1.35}$, spanning ~0.14s (tight staccato at `0.2x`) to ~1.84s (long singing sustain tail at `3.5x`).
  * Implemented real-time voice decay updates (`updateDecay`) on both C++ and Web Audio engines so adjusting the decay dial immediately affects currently held and ringing notes.
  * Expanded UI decay knob boundaries from `[0.5, 2.5]` to `[0.2, 3.5]` and widened internal filter decay clamps to `[0.2, 3.5]`.
* **Soundboard Circulation & Sympathetic Resonance Bloom:**
  * Implemented 512-sample circular soundboard feedback loop (~10.6 ms) with soft-clipped circulation and a 250 ms resonance tail counter, ensuring natural acoustic bloom after notes are released instead of premature cutoff.
* **Host IPC Bridge Hardening:**
  * Added fallback alias mappings in `PluginEditor.cpp` for `feltHammer`, `hammer`, `feltDecay`, `decay`, `feltTone`, `tone`, `feltSymp`, and `sympathetic`.

---

## What's New in v1.3.0

* **DSP Numerical Stabilization & Thread Safety:**
  * Implemented `ScopedNoDenormals` RAII hardware guards enabling Flush-To-Zero (FTZ) and Denormals-Are-Zero (DAZ) on x86/x64 and ARM64.
  * Corrected biquad filter state reset to eliminate micro-clicks at zero-crossings during dynamic cutoff modulation.
  * Atomic APVTS reset requests (`resetRequested`) ensure thread-safe preset synchronization without stalls.
* **Pitch-Preserving Voice Stealing:**
  * Voice pitch is preserved during the 5ms exponential declick fade-out rather than abruptly jumping to new note frequencies, eliminating pitch-snap artifacts during rapid polyphonic playing.
* **Acoustic Refinement & DC Elimination:**
  * Relocated 15 Hz highpass DC blocker before the master compressor, reducing limiter pumping from 4.55 dB down to 0.01 dB.
  * Added DC-blocking highpass filters to shimmer reverb freeze loops to prevent runaway DC bias accumulation.
  * Balanced Hadamard matrix stereo decorrelation ($kOppScale = \sqrt{2} - 1 \approx 0.4142$) preserves mono downmix phase without comb cancellation.
  * Sample-rate-aware `OnePoleSmoother` filters eliminate parameter zipper noise across tape delay times, feedback, tone cutoffs, and wet/dry mix.
* **Non-Breaking Performance Optimizations:**
  * Replaced redundant transcendental calculations with the triple-angle identity $\sin(3\theta) = \sin\theta(3 - 4\sin^2\theta)$ (**34.3% CPU reduction** in hot wavefolder loops with bit-exact $C^1$ smoothness).
  * Precomputed FDN decay multipliers in shimmer reverb, saving 384,000 `exp()` calls per second.
  * Replaced modulo arithmetic in tape delay circular buffers with power-of-2 bitwise masking (**11.2% speedup**).
  * Compact active-voice bitmask traversal skips silent voices during polyphonic rendering.
  * Zero-copy `Int16Array` view pooling in `engine.js` eliminates garbage collection spikes during WAV recording.
  * Cached DOM element selectors in visualizer loops eliminate 60fps layout thrashing.
* **Expanded Verification:**
  * Test coverage expanded to 473 Web Audio tests and 66 native C++ tests (539 total tests passing with 0 failures).
