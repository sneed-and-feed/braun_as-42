### What's New in v1.3.7

* **Rotary Knob NaN Angle & Interaction Remediation:**
  * Restored `this.startAngle = -140;` in `js/ui/knob.js` constructor, resolving an issue where undefined `this.startAngle` caused `this.angleRange` to evaluate to `NaN`.
  * Knobs now correctly rotate across their full 280° arc and support smooth pointer and touch drag interaction across all 32 parameters.

* **Robust Windows Native Mode Transition (Zero Window Corruption):**
  * Eliminated destructive `EnumChildWindows` calls and `SetWindowLongPtr` style manipulations in `PluginEditor.cpp` that previously caused window style loss and hid child windows across the entire hierarchy.
  * Preserved `webComponent` as a permanent child component of `PluginEditor`, eliminating `removeChildComponent(&webComponent)`.
  * In `setNativeMode(true)`, the component is collapsed to `(0, 0, 0, 0)` bounds, hidden, and sent to back (`webComponent.toBack()`), cleanly invoking WebView2 visibility and bounds reduction without clipping JUCE native vector controls or corrupting host DAW window chrome.

* **Master Verification Test Suite:**
  * Added unified master test runner `tests/verify.mjs` verifying all 523 tests across the entire test suite with 100% pass rate.

---

### Included Distribution Binaries:
* **BRAUN_AS42-v1.3.7-Windows-x64.zip**: Precompiled Windows x64 package including VST3 (`BRAUN_AS42.vst3`) and Standalone application (`BRAUN_AS42.exe`).
* **BRAUN_AS42-v1.3.7-VST3-Windows-x64.zip**: VST3-only Windows x64 package including VST3 bundle (`BRAUN_AS42.vst3`).
