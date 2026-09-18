BRAUN AS 42 · Ambient Generative Synthesizer (v1.3.6)
=====================================================

Included in this release:
1. BRAUN_AS42.vst3 (Bundle folder)
   - Copy the 'BRAUN_AS42.vst3' folder into:
     C:\Program Files\Common Files\VST3\
   - Rescan plugins in your DAW (Ableton, FL Studio, Reaper, Cubase, Bitwig).

2. BRAUN_AS42.exe
   - Standalone desktop version with direct ASIO/WASAPI and hardware MIDI support.
   - Run directly, no DAW required.

What's New in v1.3.6:
- Runtime Native UI Occlusion Fix: Fixed WebView2 Win32 window occlusion when switching to Native mode. Corrected detachment order by updating bounds to (0, 0, 0, 0) and hiding WebView2 before detaching from peer, explicitly hiding child windows (SW_HIDE), and removing WS_CLIPCHILDREN from the peer HWND so Windows never clips JUCE's native Dieter Rams vector rendering.
- DAW Host Context Menu Parity: Parameter right-clicks now directly query getHostContext()->getContextMenuForParameter(param)->showNativeMenu(localPos) for native host DAW automation envelopes, parameter assignment, and MIDI learn menus in Reaper, Ableton Live, FL Studio, and Cubase.
- Web UI Context Menu Bridge: Added showContextMenu IPC bridge extending host DAW context menu triggers to Web UI controls.
- Comprehensive Test Certification: 100% pass rate across all automated test suites with 0 real-time heap allocations.

Project & Source: https://github.com/sneed-and-feed/braun_as-42
Web Demo: https://sneed-and-feed.github.io/
