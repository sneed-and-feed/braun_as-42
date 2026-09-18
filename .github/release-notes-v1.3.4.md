### What's New in v1.3.4

* **Cross-Platform Compiler Optimization Parity (AVX2 & O2/O3):**
  * Updated CMake real-time build flags to achieve optimization parity with RB-26.
  * **Windows (MSVC)**: `/O2 /fp:precise /arch:AVX2` for automated SIMD loop vectorization while preserving strict IEEE-754 adherence to ensure real-time `std::isnan()` and `std::isinf()` safety guards are never stripped.
  * **macOS & Linux (Clang/GCC)**: `-O3 -Wall -Wextra` with `-fPIC` shared object generation.

* **Sub-Bass DSP Stabilization Subsystem (`isSubBass`):**
  * Formalized and isolated the sub-bass stabilization engine in `SolarDroneVoice` across 6 distinct physical and psychoacoustic pillars:
    1. **Phase Locking**: Twin oscillators locked in exact phase (0.0 Hz beating, 0.0 cents detune) to eliminate acoustic comb filtering at 32.7 Hz (C1).
    2. **Stereo Monofication**: Automatic mono-centering (`pan = 0.0`) overriding default Voice 1 pan (-0.45) for clean subwoofer translation and vinyl cutting compliance.
    3. **Sub-Bass 15 Hz DC Blocker**: Infrasonic 1-pole highpass filter with denormal flushing (`flushDenormal`) and pole clamping across sample rates from 44.1 kHz to 192+ kHz.
    4. **Butterworth Resonance Damping**: Resonance clamped to 0.5 (Q = sqrt(0.5) ~ 0.7071) to eliminate muddy 60–90 Hz boominess.
    5. **140 Hz Low-Pass Ceiling**: Caps filter cutoff strictly at 140 Hz to prevent wavefolding harmonics from masking upper felt piano harmonics.
    6. **Monotonic Soft-Knee Saturation**: Normalized hyperbolic tangent saturation with C1 Hermite knee at 0.70 replaces wavefolding, preserving the pure sub fundamental with +4.6 dB (1.70x) ISO 226 equal-loudness boost.
  * **Click-Free Dynamic Switching**: 25ms raised-cosine Hann silence dip (g(0.5) = 0.0) guarantees pop-free transitions and zero-gain phase alignment when automating sub-bass mode in a DAW.

* **Predictable Polyphonic Voice-Stealing Architecture:**
  * Implemented an explicit, transparent 4-tier allocation hierarchy in `FeltPianoSynthesizer`:
    * **Tier 1 (Inactive)**: Cyclic round-robin allocation.
    * **Tier 2 (Released)**: Voices fading in release stage stolen first.
    * **Tier 3 (Pedal-Latched)**: Keys lifted but sustained by sustain pedal (`mLatchedKeys`) stolen second.
    * **Tier 4 (Physically Held)**: Keys actively held down by the performer (`mHeldKeys`) strictly protected until all 24 voices are held.
  * Added `VoiceStealPolicy` enum defaulting to **`OldestNoteFirst`** (strict FIFO stealing by timestamp), with 60ms chord-protection window against rapid-strike voice cancellation.
  * **Double-Strike Elimination**: Introduced `mHammerPending` during the 5ms voice-stealing declick down-ramp, delaying hammer onset until the stolen voice has decayed to silence.
  * **Sustain Pedal Churn Resilience**: Implemented `releasePedalLatchedVoices()` invoked on pedal-up (CC 64) and reset controllers (CC 121 / CC 123) to eliminate stuck or desynchronized latched notes.

* **"RESET ALL" Preset Preservation:**
  * Clicking "RESET ALL" now detects the active preset (`DEFAULT`, `HAROLD_BUDD`, `VANGELIS`, `ENO_AIRPORTS`, or `CUSTOM`) and recalibrates all 32 knobs, vector coordinates, and reverb freeze to that specific preset's calibrated values instead of reverting to the global default.
  * Full support for user-imported patches (`CUSTOM`), caching user patches on `_loadedPatch` and preserving dropdown selections.
  * Corrected stepped quantization resolutions (`droneDetune` step 0.1, `droneLfo` step 0.01).

* **CI/CD Cleanup:**
  * Pruned redundant manual `deploy-pages.bat` script, delegating web deployments entirely to automated GitHub Actions CI/CD.

---

### Included Distribution Binaries:
* **BRAUN_AS42-v1.3.4-Windows-x64.zip** (~6.8 MB): Precompiled Windows x64 package including VST3 (`BRAUN_AS42.vst3`) and Standalone application (`BRAUN_AS42.exe`).
* **BRAUN_AS42-v1.3.4-macOS-Universal.zip** (~22.7 MB): Universal binary for Apple Silicon (M1/M2/M3/M4) and Intel x86_64, including VST3 (`BRAUN_AS42.vst3`), Audio Unit (`BRAUN_AS42.component`), and Standalone application (`BRAUN_AS42.app`).
