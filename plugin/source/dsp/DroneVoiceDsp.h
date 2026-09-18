#pragma once

#include "DspMath.h"
#include "Wavetables.h"
#include <cmath>
#include <algorithm>

namespace braun {

struct DroneVoiceParams {
    WaveformType waveA { WaveformType::Saw };
    WaveformType waveB { WaveformType::Warm };
    float pitchHz { 65.41f };       // Base pitch (C2 = 65.41, G2 = 98.00)
    float beatHz { 0.35f };         // Sub-Hz acoustic beating offset
    float detuneCents { 2.5f };     // Microtonal cents detune
    float foldPercent { 45.0f };    // 0 to 100%
    float cutoffHz { 680.0f };      // 4-pole filter cutoff
    float resonance { 3.5f };       // R in [0.5, 12.0] -> Q = sqrt(R)
    float lfoRate { 0.12f };        // LFO rate in Hz
    float lfoDepth { 180.0f };      // LFO depth in Hz
    float volume { 0.55f };         // Output volume
    bool isSubBass { false };       // Sub-bass stabilization mode (Voice 1)
    bool active { false };
};

// ============================================================================
// SubBassDcBlocker: 1-Pole Infrasonic High-Pass Filter (~15 Hz)
// Eliminates DC drift and infrasonic offset from asymmetric waveshaping.
// Difference equation: y[n] = x[n] - x[n-1] + R * y[n-1]
// with R = 1.0f - (2.0f * kPi * 15.0f / mSampleRate)
// ============================================================================
class SubBassDcBlocker {
public:
    void reset() noexcept {
        mX1 = 0.0f;
        mY1 = 0.0f;
    }

    void setSampleRate(float sampleRate, float cutoffHz = 15.0f) noexcept {
        const float fs = (sampleRate > 100.0f) ? sampleRate : 48000.0f;
        const float safeCutoff = (cutoffHz > 0.1f && cutoffHz < fs * 0.25f) ? cutoffHz : 15.0f;
        const float rRaw = 1.0f - (kTwoPi * safeCutoff / fs);
        // Ensure R is strictly within [0.0f, 1.0f) to guarantee filter stability across 44.1 - 192+ kHz
        mR = std::clamp(rRaw, 0.0f, 0.99995f);
    }

    inline float process(float x) noexcept {
        const float cleanX = flushDenormal(x);
        const float prevY = flushDenormal(mY1);
        const float y = cleanX - mX1 + mR * prevY;
        mX1 = cleanX;
        mY1 = flushDenormal(y);
        return mY1;
    }

    float getR() const noexcept { return mR; }

private:
    float mR { 0.998038f }; // Default for 48 kHz: 1.0f - (2.0f * kPi * 15.0f / 48000.0f)
    float mX1 { 0.0f };
    float mY1 { 0.0f };
};

// ============================================================================
// SolarDroneVoice: Elta Solar 42n Inspired Microtonal Drone Voice
// ============================================================================
class SolarDroneVoice {
public:
    void prepare(double sampleRate, const WavetableBank* wavetables, int voiceId) noexcept {
        mSampleRate = static_cast<float>(sampleRate > 100.0 ? sampleRate : 48000.0);
        mWavetables = wavetables;
        mVoiceId = voiceId;

        mPan = (voiceId == 1) ? -0.45f : 0.45f;
        const float defaultFreq = (voiceId == 1) ? 65.41f : 98.00f; // C2 or G2
        const float defaultBeat = (voiceId == 1) ? 0.35f : 0.65f;
        const float defaultDetune = (voiceId == 1) ? 2.5f : -3.2f;

        mFreqSmoother.setSampleRate(mSampleRate);
        mFreqSmoother.setTimeConstant(0.040f);
        mFreqSmoother.reset(defaultFreq);

        mCutoffSmoother.setSampleRate(mSampleRate);
        mCutoffSmoother.setTimeConstant(0.025f);
        mCutoffSmoother.reset(680.0f);

        mGainSmoother.setSampleRate(mSampleRate);
        mGainSmoother.setTimeConstant(0.030f);
        mGainSmoother.reset(0.55f);

        mResonanceSmoother.setSampleRate(mSampleRate);
        mResonanceSmoother.setTimeConstant(0.025f);
        mResonanceSmoother.reset(3.5f);

        mFoldSmoother.setSampleRate(mSampleRate);
        mFoldSmoother.setTimeConstant(0.025f);
        mFoldSmoother.reset(45.0f);

        mBeatHz = defaultBeat;
        mDetuneCents = defaultDetune;

        // Pillar 3: Sub-Bass DC-Blocker / Infrasonic High-Pass initialization (~15 Hz)
        mSubBassDcBlocker.setSampleRate(mSampleRate, 15.0f);

        reset();
    }

    void setPortamentoTime(float timeSec) noexcept {
        mFreqSmoother.setTimeConstant(timeSec);
    }

    void reset() noexcept {
        mPhaseA = 0.0f;
        mPhaseB = 0.0f;
        mLfoPhase = 0.0f;
        mFilter1.reset();
        mFilter2.reset();
        mFilterSubBlockCounter = 0;
        mDeclickSamples = 0;
        mDeclickGain = 1.0f;
        mActiveIsSubBass = false;
        mTargetIsSubBass = false;
        mHasSounded = false;
        mSubBassDcBlocker.reset();
    }

    void triggerDeclick(float crossfadeTimeSec = 0.025f) noexcept {
        const uint32_t samples = static_cast<uint32_t>(crossfadeTimeSec * mSampleRate);
        mDeclickSamplesTotal = std::max(2u, (samples + 1u) & ~1u);
        mDeclickSamples = mDeclickSamplesTotal;
    }

    bool isSubBassActive() const noexcept { return mActiveIsSubBass; }

    inline void processSample(const DroneVoiceParams& params, float& outL, float& outR) noexcept {
        if (!params.active) {
            mHasSounded = false;
            return;
        }

        // Dynamic Sub-Bass mode transition detection
        if (params.isSubBass != mTargetIsSubBass) {
            mTargetIsSubBass = params.isSubBass;
            if (!mHasSounded) {
                // First sound block: immediately engage requested mode without declick delay
                mActiveIsSubBass = params.isSubBass;
                mDeclickSamples = 0;
                mDeclickGain = 1.0f;
            } else if (mDeclickSamples == 0) {
                // Active drone sounding: trigger Hann declick dip to swap modes at zero gain
                triggerDeclick(0.025f);
            } else {
                // Declick already in progress: reverse envelope smoothly without gain jump
                mDeclickSamples = mDeclickSamplesTotal - mDeclickSamples;
            }
        }
        mHasSounded = true;

        // Advance declick crossfader and perform atomic mode switch at silence trough
        if (mDeclickSamples > 0) {
            --mDeclickSamples;
            const float progress = 1.0f - static_cast<float>(mDeclickSamples) / static_cast<float>(mDeclickSamplesTotal);
            // Switch mode at silence trough (progress >= 0.5f, gain == 0.0f)
            if (progress >= 0.5f && mActiveIsSubBass != mTargetIsSubBass) {
                mActiveIsSubBass = mTargetIsSubBass;
                if (mActiveIsSubBass) {
                    // Pillar 1: Phase Locking: sync oscillator B to oscillator A at zero gain
                    mPhaseB = mPhaseA;
                }
                // Flush filter states and force immediate coefficient recalculation at zero gain
                mFilter1.reset();
                mFilter2.reset();
                mFilterSubBlockCounter = 0;
                mSubBassDcBlocker.reset();
            }
            // Dip to silence and rise back up: C1 raised-cosine Hann dip (1.0 -> 0.0 -> 1.0)
            mDeclickGain = 0.5f * (1.0f + std::cos(kTwoPi * progress));
        } else {
            mActiveIsSubBass = mTargetIsSubBass;
            mDeclickGain = 1.0f;
        }

        // 1. Parameter updates with smoothing
        mFreqSmoother.setTarget(params.pitchHz);
        mCutoffSmoother.setTarget(params.cutoffHz);
        mGainSmoother.setTarget(params.volume);
        mResonanceSmoother.setTarget(std::clamp(params.resonance, 0.5f, 12.0f));
        mFoldSmoother.setTarget(std::clamp(params.foldPercent, 0.0f, 100.0f));

        const float baseFreq = mFreqSmoother.next();
        const float baseCutoff = mCutoffSmoother.next();
        const float currentGain = mGainSmoother.next();
        const float currentResonance = mResonanceSmoother.next();
        const float currentFoldPercent = mFoldSmoother.next();

        // 2. Routing and Stabilization Dispatch
        float freqA = 0.0f;
        float freqB = 0.0f;
        float filterCutoff = 0.0f;
        float filterResonance = 0.0f;
        float foldDrive = 0.0f;
        float foldAmount = 0.0f;
        float effectivePan = mPan;
        float gainTrim = 1.0f;

        // Advance LFO phase continuously to maintain state across mode toggles
        mLfoPhase += params.lfoRate / mSampleRate;
        if (mLfoPhase >= 1.0f) mLfoPhase -= 1.0f;

        if (mActiveIsSubBass) {
            // Apply Sub-Bass Stabilization Subsystem (Formal 6-Pillar Architecture)
            applySubBassStabilization(params, baseFreq, baseCutoff, currentFoldPercent,
                                      freqA, freqB, filterCutoff, filterResonance,
                                      foldDrive, foldAmount, effectivePan, gainTrim);
        } else {
            // Standard Drone Voice Path: microtonal beating, cents detuning, and LFO modulation
            freqA = baseFreq;
            freqB = (baseFreq + params.beatHz) * std::pow(2.0f, params.detuneCents / 1200.0f);

            // LFO filter cutoff modulation (organic breathing movement)
            const float lfoSine = std::sin(kTwoPi * mLfoPhase);
            const float maxSafeDepth = std::max(0.0f, (baseCutoff - 30.0f) * 0.85f);
            const float effectiveDepth = std::min(params.lfoDepth, maxSafeDepth);
            filterCutoff = std::max(25.5f, baseCutoff + lfoSine * effectiveDepth);

            filterResonance = currentResonance;
            foldDrive = std::clamp(1.0f + currentFoldPercent / 50.0f, 0.5f, 4.0f);
            foldAmount = std::clamp(currentFoldPercent / 100.0f, 0.0f, 1.0f);
            effectivePan = mPan;
            gainTrim = 1.0f;
        }

        // 3. Advance oscillator phases
        mPhaseA += freqA / mSampleRate;
        if (mPhaseA >= 1.0f) mPhaseA -= 1.0f;
        mPhaseB += freqB / mSampleRate;
        if (mPhaseB >= 1.0f) mPhaseB -= 1.0f;

        // Oscillators with 0.5 gain each
        const float oscA = mWavetables->readSample(params.waveA, mPhaseA) * 0.5f;
        const float oscB = mWavetables->readSample(params.waveB, mPhaseB) * 0.5f;

        // 4. Square wave wavefolder bypass routing:
        // Square waves route directly to filter1 rather than folding,
        // which would cancel the fundamental and create harsh buzzing needle whining.
        const bool isSquareA = (params.waveA == WaveformType::Square);
        const bool isSquareB = (params.waveB == WaveformType::Square);

        const float shaperA = isSquareA ? 0.0f : oscA;
        const float directA = isSquareA ? oscA : 0.0f;
        const float shaperB = isSquareB ? 0.0f : oscB;
        const float directB = isSquareB ? oscB : 0.0f;

        const float shaperIn = shaperA + shaperB;
        const float directIn = directA + directB;

        // 5. Waveshaper stage:
        // Sub-bass mode uses Monotonic Soft-Knee Saturation (Pillar 6)
        // Standard mode uses West-Coast polynomial wavefolding
        float foldedOut = 0.0f;
        if (!isSquareA || !isSquareB) {
            if (mActiveIsSubBass) {
                // Pillar 6: Monotonic Soft-Knee Saturation replaces wavefolder
                const float norm = std::tanh(foldDrive);
                foldedOut = applySmoothBoundaryKnee(std::tanh(foldDrive * shaperIn) / (norm > 0.0001f ? norm : 1.0f), 0.70f);
            } else {
                foldedOut = wavefold(shaperIn, foldDrive, foldAmount);
            }
        }

        const float combinedFilterInput = foldedOut + directIn;

        // 6. 4-Pole Resonant Ladder Filter (cascaded dual biquad with Q = sqrt(R))
        if (mFilterSubBlockCounter == 0) {
            const float q = std::sqrt(filterResonance);
            mFilter1.configure(Biquad::Type::Lowpass, mSampleRate, filterCutoff, q);
            mFilter2.copyCoefficientsFrom(mFilter1);
            mFilterSubBlockCounter = kFilterSubBlockSize - 1;
        } else {
            --mFilterSubBlockCounter;
        }

        const float f1 = mFilter1.process(combinedFilterInput);
        const float f2 = mFilter2.process(f1);

        // 7. Apply smoothed gain and declick crossfader
        const float voiceOut = f2 * currentGain * gainTrim * mDeclickGain;

        // 8. Pillar 3: Sub-Bass DC-Blocker / Infrasonic High-Pass (~15 Hz)
        // Eliminates DC offset and infrasonic drift from asymmetric saturation.
        // Always processed to keep filter state warm and prevent activation pops.
        const float blockedVoiceOut = mSubBassDcBlocker.process(voiceOut);
        const float finalVoiceOut = mActiveIsSubBass ? blockedVoiceOut : voiceOut;

        // 9. Pillar 2: Stereo Monofication & constant power panning
        // Sub-bass mode sets effectivePan = 0.0f (mono center); standard mode uses mPan.
        const float panNorm = (effectivePan + 1.0f) * 0.5f; // 0.0 (left) to 1.0 (right)
        const float leftGain = std::cos(kHalfPi * panNorm);
        const float rightGain = std::sin(kHalfPi * panNorm);

        outL += finalVoiceOut * leftGain;
        outR += finalVoiceOut * rightGain;
    }

private:
    /**
     * Sub-Bass Stabilization Subsystem (Voice 1 Specialization)
     *
     * Formalizes the 6 architectural stabilization pillars required to anchor
     * the sub-bass foundation (32.7 Hz C1) with maximum punch, absolute phase
     * coherence, and zero resonant or infrasonic artifacts:
     *
     * Pillar 1: Phase Locking
     *   Forces zero beat offset (0.0 Hz) and zero microtonal detune (0.0 cents)
     *   between twin oscillators A and B (outFreqA = outFreqB = baseFreq).
     *   Guarantees perfect phase coherence and prevents acoustic comb filtering
     *   or destructive phase cancellation in the sub-bass region.
     *
     * Pillar 2: Stereo Monofication
     *   Forces outPan = 0.0f (dead center), overriding the default Voice 1 pan
     *   (-0.45f). Sub-bass energy (< 140 Hz) must be centered to conserve headroom,
     *   prevent speaker over-excursion, maintain vinyl cutting compatibility, and
     *   deliver solid acoustic impact across mono subwoofers and club PA systems.
     *
     * Pillar 3: Sub-Bass DC-Blocker / Infrasonic High-Pass
     *   Integrated via mSubBassDcBlocker (1-pole recursive high-pass at ~15 Hz,
     *   y[n] = x[n] - x[n-1] + R * y[n-1]). Strips sub-audible DC drift and infrasonic
     *   instability introduced by asymmetric waveshaping before stereo distribution.
     *
     * Pillar 4: Maximally Flat Resonance Damping
     *   Clamps filter resonance to R = 0.5f, which yields the critically damped
     *   Butterworth response Q = sqrt(0.5) ≈ 0.7071. Eliminates boomy resonant peaks
     *   and excessive ringing around the cutoff frequency.
     *
     * Pillar 5: Low-Pass Ceiling
     *   Caps filter cutoff at 140.0 Hz (min(baseCutoff, 140.0f)), isolating the voice
     *   to the low-frequency realm and preventing harmonic clutter from masking
     *   melodic voices or felt piano.
     *
     * Pillar 6: Monotonic Soft-Knee Saturation
     *   Replaces polynomial wavefolding with monotonic hyperbolic tangent saturation
     *   and a smooth C1 Hermite knee (knee = 0.70f). Standard wavefolding reflects
     *   and flips the waveform, which destroys the 32.7 Hz fundamental; soft-knee
     *   saturation preserves the fundamental while introducing musical odd harmonics.
     *
     * Equal-Loudness Gain Compensation:
     *   Applies a +4.6 dB (1.70x) equal-loudness boost (outGainTrim = 1.70f) to compensate
     *   for human ear insensitivity in the sub-bass spectrum (ISO 226 / Fletcher-Munson).
     */
    void applySubBassStabilization(const DroneVoiceParams& params,
                                   float baseFreq, float baseCutoff, float currentFold,
                                   float& outFreqA, float& outFreqB,
                                   float& outCutoff, float& outResonance,
                                   float& outFoldDrive, float& outFoldAmount,
                                   float& outPan, float& outGainTrim) noexcept {
        (void)params; // Forward compatibility

        // Pillar 1: Phase Locking (forces 0.0 Hz beat offset and 0.0 cents detune)
        outFreqA = baseFreq;
        outFreqB = baseFreq;

        // Pillar 2: Stereo Monofication (sub-bass must be centered, overriding -0.45f)
        outPan = 0.0f;

        // Pillar 4: Maximally Flat Resonance Damping (Butterworth Q = sqrt(0.5) ≈ 0.7071)
        outResonance = 0.5f;

        // Pillar 5: Low-Pass Ceiling (caps cutoff at 140.0 Hz, bounded above Nyquist floor)
        outCutoff = std::clamp(baseCutoff, 25.5f, 140.0f);

        // Pillar 6: Monotonic Soft-Knee Saturation parameters
        outFoldAmount = std::clamp(currentFold / 100.0f, 0.0f, 1.0f);
        outFoldDrive = 1.25f + outFoldAmount * 0.45f;

        // Equal-Loudness Boost (+4.6 dB / 1.70x)
        outGainTrim = 1.70f;
    }

    float mSampleRate { 48000.0f };
    const WavetableBank* mWavetables { nullptr };
    int mVoiceId { 1 };
    float mPan { -0.45f };

    float mPhaseA { 0.0f };
    float mPhaseB { 0.0f };
    float mLfoPhase { 0.0f };

    float mBeatHz { 0.35f };
    float mDetuneCents { 2.5f };

    OnePoleSmoother mFreqSmoother;
    OnePoleSmoother mCutoffSmoother;
    OnePoleSmoother mGainSmoother;
    OnePoleSmoother mResonanceSmoother;
    OnePoleSmoother mFoldSmoother;

    Biquad mFilter1;
    Biquad mFilter2;

    static constexpr uint32_t kFilterSubBlockSize = 16;
    uint32_t mFilterSubBlockCounter { 0 };

    uint32_t mDeclickSamples { 0 };
    uint32_t mDeclickSamplesTotal { 1200 };
    float mDeclickGain { 1.0f };

    bool mActiveIsSubBass { false };
    bool mTargetIsSubBass { false };
    bool mHasSounded { false };

    // Pillar 3: Infrasonic DC-Blocker (1-Pole High-Pass at ~15 Hz)
    SubBassDcBlocker mSubBassDcBlocker;
};

} // namespace braun
