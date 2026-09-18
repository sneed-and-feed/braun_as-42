BRAUN AS 42 · Ambient Generative Synthesizer (v1.3.5)
=====================================================

Included in this release:
1. BRAUN_AS42.vst3 (Bundle folder)
   - Copy the 'BRAUN_AS42.vst3' folder into:
     C:\Program Files\Common Files\VST3\
   - Rescan plugins in your DAW (Ableton, FL Studio, Reaper, Cubase, Bitwig).

2. BRAUN_AS42.exe
   - Standalone desktop version with direct ASIO/WASAPI and hardware MIDI support.
   - Run directly, no DAW required.

What's New in v1.3.5:
- Native UI WebView2 Occlusion Elimination: Removed legacy Win32 child window visibility toggle (setChildHwndsVisible / EnumChildWindows(..., SW_HIDE)), resolving the black-screen bug when switching between Web UI and Native UI modes. Managed component hierarchy cleanly with removeChildComponent(&webComponent) and addAndMakeVisible(webComponent).
- DAW Host Parameter Context Menu & Automation Parity: Integrated getHostContext()->getContextMenuForParameter(param) into showKnobContextMenu for native DAW automation envelopes, parameter assignment, and MIDI learn popup menus across Ableton Live, FL Studio, Reaper, Bitwig, Cubase, and Studio One.
- Comprehensive Test Certification: 100% pass rate across all 523 automated assertions (459 Node.js tests, 43 DSP tests, 10 challenger stress tests, and 11 adversarial tests) with zero real-time heap allocations.

Project & Source: https://github.com/sneed-and-feed/braun_as-42
Web Demo: https://sneed-and-feed.github.io/
