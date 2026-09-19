# BRAUN AS 42 · DSP Architecture & Engineering Specification

> **Engineering Reference Manual:** Physical modeling synthesis, continuous tape flutter, Zavalishin filter topologies, modernized shimmer reverb matrix, and complete parameter reference.  
> **Homage Notice:** Not affiliated with Braun GmbH. Dieter Rams inspired design homage. Published by Sneed's Feed & Seed Ltd.

---

## 1. Architectural Overview & Signal Flow

The BRAUN AS 42 ambient generative synthesizer integrates physical modeling felt piano synthesis, dual microtonal drone generators, polyrhythmic continuous tape delay, and a high-diffusion shimmer reverberator into a cohesive, zero-latency real-time instrument:

```text
[Playable Surface / MIDI / Poisson Point Process]
                   |
         +---------+---------+
         |                   |
         v                   v
  [Felt Piano Synth]   [Twin Drone Synth]
  (6-Voice Polyphony)  (Drone 1 & Drone 2)
  - Physical Hammer    - West-Coast Wavefolder
  - String Resonance   - Sub-Hertz Beating
  - Modal Soundboard   - 40ms MIDI Portamento
         |                   |
         +---------+---------+
                   |
             [Instrument Bus] (0 Samples Algorithmic Latency)
                   |
         +---------+---------+
         |                   | (Aux Send: Pre-Delays 5.3ms, 7.9ms, 11ms)
         |                   v
         |            [Tape Delay Engine]
         |            (Polyrhythmic 3:2 Cross-Coupled, Loop Gain <= 0.92)
         |                   |
         |                   v
         |            [Shimmer Reverb Matrix]
         |            (8-Line FDN + Dual True-Stereo Pitch Shifters + TailMod)
         |                   |
         +---------+---------+
                   |
                   v
          [Master Limiter / Saturation Stage]
          - 15 Hz Highpass DC Blocker
          - SoftCompressor Peak Leveling
          - C1 Hermite Boundary Limiter
                   |
                   v
           [Stereo Master Output]
```

### Latency Profile & Pre-Delay Calibration
* **Dry Instrument Path (0 Samples Latency):** The direct synthesis path (felt piano, chimes, and microtonal twin drones) operates with **strictly 0 samples algorithmic latency**. Instantaneous keypress and MIDI response occurs within standard soundcard hardware buffer boundaries (< 5 ms typical at 128/256 sample buffer sizes).
* **Wet Reverb Pre-Delays:** The auxiliary shimmer reverberation path incorporates **intentional acoustic pre-delays (5.3 ms, 7.9 ms, and 11 ms)** across FDN input injection taps. These pre-delays model natural acoustic wavefront propagation from soundboard boundary walls before early reflections and diffuse reverberant bloom develop, maintaining crystalline attack clarity on felt piano hammer strikes without transient masking.

### Oversampling Architecture
* **Web Audio Implementation (4x Polyphase Oversampling):** In client-side Web Audio (`js/audio/wavefolder.js`), wavefolding and nonlinear soft-knee saturation utilize a 4x oversampled polyphase FIR half-band filter bank to eliminate Nyquist foldover distortion within the browser's dynamic audio graph.
* **Native C++ Engine (1x Native Sample Rate):** In the native C++20 engine (`plugin/source/dsp/`), the wavefolder is mathematically optimized using trigonometric multiple-angle identities ($\sin(3\theta) = \sin\theta(3 - 4\sin^2\theta)$), providing bit-exact $C^1$ smoothness and natural band-limiting running at native sample rate (44.1 kHz – 192 kHz) without oversampling latency or phase ringing.

---

## 2. Physical Modeling & Harold Budd Felt Piano

The piano engine emulates the warm, intimate acoustic character of a prepared una corda felt upright piano:

### 2.1 Felt Hammer Strike Mechanics
* **Acoustic Impulse Generation:** When a voice is struck, an exponential pink-weighted Brownian noise burst is generated and routed through a resonant bandpass impulse resonator.
* **Transient Decoupling:** The hammer transient is decoupled from the string sustain envelope and injected directly into the soundboard peaking formant filter. This preserves tactile impact punch without envelope attenuation.
* **Register-Dependent Acoustic Multipliers:**
  * *Bass (Octaves 1–2):* Heavy 110–220 Hz impact weight, amplitude multiplier `3.20x`, wider bandpass resonance.
  * *Mid (Octaves 3–4):* Resonant wooden spruce formant (~480–610 Hz), amplitude multiplier `2.80x`.
  * *Treble (Octaves 5–6):* Crystalline bell presence (~1.8–2.4 kHz), amplitude multiplier `2.00x`.

### 2.2 Sympathetic String Resonance & Micro-Dispersion
* **Golden-Ratio Micro-Detuning:** Individual unison voices apply golden-ratio micro-detuning dispersion ($\pm 1.4\text{ cents}$) across voice pairs. This eliminates artificial comb filtering and clone phasing, allowing polyphonic chord voicings to coalesce naturally.
* **Continuous Release Scaling:** Voice release duration dynamically scales with register and the `felt_decay` parameter:
  $$t_{\text{rel}} = 0.10\text{s} + 0.32\text{s} \times (\text{relScale})^{1.35}$$
  yielding smooth decay times from 0.14 s (tight staccato) up to 1.84 s (singing ambient sustain).

### 2.3 Soundboard Modal Matrix
* **Physical Modal Circulation:** A 512-sample circular soundboard feedback loop (~10.6 ms) models the physical acoustic body of an upright piano casing.
* **Soft-Clipped Circulation:** Recirculating acoustic energy passes through a soft-knee saturation curve and a 250 ms resonance tail counter, ensuring natural acoustic bloom after notes are released instead of abrupt cutoff.

### 2.4 Timbre Selection
* **FELT:** Intimate una corda felt piano (sine fundamental + triangle overtone with hammer thump).
* **SINE:** Pure crystalline chime / bell with gentle decay.
* **SAW:** Warm band-limited analog pad / brass.
* **SQR:** Hollow vintage reed / pulse organ with anti-pop DC rejection.
* **CS-80:** Dual-saw detuned synth brass with dynamic filter cutoff sweep during release.

---

## 3. Microtonal Twin Drone Oscillators (Elta Solar 42n)

The drone subsystem provides a rich, organic microtonal foundation:

### 3.1 Dual Beatable Oscillators
* Each drone voice features two independent oscillators (Osc A & Osc B) supporting Saw, Square, Sine, Triangle, and Warm Analog waveforms.
* **Continuous Sub-Hertz Beating:** Continuous frequency offset ($0.00\text{ to }5.00\text{ Hz}$) creates slow, hypnotic acoustic interference beats. Fine detune provides microtonal pitch adjustment ($\pm 50\text{ cents}$).

### 3.2 West-Coast Wavefolder
* Non-linear folding transfer function:
  $$y = \tanh\left(\sin(0.5\pi D x) - F \sin(1.5\pi D x)\right)$$
  where $D$ is drive and $F$ is folding depth.
* **Triple-Angle Optimization:** Replaces expensive transcendental calls with:
  $$\sin(3\theta) = \sin\theta(3 - 4\sin^2\theta)$$
  yielding a 34.3% CPU reduction with bit-exact $C^1$ smoothness.

### 3.3 Dynamic MIDI Pitch Tracking & Anti-Pop Gating
* **Drone 1 (Tonic):** Automatically tracks the root note of held piano keys transposed into the deep sub-bass register ($32.7\text{ Hz} - 130.8\text{ Hz}$) with smooth 40 ms portamento frequency slewing.
* **Drone 2 (Dominant / Harmony):** Tracks Drone 1 locked to selectable harmonic ratios (Unison, Sus 4th, Perfect 5th, Octave, Major 9th, 10th).
* **Sample-Accurate Note-Off Gating:** When all MIDI notes and the sustain pedal are released, a 200 ms exponential release envelope smoothly fades out the drones, eliminating infinite droning while preventing audio pops.

### 3.4 Sub-Bass Stabilization & Centering
* 6-pillar stabilization: 15 Hz DC highpass, stereo monofication (pan = 0 in sub register), Butterworth damping ($Q = 0.7071$), 140 Hz lowpass ceiling, and monotonic soft-knee saturation with +4.6 dB gain trim.

---

## 4. Continuous Polyrhythmic Tape Delay

Engineered for warm vintage tape echo without clipping or digital harshness:

* **Polyrhythmic Cross-Coupled Delay Lines:** 3:2 stereo time ratio with delays up to 3.5 seconds.
* **Normalized Loop Gain ($\le 0.92$):** Circulating feedback gain strictly equals the user's setting, preventing runaway resonant build-up during dense playing.
* **Calibrated Input Pad (`inputPad: 0.38` / -8.4 dB):** Guaranteed dynamic headroom prevents waveshaper rail clipping under heavy 6-voice polyphonic chords.
* **Butterworth Damping ($Q = 0.7071$):** Head loss lowpass (3600 Hz) and DC blocking highpass (75 Hz) filters eliminate resonant peaking bumps.
* **Mechanical Wow & Flutter:** Dual sine LFOs modulate delay read heads with a safety floor clamp (`Math.max(0.015, ...)`), preventing Doppler singularities.
* **Delay Return Peak Compressor:** Fast-acting peak compressor (-6 dBFS threshold, 4:1 ratio) and 0 dB soft limiter protect the master bus.

---

## 5. Modernized Shimmer Reverb Matrix (RB-26 Engine)

Ported from the BRAUN RB-26 Master Reverberator:

### 5.1 Feedback Delay Network (FDN)
* 8 delay lines with mutually prime sample lengths tuned for maximal echo density.
* Unitary Hadamard feedback matrix guarantees energy conservation without standing waves.
* Precomputed exponential decay coefficients save 384,000 transcendental calls per second.

### 5.2 True Stereo Dual Pitch Shifter Loop
* Dual independent `DualDelayPitchShifter` engines running in true stereo decorrelation (> 63% decorrelation).
* Octave-up (+12 semitones / 2.0x frequency) pitch shifting with dual bandpass filtering (1600 Hz, $Q = 0.85$).
* **Hann Raised-Cosine Grain Windows:** $\sin^2(\pi\phi_1) + \sin^2(\pi\phi_2) \equiv 1.0$ completely eradicates 22.2 Hz amplitude throb.
* **4-Point Catmull-Rom Hermite Cubic Interpolation:** Replaces linear reading, lowering the noise floor below -115 dBFS.

### 5.3 Golden-Ratio Tail Modulation (`TailModulator`)
* Multi-phase golden-ratio prime LFO network (0.45 Hz rate, 0.35 ms depth, 120 ms bloom) continuously rotates loop eigenmodes.
* **Transient Bloom Ducking:** Dual envelope follower (7 ms fast / 50 ms slow) dynamically ducks modulation on note strikes, keeping attack pitch drift $< 3.1\text{ cents}$ while allowing lush diffuse tail bloom.

### 5.4 Infinite Ambient Freeze
* Recirculation gain locks to 0.988 with automatic input ducking (`freezeInGain: 0.08`) and 75 Hz sub-bass roll-off.
* Unfreezing smoothly slews feedback and wet gain to silence within 200 ms without clicks.

---

## 6. Complete Parameter Reference

The synthesizer exposes 38 parameters synchronized between C++ APVTS and Web UI:

| Index | APVTS Identifier | Web Identifier | Range | Default | Unit / Scale | Description |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `felt_volume` | `feltLevel` | 0.0 – 1.0 | 0.80 | Linear | Felt piano output level |
| 2 | `felt_decay` | `feltDecay` | 0.2 – 3.5 | 1.00 | Multiplier | String decay time scaling |
| 3 | `felt_tone` | `feltTone` | 0.0 – 1.0 | 0.50 | Linear | Una corda filter cutoff brightness |
| 4 | `felt_hammer` | `feltHammer` | 0.0 – 1.0 | 0.60 | Linear | Felt wooden hammer impact weight |
| 5 | `felt_space` | `feltSymp` | 0.0 – 1.0 | 0.30 | Linear | Sympathetic string resonance amount |
| 6 | `felt_waveform` | `feltWaveform` | 0 – 4 | 0 (Felt) | Enum | Core timbre: Felt, Sine, Saw, Sqr, CS80 |
| 7 | `drone1_volume` | `drone1Vol` | 0.0 – 1.0 | 0.45 | Linear | Drone Voice 1 volume |
| 8 | `drone1_pitch` | `drone1Pitch` | 20.0 – 400.0 | 65.41 | Hz | Drone Voice 1 base frequency |
| 9 | `drone1_fold` | `drone1Fold` | 0.0 – 1.0 | 0.25 | Linear | Drone 1 wavefolder drive & fold depth |
| 10 | `drone1_cutoff` | `drone1Cutoff` | 50.0 – 12000.0 | 850.0 | Hz | Drone 1 ladder lowpass cutoff |
| 11 | `drone1_resonance` | `drone1Res` | 0.5 – 4.0 | 1.20 | Linear | Drone 1 filter resonance |
| 12 | `drone1_beat` | `drone1Beat` | 0.0 – 5.0 | 0.35 | Hz | Drone 1 sub-Hertz beating offset |
| 13 | `drone1_detune` | `drone1Detune` | -50.0 – 50.0 | 0.00 | Cents | Drone 1 microtonal pitch detune |
| 14 | `drone1_lfo` | `drone1Lfo` | 0.0 – 1.0 | 0.20 | Linear | Drone 1 filter cutoff LFO modulation |
| 15 | `drone1_waveA` | `drone1WaveA` | 0 – 4 | 1 (Sine) | Enum | Drone 1 Oscillator A waveform |
| 16 | `drone1_waveB` | `drone1WaveB` | 0 – 4 | 5 (Tri) | Enum | Drone 1 Oscillator B waveform |
| 17 | `drone1_isSubBass` | `drone1SubBass` | 0 / 1 | 0 (Off) | Bool | Drone 1 sub-bass mode toggle |
| 18 | `drone2_volume` | `drone2Vol` | 0.0 – 1.0 | 0.40 | Linear | Drone Voice 2 volume |
| 19 | `drone2_pitch` | `drone2Pitch` | 20.0 – 600.0 | 98.12 | Hz | Drone Voice 2 base frequency |
| 20 | `drone2_fold` | `drone2Fold` | 0.0 – 1.0 | 0.20 | Linear | Drone 2 wavefolder drive & fold depth |
| 21 | `drone2_cutoff` | `drone2Cutoff` | 50.0 – 12000.0 | 1100.0 | Hz | Drone 2 ladder lowpass cutoff |
| 22 | `drone2_resonance` | `drone2Res` | 0.5 – 4.0 | 1.10 | Linear | Drone 2 filter resonance |
| 23 | `drone2_beat` | `drone2Beat` | 0.0 – 5.0 | 0.45 | Hz | Drone 2 sub-Hertz beating offset |
| 24 | `drone2_detune` | `drone2Detune` | -50.0 – 50.0 | 4.00 | Cents | Drone 2 microtonal pitch detune |
| 25 | `drone2_lfo` | `drone2Lfo` | 0.0 – 1.0 | 0.15 | Linear | Drone 2 filter cutoff LFO modulation |
| 26 | `drone2_waveA` | `drone2WaveA` | 0 – 4 | 1 (Sine) | Enum | Drone 2 Oscillator A waveform |
| 27 | `drone2_waveB` | `drone2WaveB` | 0 – 4 | 5 (Tri) | Enum | Drone 2 Oscillator B waveform |
| 28 | `tape_time` | `delayTime` | 0.02 – 3.50 | 0.46 | Seconds | Polyrhythmic delay loop time |
| 29 | `tape_feedback` | `delayFeedback` | 0.0 – 0.92 | 0.55 | Linear | Delay feedback recirculation |
| 30 | `tape_mix` | `delayWet` | 0.0 – 1.0 | 0.40 | Linear | Delay wet/dry send level |
| 31 | `tape_wow` | `delayWow` | 0.0 – 1.0 | 0.35 | Linear | Mechanical wow & flutter depth |
| 32 | `tape_tone` | `delayTone` | 400.0 – 10000.0 | 3600.0 | Hz | Tape head loss damping cutoff |
| 33 | `shimmer_mix` | `reverbWet` | 0.0 – 1.0 | 0.50 | Linear | Shimmer reverb wet mix level |
| 34 | `shimmer_decay` | `reverbDecay` | 0.5 – 25.0 | 8.50 | Seconds | FDN RT60 reverberation decay |
| 35 | `shimmer_damping` | `reverbDamping` | 0.0 – 1.0 | 0.45 | Linear | High-frequency absorption |
| 36 | `shimmer_amount` | `reverbShimmer` | 0.0 – 1.0 | 0.40 | Linear | Octave-up shimmer regeneration |
| 37 | `shimmer_freeze` | `reverbFreeze` | 0 / 1 | 0 (Off) | Bool | Infinite ambient freeze toggle |
| 38 | `master_volume` | `masterVol` | 0.0 – 1.0 | 0.85 | Linear | Master bus output gain |

---

## 7. Real-Time Safety & Memory Architecture

* **0 Dynamic Memory Allocations:** Real-time audio rendering (`processBlock()` in C++ and `AudioWorklet`/Web Audio graph) executes with strictly **0 bytes** of heap memory allocation during playback.
* **Lock-Free Communication:** Audio threads never block on mutexes or locks. UI oscilloscope and FFT telemetry queues stream through Single-Producer Single-Consumer (SPSC) lock-free ring buffers.
* **Hardware Denormal Flushing:** RAII `ScopedNoDenormals` guards force Flush-To-Zero (FTZ) and Denormals-Are-Zero (DAZ) across both SSE/AVX (x86/x64) and NEON (ARM64).
