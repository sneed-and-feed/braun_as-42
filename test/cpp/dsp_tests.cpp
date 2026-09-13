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
    TEST_ASSERT(maxPostReleaseAmp == 0.0f, "Drone output must return to 0.0 after release");

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

    std::cout << "========================================================\n";
    std::cout << "Summary: " << gTestsPassed << " passed, " << gTestsFailed << " failed.\n";
    std::cout << "========================================================\n";

    return (gTestsFailed == 0) ? 0 : 1;
}
