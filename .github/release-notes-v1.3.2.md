### What's New in v1.3.2

* **Web Audio Transient Click Discontinuity Elimination:**
  * Resolved a 1-sample rectangular impulse spike caused by idle `AudioParam.value` persistence in WebKit/Chromium re-triggering stale gain values.
  * Idle voices strictly anchor at `0.0` with full `_hammerEndTime` lifecycle tracking, preventing stale gain resurrection.
* **Warm Wooden Modal Soundboard & Velvety Felt Transient Synthesis:**
  * Replaced synthetic white noise with a physically-modeled ~135 Hz damped wooden soundboard modal impulse blended with 2-pole lowpass-filtered Brownian felt texture.
  * Tightened hammer lowpass filter transition to a 0.5 ms time constant, locking cutoffs instantly before the transient peak.
* **Full Parity Across Web Audio & C++ DSP:**
  * Complete synchronization of physical modeling parameters between native standalone/VST3 and browser Web Audio engines.
* **Browser Cache Busting:**
  * Updated web deployment with module versioning (`app.js?v=1.3.2`) to prevent stale browser disk caching.

---

### Included Distribution Binaries:
* **`BRAUN_AS42-v1.3.2-macOS-Universal.zip`** (~22.7 MB): Universal binary for Apple Silicon (M1/M2/M3/M4) and Intel x86_64, including VST3 (`BRAUN_AS42.vst3` for Ableton Live, Reaper, Bitwig), Audio Unit (`BRAUN_AS42.component` for Logic Pro & GarageBand), and Standalone desktop application (`BRAUN_AS42.app`).
* **`BRAUN_AS42-v1.3.2-Windows-x64.zip`** (~6.8 MB): Precompiled Windows x64 package including VST3 (`BRAUN_AS42.vst3`) and Standalone application (`BRAUN_AS42.exe`).
