BRAUN AS 42 · Ambient Generative Synthesizer (v1.5.1)
=====================================================

Included in this release:
1. BRAUN_AS42.vst3 (Bundle folder)
   - Copy the 'BRAUN_AS42.vst3' folder into:
     C:\Program Files\Common Files\VST3\
   - Rescan plugins in your DAW (Ableton, FL Studio, Reaper, Cubase, Bitwig).

2. BRAUN_AS42.exe (included in Full Windows-x64 archive)
   - Standalone desktop version with direct ASIO/WASAPI and hardware MIDI support.
   - Run directly, no DAW required.

What's New in v1.5.1:
- Minimize / Reopen & Editor Reopen State Preservation:
  * Fixed JUCE 8 WebBrowserComponent hidden-page unloading by enabling withKeepPageLoadedWhenBrowserIsHidden() and --disable-http-cache, scoping WebView2 UserDataFolder per host executable, and checking Win32 parent/root HWND visibility & iconic state across VST3 child windows.
  * Guarded cold-DOM applyPreset('DEFAULT', { emitToNative: false }) so initial UI calibration never overwrites C++ APVTS state, notified VST3 hosts of program changes via updateHostDisplay() so host parameter sync never clobbers presets back to Program 0, added automatic syncAllParametersToWeb() on window restore, and prioritized embedded BinaryData::web_assets_zip over working-directory disk files in WebResourceManager.
  * Persisted all 16 non-APVTS extended UI settings (theme, root note, modal scale, A4 tuning, Tape Drive, Poisson density/humanize, chord speed, scope mode, drone snaps, Vector Pad latch/coordinates, and custom JSON patches) across editor close/reopen and DAW sessions, widened APVTS drone1_pitch/drone2_pitch range to 20–1000 Hz (0.01 Hz step) for Octave-Up harmonic snaps, and wired Tape Drive (masterDrive) directly to C++ MasterLimiterDsp.tapeWarmth.
- Click-Free Power-Off With Active Drones & Race-Free Tail Guard:
  * Removed steady-state drone1Active / drone2Active power re-waking in processBlock() (retaining rising-edge auto-wake when enabling a drone or playing MIDI Note-On), gated cold armed drones during !powered fades, and preserved silent dspSilent tracking across idle blocks so pressing Power Off or recalling Standby states powers off cleanly with zero drone bursts.
  * Added a sample-accurate 45 ms C1 Hermite power-off ramp and 15 ms power-on ramp with deferred dspEngine.reset() at exact zero silence, eliminating power-off clicks/pops across sub-bass and twin drones.
  * Eliminated cross-thread state-recall, scope-buffer, and parameterChanged() audio-thread lock races via lock-free atomics and held a 50 ms tail in getTailLengthSeconds() until the 45 ms fade completes so VST3/AU hosts never auto-suspend processBlock mid-fade.
- Master Verification:
  * 100% test pass rate across 602 core automated tests (523 Web Audio, UI & MIDI tests + 79 Native C++ DSP & AudioProcessor lifecycle tests) plus 64 checklist/asset roundtrip assertions with 0 memory leaks, 0 denormals, and 0 NaNs.

Project & Source: https://github.com/sneed-and-feed/braun_as-42
Web Demo: https://sneed-and-feed.github.io/
