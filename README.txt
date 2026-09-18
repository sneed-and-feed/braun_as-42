BRAUN AS 42 · Ambient Generative Synthesizer (v1.3.9)
=====================================================

Included in this release:
1. BRAUN_AS42.vst3 (Bundle folder)
   - Copy the 'BRAUN_AS42.vst3' folder into:
     C:\Program Files\Common Files\VST3\
   - Rescan plugins in your DAW (Ableton, FL Studio, Reaper, Cubase, Bitwig).

2. BRAUN_AS42.exe
   - Standalone desktop version with direct ASIO/WASAPI and hardware MIDI support.
   - Run directly, no DAW required.

What's New in v1.3.9:
- Freeze Recirculation Engine Restoration: Fixed critical bug where std::fill in the ShimmerReverbDsp audio loop repeatedly zeroed circular delay memory every ~0.387s / 0.491s when writing to index 0, restoring full freeze functionality in the standalone app and VST3.
- Continuous Audio Recording: Delay lines continuously record rolling incoming audio (inL, inR) with freezeInGain = 1.0f while freeze is off.
- Endless Sustained Ambient Pad: freezeFb targets 0.988 with freezeWet = 0.85 and ducked input = 0.08, bounded < 1.0 and soft-limited at 0.88 with 75 Hz HPF and 3200 Hz LPF damping.
- Clean Natural Release: Eliminated premature quench and double-ducking artifacts; unfreezing cleanly decays to silence within 200 ms without clicks or buffer wiping.
- Full C++ and Web Audio Parity: Synchronized DSP engines and certified by comprehensive automated test suites.

Project & Source: https://github.com/sneed-and-feed/braun_as-42
Web Demo: https://sneed-and-feed.github.io/

