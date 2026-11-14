# BRAUN AS 42 · DSP Architecture & Engineering Specification

> **Document Version:** 1.5.0  
> **Engineering Reference Manual:** Physical modeling synthesis, continuous tape flutter, Zavalishin filter topologies, modernized shimmer reverb matrix, Standalone/DAW lifecycle state machine, and complete 38-parameter APVTS reference.  
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
  (24-Voice Polyphony) (Drone 1 & Drone 2)
  - Physical Hammer    - West-Coast Wavefolder
  - String Resonance   - Sub-Hertz Beating
  - Modal Soundboard   - 40ms MIDI Portamento
         |             - 15ms De-Click Gate
         +---------+---------+
                   |
             [Instrument Bus] (0 Samples Algorithmic Latency)
                   |
         +---------+---------+
         |                   | (Aux Send: Pre-Delays 5.3ms, 7.9ms, 11ms)
         |                   v
         |            [Tape Delay Engine]
         |            (Polyrhythmic 3:2 Cross-Coupled, Loop Gain <= 0.90 APVTS)
         |                   |
         |                   v
         |            [Shimmer Reverb Matrix]
         |            (8-Line Dynamic FDN + Dual True-Stereo Pitch Shifters + TailMod)
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
           [Stereo / Mono-Summed Master Output]
```

### Latency Profile, Dynamic Tail Reporting & Pre-Delay Calibration
* **Dry Instrument Path (0 Samples Latency):** The direct synthesis path (felt piano, chimes, and microtonal twin drones) operates with **strictly 0 samples algorithmic latency**. Instantaneous keypress and MIDI response occurs within standard soundcard hardware buffer boundaries (< 5 ms typical at 128/256 sample buffer sizes).
* **Wet Reverb Pre-Delays:** The auxiliary shimmer reverberation path incorporates **intentional acoustic pre-delays (5.3 ms, 7.9 ms, and 11 ms)** across FDN input injection taps. These pre-delays model natural acoustic wavefront propagation from soundboard boundary walls before early reflections and diffuse reverberant bloom develop, maintaining crystalline attack clarity on felt piano hammer strikes without transient masking.
* **Dynamic Host Tail Length (`getTailLengthSeconds`):** Reports `0.0 s` in Standby, `infinity` whenever Drone 1, Drone 2, or Shimmer Freeze is engaged (preventing aggressive VST3/AU hosts from auto-suspending `processBlock` on idle MIDI tracks), and the combined `shimmer_decay + tape_delay` acoustic ring-out horizon otherwise.

### Oversampling & Ultra-High Sample Rate Architecture
* **Web Audio Implementation (4x Polyphase Oversampling):** In client-side Web Audio (`js/audio/wavefolder.js`), wavefolding and nonlinear soft-knee saturation utilize a 4x oversampled polyphase FIR half-band filter bank to eliminate Nyquist foldover distortion within the browser's dynamic audio graph.
* **Native C++ Engine (1x Native Sample Rate, 44.1 kHz – 384 kHz+):** In the native C++20 engine (`plugin/source/dsp/`), the wavefolder is mathematically optimized via the triple-angle identity $\sin(3\theta) = \sin\theta(3 - 4\sin^2\theta)$, providing bit-exact $C^1$ smoothness running at native sample rate without oversampling latency or phase ringing. The 8-line FDN tank dynamically scales its power-of-two buffer capacity (`mFdnCapacity`, `mFdnMask`) to prevent delay-line wraparound at 192 kHz and 384 kHz+.

### Wrapper-Aware Startup State Machine (`Standalone` vs `VST3`/`AU`)
* **Standalone Desktop Guard (`wrapperType_Standalone`):** JUCE's `StandalonePluginHolder` automatically serializes plugin state on window close and reloads it on the next cold launch prior to `createEditor()`. In `v1.5.0`, `BRAUN_AS42AudioProcessor` detects this initial Standalone reload, restoring all 38 user parameter calibrations, waveform choices, `currentProgram`, and `droneTrackMidi` while explicitly disarming `drone1Active = false`, `drone2Active = false`, `shimmer_freeze = false`, and `isPoweredOn = false` (Standby).
* **DAW Project Recall (`wrapperType_VST3` / `wrapperType_AudioUnit`):** Host project chunks restore active drones, freeze latch, and power states transparently so automated ambient stems render identically on session reload and offline bounce.

---

## 2. Physical Modeling & Harold Budd Felt Piano

The piano engine emulates the warm, intimate acoustic character of a prepared una corda felt upright piano across a 24-voice polyphonic pool:

### 2.1 Felt Hammer Strike Mechanics
* **Acoustic Impulse Generation:** When a voice is struck, an exponential pink-weighted Brownian noise burst is generated and routed through a resonant bandpass impulse resonator.
* **Transient Decoupling:** The hammer transient is decoupled from the string sustain envelope and injected directly into the soundboard peaking formant filter. This preserves tactile impact punch without envelope attenuation.
* **Register-Dependent Acoustic Multipliers:**
  * *Bass (Octaves 1–2):* Heavy 110–220 Hz impact weight, amplitude multiplier `3.20x`, wider bandpass resonance.
  * *Mid (Octaves 3–4):* Resonant wooden spruce formant (~480–610 Hz), amplitude multiplier `2.80x`.
  * *Treble (Octaves 5–6):* Crystalline bell presence (~1.8–2.4 kHz), amplitude multiplier `2.00x`.

### 2.2 Sympathetic String Resonance, Voice Stealing & Micro-Dispersion
* **Golden-Ratio Micro-Detuning:** Individual unison voices apply golden-ratio micro-detuning dispersion of $\pm 1.4\text{ cents}$ across the 24-voice pool. This eliminates artificial comb filtering and clone phasing, allowing dense polyphonic chord voicings to coalesce naturally.
* **Pitch-Locked Multi-Steal Hygiene:** Stolen voices execute a 5 ms de-click ramp locked to the outgoing `mStealFreq` (even across rapid back-to-back steals mid-ramp) and flush all four per-voice biquad states (`mFilter1`, `mFilter2`, `mBodyFilter`, `mHammerFilter`) at the zero-gain trough before exciting the new pitch.
* **Continuous Release Scaling:** Voice release duration dynamically scales with register and the `felt_decay` parameter:

$$t_{\text{rel}} = 0.10\text{ s} + 0.32\text{ s} \times (\text{relScale})^{1.35}$$

yielding smooth decay times from 0.14 s (tight staccato) up to 1.84 s (singing ambient sustain).

### 2.3 Soundboard Modal Matrix
* **Physical Modal Circulation:** A 512-sample circular soundboard feedback loop (~10.6 ms at 48 kHz) models the physical acoustic body of an upright piano casing.
* **Soft-Clipped Circulation & Tail Flush:** Recirculating acoustic energy passes through a soft-knee saturation curve and a 250 ms resonance tail counter, ensuring natural acoustic bloom after notes are released and zeroing delay/filter states cleanly once the tail completes.

### 2.4 Timbre Selection (`0` – `4`)
* **`0` · FELT:** Intimate una corda felt piano (sine fundamental + triangle overtone with hammer thump).
* **`1` · SINE:** Pure crystalline chime / bell with gentle decay.
* **`2` · SAW:** Warm band-limited analog pad / brass.
* **`3` · SQR:** Hollow vintage reed / pulse organ with anti-pop DC rejection.
* **`4` · CS-80:** Dual-saw detuned synth brass with continuous sustain and dynamic filter cutoff sweep during release.

---

## 3. Microtonal Twin Drone Oscillators (Elta Solar 42n)

The drone subsystem provides a rich, organic microtonal foundation:

### 3.1 Dual Beatable Oscillators & De-Click Gate
* Each drone voice features two independent band-limited oscillators (Osc A & Osc B) supporting all 7 `WaveformType` entries (`0: Felt`, `1: Sine`, `2: Saw`, `3: Square`, `4: CS80`, `5: Triangle`, `6: Warm`).
* **Continuous Sub-Hertz Beating:** Continuous frequency offset from $0.00\text{ to }5.00\text{ Hz}$ creates slow, hypnotic acoustic interference beats. Fine detune provides microtonal pitch adjustment across $\pm 35.0\text{ cents}$.
* **15 ms Anti-Click Active Gate:** Toggling Drone 1 or Drone 2 ON/OFF ramps output through a 15 ms `OnePoleSmoother` gate (`mActiveGateSmoother`). While inactive, continuous smoothers track target pitch, cutoff, resonance, fold, and gain silently so fresh activations never swoop from stale settings.

### 3.2 West-Coast Wavefolder
* Non-linear folding transfer function:

$$y = \tanh\left(\sin(0.5\pi D x) - F \sin(1.5\pi D x)\right)$$

where $D$ is drive and $F$ is folding depth.
* **Triple-Angle Optimization:** Replaces expensive transcendental calls with:

$$\sin(3\theta) = \sin\theta(3 - 4\sin^2\theta)$$

yielding ~30% CPU reduction with bit-exact $C^1$ smoothness. Square waves bypass the wavefolder directly into the ladder filter to preserve fundamental weight.

### 3.3 Dynamic MIDI Pitch Tracking & Anti-Pop Gating
* **Drone 1 (Tonic):** Automatically tracks the root note of held piano keys transposed into the deep sub/bass register ($32.7\text{ Hz}\text{ to }130.8\text{ Hz}$) with smooth 40 ms portamento frequency slewing.
* **Drone 2 (Dominant / Harmony):** Tracks Drone 1 locked to selectable harmonic ratios (Unison, Sus 4th, Perfect 5th, Octave, Major 9th, 10th).
* **Sample-Accurate Note-Off Gating:** When all MIDI notes and the sustain pedal are released, a 200 ms exponential release envelope smoothly fades out the drones, eliminating infinite droning while preventing audio pops.

### 3.4 Sub-Bass Stabilization & Centering
* 6-pillar stabilization: phase-locked oscillators, 15 Hz DC highpass, stereo monofication (pan = 0 in sub register), Butterworth damping ($Q = 0.7071$), 140 Hz lowpass ceiling, and monotonic soft-knee saturation with +4.6 dB gain trim and 25 ms Hann mode-switch crossfading.

---

## 4. Continuous Polyrhythmic Tape Delay

Engineered for warm vintage tape echo without clipping or digital harshness:

* **Polyrhythmic Cross-Coupled Delay Lines:** 3:2 stereo time ratio across `0.10 s – 1.50 s` APVTS range (with internal buffer headroom up to 3.5 seconds).
* **Normalized Loop Gain:** Circulating feedback gain strictly tracks the user's `0.00 – 0.90` APVTS setting (internal ceiling $\le 0.92$), preventing runaway resonant build-up during dense playing.
* **Calibrated Input Pad (`inputPad: 0.38` / -8.4 dB):** Guaranteed dynamic headroom prevents waveshaper rail clipping under heavy 24-voice polyphonic chords.
* **Butterworth Damping** ($Q = 0.7071$): Head loss lowpass (`1000 – 10000 Hz`, default `3600 Hz`) and DC blocking highpass (`75 Hz`) filters eliminate resonant peaking bumps.
* **Mechanical Wow & Flutter:** Dual LFOs modulate delay read heads with a safety floor clamp (`Math.max(0.015, ...)`), preventing Doppler singularities.
* **Delay Return Peak Compressor:** Fast-acting peak compressor (-6 dBFS threshold, 4:1 ratio) and 0 dB soft limiter protect the master bus.

---

## 5. Modernized Shimmer Reverb Matrix (RB-26 Engine)

Ported from the BRAUN RB-26 Master Reverberator:

### 5.1 Feedback Delay Network (FDN)
* 8 delay lines with mutually prime base lengths scaled dynamically to the host sample rate (`mFdnCapacity` power-of-two sizing).
* Unitary Hadamard feedback matrix guarantees energy conservation without standing waves.
* Precomputed exponential decay coefficients and early reflection tap tables eliminate hundreds of thousands of per-second transcendental evaluations.

### 5.2 True Stereo Dual Pitch Shifter Loop
* Dual independent `DualDelayPitchShifter` engines running in true stereo decorrelation (> 63% decorrelation).
* Octave-up (+12 semitones / 2.0x frequency) pitch shifting with dual bandpass filtering (1600 Hz, $Q = 0.85$).
* **Hann Raised-Cosine Grain Windows:** $\sin^2(\pi\phi_1) + \sin^2(\pi\phi_2) \equiv 1.0$ completely eradicates 22.2 Hz amplitude throb.
* **4-Point Catmull-Rom Hermite Cubic Interpolation:** Replaces linear reading, lowering the noise floor below -115 dBFS.

### 5.3 Golden-Ratio Tail Modulation (`TailModulator`)
* Multi-phase golden-ratio prime LFO network (0.45 Hz rate, 0.35 ms depth, 120 ms bloom) continuously rotates loop eigenmodes.
* **Transient Bloom Ducking:** Dual envelope follower (7 ms fast / 50 ms slow) dynamically ducks modulation on note strikes, keeping attack pitch drift below $3.1\text{ cents}$ while allowing lush diffuse tail bloom.

### 5.4 Infinite Ambient Freeze
* Recirculation gain locks to `0.988` with automatic input ducking (`freezeInGain: 0.08`), 75 Hz sub-bass roll-off, and C1 soft limiting below `0.88`.
* Unfreezing smoothly slews feedback and wet gain to silence within 200 ms without clicks.

---

## 6. Complete Parameter Reference

The synthesizer exposes **38 automatable parameters** synchronized bidirectionally between C++ APVTS (`plugin/source/Parameters.h`), Native JUCE UI, and WebView2 UI.

> **Waveform Enum (`braun::WaveformType`):** `0 = Felt`, `1 = Sine`, `2 = Saw`, `3 = Square`, `4 = CS80`, `5 = Triangle`, `6 = Warm`.

| Index | APVTS Identifier | Web Identifier | APVTS Range | Default | Unit / Scale | Description |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `felt_volume` | `feltLevel` | 0.00 – 1.00 | 0.80 | Linear (0–100% Web) | Felt piano output level |
| 2 | `felt_decay` | `feltDecay` | 0.20 – 3.50 | 1.00 | Seconds / Multiplier | String decay time and dynamic release scale |
| 3 | `felt_tone` | `feltTone` | 0.00 – 1.00 | 0.62 | Linear (0–100% Web) | 24 dB/oct una corda filter cutoff brightness |
| 4 | `felt_hammer` | `feltHammer` | 0.00 – 1.00 | 0.45 | Linear (0–100% Web) | Felt wooden hammer impact transient level |
| 5 | `felt_space` | `feltSymp` | 0.00 – 1.00 | 0.45 | Linear (0–100% Web) | Sympathetic string & soundboard resonance |
| 6 | `felt_waveform` | `feltWaveform` | 0 – 4 | 0 (Felt) | Int Enum | Core timbre: 0 Felt, 1 Sine, 2 Saw, 3 Sqr, 4 CS80 |
| 7 | `drone1_volume` | `drone1Vol` | 0.00 – 1.00 | 0.55 | Linear (0–100% Web) | Drone Voice 1 output level |
| 8 | `drone1_pitch` | `drone1Pitch` | 20.0 – 400.0 | 65.41 | Hz | Drone Voice 1 fundamental frequency (C2) |
| 9 | `drone1_fold` | `drone1Fold` | 0.0 – 100.0 | 45.0 | Percent (%) | Drone 1 wavefolder drive & fold depth |
| 10 | `drone1_cutoff` | `drone1Cutoff` | 50.0 – 8000.0 | 650.0 | Hz (Skew 0.35) | Drone 1 4-pole ladder lowpass cutoff |
| 11 | `drone1_resonance` | `drone1Res` | 0.5 – 10.0 | 3.5 | Linear | Drone 1 ladder filter resonance |
| 12 | `drone1_beat` | `drone1Beat` | 0.00 – 5.00 | 0.35 | Hz | Drone 1 sub-Hertz beating offset |
| 13 | `drone1_detune` | `drone1Detune` | -35.0 – +35.0 | +2.5 | Cents | Drone 1 microtonal pitch detune |
| 14 | `drone1_lfo` | `drone1Lfo` | 0.02 – 1.50 | 0.12 | Hz | Drone 1 filter cutoff LFO breathing rate |
| 15 | `drone1_waveA` | `drone1WaveA` | 0 – 6 | 2 (Saw) | Int Enum | Drone 1 Oscillator A waveform (`WaveformType`) |
| 16 | `drone1_waveB` | `drone1WaveB` | 0 – 6 | 6 (Warm) | Int Enum | Drone 1 Oscillator B waveform (`WaveformType`) |
| 17 | `drone1_isSubBass` | `drone1SubBass` | 0.0 – 1.0 | 0.0 (Off) | Bool / Step 1.0 | Drone 1 6-pillar stabilized sub-bass toggle |
| 18 | `drone2_volume` | `drone2Vol` | 0.00 – 1.00 | 0.55 | Linear (0–100% Web) | Drone Voice 2 output level |
| 19 | `drone2_pitch` | `drone2Pitch` | 20.0 – 400.0 | 98.00 | Hz | Drone Voice 2 companion frequency (G2) |
| 20 | `drone2_fold` | `drone2Fold` | 0.0 – 100.0 | 45.0 | Percent (%) | Drone 2 wavefolder drive & fold depth |
| 21 | `drone2_cutoff` | `drone2Cutoff` | 50.0 – 8000.0 | 850.0 | Hz (Skew 0.35) | Drone 2 4-pole ladder lowpass cutoff |
| 22 | `drone2_resonance` | `drone2Res` | 0.5 – 10.0 | 3.5 | Linear | Drone 2 ladder filter resonance |
| 23 | `drone2_beat` | `drone2Beat` | 0.00 – 5.00 | 0.65 | Hz | Drone 2 sub-Hertz beating offset |
| 24 | `drone2_detune` | `drone2Detune` | -35.0 – +35.0 | -3.2 | Cents | Drone 2 microtonal pitch detune |
| 25 | `drone2_lfo` | `drone2Lfo` | 0.02 – 1.50 | 0.12 | Hz | Drone 2 filter cutoff LFO breathing rate |
| 26 | `drone2_waveA` | `drone2WaveA` | 0 – 6 | 3 (Square) | Int Enum | Drone 2 Oscillator A waveform (`WaveformType`) |
| 27 | `drone2_waveB` | `drone2WaveB` | 0 – 6 | 5 (Triangle) | Int Enum | Drone 2 Oscillator B waveform (`WaveformType`) |
| 28 | `tape_time` | `delayTime` | 0.10 – 1.50 | 0.46 | Seconds (ms Web) | Polyrhythmic 3:2 delay loop base time |
| 29 | `tape_feedback` | `delayFeedback` | 0.00 – 0.90 | 0.55 | Linear (0–90% Web) | Normalized delay feedback recirculation |
| 30 | `tape_mix` | `delayWet` | 0.00 – 1.00 | 0.40 | Linear (0–100% Web) | Tape delay wet/dry return level |
| 31 | `tape_wow` | `delayWow` | 0.00 – 1.00 | 0.45 | Linear (0–100% Web) | Mechanical wow & flutter modulation depth |
| 32 | `tape_tone` | `delayTone` | 1000.0 – 10000.0 | 3600.0 | Hz | Butterworth tape head-loss damping cutoff |
| 33 | `shimmer_mix` | `reverbWet` | 0.00 – 1.00 | 0.45 | Linear (0–100% Web) | Shimmer reverb wet mix level |
| 34 | `shimmer_decay` | `reverbDecay` | 0.5 – 20.0 | 8.5 | Seconds | FDN $RT_{60}$ reverberation decay time |
| 35 | `shimmer_damping` | `reverbDamping` | 0.00 – 1.00 | 0.60 | Linear (0–100% Web) | High-frequency air absorption |
| 36 | `shimmer_amount` | `reverbShimmer` | 0.00 – 1.00 | 0.45 | Linear (0–100% Web) | Octave-up (+12 st) shimmer regeneration |
| 37 | `shimmer_freeze` | `reverbFreeze` | False / True | False | Bool | Infinite ambient freeze recirculation toggle |
| 38 | `master_volume` | `masterVol` | 0.00 – 1.00 | 0.80 | Linear (0–100% Web) | Master bus output gain |

---

## 7. Real-Time Safety & Memory Architecture

* **0 Dynamic Memory Allocations:** Real-time audio rendering (`processBlock()` in C++ and Web Audio graph execution) runs with strictly **0 bytes** of heap memory allocation during playback, including oversize host blocks (> 2048 samples) via chunked scratch slicing.
* **Lock-Free Communication:** Audio threads never block on mutexes or locks. UI MIDI injection and oscilloscope telemetry stream through lock-free `juce::AbstractFifo` Single-Producer Single-Consumer (SPSC) ring buffers.
* **Hardware Denormal Flushing:** RAII `ScopedNoDenormals` guards force Flush-To-Zero (FTZ) and Denormals-Are-Zero (DAZ) across both SSE/AVX (x86/x64) and NEON (ARM64).
