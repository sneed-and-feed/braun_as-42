#pragma once

#include "DspMath.h"
#include <vector>
#include <array>
#include <cmath>
#include <algorithm>

namespace braun {

struct ShimmerReverbParams {
    float decaySec { 7.5f };       // RT60 in seconds (0.5 to 25.0)
    float damping { 0.65f };       // Air absorption (0.05 to 0.98)
    float shimmer { 0.45f };       // Octave-up shimmer amount (0.0 to 1.0)
    float mix { 0.40f };           // Wet level (0.0 to 1.0)
    bool freeze { false };         // Infinite freeze hold
};

// ============================================================================
// Dual-Delay Real-Time +12 Semitones (+1 Octave) Pitch Shifter
// Window = 45 ms, downward ramp period T = 45 ms, constant-power sine windows
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
        mDelayBuffer[mWriteIndex] = input;

        const float phase1 = mPhase;
        const float phase2 = (phase1 >= 0.5f) ? (phase1 - 0.5f) : (phase1 + 0.5f);

        // Downward delay ramps (45 ms down to 0) for +1 octave shift
        const float delaySamples1 = mWindowSec * (1.0f - phase1) * mSampleRate;
        const float delaySamples2 = mWindowSec * (1.0f - phase2) * mSampleRate;

        // Constant-power sine crossfade windows: sin^2(theta) + cos^2(theta) = 1.0
        const float gain1 = std::sin(kPi * phase1);
        const float gain2 = std::sin(kPi * phase2);

        const float readIdx1 = static_cast<float>(mWriteIndex) - delaySamples1;
        const float readIdx2 = static_cast<float>(mWriteIndex) - delaySamples2;

        const float out1 = readLinear(readIdx1, bufSize);
        const float out2 = readLinear(readIdx2, bufSize);

        // Advance phase
        mPhase += mPhaseInc;
        if (mPhase >= 1.0f) mPhase -= 1.0f;

        mWriteIndex = (mWriteIndex + 1) % bufSize;

        return gain1 * out1 + gain2 * out2;
    }

private:
    inline float readLinear(float idx, size_t size) const noexcept {
        const float sz = static_cast<float>(size);
        while (idx < 0.0f) idx += sz;
        while (idx >= sz) idx -= sz;

        const size_t i0 = static_cast<size_t>(idx);
        const size_t i1 = (i0 + 1) % size;
        const float frac = idx - static_cast<float>(i0);

        return mDelayBuffer[i0] + frac * (mDelayBuffer[i1] - mDelayBuffer[i0]);
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
    void prepare(double sampleRate) {
        mSampleRate = static_cast<float>(sampleRate > 100.0 ? sampleRate : 48000.0);

        // 1. Prepare Pitch Shifter
        mPitchShifter.prepare(mSampleRate);

        // 2. Prepare Shimmer Bandpass Filter (1600 Hz, Q = 0.85)
        mShimmerBandpass.configure(Biquad::Type::Bandpass, mSampleRate, 1600.0f, 0.85f);

        // 3. Prepare Real-Time Air Damping Filter (Butterworth 0.7071)
        const float initDampingHz = calculateDampingCutoff(0.65f);
        mAirDampingFilterL.configure(Biquad::Type::Lowpass, mSampleRate, initDampingHz, 0.7071f);
        mAirDampingFilterR.configure(Biquad::Type::Lowpass, mSampleRate, initDampingHz, 0.7071f);

        // 4. Prepare Early Reflection Taps Buffer (10 prime-spaced taps up to 130 ms)
        mEarlyDelaySamples = static_cast<size_t>(mSampleRate * 0.140f) + 128;
        mEarlyBufferL.assign(mEarlyDelaySamples, 0.0f);
        mEarlyBufferR.assign(mEarlyDelaySamples, 0.0f);
        mEarlyWriteIndex = 0;

        // 5. Prepare High-Diffusion FDN Delay Lines (8 prime-spaced delay lines)
        // Scaled to match 48 kHz base delays
        const float scale = mSampleRate / 48000.0f;
        for (size_t i = 0; i < kNumFdnLines; ++i) {
            mFdnLengths[i] = static_cast<size_t>(std::round(kBaseFdnLengths[i] * scale));
            mFdnBuffers[i].assign(mFdnLengths[i] + 32, 0.0f);
            mFdnWriteIndices[i] = 0;
            mFdnFilterStates[i] = 0.0f;
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
        mShimmerFeedbackSmoother.reset(0.45f);

        reset();
    }

    void reset() noexcept {
        mPitchShifter.reset();
        mShimmerBandpass.reset();
        mAirDampingFilterL.reset();
        mAirDampingFilterR.reset();

        std::fill(mEarlyBufferL.begin(), mEarlyBufferL.end(), 0.0f);
        std::fill(mEarlyBufferR.begin(), mEarlyBufferR.end(), 0.0f);
        mEarlyWriteIndex = 0;

        for (size_t i = 0; i < kNumFdnLines; ++i) {
            std::fill(mFdnBuffers[i].begin(), mFdnBuffers[i].end(), 0.0f);
            mFdnWriteIndices[i] = 0;
            mFdnFilterStates[i] = 0.0f;
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

        mShimmerFeedbackSample = 0.0f;
    }

    inline void processSample(float inL, float inR, const ShimmerReverbParams& params,
                              float& outL, float& outR) noexcept {
        // 1. Damping frequency update
        const float targetDampingHz = calculateDampingCutoff(params.damping);
        mDampingSmoother.setTarget(targetDampingHz);
        const float curDampingHz = mDampingSmoother.next();
        mAirDampingFilterL.configure(Biquad::Type::Lowpass, mSampleRate, curDampingHz, 0.7071f);
        mAirDampingFilterR.configure(Biquad::Type::Lowpass, mSampleRate, curDampingHz, 0.7071f);

        // 2. Shimmer feedback parameter computation
        const float decayScale = std::clamp(params.decaySec / 8.5f, 0.70f, 1.35f);
        const float targetShimmerSend = params.shimmer * 0.90f;
        const float targetShimmerFb = std::min(0.75f, (0.20f + params.shimmer * 0.45f) * decayScale);
        mShimmerSendSmoother.setTarget(targetShimmerSend);
        mShimmerFeedbackSmoother.setTarget(targetShimmerFb);
        const float curShimmerSend = mShimmerSendSmoother.next();
        const float curShimmerFb = mShimmerFeedbackSmoother.next();

        // 3. Freeze parameters update
        mFreezeFeedbackSmoother.setTarget(params.freeze ? 0.992f : 0.0f);
        mFreezeWetSmoother.setTarget(params.freeze ? 0.85f : 0.0f);
        mFreezeInputSmoother.setTarget(params.freeze ? 0.12f : 1.0f);

        const float freezeFb = mFreezeFeedbackSmoother.next();
        const float freezeWet = mFreezeWetSmoother.next();
        const float freezeInGain = mFreezeInputSmoother.next();

        // 4. Input mixing: input audio + shimmer feedback loop
        constexpr float kPreGain = 0.85f;
        const float monoIn = (inL + inR) * 0.5f;
        const float reverbInput = (monoIn * kPreGain + mShimmerFeedbackSample) * freezeInGain;

        // 5. Early Reflection Network (10 prime taps)
        mEarlyBufferL[mEarlyWriteIndex] = reverbInput;
        mEarlyBufferR[mEarlyWriteIndex] = reverbInput;

        float earlyL = 0.0f;
        float earlyR = 0.0f;

        for (size_t k = 0; k < kNumEarlyTaps; ++k) {
            const size_t tapDelay = static_cast<size_t>(kEarlyTapTimes[k] * mSampleRate);
            const size_t readIdx = (mEarlyWriteIndex + mEarlyDelaySamples - tapDelay) % mEarlyDelaySamples;
            const float tapSample = mEarlyBufferL[readIdx] * kEarlyGains[k];
            const float pan = (k % 2 == 0) ? 0.70f : -0.70f;
            earlyL += tapSample * (1.0f - pan * 0.5f);
            earlyR += tapSample * (1.0f + pan * 0.5f);
        }

        mEarlyWriteIndex = (mEarlyWriteIndex + 1) % mEarlyDelaySamples;

        // 6. Allpass Diffuser Chain
        float diffused = reverbInput;
        for (size_t i = 0; i < kNumAllpass; ++i) {
            diffused = processAllpass(i, diffused);
        }

        // 7. Late Diffuse Tail FDN (8 Feedback Delay Lines with Householder matrix)
        // Decay time constant tau = decaySec / ln(1000) ~ decaySec / 6.91
        const float tau = std::max(0.1f, params.decaySec / 6.907755f);

        // Read delay lines and apply one-pole lowpass damping
        std::array<float, kNumFdnLines> fdnOutputs;
        float fdnSum = 0.0f;

        for (size_t i = 0; i < kNumFdnLines; ++i) {
            const float delayed = mFdnBuffers[i][mFdnWriteIndices[i]];
            // One-pole air absorption filter per delay line
            const float dampCoeff = std::clamp(params.damping * 0.65f, 0.02f, 0.85f);
            mFdnFilterStates[i] += dampCoeff * (delayed - mFdnFilterStates[i]);
            const float filtered = flushDenormal(mFdnFilterStates[i]);

            // Exponential decay multiplier for this delay length
            const float delayTimeSec = static_cast<float>(mFdnLengths[i]) / mSampleRate;
            const float decayMul = std::exp(-delayTimeSec / tau);

            fdnOutputs[i] = filtered * decayMul;
            fdnSum += fdnOutputs[i];
        }

        // Householder matrix mixing: y_i = fdnOutputs_i - 2/N * sum(fdnOutputs)
        constexpr float kTwoOverN = 2.0f / static_cast<float>(kNumFdnLines);
        const float householderOffset = fdnSum * kTwoOverN;

        for (size_t i = 0; i < kNumFdnLines; ++i) {
            const float mixed = fdnOutputs[i] - householderOffset;
            const float nextIn = diffused + mixed;
            mFdnBuffers[i][mFdnWriteIndices[i]] = flushDenormal(nextIn);
            mFdnWriteIndices[i] = (mFdnWriteIndices[i] + 1) % mFdnLengths[i];
        }

        // Sum FDN into stereo channels (decorrelated alternate polarity sum)
        float lateL = (fdnOutputs[0] + fdnOutputs[2] - fdnOutputs[4] - fdnOutputs[6]) * 0.35f;
        float lateR = (fdnOutputs[1] - fdnOutputs[3] + fdnOutputs[5] - fdnOutputs[7]) * 0.35f;

        // 8. Total Reverb Bus = Early + Late
        const float wetRawL = earlyL + lateL;
        const float wetRawR = earlyR + lateR;

        // 9. Real-Time Air Damping Filter on Wet Bus
        const float dampedL = mAirDampingFilterL.process(wetRawL);
        const float dampedR = mAirDampingFilterR.process(wetRawR);

        // 10. Infinite Freeze Recirculating Delay Loop
        // Left: 387ms, Right: 491ms, cross-coupled with 3200Hz filter
        const float freezeDelayedL = mFreezeBufferL[mFreezeWriteIndexL];
        const float freezeDelayedR = mFreezeBufferR[mFreezeWriteIndexR];

        const float freezeFiltL = mFreezeFilterL.process(freezeDelayedL);
        const float freezeFiltR = mFreezeFilterR.process(freezeDelayedR);

        const float freezeInL = monoIn * freezeInGain + freezeFiltR * freezeFb;
        const float freezeInR = monoIn * freezeInGain + freezeFiltL * freezeFb;

        mFreezeBufferL[mFreezeWriteIndexL] = flushDenormal(freezeInL);
        mFreezeBufferR[mFreezeWriteIndexR] = flushDenormal(freezeInR);

        mFreezeWriteIndexL = (mFreezeWriteIndexL + 1) % mFreezeDelaySamplesL;
        mFreezeWriteIndexR = (mFreezeWriteIndexR + 1) % mFreezeDelaySamplesR;

        // 11. Shimmer Feedback Path: Damped Output -> Shimmer Send -> Bandpass (1600 Hz) -> Pitch Shifter (+12st) -> Feedback Gain
        const float shimmerIn = ((dampedL + dampedR) * 0.5f) * curShimmerSend;
        const float shimmerBandpassed = mShimmerBandpass.process(shimmerIn);
        const float pitchShifted = mPitchShifter.processSample(shimmerBandpassed);
        mShimmerFeedbackSample = flushDenormal(pitchShifted * curShimmerFb);

        // 12. Combine Final Wet Output with Freeze and Wet Gain
        const float finalWetL = (dampedL + freezeFiltL * freezeWet) * params.mix;
        const float finalWetR = (dampedR + freezeFiltR * freezeWet) * params.mix;

        outL += finalWetL;
        outR += finalWetR;
    }

private:
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

        constexpr float g = 0.65f; // Allpass diffusion gain
        const float v = input - g * delayed;
        const float out = delayed + g * v;

        mAllpassBuffers[index][wIdx] = flushDenormal(v);
        mAllpassWriteIndices[index] = (wIdx + 1) % len;
        return out;
    }

    float mSampleRate { 48000.0f };

    DualDelayPitchShifter mPitchShifter;
    Biquad mShimmerBandpass;
    Biquad mAirDampingFilterL;
    Biquad mAirDampingFilterR;

    OnePoleSmoother mDampingSmoother;
    OnePoleSmoother mShimmerSendSmoother;
    OnePoleSmoother mShimmerFeedbackSmoother;
    float mShimmerFeedbackSample { 0.0f };

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
    static constexpr size_t kNumFdnLines = 8;
    static constexpr std::array<size_t, kNumFdnLines> kBaseFdnLengths = {
        1133, 1381, 1619, 1949, 2137, 2477, 2749, 3121
    };
    std::array<size_t, kNumFdnLines> mFdnLengths;
    std::array<std::vector<float>, kNumFdnLines> mFdnBuffers;
    std::array<size_t, kNumFdnLines> mFdnWriteIndices;
    std::array<float, kNumFdnLines> mFdnFilterStates;

    // Allpass Diffusers (4 stages)
    static constexpr size_t kNumAllpass = 4;
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
    OnePoleSmoother mFreezeFeedbackSmoother;
    OnePoleSmoother mFreezeWetSmoother;
    OnePoleSmoother mFreezeInputSmoother;
};

} // namespace braun
