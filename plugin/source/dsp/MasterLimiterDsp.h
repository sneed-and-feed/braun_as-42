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

        mVolumeSmoother.setSampleRate(mSampleRate);
        mVolumeSmoother.setTimeConstant(0.040f);
        mVolumeSmoother.reset(0.80f);

        mOversamplerL.reset();
        mOversamplerR.reset();

        reset();
    }

    void reset() noexcept {
        mCompressorL.reset();
        mCompressorR.reset();
        mDcBlockerL.reset();
        mDcBlockerR.reset();
        mOversamplerL.reset();
        mOversamplerR.reset();
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

        // 4. Oversampled Tape Saturation (Warmth = 0.18) & Cubic Hermite Soft Limiter (k = 0.80)
        float upL0 = 0.0f, upL1 = 0.0f;
        float upR0 = 0.0f, upR1 = 0.0f;
        mOversamplerL.upsample(compL, upL0, upL1);
        mOversamplerR.upsample(compR, upR0, upR1);

        const float warmth = params.tapeWarmth;
        const float knee = params.limiterKnee;

        // Tape saturation followed by soft limiting at oversampled rate
        const float satL0 = softLimit(tapeSaturate(upL0, warmth), knee);
        const float satL1 = softLimit(tapeSaturate(upL1, warmth), knee);
        const float satR0 = softLimit(tapeSaturate(upR0, warmth), knee);
        const float satR1 = softLimit(tapeSaturate(upR1, warmth), knee);

        const float limL = mOversamplerL.downsample(satL0, satL1);
        const float limR = mOversamplerR.downsample(satR0, satR1);

        // 5. Final post-decimation C1 soft limiter / safety clamp:
        // Enforces strictly <= 1.000000 FS ceiling, absorbing FIR decimation Gibbs ringing
        outL = std::clamp(softLimit(limL, 0.95f), -1.0f, 1.0f);
        outR = std::clamp(softLimit(limR, 0.95f), -1.0f, 1.0f);
    }

private:
    float mSampleRate { 48000.0f };

    OnePoleSmoother mVolumeSmoother;
    SoftCompressor mCompressorL;
    SoftCompressor mCompressorR;

    Oversampler2x mOversamplerL;
    Oversampler2x mOversamplerR;

    Biquad mDcBlockerL;
    Biquad mDcBlockerR;
};

} // namespace braun
