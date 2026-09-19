# BRAUN AS 42 · Ambient Generative Synthesizer

[![Web Audio Live Demo](https://img.shields.io/badge/Web%20Audio-Live%20Demo-EE592B?style=for-the-badge&logo=html5&logoColor=white)](https://sneed-and-feed.github.io/)
[![macOS AU & VST3](https://img.shields.io/badge/macOS-AU%20%7C%20VST3%20%7C%20Standalone-white?style=for-the-badge&logo=apple&logoColor=black)](https://github.com/sneed-and-feed/braun_as-42/releases/download/v1.4.1/BRAUN_AS42-v1.4.1-macOS-Universal.zip)
[![Windows VST3](https://img.shields.io/badge/Windows-VST3%20%7C%20Standalone-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/sneed-and-feed/braun_as-42/releases/download/v1.4.1/BRAUN_AS42-v1.4.1-Windows-x64.zip)
[![Linux VST3](https://img.shields.io/badge/Linux-VST3%20%7C%20Standalone-FCC624?style=for-the-badge&logo=linux&logoColor=black)](#native-plugins--downloads)
[![Verification Checklist](https://img.shields.io/badge/Verification-100%25%20PASS%20(540%2F540)-brightgreen?style=for-the-badge&logo=checkmarx&logoColor=white)](VERIFICATION_CHECKLIST.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-4A4A4A?style=for-the-badge)](LICENSE)

> **Legal Homage Notice:** Not affiliated with Braun GmbH. Dieter Rams inspired design homage. Published by Sneed's Feed & Seed Ltd.  
> **A Dieter Rams functionalist digital-analog ambient instrument and microtonal drone synthesizer.**  
> *"Weniger, aber besser"* (Less, but better) — Inspired by **Harold Budd**, **Brian Eno**, and the **Elta Solar 42n**.

**Platforms:** macOS (Universal ARM64/Intel) · Windows (x64) · Linux (x86_64/ARM64) · Web Browser (iOS, Android, Desktop)  
**Plugin Formats:** Audio Unit (AUv2) · VST3 · Standalone Desktop Application · Web Audio API / Web MIDI

---

### 🌐 [🔊 Play Live in Your Browser (Zero Install · 100% Client-Side)](https://sneed-and-feed.github.io/)
*No accounts, downloads, or plugins required. Pure Web Audio API + Web MIDI engine running in Safari, Chrome, Edge, and Firefox.*

---

## 🎛️ Native Plugins & Downloads

| Platform | Format | Distribution | Quick Action |
| :--- | :--- | :--- | :--- |
| **macOS** | AUv2 (`.component`), VST3, Standalone (`.app`) | Universal Binary (Apple Silicon & Intel) | [💾 Download `macOS-Universal.zip`](https://github.com/sneed-and-feed/braun_as-42/releases/download/v1.4.1/BRAUN_AS42-v1.4.1-macOS-Universal.zip) |
| **Windows** | VST3, Standalone (`.exe`) | 64-bit Installer / Portable Archive | [💾 Download `Windows-x64.zip`](https://github.com/sneed-and-feed/braun_as-42/releases/download/v1.4.1/BRAUN_AS42-v1.4.1-Windows-x64.zip) or [VST3 Only](https://github.com/sneed-and-feed/braun_as-42/releases/download/v1.4.1/BRAUN_AS42-v1.4.1-VST3-Windows-x64.zip) |
| **Linux** | VST3, Standalone | Source Build (GCC/Clang) | `cmake -B build -DAS42_USE_WEBVIEW=OFF && cmake --build build` |

*Companion Reverb: Check out the sibling [**BRAUN RB-26 Master Studio Reverberator**](https://github.com/sneed-and-feed/braun_rb-26).*

---

## 🎹 Instrument Architecture & Sound Engines

The AS 42 unites three complementary ambient acoustics into a tactile, foolproof instrument:

* **Harold Budd Prepared Felt Piano & Harmonic Chimes:**
  * Physical modeling of felt-covered wooden hammer strikes, una corda 24dB damping, and resonant wooden soundboard formant (~135 Hz body resonance).
  * Natural sympathetic string resonance with golden-ratio micro-detuning dispersion ($\pm 1.4\text{ cents}$) across 6 polyphonic voices.
  * Register-dependent attack punch and dynamic release scaling ($t_{\text{rel}} = 0.14\text{s} - 1.84\text{s}$).
* **Elta Solar 42n Microtonal Twin Drones:**
  * Dual beatable oscillators (Saw, Square, Sine, Triangle, Warm) with continuous sub-Hertz beating offset ($0.00\text{ to }5.00\text{ Hz}$) and microtonal detuning.
  * West-Coast wavefolding transfer curves: **Web Audio runs 4x oversampled wavefolding**, while the **C++ native engine runs at native sample rate (1x)** with trigonometric multiple-angle anti-aliasing optimizations.
  * Dynamic MIDI Pitch Tracking: Drones follow piano chord roots into deep sub-bass with 40 ms portamento slewing and 200 ms anti-pop release gating.
* **Brian Eno Polyrhythmic Tape Delay & Shimmer Reverb:**
  * Polyrhythmic 3:2 cross-coupled delay lines with normalized loop gain ($\le 0.92$), calibrated dynamic headroom pad (`inputPad: 0.38` / -8.4 dB), and vintage wow & flutter.
  * Algorithmic 8-line FDN shimmer reverb with dual true-stereo pitch shifters (+12 semitones / 2.0x frequency) and golden-ratio tail modulation.
  * **Spacebar Infinite Freeze:** Suspends reverberant ambient clouds indefinitely with automatic input ducking.
* **Latency & Pre-Delay Accuracy:**
  * The dry instrument synthesis path has **strictly 0 samples algorithmic latency** (< 5 ms typical buffer latency).
  * The wet shimmer reverb path features **intentional acoustic pre-delays (5.3 ms, 7.9 ms, and 11 ms)** across FDN injection taps, modeling natural boundary wall reflections without muddying initial hammer impacts.

---

## 🚀 Quickstart: How to Play It

```text
+-----------------------------------------------------------------------------------------+
|  [POWER ON] (Top-right orange switch to wake Web Audio / audio engine)                  |
|                                                                                         |
|  1. CHIMES & KEYS     2. CHORD CLUSTERS       3. TWIN DRONES        4. TAPE & SHIMMER   |
|  Keys [A] to [']      Keys [1] to [=]         [DRONE 1] [DRONE 2]   [TAPE MIX]          |
|  or click & glissando (12 Harold Budd chords) [MIDI TRACK] on/off   [SHIMMER MIX]       |
|  11 modal scale notes Strum: SLOW/FAST/BLOCK  Quick-Snap buttons    [SPACEBAR] = FREEZE |
+-----------------------------------------------------------------------------------------+
```

1. **Power On:** Click the iconic orange **POWER ON** rocker switch (or press any key) to initialize audio.
2. **Play Chimes (`A` through `'`):** 11 harmonic modal degrees across octaves 3–5. Every note is quantized to the active scale (e.g. *Budd Felt Pentatonic*, *Lydian Ambient*)—**100% consonant with zero discordant notes**.
3. **Trigger Chords (`1` through `=`):** Voice 12 curated modal voicings (*Pavilion Sus*, *Plateaux Maj9*, *Ethereal 11th*, *Lydian Cascade*). Adjust **STRUM** (Slow, Med, Fast, Instant).
4. **Engage Twin Drones:** Toggle **DRONE 1** and **DRONE 2**. Use Rams **Quick-Snap** buttons (*Sub Bass*, *Deep Tonic*, *Perfect 5th*, *Beating Unison*) or enable **MIDI TRACK** to follow piano chord roots.
5. **Wash in Delay & Reverb:** Dial up **TAPE MIX** and **SHIMMER MIX**. Tap **SPACEBAR** at any time to lock the reverb into **INFINITE FREEZE**.

---

## 🎧 Curated Presets & Audio Demonstrations

* **Harold Budd · Pavilion:** Intimate felt piano, soft una corda damping, wooden soundboard warmth, subtle tape wow, and celestial shimmer bloom.
* **Brian Eno · Music for Airports:** Hypnotic sub-bass & beating-unison drones, slow Poisson generative rain, and expansive octave-up shimmer clouds.
* **Vangelis · CS-80 Brass:** Rich dual-oscillator detuned brass timbre, fast chord strumming, warm ladder lowpass resonance, and stereophonic tape delay.
* **Calibrated Default:** The canonical Dieter Rams baseline instrument balance.

---

## 📚 Technical Documentation & Verification

* 🏛️ [**ARCHITECTURE.md**](ARCHITECTURE.md) — Comprehensive technical datasheet: physical modeling mechanics, Zavalishin biquad cascades, FDN shimmer matrix, and full 38-parameter APVTS mapping.
* 📋 [**CHANGELOG.md**](CHANGELOG.md) — Detailed engineering changelog from v1.3.0 through v1.4.1 modernizations.
* 🔬 [**VERIFICATION_CHECKLIST.md**](VERIFICATION_CHECKLIST.md) — Certified test harness report (540 PASS: 473 Web Audio & MIDI tests + 67 C++ real-time DSP tests, 0 memory leaks, 0 denormals).

---

## ⚖️ Legal & Trademark Non-Affiliation

Not affiliated with Braun GmbH. Dieter Rams inspired design homage. Published by Sneed's Feed & Seed Ltd. All product names, trademarks, and registered trademarks referenced herein are the property of their respective owners. Their mention does not imply any affiliation, sponsorship, or endorsement.
