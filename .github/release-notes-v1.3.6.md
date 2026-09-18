### What's New in v1.3.6

* **Runtime Native UI Occlusion Fix (Zero Black Screen):**
  * Resolved the persistent black-screen bug occurring when switching from Web UI to Native JUCE mode.
  * Corrected detachment lifecycle order in `setNativeMode(true)`: `webComponent.setBounds(0, 0, 0, 0)` and `webComponent.setVisible(false)` are executed while still attached to the peer, preventing JUCE's `ComponentMovementWatcher` from dropping the bounds update.
  * Windows child windows (`Chrome_WidgetWin_0`, `Intermediate D3D Window`) are explicitly hidden (`SW_HIDE` / `SetWindowPos`), and `WS_CLIPCHILDREN` is safely removed from the parent peer HWND so Windows never clips JUCE's native Dieter Rams vector rendering.
  * Seamless bidirectional toggling: switching back to Web UI (`setNativeMode(false)`) cleanly restores child window visibility and `WS_CLIPCHILDREN`.

* **DAW Host Parameter Context Menu Parity (`showNativeMenu`):**
  * Integrated direct host DAW context menu queries via `getHostContext()->getContextMenuForParameter(param)->showNativeMenu(localPos)` in `showKnobContextMenu`.
  * Right-clicking any parameter rotary dial or label now directly invokes the host DAW's native automation lanes, MIDI learn, and modulation assign popup menus in Reaper, Ableton Live, FL Studio, and Cubase.
  * Standalone execution and unsupported hosts cleanly fall back to Dieter Rams popup menus with Default/Min/Max reset and direct exact numeric entry.
  * Added `showContextMenu` IPC event bridge between Web UI and C++ editor, extending host DAW context menu access to Web UI controls.

* **Multi-Platform Test Verification & Clean Builds:**
  * Certified 100% pass rate across all 523 automated assertions (459 Node.js tests across 98 suites, 43 DSP tests, 10 challenger stress tests, and 11 adversarial tests).
  * Strict real-time safety: 0 heap allocations and 0 bytes allocated in `processBlock()`, zero NaNs/Infinities, and bounded DC offset.

---

### Included Distribution Binaries:
* **BRAUN_AS42-v1.3.6-Windows-x64.zip** (~7.1 MB): Precompiled Windows x64 package including VST3 (`BRAUN_AS42.vst3`) and Standalone application (`BRAUN_AS42.exe`).
* **BRAUN_AS42-v1.3.6-VST3-Windows-x64.zip** (~3.6 MB): VST3-only Windows x64 package including VST3 bundle (`BRAUN_AS42.vst3`).
