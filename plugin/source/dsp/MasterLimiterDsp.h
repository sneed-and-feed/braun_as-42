#pragma once

#include "DspMath.h"
#include <cmath>
#include <algorithm>

namespace braun {

struct MasterLimiterParams {
    float masterVolume { 0.80f };  // 0.0 to 1.0
    float tapeWarmth { 0.18f };    // Default 0.18
    float limiterKnee { 0.80f };   // Default 0.80
};

// ============================================================================
// MasterLimiterDsp: Master Bus Dynamics, Tape Saturation, Soft Limiter, and DC Blocker
// ============================================================================
class MasterLimiterDsp {
public:
    void prepare(double sampleRate) {
        mSampleRate = static_cast<float>(sampleRate > 100.0 ? sampleRate : 48000.0);

        // Master Peak Compressor (-3.0 dBFS, 12 dB knee, 8:1 ratio, 3ms attack, 60ms release)
        mCompressorL.prepare(mSampleRate, -3.0f, 12.0f, 8.0f, 0.003f, 0.060f);
        mCompressorR.prepare(mSampleRate, -3.0f, 12.0f, 8.0f, 0.003f, 0.060f);

        // Master DC Blocker (15 Hz highpass, Q = 0.7071)
        mDcBlockerL.configure(Biquad::Type::Highpass, mSampleRate, 15.0f, 0.7071f);
        mDcBlockerR.configure(Biquad::Type::Highpass, mSampleRate, 15.0f, 0.7071f);

        // Master Output Post-Saturation DC Blocker (15 Hz highpass, Q = 0.7071) - removes tape saturation DC bias
        mPostDcBlockerL.configure(Biquad::Type::Highpass, mSampleRate, 15.0f, 0.7071f);
        mPostDcBlockerR.configure(Biquad::Type::Highpass, mSampleRate, 15.0f, 0.7071f);

        mVolumeSmoother.setSampleRate(mSampleRate);
        mVolumeSmoother.setTimeConstant(0.040f);
        mVolumeSmoother.reset(0.80f);

        reset();
    }

    void reset() noexcept {
        mCompressorL.reset();
        mCompressorR.reset();
        mDcBlockerL.reset();
        mDcBlockerR.reset();
        mPostDcBlockerL.reset();
        mPostDcBlockerR.reset();
    }

    inline void processSample(float inL, float inR, const MasterLimiterParams& params,
                              float& outL, float& outR) noexcept {
        mVolumeSmoother.setTarget(params.masterVolume);
        const float vol = mVolumeSmoother.next();

        // 1. Master Volume scaling
        const float scaledL = inL * vol;
        const float scaledR = inR * vol;

        // 2. Input DC Blocker (15 Hz highpass): removes DC bias and subsonic rumble
        // before nonlinear saturation and dynamics to prevent post-limiter step overshoot
        const float dcBlockedL = mDcBlockerL.process(scaledL);
        const float dcBlockedR = mDcBlockerR.process(scaledR);

        // 3. Master Compressor (-3 dBFS, 12 dB knee, 8:1 ratio)
        const float compL = mCompressorL.process(dcBlockedL);
        const float compR = mCompressorR.process(dcBlockedR);

        // 4. Analog Tape Saturation (Warmth = 0.18) & Cubic Hermite Soft Limiter (k = 0.80)
        const float satL = tapeSaturate(compL, params.tapeWarmth);
        const float satR = tapeSaturate(compR, params.tapeWarmth);

        const float limL = softLimit(satL, params.limiterKnee);
        const float limR = softLimit(satR, params.limiterKnee);

        // 5. Post-Saturation DC Blocker (15 Hz highpass): removes DC drift and rectification
        // bias produced by asymmetric tape saturation and soft limiting
        const float postBlockedL = mPostDcBlockerL.process(limL);
        const float postBlockedR = mPostDcBlockerR.process(limR);

        outL = std::clamp(postBlockedL, -1.0f, 1.0f);
        outR = std::clamp(postBlockedR, -1.0f, 1.0f);
    }

private:
    float mSampleRate { 48000.0f };

    OnePoleSmoother mVolumeSmoother;
    SoftCompressor mCompressorL;
    SoftCompressor mCompressorR;

    Biquad mDcBlockerL;
    Biquad mDcBlockerR;
    Biquad mPostDcBlockerL;
    Biquad mPostDcBlockerR;
};

} // namespace braun
