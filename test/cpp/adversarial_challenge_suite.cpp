#include "../../plugin/source/dsp/DspMath.h"
#include "../../plugin/source/dsp/Wavetables.h"
#include "../../plugin/source/dsp/FeltPianoDsp.h"
#include "../../plugin/source/dsp/DroneVoiceDsp.h"
#include "../../plugin/source/dsp/TapeDelayDsp.h"
#include "../../plugin/source/dsp/ShimmerReverbDsp.h"
#include "../../plugin/source/dsp/MasterLimiterDsp.h"
#include "../../plugin/source/dsp/DspEngine.h"

#include <iostream>
#include <vector>
#include <cmath>
#include <cassert>
#include <numeric>
#include <string>
#include <random>
#include <limits>

static int gPassed = 0;
static int gFailed = 0;

#define TEST_CHECK(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "  [FAIL] " << msg << " (" << __FILE__ << ":" << __LINE__ << ")\n"; \
            ++gFailed; \
            return; \
        } \
    } while (0)

#define RUN_CHALLENGE(fn) \
    do { \
        std::cout << "[CHALLENGE] " << #fn << "..." << std::endl; \
        const int prevFail = gFailed; \
        fn(); \
        if (gFailed == prevFail) { \
            std::cout << "  [PASS] " << #fn << "\n"; \
            ++gPassed; \
        } \
    } while (0)

// ============================================================================
// 1. Challenge: Zero Denormals, NaNs, and Infs Across Millions of Samples
// ============================================================================
void challenge_denormals_and_numerics() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.felt_volume = 0.85f;
    params.drone1_active = true;
    params.drone1_cutoff = 800.0f;
    params.drone1_resonance = 10.0f;
    params.drone2_active = true;
    params.tape_mix = 0.50f;
    params.tape_feedback = 0.85f;
    params.shimmer_mix = 0.50f;
    params.shimmer_decay = 15.0f;
    params.shimmer_damping = 0.30f;
    params.master_volume = 0.85f;

    // Trigger full 24-voice polyphonic chord burst
    std::vector<braun::MidiEvent> events;
    for (int i = 0; i < 24; ++i) {
        events.push_back({ static_cast<int>(i * 10), 0x90, static_cast<uint8_t>(36 + i * 2), 110 });
    }

    std::vector<float> bufL(512, 0.0f);
    std::vector<float> bufR(512, 0.0f);

    engine.process(bufL.data(), bufR.data(), 512, params, events.data(), static_cast<int>(events.size()));

    // Release all notes after 20 blocks (~213 ms)
    for (int b = 0; b < 20; ++b) {
        std::fill(bufL.begin(), bufL.end(), 0.0f);
        std::fill(bufR.begin(), bufR.end(), 0.0f);
        engine.process(bufL.data(), bufR.data(), 512, params, nullptr, 0);
    }

    const braun::MidiEvent allOff = { 0, 0xB0, 123, 0 };
    engine.process(bufL.data(), bufR.data(), 512, params, &allOff, 1);

    // Let the tail decay into deep subnormal territory (500 blocks = 256,000 samples = 5.3 seconds)
    size_t nanCount = 0;
    size_t infCount = 0;
    size_t denormalCount = 0;

    for (int b = 0; b < 500; ++b) {
        std::fill(bufL.begin(), bufL.end(), 0.0f);
        std::fill(bufR.begin(), bufR.end(), 0.0f);
        engine.process(bufL.data(), bufR.data(), 512, params, nullptr, 0);

        for (int s = 0; s < 512; ++s) {
            float l = bufL[s];
            float r = bufR[s];

            if (std::isnan(l) || std::isnan(r)) ++nanCount;
            if (std::isinf(l) || std::isinf(r)) ++infCount;
            if (std::fpclassify(l) == FP_SUBNORMAL || std::fpclassify(r) == FP_SUBNORMAL) {
                ++denormalCount;
            }
        }
    }

    std::cout << "  [METRICS] NaNs: " << nanCount << ", Infs: " << infCount << ", Denormals: " << denormalCount << "\n";
    TEST_CHECK(nanCount == 0, "Encountered NaN in audio output");
    TEST_CHECK(infCount == 0, "Encountered Inf in audio output");
    TEST_CHECK(denormalCount == 0, "Encountered denormal/subnormal float in audio output");
}

// ============================================================================
// 2. Challenge: Wavetable Boundary and Pathological Phase Interpolation Safety
// ============================================================================
void challenge_wavetable_pathological_phases() {
    braun::WavetableBank bank;
    const std::vector<float> pathologicalPhases = {
        -1.0e-15f,
        -1.0e-7f,
        -0.0f,
        0.0f,
        1.0f - 1.0e-7f,
        1.0f,
        1.0f + 1.0e-7f,
        2.0f,
        2047.999f,
        2048.0f,
        2048.001f,
        1000000.0f,
        -1000000.0f,
        std::numeric_limits<float>::denorm_min(),
        std::numeric_limits<float>::min(),
        std::numeric_limits<float>::max(),
        -std::numeric_limits<float>::max()
    };

    const std::vector<braun::WaveformType> waveforms = {
        braun::WaveformType::Sine,
        braun::WaveformType::Saw,
        braun::WaveformType::Square,
        braun::WaveformType::Triangle,
        braun::WaveformType::Warm,
        braun::WaveformType::Felt,
        braun::WaveformType::CS80
    };

    for (auto wf : waveforms) {
        for (float p : pathologicalPhases) {
            float val = bank.readSample(wf, p);
            TEST_CHECK(!std::isnan(val), "Wavetable produced NaN on phase " + std::to_string(p));
            TEST_CHECK(!std::isinf(val), "Wavetable produced Inf on phase " + std::to_string(p));
            TEST_CHECK(std::abs(val) <= 1.05f, "Wavetable output exceeded range on phase " + std::to_string(p));
        }
    }
}

// ============================================================================
// 3. Challenge: Zero Acoustic Clicks, Pops, or Step Discontinuities in Voice Steal
// ============================================================================
void challenge_acoustic_voice_steal_transients() {
    braun::WavetableBank wavetables;
    braun::FeltPianoSynthesizer piano;
    piano.prepare(48000.0, &wavetables);

    braun::FeltPianoParams params;
    params.waveform = braun::WaveformType::Sine; // Pure sine has no hammer noise burst
    params.volume = 0.80f;
    params.decay = 2.0f;
    params.tone = 0.5f;
    params.hammer = 0.0f;

    // Fill 24 voices with sine tones
    for (int i = 0; i < 24; ++i) {
        piano.noteOn(48 + i, 0.8f, 2.0f, false, false);
    }

    // Process 500 samples so voices reach stable oscillation
    std::vector<float> bufL(500, 0.0f);
    std::vector<float> bufR(500, 0.0f);
    piano.process(bufL.data(), bufR.data(), 500);

    // Now trigger 10 rapid voice steals and measure sample-to-sample difference
    float maxDelta = 0.0f;
    float prevSample = bufL.back();

    for (int steal = 0; steal < 10; ++steal) {
        piano.noteOn(80 + steal, 0.9f, 2.0f, false, false);

        // Process 240 samples (the 5ms steal down-ramp duration)
        std::vector<float> stealBlockL(240, 0.0f);
        std::vector<float> stealBlockR(240, 0.0f);
        piano.process(stealBlockL.data(), stealBlockR.data(), 240);

        for (int s = 0; s < 240; ++s) {
            float delta = std::abs(stealBlockL[s] - prevSample);
            if (delta > maxDelta) maxDelta = delta;
            prevSample = stealBlockL[s];
        }
    }

    std::cout << "  [METRICS] Max voice steal sample-to-sample delta: " << maxDelta << "\n";
    // Discontinuous step clicks would show delta > 0.20
    TEST_CHECK(maxDelta < 0.12f, "Acoustic click detected during voice stealing: delta = " + std::to_string(maxDelta));
}

// ============================================================================
// 4. Challenge: Zero Pop Transients on Early Voice Release & Sustain Latch
// ============================================================================
void challenge_early_release_and_sustain_latch() {
    braun::WavetableBank wavetables;
    braun::FeltPianoSynthesizer piano;
    piano.prepare(48000.0, &wavetables);

    braun::FeltPianoParams params;
    params.waveform = braun::WaveformType::Sine;
    params.volume = 0.80f;
    params.hammer = 0.0f;

    float maxDelta = 0.0f;
    float prevSample = 0.0f;

    for (int trial = 0; trial < 20; ++trial) {
        // Trigger note
        piano.noteOn(60, 0.8f, 2.0f, false, false);

        // Process a random duration between 5 and 50 samples (mid-attack!)
        int preSamples = 5 + (trial * 2);
        std::vector<float> bPreL(preSamples, 0.0f);
        std::vector<float> bPreR(preSamples, 0.0f);
        piano.process(bPreL.data(), bPreR.data(), preSamples);
        prevSample = bPreL.back();

        // Release mid-attack
        piano.noteOff(60);

        // Process 200 samples following early release
        std::vector<float> bPostL(200, 0.0f);
        std::vector<float> bPostR(200, 0.0f);
        piano.process(bPostL.data(), bPostR.data(), 200);

        for (int s = 0; s < 200; ++s) {
            float delta = std::abs(bPostL[s] - prevSample);
            if (delta > maxDelta) maxDelta = delta;
            prevSample = bPostL[s];
        }
    }

    std::cout << "  [METRICS] Max early release sample delta: " << maxDelta << "\n";
    TEST_CHECK(maxDelta < 0.08f, "Pop transient detected on early voice release: delta = " + std::to_string(maxDelta));
}

// ============================================================================
// 5. Challenge: Master Limiter Post-Saturation DC Offset Rejection (< 0.002)
// ============================================================================
void challenge_master_limiter_dc_offset() {
    braun::MasterLimiterDsp limiter;
    limiter.prepare(48000.0);

    braun::MasterLimiterParams params;
    params.masterVolume = 1.0f;
    params.tapeWarmth = 0.80f; // Extreme asymmetric saturation
    params.limiterKnee = 0.70f;

    // Test across 3 different low frequencies: 40 Hz, 80 Hz, 120 Hz
    const float testFreqs[] = { 40.0f, 80.0f, 120.0f };

    for (float f : testFreqs) {
        limiter.reset();

        // Warm up filter and settle DC blockers for 1 second (48000 samples)
        for (int i = 0; i < 48000; ++i) {
            float x = 2.0f * std::sin(braun::kTwoPi * f * static_cast<float>(i) / 48000.0f);
            float outL = 0.0f, outR = 0.0f;
            limiter.processSample(x, x, params, outL, outR);
        }

        // Measure over exact integer periods
        const int periodSamples = static_cast<int>(std::round(48000.0f / f));
        const int totalMeasure = periodSamples * 20;

        double sumL = 0.0;
        double sumR = 0.0;

        for (int i = 0; i < totalMeasure; ++i) {
            float x = 2.0f * std::sin(braun::kTwoPi * f * static_cast<float>(i + 48000) / 48000.0f);
            float outL = 0.0f, outR = 0.0f;
            limiter.processSample(x, x, params, outL, outR);
            sumL += outL;
            sumR += outR;
        }

        const double dcL = std::abs(sumL / static_cast<double>(totalMeasure));
        const double dcR = std::abs(sumR / static_cast<double>(totalMeasure));

        std::cout << "  [METRICS] Freq " << f << " Hz -> DC Left: " << dcL << ", DC Right: " << dcR << "\n";
        TEST_CHECK(dcL < 0.002, "DC offset exceeded 0.002 on Left at " + std::to_string(f) + " Hz: " + std::to_string(dcL));
        TEST_CHECK(dcR < 0.002, "DC offset exceeded 0.002 on Right at " + std::to_string(f) + " Hz: " + std::to_string(dcR));
    }
}

// ============================================================================
// 6. Challenge: Shimmer Reverb Mono Downmix Modal Energy Ratio (> 0.60)
// ============================================================================
void challenge_shimmer_modal_energy_ratio() {
    braun::ShimmerReverbDsp reverb;
    reverb.prepare(48000.0);

    braun::ShimmerReverbParams params;
    params.decaySec = 10.0f;
    params.damping = 0.40f;
    params.shimmer = 0.60f;
    params.mix = 1.0f;
    params.freeze = false;

    // Test 1: Dirac delta pulse
    reverb.reset();
    float outL = 0.0f, outR = 0.0f;
    reverb.processSample(1.0f, 1.0f, params, outL, outR);

    double monoE = 0.0;
    double stereoE = 0.0;

    for (int i = 0; i < 8000; ++i) {
        reverb.processSample(0.0f, 0.0f, params, outL, outR);
        float m = (outL + outR) * 0.5f;
        monoE += m * m;
        stereoE += (outL * outL + outR * outR) * 0.5;
    }

    double ratioPulse = monoE / stereoE;
    std::cout << "  [METRICS] Pulse excitation Mono/Stereo energy ratio: " << ratioPulse << "\n";
    TEST_CHECK(ratioPulse > 0.60, "Pulse energy ratio below 0.60: " + std::to_string(ratioPulse));

    // Test 2: Broadband noise excitation
    reverb.reset();
    std::mt19937 rng(12345);
    std::uniform_real_distribution<float> noise(-1.0f, 1.0f);

    monoE = 0.0;
    stereoE = 0.0;

    for (int i = 0; i < 500; ++i) {
        float n = noise(rng);
        reverb.processSample(n, n, params, outL, outR);
    }

    for (int i = 0; i < 8000; ++i) {
        reverb.processSample(0.0f, 0.0f, params, outL, outR);
        float m = (outL + outR) * 0.5f;
        monoE += m * m;
        stereoE += (outL * outL + outR * outR) * 0.5;
    }

    double ratioNoise = monoE / stereoE;
    std::cout << "  [METRICS] Noise excitation Mono/Stereo energy ratio: " << ratioNoise << "\n";
    TEST_CHECK(ratioNoise > 0.60, "Noise energy ratio below 0.60: " + std::to_string(ratioNoise));
}

// ============================================================================
// 7. Challenge: High-Stress Polyphonic Modulation and Resonant Filter Sweeps
// ============================================================================
void challenge_high_stress_filter_sweeps() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.felt_volume = 0.90f;
    params.drone1_active = true;
    params.drone2_active = true;
    params.master_volume = 0.85f;

    std::mt19937 rng(777);
    std::uniform_real_distribution<float> rand01(0.0f, 1.0f);

    std::vector<float> bufL(512, 0.0f);
    std::vector<float> bufR(512, 0.0f);

    // Rapidly sweep filter cutoff between 20 Hz and 20000 Hz, with resonance between 0.5 and 12.0
    for (int b = 0; b < 200; ++b) {
        float t = static_cast<float>(b) / 200.0f;
        // Exponential sweep
        float cutoff = 20.0f * std::pow(1000.0f, t);
        float resonance = 0.5f + 11.5f * std::sin(braun::kPi * t);

        params.drone1_cutoff = cutoff;
        params.drone1_resonance = resonance;
        params.drone2_cutoff = cutoff * 0.8f;
        params.drone2_resonance = resonance;

        // Periodic note triggers
        if (b % 10 == 0) {
            braun::MidiEvent ev = { 0, 0x90, static_cast<uint8_t>(36 + (b % 40)), 100 };
            engine.process(bufL.data(), bufR.data(), 512, params, &ev, 1);
        } else {
            engine.process(bufL.data(), bufR.data(), 512, params, nullptr, 0);
        }

        for (int s = 0; s < 512; ++s) {
            TEST_CHECK(!std::isnan(bufL[s]) && !std::isnan(bufR[s]), "NaN during extreme filter sweep");
            TEST_CHECK(!std::isinf(bufL[s]) && !std::isinf(bufR[s]), "Inf during extreme filter sweep");
            TEST_CHECK(std::fpclassify(bufL[s]) != FP_SUBNORMAL && std::fpclassify(bufR[s]) != FP_SUBNORMAL,
                       "Subnormal during extreme filter sweep");
        }
    }
}

// ============================================================================
// 8. Challenge: Wavefolder Triple-Angle Trigonometric Epsilon Invariance (< 1e-5)
// ============================================================================
void challenge_wavefolder_triple_angle_epsilon_invariance() {
    float maxDiff = 0.0f;
    float worstX = 0.0f, worstDrive = 0.0f, worstFold = 0.0f, worstRef = 0.0f, worstOpt = 0.0f;
    int nanCount = 0;
    int infCount = 0;
    int subnormalCount = 0;
    int totalEvaluations = 0;

    float maxDiffOperational = 0.0f;
    float worstOpX = 0.0f, worstOpDrive = 0.0f, worstOpFold = 0.0f;

    // Continuous fine-grained sweep across x in [-5.0, 5.0], drive in [0.2, 5.0], fold in [0.0, 1.0]
    for (float drive = 0.2f; drive <= 5.0f; drive += 0.2f) {
        for (float fold = 0.0f; fold <= 1.0f; fold += 0.05f) {
            for (float x = -5.0f; x <= 5.0f; x += 0.005f) {
                const float driven = x * drive;
                const float s1 = std::sin(braun::kHalfPi * driven);
                const float s2 = s1 - fold * std::sin(braun::kThreeHalfPi * driven);
                const float ref = std::tanh(s2);

                const float opt = braun::wavefold(x, drive, fold);

                if (std::isnan(opt)) ++nanCount;
                if (std::isinf(opt)) ++infCount;
                if (std::fpclassify(opt) == FP_SUBNORMAL) ++subnormalCount;

                const float diff = std::abs(ref - opt);
                if (diff > maxDiff) {
                    maxDiff = diff;
                    worstX = x;
                    worstDrive = drive;
                    worstFold = fold;
                    worstRef = ref;
                    worstOpt = opt;
                }

                // Operational synthesizer range: drive <= 4.0f (the hard clamp in DroneVoiceDsp), x in [-2.5, 2.5]
                if (drive <= 4.0f && std::abs(x) <= 2.5f) {
                    if (diff > maxDiffOperational) {
                        maxDiffOperational = diff;
                        worstOpX = x;
                        worstOpDrive = drive;
                        worstOpFold = fold;
                    }
                }
                ++totalEvaluations;
            }
        }
    }

    std::cout << "  [METRICS] Wavefolder sweep across " << totalEvaluations << " points:\n";
    std::cout << "            Operational (drive <= 4.0, |x| <= 2.5) maxDiff: " << maxDiffOperational << "\n";
    std::cout << "            Operational worst case: x=" << worstOpX << ", drive=" << worstOpDrive << ", fold=" << worstOpFold << "\n";
    std::cout << "            Extended stress (drive <= 5.0, |x| <= 5.0) maxDiff: " << maxDiff << "\n";
    std::cout << "            Extended worst case: x=" << worstX << ", drive=" << worstDrive << ", fold=" << worstFold << "\n";
    std::cout << "            NaNs: " << nanCount << ", Infs: " << infCount << ", Subnormals: " << subnormalCount << "\n";

    TEST_CHECK(nanCount == 0, "Wavefolder produced NaN");
    TEST_CHECK(infCount == 0, "Wavefolder produced Inf");
    TEST_CHECK(subnormalCount == 0, "Wavefolder produced subnormal float");
    TEST_CHECK(maxDiffOperational < 1.0e-5f, "Wavefolder operational epsilon bound violated: maxDiff = " + std::to_string(maxDiffOperational));
}

// ============================================================================
// 9. Challenge: Sub-Block Filter Coefficient Updates Zipper Noise & Click Immunity
// ============================================================================
void challenge_sub_block_filter_zipper_noise_and_click_immunity() {
    braun::Biquad filterL;
    braun::Biquad filterR;
    constexpr float sampleRate = 48000.0f;
    constexpr int totalSamples = 96000; // 2 seconds

    float maxDeltaBoundary = 0.0f;
    float maxDeltaInternal = 0.0f;
    float prevOutput = 0.0f;

    // Test lowpass filter with rapid continuous exponential cutoff sweep (30 Hz to 18,000 Hz)
    // with 16-sample sub-block coefficient updates and coefficient copying
    braun::OnePoleSmoother cutoffSmoother;
    cutoffSmoother.setSampleRate(sampleRate);
    cutoffSmoother.setTimeConstant(0.015f);
    cutoffSmoother.reset(100.0f);

    int subBlockCounter = 0;
    int nanCount = 0;
    int infCount = 0;

    for (int n = 0; n < totalSamples; ++n) {
        // Exponential sweep target
        const float t = static_cast<float>(n) / static_cast<float>(totalSamples);
        const float targetCutoff = 30.0f * std::pow(600.0f, t);
        cutoffSmoother.setTarget(targetCutoff);
        const float smoothedCutoff = cutoffSmoother.next();

        if (subBlockCounter == 0) {
            filterL.configure(braun::Biquad::Type::Lowpass, sampleRate, smoothedCutoff, 2.0f); // High Q = 2.0
            filterR.copyCoefficientsFrom(filterL);
            subBlockCounter = 15;
        } else {
            --subBlockCounter;
        }

        // Input: bandlimited multi-sine test stimulus
        const float in = 0.4f * std::sin(braun::kTwoPi * 220.0f * n / sampleRate) +
                         0.3f * std::sin(braun::kTwoPi * 880.0f * n / sampleRate);

        const float outL = filterL.process(in);
        const float outR = filterR.process(in);

        if (std::isnan(outL) || std::isnan(outR)) ++nanCount;
        if (std::isinf(outL) || std::isinf(outR)) ++infCount;

        // Stereo symmetry check: Left and Right must be bit-exact
        TEST_CHECK(outL == outR, "Biquad copyCoefficientsFrom produced stereo divergence");

        if (n > 0) {
            const float delta = std::abs(outL - prevOutput);
            if ((n % 16) == 0) {
                if (delta > maxDeltaBoundary) maxDeltaBoundary = delta;
            } else {
                if (delta > maxDeltaInternal) maxDeltaInternal = delta;
            }
        }
        prevOutput = outL;
    }

    std::cout << "  [METRICS] Sub-block filter update test (96k samples, Q = 2.0):\n";
    std::cout << "            Max step delta at 16-sample boundary: " << maxDeltaBoundary << "\n";
    std::cout << "            Max step delta internal to sub-block:  " << maxDeltaInternal << "\n";

    TEST_CHECK(nanCount == 0, "Biquad filter produced NaN during cutoff sweep");
    TEST_CHECK(infCount == 0, "Biquad filter produced Inf during cutoff sweep");
    // Boundary step delta should not significantly exceed internal continuous deltas (no zipper pop)
    TEST_CHECK(maxDeltaBoundary < 0.12f, "Zipper noise click detected at sub-block boundary: " + std::to_string(maxDeltaBoundary));
}

// ============================================================================
// 10. Challenge: Tape Delay Power-of-Two Masking Boundary Continuity & Echo Cleanliness
// ============================================================================
void challenge_tape_delay_power_of_two_masking_boundary_continuity() {
    braun::TapeDelayDsp delay;
    delay.prepare(48000.0, 3.5); // Buffer capacity = 262,144 samples

    braun::TapeDelayParams params;
    params.timeSec = 0.40f;
    params.feedback = 0.65f;
    params.toneHz = 4000.0f;
    params.mix = 1.0f; // 100% wet
    params.wowAmount = 0.35f;

    // Process 600,000 samples (> 2 full circular buffer wraps of 262,144)
    constexpr int kTotalSamples = 600000;
    float prevOut = 0.0f;
    float maxDelta = 0.0f;
    int nanCount = 0;
    int infCount = 0;
    int denormalCount = 0;

    // Feed a continuous 350 Hz sine tone
    for (int n = 0; n < kTotalSamples; ++n) {
        const float in = 0.5f * std::sin(braun::kTwoPi * 350.0f * n / 48000.0f);
        float outL = 0.0f, outR = 0.0f;

        delay.processSample(in, in, params, outL, outR);

        if (std::isnan(outL) || std::isnan(outR)) ++nanCount;
        if (std::isinf(outL) || std::isinf(outR)) ++infCount;
        if (std::fpclassify(outL) == FP_SUBNORMAL || std::fpclassify(outR) == FP_SUBNORMAL) {
            ++denormalCount;
        }

        if (n > 1000) { // After initial warm up
            const float delta = std::abs(outL - prevOut);
            if (delta > maxDelta) maxDelta = delta;
        }
        prevOut = outL;
    }

    std::cout << "  [METRICS] Tape Delay 600k samples (> 2 buffer wraps):\n";
    std::cout << "            Max sample-to-sample delta: " << maxDelta << "\n";
    std::cout << "            NaNs: " << nanCount << ", Infs: " << infCount << ", Denormals: " << denormalCount << "\n";

    TEST_CHECK(nanCount == 0, "Tape delay produced NaN across buffer wrap");
    TEST_CHECK(infCount == 0, "Tape delay produced Inf across buffer wrap");
    TEST_CHECK(denormalCount == 0, "Tape delay produced denormal across buffer wrap");
    TEST_CHECK(maxDelta < 0.15f, "Discontinuous click detected during tape delay buffer wrap: delta = " + std::to_string(maxDelta));
}

// ============================================================================
// 11. Challenge: Rapid Voice Triggering + Heavy Wavefolding + Max Reverb Decay Stress
// ============================================================================
void challenge_rapid_voice_trigger_heavy_wavefold_max_shimmer_stress() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 256);

    braun::ParameterSnapshot params;
    // 1. Polyphony settings
    params.felt_volume = 0.90f;
    params.felt_decay = 4.0f;
    params.felt_tone = 0.70f;
    params.felt_hammer = 0.30f;

    // 2. Heavy wavefolding settings
    params.drone1_active = true;
    params.drone1_cutoff = 1500.0f;
    params.drone1_resonance = 8.0f;
    params.drone1_fold = 95.0f;
    params.drone2_active = true;
    params.drone2_cutoff = 1200.0f;
    params.drone2_resonance = 6.0f;
    params.drone2_fold = 90.0f;

    // 3. Maximum reverb decay & extreme shimmer
    params.shimmer_mix = 0.75f;
    params.shimmer_decay = 25.0f;   // Maximum decay
    params.shimmer_damping = 0.14f; // Minimum absorption floor
    params.shimmer_amount = 0.90f;  // Heavy shimmer feedback send
    params.shimmer_freeze = false;

    params.tape_mix = 0.40f;
    params.tape_feedback = 0.80f;
    params.master_volume = 0.90f;

    std::vector<float> bufL(256, 0.0f);
    std::vector<float> bufR(256, 0.0f);

    int nanCount = 0;
    int infCount = 0;
    int denormalCount = 0;

    std::mt19937 rng(424242);
    std::uniform_int_distribution<int> noteDist(36, 96);
    std::uniform_int_distribution<int> velDist(60, 127);

    // Phase 1: 500 blocks of rapid voice triggering (128,000 samples = ~2.67 sec)
    for (int b = 0; b < 500; ++b) {
        std::fill(bufL.begin(), bufL.end(), 0.0f);
        std::fill(bufR.begin(), bufR.end(), 0.0f);

        // Every 3 blocks, trigger 2 to 4 rapid notes to stress voice stealing & compaction
        std::vector<braun::MidiEvent> events;
        if (b % 3 == 0) {
            const int numNotes = 2 + (b % 3);
            for (int i = 0; i < numNotes; ++i) {
                events.push_back({ i * 10, 0x90, static_cast<uint8_t>(noteDist(rng)), static_cast<uint8_t>(velDist(rng)) });
            }
        }

        // Cycle sustain pedal every 30 blocks
        if (b % 30 == 0) {
            events.push_back({ 0, 0xB0, 64, 127 }); // Pedal DOWN
        } else if (b % 30 == 15) {
            events.push_back({ 0, 0xB0, 64, 0 });   // Pedal UP
        }

        // Toggle shimmer freeze on/off to stress feedback loop
        if (b == 200) params.shimmer_freeze = true;
        if (b == 260) params.shimmer_freeze = false;

        engine.process(bufL.data(), bufR.data(), 256, params,
                       events.empty() ? nullptr : events.data(),
                       static_cast<int>(events.size()));

        for (int s = 0; s < 256; ++s) {
            if (std::isnan(bufL[s]) || std::isnan(bufR[s])) ++nanCount;
            if (std::isinf(bufL[s]) || std::isinf(bufR[s])) ++infCount;
            if (std::fpclassify(bufL[s]) == FP_SUBNORMAL || std::fpclassify(bufR[s]) == FP_SUBNORMAL) {
                ++denormalCount;
            }
        }
    }

    // Phase 2: All notes off panic, then 600 blocks of silent reverberation decay (153,600 samples = 3.2 sec)
    const braun::MidiEvent allOff = { 0, 0xB0, 123, 0 };
    engine.process(bufL.data(), bufR.data(), 256, params, &allOff, 1);

    // Mute drone oscillators so only the reverberation tail decays to zero
    params.drone1_active = false;
    params.drone2_active = false;

    for (int b = 0; b < 600; ++b) {
        std::fill(bufL.begin(), bufL.end(), 0.0f);
        std::fill(bufR.begin(), bufR.end(), 0.0f);

        engine.process(bufL.data(), bufR.data(), 256, params, nullptr, 0);

        for (int s = 0; s < 256; ++s) {
            if (std::isnan(bufL[s]) || std::isnan(bufR[s])) ++nanCount;
            if (std::isinf(bufL[s]) || std::isinf(bufR[s])) ++infCount;
            if (std::fpclassify(bufL[s]) == FP_SUBNORMAL || std::fpclassify(bufR[s]) == FP_SUBNORMAL) {
                ++denormalCount;
            }
        }
    }

    std::cout << "  [METRICS] Combined Stress Test (281,600 samples across voice burst + decay):\n";
    std::cout << "            NaNs: " << nanCount << ", Infs: " << infCount << ", Denormals: " << denormalCount << "\n";

    TEST_CHECK(nanCount == 0, "Encountered NaN under combined stress test");
    TEST_CHECK(infCount == 0, "Encountered Inf under combined stress test");
    TEST_CHECK(denormalCount == 0, "Encountered denormal under combined stress test");
}

// ============================================================================
// Main Runner
// ============================================================================
int main() {
    std::cout << "========================================================\n";
    std::cout << " BRAUN AS-42 Empirical Challenger Verification Suite    \n";
    std::cout << "========================================================\n";

    RUN_CHALLENGE(challenge_denormals_and_numerics);
    RUN_CHALLENGE(challenge_wavetable_pathological_phases);
    RUN_CHALLENGE(challenge_acoustic_voice_steal_transients);
    RUN_CHALLENGE(challenge_early_release_and_sustain_latch);
    RUN_CHALLENGE(challenge_master_limiter_dc_offset);
    RUN_CHALLENGE(challenge_shimmer_modal_energy_ratio);
    RUN_CHALLENGE(challenge_high_stress_filter_sweeps);
    RUN_CHALLENGE(challenge_wavefolder_triple_angle_epsilon_invariance);
    RUN_CHALLENGE(challenge_sub_block_filter_zipper_noise_and_click_immunity);
    RUN_CHALLENGE(challenge_tape_delay_power_of_two_masking_boundary_continuity);
    RUN_CHALLENGE(challenge_rapid_voice_trigger_heavy_wavefold_max_shimmer_stress);

    std::cout << "========================================================\n";
    std::cout << "Result: " << gPassed << " passed, " << gFailed << " failed.\n";
    std::cout << "========================================================\n";

    return (gFailed == 0) ? 0 : 1;
}

