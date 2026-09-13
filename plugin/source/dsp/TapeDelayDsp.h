#pragma once

#include "DspMath.h"
#include <vector>
#include <cmath>
#include <algorithm>

namespace braun {

struct TapeDelayParams {
    float timeSec { 0.48f };       // Left delay time (0.015s to 2.0s)
    float feedback { 0.58f };      // 0.0 to 0.92
    float toneHz { 3600.0f };      // Lowpass cutoff
    float wowAmount { 0.50f };     // 0.0 to 1.0
    float mix { 0.45f };           // Wet level
};

// ============================================================================
// TapeDelayDsp: Brian Eno / Frippertronics 3:2 Polyrhythmic Stereo Tape Delay
// ============================================================================
class TapeDelayDsp {
public:
    void prepare(double sampleRate, double maxDelaySec = 3.5) {
        mSampleRate = static_cast<float>(sampleRate > 100.0 ? sampleRate : 48000.0);
        mMaxDelaySamples = static_cast<size_t>(std::ceil(mSampleRate * maxDelaySec)) + 1024;

        mBufferL.assign(mMaxDelaySamples, 0.0f);
        mBufferR.assign(mMaxDelaySamples, 0.0f);
        mWriteIndex = 0;

        mDelayTimeLSmoother.setSampleRate(mSampleRate);
        mDelayTimeLSmoother.setTimeConstant(0.010f); // 10ms analog tape slewing
        mDelayTimeLSmoother.reset(0.48f);

        mDelayTimeRSmoother.setSampleRate(mSampleRate);
        mDelayTimeRSmoother.setTimeConstant(0.010f);
        mDelayTimeRSmoother.reset(0.48f * 1.5f);

        mFeedbackSmoother.setSampleRate(mSampleRate);
        mFeedbackSmoother.setTimeConstant(0.025f);
        mFeedbackSmoother.reset(0.58f);

        mToneSmoother.setSampleRate(mSampleRate);
        mToneSmoother.setTimeConstant(0.040f);
        mToneSmoother.reset(3600.0f);

        // Filters: Butterworth Q = 0.7071 eliminates resonant peaking in recirculation
        mHighpassL.configure(Biquad::Type::Highpass, mSampleRate, 75.0f, 0.7071f);
        mHighpassR.configure(Biquad::Type::Highpass, mSampleRate, 75.0f, 0.7071f);
        mLowpassL.configure(Biquad::Type::Lowpass, mSampleRate, 3600.0f, 0.7071f);
        mLowpassR.configure(Biquad::Type::Lowpass, mSampleRate, 3600.0f, 0.7071f);

        // Delay return dynamics: compressor (-6dBFS, 4:1) + limiter (k=0.78)
        mReturnCompL.prepare(mSampleRate, -6.0f, 4.0f, 4.0f, 0.003f, 0.080f);
        mReturnCompR.prepare(mSampleRate, -6.0f, 4.0f, 4.0f, 0.003f, 0.080f);

        mOversamplerL.reset();
        mOversamplerR.reset();

        reset();
    }

    void reset() noexcept {
        std::fill(mBufferL.begin(), mBufferL.end(), 0.0f);
        std::fill(mBufferR.begin(), mBufferR.end(), 0.0f);
        mWriteIndex = 0;
        mWowPhase = 0.0f;
        mFlutterPhase = 0.0f;

        mHighpassL.reset();
        mHighpassR.reset();
        mLowpassL.reset();
        mLowpassR.reset();
        mReturnCompL.reset();
        mReturnCompR.reset();
        mOversamplerL.reset();
        mOversamplerR.reset();
    }

    inline void processSample(float inL, float inR, const TapeDelayParams& params,
                              float& outL, float& outR) noexcept {
        // 1. Update smoothed parameters
        const float targetTimeL = std::clamp(params.timeSec, 0.015f, 2.0f);
        const float targetTimeR = std::min(static_cast<float>(mMaxDelaySamples - 100) / mSampleRate, targetTimeL * 1.5f);
        mDelayTimeLSmoother.setTarget(targetTimeL);
        mDelayTimeRSmoother.setTarget(targetTimeR);

        const float targetFb = std::clamp(params.feedback, 0.0f, 0.92f);
        mFeedbackSmoother.setTarget(targetFb);

        const float targetTone = std::clamp(params.toneHz, 800.0f, 12000.0f);
        mToneSmoother.setTarget(targetTone);

        const float curTimeL = mDelayTimeLSmoother.next();
        const float curTimeR = mDelayTimeRSmoother.next();
        const float curFb = mFeedbackSmoother.next();
        const float curTone = mToneSmoother.next();

        mLowpassL.configure(Biquad::Type::Lowpass, mSampleRate, curTone, 0.7071f);
        mLowpassR.configure(Biquad::Type::Lowpass, mSampleRate, curTone, 0.7071f);

        // 2. Wow & Flutter mechanical LFO modulation
        // Wow: 0.38 Hz sine LFO
        mWowPhase += 0.38f / mSampleRate;
        if (mWowPhase >= 1.0f) mWowPhase -= 1.0f;
        const float wowSine = std::sin(kTwoPi * mWowPhase);

        // Flutter: 5.8 Hz sine LFO
        mFlutterPhase += 5.8f / mSampleRate;
        if (mFlutterPhase >= 1.0f) mFlutterPhase -= 1.0f;
        const float flutterSine = std::sin(kTwoPi * mFlutterPhase);

        // Safety clamp wow and flutter depth so instantaneous delay time never dips below 0.015s (15ms)
        const float minDelay = std::min(curTimeL, curTimeR);
        const float maxMod = std::max(0.0f, minDelay - 0.015f);
        constexpr float nominalTotal = 0.0065f; // max wow (0.005) + max flutter (0.0015)
        const float modScale = (maxMod < nominalTotal) ? (maxMod / nominalTotal) : 1.0f;

        const float wowDepth = (0.005f * params.wowAmount) * modScale;
        const float flutterDepth = (0.0015f * params.wowAmount) * modScale;

        // Phase inverted wow for stereo width, flutter 0.8 on right
        const float totalModL = (wowSine * wowDepth) + (flutterSine * flutterDepth);
        const float totalModR = (-wowSine * wowDepth) + (flutterSine * flutterDepth * 0.8f);

        const float instDelayL = std::max(0.015f, curTimeL + totalModL) * mSampleRate;
        const float instDelayR = std::max(0.015f, curTimeR + totalModR) * mSampleRate;

        // 3. Read from circular delay lines with cubic Hermite interpolation
        const float delayedL = readDelayCubic(mBufferL, mWriteIndex, instDelayL);
        const float delayedR = readDelayCubic(mBufferR, mWriteIndex, instDelayR);

        // 4. Tape head filters: Highpass (75 Hz) -> Lowpass (Tone)
        const float filteredL = mLowpassL.process(mHighpassL.process(delayedL));
        const float filteredR = mLowpassR.process(mHighpassR.process(delayedR));

        // 5. Tape saturation wave shaper with 2x oversampling
        float upL0 = 0.0f, upL1 = 0.0f;
        float upR0 = 0.0f, upR1 = 0.0f;
        mOversamplerL.upsample(filteredL, upL0, upL1);
        mOversamplerR.upsample(filteredR, upR0, upR1);

        const float satL0 = tapeSaturate(upL0, 0.40f);
        const float satL1 = tapeSaturate(upL1, 0.40f);
        const float satR0 = tapeSaturate(upR0, 0.40f);
        const float satR1 = tapeSaturate(upR1, 0.40f);

        const float shaperOutL = mOversamplerL.downsample(satL0, satL1);
        const float shaperOutR = mOversamplerR.downsample(satR0, satR1);

        // 6. Normalized feedback routing (k = 1.5173)
        // Direct FB = 0.70 * FB / 1.5173, Cross FB = 0.30 * FB / 1.5173
        // Guarantees net loop gain <= FB <= 0.92 < 1.0 under all conditions
        constexpr float kShaperGain = 1.5173f;
        const float directFb = (curFb * 0.70f) / kShaperGain;
        const float crossFb = (curFb * 0.30f) / kShaperGain;

        const float fbL = directFb * shaperOutL + crossFb * shaperOutR;
        const float fbR = directFb * shaperOutR + crossFb * shaperOutL;

        // 7. Write to delay lines with calibrated input pad (0.38)
        constexpr float kInputPad = 0.38f;
        const float inputMixedL = inL * kInputPad + flushDenormal(fbL);
        const float inputMixedR = inR * kInputPad + flushDenormal(fbR);

        mBufferL[mWriteIndex] = inputMixedL;
        mBufferR[mWriteIndex] = inputMixedR;

        mWriteIndex = (mWriteIndex + 1) % mMaxDelaySamples;

        // 8. Delay return conditioning (compressor -6dBFS + soft limiter k=0.78)
        const float compL = mReturnCompL.process(shaperOutL);
        const float compR = mReturnCompR.process(shaperOutR);
        const float limL = applySmoothBoundaryKnee(compL, 0.78f);
        const float limR = applySmoothBoundaryKnee(compR, 0.78f);

        // 9. Stereo panning (Left -0.8, Right +0.8) and wet mix
        constexpr float kPanL_LeftGain = 0.94868f;  // cos(pi/2 * 0.1)
        constexpr float kPanL_RightGain = 0.31623f; // sin(pi/2 * 0.1)
        constexpr float kPanR_LeftGain = 0.31623f;  // cos(pi/2 * 0.9)
        constexpr float kPanR_RightGain = 0.94868f; // sin(pi/2 * 0.9)

        const float wetL = (limL * kPanL_LeftGain + limR * kPanR_LeftGain) * params.mix;
        const float wetR = (limL * kPanL_RightGain + limR * kPanR_RightGain) * params.mix;

        outL += wetL;
        outR += wetR;
    }

private:
    // 4-point cubic Hermite interpolation for smooth non-integer delay line reads
    inline float readDelayCubic(const std::vector<float>& buffer, size_t writeIdx, float delaySamples) const noexcept {
        const float bufSize = static_cast<float>(mMaxDelaySamples);
        float readPos = static_cast<float>(writeIdx) - delaySamples;
        while (readPos < 0.0f) readPos += bufSize;
        while (readPos >= bufSize) readPos -= bufSize;

        const size_t i1 = static_cast<size_t>(readPos);
        const float frac = readPos - static_cast<float>(i1);

        const size_t i0 = (i1 + mMaxDelaySamples - 1) % mMaxDelaySamples;
        const size_t i2 = (i1 + 1) % mMaxDelaySamples;
        const size_t i3 = (i1 + 2) % mMaxDelaySamples;

        const float y0 = buffer[i0];
        const float y1 = buffer[i1];
        const float y2 = buffer[i2];
        const float y3 = buffer[i3];

        // Cubic Hermite spline
        const float c0 = y1;
        const float c1 = 0.5f * (y2 - y0);
        const float c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
        const float c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);

        return ((c3 * frac + c2) * frac + c1) * frac + c0;
    }

    float mSampleRate { 48000.0f };
    size_t mMaxDelaySamples { 170000 };
    std::vector<float> mBufferL;
    std::vector<float> mBufferR;
    size_t mWriteIndex { 0 };

    OnePoleSmoother mDelayTimeLSmoother;
    OnePoleSmoother mDelayTimeRSmoother;
    OnePoleSmoother mFeedbackSmoother;
    OnePoleSmoother mToneSmoother;

    Biquad mHighpassL;
    Biquad mHighpassR;
    Biquad mLowpassL;
    Biquad mLowpassR;

    SoftCompressor mReturnCompL;
    SoftCompressor mReturnCompR;

    Oversampler2x mOversamplerL;
    Oversampler2x mOversamplerR;

    float mWowPhase { 0.0f };
    float mFlutterPhase { 0.0f };
};

} // namespace braun
