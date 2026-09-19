#pragma once

#include "DspMath.h"
#include "TailModulator.h"
#include <vector>
#include <array>
#include <cmath>
#include <algorithm>

namespace braun {

struct ShimmerReverbParams {
    float decaySec { 8.5f };       // RT60 in seconds (0.5 to 25.0)
    float damping { 0.60f };       // Air absorption (0.05 to 0.98)
    float shimmer { 0.45f };       // Octave-up shimmer amount (0.0 to 1.0)
    float mix { 0.45f };           // Wet level (0.0 to 1.0)
    bool freeze { false };         // Infinite freeze hold
};

// ============================================================================
// Dual-Delay Real-Time +12 Semitones (+1 Octave) Pitch Shifter
// Window = 45 ms, downward ramp period T = 45 ms, Hann raised-cosine windows,
// 4-point 3rd-order Catmull-Rom Hermite interpolation with C1 continuity
// ============================================================================
class DualDelayPitchShifter {
public:
    void prepare(double sampleRate) {
        mSampleRate = static_cast<float>(sampleRate > 100.0 ? sampleRate : 48000.0);
        mWindowSec = 0.045f; // 45 ms
        mPeriodSamples = std::max(64, static_cast<int>(mWindowSec * mSampleRate));
        mMaxDelaySamples = static_cast<size_t>(mPeriodSamples * 3);

        mDelayBuffer.assign(mMaxDelaySamples, 0.0f);
        mWriteIndex = 0;
        mPhase = 0.0f;
        mPhaseInc = 1.0f / static_cast<float>(mPeriodSamples);
    }

    void reset() noexcept {
        std::fill(mDelayBuffer.begin(), mDelayBuffer.end(), 0.0f);
        mWriteIndex = 0;
        mPhase = 0.0f;
    }

    inline float processSample(float input) noexcept {
        const size_t bufSize = mDelayBuffer.size();
        mDelayBuffer[mWriteIndex] = flushDenormal(input);

        const float phase1 = mPhase;
        const float phase2 = (phase1 >= 0.5f) ? (phase1 - 0.5f) : (phase1 + 0.5f);

        // Downward delay ramps with 2-sample safety margin for 4-point Hermite cubic stencil
        constexpr float kMinDelayMargin = 2.0f;
        const float delaySamples1 = kMinDelayMargin + mWindowSec * (1.0f - phase1) * mSampleRate;
        const float delaySamples2 = kMinDelayMargin + mWindowSec * (1.0f - phase2) * mSampleRate;

        // Constant-amplitude Hann raised-cosine crossfade windows:
        // sin^2(theta) + cos^2(theta) = 1.0 (zero amplitude dip, C1 smooth derivative)
        const float s1 = std::sin(kPi * phase1);
        const float s2 = std::sin(kPi * phase2);
        const float gain1 = s1 * s1;
        const float gain2 = s2 * s2;

        const float readIdx1 = static_cast<float>(mWriteIndex) - delaySamples1;
        const float readIdx2 = static_cast<float>(mWriteIndex) - delaySamples2;

        const float out1 = readHermite(readIdx1, bufSize);
        const float out2 = readHermite(readIdx2, bufSize);

        // Advance phase
        mPhase += mPhaseInc;
        if (mPhase >= 1.0f) mPhase -= 1.0f;

        mWriteIndex = (mWriteIndex + 1) % bufSize;

        return flushDenormal(gain1 * out1 + gain2 * out2);
    }

private:
    inline float readHermite(float idx, size_t size) const noexcept {
        const float sz = static_cast<float>(size);
        while (idx < 0.0f) idx += sz;
        while (idx >= sz) idx -= sz;

        const int i0 = static_cast<int>(std::floor(idx));
        const float frac = idx - static_cast<float>(i0);

        const size_t im1 = (i0 > 0) ? static_cast<size_t>(i0 - 1) : (size - 1);
        const size_t i0_m = static_cast<size_t>(i0);
        const size_t i1  = (i0_m + 1 < size) ? (i0_m + 1) : 0;
        const size_t i2  = (i1 + 1 < size) ? (i1 + 1) : 0;

        const float ym1 = mDelayBuffer[im1];
        const float y0  = mDelayBuffer[i0_m];
        const float y1  = mDelayBuffer[i1];
        const float y2  = mDelayBuffer[i2];

        return interpolateHermite4P3O(ym1, y0, y1, y2, frac);
    }

    float mSampleRate { 48000.0f };
    float mWindowSec { 0.045f };
    int mPeriodSamples { 2160 };
    size_t mMaxDelaySamples { 6480 };
    std::vector<float> mDelayBuffer;
    size_t mWriteIndex { 0 };
    float mPhase { 0.0f };
    float mPhaseInc { 0.0f };
};

// ============================================================================
// ShimmerReverbDsp: High-Diffusion Velvet/FDN Reverb with +12st Shimmer & Freeze
// ============================================================================
class ShimmerReverbDsp {
public:
    static constexpr size_t kNumFdnLines = 8;
    static constexpr size_t kNumAllpass = 4;
    static constexpr size_t kFdnCapacity = 32768;
    static constexpr size_t kFdnMask = kFdnCapacity - 1;

    void prepare(double sampleRate) {
        mSampleRate = static_cast<float>(sampleRate > 100.0 ? sampleRate : 48000.0);

        // 1. Prepare Dual Pitch Shifters (True Stereo)
        mPitchShifterL.prepare(mSampleRate);
        mPitchShifterR.prepare(mSampleRate);

        // 2. Prepare Shimmer Bandpass Filters (1600 Hz, Q = 0.85)
        mShimmerBandpassL.configure(Biquad::Type::Bandpass, mSampleRate, 1600.0f, 0.85f);
        mShimmerBandpassR.configure(Biquad::Type::Bandpass, mSampleRate, 1600.0f, 0.85f);

        // 3. Prepare Real-Time Air Damping Filter (Butterworth 0.7071)
        const float initDampingHz = calculateDampingCutoff(0.60f);
        mAirDampingFilterL.configure(Biquad::Type::Lowpass, mSampleRate, initDampingHz, 0.7071f);
        mAirDampingFilterR.configure(Biquad::Type::Lowpass, mSampleRate, initDampingHz, 0.7071f);

        // 4. Prepare Early Reflection Taps Buffer (10 prime-spaced taps up to 130 ms)
        mEarlyDelaySamples = static_cast<size_t>(mSampleRate * 0.140f) + 128;
        mEarlyBufferL.assign(mEarlyDelaySamples, 0.0f);
        mEarlyBufferR.assign(mEarlyDelaySamples, 0.0f);
        mEarlyWriteIndex = 0;

        // 5. Prepare High-Diffusion FDN Delay Lines with Tail Modulator
        mTailModulator.prepare(mSampleRate);
        mTailModulator.setParameters(0.45f, 0.35f, 120.0f);

        // Scaled to match 48 kHz base delays
        const float scale = mSampleRate / 48000.0f;
        for (size_t i = 0; i < kNumFdnLines; ++i) {
            mFdnLengths[i] = static_cast<size_t>(std::round(kBaseFdnLengths[i] * scale));
            mFdnBuffers[i].assign(kFdnCapacity, 0.0f);
            mFdnWriteIndices[i] = 0;
            mFdnFilterStates[i] = 0.0f;
            mFdnDcBlockers[i].setCutoff(5.0f, mSampleRate);
        }

        // 6. Prepare Allpass Diffusers
        for (size_t i = 0; i < kNumAllpass; ++i) {
            mAllpassLengths[i] = static_cast<size_t>(std::round(kBaseAllpassLengths[i] * scale));
            mAllpassBuffers[i].assign(mAllpassLengths[i] + 16, 0.0f);
            mAllpassWriteIndices[i] = 0;
        }

        // 7. Prepare Infinite Freeze Matrix (387ms Left, 491ms Right, 3200Hz LPF)
        mFreezeDelaySamplesL = static_cast<size_t>(mSampleRate * 0.387f);
        mFreezeDelaySamplesR = static_cast<size_t>(mSampleRate * 0.491f);
        mFreezeBufferL.assign(mFreezeDelaySamplesL + 64, 0.0f);
        mFreezeBufferR.assign(mFreezeDelaySamplesR + 64, 0.0f);
        mFreezeWriteIndexL = 0;
        mFreezeWriteIndexR = 0;

        mFreezeFilterL.configure(Biquad::Type::Lowpass, mSampleRate, 3200.0f, 0.7071f);
        mFreezeFilterR.configure(Biquad::Type::Lowpass, mSampleRate, 3200.0f, 0.7071f);
        mFreezeHpFilterL.configure(Biquad::Type::Highpass, mSampleRate, 75.0f, 0.7071f);
        mFreezeHpFilterR.configure(Biquad::Type::Highpass, mSampleRate, 75.0f, 0.7071f);

        mFreezeFeedbackSmoother.setSampleRate(mSampleRate);
        mFreezeFeedbackSmoother.setTimeConstant(0.080f);
        mFreezeFeedbackSmoother.reset(0.0f);

        mFreezeWetSmoother.setSampleRate(mSampleRate);
        mFreezeWetSmoother.setTimeConstant(0.080f);
        mFreezeWetSmoother.reset(0.0f);

        mFreezeInputSmoother.setSampleRate(mSampleRate);
        mFreezeInputSmoother.setTimeConstant(0.100f);
        mFreezeInputSmoother.reset(1.0f);

        mDampingSmoother.setSampleRate(mSampleRate);
        mDampingSmoother.setTimeConstant(0.025f);
        mDampingSmoother.reset(initDampingHz);

        mShimmerSendSmoother.setSampleRate(mSampleRate);
        mShimmerSendSmoother.setTimeConstant(0.025f);
        mShimmerSendSmoother.reset(0.45f * 0.90f);

        mShimmerFeedbackSmoother.setSampleRate(mSampleRate);
        mShimmerFeedbackSmoother.setTimeConstant(0.025f);
        mShimmerFeedbackSmoother.reset(0.38f);

        mMixSmoother.setSampleRate(mSampleRate);
        mMixSmoother.setTimeConstant(0.025f);
        mMixSmoother.reset(0.45f);

        mCachedDecaySec = -1.0f;
        updateDecayMultipliers(8.5f);

        reset();
    }

    inline void updateDecayMultipliers(float decaySec) noexcept {
        mCachedDecaySec = decaySec;
        const float tau = std::max(0.1f, decaySec / 6.907755f);
        for (size_t i = 0; i < kNumFdnLines; ++i) {
            const float delayTimeSec = static_cast<float>(mFdnLengths[i]) / mSampleRate;
            mCachedDecayMul[i] = std::exp(-delayTimeSec / tau);
        }
    }

    void setDecayTime(float decaySec) noexcept {
        updateDecayMultipliers(decaySec);
    }

    TailModulator& getTailModulator() noexcept { return mTailModulator; }
    const TailModulator& getTailModulator() const noexcept { return mTailModulator; }
    void setTailModulation(float rateHz, float depthMs, float bloomMs = 85.0f) noexcept {
        mTailModulator.setParameters(rateHz, depthMs, bloomMs);
    }

    void reset() noexcept {
        mFilterSubBlockCounter = 0;
        mPitchShifterL.reset();
        mPitchShifterR.reset();
        mShimmerBandpassL.reset();
        mShimmerBandpassR.reset();
        mAirDampingFilterL.reset();
        mAirDampingFilterR.reset();

        std::fill(mEarlyBufferL.begin(), mEarlyBufferL.end(), 0.0f);
        std::fill(mEarlyBufferR.begin(), mEarlyBufferR.end(), 0.0f);
        mEarlyWriteIndex = 0;

        mTailModulator.reset();

        for (size_t i = 0; i < kNumFdnLines; ++i) {
            std::fill(mFdnBuffers[i].begin(), mFdnBuffers[i].end(), 0.0f);
            mFdnWriteIndices[i] = 0;
            mFdnFilterStates[i] = 0.0f;
            mFdnDcBlockers[i].reset();
        }

        for (size_t i = 0; i < kNumAllpass; ++i) {
            std::fill(mAllpassBuffers[i].begin(), mAllpassBuffers[i].end(), 0.0f);
            mAllpassWriteIndices[i] = 0;
        }

        std::fill(mFreezeBufferL.begin(), mFreezeBufferL.end(), 0.0f);
        std::fill(mFreezeBufferR.begin(), mFreezeBufferR.end(), 0.0f);
        mFreezeWriteIndexL = 0;
        mFreezeWriteIndexR = 0;
        mFreezeFilterL.reset();
        mFreezeFilterR.reset();
        mFreezeHpFilterL.reset();
        mFreezeHpFilterR.reset();
        mWasFrozen = false;

        mShimmerFeedbackL = 0.0f;
        mShimmerFeedbackR = 0.0f;
    }

    inline void processSample(float inL, float inR, const ShimmerReverbParams& params,
                              float& outL, float& outR) noexcept {
        // 1. Damping frequency update
        const float targetDampingHz = calculateDampingCutoff(params.damping);
        mDampingSmoother.setTarget(targetDampingHz);
        const float curDampingHz = mDampingSmoother.next();

        if (mFilterSubBlockCounter == 0) {
            mAirDampingFilterL.configure(Biquad::Type::Lowpass, mSampleRate, curDampingHz, 0.7071f);
            mAirDampingFilterR.copyCoefficientsFrom(mAirDampingFilterL);
            mFilterSubBlockCounter = kFilterSubBlockSize - 1;
        } else {
            --mFilterSubBlockCounter;
        }

        const float targetMix = std::clamp(params.mix, 0.0f, 1.0f);
        mMixSmoother.setTarget(targetMix);
        const float curMix = mMixSmoother.next();

        // 2. Shimmer feedback parameter computation
        const float decayScale = std::clamp(params.decaySec / 8.5f, 0.70f, 1.25f);
        const float targetShimmerSend = params.shimmer * 0.90f;
        const float targetShimmerFb = std::min(0.70f, (0.20f + params.shimmer * 0.40f) * decayScale);
        mShimmerSendSmoother.setTarget(targetShimmerSend);
        mShimmerFeedbackSmoother.setTarget(targetShimmerFb);
        const float curShimmerSend = mShimmerSendSmoother.next();
        const float curShimmerFb = mShimmerFeedbackSmoother.next();

        // 3. Freeze parameters update: contractive bounding (0.988f) & smooth clickless transitions
        if (params.freeze) {
            mFreezeFeedbackSmoother.setTimeConstant(0.050f);
            mFreezeFeedbackSmoother.setTarget(0.988f);
            mFreezeWetSmoother.setTimeConstant(0.050f);
            mFreezeWetSmoother.setTarget(0.85f);
            mFreezeInputSmoother.setTimeConstant(0.080f);
            mFreezeInputSmoother.setTarget(0.08f);
        } else {
            mFreezeFeedbackSmoother.setTimeConstant(0.025f);
            mFreezeFeedbackSmoother.setTarget(0.0f);
            mFreezeWetSmoother.setTimeConstant(0.028f);
            mFreezeWetSmoother.setTarget(0.0f);
            mFreezeInputSmoother.setTimeConstant(0.030f);
            mFreezeInputSmoother.setTarget(1.0f);
        }
        mWasFrozen = params.freeze;

        const float freezeFb = mFreezeFeedbackSmoother.next();
        const float freezeWet = mFreezeWetSmoother.next();
        const float freezeInGain = mFreezeInputSmoother.next();

        // 4. Input mixing: input audio + true stereo shimmer feedback loop
        constexpr float kPreGain = 0.85f;
        const float reverbInputL = (inL * kPreGain + mShimmerFeedbackL) * freezeInGain;
        const float reverbInputR = (inR * kPreGain + mShimmerFeedbackR) * freezeInGain;

        // 5. Early Reflection Network (10 prime taps with true stereo input)
        mEarlyBufferL[mEarlyWriteIndex] = reverbInputL;
        mEarlyBufferR[mEarlyWriteIndex] = reverbInputR;

        float earlyL = 0.0f;
        float earlyR = 0.0f;

        for (size_t k = 0; k < kNumEarlyTaps; ++k) {
            const size_t tapDelay = static_cast<size_t>(kEarlyTapTimes[k] * mSampleRate);
            const size_t readIdx = (mEarlyWriteIndex + mEarlyDelaySamples - tapDelay) % mEarlyDelaySamples;
            const float tapL = mEarlyBufferL[readIdx] * (kEarlyGains[k] * 0.18f);
            const float tapR = mEarlyBufferR[readIdx] * (kEarlyGains[k] * 0.18f);
            const float pan = (k % 2 == 0) ? 0.70f : -0.70f;
            earlyL += tapL * (1.0f - pan * 0.5f);
            earlyR += tapR * (1.0f + pan * 0.5f);
        }

        mEarlyWriteIndex = (mEarlyWriteIndex + 1) % mEarlyDelaySamples;

        // 6. Allpass Diffuser Chain with stereo decorrelation
        float diffusedL = processAllpass(0, reverbInputL);
        diffusedL = processAllpass(2, diffusedL);
        float diffusedR = processAllpass(1, reverbInputR);
        diffusedR = processAllpass(3, diffusedR);

        // 7. Late Diffuse Tail FDN (8 Feedback Delay Lines with Golden-Ratio Modulation & Fast Walsh-Hadamard Transform)
        if (params.decaySec != mCachedDecaySec) {
            updateDecayMultipliers(params.decaySec);
        }

        // 7a. Calculate multi-phase golden-ratio modulation excursions
        const float transientIn = 0.5f * (std::abs(inL) + std::abs(inR));
        std::array<float, kNumFdnLines> excursions {};
        mTailModulator.processSample(transientIn, excursions);

        // 7b. Read delay lines with 4-point Hermite cubic interpolation and apply one-pole high-frequency shelf damping
        std::array<float, kNumFdnLines> fdnOutputs;
        const float damp = std::clamp(0.14f + params.damping * 0.38f, 0.14f, 0.58f);

        for (size_t i = 0; i < kNumFdnLines; ++i) {
            const float delaySamples = static_cast<float>(mFdnLengths[i]) + excursions[i];
            const float delayed = TailModulator::readHermite(mFdnBuffers[i].data(),
                                                             kFdnCapacity,
                                                             kFdnMask,
                                                             mFdnWriteIndices[i],
                                                             delaySamples);
            // Gentle high-frequency one-pole shelf: y[n] = (1-d)*x[n] + d*y[n-1]
            mFdnFilterStates[i] = (1.0f - damp) * delayed + damp * mFdnFilterStates[i];
            const float filtered = flushDenormal(mFdnFilterStates[i]);

            fdnOutputs[i] = filtered * mCachedDecayMul[i];
        }

        // Apply 8-point Fast Walsh-Hadamard Transform for unitary, lossless all-to-all diffusion
        fwht8(fdnOutputs);

        // Balanced orthogonal Hadamard input distribution vector with 1/sqrt(8) energy preservation
        constexpr float kInvSqrt8 = 0.35355339f;
        const float inL_norm = diffusedL * kInvSqrt8;
        const float inR_norm = diffusedR * kInvSqrt8;
        const std::array<float, kNumFdnLines> inVector = {
            inL_norm, inR_norm, -inL_norm, -inR_norm, inL_norm, inR_norm, -inL_norm, -inR_norm
        };

        for (size_t i = 0; i < kNumFdnLines; ++i) {
            const float nextIn = inVector[i] + fdnOutputs[i];
            // Smooth C1 Hermite knee saturation in feedback loop prevents transient modal build-ups
            const float saturatedIn = applySmoothBoundaryKnee(nextIn, 0.72f);
            const float dcBlocked = mFdnDcBlockers[i].process(saturatedIn);
            mFdnBuffers[i][mFdnWriteIndices[i]] = flushDenormal(dcBlocked);
            mFdnWriteIndices[i] = (mFdnWriteIndices[i] + 1) & kFdnMask;
        }

        // Sum FDN into stereo channels (reformed Hadamard downmix with modal notch < 4.8 dB)
        // Replaces +/-1.0 anti-phase cancellation with complementary orthogonal weighting
        // (kOppScale = sqrt(2) - 1 approx 0.4142f) so lines 1, 3, 4, 6 are preserved in the
        // mono sum ((dampedL + dampedR) * 0.5f) while maintaining wide stereo decorrelation (>63%).
        constexpr float kOutScale = 0.35355339f * 1.05f;
        constexpr float kOppScale = 0.41421356f;
        const float lateL = (fdnOutputs[0] + fdnOutputs[1] + fdnOutputs[2] + fdnOutputs[3]
                           - kOppScale * fdnOutputs[4] - fdnOutputs[5] - kOppScale * fdnOutputs[6] - fdnOutputs[7]) * kOutScale;
        const float lateR = (fdnOutputs[0] - kOppScale * fdnOutputs[1] + fdnOutputs[2] - kOppScale * fdnOutputs[3]
                           + fdnOutputs[4] - fdnOutputs[5] + fdnOutputs[6] - fdnOutputs[7]) * kOutScale;

        // 8. Total Reverb Bus = Early + Late
        const float wetRawL = earlyL + lateL;
        const float wetRawR = earlyR + lateR;

        // 9. Real-Time Air Damping Filter on Wet Bus
        const float dampedL = mAirDampingFilterL.process(wetRawL);
        const float dampedR = mAirDampingFilterR.process(wetRawR);

        // 10. Infinite Freeze Recirculating Delay Loop
        // Left: 387ms, Right: 491ms, cross-coupled with 75Hz HPF, 3200Hz LPF, and 0.88 soft limiter
        const float freezeDelayedL = mFreezeBufferL[mFreezeWriteIndexL];
        const float freezeDelayedR = mFreezeBufferR[mFreezeWriteIndexR];

        // Dedicated 75 Hz sub-bass roll-off prevents sub-bass drone energy (<65-80 Hz) accumulation
        const float freezeHpL = mFreezeHpFilterL.process(freezeDelayedL);
        const float freezeHpR = mFreezeHpFilterR.process(freezeDelayedR);

        // 3200 Hz high frequency damping
        const float freezeFiltL = mFreezeFilterL.process(freezeHpL);
        const float freezeFiltR = mFreezeFilterR.process(freezeHpR);

        // Soft saturation bounds recirculating energy <= 0.88
        const float limitedL = freezeSoftLimit(freezeFiltL);
        const float limitedR = freezeSoftLimit(freezeFiltR);

        const float freezeInL = inL * freezeInGain + limitedR * freezeFb;
        const float freezeInR = inR * freezeInGain + limitedL * freezeFb;

        mFreezeBufferL[mFreezeWriteIndexL] = flushDenormal(freezeInL);
        mFreezeBufferR[mFreezeWriteIndexR] = flushDenormal(freezeInR);

        mFreezeWriteIndexL = (mFreezeWriteIndexL + 1) % mFreezeDelaySamplesL;
        mFreezeWriteIndexR = (mFreezeWriteIndexR + 1) % mFreezeDelaySamplesR;

        // 11. Shimmer Feedback Path (True Stereo): Left & Right channels processed independently
        if (curShimmerSend > 0.001f || std::abs(mShimmerFeedbackL) > 1.0e-5f || std::abs(mShimmerFeedbackR) > 1.0e-5f) {
            const float shimmerInL = dampedL * curShimmerSend;
            const float shimmerBandpassedL = mShimmerBandpassL.process(shimmerInL);
            const float pitchShiftedL = mPitchShifterL.processSample(shimmerBandpassedL);
            mShimmerFeedbackL = flushDenormal(applySmoothBoundaryKnee(pitchShiftedL * curShimmerFb, 0.70f));

            const float shimmerInR = dampedR * curShimmerSend;
            const float shimmerBandpassedR = mShimmerBandpassR.process(shimmerInR);
            const float pitchShiftedR = mPitchShifterR.processSample(shimmerBandpassedR);
            mShimmerFeedbackR = flushDenormal(applySmoothBoundaryKnee(pitchShiftedR * curShimmerFb, 0.70f));
        } else {
            mShimmerFeedbackL = 0.0f;
            mShimmerFeedbackR = 0.0f;
        }

        // 12. Combine Final Wet Output with Freeze and Wet Gain
        const float finalWetL = (dampedL + limitedL * freezeWet) * curMix;
        const float finalWetR = (dampedR + limitedR * freezeWet) * curMix;

        outL += finalWetL;
        outR += finalWetR;
    }

private:
    // 8-point Fast Walsh-Hadamard Transform for unitary, all-to-all lossless diffusion
    static inline void fwht8(std::array<float, kNumFdnLines>& a) noexcept {
        // Stage 1
        const float a0 = a[0] + a[1];
        const float a1 = a[0] - a[1];
        const float a2 = a[2] + a[3];
        const float a3 = a[2] - a[3];
        const float a4 = a[4] + a[5];
        const float a5 = a[4] - a[5];
        const float a6 = a[6] + a[7];
        const float a7 = a[6] - a[7];

        // Stage 2
        const float b0 = a0 + a2;
        const float b1 = a1 + a3;
        const float b2 = a0 - a2;
        const float b3 = a1 - a3;
        const float b4 = a4 + a6;
        const float b5 = a5 + a7;
        const float b6 = a4 - a6;
        const float b7 = a5 - a7;

        // Stage 3 & unitary normalization by 1/sqrt(8) = 0.35355339f
        constexpr float kNorm = 0.35355339f;
        a[0] = (b0 + b4) * kNorm;
        a[1] = (b1 + b5) * kNorm;
        a[2] = (b2 + b6) * kNorm;
        a[3] = (b3 + b7) * kNorm;
        a[4] = (b0 - b4) * kNorm;
        a[5] = (b1 - b5) * kNorm;
        a[6] = (b2 - b6) * kNorm;
        a[7] = (b3 - b7) * kNorm;
    }

    inline float calculateDampingCutoff(float damping) const noexcept {
        const float d = std::clamp(damping, 0.05f, 0.98f);
        constexpr float minCutoff = 1200.0f;
        constexpr float maxCutoff = 18000.0f;
        return maxCutoff * std::pow(minCutoff / maxCutoff, (d - 0.05f) / (0.98f - 0.05f));
    }

    inline float processAllpass(size_t index, float input) noexcept {
        const size_t len = mAllpassLengths[index];
        const size_t wIdx = mAllpassWriteIndices[index];
        const float delayed = mAllpassBuffers[index][wIdx];

        constexpr float g = 0.60f; // Allpass diffusion gain
        const float v = softLimit(input - g * delayed, 0.95f);
        const float out = delayed + g * v;

        mAllpassBuffers[index][wIdx] = flushDenormal(v);
        mAllpassWriteIndices[index] = (wIdx + 1) % len;
        return out;
    }

    float mSampleRate { 48000.0f };

    DualDelayPitchShifter mPitchShifterL;
    DualDelayPitchShifter mPitchShifterR;
    Biquad mShimmerBandpassL;
    Biquad mShimmerBandpassR;
    Biquad mAirDampingFilterL;
    Biquad mAirDampingFilterR;

    OnePoleSmoother mDampingSmoother;
    OnePoleSmoother mShimmerSendSmoother;
    OnePoleSmoother mShimmerFeedbackSmoother;
    OnePoleSmoother mMixSmoother;
    float mShimmerFeedbackL { 0.0f };
    float mShimmerFeedbackR { 0.0f };

    TailModulator mTailModulator;

    // Early reflection taps (10 prime taps)
    static constexpr size_t kNumEarlyTaps = 10;
    static constexpr std::array<float, kNumEarlyTaps> kEarlyTapTimes = {
        0.011f, 0.017f, 0.023f, 0.031f, 0.043f, 0.059f, 0.071f, 0.089f, 0.103f, 0.127f
    };
    static constexpr std::array<float, kNumEarlyTaps> kEarlyGains = {
        0.75f, -0.68f, 0.62f, -0.55f, 0.49f, -0.42f, 0.38f, -0.31f, 0.28f, -0.22f
    };
    size_t mEarlyDelaySamples { 8000 };
    std::vector<float> mEarlyBufferL;
    std::vector<float> mEarlyBufferR;
    size_t mEarlyWriteIndex { 0 };

    // FDN Delay Lines (8 prime lengths at 48kHz)
    static constexpr std::array<size_t, kNumFdnLines> kBaseFdnLengths = {
        1133, 1381, 1619, 1949, 2137, 2477, 2749, 3121
    };
    std::array<size_t, kNumFdnLines> mFdnLengths;
    std::array<std::vector<float>, kNumFdnLines> mFdnBuffers;
    std::array<size_t, kNumFdnLines> mFdnWriteIndices;
    std::array<float, kNumFdnLines> mFdnFilterStates;
    std::array<DcBlocker, kNumFdnLines> mFdnDcBlockers;

    // Allpass Diffusers (4 stages)
    static constexpr std::array<size_t, kNumAllpass> kBaseAllpassLengths = {
        227, 337, 449, 563
    };
    std::array<size_t, kNumAllpass> mAllpassLengths;
    std::array<std::vector<float>, kNumAllpass> mAllpassBuffers;
    std::array<size_t, kNumAllpass> mAllpassWriteIndices;

    // Freeze delay matrix
    size_t mFreezeDelaySamplesL { 18576 };
    size_t mFreezeDelaySamplesR = { 23568 };
    std::vector<float> mFreezeBufferL;
    std::vector<float> mFreezeBufferR;
    size_t mFreezeWriteIndexL { 0 };
    size_t mFreezeWriteIndexR { 0 };
    Biquad mFreezeFilterL;
    Biquad mFreezeFilterR;
    Biquad mFreezeHpFilterL;
    Biquad mFreezeHpFilterR;
    OnePoleSmoother mFreezeFeedbackSmoother;
    OnePoleSmoother mFreezeWetSmoother;
    OnePoleSmoother mFreezeInputSmoother;
    bool mWasFrozen { false };

    static inline float freezeSoftLimit(float x) noexcept {
        constexpr float kMaxLevel = 0.88f;
        const float scaled = x / kMaxLevel;
        return kMaxLevel * applySmoothBoundaryKnee(scaled, 0.70f);
    }

    static constexpr uint32_t kFilterSubBlockSize = 16;
    uint32_t mFilterSubBlockCounter { 0 };

    float mCachedDecaySec { -1.0f };
    std::array<float, kNumFdnLines> mCachedDecayMul { 0.0f };
};

} // namespace braun
