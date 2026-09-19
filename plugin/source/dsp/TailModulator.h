#pragma once

#include "DspMath.h"
#include <array>
#include <cmath>
#include <algorithm>
#include <cstddef>

namespace braun {

// ============================================================================
// Fast Precomputed Sine Lookup Table (2048 points, linear interpolation)
// Peak error < 1.2e-6 (-118.5 dB), 0 dynamic allocations, 0 transcendental calls
// ============================================================================
class FastSinTable {
public:
    static constexpr size_t kTableSize = 2048;
    static constexpr size_t kMask = kTableSize - 1;

    static inline const std::array<float, kTableSize> table = []() {
        std::array<float, kTableSize> t {};
        for (size_t i = 0; i < kTableSize; ++i) {
            t[i] = std::sin(static_cast<float>(i) * (kTwoPi / static_cast<float>(kTableSize)));
        }
        return t;
    }();

    [[nodiscard]] static inline float sin(float angle) noexcept {
        if (!std::isfinite(angle)) [[unlikely]] {
            return 0.0f;
        }
        const float norm = angle * (static_cast<float>(kTableSize) / kTwoPi);
        const int idx = static_cast<int>(std::floor(norm));
        const float frac = norm - static_cast<float>(idx);
        const size_t i0 = static_cast<size_t>(idx) & kMask;
        const size_t i1 = (i0 + 1) & kMask;
        return table[i0] + frac * (table[i1] - table[i0]);
    }

    [[nodiscard]] static inline float cos(float angle) noexcept {
        return sin(angle + kHalfPi);
    }
};

// ============================================================================
// TailModulator: Multi-Phase Golden-Ratio LFO Network with Hermite Reading
// Modulates FDN delay lines to banish stationary comb filtering and metallic modes
// ============================================================================
class TailModulator {
public:
    static constexpr size_t kNumLines = 8;

    TailModulator() noexcept = default;
    ~TailModulator() noexcept = default;

    inline void prepare(double sampleRate) noexcept {
        mSampleRate = sampleRate > 100.0 ? sampleRate : 48000.0;
        const float fs = static_cast<float>(mSampleRate);

        mRateSmoother.setSampleRate(fs);
        mRateSmoother.setTimeConstant(0.040f);
        mRateSmoother.reset(mTargetRateHz);

        mDepthSmoother.setSampleRate(fs);
        mDepthSmoother.setTimeConstant(0.040f);
        mDepthSmoother.reset(mTargetDepthMs);

        // Fast tau = 7.0 ms suppresses audio waveform ripple for frequencies down to 30 Hz
        // Slow tau = 50.0 ms provides stable background energy tracking
        mFastAlpha = std::exp(-1.0f / (fs * 0.0070f));
        mSlowAlpha = std::exp(-1.0f / (fs * 0.0500f));

        updateBloomAlpha();
        reset();
    }

    inline void reset() noexcept {
        std::fill(mPhases.begin(), mPhases.end(), 0.0f);
        mBloomEnvelope = 0.0f;
        mFastEnv = 0.0f;
        mSlowEnv = 0.0f;
        mRateSmoother.reset(mTargetRateHz);
        mDepthSmoother.reset(mTargetDepthMs);
    }

    inline void setParameters(float rateHz, float depthMs, float bloomMs) noexcept {
        mTargetRateHz = std::clamp(rateHz, 0.05f, 5.0f);
        mRateSmoother.setTarget(mTargetRateHz);

        mTargetDepthMs = std::clamp(depthMs, 0.0f, 5.0f);
        mDepthSmoother.setTarget(mTargetDepthMs);

        const float clampedBloom = std::clamp(bloomMs, 20.0f, 500.0f);
        if (std::abs(clampedBloom - mTargetBloomMs) > 1.0f) {
            mTargetBloomMs = clampedBloom;
            updateBloomAlpha();
        }
    }

    // Advances LFOs and calculates 8 fractional delay excursions in samples
    inline void processSample(float inputTransientLevel,
                              std::array<float, kNumLines>& outExcursionsSamples) noexcept {
        // 1. Transient detection on input: dual envelope follower
        const float absIn = std::abs(inputTransientLevel);
        mFastEnv = flushDenormal((1.0f - mFastAlpha) * absIn + mFastAlpha * mFastEnv);
        mSlowEnv = flushDenormal((1.0f - mSlowAlpha) * absIn + mSlowAlpha * mSlowEnv);

        const float tr = mFastEnv / (mSlowEnv + 1.0e-5f);
        if (tr > 1.50f) {
            const float excess = std::min(5.0f, tr - 1.50f);
            const float duckFactor = std::max(0.0f, 1.0f - 0.4f * excess);
            mBloomEnvelope = std::min(mBloomEnvelope, duckFactor);
        } else {
            mBloomEnvelope = flushDenormal(mBloomEnvelope + mBloomAlpha * (1.0f - mBloomEnvelope));
        }

        // 2. Smoothed rate and depth
        const float currentRate = mRateSmoother.next();
        const float currentDepthMs = mDepthSmoother.next();
        const float fs = static_cast<float>(mSampleRate);
        const float maxDepthSamples = (currentDepthMs * 0.001f) * fs;
        const float effectiveDepth = maxDepthSamples * mBloomEnvelope;

        if (effectiveDepth < 1.0e-5f) {
            outExcursionsSamples.fill(0.0f);
            return;
        }

        // 3. Update golden-ratio 8-phase LFO network
        for (size_t k = 0; k < kNumLines; ++k) {
            const float freqRatio = kGoldenRatios[k % 4];
            const float freq = currentRate * freqRatio;
            const float phaseInc = kTwoPi * (freq / fs);

            mPhases[k] += phaseInc;
            if (mPhases[k] >= kTwoPi) {
                mPhases[k] -= kTwoPi;
            }

            const float lfoVal = FastSinTable::sin(mPhases[k] + kPhaseOffsets[k]);
            // Strictly non-negative unipolar excursion in [0.0, effectiveDepth]
            const float unipolarLfo = std::clamp(0.5f * (1.0f + lfoVal), 0.0f, 1.0f);
            outExcursionsSamples[k] = flushDenormal(effectiveDepth * unipolarLfo);
        }
    }

    // Branchless 4-point Hermite cubic circular buffer read
    static inline float readHermite(const float* buffer, size_t bufferCapacity,
                                    size_t bufferMask, size_t writeIndex,
                                    float delaySamples) noexcept {
        if (!std::isfinite(delaySamples)) [[unlikely]] {
            return 0.0f;
        }
        if (delaySamples <= 0.0f) [[unlikely]] {
            return buffer[writeIndex & bufferMask];
        }
        if (delaySamples < 1.0f) [[unlikely]] {
            const size_t i0 = writeIndex & bufferMask;
            const size_t i1 = (writeIndex + bufferCapacity - 1) & bufferMask;
            return buffer[i0] + delaySamples * (buffer[i1] - buffer[i0]);
        }
        const int intDelay = static_cast<int>(delaySamples);
        const float mu = delaySamples - static_cast<float>(intDelay);

        // Buffer write index advances forward; delay looks backward in time
        // For delay >= 1.0f, idxM1 = idx0 + 1 <= writeIndex, strictly avoiding unwritten future indices
        const size_t idx0 = (writeIndex + bufferCapacity - static_cast<size_t>(intDelay)) & bufferMask;
        const size_t idxM1 = (idx0 + 1) & bufferMask;
        const size_t idx1 = (idx0 + bufferCapacity - 1) & bufferMask;
        const size_t idx2 = (idx0 + bufferCapacity - 2) & bufferMask;

        const float ym1 = buffer[idxM1];
        const float y0  = buffer[idx0];
        const float y1  = buffer[idx1];
        const float y2  = buffer[idx2];

        return interpolateHermite4P3O(ym1, y0, y1, y2, mu);
    }

private:
    double mSampleRate { 48000.0 };
    float mTargetRateHz { 0.45f };
    float mTargetDepthMs { 0.35f };
    float mTargetBloomMs { 120.0f };

    OnePoleSmoother mRateSmoother;
    OnePoleSmoother mDepthSmoother;

    std::array<float, kNumLines> mPhases {};

    // Golden ratio powers phi^((k%4) - 1.5)
    static constexpr std::array<float, 4> kGoldenRatios = {{
        0.48586827f, 0.78615138f, 1.27201965f, 2.05817103f
    }};

    static constexpr std::array<float, kNumLines> kPhaseOffsets = {{
        0.5235988f, 1.3089969f, 2.0943951f, 2.8797933f,
        3.6651914f, 4.4505896f, 5.2359878f, 6.0213859f
    }};

    // Bloom envelope detector & state
    float mBloomEnvelope { 1.0f };
    float mBloomAlpha { 0.001f };
    float mFastEnv { 0.0f };
    float mSlowEnv { 0.0f };
    float mFastAlpha { 0.01f };
    float mSlowAlpha { 0.0005f };

    inline void updateBloomAlpha() noexcept {
        const float tauSec = mTargetBloomMs * 0.001f;
        mBloomAlpha = 1.0f - std::exp(-1.0f / (static_cast<float>(mSampleRate) * tauSec));
    }
};

} // namespace braun
