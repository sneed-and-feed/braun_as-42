# BRAUN AS 42 · Ambient Generative Synthesizer

> **A Dieter Rams functionalist digital-analog ambient instrument and microtonal drone synthesizer.**
> Inspired by **Harold Budd**, **Brian Eno**, and the **Elta Solar 42n**.

---

## 1. Acoustic & DSP Architecture

The BRAUN AS 42 synthesizes three complementary ambient acoustic traditions into a cohesive tactile instrument:

### 1.1 Harold Budd: Playable Synth & "Soft Pedal" Felt Piano
* **Waveform Select Toggles:** Select core timbre between **FELT** (intimate felt piano: sine + triangle overtone), **SINE** (crystalline acoustic chime / bell), **SAW** (band-limited warm analog synth brass/pad), and **SQR** (hollow vintage reed / pulse organ).
* **Felt Hammer Transient:** Soft physical impact of a felt-covered wooden hammer using an exponential pink-weighted noise burst passed through a resonant bandpass impulse resonator (zero GC allocation).
* **Steep Warm 24dB Damping:** Cascaded dual biquad lowpass filter mimicking Harold Budd's signature soft pedal (una corda) dampening. On strike, the cutoff opens quickly to 600–2400 Hz before exponentially decaying down to the fundamental in 180–450 ms with click-free voice stealing.
* **4x Anti-Aliased Saturation:** Internal soft clipper with 4x polyphase oversampling eliminates high-frequency digital foldover distortion.
* **Dynamic String Tail:** Low notes ring for 6–10 seconds, while high chime registers decay with crystalline clarity.

### 1.2 Brian Eno: Asynchronous Phase Loops & Shimmer Tape Diffusion
* **Music for Airports Tape Loops:** 4 asynchronous loop tracks running at coprime prime durations (13.7s, 17.3s, 21.1s, 26.9s). Because the periods are incommensurable, the melodic counterpoint continuously drifts and never repeats. Dynamic pitch readouts display active notes (e.g. C3, G4, E5, B5).
* **Stereo Tape Delay with Wow & Flutter:** Polyrhythmic cross-coupled delay lines (3:2 stereo ratio, up to 3.5s) with 4x oversampled tape saturation, high-frequency tape head loss damping (3600 Hz), and dual-frequency mechanical wow (~0.38 Hz) and capstan flutter (~5.8 Hz).
* **Octave-Up Shimmer Reverb Bloom:** Features an algorithmic high-diffusion reverb convolver with debounced RT60 tuning coupled with a clickless dual-delay real-time pitch shifter (+12 semitones / 2.0x frequency) in a feedback loop.
* **Infinite Ambient Freeze with Input Ducking:** Dual-delay recirculation locks to 0.992 gain with automatic input ducking and isolated output gating (no slapback echo leak when disengaged).
* **Isolated Send Bus Architecture:** Auxiliary effects run dry-isolated (`dryLevel: 0.0`) so the master bus receives pristine dry signal at unity without phase cancellation or limiter overdrive.

### 1.3 Elta Solar 42n: Microtonal Twin-Oscillator Drone Voices
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

---

## 4. Getting Started & Running Locally

### Quick Start
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

### Keyboard Shortcuts & Gestures
* **A, S, D, F, G, H, J, K, L, ;, ', Z, X, C, V:** Play scale degrees on the harmonic touch strip (click-free with key repeat protection).
* **Click & Drag Glissando:** Slide finger or mouse horizontally across keys for expressive harp/chime glissandi.
* **1 to 6:** Trigger Harold Budd Chord Cluster Macros.
* **Spacebar:** Toggle Infinite Reverb Freeze.

---

## 5. Verification & Testing

The project includes an automated test suite verifying scale quantizers, Poisson distributions, phase loop engines, Fourier series anti-aliasing tables, pitch shifter crossfades, freeze gating, and wavefolder transfer curves:

```bash
npm test
```
All 36 unit and integration tests run with Node's built-in test runner.
