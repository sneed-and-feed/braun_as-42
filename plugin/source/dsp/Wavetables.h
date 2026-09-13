#pragma once

#include "DspMath.h"
#include <cmath>
#include <vector>
#include <array>
#include <string>

namespace braun {

enum class WaveformType {
    Felt = 0,
    Sine,
    Saw,
    Square,
    CS80,
    Triangle,
    Warm
};

/**
 * Pre-computed band-limited Fourier wavetables with Lanczos sigma factor windowing.
 * Eliminates high-frequency Gibbs overshoot and Nyquist foldover aliasing.
 */
class WavetableBank {
public:
    static constexpr size_t kTableSize = 2048;
    static constexpr size_t kNumHarmonics = 64;

    WavetableBank() {
        initTables();
    }

    void initTables() {
        generateSineTable(mSineTable);
        generateFourierTable(mSawTable, [](int n, float& a_n, float& b_n) {
            // Sawtooth: b_n = -(2 / (n * pi)) * (-1)^n * Lanczos(n)
            const float lanczos = std::sin(kPi * n / kNumHarmonics) / (kPi * n / kNumHarmonics);
            const float sign = (n % 2 == 0) ? 1.0f : -1.0f;
            b_n = -(2.0f / (n * kPi)) * sign * lanczos;
            a_n = 0.0f;
        });

        generateFourierTable(mSquareTable, [](int n, float& a_n, float& b_n) {
            // Square: b_n = (4 / (n * pi)) * Lanczos(n) for odd n
            if (n % 2 != 0) {
                const float lanczos = std::sin(kPi * n / kNumHarmonics) / (kPi * n / kNumHarmonics);
                b_n = (4.0f / (n * kPi)) * lanczos;
            } else {
                b_n = 0.0f;
            }
            a_n = 0.0f;
        });

        generateFourierTable(mTriangleTable, [](int n, float& a_n, float& b_n) {
            // Triangle: b_n = (8 / (pi^2 * n^2)) * (-1)^((n-1)/2) for odd n
            if (n % 2 != 0) {
                const int k = (n - 1) / 2;
                const float sign = (k % 2 == 0) ? 1.0f : -1.0f;
                b_n = (8.0f / (kPi * kPi * n * n)) * sign;
            } else {
                b_n = 0.0f;
            }
            a_n = 0.0f;
        });

        generateFourierTable(mWarmTable, [](int n, float& a_n, float& b_n) {
            // Warm Analog (Elta Solar 42n discrete core):
            const float window = std::cos(kPi * n / (2.0f * kNumHarmonics));
            const float amp = (1.0f / std::pow(static_cast<float>(n), 1.25f)) * window;
            b_n = amp * (n % 2 == 0 ? 0.22f : 0.95f);
            a_n = amp * 0.08f;
        });
    }

    // High-precision linear table interpolation with guard point
    inline float readSample(WaveformType type, float phase01) const noexcept {
        const float* table = nullptr;
        switch (type) {
            case WaveformType::Sine:     table = mSineTable.data(); break;
            case WaveformType::Saw:
            case WaveformType::CS80:     table = mSawTable.data(); break;
            case WaveformType::Square:   table = mSquareTable.data(); break;
            case WaveformType::Triangle: table = mTriangleTable.data(); break;
            case WaveformType::Warm:     table = mWarmTable.data(); break;
            case WaveformType::Felt:     table = mSawTable.data(); break;
        }

        const float p = phase01 - std::floor(phase01);
        const float pos = p * static_cast<float>(kTableSize);
        const size_t idx = static_cast<size_t>(pos);
        const float frac = pos - static_cast<float>(idx);

        const float s0 = table[idx];
        const float s1 = table[idx + 1];
        return s0 + frac * (s1 - s0);
    }

    const std::array<float, kTableSize + 1>& getSineTable() const noexcept { return mSineTable; }
    const std::array<float, kTableSize + 1>& getSawTable() const noexcept { return mSawTable; }
    const std::array<float, kTableSize + 1>& getSquareTable() const noexcept { return mSquareTable; }
    const std::array<float, kTableSize + 1>& getTriangleTable() const noexcept { return mTriangleTable; }
    const std::array<float, kTableSize + 1>& getWarmTable() const noexcept { return mWarmTable; }

private:
    void generateSineTable(std::array<float, kTableSize + 1>& table) {
        for (size_t i = 0; i <= kTableSize; ++i) {
            const float phase = kTwoPi * static_cast<float>(i) / static_cast<float>(kTableSize);
            table[i] = std::sin(phase);
        }
    }

    template<typename GeneratorFunc>
    void generateFourierTable(std::array<float, kTableSize + 1>& table, GeneratorFunc gen) {
        std::array<float, kNumHarmonics + 1> a { 0.0f };
        std::array<float, kNumHarmonics + 1> b { 0.0f };

        for (int n = 1; n <= static_cast<int>(kNumHarmonics); ++n) {
            gen(n, a[n], b[n]);
        }

        float maxVal = 0.0f;
        for (size_t i = 0; i < kTableSize; ++i) {
            float sum = 0.0f;
            const float theta = kTwoPi * static_cast<float>(i) / static_cast<float>(kTableSize);
            for (int n = 1; n <= static_cast<int>(kNumHarmonics); ++n) {
                const float nTheta = static_cast<float>(n) * theta;
                sum += a[n] * std::cos(nTheta) + b[n] * std::sin(nTheta);
            }
            table[i] = sum;
            maxVal = std::max(maxVal, std::abs(sum));
        }

        // Normalize peak to 1.0f
        if (maxVal > 1.0e-5f) {
            const float invMax = 1.0f / maxVal;
            for (size_t i = 0; i < kTableSize; ++i) {
                table[i] *= invMax;
            }
        }
        // Guard sample
        table[kTableSize] = table[0];
    }

    std::array<float, kTableSize + 1> mSineTable { 0.0f };
    std::array<float, kTableSize + 1> mSawTable { 0.0f };
    std::array<float, kTableSize + 1> mSquareTable { 0.0f };
    std::array<float, kTableSize + 1> mTriangleTable { 0.0f };
    std::array<float, kTableSize + 1> mWarmTable { 0.0f };
};

} // namespace braun
