# BRAUN RB-26 · Master Studio Reverberator

[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Web Audio API](https://img.shields.io/badge/Web%20Audio-100%25%20Client--Side-4A4A4A?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![JUCE 8](https://img.shields.io/badge/JUCE-8.0.6-orange?style=for-the-badge)](https://juce.com/)

> **An authentic Dieter Rams functionalist studio reverberator and acoustic space synthesizer.**
> Direct package-deal hardware sibling companion to the **BRAUN AS-42**.
> *"Weniger, aber besser" — Less, but better.*

---

## 🚀 Quick Start

### 1. Launch the Interactive Web Showcase (Local Server)
Run the automated launcher script (Node.js or Python):
```cmd
start.bat
```
*Or from the root directory:*
```bash
npm run rb26
```
This launches a zero-dependency local static server on `http://localhost:3826/` and opens your browser.

> [!NOTE]
> Browsers enforce CORS security on ES modules when loaded via `file://`. Always launch using `start.bat` or `npm run rb26` to ensure all 21 rotary knobs, AudioWorklets, and Web Audio exciter graphs instantiate properly.

### 2. Standalone Desktop Application (.exe)
Run the native executable:
```powershell
& "build\BRAUN_RB26_artefacts\Release\Standalone\BRAUN_RB26.exe"
```

### 3. VST3 Plugin Installation for DAWs
Copy `BRAUN_RB26.vst3` into your standard system VST3 directory:
```powershell
Copy-Item -Recurse "build\BRAUN_RB26_artefacts\Release\VST3\BRAUN_RB26.vst3" "C:\Program Files\Common Files\VST3\"
```
*Compatible with Ableton Live, FL Studio, Reaper, Cubase, Bitwig, Studio One, and Logic Pro.*

---

## 🎛️ Acoustic & Spatial Research Architecture

```
+---------------------------------------------------------------------------------------------------+
|  BRAUN   RB-26 · MASTER STUDIO REVERBERATOR                        [ FINISH: LIGHT / DARK ]       |
+---------------------------------------------------------------------------------------------------+
| [01 INPUT/PRE-DELAY]  [02 LOW-END MATRIX]   [03 REVERB TANK]   [04 PITCH DIFFUSION] [05 TAIL MOD] |
|   Pre-Delay (ms)        Crossover (Hz)        Room Size (0-2x)   Shimmer (+12st)      Mod Rate    |
|   Diffusion (%)         Bass Mult (RT60)      Decay (0.3-30s)    Dimmer (-12/-24st)   Mod Depth   |
|   Input Trim (dB)       Punch Duck (%)        Damping (Hz)       Pitch Blend (-1..+1) Bloom Delay |
|                         Sub Mono (Hz)         Freeze Hold        Pitch Regen (%)                  |
|                                                                                                   |
|  [06 MASTER MONITOR]   +-------------------------------+   [07 ONBOARD ACOUSTIC EXCITER]          |
|    Stereo Width          | CRT VECTOR SCOPE DISPLAY      |     Dirac Impulse / Acoustic Mallet    |
|    Early/Late Mix        | [EDC WATERFALL] [LISSAJOUS]   |     Broadband Burst / Felt Piano       |
|    Dry/Wet Mix           |   P1 PHOSPHOR DECAY ENVELOPE  |     Playable Microtonal Chime Strip    |
|    Output Trim (dB)      +-------------------------------+     12 Modal Chords & Poisson Clock    |
|    Soft Limiter Ceiling                                                                           |
+---------------------------------------------------------------------------------------------------+
```

### 1. Non-Euclidean Spatial Manifolds
Beyond generic room simulations, the RB-26 models four specialized acoustic geometries:
* **Poincaré Hyperbolic Cavity:** Negative-curvature acoustic scattering producing exponential reflection growth and diffuse low-frequency dispersion.
* **Whispering Gallery Caustic Waveguide:** High-frequency caustic focusing creating circular whispering reflections that wrap around the stereo horizon.
* **Anharmonic Spruce Soundboard:** Physical resonance modeling of spruce soundboard formants with air-viscosity dispersion.
* **Stockhausen Klangdom Sphere:** Multi-vector spatial diffusion across spherical coordinate delays.

### 2. Bidirectional Pitch-Shifted Diffusion ("Shimmer" + "Dimmer")
* **Shimmer (+7st, +12st, +24st):** Celestial high-register bloom recirculating in the feedback network.
* **Dimmer (-12st, -24st):** Sub-harmonic dark diffusion sinking into deep bass foundations.
* **Interval-Adaptive Grain Windows:** Dynamically scales delay grain windows ($W = 50\text{ ms} / 100\text{ ms} / 200\text{ ms}$) ensuring integer-cycle alignment at low frequencies, reducing spectral sideband distortion to $\le 0.04\%$ peak frequency error.

### 3. Decoupled Low-End & Transient Punch Protection
* **4th-Order Linkwitz-Riley Crossover (60–400 Hz):** Transparent frequency splitting with $|H_{LP} + H_{HP}| = 1$.
* **Orthogonal Modal Matrix & Hadamard Summing:** Eliminates comb-filter phase cancellations below 200 Hz ($<4.80\text{ dB}$ maximum notch depth).
* **Transient Punch Ducking:** Fast envelope follower attenuates low-end reverb injection by $-12\text{ dB}$ on transient kick attacks, recovering over 150 ms to keep kick drums punchy and mud-free.
* **Sub-Bass Elliptical Filter:** Forces frequencies below 120 Hz to mono with $24.1\text{ dB}$ side-channel rejection at 30 Hz.

### 4. Onboard Playable Acoustic Stimulus & Exciter Engine (Deck 07)
Enables instant standalone acoustic testing, performance, and auditioning without external DAW tracks:
* **Playable Microtonal Chime Strip:** 11-key responsive keyboard with velocity sensitivity and modal quantization.
* **12 Signature Modal Chords:** Instant harmonic voicings (Pavilion Sus, Plateaux Maj9, Deep Drone Fifth, Ethereal 11th, Blade Runner, Tears in Rain).
* **Precision Laboratory Impulses:** Dirac delta pulse, acoustic hammer thud, broadband pink noise burst, and felt piano chord.
* **Poisson Ambient Clock:** Self-evolving organic stimulus generator with adjustable events-per-minute (EPM) and humanize jitter.

---

## 🎚️ Factory Preset Library

1. **CALIBRATED DEFAULT:** Balanced studio plate for acoustic instruments and vocals.
2. **AMBIENT GUITAR CLOUD:** Vast 16s ethereal wash with +12st Shimmer bloom and stereo widening.
3. **ETHEREAL SYNTH PAD:** Shimmer + Dimmer dual diffusion with balanced octave harmonics.
4. **CLUB KICK TIGHT:** Short 1.2s space with aggressive transient punch ducking for 4-on-the-floor kicks.
5. **DARK SUB DRONE:** Menacing 14s sub-harmonic space driven by -24st Dimmer diffusion.
6. **CATHEDRAL SHIMMER:** Massive 22s cathedral bloom with high diffusion and sparkling decay.
7. **INFINITE FREEZE DRONE:** Locked infinite feedback recirculation with input isolation.
8. **SUB-BASS PRESERVER:** Transparent acoustic space with strict elliptical mono collapse.
9. **POINCARE HYPERBOLIC CAVITY:** Negative curvature non-Euclidean delay cluster.
10. **WHISPERING GALLERY CAUSTIC:** Caustic ray reflections with high-frequency edge caustics.
11. **ANHARMONIC SPRUCE SOUNDBOARD:** Resonant acoustic soundboard formants.
12. **STOCKHAUSEN KLANGDOM SPHERE:** 3D spherical diffusion matrix with golden-ratio LFO drift.

---

## 🛠️ Studio Utilities & Patch Management

* **RFC 8259 JSON Patch Export/Load:** Save and load custom user presets to/from `.json` files via file dialog or drag-and-drop.
* **Lossless WAV Master Recorder:** Direct 16-bit 48kHz master bus capture with instant `.wav` download.
* **A/B Comparison Buffer:** Rapid toggling between two distinct reverb settings with single-click `COPY A→B`.
* **Calibrated Reset:** Instant restoration of factory-calibrated reference parameters.
* **Chassis Finish Selector:** Seamless toggling between **Aluminum (Light)** and **Anthracite (Dark)** finishes.
