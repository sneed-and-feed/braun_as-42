#pragma once

#include <cmath>
#include <cstdint>
#include <algorithm>
#include <array>
#include <vector>

// Architecture-specific denormal suppression (DAZ/FTZ)
#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
#include <immintrin.h>
#elif defined(_M_ARM64) || defined(_M_ARM64EC)
#include <arm64intr.h>
#include <intrin.h>
#endif

namespace braun {

// ============================================================================
// ScopedNoDenormals: RAII guard ensuring subnormals cannot throttle CPU
// ============================================================================
class ScopedNoDenormals {
public:
    ScopedNoDenormals() noexcept {
#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
        mOldMxcsr = _mm_getcsr();
        // 0x8040 sets DAZ (bit 6) and FTZ (bit 15)
        _mm_setcsr(mOldMxcsr | 0x8040);
#elif defined(_M_ARM64) || defined(_M_ARM64EC)
        mOldFpcr = static_cast<uint64_t>(_ReadStatusReg(ARM64_FPCR));
        // Bit 24 (FZ): Flush-to-zero for FP32/FP64
        // Bit 19 (FZ16): Flush-to-zero for FP16
        constexpr uint64_t kFzMask = (1ULL << 24) | (1ULL << 19);
        _WriteStatusReg(ARM64_FPCR, static_cast<__int64>(mOldFpcr | kFzMask));
#elif defined(__aarch64__) || defined(__arm64__)
        uint64_t fpcr = 0;
        __asm__ __volatile__("mrs %0, fpcr" : "=r"(fpcr));
        mOldFpcr = fpcr;
        constexpr uint64_t kFzMask = (1ULL << 24) | (1ULL << 19);
        fpcr |= kFzMask;
        __asm__ __volatile__("msr fpcr, %0" : : "r"(fpcr));
#endif
    }

    ~ScopedNoDenormals() noexcept {
#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
        _mm_setcsr(mOldMxcsr);
#elif defined(_M_ARM64) || defined(_M_ARM64EC)
        _WriteStatusReg(ARM64_FPCR, static_cast<__int64>(mOldFpcr));
#elif defined(__aarch64__) || defined(__arm64__)
        __asm__ __volatile__("msr fpcr, %0" : : "r"(mOldFpcr));
#endif
    }

    ScopedNoDenormals(const ScopedNoDenormals&) = delete;
    ScopedNoDenormals& operator=(const ScopedNoDenormals&) = delete;

private:
#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
    unsigned int mOldMxcsr { 0 };
#elif defined(_M_ARM64) || defined(_M_ARM64EC) || defined(__aarch64__) || defined(__arm64__)
    uint64_t mOldFpcr { 0 };
#endif
};

// Inline helper to prevent denormals in recursive feedback loops
inline float flushDenormal(float val) noexcept {
    return (std::abs(val) < 1.0e-9f) ? 0.0f : val;
}

// Mathematical constants
constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 6.28318530717958647692f;
constexpr float kHalfPi = 1.57079632679489661923f;
constexpr float kThreeHalfPi = 4.71238898038468985769f;
constexpr float kTwoOverPi = 0.63661977236758134308f;

// ============================================================================
// Nonlinear Transfer Curves
// ============================================================================

/**
 * Smooth C1 cubic Hermite soft-knee boundary shaping.
 * Below |x| <= knee, exhibits exactly unity gain (0 dB, slope = 1.0).
 * Above knee, smoothly curves to +/- 1.0 with zero derivative at +/- 1.0.
 */
inline float applySmoothBoundaryKnee(float y, float knee = 0.70f) noexcept {
    if (y >= 1.0f) return 1.0f;
    if (y <= -1.0f) return -1.0f;
    const float k = std::clamp(knee, 0.20f, 0.95f);
    if (y > k) {
        const float u = (y - k) / (1.0f - k);
        return k + (1.0f - k) * (u + u * u - u * u * u);
    } else if (y < -k) {
        const float absY = -y;
        const float u = (absY - k) / (1.0f - k);
        return -(k + (1.0f - k) * (u + u * u - u * u * u));
    }
    return y;
}

/**
 * West-Coast polynomial analog wavefolding curve (Solar 42n style).
 * y = tanh( sin(0.5 * pi * D * x) - F * sin(1.5 * pi * D * x) )
 * Optimized via triple-angle identity: sin(3θ) = sin(θ) * (3 - 4*sin²(θ))
 * Eliminates a second std::sin() call while maintaining ε-bounded numerical invariance (< 6e-7).
 */
inline float wavefold(float x, float drive = 1.8f, float fold = 0.6f) noexcept {
    const float driven = x * drive;
    const float stage1 = std::sin(kHalfPi * driven);
    const float sin3 = stage1 * (3.0f - 4.0f * stage1 * stage1);
    const float stage2 = stage1 - fold * sin3;
    return std::tanh(stage2);
}

/**
 * Analog tape saturation transfer function with k = 1.5173 small-signal slope normalization.
 * Features asymmetric 2nd-harmonic warmth and C1 Hermite knee at 0.72.
 */
inline float tapeSaturate(float x, float warmth = 0.35f) noexcept {
    if (warmth <= 0.001f) return x;
    const float posDrive = 1.0f + warmth * 1.5f;
    const float asymPos = 1.0f + warmth * 0.25f;
    const float maxOut = kTwoOverPi * std::atan(posDrive * asymPos);

    const float signX = (x > 0.0f) ? 1.0f : ((x < 0.0f) ? -1.0f : 0.0f);
    const float asym = x + warmth * 0.25f * x * x * signX;
    const float saturated = kTwoOverPi * std::atan(posDrive * asym);
    const float normalized = std::clamp(saturated / maxOut, -1.0f, 1.0f);
    return applySmoothBoundaryKnee(normalized, 0.72f);
}

/**
 * Soft clip curve using hyperbolic tangent normalized to unity bounds and Hermite knee at 0.70.
 */
inline float softClip(float x, float drive = 1.5f) noexcept {
    const float norm = std::tanh(drive);
    const float raw = std::tanh(drive * x) / (norm > 0.0001f ? norm : 1.0f);
    return applySmoothBoundaryKnee(raw, 0.70f);
}

/**
 * Transparent soft limiter curve (unity below knee, limits at 1.0).
 */
inline float softLimit(float x, float knee = 0.80f) noexcept {
    return applySmoothBoundaryKnee(x, knee);
}

// ============================================================================
// 4-Point, 3rd-Order Catmull-Rom Hermite Cubic Spline Interpolation (Horner Form)
// Continuous first derivative (C1), minimal ripple up to 0.45 fs
// ============================================================================
[[nodiscard]] inline float interpolateHermite4P3O(float ym1, float y0, float y1, float y2, float mu) noexcept {
    const float c0 = y0;
    const float c1 = 0.5f * (y1 - ym1);
    const float c2 = ym1 - 2.5f * y0 + 2.0f * y1 - 0.5f * y2;
    const float c3 = 0.5f * (y2 - ym1) + 1.5f * (y0 - y1);
    return flushDenormal(((c3 * mu + c2) * mu + c1) * mu + c0);
}

// ============================================================================
// Zero-Latency 1st-Order DC Blocker
// Prevents common-mode DC offset accumulation in recursive feedback loops
// ============================================================================
struct DcBlocker {
    float x1 { 0.0f };
    float y1 { 0.0f };
    float R { 0.99935f }; // Default ~5 Hz at 48 kHz

    void setCutoff(float fcHz, double sampleRate) noexcept {
        const float fs = static_cast<float>(sampleRate > 100.0 ? sampleRate : 48000.0);
        R = std::clamp(1.0f - (kTwoPi * fcHz / fs), 0.99f, 0.99995f);
    }

    void reset() noexcept {
        x1 = 0.0f;
        y1 = 0.0f;
    }

    [[nodiscard]] inline float process(float x) noexcept {
        const float y = x - x1 + R * y1;
        x1 = flushDenormal(x);
        y1 = flushDenormal(y);
        return y1;
    }
};

// ============================================================================
// One-Pole Parameter Smoother (Exponential Slewer)
// ============================================================================
class OnePoleSmoother {
public:
    void reset(float initialValue = 0.0f) noexcept {
        mCurrent = initialValue;
        mTarget = initialValue;
    }

    void setSampleRate(float sampleRate) noexcept {
        mSampleRate = sampleRate > 100.0f ? sampleRate : 48000.0f;
        updateCoeff();
    }

    void setTimeConstant(float tauSec) noexcept {
        mTau = tauSec > 0.0001f ? tauSec : 0.0001f;
        updateCoeff();
    }

    void setTarget(float target) noexcept {
        mTarget = target;
    }

    void snapTo(float value) noexcept {
        mTarget = value;
        mCurrent = value;
    }

    float getTarget() const noexcept { return mTarget; }
    float getCurrent() const noexcept { return mCurrent; }

    float next() noexcept {
        mCurrent += mCoeff * (mTarget - mCurrent);
        if (std::abs(mTarget - mCurrent) < 1.0e-5f) {
            mCurrent = mTarget;
        }
        return mCurrent;
    }

private:
    void updateCoeff() noexcept {
        mCoeff = 1.0f - std::exp(-1.0f / (mSampleRate * mTau));
    }

    float mSampleRate { 48000.0f };
    float mTau { 0.025f };
    float mCoeff { 0.05f };
    float mCurrent { 0.0f };
    float mTarget { 0.0f };
};

// ============================================================================
// Biquad Filter (Direct Form II Transposed)
// ============================================================================
class Biquad {
public:
    enum class Type {
        Lowpass,
        Highpass,
        Bandpass,
        Peaking
    };

    void reset() noexcept {
        mS1 = 0.0f;
        mS2 = 0.0f;
    }

    inline void copyCoefficientsFrom(const Biquad& other) noexcept {
        mB0 = other.mB0;
        mB1 = other.mB1;
        mB2 = other.mB2;
        mA1 = other.mA1;
        mA2 = other.mA2;
    }

    void configure(Type type, float sampleRate, float cutoffHz, float Q, float gainDb = 0.0f) noexcept {
        const float fs = sampleRate > 100.0f ? sampleRate : 48000.0f;
        // Clamp cutoff to safe Nyquist limit
        const float fc = std::clamp(cutoffHz, 10.0f, fs * 0.495f);
        const float q = std::max(0.01f, Q);

        const float omega0 = kTwoPi * (fc / fs);
        const float cosOmega0 = std::cos(omega0);
        const float sinOmega0 = std::sin(omega0);
        const float alpha = sinOmega0 / (2.0f * q);

        float b0 = 0.0f, b1 = 0.0f, b2 = 0.0f;
        float a0 = 1.0f, a1 = 0.0f, a2 = 0.0f;

        switch (type) {
            case Type::Lowpass: {
                b0 = (1.0f - cosOmega0) * 0.5f;
                b1 = 1.0f - cosOmega0;
                b2 = (1.0f - cosOmega0) * 0.5f;
                a0 = 1.0f + alpha;
                a1 = -2.0f * cosOmega0;
                a2 = 1.0f - alpha;
                break;
            }
            case Type::Highpass: {
                b0 = (1.0f + cosOmega0) * 0.5f;
                b1 = -(1.0f + cosOmega0);
                b2 = (1.0f + cosOmega0) * 0.5f;
                a0 = 1.0f + alpha;
                a1 = -2.0f * cosOmega0;
                a2 = 1.0f - alpha;
                break;
            }
            case Type::Bandpass: {
                // Constant 0 dB peak gain at center frequency (matches W3C Web Audio standard)
                b0 = alpha;
                b1 = 0.0f;
                b2 = -alpha;
                a0 = 1.0f + alpha;
                a1 = -2.0f * cosOmega0;
                a2 = 1.0f - alpha;
                break;
            }
            case Type::Peaking: {
                const float A = std::pow(10.0f, gainDb / 40.0f);
                b0 = 1.0f + alpha * A;
                b1 = -2.0f * cosOmega0;
                b2 = 1.0f - alpha * A;
                a0 = 1.0f + alpha / A;
                a1 = -2.0f * cosOmega0;
                a2 = 1.0f - alpha / A;
                break;
            }
        }

        const float invA0 = 1.0f / a0;
        mB0 = b0 * invA0;
        mB1 = b1 * invA0;
        mB2 = b2 * invA0;
        mA1 = a1 * invA0;
        mA2 = a2 * invA0;
    }

    inline float process(float x) noexcept {
        const float y = mB0 * x + mS1;
        mS1 = mB1 * x - mA1 * y + mS2;
        mS2 = mB2 * x - mA2 * y;
        mS1 = flushDenormal(mS1);
        mS2 = flushDenormal(mS2);
        return flushDenormal(y);
    }

private:
    float mB0 { 1.0f }, mB1 { 0.0f }, mB2 { 0.0f };
    float mA1 { 0.0f }, mA2 { 0.0f };
    float mS1 { 0.0f }, mS2 { 0.0f };
};

// ============================================================================
// Soft Dynamics Peak Compressor
// ============================================================================
class SoftCompressor {
public:
    void prepare(float sampleRate, float thresholdDb = -3.0f, float kneeDb = 12.0f,
                 float ratio = 8.0f, float attackSec = 0.003f, float releaseSec = 0.060f) noexcept {
        mSampleRate = sampleRate > 100.0f ? sampleRate : 48000.0f;
        mThresholdDb = thresholdDb;
        mKneeDb = kneeDb;
        mRatio = std::max(1.0f, ratio);
        mAttackCoeff = std::exp(-1.0f / (mSampleRate * std::max(0.0001f, attackSec)));
        mReleaseCoeff = std::exp(-1.0f / (mSampleRate * std::max(0.001f, releaseSec)));
        mEnvelope = 0.0f;
    }

    void reset() noexcept {
        mEnvelope = 0.0f;
    }

    inline float process(float x) noexcept {
        const float absX = std::abs(x);
        // Level detector (peak)
        if (absX > mEnvelope) {
            mEnvelope = mAttackCoeff * mEnvelope + (1.0f - mAttackCoeff) * absX;
        } else {
            mEnvelope = mReleaseCoeff * mEnvelope + (1.0f - mReleaseCoeff) * absX;
        }
        mEnvelope = flushDenormal(mEnvelope);

        // Convert envelope to dB
        const float envDb = (mEnvelope > 1.0e-5f) ? (20.0f * std::log10(mEnvelope)) : -100.0f;

        // Soft-knee gain computation
        float gainDb = 0.0f;
        const float halfKnee = mKneeDb * 0.5f;

        if (envDb <= mThresholdDb - halfKnee) {
            gainDb = 0.0f;
        } else if (envDb >= mThresholdDb + halfKnee) {
            gainDb = (mThresholdDb + (envDb - mThresholdDb) / mRatio) - envDb;
        } else {
            // In the soft knee region: quadratic interpolation
            const float diff = envDb - mThresholdDb + halfKnee;
            const float kneeGain = (1.0f / mRatio - 1.0f) * (diff * diff) / (2.0f * mKneeDb);
            gainDb = kneeGain;
        }

        const float linearGain = std::pow(10.0f, gainDb / 20.0f);
        return x * linearGain;
    }

private:
    float mSampleRate { 48000.0f };
    float mThresholdDb { -3.0f };
    float mKneeDb { 12.0f };
    float mRatio { 8.0f };
    float mAttackCoeff { 0.0f };
    float mReleaseCoeff { 0.0f };
    float mEnvelope { 0.0f };
};

// ============================================================================
// 4x / 2x Polyphase Halfband Oversampler for Nonlinear Saturation
// ============================================================================
class Oversampler2x {
public:
    void reset() noexcept {
        std::fill(mUpHistory.begin(), mUpHistory.end(), 0.0f);
        std::fill(mDownHistory.begin(), mDownHistory.end(), 0.0f);
    }

    // Upsamples 1 sample to 2 oversampled points
    inline void upsample(float input, float& out0, float& out1) noexcept {
        // Shift history
        for (size_t i = kFilterTaps - 1; i > 0; --i) {
            mUpHistory[i] = mUpHistory[i - 1];
        }
        mUpHistory[0] = input;

        // Polyphase branch 0: center tap delay
        out0 = mUpHistory[kCenterTap];

        // Polyphase branch 1: interpolated half-sample
        float sum = 0.0f;
        for (size_t i = 0; i < kFilterTaps; ++i) {
            sum += mUpHistory[i] * kHalfBandOddCoeffs[i];
        }
        out1 = sum;
    }

    // Downsamples 2 oversampled points back to 1 sample
    inline float downsample(float in0, float in1) noexcept {
        // Shift down history by 2
        for (size_t i = kFilterTaps - 1; i >= 2; --i) {
            mDownHistory[i] = mDownHistory[i - 2];
        }
        mDownHistory[1] = in0;
        mDownHistory[0] = in1;

        // Halfband decimation filter
        float sum = mDownHistory[kCenterTap] * 0.5f;
        for (size_t i = 0; i < kFilterTaps; i += 2) {
            sum += mDownHistory[i] * kHalfBandOddCoeffs[i / 2];
        }
        return sum;
    }

private:
    static constexpr size_t kFilterTaps = 12;
    static constexpr size_t kCenterTap = 5;
    // Windowed sinc half-band coefficients for odd sub-filter
    static constexpr std::array<float, kFilterTaps> kHalfBandOddCoeffs = {
        -0.009477f, 0.024227f, -0.054452f, 0.118671f, -0.315053f, 0.636619f,
         0.636619f, -0.315053f, 0.118671f, -0.054452f, 0.024227f, -0.009477f
    };

    std::array<float, kFilterTaps> mUpHistory { 0.0f };
    std::array<float, kFilterTaps> mDownHistory { 0.0f };
};

} // namespace braun
