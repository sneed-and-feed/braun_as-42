BRAUN AS 42 · Ambient Generative Synthesizer (v1.3.8)
=====================================================

Included in this release:
1. BRAUN_AS42.vst3 (Bundle folder)
   - Copy the 'BRAUN_AS42.vst3' folder into:
     C:\Program Files\Common Files\VST3\
   - Rescan plugins in your DAW (Ableton, FL Studio, Reaper, Cubase, Bitwig).

2. BRAUN_AS42.exe
   - Standalone desktop version with direct ASIO/WASAPI and hardware MIDI support.
   - Run directly, no DAW required.

What's New in v1.3.8:
- Sub-Bass Freeze Trapped Feedback Loop Fix: Resolved bug where freezing in sub-bass drone mode (C1, ~32.7 Hz with 1.70x volume boost) accumulated resonant standing waves and caused trapped feedback runaway.
- Dedicated Freeze Sub-Bass Roll-off: Added 75 Hz 2-pole Butterworth highpass filtering on the freeze input and recirculating delay lines, isolating subsonic drone rumble (<65-80 Hz) from the freeze matrix.
- Freeze Loop Soft-Limiter & Contractive Feedback: Inserted smooth C1 soft-limiter bounding loop peaks to <= 0.88 (below 0 dBFS) and capped feedback gain to 0.982.
- Rapid & Clean Quench on Unfreeze / Panic: Cancelled in-flight AudioParam scheduling, immediately ducked freeze input gain, and rapidly silenced feedback and wet gains within 50 ms. Hooked freeze quench directly into releaseAllNotes() and panic().
- Master Verification Suite: Extended tests certifying all 529 tests across the entire suite with 100% pass rate.

Project & Source: https://github.com/sneed-and-feed/braun_as-42
Web Demo: https://sneed-and-feed.github.io/
