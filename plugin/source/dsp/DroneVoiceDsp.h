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
    bool active { true };
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
        mFreqSmoother.setTimeConstant(0.025f);
        mFreqSmoother.reset(defaultFreq);

        mCutoffSmoother.setSampleRate(mSampleRate);
        mCutoffSmoother.setTimeConstant(0.025f);
        mCutoffSmoother.reset(680.0f);

        mGainSmoother.setSampleRate(mSampleRate);
        mGainSmoother.setTimeConstant(0.030f);
        mGainSmoother.reset(0.55f);

        mBeatHz = defaultBeat;
        mDetuneCents = defaultDetune;

        reset();
    }

    void reset() noexcept {
        mPhaseA = 0.0f;
        mPhaseB = 0.0f;
        mLfoPhase = 0.0f;
        mFilter1.reset();
        mFilter2.reset();
        mDeclickSamples = 0;
        mDeclickGain = 1.0f;
        mOversampler.reset();
    }

    void triggerDeclick(float crossfadeTimeSec = 0.025f) noexcept {
        mDeclickSamplesTotal = std::max(1u, static_cast<uint32_t>(crossfadeTimeSec * mSampleRate));
        mDeclickSamples = mDeclickSamplesTotal;
    }

    inline void processSample(const DroneVoiceParams& params, float& outL, float& outR) noexcept {
        if (!params.active) return;

        // 1. Parameter updates with smoothing
        mFreqSmoother.setTarget(params.pitchHz);
        mCutoffSmoother.setTarget(params.cutoffHz);
        const float targetVol = params.volume * (params.isSubBass ? 1.70f : 1.0f);
        mGainSmoother.setTarget(targetVol);

        const float baseFreq = mFreqSmoother.next();
        const float baseCutoff = mCutoffSmoother.next();
        const float currentGain = mGainSmoother.next();

        // 2. Frequency computation
        // Sub-bass mode locks beating and detune to 0 to prevent phase cancellation
        const float beat = params.isSubBass ? 0.0f : params.beatHz;
        const float detune = params.isSubBass ? 0.0f : params.detuneCents;

        const float freqA = baseFreq;
        const float freqB = (baseFreq + beat) * std::pow(2.0f, detune / 1200.0f);

        // Advance oscillator phases
        mPhaseA += freqA / mSampleRate;
        if (mPhaseA >= 1.0f) mPhaseA -= 1.0f;
        mPhaseB += freqB / mSampleRate;
        if (mPhaseB >= 1.0f) mPhaseB -= 1.0f;

        // Oscillators with 0.5 gain each
        const float oscA = mWavetables->readSample(params.waveA, mPhaseA) * 0.5f;
        const float oscB = mWavetables->readSample(params.waveB, mPhaseB) * 0.5f;

        // 3. Square wave wavefolder bypass routing:
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

        // 4. Wavefolder / Sub-bass shaper (with 2x oversampling)
        float foldedOut = 0.0f;
        if (!isSquareA || !isSquareB) {
            float up0 = 0.0f, up1 = 0.0f;
            mOversampler.upsample(shaperIn, up0, up1);

            const float drive = std::clamp(1.0f + params.foldPercent / 50.0f, 0.5f, 4.0f);
            const float fold = std::clamp(params.foldPercent / 100.0f, 0.0f, 1.0f);

            float sat0 = 0.0f, sat1 = 0.0f;
            if (params.isSubBass) {
                // Sub-bass mode: smooth tanh saturation replaces wavefolder
                const float d = 1.25f + fold * 0.45f;
                const float norm = std::tanh(d);
                sat0 = applySmoothBoundaryKnee(std::tanh(d * up0) / norm, 0.70f);
                sat1 = applySmoothBoundaryKnee(std::tanh(d * up1) / norm, 0.70f);
            } else {
                sat0 = wavefold(up0, drive, fold);
                sat1 = wavefold(up1, drive, fold);
            }

            foldedOut = mOversampler.downsample(sat0, sat1);
        }

        const float combinedFilterInput = foldedOut + directIn;

        // 5. LFO filter cutoff modulation (breathing organic movement)
        mLfoPhase += params.lfoRate / mSampleRate;
        if (mLfoPhase >= 1.0f) mLfoPhase -= 1.0f;
        const float lfoSine = std::sin(kTwoPi * mLfoPhase);

        // Safety clamp: ensures cutoff never dips below 25.5 Hz
        const float maxSafeDepth = std::max(0.0f, (baseCutoff - 30.0f) * 0.85f);
        const float effectiveDepth = std::min(params.lfoDepth, maxSafeDepth);
        const float modulatedCutoff = std::max(25.5f, baseCutoff + lfoSine * effectiveDepth);

        // 6. 4-Pole Resonant Ladder Filter (cascaded dual biquad with Q = sqrt(R))
        const float r = params.isSubBass ? 0.5f : std::clamp(params.resonance, 0.5f, 12.0f);
        const float q = std::sqrt(r);
        const float filterCutoff = params.isSubBass ? 140.0f : modulatedCutoff;

        mFilter1.configure(Biquad::Type::Lowpass, mSampleRate, filterCutoff, q);
        mFilter2.configure(Biquad::Type::Lowpass, mSampleRate, filterCutoff, q);

        const float f1 = mFilter1.process(combinedFilterInput);
        const float f2 = mFilter2.process(f1);

        // 7. Declick crossfader
        if (mDeclickSamples > 0) {
            --mDeclickSamples;
            const float progress = 1.0f - static_cast<float>(mDeclickSamples) / static_cast<float>(mDeclickSamplesTotal);
            // Dip to silence and rise back up: C1 raised-cosine Hann dip (1.0 -> 0.0 -> 1.0)
            mDeclickGain = 0.5f * (1.0f + std::cos(kTwoPi * progress));
        } else {
            mDeclickGain = 1.0f;
        }

        const float voiceOut = f2 * currentGain * mDeclickGain;

        // 8. Stereo panning (constant power pan)
        const float panNorm = (mPan + 1.0f) * 0.5f; // 0.0 (left) to 1.0 (right)
        const float leftGain = std::cos(kHalfPi * panNorm);
        const float rightGain = std::sin(kHalfPi * panNorm);

        outL += voiceOut * leftGain;
        outR += voiceOut * rightGain;
    }

private:
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

    Biquad mFilter1;
    Biquad mFilter2;
    Oversampler2x mOversampler;

    uint32_t mDeclickSamples { 0 };
    uint32_t mDeclickSamplesTotal { 1200 };
    float mDeclickGain { 1.0f };
};

} // namespace braun
