### What's New in v1.3.5

* **Native UI WebView2 Occlusion Elimination:**
  * Removed legacy Win32 child window visibility toggle (`setChildHwndsVisible` / `EnumChildWindows(..., SW_HIDE)`), resolving the persistent black-screen bug when switching between Web UI and Native UI modes.
  * Replaced window handle manipulation with clean JUCE component hierarchy management: `removeChildComponent(&webComponent)` when activating Native mode, and `addAndMakeVisible(webComponent)` when restoring Web mode.
  * Collapsed `webComponent.setBounds(0, 0, 0, 0)` in Native mode to guarantee zero window occlusion or input interception over native UI controls.

* **DAW Host Parameter Context Menu & Automation Parity:**
  * Integrated `getHostContext()->getContextMenuForParameter(param)` into `BraunKnob::showKnobContextMenu` alongside Dieter Rams preset values and direct text entry.
  * Provides first-class DAW automation envelopes, parameter assignment, and MIDI learn popup menus across Ableton Live, FL Studio, Reaper, Bitwig, Cubase, and Studio One.
  * Extended to Web UI via synchronized bidirectional parameter bindings.

* **Comprehensive Multi-Platform Test Verification:**
  * Certified 100% pass rate across all 523 automated tests (459 Node.js tests across 98 suites, 43 DSP tests, 10 challenger stress tests, and 11 adversarial tests).
  * Strict real-time safety: 0 heap allocations and 0 bytes allocated in `processBlock()`, zero NaNs/Infinities, and bounded DC offset.

---

### Included Distribution Binaries:
* **BRAUN_AS42-v1.3.5-Windows-x64.zip** (~6.8 MB): Precompiled Windows x64 package including VST3 (`BRAUN_AS42.vst3`) and Standalone application (`BRAUN_AS42.exe`).
* **BRAUN_AS42-v1.3.5-VST3-Windows-x64.zip** (~3.5 MB): VST3-only Windows x64 package including VST3 bundle (`BRAUN_AS42.vst3`).
* **BRAUN_AS42-v1.3.5-macOS-Universal.zip** (~22.7 MB): Universal binary for Apple Silicon (M1/M2/M3/M4) and Intel x86_64, including VST3 (`BRAUN_AS42.vst3`), Audio Unit (`BRAUN_AS42.component`), and Standalone application (`BRAUN_AS42.app`).
