BRAUN AS 42 · Ambient Generative Synthesizer (v1.3.7)
=====================================================

Included in this release:
1. BRAUN_AS42.vst3 (Bundle folder)
   - Copy the 'BRAUN_AS42.vst3' folder into:
     C:\Program Files\Common Files\VST3\
   - Rescan plugins in your DAW (Ableton, FL Studio, Reaper, Cubase, Bitwig).

2. BRAUN_AS42.exe
   - Standalone desktop version with direct ASIO/WASAPI and hardware MIDI support.
   - Run directly, no DAW required.

What's New in v1.3.7:
- Rotary Knob NaN & Drag Fix: Restored startAngle = -140 in knob.js constructor, restoring full 280° rotation and responsive mouse/touch drag manipulation across all parameters.
- Robust Native Mode Transition: Removed destructive EnumChildWindows and SetWindowLongPtr manipulations, keeping WebBrowserComponent as a permanent zero-bounded child in native mode to ensure zero host window corruption and unobstructed Dieter Rams JUCE vector rendering.
- Master Verification Suite: Added unified tests/verify.mjs certifying all 523 tests across the entire suite.

Project & Source: https://github.com/sneed-and-feed/braun_as-42
Web Demo: https://sneed-and-feed.github.io/
