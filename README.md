# BRAUN AS 42 · Ambient Generative Synthesizer

[![Web Audio Live Demo](https://img.shields.io/badge/Web%20Audio-Live%20Demo-EE592B?style=for-the-badge&logo=html5&logoColor=white)](https://sneed-and-feed.github.io/)
[![macOS AU & VST3](https://img.shields.io/badge/macOS-AU%20%7C%20VST3%20%7C%20Standalone-white?style=for-the-badge&logo=apple&logoColor=black)](https://github.com/sneed-and-feed/braun_as-42/releases/download/v1.3.6/BRAUN_AS42-v1.3.6-macOS-Universal.zip)
[![Windows VST3](https://img.shields.io/badge/Windows-VST3%20%7C%20Standalone-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://raw.githubusercontent.com/sneed-and-feed/sneed-and-feed.github.io/main/releases/BRAUN_AS42-v1.3.8-Windows-x64.zip)
[![Linux VST3](https://img.shields.io/badge/Linux-VST3%20%7C%20Standalone-FCC624?style=for-the-badge&logo=linux&logoColor=black)](#build-linux)
[![Verification Checklist](https://img.shields.io/badge/Verification-100%25%20PASS%20(529%2F529)-brightgreen?style=for-the-badge&logo=checkmarx&logoColor=white)](VERIFICATION_CHECKLIST.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-4A4A4A?style=for-the-badge)](https://opensource.org/licenses/MIT)

> **A Dieter Rams functionalist digital-analog ambient instrument and microtonal drone synthesizer.**
> Inspired by **Harold Budd**, **Brian Eno**, and the **Elta Solar 42n**.

**Platforms:** macOS · Windows · Linux · Web Browser (Desktop, iOS, Android)  
**Formats:** Audio Unit (AUv2) · VST3 · Standalone Desktop Application · Web Audio API

---

### 🌐 [🔊 Play Live in Your Browser (macOS · Windows · Linux · iOS · Android)](https://sneed-and-feed.github.io/)
*Zero installation, accounts, or plugins required. 100% client-side Web Audio API + Web MIDI engine in Safari, Chrome, Edge, and Firefox.*

### 🎛️ Native Plugins & Desktop Applications

| Platform | Distribution | Supported Formats | Quick Action / Build One-Liner |
| :--- | :--- | :--- | :--- |
| **macOS** | **Precompiled Binaries** (Universal M-Series & Intel) | AUv2 (`.component`) · VST3 · Standalone (`.app`) | [💾 Download `BRAUN_AS42-v1.3.6-macOS-Universal.zip` (22.7 MB)](https://github.com/sneed-and-feed/braun_as-42/releases/download/v1.3.6/BRAUN_AS42-v1.3.6-macOS-Universal.zip)<br>*(or [build from source](#build-macos))* |
| **Windows** | **Precompiled Binaries** | VST3 · Standalone (.exe) | [💾 Download `BRAUN_AS42-v1.3.8-Windows-x64.zip`](https://raw.githubusercontent.com/sneed-and-feed/sneed-and-feed.github.io/main/releases/BRAUN_AS42-v1.3.8-Windows-x64.zip) or [VST3 Only](https://raw.githubusercontent.com/sneed-and-feed/sneed-and-feed.github.io/main/releases/BRAUN_AS42-v1.3.8-VST3-Windows-x64.zip)<br>*(or [build from source](#build-windows))* |
| **Linux** | **Build from Source** (GCC/Clang) | VST3 · Standalone | `cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release` |

* **macOS (Apple Silicon ARM64 & Intel x86_64):** Precompiled release package ready to go. Download the `.zip` to extract `BRAUN_AS42.vst3` (for Ableton Live, Reaper, Bitwig), `BRAUN_AS42.component` (for Logic Pro & GarageBand), and `BRAUN_AS42.app` standalone desktop app (or build cleanly from source via standard CMake).
* **Windows x64:** Precompiled release package ready to go. Download the `.zip` to extract `BRAUN_AS42.vst3` (for Ableton, FL Studio, Reaper, Cubase, Bitwig) and `BRAUN_AS42.exe` standalone desktop app (or build cleanly from source via CMake).
* **Linux (Ubuntu, Debian, Fedora, Arch):** Builds cleanly from source via standard CMake with WebKitGTK, producing native VST3 (`.vst3`) and standalone binaries for Reaper, Bitwig, Ardour, and ALSA/JACK/PipeWire.

### 🌌 [🏛️ Sibling Reverb: BRAUN RB-26 Master Studio Reverberator](https://github.com/sneed-and-feed/braun_rb-26)
*Direct package-deal hardware sibling companion. Available on [**GitHub Releases**](https://github.com/sneed-and-feed/braun_rb-26/releases) (Universal macOS AU/VST3/CLAP, Linux VST3/CLAP, and precompiled [**Windows-x64.zip**](https://github.com/sneed-and-feed/braun_rb-26/releases/download/v1.4.1/BRAUN_RB26-v1.4.1-Windows-x64.zip)).*

---

## 🎹 Quick Start: How to Actually Play It

Whether you are auditioning in your web browser, tracking in Logic Pro on macOS, sequencing in Bitwig / Reaper on Linux, or producing in Ableton / FL Studio on Windows, the AS 42 is designed to let you make evocative ambient sound immediately:

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

### 1. Power On
Click the iconic orange **POWER ON** rocker switch at the top-right corner (or press any key) to initialize the audio engine and Web Audio context.

### 2. Play Melodic Chimes
* **Computer Keyboard (`A` through `K`, `L`, `;`, `'`):** Single-row keyboard keys map directly to the 11 harmonic modal scale degrees across octaves 3–5 (with `Z, X, C, V` providing deep bass chimes). Because every note is dynamically quantized to the active modal scale (e.g., *Budd Felt Pentatonic*, *Lydian Ambient*), **there are zero discordant notes**—every combination sounds resonant and consonant.
* **Click & Drag Glissando:** Click and sweep your mouse or finger horizontally across the ivory chime strip for an expressive harp or bell glissando.
* **Hardware MIDI Keyboard:** Connect any USB or Bluetooth MIDI controller. It is automatically detected via Web MIDI / DAW host MIDI with velocity sensitivity, pitch bend, and sustain pedal support.

### 3. Trigger Harold Budd Chord Voicings
* **Keys `1` through `9`, `0`, `-`, `=`:** Instantly voice 12 curated harmonic chord clusters (including `PAVILION SUS`, `PLATEAUX MAJ9`, `ETHEREAL 11TH`, and `LYDIAN CASCADE`).
* **STRUM Toggle:** Switch between `SLOW` (120ms gentle harp roll), `MED` (50ms), `FAST` (20ms), and `INSTANT` (simultaneous block chord) to shape how voices articulate over ambient beds.

### 4. Engage Hypnotic Drones
* Toggle **DRONE 1** and **DRONE 2** on to introduce an organic, microtonal underbed.
* Click the **Dieter Rams Quick-Snap** tuning buttons (`SUB BASS`, `DEEP TONIC`, `PERFECT 5TH`, `BEATING UNISON`) to lock into resonant intervals instantly without hunting.
* Turn on **MIDI TRACK** to have the drones automatically follow your piano chord root notes with smooth 40ms portamento and gentle release gating.

### 5. Start Eno's Generative Cloud
* Turn up the **GEN SPEED** dial—the Harold Budd Poisson point-process engine will begin dropping notes like gentle rain with organic, continuously shifting intervals.

### 6. Wash in Shimmer Reverb & Tape Delay
* Turn up **TAPE MIX** and **FEEDBACK** for warm polyrhythmic tape delay repeats with vintage wow and flutter.
* Turn up **SHIMMER MIX** to bloom chords into an octave-up (+12st) celestial cloud.
* Tap **SPACEBAR** at any point to lock the reverb loop into **INFINITE FREEZE**, suspending the ambient cloud forever while you improvise freely over top.

### 7. Instant Curated Presets (1-Click)
Instead of dialing in individual knobs, use the **PRESET** dropdown in the top toolbar to instantly morph the instrument between curated soundscapes:
* **HAROLD BUDD · PAVILION**: Intimate felt piano with soft una corda damping, acoustic hammer transient punch, warm wooden soundboard resonance, subtle tape wow, and floating celestial shimmer.
* **ENO · MUSIC FOR AIRPORTS**: Hypnotic sub-bass & beating-unison twin drones, slow Poisson generative rain, and lush octave-up shimmer reverb bloom (tap `SPACEBAR` when a voicing blooms to freeze it infinitely).
* **VANGELIS · CS-80 BRASS**: Rich dual-oscillator detuned brass timbre, fast chord strumming, warm ladder filter resonance, and expansive stereophonic tape delay.
* **CALIBRATED DEFAULT**: The balanced, canonical Dieter Rams baseline configuration.

*(Musicians can also save, export, and load unlimited custom JSON patches at any time via the **EXPORT** and **LOAD** buttons).*

---

## 📐 Technical Blueprint & Engineering Datasheet

Archival engineering documentation and CAD schematics designed in Dieter Rams' functionalist visual language (*"Weniger, aber besser"*).

<p align="center">
  <img src="images/BRAUN_AS42_Datasheet_EN.png" alt="BRAUN AS 42 Technical Datasheet (English Edition)" width="720" />
</p>

* **English Edition (International Standard):** [High-Res Master PNG (2000 × 2860, 300 DPI)](images/BRAUN_AS42_Datasheet_EN.png) · [Vector Blueprint SVG](images/BRAUN_AS42_Datasheet_EN.svg)
* **German Edition (Archival Original):** [High-Res Master PNG (2000 × 2860, 300 DPI)](images/BRAUN_AS42_Datasheet.png) · [Vector Blueprint SVG](images/BRAUN_AS42_Datasheet.svg)

---

## 1. Acoustic & DSP Architecture

The BRAUN AS 42 synthesizes three complementary ambient acoustic traditions into a cohesive tactile instrument:

### 1.1 Harold Budd: Playable Synth & "Soft Pedal" Felt Piano
* **Multisampled / Acoustic Blend Modeling (Teenage Engineering EP-1320 Style):** Emulates the rich, cohesive acoustic chord blending of multisampled acoustic instruments:
  * **Register-Dependent Acoustic Character:**
    * *Bass octaves 1–2:* Deeper sub-weight, heavier felt hammer thud (110–220 Hz impact), and slower string damping (long ringing resonance).
    * *Mid octaves 3–4:* Rich resonant spruce soundboard wooden body formant (~480–610 Hz peaking filter) and warm singing sustain.
    * *Treble octaves 5–6:* Brighter crystalline acoustic bell presence, snappy filter attack, and quicker decay.
  * **Natural Sympathetic String Resonance & Micro-Dispersion:** Subtle golden-ratio micro-detuning dispersion in cents (±1.4 cents) and overtone spreading across voices prevents synthetic comb-filtering or sterile clone phasing, causing chord clusters to coalesce into a singular acoustic body.
* **Waveform Select Toggles:** Select core timbre between **FELT** (intimate felt piano: sine + triangle overtone), **SINE** (crystalline acoustic chime / bell), **SAW** (band-limited warm analog synth brass/pad), and **SQR** (hollow vintage reed / pulse organ).
* **Felt Hammer Transient:** Soft physical impact of a felt-covered wooden hammer using an exponential pink-weighted noise burst passed through a resonant bandpass impulse resonator (zero GC allocation).
* **Steep Warm 24dB Damping:** Cascaded dual biquad lowpass filter mimicking Harold Budd's signature soft pedal (una corda) dampening. On strike, the cutoff opens quickly before exponentially decaying down to the fundamental with click-free voice stealing.
* **4x Anti-Aliased Saturation:** Internal soft clipper with 4x polyphase oversampling eliminates high-frequency digital foldover distortion.
* **Dynamic String Tail:** Low notes ring for 6–10 seconds, while high chime registers decay with crystalline clarity.

### 1.2 Brian Eno: Asynchronous Phase Loops & Shimmer Tape Diffusion
* **Music for Airports Tape Loops:** 4 asynchronous loop tracks running at coprime prime durations (13.7s, 17.3s, 21.1s, 26.9s). Because the periods are incommensurable, the melodic counterpoint continuously drifts and never repeats. Dynamic pitch readouts display active notes (e.g. C3, G4, E5, B5).
* **Anti-Clipping Stereo Tape Delay with Normalized Feedback & Input Headroom:** Polyrhythmic cross-coupled delay lines (3:2 stereo ratio, up to 3.5s) engineered for zero sporadic clipping, clicks, or pops:
  * **Normalized Feedback Loop Gain:** The tape saturation transfer curve slope ($k \approx 1.5173$ at $x = 0$) is normalized (`directFb = (feedback * 0.7) / shaperGain`, `crossFb = (feedback * 0.3) / shaperGain`). Circulating loop gain at linear signal levels strictly equals the user's feedback setting ($\le 0.92$), stopping runaway resonant buildup and flat-top waveshaper rail-clipping during heavy polyphonic playing.
  * **Calibrated Input Headroom Pad (`inputPad: 0.38`):** Summed delay line input is calibrated with -8.4 dB headroom. Even when maximum-velocity 6-voice polyphonic chords and twin drone voices are struck into the delay line with feedback at 92%, total circulating energy entering the waveshapers is strictly bounded below 1.0, eliminating Web Audio boundary hard-clipping and oversampling filter ringing.
  * **Butterworth Biquad Damping ($Q = 0.707$):** Tape head loss lowpass (3600 Hz) and DC blocking highpass (75 Hz) filters are clamped to $Q = 0.707$ ($1/\sqrt{2}$), eliminating +1.25 dB resonant peaking bumps in the feedback loop.
  * **Mechanical Wow & Flutter Headroom Clamping:** LFO modulation depth is dynamically constrained with an absolute safety floor (`Math.max(0.015, ...)`), guaranteeing delay time never drops into near-zero or negative boundaries, eliminating Doppler singularities and pitch clicks.
  * **Continuous Non-Scratchy Tape Time Turning:** 1ms continuous dial resolution, anchor fallbacks, and slew-rate smoothing eliminate zipper clicks and scratchiness when turning the knob during active playback.
  * **Dedicated Delay Return Compressor & 0 dB Soft Limiter:** Delay returns pass through a dedicated `delayReturn` bus with a fast-acting peak compressor (`delayReturnCompressor`: -6 dBFS threshold, 4:1 ratio) and a 4x oversampled soft-knee limiter (`makeLimiterCurve(2048, 0.78)` with exact 0 dB small-signal gain), protecting the master bus and shimmer reverb from transient overdriving without unintended gain boosting.
* **Octave-Up Shimmer Reverb Bloom:** Features an algorithmic high-diffusion reverb convolver with debounced RT60 tuning coupled with a clickless dual-delay real-time pitch shifter (+12 semitones / 2.0x frequency) in a feedback loop.
* **Infinite Ambient Freeze with Input Ducking:** Dual-delay recirculation locks to 0.992 gain with automatic input ducking and isolated output gating (no slapback echo leak when disengaged).
* **Isolated Send Bus Architecture:** Auxiliary effects run dry-isolated (`dryLevel: 0.0`) so the master bus receives pristine dry signal at unity without phase cancellation or limiter overdrive.

### 1.3 Elta Solar 42n: Microtonal Twin-Oscillator Drone Voices
* **Calibrated Output Volume Balancing:** Drone bus gain is calibrated to -8.5dB relative to the keys bus, ensuring the twin drones serve as a warm, lush, non-overpowering ambient underbed while piano chords and chime melodies sit distinctly on top with crystalline clarity.
* **Dynamic Piano Roll & MIDI Pitch Tracking:**
  * In addition to manual pitch knob operation, the drones dynamically follow notes played in the piano roll or MIDI keyboard.
  * *Drone 1 (Tonic):* Follows the played root note transposed into the deep sub/bass register ($32.7\text{ Hz} - 130.8\text{ Hz}$) with smooth 40 ms portamento frequency slewing (no sudden pops or jumps).
  * *Drone 2 (Harmony):* Tracks Drone 1 locked to the selected harmonic ratio (Unison, Sus 4th, Perfect 5th, Octave, Major 9th, 10th).
  * *Sample-Accurate Note-Off Gating:* When `MIDI TRACK` is active, releasing all MIDI notes (with sustain pedal released) initiates a smooth ~200ms anti-pop exponential release envelope that cleanly fades out the drones instead of droning forever. Striking a new note instantly re-opens the gate.
  * *MIDI TRACK Toggle:* A dedicated button (`MIDI TRACK ON` / `MIDI TRACK OFF`) in the header lets you alternate instantly between dynamic note tracking and classic static drone operation.
  * *Legato Fallback:* Releasing keys smoothly glides back to any remaining held notes.
* **Dieter Rams Quick-Snap Tuning Buttons:** Instant one-click microtonal and harmonic drone snapping without manual knob hunting:
  * *Voice 1 (Tonic):* **SUB BASS** (C1 / ~32.7 Hz), **DEEP TONIC** (C2 / ~65.4 Hz), **WARM ROOT** (C3 / ~130.8 Hz), **OCTAVE UP** (C4 / ~261.6 Hz).
  * *Voice 2 (Dominant / Harmony):* **PERFECT 5TH** (3:2 ratio), **SUS 4TH** (4:3 ratio), **MAJOR 9TH** (9:8 ratio), **BEATING UNISON** (unison with ~0.35 Hz acoustic beat offset).
  * Snap buttons automatically re-tune relative to active root note and modal harmony.
* **Twin Beatable Oscillators:** Voices 1 and 2 feature independent dual oscillators (Osc A & Osc B) with Saw, Square, Sine, Triangle, and Warm Analog core waveforms.
* **Continuous Sub-Hertz Beating Control:** Dedicated continuous Hz offset dial (0.00 to 5.00 Hz) and fine detune (cents) to create slow, hypnotic, organic acoustic interference waves.
* **West-Coast Wavefolder:** Multi-stage wavefolding transfer function ($y = \tanh(\sin(0.5\pi D x) - F \sin(1.5\pi D x))$) folding waveform peaks inward with 4x oversampled anti-aliasing.
* **4-Pole Resonant Ladder Lowpass Filter:** Dual cascaded biquad filters with resonance up to self-oscillation and slow breathing LFO drift.

### 1.4 Cross-Platform Webview GUI Architecture & DAW Integration (AU / VST3 / Standalone)

The BRAUN AS 42 is engineered as a unified cross-platform hybrid instrument combining an ultra-low-latency, hard real-time C++20 DSP engine with hardware-accelerated web UI rendering. Rather than bundling bloated embedded Chromium distributions (such as Electron or CEF), the plugin embeds each operating system's native GPU-accelerated webview via JUCE 8's `WebBrowserComponent`:

* **Unified Native Webview Implementations:**
  * **macOS (Apple WKWebView):** Built with Apple's native `WKWebView` under AppKit / Cocoa with Metal GPU acceleration. Requires zero external runtime downloads, extra libraries, or third-party webview packages.
  * **Linux (WebKitGTK):** Integrates the distribution-native `WebKitGTK` runtime (`webkit2gtk-4.0` / `webkit2gtk-4.1`) under X11 and Wayland compositors for lightweight, responsive GTK surface presentation.
  * **Windows (Microsoft WebView2):** Embeds Microsoft's evergreen Edge/Chromium runtime using DirectComposition hardware rendering.
  * **Web Browser (Universal Zero-Install):** Runs 100% client-side across all modern desktop and mobile browsers (macOS Safari, Windows Edge/Chrome/Firefox, Linux Chromium/Firefox, iOS Safari/Brave, Android) with Web Audio API + Web MIDI API support.

* **Target Formats & Host DAW Compatibility:**
  * **macOS (Audio Unit, VST3, Standalone):**
    * Universal Binary compilation for Apple Silicon (M1, M2, M3, M4 / ARM64) and Intel (x86_64).
    * Audio Unit (AUv2) automatically compiles `BRAUN_AS42.component` for seamless integration in **Logic Pro**, **GarageBand**, and **Studio One**.
    * VST3 (`BRAUN_AS42.vst3`) and Standalone (`BRAUN_AS42.app`) for **Ableton Live**, **Reaper**, **Bitwig Studio**, and **Cubase**.
  * **Linux (VST3, Standalone):**
    * Native 64-bit and ARM64 VST3 (`BRAUN_AS42.vst3`) and Standalone binary for **Reaper**, **Bitwig Studio**, **Ardour**, and JACK/PipeWire/ALSA setups.
  * **Windows (VST3, Standalone):**
    * 64-bit VST3 (`BRAUN_AS42.vst3`) and Standalone executable (`BRAUN_AS42.exe`) for **Ableton Live**, **FL Studio**, **Reaper**, **Cubase**, and **Bitwig Studio**.

* **Platform Compositing & Window Management Notes:**
  * *macOS:* Hosted in an `NSView` layer-backed hierarchy with automatic HiDPI Retina scale factor synchronization and native macOS window drag behavior.
  * *Linux:* Rendered into standard GTK window surfaces with native X11 / Wayland surface scaling and composited buffer presentation.
  * *Windows:* Employs an opaque surface (`setOpaque(true)`) to eliminate 32-bit alpha compositing overhead in Windows Desktop Window Manager (DWM) and FL Studio. Win32 HWND hierarchy clipping enforces `WS_CLIPCHILDREN | WS_CLIPSIBLINGS` with `SetWindowPos(..., SWP_FRAMECHANGED)` across plugin and child WebView2 windows to prevent drag artifacts, and background window throttling hooks are disabled to avoid message queue latency.

* **Hard Real-Time Audio Safety (All Platforms):**
  * **0 Dynamic Memory Allocations:** Audio processing (`processBlock()`) allocates strictly 0 bytes of heap memory during real-time playback.
  * **0 Mutexes / Locks:** Audio thread never locks or waits on UI threads.
  * **Lock-Free Telemetry Ring Buffers:** Single-producer single-consumer (SPSC) lock-free FIFO visualizer queues stream 60fps CRT oscilloscope and FFT telemetry to the UI with zero audio thread contention.
  * **Hardware Denormal Flushing:** `ScopedNoDenormals` RAII guards enable Flush-To-Zero (FTZ) and Denormals-Are-Zero (DAZ) across both x86/x64 (SSE) and ARM64 (NEON).
  * **Batched CRT Vector Graticule & Idle Silence Throttling:** Oscilloscope automatically steps down to 5 FPS when idle, saving host CPU cycles in dense DAW arrangements.
  * **Atomic APVTS Parameter Synchronization:** Direct atomic parameter binding prevents logarithmic curve skew, and boots without clobbering saved DAW project parameters.

* **Default Plugin Installation Directories:**
  * **macOS Audio Unit (AU):**
    ```text
    ~/Library/Audio/Plug-Ins/Components/BRAUN_AS42.component
    ```
  * **macOS VST3:**
    ```text
    ~/Library/Audio/Plug-Ins/VST3/BRAUN_AS42.vst3
    ```
  * **Linux VST3:**
    ```text
    ~/.vst3/BRAUN_AS42.vst3
    ```
  * **Windows VST3:**
    ```text
    C:\Program Files\Common Files\VST3\BRAUN_AS42.vst3
    ```

---

## 2. Foolproof Harmonic Interface for Non-Theorists

Designed for musicians who create intuitively by ear without formal music theory:
* **Curated Modal Spaces:**
  * `Budd Felt Pentatonic` (Major pentatonic with no harsh tritones — everything sounds tranquil and consonant)
  * `Lydian Ambient` (Brian Eno floating celestial mood with raised 4th / #11)
  * `Dorian Mystic` (Melancholic, contemplative modal mood)
  * `Kankyo Ongaku` (Hiroshi Yoshimura Japanese environmental post-card pentatonic)
  * `Aeolian Midnight` (Deep nocturnal natural minor)
  * `Budd Hexatonic` (Harold Budd signature open chord spacing with singing 4th)
  * `Weightless Whole Tone` (Dreamlike suspension)
* **Real-time Scale Quantizer:** Any key pressed or generative trigger is quantized to the active harmonic mode.
* **Harold Budd Chord Cluster Macros:**
  * **PAVILION SUS:** Open suspended 1 - 5 - 9 - 10 voicing.
  * **PLATEAUX MAJ9:** Lush felt piano major 9th spread.
  * **DEEP DRONE 5TH:** Wide spatial fifths and octaves.
  * **ETHEREAL 11TH:** Brian Eno celestial shimmer voicing (1 - 5 - 7 - 9 - 11 - 15ma) with luminous Major 7th and high octave bloom.
  * **LYDIAN CASCADE:** Sparkling #11 cluster.
  * **SOLAR BEATING:** Microtonally detuned acoustic beating stack.
* **Harold Budd Poisson Auto-Evolve Engine:** Simulates organic contemplative piano playing where notes fall like rain droplets with inter-onset intervals following an exponential Poisson distribution:
  $$\Delta t = -\frac{\ln(1 - U)}{\lambda}$$

---

## 3. Dieter Rams / Braun Industrial Design

* **"Weniger, aber besser" (Less, but better):**
  * Clean, geometric Swiss typography with generous tracking.
  * Matte anodized aluminum chassis (`#ECEBE4`) and toggleable Braun dark anthracite finish (`#18191B`).
  * Iconic Braun signal orange (`#EE592B`) master switch and accent LEDs.
  * Machined aluminum rotary knobs with radial indicator ticks, precision drag sensitivity (holding `Shift` engages 10x micro-tuning), mouse wheel support, and double-click direct numerical entry.
* **Vector CRT Phosphor Display:**
  * 60fps canvas oscilloscope with phosphor persistence afterglow decay and analog zero-crossing edge trigger stabilization.
  * 3 operational modes: **OSC** (Time-domain waveform trace), **FFT** (Spectral bar analyzer), and **XY PHASE** (Lissajous stereo goniometer).
* **Lossless Studio WAV Recorder:**
  * Direct 16-bit 48kHz PCM WAV audio capture from the master bus with isolated zero-gain sink (no buffer delay feedback).
  * One-click download of studio-quality uncompressed WAV recordings of ambient sessions.
* **1-Click JSON Patch Management (Export & Load):**
  * Dedicated Dieter Rams style **EXPORT** and **LOAD** button pair located on the top bar in the utility group alongside **RESET ALL** and **RECORD WAV**.
  * Exports complete `BRAUN_AS42_PATCH` JSON files named `AS-42 Preset [ID].json` (e.g. `AS-42 Preset BUDD_PENTATONIC-2026-09-08-16-50-00.json`) capturing all 32 rotary knobs, root pitch, modal scale, concert pitch reference (432 Hz / 440 Hz), felt piano timbre (including CS-80), dual drone oscillator waveforms, quick-snap tuning modes, and vector pad coordinates.
  * Instant client-side file reading (`.json`) restores all synthesizer sound engines and UI controls smoothly without audio dropouts or vector pad clobbering, making backing up, restoring, and sharing custom patches effortless.
* **Responsive Tablet & Multi-Touch Performance Architecture:**
  * Native momentum vertical scrolling across iPadOS (Safari, Brave) and Android tablets (Blink, Samsung Internet, Gecko).
  * Precision touch disambiguation: Rotary dial dragging is isolated to `.braun-knob-assembly`, allowing touches on parameter labels, value readouts, and section margins to cascade into smooth vertical page scrolling.
  * Ergonomic Dieter Rams sub-panel organization splitting Brian Eno effects into semantic Tape Delay (5-knob cluster) and Shimmer Reverb (4-knob cluster) modules.
  * Dedicated high-definition interface documentation:
    * [iPadOS Landscape (Full Dashboard)](images/braun_tablet_ipad_landscape_full.png) · [Landscape View & FX Panels](images/braun_tablet_ipad_landscape_view.png)
    * [iPadOS Performance Deck & Chime Strip](images/braun_tablet_ipad_performance_deck.png) · [iPadOS Portrait View](images/braun_tablet_ipad_portrait.png)
    * [Android Tablet 16:10 Aspect Ratio View](images/braun_tablet_android_16_10.png)

---

## 4. Getting Started & Running Locally

### Option A: Standard Cross-Platform Terminal (`npm start`)
Works out of the box on **macOS**, **Linux**, and **Windows**:

1. **Start the local server:**
   ```bash
   npm start
   # or: node server.js
   # or: python3 -m http.server 3000
   ```
2. **Open in your web browser:**
   ```text
   http://localhost:3000
   ```
3. **Turn on the instrument:** Click the orange **POWER ON** rocker switch at the top right to start the Web Audio API context.

### Option B: Quick Desktop Launch Scripts
One-click launch scripts are provided for all operating systems:
* **macOS & Linux:**
  ```bash
  ./start.sh
  # or: ./run.sh
  ```
* **Windows:** Double-click `start.bat` (or `run.bat`)

Both scripts verify your local environment (Node.js or Python fallback), launch the local static web server, and open `http://localhost:3000` in your default web browser automatically.

### Option C: Native Multi-Platform Plugin & Standalone Build (CMake)
<a id="option-c-native-multi-platform-plugin--standalone-build-cmake"></a>
<a id="build-from-source"></a>

Build the native C++20 plugin (AUv2, VST3) and standalone desktop application directly from source on **macOS**, **Linux**, or **Windows**:

1. **Prerequisites:**
   * CMake 3.22 or higher
   * C++20 compliant compiler:
     * **macOS:** Xcode Command Line Tools (`clang++`)
     * **Linux:** GCC 11+ or Clang 14+ (`sudo apt install build-essential cmake libwebkit2gtk-4.1-dev libasound2-dev libjack-jackd2-dev`)
     * **Windows:** Visual Studio 2022 (MSVC with "Desktop development with C++")
   * Git (FetchContent automatically fetches and configures JUCE 8.0.6)

2. **One-Liner Build Commands by Operating System:**

   <a id="build-macos"></a>
   * **macOS (Universal AUv2 + VST3 + Standalone App):**
     ```bash
     cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" && cmake --build build --config Release
     ```
     *(Builds universal Apple Silicon ARM64 + Intel x86_64 binaries. Generates AU `.component`, VST3 `.vst3`, and standalone `.app`)*

   <a id="build-linux"></a>
   * **Linux (VST3 + Standalone App):**
     ```bash
     cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release
     ```
     *(Builds 64-bit VST3 plugin and native standalone executable using WebKitGTK)*

   <a id="build-windows"></a>
   * **Windows (VST3 + Standalone Exe):**
     ```bash
     cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release
     ```
     *(Automatically provisions Microsoft WebView2 package and builds 64-bit VST3 and standalone `.exe`)*

3. **Output Artefacts & Destination Folders:**
   * **macOS:**
     * **Audio Unit (AUv2):** `build/BRAUN_AS42_artefacts/Release/AU/BRAUN_AS42.component`  
       *(Install to `~/Library/Audio/Plug-Ins/Components/`)*
     * **VST3:** `build/BRAUN_AS42_artefacts/Release/VST3/BRAUN_AS42.vst3`  
       *(Install to `~/Library/Audio/Plug-Ins/VST3/`)*
     * **Standalone App:** `build/BRAUN_AS42_artefacts/Release/Standalone/BRAUN_AS42.app`
     * *(Optional AU validation):* `auval -v aumu As42 Brun`
   * **Linux:**
     * **VST3:** `build/BRAUN_AS42_artefacts/Release/VST3/BRAUN_AS42.vst3`  
       *(Install to `~/.vst3/`)*
     * **Standalone Binary:** `build/BRAUN_AS42_artefacts/Release/Standalone/BRAUN_AS42`
   * **Windows:**
     * **VST3:** `build/BRAUN_AS42_artefacts/Release/VST3/BRAUN_AS42.vst3`  
       *(Install to `C:\Program Files\Common Files\VST3\`)*
     * **Standalone Exe:** `build/BRAUN_AS42_artefacts/Release/Standalone/BRAUN_AS42.exe`

### Keyboard Shortcuts & Gestures
* **A, S, D, F, G, H, J, K, L, ;, ':** Play the 11 modal scale degrees on the serene single-row harmonic chime strip (spanning octaves 3 through 5, click-free with key repeat protection and continuous hold sustain). Additional bass chime shortcuts `Z, X, C, V` are also supported.
* **Click & Drag Glissando:** Slide finger or mouse horizontally across chime keys for expressive harp/chime glissandi. Each entered key articulates expressively with velocity sensitivity while smoothly releasing previous sounding notes. Holding in place maintains continuous pedal sustain until mouse release.
* **1 to 9, 0, -, =:** Trigger Harold Budd Chord Cluster Macros (12 curated modal voicings with hold sustain).
* **STRUM Speed Switch (SLOW · MED · FAST · INSTANT):** 4-position hardware toggle switch controlling the chord cluster trigger speed (`SLOW` [120ms strum], `MED` [50ms strum], `FAST` [20ms strum], and `INSTANT` [0ms simultaneous block]). Designed in accordance with Dieter Rams principles to prevent abrupt chord disruption over slower ambient drones.
* **Spacebar:** Toggle Infinite Reverb Freeze.

---

## 5. Verification & Testing

[![Verification Status](https://img.shields.io/badge/Verification-100%25%20PASS-brightgreen?style=flat-square&logo=checkmarx&logoColor=white)](VERIFICATION_CHECKLIST.md)
[![Tests Passing](https://img.shields.io/badge/Tests-514%20PASS%20(454%20Web%20%2B%2060%20C%2B%2B)-success?style=flat-square&logo=node.js&logoColor=white)](VERIFICATION_CHECKLIST.md)

The project maintains comprehensive verification across both JavaScript Web Audio and native C++ DSP pipelines. Full specification benchmarks, mathematical proofs, and known limitations are documented in the [**Reproducible Verification Checklist (VERIFICATION_CHECKLIST.md)**](VERIFICATION_CHECKLIST.md).

### 5.1 Reproducible Verification Checklist & DSP Benchmarks

Reproduce all standalone verification criteria and complete test suites locally:

```bash
# 1. Run the standalone verification checklist harness (< 250ms execution time)
npm run verify:checklist

# 2. Run the complete Node.js Web Audio & MIDI automated test suite (454 tests)
npm test

# 3. Run combined checklist and audio math regression tests
npm run verify:all
```

#### Certified DSP Benchmark & Engineering Matrix
* **Verification Status:** **100% PASS** (454/454 tests in Node.js test harness + 60/60 native C++ suites = 514/514 total, 0 memory leaks, 0 NaN/Inf, 0 denormals).
* **Supported Sample Rates:** **44.1 kHz, 48.0 kHz, 88.2 kHz, 96.0 kHz, 176.4 kHz, 192.0 kHz** (Web Audio API & native VST3/AU/Standalone C++ DSP).
* **CPU Utilization Benchmarks:** Lightweight client-side Web Audio synthesis, 6-voice polyphony + twin drone oscillators **< 2.5% CPU** on modern browsers (Chrome, Safari, Firefox, Edge); native C++ DSP engine consumes **< 0.8% single-core CPU**.
* **Latency Profile:** **0 samples** algorithmic latency; instant keypress/MIDI response (< 5ms buffer delay).
* **Parameter Smoothing & De-Clicking:** Click-free voice allocation (5ms de-click ramp), exponential damping envelopes ($t_{\text{rel}} = 0.10\text{s} + 0.32\text{s} \times (\text{relScale})^{1.35}$ spanning 0.14s–1.84s), and Butterworth biquad damping ($Q = 0.7071$).
* **Preset Compatibility & Serialization:** Lossless `BRAUN_AS42_PATCH` JSON export/load schema validating all 32 parameters across Calibrated Default, Harold Budd Pavilion, Eno Airports, and Vangelis CS-80.
* **Anti-Clipping & Dynamic Headroom:** Calibrated input headroom pad ($-8.4\text{ dB}$ / `inputPad: 0.38`), normalized tape feedback loop gain ($\le 0.92$), and 4x polyphase oversampled wavefolder soft-knee limiter (`makeLimiterCurve`).
* **Modal Scale Tuning & Microtonal Tracking:** 11 harmonic scales with 100% consonant quantization, 11-key single-row chime strip (`KeyA` through `Quote`), and dynamic MIDI pitch tracking with 40ms portamento and 200ms anti-pop gating.
* **Documented Known Limitations:** Web Audio autoplay policy requires user gesture (orange POWER switch or initial keypress), Web MIDI API requires secure origin (HTTPS/localhost) and user permission prompt, and mobile iOS Safari suspends audio in background tabs.

See [**`VERIFICATION_CHECKLIST.md`**](VERIFICATION_CHECKLIST.md) for full engineering datasheets and reproducible test criteria.

### 5.2 JavaScript Audio & MIDI Suite
```bash
npm test
```
* **459 unit and integration tests across 98 test suites** running via Node.js native test runner (0 failures).
* Validates voice de-duplication, Web MIDI parsing, pitch bend decoding, sustain pedal latching, voice stealing, scale quantizers, Poisson point process distributions, phase loop engines, Fourier series anti-aliasing tables, pitch shifter crossfades, freeze gating, wavefolder transfer curves, full-width CRT oscilloscope edge-to-edge drawing, 48-bar FFT spectrum, iPadOS WebKit/Brave momentum vertical scrolling, rotary knob touch disambiguation, responsive tablet layout across iOS and Android (16:10 / 4:3), and anti-clipping bus headroom staging.

### 5.3 Native C++ DSP & Real-Time Safety Tests
* **DSP Unit Tests (`test/cpp/dsp_tests`):** 43 passed, 0 failed. Validates biquad state preservation across zero-crossings, voice stealing pitch locks, Hermite limiter bounds, tape saturation feedback stability, voice allocation, pitch tracking, note-off gating with mid-release retriggering, oscilloscope visualizer ring buffer bounds, and mathematical invariance of DSP optimizations.
* **Adversarial Stress Tests (`test/cpp/challenger_stress_tests`):** 10 passed, 0 failed. Verifies block sizes from 32 to 2048, multiple sample rates (44.1k to 192k), 22-parameter rapid sweeps, polyphonic voice stealing race conditions, and **0 heap allocations / 0 bytes allocated** during real-time `processBlock()`.
* **Adversarial Challenge Suite (`test/cpp/adversarial_challenge_suite`):** 11 passed, 0 failed. Confirms zero NaNs, Infinities, or denormals; DC offset bounded below 0.00025; and continuous voice stealing fades.
* **Asset & MIME Integrity Audit (`node test/web-assets-and-mime-stress.mjs`):** 18/18 embedded web assets verified against SHA-256 hashes, zero MIME type resolution errors, and 22-parameter bidirectional APVTS roundtrip verified.

---

## 6. What's New in v1.3.8

* **Sub-Bass Freeze Trapped Feedback Loop Elimination:**
  * Resolved critical DSP feedback bug where freezing in sub-bass drone mode (Voice 1 C1 ~32.7 Hz with 1.70x volume boost) accumulated resonant standing waves in the recirculating freeze delay lines (`freezeDelayL` 0.387s / `freezeDelayR` 0.491s), trapping the user in an endless sub-bass roar.
  * **Dedicated 75 Hz Sub-Bass Roll-off:** Inserted 2-pole Butterworth 75 Hz highpass filtering (`freezeInputHpFilter` and `freezeSubCutFilterL/R`) on freeze input and inside the cross-coupled recirculation matrix, completely eliminating subsonic energy accumulation while preserving dual 25 Hz DC blockers.
  * **Freeze Loop Soft Limiting:** Added smooth C1 soft limiter bounding maximum recirculating energy $\le 0.88$ (strictly below 0 dBFS digital full scale).
  * **Contractive Feedback Bounding:** Capped freeze feedback target to 0.982 (strictly contractive, down from 0.992).
  * **Rapid & Reliable Unfreeze Quench:** Replaced sluggish slow release with instant in-flight cancellation (`cancelAndHoldAtTime`), input ducking, and rapid decay strictly silenced ($\le 0.0$) within 50 ms.
  * **Clean Panic & Reset Integration:** Connected freeze quenching directly into `AudioEngine.releaseAllNotes()` and `AudioEngine.panic()`.
* **Master Verification Suite:**
  * Certified all 529 automated tests (100% pass) including new regression suite `test/sub-bass-freeze-safeguard.test.js`.

---

## 7. What's New in v1.3.7

* **Rotary Knob NaN Angle & Drag Remediation:**
  * Restored `this.startAngle = -140;` in `js/ui/knob.js` constructor, fixing broken `angleRange` evaluation (which had evaluated to NaN).
  * Rotary dials now render at their exact rotation angles with smooth SVG arc tracks and full mouse/touch drag functionality across all 32 parameters.
* **Robust Windows Native UI Transition (Zero Window Corruption):**
  * Eliminated destructive `EnumChildWindows` calls and `SetWindowLongPtr` style manipulations in `PluginEditor.cpp` that previously corrupted the main application and DAW wrapper windows.
  * Retained `webComponent` as a permanent child component of `PluginEditor` (eliminating `removeChildComponent`), collapsing its bounds to `(0, 0, 0, 0)` and setting `setVisible(false)` and `toBack()` in Native Mode.
  * When collapsed and hidden, WebView2 automatically minimizes occlusion and `WS_CLIPCHILDREN` clips zero pixels from the parent canvas, ensuring native JUCE vector graphics render completely unobstructed without tampering with host window styles.
* **Master Verification Suite:**
  * Added unified `tests/verify.mjs` test runner certifying all 523 tests across the entire test suite with 100% pass rate.

---

## 7. What's New in v1.3.6

* **Runtime Native UI Occlusion Fix (Zero Black Screen):**
  * Fixed WebView2 HWND occlusion bug where switching from Web UI to Native JUCE mode left the child Win32 `Chrome_WidgetWin_0` window occluding the peer window.
  * Corrected detachment ordering in `setNativeMode(true)`: bounds are zeroed and visibility set to false before detaching from peer, child windows are explicitly hidden (`SW_HIDE`), and `WS_CLIPCHILDREN` is safely removed from the parent peer HWND so JUCE's native Dieter Rams vector rendering is never clipped.
  * When switching back to Web UI (`setNativeMode(false)`), child windows and `WS_CLIPCHILDREN` styles are cleanly restored.
* **DAW Host Context Menu Parity (`showNativeMenu`):**
  * Parameter right-clicks now query the DAW host context (`getHostContext()->getContextMenuForParameter(param)->showNativeMenu(localPos)`), presenting native automation lanes, MIDI learn, and modulation assign menus in Reaper, Ableton Live, FL Studio, and Cubase.
  * Standalone execution and unsupported hosts cleanly fall back to Dieter Rams popup menus with Default/Min/Max reset and direct exact numeric entry.
  * Added `showContextMenu` IPC event bridge between Web UI and C++ editor, extending host DAW context menu access to Web UI controls.
* **Release Artifact & Build Infrastructure:**
  * Synchronized version bump to v1.3.6 across CMake, Node.js packages, HTML scripts, and verification suites.

---

## 8. What's New in v1.3.5

* **Native UI WebView2 Occlusion Elimination:**
  * Removed legacy Win32 child window visibility toggle (`setChildHwndsVisible` / `EnumChildWindows(..., SW_HIDE)`), resolving the persistent black-screen bug when switching between Web UI and Native UI modes.
  * Replaced window handle manipulation with clean JUCE component hierarchy management: `removeChildComponent(&webComponent)` when activating Native mode, and `addAndMakeVisible(webComponent)` when restoring Web mode.
  * Collapsed `webComponent.setBounds(0, 0, 0, 0)` in Native mode to guarantee zero window occlusion or input interception over native UI controls.
* **DAW Host Parameter Context Menu & Automation Parity:**
  * Integrated `getHostContext()->getContextMenuForParameter(param)` into `BraunKnob::showKnobContextMenu` alongside Dieter Rams preset values and direct text entry.
  * Provides first-class DAW automation envelopes, parameter assignment, and MIDI learn popup menus across Ableton Live, FL Studio, Reaper, Bitwig, Cubase, and Studio One.
  * Extended to Web UI via synchronized bidirectional parameter bindings.
* **Multi-Platform Test Verification:**
  * Certified 100% pass rate across all 523 automated assertions (459 Node.js tests across 98 suites, 43 DSP tests, 10 challenger stress tests, and 11 adversarial tests).

---

## 9. What's New in v1.3.4

* **Cross-Platform Compiler Optimization Parity:**
  * Strict parity across toolchains with aggressive real-time performance flags: `/O2 /fp:precise /arch:AVX2` on MSVC, and `-O3 -Wall -Wextra` on Clang/GCC with IEEE-754 NaN/Inf safety and deterministic floating-point precision.
* **Sub-Bass DSP Stabilization Formalization:**
  * 6-pillar pipeline featuring phase-locking, DC-blocking (15Hz highpass), stereo monofication (pan = 0), Butterworth damping ($Q = 0.7071$), 140Hz lowpass ceiling, and monotonic soft-knee saturation with +4.6dB gain trim.
  * Click-free 25ms Hann crossfade dip on mode switching for seamless sonic transitions without transient thump.
* **Predictable Polyphonic Voice-Stealing Architecture:**
  * 4-tier hierarchical allocation lifecycle (`Inactive` -> `Released` -> `Pedal-Latched` -> `Physically Held`).
  * `VoiceStealPolicy` framework (default `OldestNoteFirst`), double-strike elimination (`mHammerPending`), and sustain pedal churn resilience (`releasePedalLatchedVoices`).
* **"RESET ALL" Preset Preservation:**
  * Recalibrates all 32 knobs, vector coordinates, and freeze status to the active preset or custom patch instead of forcing default, protecting sound design sessions.

---

## 10. What's New in v1.3.3

* **Full Uncompressed Default Viewport (1240x780):**
  * Default window opens in full uncompressed side-by-side view (1240x780, matching `.braun-chassis` max-width) with resizable bounds (`960x600` to `2560x1440`).
* **Complete C++ JUCE Native Presentation Layer (`BraunLookAndFeel`):**
  * Hardware-accelerated Dieter Rams functionalist UI rendering with 38 APVTS parameter rotary sliders, buttons, and combo boxes.
  * Native DAW host context menu support for parameter automation, MIDI learn, and automation envelopes in Ableton Live, FL Studio, Reaper, Cubase, and Bitwig.
* **Real-Time Vector CRT Oscilloscope & Level Meters:**
  * 48 kHz phosphor vector waveform visualizer and stereo RMS peak level meters with hardware power indicator and MIDI activity monitors.
* **Persistent Dual-Mode GUI Switching:**
  * Seamless runtime switching between Web UI and Native DAW UI (`UI: NATIVE / WEB`), with state persistently saved to `%APPDATA%/Braun/AS42_settings.xml`.
* **Context Menu Hardening:**
  * Right-click Chromium/Edge context menu suppression in Web view to eliminate inadvertent developer tool popups during performance.

---

## 11. What's New in v1.3.2

* **Elimination of Web Audio Transient Click Discontinuity:**
  * Resolved 1-sample rectangular impulse spike caused by idle `AudioParam.value` persistence in WebKit/Chromium re-triggering stale gain values.
  * Idle voices strictly anchor at `0.0` with full `_hammerEndTime` lifecycle tracking, preventing stale gain resurrection.
* **Warm Wooden Modal Soundboard & Velvety Felt Transient Synthesis:**
  * Replaced synthetic white noise with a physically-modeled ~135 Hz damped wooden soundboard modal impulse blended with 2-pole lowpass-filtered Brownian felt texture.
  * Tightened hammer lowpass filter transition to a 0.5 ms time constant (`setTargetAtTime(hammerCutoff, cancelTime, 0.0005)`), locking cutoffs instantly before the transient peak.
* **Browser Cache Busting:**
  * Updated web deployment with module versioning (`app.js?v=1.3.2`) to prevent stale browser disk caching.

---

## 12. What's New in v1.3.1

* **Acoustic Hammer Transient Decoupling & Tactile Punch:**
  * Rerouted hammer impact burst around the string attack amplitude envelope directly into the piano soundboard peaking formant filter, eliminating severe envelope attenuation and increasing transient punch ~4x (+11.3 dB).
  * Retuned acoustic register multipliers (Bass: `3.20`, Mid: `2.80`, Treble: `2.00`) and widened bandpass $Q$ to `1.2` for warm, physical wooden thud at high hammer settings while keeping zero impact at minimum.
* **Continuous Acoustic Decay & Dynamic Release Scaling:**
  * Dynamic release time formula: $t_{\text{rel}} = 0.10\text{s} + 0.32\text{s} \times (\text{relScale})^{1.35}$, spanning ~0.14s (tight staccato at `0.2x`) to ~1.84s (long singing sustain tail at `3.5x`).
  * Implemented real-time voice decay updates (`updateDecay`) on both C++ and Web Audio engines so adjusting the decay dial immediately affects currently held and ringing notes.
  * Expanded UI decay knob boundaries from `[0.5, 2.5]` to `[0.2, 3.5]` and widened internal filter decay clamps to `[0.2, 3.5]`.
* **Soundboard Circulation & Sympathetic Resonance Bloom:**
  * Implemented 512-sample circular soundboard feedback loop (~10.6 ms) with soft-clipped circulation and a 250 ms resonance tail counter, ensuring natural acoustic bloom after notes are released instead of premature cutoff.
* **Host IPC Bridge Hardening:**
  * Added fallback alias mappings in `PluginEditor.cpp` for `feltHammer`, `hammer`, `feltDecay`, `decay`, `feltTone`, `tone`, `feltSymp`, and `sympathetic`.

---

## 13. What's New in v1.3.0

* **DSP Numerical Stabilization & Thread Safety:**
  * Implemented `ScopedNoDenormals` RAII hardware guards enabling Flush-To-Zero (FTZ) and Denormals-Are-Zero (DAZ) on x86/x64 and ARM64.
  * Corrected biquad filter state reset to eliminate micro-clicks at zero-crossings during dynamic cutoff modulation.
  * Atomic APVTS reset requests (`resetRequested`) ensure thread-safe preset synchronization without stalls.
* **Pitch-Preserving Voice Stealing:**
  * Voice pitch is preserved during the 5ms exponential declick fade-out rather than abruptly jumping to new note frequencies, eliminating pitch-snap artifacts during rapid polyphonic playing.
* **Acoustic Refinement & DC Elimination:**
  * Relocated 15 Hz highpass DC blocker before the master compressor, reducing limiter pumping from 4.55 dB down to 0.01 dB.
  * Added DC-blocking highpass filters to shimmer reverb freeze loops to prevent runaway DC bias accumulation.
  * Balanced Hadamard matrix stereo decorrelation ($kOppScale = \sqrt{2} - 1 \approx 0.4142$) preserves mono downmix phase without comb cancellation.
  * Sample-rate-aware `OnePoleSmoother` filters eliminate parameter zipper noise across tape delay times, feedback, tone cutoffs, and wet/dry mix.
* **Non-Breaking Performance Optimizations:**
  * Replaced redundant transcendental calculations with the triple-angle identity $\sin(3\theta) = \sin\theta(3 - 4\sin^2\theta)$ (**34.3% CPU reduction** in hot wavefolder loops with bit-exact $C^1$ smoothness).
  * Precomputed FDN decay multipliers in shimmer reverb, saving 384,000 `exp()` calls per second.
  * Replaced modulo arithmetic in tape delay circular buffers with power-of-2 bitwise masking (**11.2% speedup**).
  * Compact active-voice bitmask traversal skips silent voices during polyphonic rendering.
  * Zero-copy `Int16Array` view pooling in `engine.js` eliminates garbage collection spikes during WAV recording.
  * Cached DOM element selectors in visualizer loops eliminate 60fps layout thrashing.
* **Expanded Verification:**
  * Test coverage expanded to 459 Web Audio tests and 64 native C++ tests (523 total tests passing with 0 failures).
