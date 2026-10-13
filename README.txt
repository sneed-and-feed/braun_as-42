BRAUN AS 42 · Ambient Generative Synthesizer (v1.4.3)
=====================================================

Included in this release:
1. BRAUN_AS42.vst3 (Bundle folder)
   - Copy the 'BRAUN_AS42.vst3' folder into:
     C:\Program Files\Common Files\VST3\
   - Rescan plugins in your DAW (Ableton, FL Studio, Reaper, Cubase, Bitwig).

2. BRAUN_AS42.exe
   - Standalone desktop version with direct ASIO/WASAPI and hardware MIDI support.
   - Run directly, no DAW required.

What's New in v1.4.3:
- Real-Time DSP CPU & Trig Optimizations:
  * Eliminated ~144,000 per-second std::exp() calls in ShimmerReverbDsp freeze smoothers (updating time constants only on state transitions) and precomputed early reflection tap delays and stereo pan gains in prepare().
  * Eliminated ~192,000 per-second std::cos/std::sin and std::pow calls in SolarDroneVoice by precomputing constant-power pan gains and caching detune ratios.
  * Cached sympathetic resonance filter coefficients in FeltPianoSynthesizer to avoid redundant trig updates per block.
- Shimmer Freeze Reset & Felt Piano Envelope Hardening:
  * Fixed ShimmerReverbDsp::reset() while frozen so input/feedback/wet smoothers restore cleanly to unfrozen defaults.
  * Fixed FeltPianoVoice::updateDecay() in the bass register (< MIDI 48) to preserve the natural bass decay multiplier when adjusting the Decay knob mid-note.
  * Fixed FeltPianoSynthesizer::process() when volume is 0 to advance active voice envelopes to natural completion instead of freezing voices in time.
- Mono Bus Downmix & MIDI Sample Offset Clamping:
  * Fixed mono bus output in DspEngine::process() so stereo outputs sum cleanly to 0.5 * (L + R) instead of overwriting the left channel.
  * Clamped JUCE MidiBuffer event sample offsets to [0, numSamples - 1] in PluginProcessor::processBlock and DspEngine::process.
- Native Factory Presets, Audition Note-Off & Bidirectional Discrete Sync:
  * Implemented all 4 factory programs (Calibrated Default, Harold Budd Pavilion, Vangelis CS-80 Brass, Eno Music for Airports) in PluginProcessor with state persistence.
  * Scheduled automatic Note-Off release for Native UI audition buttons and added dynamic host sample rate telemetry on the CRT display.
  * Synchronized discrete parameters (waveforms, sub-bass, reverb freeze) from C++ paramUpdate events back into the WebView UI and JS engine.
- Master Verification:
  * 100% test pass rate across 580 tests (512 Web Audio & MIDI tests + 68 Native C++ DSP tests) with 0 memory leaks, 0 denormals, and 0 NaNs.

Project & Source: https://github.com/sneed-and-feed/braun_as-42
Web Demo: https://sneed-and-feed.github.io/

