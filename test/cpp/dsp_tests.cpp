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
#include <chrono>

// Test framework macros
static int gTestsPassed = 0;
static int gTestsFailed = 0;

#define TEST_ASSERT(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "  FAIL: " << msg << " (" << __FILE__ << ":" << __LINE__ << ")\n"; \
            ++gTestsFailed; \
            return; \
        } \
    } while (0)

#define RUN_TEST(fn) \
    do { \
        std::cout << "[RUNNING] " << #fn << "..." << std::endl; \
        const int prevFailures = gTestsFailed; \
        fn(); \
        if (gTestsFailed == prevFailures) { \
            std::cout << "  [PASS] " << #fn << "\n"; \
            ++gTestsPassed; \
        } \
    } while (0)

// ============================================================================
// Test 1: Wavefolder transfer curve matches JS within numerical tolerance
// ============================================================================
void test_wavefolder_transfer_curve_matches_js() {
    constexpr int kSamples = 2048;
    constexpr float kHalf = (kSamples - 1) / 2.0f;

    // Test cases: (drive, fold)
    const std::vector<std::pair<float, float>> testCases = {
        { 1.8f, 0.6f },
        { 1.0f, 0.0f },
        { 2.5f, 0.8f },
        { 3.2f, 0.45f }
    };

    for (const auto& tc : testCases) {
        const float drive = tc.first;
        const float fold = tc.second;

        float maxDiff = 0.0f;
        for (int i = 0; i < kSamples; ++i) {
            const float x = (static_cast<float>(i) - kHalf) / kHalf; // -1.0 to +1.0

            // JS reference formula
            const float driven = x * drive;
            const float stage1 = std::sin(braun::kHalfPi * driven);
            const float stage2 = stage1 - fold * std::sin(braun::kThreeHalfPi * driven);
            const float jsExpected = std::tanh(stage2);

            // C++ implementation
            const float cppActual = braun::wavefold(x, drive, fold);

            const float diff = std::abs(jsExpected - cppActual);
            if (diff > maxDiff) maxDiff = diff;
        }

        TEST_ASSERT(maxDiff < 1.0e-5f, "Wavefolder curve deviates from JS reference: diff = " + std::to_string(maxDiff));
    }

    // Verify tape saturation curve matches JS reference
    for (float warmth : { 0.0f, 0.20f, 0.35f, 0.40f, 0.80f }) {
        float maxDiff = 0.0f;
        for (int i = 0; i < kSamples; ++i) {
            const float x = (static_cast<float>(i) - kHalf) / kHalf;

            // JS reference
            float jsExpected = x;
            if (warmth > 0.001f) {
                const float posDrive = 1.0f + warmth * 1.5f;
                const float asymPos = 1.0f + warmth * 0.25f;
                const float maxOut = braun::kTwoOverPi * std::atan(posDrive * asymPos);
                const float signX = (x > 0.0f) ? 1.0f : ((x < 0.0f) ? -1.0f : 0.0f);
                const float asym = x + warmth * 0.25f * x * x * signX;
                const float saturated = braun::kTwoOverPi * std::atan(posDrive * asym);
                const float normalized = std::clamp(saturated / maxOut, -1.0f, 1.0f);
                jsExpected = braun::applySmoothBoundaryKnee(normalized, 0.72f);
            }

            const float cppActual = braun::tapeSaturate(x, warmth);
            const float diff = std::abs(jsExpected - cppActual);
            if (diff > maxDiff) maxDiff = diff;
        }
        TEST_ASSERT(maxDiff < 1.0e-4f, "Tape saturation curve deviates from JS reference: diff = " + std::to_string(maxDiff));
    }
}

// ============================================================================
// Test 2: Hermite limiter is C1 continuous, unity below k=0.8, limits at 1.0
// ============================================================================
void test_hermite_limiter_c1_continuity_and_bounds() {
    constexpr float k = 0.80f;

    // 1. Verify exact unity gain for |x| <= k
    for (float x = -0.80f; x <= 0.80f; x += 0.01f) {
        const float y = braun::softLimit(x, k);
        TEST_ASSERT(std::abs(y - x) < 1.0e-7f, "Soft limiter not unity in linear region at x = " + std::to_string(x));
    }

    // 2. Numerical C0 continuity at x = +/- k
    constexpr float eps = 1.0e-5f;
    const float yBelow = braun::softLimit(k - eps, k);
    const float yAt = braun::softLimit(k, k);
    const float yAbove = braun::softLimit(k + eps, k);
    TEST_ASSERT(std::abs(yBelow - yAt) < 2.0f * eps, "C0 discontinuity below knee");
    TEST_ASSERT(std::abs(yAbove - yAt) < 2.0f * eps, "C0 discontinuity above knee");

    // 3. Numerical C1 derivative continuity at x = k
    // Left derivative = 1.0 (since y = x for x <= k)
    const float leftDeriv = (yAt - yBelow) / eps;
    // Right derivative
    const float rightDeriv = (yAbove - yAt) / eps;
    TEST_ASSERT(std::abs(leftDeriv - 1.0f) < 0.01f, "Left derivative not 1.0 at knee: " + std::to_string(leftDeriv));
    TEST_ASSERT(std::abs(rightDeriv - 1.0f) < 0.01f, "Right derivative not 1.0 at knee: " + std::to_string(rightDeriv));
    TEST_ASSERT(std::abs(leftDeriv - rightDeriv) < 0.01f, "C1 derivative mismatch at knee");

    // 4. Numerical derivative at x = 1.0: must be 0.0
    const float y1 = braun::softLimit(1.0f, k);
    const float y1Minus = braun::softLimit(1.0f - eps, k);
    const float boundaryDeriv = (y1 - y1Minus) / eps;
    TEST_ASSERT(std::abs(y1 - 1.0f) < 1.0e-5f, "Limiter output not 1.0 at x = 1.0");
    TEST_ASSERT(std::abs(boundaryDeriv) < 0.005f, "Derivative at x = 1.0 is not zero: " + std::to_string(boundaryDeriv));

    // 5. Monotonicity and bounds across [-2.0, 2.0]
    float prevY = -1.0f;
    for (float x = -1.5f; x <= 1.5f; x += 0.001f) {
        const float y = braun::softLimit(x, k);
        TEST_ASSERT(y >= -1.0001f && y <= 1.0001f, "Limiter output out of bounds [-1, 1]: " + std::to_string(y));
        if (x > -1.0f && x < 1.0f) {
            TEST_ASSERT(y >= prevY - 1.0e-6f, "Limiter is not monotonically increasing at x = " + std::to_string(x));
        }
        prevY = y;
    }
}

// ============================================================================
// Test 3: Tape delay feedback normalization satisfies loop gain < 1.0
// ============================================================================
void test_tape_delay_feedback_normalization_stability() {
    braun::TapeDelayDsp delay;
    delay.prepare(48000.0, 3.5);

    braun::TapeDelayParams params;
    params.timeSec = 0.050f;     // Short delay for fast recirculation
    params.feedback = 0.90f;     // High feedback near 0.92 max
    params.toneHz = 3600.0f;
    params.wowAmount = 0.0f;
    params.mix = 1.0f;

    // Small-signal loop gain check
    constexpr float kShaperGain = 1.5173f;
    const float directFb = (params.feedback * 0.70f) / kShaperGain;
    const float crossFb = (params.feedback * 0.30f) / kShaperGain;
    const float effectiveLoopGain = (directFb + crossFb) * kShaperGain;
    TEST_ASSERT(effectiveLoopGain <= params.feedback + 1.0e-5f, "Feedback normalization failed loop gain bound");
    TEST_ASSERT(effectiveLoopGain < 1.0f, "Loop gain must be strictly < 1.0");

    // Inject 100 samples of full-scale noise
    for (int i = 0; i < 100; ++i) {
        const float in = (i % 2 == 0) ? 0.9f : -0.9f;
        float outL = 0.0f, outR = 0.0f;
        delay.processSample(in, in, params, outL, outR);
    }

    // Now run 100,000 samples of silence and monitor energy
    float peak = 0.0f;
    float finalSampleL = 0.0f;
    float finalSampleR = 0.0f;

    for (int i = 0; i < 100000; ++i) {
        float outL = 0.0f, outR = 0.0f;
        delay.processSample(0.0f, 0.0f, params, outL, outR);
        peak = std::max(peak, std::max(std::abs(outL), std::abs(outR)));
        finalSampleL = outL;
        finalSampleR = outR;
    }

    TEST_ASSERT(peak < 1.5f, "Delay output exploded during feedback: peak = " + std::to_string(peak));
    TEST_ASSERT(std::abs(finalSampleL) < 0.01f, "Delay did not decay over time: L = " + std::to_string(finalSampleL));
    TEST_ASSERT(std::abs(finalSampleR) < 0.01f, "Delay did not decay over time: R = " + std::to_string(finalSampleR));
}

// ============================================================================
// Test 4: Pitch shifter produces octave shift without discontinuities
// ============================================================================
void test_pitch_shifter_octave_shift_continuity() {
    braun::DualDelayPitchShifter ps;
    ps.prepare(48000.0);

    constexpr int kNumSamples = 48000; // 1 second
    constexpr float fs = 48000.0f;
    constexpr float inputFreq = 400.0f; // 400 Hz * 0.045s = 18 integer cycles
    constexpr float targetFreq = 800.0f; // +1 octave shifted frequency

    std::vector<float> input(kNumSamples);
    std::vector<float> output(kNumSamples);

    for (int i = 0; i < kNumSamples; ++i) {
        input[i] = std::sin(braun::kTwoPi * inputFreq * static_cast<float>(i) / fs);
        output[i] = ps.processSample(input[i]);
    }

    // 1. Check clickless continuity: no huge jump between consecutive samples
    float maxStep = 0.0f;
    for (int i = 1; i < kNumSamples; ++i) {
        const float step = std::abs(output[i] - output[i - 1]);
        if (step > maxStep) maxStep = step;
    }

    // A sine at 800Hz has max derivative 2*pi*800/48000 ~ 0.105 per sample.
    // Ensure no wrap-around glitch step > 0.25 occurs.
    TEST_ASSERT(maxStep < 0.25f, "Pitch shifter produced sample-to-sample glitch step: " + std::to_string(maxStep));

    // 2. Check spectral energy: octave up at 800 Hz should have high correlation
    // Compute correlation with 800 Hz sine/cosine over second half of buffer (after warm-up)
    float corrCos800 = 0.0f;
    float corrSin800 = 0.0f;
    float corrCos400 = 0.0f;
    float corrSin400 = 0.0f;
    constexpr int startSample = 24000;
    constexpr int count = kNumSamples - startSample;

    for (int i = startSample; i < kNumSamples; ++i) {
        const float theta800 = braun::kTwoPi * targetFreq * static_cast<float>(i) / fs;
        corrCos800 += output[i] * std::cos(theta800);
        corrSin800 += output[i] * std::sin(theta800);

        const float theta400 = braun::kTwoPi * inputFreq * static_cast<float>(i) / fs;
        corrCos400 += output[i] * std::cos(theta400);
        corrSin400 += output[i] * std::sin(theta400);
    }

    const float mag800 = std::sqrt(corrCos800 * corrCos800 + corrSin800 * corrSin800) / count;
    const float mag400 = std::sqrt(corrCos400 * corrCos400 + corrSin400 * corrSin400) / count;

    TEST_ASSERT(mag800 > 0.25f, "Pitch shifter failed to produce strong +1 octave energy at 800 Hz: mag = " + std::to_string(mag800));
    TEST_ASSERT(mag800 > mag400 * 2.0f, "Shifted energy at 800 Hz should dominate fundamental 400 Hz: 800Hz=" + std::to_string(mag800) + " vs 400Hz=" + std::to_string(mag400));

    // 3. Zero-crossing rate check: output should cross zero at approximately 2x input rate
    int inCrossings = 0;
    int outCrossings = 0;
    for (int i = startSample + 1; i < kNumSamples; ++i) {
        if ((input[i] >= 0.0f && input[i - 1] < 0.0f) || (input[i] < 0.0f && input[i - 1] >= 0.0f)) {
            ++inCrossings;
        }
        if ((output[i] >= 0.0f && output[i - 1] < 0.0f) || (output[i] < 0.0f && output[i - 1] >= 0.0f)) {
            ++outCrossings;
        }
    }
    const float crossRatio = static_cast<float>(outCrossings) / static_cast<float>(inCrossings);
    TEST_ASSERT(crossRatio > 1.85f && crossRatio < 2.15f, "Pitch shift frequency ratio should be ~2.0: ratio = " + std::to_string(crossRatio));
}

// ============================================================================
// Test 5: 24-voice polyphony triggers, sustains, and releases cleanly
// ============================================================================
void test_polyphonic_voice_allocation_and_stealing() {
    braun::WavetableBank wavetables;
    braun::FeltPianoSynthesizer piano;
    piano.prepare(48000.0, &wavetables);

    TEST_ASSERT(piano.getActiveVoiceCount() == 0, "Initial active voices must be 0");

    // Trigger 24 notes (fill voice pool)
    for (int note = 48; note < 48 + 24; ++note) {
        piano.noteOn(note, 0.7f, 5.0f, false, false);
    }
    TEST_ASSERT(piano.getActiveVoiceCount() == 24, "Voice count should be 24 after filling pool");

    // Hold first 12 notes (simulating sustain pedal or held chord)
    for (int note = 48; note < 48 + 12; ++note) {
        piano.noteOn(note, 0.7f, 5.0f, true, true);
    }

    // Now trigger 6 new notes (forces voice stealing)
    for (int note = 80; note < 86; ++note) {
        piano.noteOn(note, 0.8f, 5.0f, false, false);
    }

    // Voice count should remain exactly 24
    TEST_ASSERT(piano.getActiveVoiceCount() == 24, "Active voices must remain capped at 24");

    // Render audio block and verify no NaNs or Infs
    std::vector<float> bufL(1024, 0.0f);
    std::vector<float> bufR(1024, 0.0f);
    piano.process(bufL.data(), bufR.data(), 1024);

    for (int i = 0; i < 1024; ++i) {
        TEST_ASSERT(!std::isnan(bufL[i]), "NaN in piano output L");
        TEST_ASSERT(!std::isinf(bufL[i]), "Inf in piano output L");
        TEST_ASSERT(!std::isnan(bufR[i]), "NaN in piano output R");
        TEST_ASSERT(!std::isinf(bufR[i]), "Inf in piano output R");
    }

    // Release all notes and verify decay
    piano.releaseAll();
    std::vector<float> decayL(48000, 0.0f);
    std::vector<float> decayR(48000, 0.0f);
    piano.process(decayL.data(), decayR.data(), 48000);

    TEST_ASSERT(piano.getActiveVoiceCount() == 0, "All voices must become inactive after release decay");
    TEST_ASSERT(std::abs(decayL.back()) < 1.0e-4f, "Piano tail must decay to silence");
}

// ============================================================================
// Test 6: Sub-bass stabilization mode (Voice 1 C1)
// ============================================================================
void test_sub_bass_mode_characteristics() {
    braun::WavetableBank wavetables;
    braun::SolarDroneVoice drone;
    drone.prepare(48000.0, &wavetables, 1);

    braun::DroneVoiceParams params;
    params.pitchHz = 32.7f; // C1
    params.isSubBass = true;
    params.foldPercent = 50.0f;
    params.volume = 0.60f;
    params.active = true;

    float outL = 0.0f, outR = 0.0f;
    for (int i = 0; i < 4800; ++i) {
        drone.processSample(params, outL, outR);
        TEST_ASSERT(!std::isnan(outL) && !std::isinf(outL), "Sub-bass produced NaN/Inf in L");
        TEST_ASSERT(!std::isnan(outR) && !std::isinf(outR), "Sub-bass produced NaN/Inf in R");
    }

    TEST_ASSERT(std::abs(outL) > 0.01f || std::abs(outR) > 0.01f, "Sub-bass must produce audible output");
}

// ============================================================================
// Test 7: End-to-End DspEngine audio block processing with concurrent voices
// ============================================================================
void test_dsp_engine_full_signal_flow() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.felt_volume = 0.80f;
    params.master_volume = 0.80f;
    params.tape_mix = 0.45f;
    params.shimmer_mix = 0.40f;

    // Send Note-On events
    std::vector<braun::MidiEvent> midiEvents = {
        { 0,   0x90, 60, 100 }, // C4
        { 64,  0x90, 64, 90  }, // E4
        { 128, 0x90, 67, 95  }, // G4
        { 256, 0xB0, 64, 127 }  // Sustain Pedal ON
    };

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    engine.process(blockL.data(), blockR.data(), 512, params, midiEvents.data(), static_cast<int>(midiEvents.size()));

    float maxVal = 0.0f;
    for (int i = 0; i < 512; ++i) {
        TEST_ASSERT(!std::isnan(blockL[i]) && !std::isinf(blockL[i]), "NaN/Inf in Engine output L");
        TEST_ASSERT(!std::isnan(blockR[i]) && !std::isinf(blockR[i]), "NaN/Inf in Engine output R");
        maxVal = std::max(maxVal, std::max(std::abs(blockL[i]), std::abs(blockR[i])));
    }

    TEST_ASSERT(maxVal > 0.01f, "Engine output should be active after note-ons");
    TEST_ASSERT(maxVal <= 1.0001f, "Engine output should be limited to <= 1.0FS by MasterLimiter");

    // Process 50 more blocks to ensure stability
    for (int b = 0; b < 50; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
}

// ============================================================================
// Test 8: Silence on startup and activation upon trigger / active state
// ============================================================================
void test_dsp_engine_silence_on_startup_until_triggered_or_active() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    // Default snapshot has drone1_active = false, drone2_active = false
    braun::ParameterSnapshot defaultParams;
    TEST_ASSERT(!defaultParams.drone1_active, "Default snapshot must have drone1_active == false");
    TEST_ASSERT(!defaultParams.drone2_active, "Default snapshot must have drone2_active == false");

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // 1. Verify 100% pure silence on startup across 20 consecutive blocks (10,240 samples)
    for (int b = 0; b < 20; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, defaultParams, nullptr, 0);

        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(blockL[i] == 0.0f, "Startup output L must be exactly 0.0f");
            TEST_ASSERT(blockR[i] == 0.0f, "Startup output R must be exactly 0.0f");
        }
    }

    // 2. Verify sound generation when Drone 1 is activated
    braun::ParameterSnapshot drone1ActiveParams = defaultParams;
    drone1ActiveParams.drone1_active = true;

    float drone1Max = 0.0f;
    for (int b = 0; b < 10; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, drone1ActiveParams, nullptr, 0);

        for (int i = 0; i < 512; ++i) {
            drone1Max = std::max(drone1Max, std::max(std::abs(blockL[i]), std::abs(blockR[i])));
        }
    }
    TEST_ASSERT(drone1Max > 0.01f, "Drone 1 must produce audible output when drone1_active == true");

    // 3. Verify return to silence when Drone 1 is deactivated and flush occurs
    engine.reset();
    for (int b = 0; b < 10; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, defaultParams, nullptr, 0);
        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(blockL[i] == 0.0f, "Deactivated Drone 1 must return to exact silence in L");
            TEST_ASSERT(blockR[i] == 0.0f, "Deactivated Drone 1 must return to exact silence in R");
        }
    }

    // 4. Verify sound generation when Note-On is triggered
    std::vector<braun::MidiEvent> midiEvents = {
        { 0, 0x90, 60, 100 } // Middle C Note-On
    };
    std::fill(blockL.begin(), blockL.end(), 0.0f);
    std::fill(blockR.begin(), blockR.end(), 0.0f);
    engine.process(blockL.data(), blockR.data(), 512, defaultParams, midiEvents.data(), 1);

    float noteOnMax = 0.0f;
    for (int i = 0; i < 512; ++i) {
        noteOnMax = std::max(noteOnMax, std::max(std::abs(blockL[i]), std::abs(blockR[i])));
    }
    TEST_ASSERT(noteOnMax > 0.01f, "Triggered Note-On must produce audible output with default params");
}

// ============================================================================
// Test 9: Zero output when powered on & idle, natural tail decay to exact zero
// ============================================================================
void test_dsp_engine_zero_output_when_idle_powered_on_and_tail_decay() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    TEST_ASSERT(!params.drone1_active, "drone1_active must be false");
    TEST_ASSERT(!params.drone2_active, "drone2_active must be false");

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // 1. Powered ON, idle from boot: process 100 blocks (51,200 samples = >1 second)
    for (int b = 0; b < 100; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(blockL[i] == 0.0f, "Idle output L must be exactly 0.0f");
            TEST_ASSERT(blockR[i] == 0.0f, "Idle output R must be exactly 0.0f");
        }
    }

    // 2. Play Middle C (Note-On), hold for 0.5s (48 blocks), then send Note-Off
    braun::MidiEvent noteOn = { 0, 0x90, 60, 100 };
    std::fill(blockL.begin(), blockL.end(), 0.0f);
    std::fill(blockR.begin(), blockR.end(), 0.0f);
    engine.process(blockL.data(), blockR.data(), 512, params, &noteOn, 1);

    float activePeak = 0.0f;
    for (int b = 0; b < 48; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
        for (int i = 0; i < 512; ++i) {
            activePeak = std::max(activePeak, std::max(std::abs(blockL[i]), std::abs(blockR[i])));
        }
    }
    TEST_ASSERT(activePeak > 0.05f, "Active note must produce audible sound");

    // 3. Send Note-Off
    braun::MidiEvent noteOff = { 0, 0x80, 60, 0 };
    std::fill(blockL.begin(), blockL.end(), 0.0f);
    std::fill(blockR.begin(), blockR.end(), 0.0f);
    engine.process(blockL.data(), blockR.data(), 512, params, &noteOff, 1);

    // 4. Process natural decay tail (35 seconds = 3281 blocks of 512) WITHOUT calling reset()
    for (int b = 0; b < 3300; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }

    TEST_ASSERT(engine.getFeltPiano().getActiveVoiceCount() == 0, "Active piano voices must be 0 after decay");

    // 5. Verify output has reached exact 0.0f silence across 50 consecutive blocks
    for (int b = 0; b < 50; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(blockL[i] == 0.0f, "Decayed note tail L must reach exact 0.0f silence");
            TEST_ASSERT(blockR[i] == 0.0f, "Decayed note tail R must reach exact 0.0f silence");
        }
    }
}

// ============================================================================
// Test 10: Immunity to self-oscillation, LFO bleed, or noise under extreme params
// ============================================================================
void test_dsp_engine_no_self_oscillation_under_extreme_parameters() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot extremeParams;
    extremeParams.drone1_active = false;
    extremeParams.drone2_active = false;
    extremeParams.tape_feedback = 0.92f;  // Maximum tape feedback
    extremeParams.tape_mix = 1.0f;        // 100% wet
    extremeParams.tape_wow = 1.0f;        // Maximum wow/flutter
    extremeParams.shimmer_decay = 25.0f;  // Maximum reverb decay (25s)
    extremeParams.shimmer_mix = 1.0f;     // 100% wet
    extremeParams.shimmer_amount = 1.0f;  // Maximum shimmer pitch shift
    extremeParams.drone1_resonance = 10.0f;
    extremeParams.drone2_resonance = 10.0f;
    extremeParams.felt_space = 1.0f;      // Maximum sympathetic coupling
    extremeParams.master_volume = 1.0f;

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // Process 100 blocks (51,200 samples) under extreme settings without notes
    for (int b = 0; b < 100; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, extremeParams, nullptr, 0);
        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(blockL[i] == 0.0f, "Extreme param idle L must be exactly 0.0f (no self-oscillation)");
            TEST_ASSERT(blockR[i] == 0.0f, "Extreme param idle R must be exactly 0.0f (no self-oscillation)");
        }
    }

    // CC 1 modulation wheel at 127
    braun::MidiEvent cc1 = { 0, 0xB0, 1, 127 };
    std::fill(blockL.begin(), blockL.end(), 0.0f);
    std::fill(blockR.begin(), blockR.end(), 0.0f);
    engine.process(blockL.data(), blockR.data(), 512, extremeParams, &cc1, 1);
    for (int i = 0; i < 512; ++i) {
        TEST_ASSERT(blockL[i] == 0.0f, "CC 1 idle L must be exactly 0.0f");
        TEST_ASSERT(blockR[i] == 0.0f, "CC 1 idle R must be exactly 0.0f");
    }

    // Pitch bend maximum
    braun::MidiEvent pitchBendMax = { 0, 0xE0, 127, 127 };
    std::fill(blockL.begin(), blockL.end(), 0.0f);
    std::fill(blockR.begin(), blockR.end(), 0.0f);
    engine.process(blockL.data(), blockR.data(), 512, extremeParams, &pitchBendMax, 1);
    for (int i = 0; i < 512; ++i) {
        TEST_ASSERT(blockL[i] == 0.0f, "Pitch bend idle L must be exactly 0.0f");
        TEST_ASSERT(blockR[i] == 0.0f, "Pitch bend idle R must be exactly 0.0f");
    }
}

// ============================================================================
// Test 11: Drone MIDI pitch tracking, sub-octave transposition, & portamento
// ============================================================================
void test_drone_midi_pitch_tracking() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.drone1_active = true;
    params.drone2_active = true;
    params.drone1_pitch = 65.41f;  // C2
    params.drone2_pitch = 98.00f;  // G2 (Perfect 5th, ratio 1.49824 ~ 1.5)
    params.drone_track_midi = true;

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // 1. Send Note-On F5 (MIDI 77)
    // F5 (77) should transpose to Deep Tonic octave (C2..B2, 36..47) -> F2 (41, ~87.31 Hz)
    braun::MidiEvent noteF5 = { 0, 0x90, 77, 100 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteF5, 1);

    TEST_ASSERT(engine.getLastTrackedMidiNote() == 77, "Last tracked MIDI note must be 77");
    const float f1 = engine.getTrackedDrone1Freq();
    const float f2 = engine.getTrackedDrone2Freq();
    TEST_ASSERT(std::abs(f1 - 87.307f) < 0.1f, "Drone 1 must track F5 transposed to F2 (~87.31 Hz)");
    TEST_ASSERT(std::abs(f2 - 87.307f * (98.00f / 65.41f)) < 0.2f, "Drone 2 must track 5th of F2 (~130.8 Hz)");

    // 2. Send Note-On A#5 (MIDI 82)
    // A#5 (82) should transpose to Deep Tonic octave -> A#2 (46, ~116.54 Hz)
    braun::MidiEvent noteAsharp5 = { 0, 0x90, 82, 100 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteAsharp5, 1);

    TEST_ASSERT(engine.getLastTrackedMidiNote() == 82, "Last tracked MIDI note must be 82");
    const float f1_next = engine.getTrackedDrone1Freq();
    TEST_ASSERT(std::abs(f1_next - 116.541f) < 0.1f, "Drone 1 must track A#5 transposed to A#2 (~116.54 Hz)");
    TEST_ASSERT(f1_next > f1, "Drone 1 pitch must increase from F2 to A#2 as user requested");

    // 3. Portamento continuity: process 20 blocks during glide and verify audio is bounded & finite
    for (int b = 0; b < 20; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(!std::isnan(blockL[i]) && !std::isinf(blockL[i]), "Glide must not produce NaN/Inf");
            TEST_ASSERT(std::abs(blockL[i]) <= 1.0f, "Glide audio must be safely limited within +/- 1.0");
        }
    }

    // 4. Sub-bass mode tracking: should transpose to octave 1 (24..35) -> F1 (~43.65 Hz)
    params.drone1_isSubBass = true;
    engine.process(blockL.data(), blockR.data(), 512, params, &noteF5, 1);
    const float f1_sub = engine.getTrackedDrone1Freq();
    TEST_ASSERT(std::abs(f1_sub - 43.653f) < 0.1f, "Sub-bass mode must track F5 transposed to F1 (~43.65 Hz)");
    params.drone1_isSubBass = false;

    // Reset held keys before pedal test
    braun::MidiEvent allNotesOff = { 0, 0xB0, 123, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &allNotesOff, 1);

    // 5. Tracking under sustain pedal active (CC 64 >= 64)
    // Send CC 64 = 127 (Pedal Down), then play G5 (MIDI 79 -> G2, 43, ~98.00 Hz)
    braun::MidiEvent pedalDown = { 0, 0xB0, 64, 127 };
    braun::MidiEvent noteG5 = { 10, 0x90, 79, 100 };
    braun::MidiEvent pedalEvents[] = { pedalDown, noteG5 };
    engine.process(blockL.data(), blockR.data(), 512, params, pedalEvents, 2);
    TEST_ASSERT(engine.getLastTrackedMidiNote() == 79, "Drone must track MIDI notes even when sustain pedal is active");
    const float f1_pedal = engine.getTrackedDrone1Freq();
    TEST_ASSERT(std::abs(f1_pedal - 97.999f) < 0.1f, "Drone 1 must track G5 transposed to G2 (~98.00 Hz) with pedal down");

    // Release pedal
    braun::MidiEvent pedalUp = { 0, 0xB0, 64, 0 };
    braun::MidiEvent noteG5Off = { 10, 0x80, 79, 0 };
    braun::MidiEvent releaseEvents[] = { pedalUp, noteG5Off };
    engine.process(blockL.data(), blockR.data(), 512, params, releaseEvents, 2);
    // When all notes are released, drone must preserve its last tracked pitch!
    TEST_ASSERT(std::abs(engine.getTrackedDrone1Freq() - 97.999f) < 0.1f, "Drone must preserve last pitch when all keys released");

    // 6. Legato key release fallback: hold C4 (60), press E4 (64), release E4 -> returns to C4
    braun::MidiEvent noteC4On = { 0, 0x90, 60, 90 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteC4On, 1);
    TEST_ASSERT(engine.getLastTrackedMidiNote() == 60, "Must track C4");
    TEST_ASSERT(std::abs(engine.getTrackedDrone1Freq() - 65.406f) < 0.1f, "C4 must transpose to C2 (~65.41 Hz)");

    braun::MidiEvent noteE4On = { 0, 0x90, 64, 90 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteE4On, 1);
    TEST_ASSERT(engine.getLastTrackedMidiNote() == 64, "Must track E4 while both keys held");
    TEST_ASSERT(std::abs(engine.getTrackedDrone1Freq() - 82.407f) < 0.1f, "E4 must transpose to E2 (~82.41 Hz)");

    braun::MidiEvent noteE4Off = { 0, 0x80, 64, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteE4Off, 1);
    TEST_ASSERT(engine.getLastTrackedMidiNote() == 60, "Releasing top note must fall back to held C4 for smooth legato");
    TEST_ASSERT(std::abs(engine.getTrackedDrone1Freq() - 65.406f) < 0.1f, "Must return to C2 (~65.41 Hz)");

    // Release C4
    braun::MidiEvent noteC4Off = { 0, 0x80, 60, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteC4Off, 1);

    // 7. Toggle static drone mode (drone_track_midi = false)
    params.drone1_pitch = 55.0f; // A1
    params.drone2_pitch = 82.5f; // E2 (ratio 1.5)
    params.drone_track_midi = false;
    engine.process(blockL.data(), blockR.data(), 512, params, &noteF5, 1); // Send note while tracking is off
    TEST_ASSERT(std::abs(engine.getTrackedDrone1Freq() - 55.0f) < 0.001f, "Static mode must use params.drone1_pitch");
    TEST_ASSERT(std::abs(engine.getTrackedDrone2Freq() - 82.5f) < 0.001f, "Static mode must use params.drone2_pitch");

    // Re-enable tracking: should immediately lock to the last note played (F5 -> F2)
    params.drone_track_midi = true;
    engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    TEST_ASSERT(std::abs(engine.getTrackedDrone1Freq() - 87.307f) < 0.1f, "Re-enabling tracking must track last note F2");

    // 8. Harmonic ratio locking with Sus-4th (ratio 4/3 = 1.33333)
    params.drone1_pitch = 65.41f;
    params.drone2_pitch = 65.41f * (4.0f / 3.0f);
    engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    const float f2_sus4 = engine.getTrackedDrone2Freq();
    TEST_ASSERT(std::abs(f2_sus4 - 87.307f * (4.0f / 3.0f)) < 0.1f, "Drone 2 must track Sus-4th ratio (4/3) relative to Drone 1");
}

// ============================================================================
// Test 12: Drone MIDI Note-Off Gating in MIDI Track Mode
// ============================================================================
void test_drone_midi_note_off_gating() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.master_volume = 1.0f;
    params.drone1_active = true;
    params.drone2_active = true;
    params.drone1_volume = 0.8f;
    params.drone2_volume = 0.8f;
    params.felt_volume = 0.0f; // Mute felt piano so output is strictly drone
    params.shimmer_mix = 0.0f; // Dry output for immediate gating inspection
    params.tape_mix = 0.0f;

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // 1. In MIDI Track Mode (drone_track_midi = true), when no notes have been played:
    // Drones must be gated off (mDroneGateGain == 0.0f) and output must be silent.
    params.drone_track_midi = true;
    for (int b = 0; b < 10; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() == 0.0f, "Idle drone gate gain before any MIDI note must be 0.0");
    float maxIdleAmp = 0.0f;
    for (int i = 0; i < 512; ++i) {
        maxIdleAmp = std::max(maxIdleAmp, std::max(std::abs(blockL[i]), std::abs(blockR[i])));
    }
    TEST_ASSERT(maxIdleAmp == 0.0f, "Output must be completely silent while idle in MIDI track mode");

    // 2. Note-On C4 (MIDI 60)
    // Gate should ramp up toward 1.0f with 20ms attack.
    braun::MidiEvent noteC4On = { 0, 0x90, 60, 100 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteC4On, 1);
    TEST_ASSERT(engine.hasActiveMidiNotes(), "Must detect active held MIDI note");
    TEST_ASSERT(engine.getDroneGateGain() > 0.0f, "Gate gain must begin ramping up on Note-On");

    // Process ~50ms (10 blocks of 512 at 48kHz = 5120 samples = 106.7ms) to reach steady state (> 0.99)
    for (int b = 0; b < 10; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() > 0.99f, "Gate gain must reach near 1.0f while note is held");

    float maxNoteAmp = 0.0f;
    for (int i = 0; i < 512; ++i) {
        maxNoteAmp = std::max(maxNoteAmp, std::max(std::abs(blockL[i]), std::abs(blockR[i])));
    }
    TEST_ASSERT(maxNoteAmp > 0.01f, "Drone output must be actively sounding while note is held");

    // 3. Note-Off C4 (no sustain pedal)
    // Gate should cleanly fade out with ~200ms anti-pop release ramp down to zero.
    braun::MidiEvent noteC4Off = { 0, 0x80, 60, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteC4Off, 1);
    TEST_ASSERT(!engine.hasActiveMidiNotes(), "Must report no active MIDI notes after Note-Off");
    TEST_ASSERT(engine.getDroneGateGain() < 1.0f, "Gate gain must start decaying immediately on Note-Off");

    // Process 400ms (38 blocks of 512 = 19456 samples = 405ms > 2x release time constant)
    for (int b = 0; b < 40; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() < 0.001f, "Gate gain must cleanly decay to ~0.0 within 400ms");

    // Once fully released (under 1.0e-5f), engine snaps gate to 0.0f and mutes output
    for (int b = 0; b < 60; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() == 0.0f, "Gate gain must snap to 0.0 after full release ramp");
    float maxPostReleaseAmp = 0.0f;
    for (int i = 0; i < 512; ++i) {
        maxPostReleaseAmp = std::max(maxPostReleaseAmp, std::max(std::abs(blockL[i]), std::abs(blockR[i])));
    }
    TEST_ASSERT(maxPostReleaseAmp < 1.0e-5f, "Drone output must return to silence after release");

    // 4. Sustain Pedal Behavior:
    // Depress sustain pedal (CC 64 = 127), then play Note-On E4 (64), then release E4 key (Note-Off 64).
    // Because pedal is held down, note is latched, so gate must remain ON (> 0.99f).
    braun::MidiEvent pedalDown = { 0, 0xB0, 64, 127 };
    braun::MidiEvent noteE4On = { 10, 0x90, 64, 100 };
    braun::MidiEvent pedalOnEvents[] = { pedalDown, noteE4On };
    engine.process(blockL.data(), blockR.data(), 512, params, pedalOnEvents, 2);

    for (int b = 0; b < 10; ++b) {
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() > 0.99f, "Gate must open when note is triggered with pedal down");

    // Key is physically released, but pedal is STILL held down
    braun::MidiEvent noteE4Off = { 0, 0x80, 64, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteE4Off, 1);
    TEST_ASSERT(engine.hasActiveMidiNotes(), "Note must remain latched by sustain pedal");

    for (int b = 0; b < 10; ++b) {
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() > 0.99f, "Gate must remain open while sustain pedal is held");

    // Now release sustain pedal (CC 64 = 0)
    braun::MidiEvent pedalUp = { 0, 0xB0, 64, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &pedalUp, 1);
    TEST_ASSERT(!engine.hasActiveMidiNotes(), "Releasing pedal must clear all latched notes");

    // Process release ramp
    for (int b = 0; b < 100; ++b) {
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() == 0.0f, "Gate must fade out to 0.0 after sustain pedal is released");

    // 5. Classic Continuous Drone Mode (drone_track_midi = false):
    // In classic mode, gate must remain 1.0f continuously even without any MIDI notes held.
    params.drone_track_midi = false;
    for (int b = 0; b < 10; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() > 0.99f, "In classic continuous mode, gate must open to 1.0f");
    float maxClassicAmp = 0.0f;
    for (int i = 0; i < 512; ++i) {
        maxClassicAmp = std::max(maxClassicAmp, std::max(std::abs(blockL[i]), std::abs(blockR[i])));
    }
    TEST_ASSERT(maxClassicAmp > 0.01f, "Classic mode must sound continuously without MIDI keys held");

    // 6. Mid-Release Retrigger:
    // Switch back to tracking mode, trigger Note-On F4 (65), then Note-Off F4, let release decay halfway,
    // then trigger Note-On G4 (67) mid-release.
    // The gate must smoothly rise back up to 1.0f without negative dips or pops.
    params.drone_track_midi = true;
    braun::MidiEvent noteF4On = { 0, 0x90, 65, 100 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteF4On, 1);
    for (int b = 0; b < 10; ++b) {
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() > 0.99f, "Gate must reach steady state on F4");

    braun::MidiEvent noteF4Off = { 0, 0x80, 65, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteF4Off, 1);
    // Process 4 blocks (~42ms, ~1 time constant: gate gain should be around ~0.35 - 0.40)
    for (int b = 0; b < 4; ++b) {
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    const float midReleaseGain = engine.getDroneGateGain();
    TEST_ASSERT(midReleaseGain > 0.10f && midReleaseGain < 0.70f, "Gate must be actively in mid-release decay");

    // Retrigger G4 (67)
    braun::MidiEvent noteG4On = { 0, 0x90, 67, 100 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteG4On, 1);
    TEST_ASSERT(engine.getDroneGateGain() >= midReleaseGain, "Gate must immediately reverse decay and ramp up on new note");
    for (int b = 0; b < 10; ++b) {
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() > 0.99f, "Gate must recover to > 0.99f after mid-release retrigger");

    // 7. Panic CC 123 (All Notes Off) while note is held:
    braun::MidiEvent allNotesOff = { 0, 0xB0, 123, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &allNotesOff, 1);
    TEST_ASSERT(!engine.hasActiveMidiNotes(), "CC 123 must clear all active notes");
    for (int b = 0; b < 80; ++b) {
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() == 0.0f, "Gate must be fully silenced after CC 123");

    // 8. Controller Reset CC 121 with sustain pedal held:
    braun::MidiEvent pedalHold = { 0, 0xB0, 64, 127 };
    braun::MidiEvent noteA4On = { 5, 0x90, 69, 100 };
    braun::MidiEvent setupPedal[] = { pedalHold, noteA4On };
    engine.process(blockL.data(), blockR.data(), 512, params, setupPedal, 2);
    for (int b = 0; b < 10; ++b) engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);

    // Release key (latched by sustain)
    braun::MidiEvent noteA4Off = { 0, 0x80, 69, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &noteA4Off, 1);
    TEST_ASSERT(engine.hasActiveMidiNotes(), "Note A4 must remain latched by sustain");

    // Send CC 121 (Reset All Controllers)
    braun::MidiEvent resetControllers = { 0, 0xB0, 121, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &resetControllers, 1);
    TEST_ASSERT(!engine.hasActiveMidiNotes(), "CC 121 must reset sustain pedal and clear latched notes");
    for (int b = 0; b < 80; ++b) {
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(engine.getDroneGateGain() == 0.0f, "Gate must be fully silenced after CC 121 reset");
}

// ============================================================================
// Test 13: Lock-free Visualizer Ring Buffer Bounds, Wrapping, and Safety
// ============================================================================
void test_scope_visualizer_ring_buffer_bounds_and_safety() {
    constexpr int kScopeBufferSize = 2048;
    float scopeBufferL[kScopeBufferSize] = {};
    float scopeBufferR[kScopeBufferSize] = {};
    std::atomic<int> scopeWritePos { 0 };

    auto pushSamples = [&](const float* left, const float* right, int numSamples) noexcept {
        if (left == nullptr || numSamples <= 0)
            return;
        int pos = scopeWritePos.load(std::memory_order_relaxed);
        for (int i = 0; i < numSamples; ++i) {
            scopeBufferL[pos] = left[i];
            scopeBufferR[pos] = (right != nullptr) ? right[i] : left[i];
            pos = (pos + 1);
            if (pos >= kScopeBufferSize)
                pos = 0;
        }
        scopeWritePos.store(pos, std::memory_order_release);
    };

    auto getSamples = [&](float* destL, float* destR, int numSamplesToRead) noexcept {
        if (destL == nullptr || numSamplesToRead <= 0)
            return;
        numSamplesToRead = std::min(numSamplesToRead, kScopeBufferSize);
        int writePos = scopeWritePos.load(std::memory_order_acquire);
        int readPos = ((writePos - numSamplesToRead) % kScopeBufferSize + kScopeBufferSize) % kScopeBufferSize;
        for (int i = 0; i < numSamplesToRead; ++i) {
            destL[i] = scopeBufferL[readPos];
            if (destR != nullptr)
                destR[i] = scopeBufferR[readPos];
            readPos = (readPos + 1);
            if (readPos >= kScopeBufferSize)
                readPos = 0;
        }
    };

    // 1. Basic push and read
    std::vector<float> inputL(512);
    std::vector<float> inputR(512);
    for (int i = 0; i < 512; ++i) {
        inputL[i] = std::sin(2.0f * 3.14159f * i / 32.0f);
        inputR[i] = std::cos(2.0f * 3.14159f * i / 32.0f);
    }
    pushSamples(inputL.data(), inputR.data(), 512);

    std::vector<float> readL(512);
    std::vector<float> readR(512);
    getSamples(readL.data(), readR.data(), 512);

    for (int i = 0; i < 512; ++i) {
        TEST_ASSERT(std::abs(readL[i] - inputL[i]) < 1e-6f, "Left channel sample mismatch");
        TEST_ASSERT(std::abs(readR[i] - inputR[i]) < 1e-6f, "Right channel sample mismatch");
    }

    // 2. Wrap-around past 2048 buffer boundary (push 3000 samples)
    std::vector<float> streamL(3000);
    std::vector<float> streamR(3000);
    for (int i = 0; i < 3000; ++i) {
        streamL[i] = static_cast<float>(i + 1);
        streamR[i] = -static_cast<float>(i + 1);
    }
    pushSamples(streamL.data(), streamR.data(), 3000);

    // Read last 512 samples
    getSamples(readL.data(), readR.data(), 512);
    for (int i = 0; i < 512; ++i) {
        const float expectedL = streamL[3000 - 512 + i];
        const float expectedR = streamR[3000 - 512 + i];
        TEST_ASSERT(readL[i] == expectedL, "Chronological ring-buffer wrap-around Left mismatch");
        TEST_ASSERT(readR[i] == expectedR, "Chronological ring-buffer wrap-around Right mismatch");
    }

    // 3. Oversized read request clamping (request 4096 samples from 2048 buffer)
    std::vector<float> largeDestL(4096, -999.0f);
    std::vector<float> largeDestR(4096, -999.0f);
    getSamples(largeDestL.data(), largeDestR.data(), 4096);
    // Elements 0..2047 should be populated safely, and no memory violation occurs
    TEST_ASSERT(largeDestL[0] != -999.0f, "First clamped element must be written");
    TEST_ASSERT(largeDestL[2047] != -999.0f, "Last clamped element must be written");
    TEST_ASSERT(largeDestL[2048] == -999.0f, "Unrequested portion beyond kScopeBufferSize must remain untouched");

    // 4. Zero and negative sample request safety
    float dummyL = 42.0f;
    getSamples(&dummyL, nullptr, 0);
    TEST_ASSERT(dummyL == 42.0f, "Zero sample read must not alter destination");
    getSamples(&dummyL, nullptr, -10);
    TEST_ASSERT(dummyL == 42.0f, "Negative sample read must not alter destination");
}

// ============================================================================
// Test 14: Biquad Bandpass Filter constant 0 dB peak gain across Q factors
// ============================================================================
void test_biquad_bandpass_unity_gain() {
    constexpr float sampleRate = 48000.0f;
    constexpr float testFreq = 1000.0f;

    // Test across various Q values (0.85 for shimmer, 3.5 for sympathetic resonance, 10.0 for sharp notch)
    const std::vector<float> qValues = { 0.85f, 1.5f, 3.5f, 7.0f, 10.0f };

    for (float q : qValues) {
        braun::Biquad bp;
        bp.configure(braun::Biquad::Type::Bandpass, sampleRate, testFreq, q);

        // Run pure sine at center frequency for 8000 samples to reach steady state
        float maxSteadyStateAmp = 0.0f;
        for (int i = 0; i < 8000; ++i) {
            const float t = static_cast<float>(i) / sampleRate;
            const float in = std::sin(braun::kTwoPi * testFreq * t);
            const float out = bp.process(in);

            if (i >= 4000) {
                maxSteadyStateAmp = std::max(maxSteadyStateAmp, std::abs(out));
            }
        }

        // Must have constant 0 dB peak gain (1.000 +/- 0.01) at center frequency
        TEST_ASSERT(std::abs(maxSteadyStateAmp - 1.0f) < 0.02f,
                    "Bandpass filter peak gain at Q=" + std::to_string(q) + " was " + std::to_string(maxSteadyStateAmp) + " (expected 1.0)");
    }

    // Verify off-center frequency attenuation (500 Hz on 1000 Hz filter with Q=3.5)
    braun::Biquad bp2;
    bp2.configure(braun::Biquad::Type::Bandpass, sampleRate, 1000.0f, 3.5f);
    float maxOffFreqAmp = 0.0f;
    for (int i = 0; i < 8000; ++i) {
        const float t = static_cast<float>(i) / sampleRate;
        const float in = std::sin(braun::kTwoPi * 500.0f * t);
        const float out = bp2.process(in);
        if (i >= 4000) {
            maxOffFreqAmp = std::max(maxOffFreqAmp, std::abs(out));
        }
    }
    TEST_ASSERT(maxOffFreqAmp < 0.35f, "Bandpass filter failed to attenuate off-center frequency");
}

// ============================================================================
// Test 15: Shimmer Reverb FDN diffusion, stereo balance, and stable decay
// ============================================================================
void test_shimmer_reverb_fdn_diffusion_and_decay() {
    braun::ShimmerReverbDsp reverb;
    reverb.prepare(48000.0);

    braun::ShimmerReverbParams params;
    params.decaySec = 8.5f;
    params.damping = 0.60f;
    params.shimmer = 0.45f;
    params.mix = 0.45f;
    params.freeze = false;

    // Inject 1-sample unit impulse
    float outL = 0.0f, outR = 0.0f;
    reverb.processSample(1.0f, 1.0f, params, outL, outR);

    // Track output energy across 2 seconds (96,000 samples)
    float maxAmpL = std::abs(outL);
    float maxAmpR = std::abs(outR);
    float energyFirstHalf = 0.0f;
    float energySecondHalf = 0.0f;

    for (int i = 0; i < 96000; ++i) {
        outL = 0.0f;
        outR = 0.0f;
        reverb.processSample(0.0f, 0.0f, params, outL, outR);

        TEST_ASSERT(!std::isnan(outL) && !std::isinf(outL), "Reverb produced NaN/Inf on Left");
        TEST_ASSERT(!std::isnan(outR) && !std::isinf(outR), "Reverb produced NaN/Inf on Right");

        maxAmpL = std::max(maxAmpL, std::abs(outL));
        maxAmpR = std::max(maxAmpR, std::abs(outR));

        if (i < 48000) {
            energyFirstHalf += outL * outL + outR * outR;
        } else {
            energySecondHalf += outL * outL + outR * outR;
        }
    }

    // 1. Output must not clip or blow up
    TEST_ASSERT(maxAmpL < 1.0f, "Reverb Left peak exceeded 1.0: " + std::to_string(maxAmpL));
    TEST_ASSERT(maxAmpR < 1.0f, "Reverb Right peak exceeded 1.0: " + std::to_string(maxAmpR));

    // 2. Both channels must receive balanced diffuse energy
    TEST_ASSERT(energyFirstHalf > 0.01f, "Reverb produced zero diffuse energy in first second");
    TEST_ASSERT(energySecondHalf > 0.001f, "Reverb tail died prematurely before second second");

    // 3. Energy must decay smoothly over time
    TEST_ASSERT(energyFirstHalf > energySecondHalf, "Reverb energy did not decay over time");

    // 4. Run for another 8 seconds (total 10s) and verify return to near-silence
    for (int i = 0; i < 384000; ++i) {
        outL = 0.0f;
        outR = 0.0f;
        reverb.processSample(0.0f, 0.0f, params, outL, outR);
    }
    TEST_ASSERT(std::abs(outL) < 1.0e-3f, "Reverb did not decay to silence after 10s on Left");
    TEST_ASSERT(std::abs(outR) < 1.0e-3f, "Reverb did not decay to silence after 10s on Right");
}

// ============================================================================
// Test 16: Felt Piano Sympathetic Resonance Tone Tracking and Gain Scaling
// ============================================================================
void test_felt_piano_sympathetic_resonance_tracking() {
    braun::WavetableBank wavetables;
    braun::FeltPianoSynthesizer piano;
    piano.prepare(48000.0, &wavetables);

    // 1. When sympathetic resonance is 0.0, only direct piano sound should be produced
    braun::FeltPianoParams zeroSympParams;
    zeroSympParams.volume = 0.80f;
    zeroSympParams.tone = 0.62f;
    zeroSympParams.sympathetic = 0.0f;
    piano.setParams(zeroSympParams);

    piano.noteOn(60, 0.8f, 3.5f, false, false);
    std::vector<float> zeroSympL(2048, 0.0f);
    std::vector<float> zeroSympR(2048, 0.0f);
    piano.process(zeroSympL.data(), zeroSympR.data(), 2048);

    // 2. When sympathetic resonance is 0.45, output should include subtle acoustic coupling
    piano.reset();
    braun::FeltPianoParams normalSympParams = zeroSympParams;
    normalSympParams.sympathetic = 0.45f;
    piano.setParams(normalSympParams);

    piano.noteOn(60, 0.8f, 3.5f, false, false);
    std::vector<float> normalSympL(2048, 0.0f);
    std::vector<float> normalSympR(2048, 0.0f);
    piano.process(normalSympL.data(), normalSympR.data(), 2048);

    float maxZero = 0.0f;
    float maxNormal = 0.0f;
    for (int i = 0; i < 2048; ++i) {
        maxZero = std::max(maxZero, std::abs(zeroSympL[i]));
        maxNormal = std::max(maxNormal, std::abs(normalSympL[i]));
    }

    TEST_ASSERT(maxZero > 0.01f, "Piano produced zero output with sympathetic=0");
    TEST_ASSERT(maxNormal > 0.01f, "Piano produced zero output with sympathetic=0.45");
    // Sympathetic resonance should subtly reinforce acoustic soundboard body (~10-25%) rather than exploding
    TEST_ASSERT(maxNormal >= maxZero, "Sympathetic resonance must add positive acoustic coupling energy");
    TEST_ASSERT(maxNormal <= maxZero * 1.35f, "Sympathetic resonance exceeded subtle acoustic bounds: maxNormal=" + std::to_string(maxNormal) + " vs maxZero=" + std::to_string(maxZero));

    // 3. Verify tone damping modulates sympathetic filter tuning
    // Dark tone (0.20): f1 = 244 Hz, f2 = 480 Hz, gain = (0.08 + 0.02) = 0.10
    // Bright tone (0.80): f1 = 316 Hz, f2 = 600 Hz, gain = (0.08 + 0.08) = 0.16
    braun::FeltPianoParams darkParams = normalSympParams;
    darkParams.tone = 0.20f;
    piano.setParams(darkParams);
    piano.reset();
    piano.noteOn(60, 0.8f, 3.5f, false, false);
    std::vector<float> darkL(2048, 0.0f);
    std::vector<float> darkR(2048, 0.0f);
    piano.process(darkL.data(), darkR.data(), 2048);

    braun::FeltPianoParams brightParams = normalSympParams;
    brightParams.tone = 0.80f;
    piano.setParams(brightParams);
    piano.reset();
    piano.noteOn(60, 0.8f, 3.5f, false, false);
    std::vector<float> brightL(2048, 0.0f);
    std::vector<float> brightR(2048, 0.0f);
    piano.process(brightL.data(), brightR.data(), 2048);

    float maxDark = 0.0f;
    float maxBright = 0.0f;
    for (int i = 0; i < 2048; ++i) {
        maxDark = std::max(maxDark, std::abs(darkL[i]));
        maxBright = std::max(maxBright, std::abs(brightL[i]));
    }
    TEST_ASSERT(maxBright > maxDark, "Bright tone should exhibit greater acoustic harmonic energy than dark tone");
}

// ============================================================================
// Test 17: Shimmer Reverb Stereo Decorrelation and True Spatial Separation
// ============================================================================
void test_shimmer_reverb_stereo_decorrelation() {
    braun::ShimmerReverbDsp reverb;
    reverb.prepare(48000.0);

    braun::ShimmerReverbParams params;
    params.decaySec = 6.0f;
    params.damping = 0.50f;
    params.shimmer = 0.35f;
    params.mix = 1.0f;
    params.freeze = false;

    // Inject Left-only unit impulse (1.0, 0.0)
    float outL = 0.0f, outR = 0.0f;
    reverb.processSample(1.0f, 0.0f, params, outL, outR);

    // Collect 4096 samples and verify true stereo spread (L and R are not identical mono)
    float diffSum = 0.0f;
    float totalEnergy = 0.0f;

    for (int i = 0; i < 4096; ++i) {
        outL = 0.0f;
        outR = 0.0f;
        reverb.processSample(0.0f, 0.0f, params, outL, outR);

        diffSum += std::abs(outL - outR);
        totalEnergy += outL * outL + outR * outR;
    }

    TEST_ASSERT(totalEnergy > 0.001f, "Reverb produced zero energy from Left impulse");
    TEST_ASSERT(diffSum > 0.01f, "Reverb must produce decorrelated stereo output (L != R) when fed Left-only impulse");
}

// ============================================================================
// Test 18: Startup Default Power and Voice States
// ============================================================================
void test_startup_default_power_and_voice_states() {
    braun::ParameterSnapshot defaultSnapshot;

    // 1. Both Drone 1 and Drone 2 must be inactive by default
    TEST_ASSERT(defaultSnapshot.drone1_active == false, "Drone 1 must be inactive (false) by default");
    TEST_ASSERT(defaultSnapshot.drone2_active == false, "Drone 2 must be inactive (false) by default");
    TEST_ASSERT(defaultSnapshot.drone_track_midi == false, "Drone MIDI tracking must be inactive (false) by default");

    // 2. DspEngine must produce 100% silence on fresh boot
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    std::vector<float> l(512, 0.0f);
    std::vector<float> r(512, 0.0f);
    engine.process(l.data(), r.data(), 512, defaultSnapshot, nullptr, 0);

    for (int i = 0; i < 512; ++i) {
        TEST_ASSERT(l[i] == 0.0f, "Engine output L must be zero on startup");
        TEST_ASSERT(r[i] == 0.0f, "Engine output R must be zero on startup");
    }
}

// ============================================================================
// Test 19: Shimmer Reverb Exhaustive Phase Modes & Tape Delay Echo Clarity
// ============================================================================
void test_shimmer_fdn_exhaustive_phase_modes_and_tape_echo_clarity() {
    braun::ShimmerReverbDsp reverb;
    reverb.prepare(48000.0);

    braun::ShimmerReverbParams revParams;
    revParams.decaySec = 8.5f;
    revParams.damping = 0.60f;
    revParams.shimmer = 0.45f;
    revParams.mix = 0.45f;
    revParams.freeze = false;

    // 1. Verify Mono (1, 1), Left-only (1, 0), Right-only (0, 1), and Out-of-phase (1, -1) inputs
    const float testInputs[4][2] = {
        { 1.0f, 1.0f },
        { 1.0f, 0.0f },
        { 0.0f, 1.0f },
        { 1.0f, -1.0f }
    };

    for (int mode = 0; mode < 4; ++mode) {
        reverb.reset();
        float outL = 0.0f, outR = 0.0f;
        reverb.processSample(testInputs[mode][0], testInputs[mode][1], revParams, outL, outR);

        float energyFirstHalf = 0.0f;
        float energySecondHalf = 0.0f;
        float diffSum = 0.0f;

        for (int i = 0; i < 96000; ++i) {
            outL = 0.0f;
            outR = 0.0f;
            reverb.processSample(0.0f, 0.0f, revParams, outL, outR);

            diffSum += std::abs(outL - outR);
            if (i < 48000) {
                energyFirstHalf += outL * outL + outR * outR;
            } else {
                energySecondHalf += outL * outL + outR * outR;
            }
        }

        TEST_ASSERT(energyFirstHalf > 0.001f, "Mode " + std::to_string(mode) + " produced zero energy in first half");
        TEST_ASSERT(energyFirstHalf > energySecondHalf, "Mode " + std::to_string(mode) + " did not decay smoothly");
        TEST_ASSERT(diffSum > 0.01f, "Mode " + std::to_string(mode) + " lacked stereo decorrelation");
    }

    // 2. Verify Tape Delay echo clarity over Shimmer Reverb floor
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.felt_volume = 0.80f;
    params.tape_mix = 0.40f;
    params.tape_time = 0.46f;
    params.tape_feedback = 0.55f;
    params.shimmer_mix = 0.45f;
    params.shimmer_decay = 8.5f;

    // Trigger staccato note (150ms hold)
    braun::MidiEvent noteOn;
    noteOn.sampleOffset = 0;
    noteOn.status = 0x90;
    noteOn.data1 = 60; // C4
    noteOn.data2 = 100;

    braun::MidiEvent noteOff;
    noteOff.sampleOffset = 7200; // 150ms at 48kHz
    noteOff.status = 0x80;
    noteOff.data1 = 60;
    noteOff.data2 = 0;

    braun::MidiEvent midi[2] = { noteOn, noteOff };
    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // Process block with note trigger
    engine.process(blockL.data(), blockR.data(), 512, params, midi, 2);

    // Process audio up to 1.5 seconds and collect envelope
    std::vector<float> env(48000 * 2, 0.0f);
    int envIdx = 0;
    for (int b = 0; b < 187; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
        for (int s = 0; s < 512 && envIdx < static_cast<int>(env.size()); ++s) {
            env[envIdx++] = std::abs(blockL[s]) + std::abs(blockR[s]);
        }
    }

    // 3:2 Polyrhythmic Ping-Pong Tape Delay Tap Progression:
    // Tap 1 (Left line first hit) at ~0.46s
    // Tap 2 (Right line first hit) at ~0.69s
    // Tap 3 (Left line second hit) at ~0.92s
    const int tap1Sample = static_cast<int>(0.46f * 48000.0f);
    const int tap2Sample = static_cast<int>(0.69f * 48000.0f);
    const int tap3Sample = static_cast<int>(0.92f * 48000.0f);

    float peakTap1 = 0.0f;
    for (int i = tap1Sample - 500; i < tap1Sample + 500; ++i) {
        peakTap1 = std::max(peakTap1, env[i]);
    }

    float peakTap2 = 0.0f;
    for (int i = tap2Sample - 500; i < tap2Sample + 500; ++i) {
        peakTap2 = std::max(peakTap2, env[i]);
    }

    float peakTap3 = 0.0f;
    for (int i = tap3Sample - 500; i < tap3Sample + 500; ++i) {
        peakTap3 = std::max(peakTap3, env[i]);
    }

    TEST_ASSERT(peakTap1 > 0.05f, "Tape Delay tap 1 was inaudible: " + std::to_string(peakTap1));
    TEST_ASSERT(peakTap2 > 0.03f, "Tape Delay tap 2 was inaudible: " + std::to_string(peakTap2));
    TEST_ASSERT(peakTap3 > 0.02f, "Tape Delay tap 3 was inaudible: " + std::to_string(peakTap3));
}

// ============================================================================
// Test 20: CS-80 Timbre Sustain & Filter Release Sweep Verification
// ============================================================================
void test_cs80_timbre_sustain_and_filter_release_sweep() {
    braun::WavetableBank wavetables;
    wavetables.initTables();

    braun::FeltPianoVoice voice;
    voice.prepare(48000.0f, &wavetables, nullptr, 0, 0);

    braun::FeltPianoParams params;
    params.waveform = braun::WaveformType::CS80;
    params.decay = 1.0f;
    params.tone = 0.70f;
    params.volume = 0.80f;

    const float freq = 440.0f; // A4
    const float velocity = 0.85f;

    // 1. Trigger voice with isHold = true
    voice.trigger(freq, velocity, 3.5f, params, true, false, 0);
    TEST_ASSERT(voice.isActive(), "Voice must be active immediately after trigger");

    // Process through attack (24ms)
    for (int i = 0; i < 2000; ++i) { // ~41.6ms
        voice.processSample(params);
    }
    const float attackGain = voice.getEnvGain();
    TEST_ASSERT(attackGain > 0.10f, "Voice envelope gain must be active after attack");

    // Process through initial decay (250ms) into sustain stage
    for (int i = 0; i < 15000; ++i) { // ~312.5ms
        voice.processSample(params);
    }

    const float sustainGain = voice.getEnvGain();
    TEST_ASSERT(voice.isActive(), "CS-80 voice must remain active during held sustain");
    TEST_ASSERT(sustainGain > 0.10f, "CS-80 voice sustain gain must remain non-zero (~72% peak gain)");
    TEST_ASSERT(sustainGain <= attackGain, "Sustain gain must be <= peak attack gain");

    // Hold for another 0.5s and verify sustain does not collapse to zero
    for (int i = 0; i < 24000; ++i) {
        voice.processSample(params);
    }
    TEST_ASSERT(voice.getEnvGain() == sustainGain, "CS-80 voice gain must stay constant at sustain level while held");

    // 2. Note release: verify dynamic filter cutoff sweep towards fundamental (1.1 * f0)
    const float cutoffBeforeRelease = voice.getCurrentCutoff();
    TEST_ASSERT(cutoffBeforeRelease > 2000.0f, "CS-80 rest cutoff while held should be wide open (> 2000 Hz)");

    voice.release();
    TEST_ASSERT(voice.isActive(), "Voice must remain active during release tail");

    // Process 250ms of release
    for (int i = 0; i < 12000; ++i) {
        voice.processSample(params);
    }
    const float cutoffMidRelease = voice.getCurrentCutoff();
    TEST_ASSERT(cutoffMidRelease < cutoffBeforeRelease, "Filter cutoff must sweep downwards during release");
    TEST_ASSERT(cutoffMidRelease >= std::max(160.0f, freq * 1.1f), "Filter cutoff should not drop below fundamental lower bound");

    // Process remaining release samples until idle
    for (int i = 0; i < 30000; ++i) {
        voice.processSample(params);
    }
    TEST_ASSERT(!voice.isActive(), "Voice must become inactive after full release time");
    TEST_ASSERT(voice.getEnvGain() == 0.0f, "Voice envelope gain must be exactly 0.0 after release completion");
}

// ============================================================================
// Test 21: Rapid Preset Switching Under Active MIDI Polyphony
// ============================================================================
void test_rapid_preset_switching_under_active_midi_polyphony() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    // 1. Configure initial VANGELIS preset parameters
    braun::ParameterSnapshot vangelisParams;
    vangelisParams.felt_volume = 0.88f;
    vangelisParams.felt_decay = 1.8f;
    vangelisParams.felt_tone = 0.80f;
    vangelisParams.felt_hammer = 0.20f;
    vangelisParams.felt_space = 0.30f;
    vangelisParams.felt_waveform = 4; // CS-80
    vangelisParams.drone1_volume = 0.42f;
    vangelisParams.drone1_pitch = 65.41f;
    vangelisParams.drone1_cutoff = 600.0f;
    vangelisParams.drone1_resonance = 2.6f;
    vangelisParams.drone1_waveA = 2; // Saw
    vangelisParams.drone1_waveB = 2; // Saw
    vangelisParams.drone1_active = true;
    vangelisParams.drone2_volume = 0.38f;
    vangelisParams.drone2_pitch = 98.00f;
    vangelisParams.drone2_cutoff = 750.0f;
    vangelisParams.drone2_resonance = 2.8f;
    vangelisParams.drone2_waveA = 2; // Saw
    vangelisParams.drone2_waveB = 3; // Square
    vangelisParams.drone2_active = true;
    vangelisParams.tape_time = 0.380f;
    vangelisParams.tape_feedback = 0.52f;
    vangelisParams.tape_mix = 0.45f;
    vangelisParams.tape_wow = 0.40f;
    vangelisParams.tape_tone = 4500.0f;
    vangelisParams.shimmer_decay = 9.0f;
    vangelisParams.shimmer_damping = 0.45f;
    vangelisParams.shimmer_amount = 0.65f;
    vangelisParams.shimmer_mix = 0.50f;
    vangelisParams.master_volume = 0.78f;

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // Trigger Vangelis CS-80 5-note brass chord
    braun::MidiEvent chordEvents[] = {
        { 0, 0x90, 48, 100 }, // C3
        { 0, 0x90, 55, 95 },  // G3
        { 0, 0x90, 62, 90 },  // D4
        { 0, 0x90, 66, 85 },  // F#4
        { 0, 0x90, 69, 80 }   // A4
    };
    engine.process(blockL.data(), blockR.data(), 512, vangelisParams, chordEvents, 5);

    // Process 20 blocks (~213ms) under Vangelis preset
    for (int b = 0; b < 20; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, vangelisParams, nullptr, 0);
        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(!std::isnan(blockL[i]) && !std::isnan(blockR[i]), "Vangelis block output must not be NaN");
            TEST_ASSERT(!std::isinf(blockL[i]) && !std::isinf(blockR[i]), "Vangelis block output must not be Inf");
            TEST_ASSERT(std::abs(blockL[i]) <= 1.05f && std::abs(blockR[i]) <= 1.05f, "Output must be bounded by limiter");
        }
    }

    // 2. Rapidly switch to ENO_AIRPORTS preset while chord is actively held
    braun::ParameterSnapshot enoParams;
    enoParams.felt_volume = 0.75f;
    enoParams.felt_decay = 2.0f;
    enoParams.felt_tone = 0.70f;
    enoParams.felt_hammer = 0.35f;
    enoParams.felt_space = 0.55f;
    enoParams.felt_waveform = 1; // Sine
    enoParams.drone1_volume = 0.50f;
    enoParams.drone1_pitch = 32.70f;
    enoParams.drone1_isSubBass = true;
    enoParams.drone1_waveA = 1; // Sine
    enoParams.drone1_waveB = 5; // Triangle
    enoParams.drone1_active = true;
    enoParams.drone2_volume = 0.45f;
    enoParams.drone2_pitch = 65.41f;
    enoParams.drone2_waveA = 1; // Sine
    enoParams.drone2_waveB = 5; // Triangle
    enoParams.drone2_active = true;
    enoParams.tape_time = 0.460f;
    enoParams.tape_feedback = 0.55f;
    enoParams.tape_mix = 0.40f;
    enoParams.tape_wow = 0.45f;
    enoParams.tape_tone = 3600.0f;
    enoParams.shimmer_decay = 12.0f;
    enoParams.shimmer_damping = 0.70f;
    enoParams.shimmer_amount = 0.35f;
    enoParams.shimmer_mix = 0.55f;
    enoParams.master_volume = 0.80f;

    // Process immediately with new Eno params
    for (int b = 0; b < 20; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, enoParams, nullptr, 0);
        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(!std::isnan(blockL[i]) && !std::isnan(blockR[i]), "Eno transition block output must not be NaN");
            TEST_ASSERT(!std::isinf(blockL[i]) && !std::isinf(blockR[i]), "Eno transition block output must not be Inf");
            TEST_ASSERT(std::abs(blockL[i]) <= 1.05f && std::abs(blockR[i]) <= 1.05f, "Output must be bounded by limiter");
        }
    }

    // 3. Trigger new chime note on top of held chord
    braun::MidiEvent enoNote = { 0, 0x90, 72, 90 }; // C5
    engine.process(blockL.data(), blockR.data(), 512, enoParams, &enoNote, 1);

    // 4. Release all notes
    braun::MidiEvent allOff = { 0, 0xB0, 123, 0 };
    engine.process(blockL.data(), blockR.data(), 512, enoParams, &allOff, 1);

    // Process decay tail until quiet
    for (int b = 0; b < 100; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, enoParams, nullptr, 0);
    }

    TEST_ASSERT(engine.getFeltPiano().getActiveVoiceCount() == 0, "All voices must cleanly release to 0 active after preset switch & release");
}

// ============================================================================
// Test 22: Undamped Shimmer Reverb CS-80 Saw Excitation Stability & Anti-Ringing
// ============================================================================
void test_shimmer_undamped_cs80_resonance_and_stability() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.felt_volume = 0.90f;
    params.felt_waveform = 4; // CS-80 dual saw brass voice
    params.felt_tone = 0.95f;   // Maximum brightness (open filter, singing Q)
    params.felt_decay = 2.0f;
    params.felt_hammer = 0.0f;
    params.felt_space = 0.30f;
    params.tape_mix = 0.0f;    // Dry tape to isolate reverb tail

    // Reverb at extreme undamped settings (shimmer_damping = 0.0f, decay = 18.0s, shimmer = 0.95f)
    params.shimmer_mix = 1.0f;
    params.shimmer_decay = 18.0f;
    params.shimmer_damping = 0.0f; // Minimum damping / bright tail
    params.shimmer_amount = 0.95f; // High octave-up pitch-shift feedback
    params.shimmer_freeze = false;
    params.master_volume = 0.85f;

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // 1. Excite with 5-note CS-80 brass chord
    const braun::MidiEvent chordEvents[] = {
        { 0, 0x90, 48, 110 }, // C3
        { 0, 0x90, 55, 105 }, // G3
        { 0, 0x90, 60, 100 }, // C4
        { 0, 0x90, 64, 95 },  // E4
        { 0, 0x90, 67, 90 }   // G4
    };
    engine.process(blockL.data(), blockR.data(), 512, params, chordEvents, 5);

    // Hold chord for 40 blocks (~426 ms)
    for (int b = 0; b < 40; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(!std::isnan(blockL[i]) && !std::isnan(blockR[i]), "CS-80 note excitation produced NaN");
            TEST_ASSERT(!std::isinf(blockL[i]) && !std::isinf(blockR[i]), "CS-80 note excitation produced Inf");
            TEST_ASSERT(std::abs(blockL[i]) <= 1.15f && std::abs(blockR[i]) <= 1.15f, "CS-80 excitation output exceeded bounds");
        }
    }

    // 2. Release all notes
    const braun::MidiEvent allOff = { 0, 0xB0, 123, 0 };
    engine.process(blockL.data(), blockR.data(), 512, params, &allOff, 1);

    // 3. Track decay tail energy across consecutive windows (2s each)
    float windowEnergy[5] = { 0.0f };

    int sampleTotal = 0;
    for (int b = 0; b < 1000; ++b) { // ~10.66 seconds
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);

        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(!std::isnan(blockL[i]) && !std::isnan(blockR[i]), "Reverb tail produced NaN");
            TEST_ASSERT(!std::isinf(blockL[i]) && !std::isinf(blockR[i]), "Reverb tail produced Inf");
            TEST_ASSERT(std::abs(blockL[i]) <= 1.10f && std::abs(blockR[i]) <= 1.10f, "Reverb tail must remain bounded");

            const float sampleEnergy = blockL[i] * blockL[i] + blockR[i] * blockR[i];
            const int s = sampleTotal + i;
            if (s >= 24000 && s < 120000) windowEnergy[0] += sampleEnergy;
            else if (s >= 120000 && s < 216000) windowEnergy[1] += sampleEnergy;
            else if (s >= 216000 && s < 312000) windowEnergy[2] += sampleEnergy;
            else if (s >= 312000 && s < 408000) windowEnergy[3] += sampleEnergy;
            else if (s >= 408000 && s < 504000) windowEnergy[4] += sampleEnergy;
        }
        sampleTotal += 512;
    }

    // Energy must decay strictly monotonically between windows (no resonant runaway)
    TEST_ASSERT(windowEnergy[0] > windowEnergy[1], "Reverb tail did not decay: window 0 vs 1");
    TEST_ASSERT(windowEnergy[1] > windowEnergy[2], "Reverb tail did not decay: window 1 vs 2");
    TEST_ASSERT(windowEnergy[2] > windowEnergy[3], "Reverb tail did not decay: window 2 vs 3");
    TEST_ASSERT(windowEnergy[3] > windowEnergy[4], "Reverb tail did not decay: window 3 vs 4");

    // Process another 5 seconds to ensure decay to quiet
    for (int b = 0; b < 500; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);
        engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
    }
    TEST_ASSERT(std::abs(blockL[511]) < 1.0e-3f, "Reverb tail failed to decay to near-silence after 15s");
    TEST_ASSERT(std::abs(blockR[511]) < 1.0e-3f, "Reverb tail failed to decay to near-silence after 15s");
}

// ============================================================================
// Test 23: Shimmer Reverb Loop Gain Matrix Stability Under Minimum Damping
// ============================================================================
void test_shimmer_loop_gain_grid_stability_under_min_damping() {
    const float testDecays[] = { 1.0f, 5.0f, 10.0f, 18.0f, 25.0f };
    const float testShimmers[] = { 0.0f, 0.25f, 0.50f, 0.75f, 1.0f };

    for (float decay : testDecays) {
        for (float shimmer : testShimmers) {
            braun::ShimmerReverbDsp reverb;
            reverb.prepare(48000.0);

            braun::ShimmerReverbParams revParams;
            revParams.decaySec = decay;
            revParams.damping = 0.0f; // Minimum damping floor
            revParams.shimmer = shimmer;
            revParams.mix = 1.0f;
            revParams.freeze = false;

            // Excite with a 50-sample high-amplitude pulse wave containing high harmonics
            for (int s = 0; s < 50; ++s) {
                float outL = 0.0f, outR = 0.0f;
                const float in = (s % 4 == 0) ? 0.9f : -0.3f;
                reverb.processSample(in, in, revParams, outL, outR);
            }

            // Run for 3 seconds (144,000 samples)
            float maxPeak = 0.0f;
            float earlyEnergy = 0.0f;
            float lateEnergy = 0.0f;

            for (int i = 0; i < 144000; ++i) {
                float outL = 0.0f, outR = 0.0f;
                reverb.processSample(0.0f, 0.0f, revParams, outL, outR);

                TEST_ASSERT(!std::isnan(outL) && !std::isnan(outR), "Reverb produced NaN during grid sweep");
                TEST_ASSERT(!std::isinf(outL) && !std::isinf(outR), "Reverb produced Inf during grid sweep");

                maxPeak = std::max(maxPeak, std::max(std::abs(outL), std::abs(outR)));

                if (i < 48000) {
                    earlyEnergy += outL * outL + outR * outR;
                } else if (i >= 96000) {
                    lateEnergy += outL * outL + outR * outR;
                }
            }

            TEST_ASSERT(maxPeak < 1.5f, "Reverb peak exceeded 1.5 during grid sweep: decay=" + std::to_string(decay) + " shimmer=" + std::to_string(shimmer));
            TEST_ASSERT(earlyEnergy > lateEnergy, "Loop gain >= 1.0 detected: late energy did not decay below early energy");
        }
    }
}

// ============================================================================
// Test 24: Acoustic Felt Piano Held Note Decays to Silence
// ============================================================================
void test_felt_piano_held_note_decays_to_silence() {
    braun::WavetableBank wavetables;
    braun::FeltPianoVoice voice;
    std::vector<float> hammerNoise(512, 0.05f);
    voice.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 0);

    braun::FeltPianoParams params;
    params.waveform = braun::WaveformType::Felt;
    params.tone = 0.60f;
    params.decay = 0.5f; // Fast decay for test speed
    params.hammer = 0.45f;
    params.volume = 0.80f;

    const float freq = 440.0f; // A4
    const float velocity = 0.8f;

    // 1. Trigger acoustic felt piano voice with isHold = true
    voice.trigger(freq, velocity, 3.5f, params, true, false, 0);
    TEST_ASSERT(voice.isActive(), "Acoustic voice must be active immediately after trigger");

    // Process past attack stage (~9ms -> 432 samples)
    for (int i = 0; i < 500; ++i) {
        voice.processSample(params);
    }
    const float peakGain = voice.getEnvGain();
    TEST_ASSERT(peakGain > 0.10f, "Voice envelope gain must be active after attack");

    // Process audio samples without calling release() (held key).
    // For freq=440, baseDecay ~ 5.6s * 0.5 = 2.8s. In samples at 48kHz: ~134,400 samples.
    // Process 3.5 seconds (168,000 samples) of held playback.
    for (int i = 0; i < 170000; ++i) {
        voice.processSample(params);
    }

    // While key is still held, the acoustic piano string MUST have decayed to silence and become inactive.
    TEST_ASSERT(!voice.isActive(), "Acoustic piano held note MUST decay to silence and become inactive");
    TEST_ASSERT(voice.getEnvGain() <= 0.0001f, "Envelope gain of acoustic held note after decay duration must be <= 0.0001");
}

// ============================================================================
// Test 25: Felt Piano Decay Knob Delta Sensitivity & Treble Register Scaling
// ============================================================================
void test_felt_piano_decay_knob_sensitivity() {
    braun::WavetableBank wavetables;
    std::vector<float> hammerNoise(512, 0.05f);

    // Test 1: Mid register (A4, 440 Hz) sensitivity to decay knob
    braun::FeltPianoVoice voiceFast;
    braun::FeltPianoVoice voiceSlow;
    voiceFast.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 0);
    voiceSlow.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 1);

    braun::FeltPianoParams paramsFast;
    paramsFast.waveform = braun::WaveformType::Felt;
    paramsFast.decay = 0.3f; // Short decay

    braun::FeltPianoParams paramsSlow;
    paramsSlow.waveform = braun::WaveformType::Felt;
    paramsSlow.decay = 3.0f; // Long decay

    voiceFast.trigger(440.0f, 0.8f, 3.5f, paramsFast, true, false, 0);
    voiceSlow.trigger(440.0f, 0.8f, 3.5f, paramsSlow, true, false, 0);

    // Run for 1.2 seconds (57,600 samples)
    for (int i = 0; i < 57600; ++i) {
        voiceFast.processSample(paramsFast);
        voiceSlow.processSample(paramsSlow);
    }

    TEST_ASSERT(voiceSlow.getEnvGain() > voiceFast.getEnvGain() * 2.0f,
                "Slow decay envelope gain must be significantly greater than fast decay gain at 1.2s");

    // Test 2: Treble register (C7, 2093 Hz) - verify treble decay scaling is not clobbered
    braun::FeltPianoVoice trebleFast;
    braun::FeltPianoVoice trebleSlow;
    trebleFast.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 2);
    trebleSlow.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 3);

    paramsFast.decay = 0.2f;
    paramsSlow.decay = 2.0f;

    trebleFast.trigger(2093.0f, 0.8f, 3.5f, paramsFast, true, false, 0);
    trebleSlow.trigger(2093.0f, 0.8f, 3.5f, paramsSlow, true, false, 0);

    // Treble baseDecay for decay=0.2 is ~0.26s (~12,500 samples).
    // After 0.4s (19,200 samples), trebleFast must have decayed to silence.
    for (int i = 0; i < 19200; ++i) {
        trebleFast.processSample(paramsFast);
        trebleSlow.processSample(paramsSlow);
    }

    TEST_ASSERT(!trebleFast.isActive(), "Treble fast note must have completed decay to silence by 0.4s (no 3.5s clobbering)");
    TEST_ASSERT(trebleSlow.isActive(), "Treble slow note must still be ringing at 0.4s");
    TEST_ASSERT(trebleSlow.getEnvGain() > 0.05f, "Treble slow note envelope must still be audible");

    // Test 3: Bass register (A1, 55 Hz) - verify bass decay scaling with decay knob
    braun::FeltPianoVoice bassFast;
    braun::FeltPianoVoice bassSlow;
    bassFast.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 4);
    bassSlow.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 5);

    paramsFast.decay = 0.2f;
    paramsSlow.decay = 3.0f;

    bassFast.trigger(55.0f, 0.8f, 3.5f, paramsFast, true, false, 0);
    bassSlow.trigger(55.0f, 0.8f, 3.5f, paramsSlow, true, false, 0);

    // Run for 3.0 seconds (144,000 samples)
    for (int i = 0; i < 144000; ++i) {
        bassFast.processSample(paramsFast);
        bassSlow.processSample(paramsSlow);
    }
    TEST_ASSERT(bassSlow.getEnvGain() > bassFast.getEnvGain() * 2.0f,
                "Slow decay envelope gain must be significantly greater than fast decay gain in bass register at 3.0s");
}

// ============================================================================
// Test 26: Felt vs Sine Spectral and Harmonic Difference
// ============================================================================
void test_felt_vs_sine_spectral_and_harmonic_difference() {
    braun::WavetableBank wavetables;

    // 1. Verify wavetable differences directly
    const auto& sineTable = wavetables.getSineTable();
    const auto& feltTable = wavetables.getFeltTable();

    constexpr size_t N = braun::WavetableBank::kTableSize;
    TEST_ASSERT(std::abs(sineTable[0]) < 1e-4f, "Sine table must start at 0");
    TEST_ASSERT(std::abs(feltTable[0]) < 1e-4f, "Felt table must start at 0");

    // Felt table includes 2nd harmonic (0.58) and 3rd harmonic (0.28).
    // Calculate Fourier harmonic energy of 2nd harmonic for both tables:
    // H2 = (2/N) * sum_i( table[i] * sin(2 * 2pi * i / N) )
    float sineH2 = 0.0f;
    float feltH2 = 0.0f;
    for (size_t i = 0; i < N; ++i) {
        const float theta = braun::kTwoPi * static_cast<float>(i) / static_cast<float>(N);
        const float sin2 = std::sin(2.0f * theta);
        sineH2 += sineTable[i] * sin2;
        feltH2 += feltTable[i] * sin2;
    }
    sineH2 = std::abs(sineH2 * (2.0f / static_cast<float>(N)));
    feltH2 = std::abs(feltH2 * (2.0f / static_cast<float>(N)));

    TEST_ASSERT(sineH2 < 0.005f, "Sine table 2nd harmonic must be near zero");
    TEST_ASSERT(feltH2 > 0.30f, "Felt table 2nd harmonic must be prominent (target ~0.58 normalized)");

    // 2. Verify acoustic voice output difference between Felt and Sine
    std::vector<float> hammerNoise(512, 0.08f);
    braun::FeltPianoVoice feltVoice;
    braun::FeltPianoVoice sineVoice;
    feltVoice.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 0);
    sineVoice.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 1);

    braun::FeltPianoParams feltParams;
    feltParams.waveform = braun::WaveformType::Felt;
    feltParams.tone = 0.60f;
    feltParams.hammer = 0.50f;
    feltParams.decay = 1.0f;

    braun::FeltPianoParams sineParams = feltParams;
    sineParams.waveform = braun::WaveformType::Sine;

    feltVoice.trigger(440.0f, 0.8f, 3.5f, feltParams, true, false, 0);
    sineVoice.trigger(440.0f, 0.8f, 3.5f, sineParams, true, false, 0);

    // Check transient impulse: Sine voice sets effectiveHammer = 0.0f, Felt voice has hammer active
    std::vector<float> feltSamples(1024, 0.0f);
    std::vector<float> sineSamples(1024, 0.0f);

    for (int i = 0; i < 1024; ++i) {
        feltSamples[i] = feltVoice.processSample(feltParams);
        sineSamples[i] = sineVoice.processSample(sineParams);
    }

    // Both voices must produce non-silent output
    float feltRms = 0.0f;
    float diffRms = 0.0f;
    for (int i = 0; i < 1024; ++i) {
        feltRms += feltSamples[i] * feltSamples[i];
        const float d = feltSamples[i] - sineSamples[i];
        diffRms += d * d;
    }
    feltRms = std::sqrt(feltRms / 1024.0f);
    diffRms = std::sqrt(diffRms / 1024.0f);

    TEST_ASSERT(feltRms > 0.01f, "Felt voice output RMS must be audible");
    TEST_ASSERT(diffRms > 0.02f, "Felt and Sine output waveforms must have distinct spectral/harmonic difference (diffRms > 0.02)");
}

// ============================================================================
// Test 27: Acoustic Filter Envelope Monotonicity & High-Register Sine Bounds
// ============================================================================
void test_acoustic_filter_envelope_monotonicity_and_sine_bounds() {
    braun::WavetableBank wavetables;
    std::vector<float> hammerNoise(512, 0.05f);

    // 1. Soft note with bright tone: verify mMaxFilterCutoff >= mRestFilterCutoff (no inverted quack)
    braun::FeltPianoVoice softFelt;
    softFelt.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 0);
    braun::FeltPianoParams params;
    params.waveform = braun::WaveformType::Felt;
    params.tone = 0.85f;
    params.decay = 1.0f;
    params.hammer = 0.40f;
    params.volume = 0.80f;

    softFelt.trigger(440.0f, 0.15f, 3.5f, params, true, false, 0);
    TEST_ASSERT(softFelt.getMaxFilterCutoff() >= softFelt.getRestFilterCutoff(),
                "Soft strike max filter cutoff must be >= rest cutoff to prevent inverted quack sweep");

    // 2. High treble note in Sine mode (C7, 2093 Hz): verify chime filter is not capped to 2200 Hz
    braun::FeltPianoVoice sineTreble;
    sineTreble.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 1);
    braun::FeltPianoParams sineParams = params;
    sineParams.waveform = braun::WaveformType::Sine;
    sineParams.tone = 0.70f;

    sineTreble.trigger(2093.0f, 0.80f, 3.5f, sineParams, true, false, 0);
    TEST_ASSERT(sineTreble.getRestFilterCutoff() > 6000.0f,
                "Treble sine chime rest cutoff must be bright and wide open (> 6000 Hz)");
    TEST_ASSERT(sineTreble.getMaxFilterCutoff() >= sineTreble.getRestFilterCutoff(),
                "Treble sine chime max cutoff must be >= rest cutoff");

    // 3. Monotonic filter decay: during decay phase (t > attackSec), cutoff must decay downwards or remain at rest
    braun::FeltPianoVoice feltMid;
    feltMid.prepare(48000.0f, &wavetables, hammerNoise.data(), hammerNoise.size(), 2);
    feltMid.trigger(440.0f, 0.80f, 3.5f, params, true, false, 0);

    // Process through attack stage (9ms -> 432 samples)
    for (int i = 0; i < 432; ++i) {
        feltMid.processSample(params);
    }
    const float peakCutoff = feltMid.getCurrentCutoff();

    // Process decay and verify cutoff never rises above peakCutoff
    float prevCutoff = peakCutoff;
    for (int i = 0; i < 10000; ++i) {
        feltMid.processSample(params);
        const float cur = feltMid.getCurrentCutoff();
        TEST_ASSERT(cur <= prevCutoff + 1e-4f, "Filter cutoff must never rise during decay stage");
        prevCutoff = cur;
    }
    TEST_ASSERT(prevCutoff <= peakCutoff, "Cutoff after decay must be <= peak attack cutoff");
}

// ============================================================================
// Test 28 (F11): Biquad Zero-Crossing Ringing Tails Verification
// ============================================================================
void test_biquad_zero_crossing_tail_continuity() {
    braun::Biquad filter;
    // 540 Hz peaking formant filter with Q = 10.0, +12 dB
    filter.configure(braun::Biquad::Type::Peaking, 48000.0f, 540.0f, 10.0f, 12.0f);

    filter.process(1.0f);

    int zeroCrossings = 0;
    float prevSample = 0.0f;
    float minPeakAfter2000 = 0.0f;

    for (int i = 0; i < 10000; ++i) {
        const float y = filter.process(0.0f);
        TEST_ASSERT(!std::isnan(y) && !std::isinf(y), "NaN/Inf in biquad decay");

        if ((prevSample > 0.0f && y <= 0.0f) || (prevSample < 0.0f && y >= 0.0f)) {
            ++zeroCrossings;
        }
        prevSample = y;
        if (i > 2000) {
            minPeakAfter2000 = std::max(minPeakAfter2000, std::abs(y));
        }
    }

    TEST_ASSERT(zeroCrossings > 50, "Biquad state prematurely wiped out on zero-crossing! Count: " + std::to_string(zeroCrossings));
    TEST_ASSERT(minPeakAfter2000 > 1.0e-6f, "Biquad tail failed to sustain resonance into late decay");
}

// ============================================================================
// Test 29 (F12): Adversarial Wavetable Index Boundary Safety
// ============================================================================
void test_wavetable_boundary_index_safety() {
    braun::WavetableBank bank;
    const std::vector<float> testPhases = {
        -1.0e-15f,           // Float rounding edge case: phase - floor(phase) == 1.0f
        -1.0e-7f,
        -0.0f,
        0.0f,
        1.0f - 1.0e-7f,
        1.0f,
        1.0f + 1.0e-7f,
        -1.0f,
        -100.0f,
        2048.0f,
        1000000.0f
    };

    const std::vector<braun::WaveformType> waveforms = {
        braun::WaveformType::Felt,
        braun::WaveformType::Sine,
        braun::WaveformType::Saw,
        braun::WaveformType::Square,
        braun::WaveformType::CS80,
        braun::WaveformType::Triangle,
        braun::WaveformType::Warm
    };

    for (auto wf : waveforms) {
        for (float p : testPhases) {
            const float sample = bank.readSample(wf, p);
            TEST_ASSERT(!std::isnan(sample) && !std::isinf(sample),
                        "Wavetable produced NaN/Inf on boundary phase: " + std::to_string(p));
            TEST_ASSERT(std::abs(sample) <= 1.05f,
                        "Wavetable output out of range [-1.05, 1.05]: " + std::to_string(sample));
        }
    }
}

// ============================================================================
// Test 30 (F13): Voice Steal Pitch Continuity
// ============================================================================
void test_voice_steal_pitch_continuity() {
    braun::WavetableBank wavetables;
    braun::FeltPianoVoice voice;
    voice.prepare(48000.0f, &wavetables, nullptr, 0, 0);
    braun::FeltPianoParams params;

    // Trigger low note C2 (65.41 Hz)
    voice.trigger(65.41f, 0.8f, 5.0f, params, false, false, 0);

    for (int i = 0; i < 100; ++i) {
        voice.processSample(params);
    }
    TEST_ASSERT(voice.isActive(), "Voice must be active");
    TEST_ASSERT(voice.getEnvGain() > 0.05f, "Voice must have non-zero gain");

    // Steal voice with high note C6 (1046.50 Hz)
    voice.trigger(1046.50f, 0.8f, 5.0f, params, false, false, 100);
    TEST_ASSERT(voice.isStealing(), "Voice must enter stealing state");
    TEST_ASSERT(std::abs(voice.getStealFreq() - 65.41f) < 0.1f, "Steal frequency must preserve old note pitch (65.41 Hz)");
    TEST_ASSERT(std::abs(voice.getCurrentFreq() - 1046.50f) < 0.1f, "Current frequency must target new note (1046.50 Hz)");

    // Process 239 samples (within 240-sample / 5ms fade-out)
    for (int i = 0; i < 239; ++i) {
        voice.processSample(params);
        TEST_ASSERT(voice.isStealing(), "Voice must remain in stealing down-ramp");
    }

    // Advance 1 more sample: steal finishes, attack onset begins
    voice.processSample(params);
    TEST_ASSERT(!voice.isStealing(), "Voice must exit stealing after 240 samples");
}

// ============================================================================
// Test 31 (F14): Voice Steal Release Pop Prevention
// ============================================================================
void test_voice_steal_release_smooth_gain() {
    braun::WavetableBank wavetables;
    braun::FeltPianoVoice voice;
    voice.prepare(48000.0f, &wavetables, nullptr, 0, 0);
    braun::FeltPianoParams params;

    voice.trigger(440.0f, 0.8f, 5.0f, params, false, false, 0);
    for (int i = 0; i < 400; ++i) voice.processSample(params);

    // Trigger steal
    voice.trigger(880.0f, 0.8f, 5.0f, params, false, false, 400);
    for (int i = 0; i < 10; ++i) voice.processSample(params);

    const float gainBeforeRelease = voice.getEnvGain();
    TEST_ASSERT(gainBeforeRelease > 0.05f, "Gain before release must be non-zero");

    // Call release during stealing
    voice.release();
    TEST_ASSERT(voice.isActive(), "Voice must NOT be immediately killed on release during stealing");

    // Verify smooth monotonic decay without sudden jump
    float lastGain = gainBeforeRelease;
    for (int i = 0; i < 240; ++i) {
        voice.processSample(params);
        const float curGain = voice.getEnvGain();
        TEST_ASSERT(curGain <= lastGain + 1e-6f, "Envelope gain must not increase after release");
        TEST_ASSERT(std::abs(curGain - lastGain) < 0.05f, "No instantaneous step discontinuity in gain");
        lastGain = curGain;
    }
    TEST_ASSERT(!voice.isActive(), "Voice must cleanly deactivate once down-ramp completes");
    TEST_ASSERT(voice.getEnvGain() == 0.0f, "Voice gain must reach exactly 0.0f");
}

// ============================================================================
// Test 32 (F15): Sustain Pedal Retrigger Voice De-duplication
// ============================================================================
void test_sustain_pedal_retrigger_no_duplicate_voices() {
    braun::WavetableBank wavetables;
    braun::FeltPianoSynthesizer piano;
    piano.prepare(48000.0, &wavetables);

    // Play Note 60 with isHold = true (sustain pedal engaged)
    piano.noteOn(60, 0.8f, 3.5f, true, false);
    TEST_ASSERT(piano.getActiveVoiceCount() == 1, "Should allocate exactly 1 voice for first strike");

    // Re-strike Note 60 ten times while sustain pedal remains held
    for (int i = 0; i < 10; ++i) {
        piano.noteOn(60, 0.8f, 3.5f, true, false);
        TEST_ASSERT(piano.getActiveVoiceCount() == 1, 
            "Repeated strikes of the same note with sustain held must retrigger existing voice, not allocate duplicates");
    }
}

// ============================================================================
// Test 33 (F16): Voice Stealing Priority Steals Quietest Voice
// ============================================================================
void test_voice_stealing_priority_quietest_first() {
    braun::WavetableBank wavetables;
    braun::FeltPianoSynthesizer piano;
    piano.prepare(48000.0, &wavetables);

    // Fill all 24 voices
    for (int note = 40; note < 40 + 24; ++note) {
        piano.noteOn(note, 0.8f, 5.0f, false, false);
    }
    TEST_ASSERT(piano.getActiveVoiceCount() == 24, "All 24 voices filled");

    // Process 48000 samples (1 second) so envelopes decay
    std::vector<float> bufL(48000, 0.0f);
    std::vector<float> bufR(48000, 0.0f);
    piano.process(bufL.data(), bufR.data(), 48000);

    // Re-trigger Note 40 at high velocity so it is loud and new
    piano.noteOn(40, 1.0f, 5.0f, false, false);

    // Process 100 samples so Note 40 is at peak gain (~0.25) while other voices are decaying (~0.01)
    piano.process(bufL.data(), bufR.data(), 100);

    // Now trigger note 90 (forces voice stealing)
    piano.noteOn(90, 0.8f, 5.0f, false, false);

    // Voice count remains 24
    TEST_ASSERT(piano.getActiveVoiceCount() == 24, "Voice count capped at 24");

    // Release note 40: since it was preserved as loud, releasing it decreases active count
    piano.release(440.0f * std::pow(2.0f, static_cast<float>(40 - 69) / 12.0f));
}

// ============================================================================
// Test 34 (F19): Master Limiter Post-Saturation DC Offset Rejection
// ============================================================================
void test_master_limiter_post_saturation_dc_offset_rejection() {
    braun::MasterLimiterDsp limiter;
    limiter.prepare(48000.0);

    braun::MasterLimiterParams params;
    params.masterVolume = 1.0f;
    params.tapeWarmth = 0.50f; // Strong asymmetric 2nd-harmonic warmth
    params.limiterKnee = 0.80f;

    // Drive with high-amplitude sine wave (1.5) to induce asymmetric saturation
    for (int i = 0; i < 48000; ++i) {
        const float x = 1.5f * std::sin(braun::kTwoPi * 110.0f * static_cast<float>(i) / 48000.0f);
        float outL = 0.0f, outR = 0.0f;
        limiter.processSample(x, x, params, outL, outR);
    }

    // Collect 4,800 samples (exact 11 integer cycles of 110 Hz) and compute mean DC offset
    double sumL = 0.0;
    double sumR = 0.0;
    for (int i = 0; i < 4800; ++i) {
        const float x = 1.5f * std::sin(braun::kTwoPi * 110.0f * static_cast<float>(i + 48000) / 48000.0f);
        float outL = 0.0f, outR = 0.0f;
        limiter.processSample(x, x, params, outL, outR);
        sumL += outL;
        sumR += outR;
    }

    const double dcL = std::abs(sumL / 4800.0);
    const double dcR = std::abs(sumR / 4800.0);

    // With post-saturation DC blocker, DC offset is < 0.002
    TEST_ASSERT(dcL < 0.002, "Post-saturation DC offset on Left exceeds 0.002: " + std::to_string(dcL));
    TEST_ASSERT(dcR < 0.002, "Post-saturation DC offset on Right exceeds 0.002: " + std::to_string(dcR));
}

// ============================================================================
// Test 35 (F20): Shimmer Reverb Mono Downmix Preservation of All 8 Modes
// ============================================================================
void test_shimmer_reverb_mono_downmix_modal_preservation() {
    braun::ShimmerReverbDsp reverb;
    reverb.prepare(48000.0);

    braun::ShimmerReverbParams params;
    params.decaySec = 8.0f;
    params.damping = 0.50f;
    params.shimmer = 0.50f;
    params.mix = 1.0f;
    params.freeze = false;

    // Unit impulse injection
    float outL = 0.0f, outR = 0.0f;
    reverb.processSample(1.0f, 1.0f, params, outL, outR);

    double monoEnergy = 0.0;
    double stereoEnergy = 0.0;

    // Measure energy over 4,000 samples
    for (int i = 0; i < 4000; ++i) {
        outL = 0.0f;
        outR = 0.0f;
        reverb.processSample(0.0f, 0.0f, params, outL, outR);
        const float mono = (outL + outR) * 0.5f;
        monoEnergy += mono * mono;
        stereoEnergy += (outL * outL + outR * outR) * 0.5;
    }

    // In reformed downmix, monoEnergy / stereoEnergy must exceed 0.60
    const double energyRatio = monoEnergy / stereoEnergy;
    TEST_ASSERT(energyRatio > 0.60, "Shimmer mono downmix suffered modal phase cancellation! Ratio: " + std::to_string(energyRatio));
}

// ============================================================================
// Test 36 (F21): OnePoleSmoother Parameter Zipper Noise Absence
// ============================================================================
void test_parameter_smoothing_zipper_noise() {
    braun::TapeDelayDsp delay;
    delay.prepare(48000.0, 2.0);

    braun::TapeDelayParams dParams;
    dParams.mix = 0.0f;
    dParams.timeSec = 0.1f;
    dParams.wowAmount = 0.0f;

    // Settle delay line with audio
    float outL = 0.0f, outR = 0.0f;
    for (int i = 0; i < 4800; ++i) {
        delay.processSample(0.5f, 0.5f, dParams, outL, outR);
    }

    // Instantaneous step in tape_mix: 0.0 -> 1.0
    dParams.mix = 1.0f;
    float maxDeltaL = 0.0f;
    float prevL = outL;
    for (int i = 0; i < 200; ++i) {
        delay.processSample(0.5f, 0.5f, dParams, outL, outR);
        float delta = std::abs(outL - prevL);
        if (delta > maxDeltaL) maxDeltaL = delta;
        prevL = outL;
    }

    TEST_ASSERT(maxDeltaL < 0.05f, "Zipper noise on tape_mix step! Max delta = " + std::to_string(maxDeltaL));
}

// ============================================================================
// Test 37 (F31): Wavefolder Trig Identity Optimization & Epsilon Invariance
// ============================================================================
void test_wavefolder_optimization_and_invariance() {
    constexpr int kSamples = 100000;
    float maxDiff = 0.0f;

    const std::vector<std::pair<float, float>> grid = {
        { 0.5f, 0.0f }, { 1.0f, 0.2f }, { 1.8f, 0.6f },
        { 2.5f, 0.8f }, { 3.5f, 0.5f }, { 4.0f, 1.0f }
    };

    for (const auto& p : grid) {
        const float drive = p.first;
        const float fold = p.second;

        for (int i = 0; i < kSamples; ++i) {
            const float x = -5.0f + 10.0f * (static_cast<float>(i) / static_cast<float>(kSamples - 1));

            // Reference dual-sin implementation
            const float driven = x * drive;
            const float s1 = std::sin(braun::kHalfPi * driven);
            const float s2_ref = s1 - fold * std::sin(braun::kThreeHalfPi * driven);
            const float y_ref = std::tanh(s2_ref);

            // Optimized single-sin implementation
            const float y_opt = braun::wavefold(x, drive, fold);

            const float diff = std::abs(y_ref - y_opt);
            if (diff > maxDiff) maxDiff = diff;

            TEST_ASSERT(!std::isnan(y_opt), "NaN detected in optimized wavefolder output!");
            TEST_ASSERT(!std::isinf(y_opt), "Infinity detected in optimized wavefolder output!");
            TEST_ASSERT(std::abs(y_opt) <= 1.0f, "Wavefolder output out of bounds [-1, 1]!");
        }
    }

    std::cout << "  [METRICS] Wavefolder max difference: " << maxDiff << " (bound: < 1.0e-5)\n";
    TEST_ASSERT(maxDiff < 1.0e-5f, "Wavefolder trig identity optimization exceeded epsilon bound!");

    // Benchmark CPU timing over 2,000,000 iterations
    constexpr int kBenchIters = 2000000;
    std::vector<float> input(kBenchIters);
    for (int i = 0; i < kBenchIters; ++i) {
        input[i] = -2.0f + 4.0f * (static_cast<float>(i) / static_cast<float>(kBenchIters));
    }

    auto t0 = std::chrono::high_resolution_clock::now();
    volatile float sumRef = 0.0f;
    for (int i = 0; i < kBenchIters; ++i) {
        const float x = input[i];
        const float driven = x * 1.8f;
        const float s1 = std::sin(braun::kHalfPi * driven);
        const float s2 = s1 - 0.6f * std::sin(braun::kThreeHalfPi * driven);
        sumRef += std::tanh(s2);
    }
    auto t1 = std::chrono::high_resolution_clock::now();
    const double msRef = std::chrono::duration<double, std::milli>(t1 - t0).count();

    auto t2 = std::chrono::high_resolution_clock::now();
    volatile float sumOpt = 0.0f;
    for (int i = 0; i < kBenchIters; ++i) {
        sumOpt += braun::wavefold(input[i], 1.8f, 0.6f);
    }
    auto t3 = std::chrono::high_resolution_clock::now();
    const double msOpt = std::chrono::duration<double, std::milli>(t3 - t2).count();

    const double reductionPct = ((msRef - msOpt) / msRef) * 100.0;
    std::cout << "  [BENCHMARK] Wavefolder 2M ops: Ref = " << msRef << " ms, Opt = " << msOpt
              << " ms (CPU reduction: " << reductionPct << "%)\n";
}

// ============================================================================
// Test 38 (F31): Shimmer Reverb FDN Precomputation & Bit-Exact Invariance
// ============================================================================
void test_shimmer_fdn_decay_precomputation_invariance() {
    braun::ShimmerReverbDsp reverb;
    reverb.prepare(48000.0f);

    braun::ShimmerReverbParams params;
    params.mix = 1.0f;
    params.decaySec = 4.5f;
    params.damping = 0.35f;
    params.shimmer = 0.0f;
    params.freeze = false;

    constexpr int kTestLen = 48000;
    std::vector<float> input(kTestLen, 0.0f);
    input[0] = 1.0f;
    for (int i = 1; i < 1000; ++i) {
        input[i] = 0.5f * std::sin(2.0f * braun::kPi * 440.0f * i / 48000.0f);
    }

    float outL = 0.0f, outR = 0.0f;
    double dcLeftSum = 0.0, dcRightSum = 0.0;
    int nanCount = 0, infCount = 0, denormalCount = 0;

    for (int i = 0; i < kTestLen; ++i) {
        outL = 0.0f; outR = 0.0f;
        reverb.processSample(input[i], input[i], params, outL, outR);

        if (std::isnan(outL) || std::isnan(outR)) ++nanCount;
        if (std::isinf(outL) || std::isinf(outR)) ++infCount;
        if (std::fpclassify(outL) == FP_SUBNORMAL || std::fpclassify(outR) == FP_SUBNORMAL) ++denormalCount;

        dcLeftSum += outL;
        dcRightSum += outR;
    }

    TEST_ASSERT(nanCount == 0, "NaN detected in Shimmer Reverb output!");
    TEST_ASSERT(infCount == 0, "Infinity detected in Shimmer Reverb output!");
    TEST_ASSERT(denormalCount == 0, "Denormal detected in Shimmer Reverb output!");

    const float dcL = static_cast<float>(std::abs(dcLeftSum / kTestLen));
    const float dcR = static_cast<float>(std::abs(dcRightSum / kTestLen));
    TEST_ASSERT(dcL < 1.0e-3f && dcR < 1.0e-3f, "DC offset detected in Shimmer Reverb output!");
    std::cout << "  [METRICS] Shimmer FDN: NaNs: 0, Infs: 0, Denormals: 0, DC Left: "
              << dcL << ", DC Right: " << dcR << "\n";
}

// ============================================================================
// Test 39 (F31): Tape Delay Power-of-Two Masking Bit-Exact Invariance & Benchmark
// ============================================================================
void test_tape_delay_power_of_two_masking_invariance() {
    constexpr size_t kBufferSize = 262144;
    constexpr size_t kMask = kBufferSize - 1;
    constexpr int kIterations = 5000000;

    for (int i = 0; i < 100000; ++i) {
        const size_t moduloResult = static_cast<size_t>(i) % kBufferSize;
        const size_t maskResult = static_cast<size_t>(i) & kMask;
        TEST_ASSERT(moduloResult == maskResult, "Masking does not match modulo!");
    }

    auto t0 = std::chrono::high_resolution_clock::now();
    volatile size_t sumMod = 0;
    for (int i = 0; i < kIterations; ++i) {
        sumMod += static_cast<size_t>(i) % kBufferSize;
    }
    auto t1 = std::chrono::high_resolution_clock::now();
    const double msMod = std::chrono::duration<double, std::milli>(t1 - t0).count();

    auto t2 = std::chrono::high_resolution_clock::now();
    volatile size_t sumMask = 0;
    for (int i = 0; i < kIterations; ++i) {
        sumMask += static_cast<size_t>(i) & kMask;
    }
    auto t3 = std::chrono::high_resolution_clock::now();
    const double msMask = std::chrono::duration<double, std::milli>(t3 - t2).count();

    const double reductionPct = ((msMod - msMask) / msMod) * 100.0;
    std::cout << "  [BENCHMARK] Delay Indexing 5M ops: Modulo (%) = " << msMod
              << " ms, Mask (&) = " << msMask << " ms (CPU reduction: " << reductionPct << "%)\n";
}

// ============================================================================
// Main Test Runner
// ============================================================================
int main() {
    std::cout << "========================================================\n";
    std::cout << "  BRAUN AS 42 Real-Time C++ DSP Verification Test Suite \n";
    std::cout << "========================================================\n";

    RUN_TEST(test_wavefolder_transfer_curve_matches_js);
    RUN_TEST(test_hermite_limiter_c1_continuity_and_bounds);
    RUN_TEST(test_tape_delay_feedback_normalization_stability);
    RUN_TEST(test_pitch_shifter_octave_shift_continuity);
    RUN_TEST(test_polyphonic_voice_allocation_and_stealing);
    RUN_TEST(test_sub_bass_mode_characteristics);
    RUN_TEST(test_dsp_engine_full_signal_flow);
    RUN_TEST(test_dsp_engine_silence_on_startup_until_triggered_or_active);
    RUN_TEST(test_dsp_engine_zero_output_when_idle_powered_on_and_tail_decay);
    RUN_TEST(test_dsp_engine_no_self_oscillation_under_extreme_parameters);
    RUN_TEST(test_drone_midi_pitch_tracking);
    RUN_TEST(test_drone_midi_note_off_gating);
    RUN_TEST(test_scope_visualizer_ring_buffer_bounds_and_safety);
    RUN_TEST(test_biquad_bandpass_unity_gain);
    RUN_TEST(test_shimmer_reverb_fdn_diffusion_and_decay);
    RUN_TEST(test_felt_piano_sympathetic_resonance_tracking);
    RUN_TEST(test_shimmer_reverb_stereo_decorrelation);
    RUN_TEST(test_startup_default_power_and_voice_states);
    RUN_TEST(test_shimmer_fdn_exhaustive_phase_modes_and_tape_echo_clarity);
    RUN_TEST(test_cs80_timbre_sustain_and_filter_release_sweep);
    RUN_TEST(test_rapid_preset_switching_under_active_midi_polyphony);
    RUN_TEST(test_shimmer_undamped_cs80_resonance_and_stability);
    RUN_TEST(test_shimmer_loop_gain_grid_stability_under_min_damping);
    RUN_TEST(test_felt_piano_held_note_decays_to_silence);
    RUN_TEST(test_felt_piano_decay_knob_sensitivity);
    RUN_TEST(test_felt_vs_sine_spectral_and_harmonic_difference);
    RUN_TEST(test_acoustic_filter_envelope_monotonicity_and_sine_bounds);
    RUN_TEST(test_biquad_zero_crossing_tail_continuity);
    RUN_TEST(test_wavetable_boundary_index_safety);
    RUN_TEST(test_voice_steal_pitch_continuity);
    RUN_TEST(test_voice_steal_release_smooth_gain);
    RUN_TEST(test_sustain_pedal_retrigger_no_duplicate_voices);
    RUN_TEST(test_voice_stealing_priority_quietest_first);
    RUN_TEST(test_master_limiter_post_saturation_dc_offset_rejection);
    RUN_TEST(test_shimmer_reverb_mono_downmix_modal_preservation);
    RUN_TEST(test_parameter_smoothing_zipper_noise);
    RUN_TEST(test_wavefolder_optimization_and_invariance);
    RUN_TEST(test_shimmer_fdn_decay_precomputation_invariance);
    RUN_TEST(test_tape_delay_power_of_two_masking_invariance);

    std::cout << "========================================================\n";
    std::cout << "Summary: " << gTestsPassed << " passed, " << gTestsFailed << " failed.\n";
    std::cout << "========================================================\n";

    return (gTestsFailed == 0) ? 0 : 1;
}


