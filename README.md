# BRAUN AS 42 · Ambient Generative Synthesizer

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live%20Demo-EE592B?style=for-the-badge&logo=github)](https://sneed-and-feed.github.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Web Audio API](https://img.shields.io/badge/Web%20Audio-100%25%20Client--Side-4A4A4A?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

> **A Dieter Rams functionalist digital-analog ambient instrument and microtonal drone synthesizer.**
> Inspired by **Harold Budd**, **Brian Eno**, and the **Elta Solar 42n**.

---

### 🌐 [🔊 Play Live in Your Browser: https://sneed-and-feed.github.io/](https://sneed-and-feed.github.io/)

*No installation, plugins, or accounts required. Powered entirely by the browser's native Web Audio API.*

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
* **Dieter Rams Quick-Snap Tuning Buttons:** Instant one-click microtonal and harmonic drone snapping without manual knob hunting:
  * *Voice 1 (Tonic):* **SUB BASS** (C1 / ~32.7 Hz), **DEEP TONIC** (C2 / ~65.4 Hz), **WARM ROOT** (C3 / ~130.8 Hz), **OCTAVE UP** (C4 / ~261.6 Hz).
  * *Voice 2 (Dominant / Harmony):* **PERFECT 5TH** (3:2 ratio), **SUS 4TH** (4:3 ratio), **MAJOR 9TH** (9:8 ratio), **BEATING UNISON** (unison with ~0.35 Hz acoustic beat offset).
  * Snap buttons automatically re-tune relative to active root note and modal harmony.
* **Twin Beatable Oscillators:** Voices 1 and 2 feature independent dual oscillators (Osc A & Osc B) with Saw, Square, Sine, Triangle, and Warm Analog core waveforms.
* **Continuous Sub-Hertz Beating Control:** Dedicated continuous Hz offset dial (0.00 to 5.00 Hz) and fine detune (cents) to create slow, hypnotic, organic acoustic interference waves.
* **West-Coast Wavefolder:** Multi-stage wavefolding transfer function ($y = \tanh(\sin(0.5\pi D x) - F \sin(1.5\pi D x))$) folding waveform peaks inward with 4x oversampled anti-aliasing.
* **4-Pole Resonant Ladder Lowpass Filter:** Dual cascaded biquad filters with resonance up to self-oscillation and slow breathing LFO drift.

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
  * **ETHEREAL 11TH:** Brian Eno celestial shimmer voicing.
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

---

## 4. Getting Started & Running Locally

### Option A: 1-Click Windows Launcher (`.bat`)
Simply double-click:
```bat
start.bat
```
*(or `run.bat`)* — it automatically checks for Node.js (or Python), launches the local static server on `http://localhost:3000`, and opens your default browser!

### Option B: Node.js Terminal
1. **Start the local server:**
   ```bash
   npm start
   # or: node server.js
   # or: python -m http.server 3000
   ```
2. **Open in your web browser:**
   ```
   http://localhost:3000
   ```
3. **Turn on the instrument:** Click the orange **POWER ON** button at the top right to start the Web Audio API context.

### Deploying to GitHub Pages
To update the live version hosted at [`https://sneed-and-feed.github.io/`](https://sneed-and-feed.github.io/):
```bat
deploy-pages.bat
# or: npm run deploy
```
This automatically syncs the latest files to `sneed-and-feed.github.io`, commits, and pushes to GitHub Pages.
Additionally, this repository includes `.github/workflows/deploy.yml` which deploys automatically on every push to `main`.

### Keyboard Shortcuts & Gestures
* **A, S, D, F, G, H, J, K, L, ;, ', Z, X, C, V:** Play scale degrees on the harmonic touch strip (click-free with key repeat protection and continuous hold sustain).
* **Click & Drag Glissando:** Slide finger or mouse horizontally across chime keys for expressive harp/chime glissandi. Each entered key articulates expressively with velocity sensitivity while smoothly releasing previous sounding notes. Holding in place maintains continuous pedal sustain until mouse release.
* **1 to 9, 0, -, =:** Trigger Harold Budd Chord Cluster Macros (12 curated modal voicings with subtle humanized strum and hold sustain).
* **Spacebar:** Toggle Infinite Reverb Freeze.

---

## 5. Verification & Testing

The project includes an extensive automated test suite verifying scale quantizers, Poisson point process distributions, phase loop engines, Fourier series anti-aliasing tables, pitch shifter crossfades, freeze gating, wavefolder transfer curves, mouse click & drag glissandi, and anti-clipping bus headroom staging:

```bash
npm test
```
All 149 unit and integration tests across 28 test suites run with Node's built-in test runner.
