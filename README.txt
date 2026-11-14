BRAUN AS 42 · Ambient Generative Synthesizer (v1.5.0)
=====================================================

Included in this release:
1. BRAUN_AS42.vst3 (Bundle folder)
   - Copy the 'BRAUN_AS42.vst3' folder into:
     C:\Program Files\Common Files\VST3\
   - Rescan plugins in your DAW (Ableton, FL Studio, Reaper, Cubase, Bitwig).

2. BRAUN_AS42.exe (included in Full Windows-x64 archive)
   - Standalone desktop version with direct ASIO/WASAPI and hardware MIDI support.
   - Run directly, no DAW required.

What's New in v1.5.0:
- Critical Standalone Silent Cold-Boot Guard (BRAUN_AS42.exe):
  * Fixed Standalone startup auto-sounding bug where closing BRAUN_AS42.exe with Drone 1, Drone 2, or Shimmer Freeze active saved active flags into JUCE's StandalonePluginHolder settings and immediately re-triggered Power Auto-Wake on next launch.
  * Standalone cold boot now restores all calibrated continuous parameters, waveforms, program selection, and MIDI-track preferences while strictly disarming Drone 1, Drone 2, Shimmer Freeze, and Power (Standby). VST3/AU DAW project recall continues to restore active drones and power states faithfully.
  * Hardened WebView2 startup hygiene by purging residual localStorage/sessionStorage drone/freeze keys, disabling browser form autofill on synth controls, and ignoring late scope frames in Standby.
- Click-Free Drone Gate, Voice Stealing & Filter State Hygiene:
  * Added 15 ms OnePoleSmoother active-gate envelope on SolarDroneVoice ON/OFF transitions, pre-aligned inactive parameter smoothers so cold drone activation never swoops in pitch/cutoff, and flushed biquad/DC-blocker states once the gate tail settles.
  * Preserved active mStealFreq across mid-steal re-triggers in FeltPianoVoice, cleared per-voice biquad states on idle trigger and steal completion, aligned CS-80/Bass/Treble filter decay scaling in updateDecay(), and flushed sympathetic resonance delay/filter buffers on tail completion.
  * Replaced discontinuous CC 1 mod-wheel threshold jump with continuous C0/C1-smooth tone interpolation in DspEngine, eliminated cubic Hermite foldback above +/-1.0 in Web Audio applySmoothBoundaryKnee / makeFreezeLimiterCurve, preserved RT60 decayScale in ShimmerReverb.setShimmer(), and preserved live voiceGain / 1.70x Sub-Bass trim in SolarDroneVoice & AudioEngine.
- Ultra-High Sample Rate FDN Scaling, Host Tail Reporting & Security Hardening:
  * Dynamically scaled ShimmerReverbDsp power-of-two FDN delay buffer capacity for ultra-high sample rates (192 kHz / 384 kHz+) with safe Hermite read clamping.
  * Implemented dynamic getTailLengthSeconds() in PluginProcessor (infinity while drones or freeze are active so DAWs never auto-suspend ambient beds; reverb + delay tail otherwise; 0 in Standby).
  * Hardened WebResourceManager against relative path traversal and added bidirectional factory program sync without parameter echo loops.
- Master Verification:
  * 100% test pass rate across 589 core automated tests (516 Web Audio, UI & MIDI tests + 73 Native C++ DSP & AudioProcessor lifecycle tests) plus 64 checklist/asset roundtrip assertions with 0 memory leaks, 0 denormals, and 0 NaNs.

Project & Source: https://github.com/sneed-and-feed/braun_as-42
Web Demo: https://sneed-and-feed.github.io/
