BRAUN AS 42 · Ambient Generative Synthesizer (v1.4.1)
=====================================================

Included in this release:
1. BRAUN_AS42.vst3 (Bundle folder)
   - Copy the 'BRAUN_AS42.vst3' folder into:
     C:\Program Files\Common Files\VST3\
   - Rescan plugins in your DAW (Ableton, FL Studio, Reaper, Cubase, Bitwig).

2. BRAUN_AS42.exe
   - Standalone desktop version with direct ASIO/WASAPI and hardware MIDI support.
   - Run directly, no DAW required.

What's New in v1.4.1:
- Documentation Re-Architecture & Tri-Split:
  * Cleanly decoupled technical specifications into a streamlined 1-page README.md, comprehensive ARCHITECTURE.md datasheet, and detailed CHANGELOG.md.
- Legal Homage & Sneed's Feed & Seed Ltd. Metadata:
  * Standardized Dieter Rams homage disclaimer ("Not affiliated with Braun GmbH. Dieter Rams inspired design homage. Published by Sneed's Feed & Seed Ltd.") and unified manufacturer attributes (Brun / As42).
- SoftCompressor Dynamic Response Test Suite:
  * Extended C++ DSP test suite with dedicated SoftCompressor verification testing hyperbolic knee response, ratio curves, and attack/release envelope smoothing.
- Deterministic 0-Sample Dry Latency:
  * Formally certified 0-sample algorithmic dry latency across all buffer sizes (32-2048) alongside natural acoustic pre-delays on wet FDN shimmer and tape delay lines.
- Linux WebView Default to OFF:
  * Defaulted Linux builds to -DAS42_USE_WEBVIEW=OFF in CMake for clean out-of-the-box native compilation without WebKitGTK/Edge dependencies.
- Master Verification:
  * 100% test pass rate across 540 tests (473 Web Audio & MIDI tests + 67 Native C++ DSP tests) with 0 memory leaks, 0 denormals, and 0 NaNs.

Project & Source: https://github.com/sneed-and-feed/braun_as-42
Web Demo: https://sneed-and-feed.github.io/

