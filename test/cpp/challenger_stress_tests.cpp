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
#include <atomic>
#include <cstdlib>
#include <new>
#include <thread>
#include <chrono>

// ============================================================================
// Real-Time Heap Allocation Tracking Hooks
// ============================================================================
static std::atomic<bool> gTrackAllocations { false };
static std::atomic<size_t> gAllocationCount { 0 };
static std::atomic<size_t> gAllocatedBytes { 0 };

void* operator new(size_t size) {
    if (gTrackAllocations.load(std::memory_order_relaxed)) {
        gAllocationCount.fetch_add(1, std::memory_order_relaxed);
        gAllocatedBytes.fetch_add(size, std::memory_order_relaxed);
    }
    void* p = std::malloc(size);
    if (!p) throw std::bad_alloc();
    return p;
}

void operator delete(void* p) noexcept {
    std::free(p);
}

void operator delete(void* p, size_t) noexcept {
    std::free(p);
}

void* operator new[](size_t size) {
    if (gTrackAllocations.load(std::memory_order_relaxed)) {
        gAllocationCount.fetch_add(1, std::memory_order_relaxed);
        gAllocatedBytes.fetch_add(size, std::memory_order_relaxed);
    }
    void* p = std::malloc(size);
    if (!p) throw std::bad_alloc();
    return p;
}

void operator delete[](void* p) noexcept {
    std::free(p);
}

void operator delete[](void* p, size_t) noexcept {
    std::free(p);
}

// ============================================================================
// Test Framework Macros & Counters
// ============================================================================
static int gTestsPassed = 0;
static int gTestsFailed = 0;

#define CHALLENGER_ASSERT(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "  [FAIL] " << msg << " (" << __FILE__ << ":" << __LINE__ << ")\n"; \
            ++gTestsFailed; \
            return; \
        } \
    } while (0)

#define RUN_CHALLENGER_TEST(fn) \
    do { \
        std::cout << "[RUNNING] " << #fn << "..." << std::endl; \
        const int prevFailures = gTestsFailed; \
        fn(); \
        if (gTestsFailed == prevFailures) { \
            std::cout << "  [PASS] " << #fn << "\n"; \
            ++gTestsPassed; \
        } \
    } while (0)

// Helper: check buffer for NaN, Inf, and bounds
static inline bool checkBufferFiniteAndBounded(const float* buffer, int numSamples, float maxBound, std::string& errorMsg) {
    for (int i = 0; i < numSamples; ++i) {
        const float s = buffer[i];
        if (std::isnan(s)) {
            errorMsg = "NaN detected at sample index " + std::to_string(i);
            return false;
        }
        if (std::isinf(s)) {
            errorMsg = "Inf detected at sample index " + std::to_string(i);
            return false;
        }
        if (std::abs(s) > maxBound) {
            errorMsg = "Sample exceeded bound " + std::to_string(maxBound) + ": value = " + std::to_string(s) + " at index " + std::to_string(i);
            return false;
        }
    }
    return true;
}

// ============================================================================
// Stress Test 1: Extreme Block Sizes (1, 16, 64, 512, 2048, 4096 & Interleaved Dynamic)
// ============================================================================
void test_extreme_block_sizes() {
    const std::vector<int> blockSizes = { 1, 16, 64, 512, 2048, 4096 };

    for (int bs : blockSizes) {
        braun::DspEngine engine;
        engine.prepare(48000.0, 4096);

        braun::ParameterSnapshot params;
        params.felt_volume = 0.85f;
        params.drone1_active = true;
        params.drone2_active = true;
        params.tape_mix = 0.40f;
        params.shimmer_mix = 0.35f;

        // Trigger notes
        const braun::MidiEvent noteEv = { 0, 0x90, 60, 100 }; // Note-on C4
        std::vector<float> bufL(static_cast<size_t>(bs), 0.0f);
        std::vector<float> bufR(static_cast<size_t>(bs), 0.0f);

        engine.process(bufL.data(), bufR.data(), bs, params, &noteEv, 1);

        std::string err;
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufL.data(), bs, 1.2f, err), "BlockSize " + std::to_string(bs) + " L: " + err);
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufR.data(), bs, 1.2f, err), "BlockSize " + std::to_string(bs) + " R: " + err);

        // Process enough blocks so that even with tiny block sizes, the envelope can ramp up (e.g. >= 2000 samples)
        const int numBlocks = (bs < 64) ? (2000 / bs) : 20;
        float peak = 0.0f;
        for (int b = 0; b < numBlocks; ++b) {
            std::fill(bufL.begin(), bufL.end(), 0.0f);
            std::fill(bufR.begin(), bufR.end(), 0.0f);
            engine.process(bufL.data(), bufR.data(), bs, params, nullptr, 0);

            CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufL.data(), bs, 1.2f, err), "BlockSize " + std::to_string(bs) + " L: " + err);
            CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufR.data(), bs, 1.2f, err), "BlockSize " + std::to_string(bs) + " R: " + err);

            for (int s = 0; s < bs; ++s) {
                peak = std::max(peak, std::max(std::abs(bufL[s]), std::abs(bufR[s])));
            }
        }

        CHALLENGER_ASSERT(peak > 0.005f, "BlockSize " + std::to_string(bs) + " produced no audio output (peak = " + std::to_string(peak) + ")");
    }

    // Interleaved Dynamic Block Sizes: random block size per call
    {
        braun::DspEngine engine;
        engine.prepare(48000.0, 4096);

        braun::ParameterSnapshot params;
        params.felt_volume = 0.80f;
        params.drone1_volume = 0.50f;
        params.drone2_volume = 0.50f;

        const braun::MidiEvent chordEvs[3] = {
            { 0, 0x90, 57, 90 }, // A3
            { 0, 0x90, 60, 95 }, // C4
            { 0, 0x90, 64, 85 }  // E4
        };

        std::mt19937 rng(42);
        std::uniform_int_distribution<int> distBlock(1, 4096);

        std::vector<float> scratchL(4096);
        std::vector<float> scratchR(4096);

        // First call with chord
        int bs = distBlock(rng);
        engine.process(scratchL.data(), scratchR.data(), bs, params, chordEvs, 3);
        std::string err;
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(scratchL.data(), bs, 1.2f, err), "Interleaved initial block: " + err);

        // 100 calls with randomized block sizes (1 to 4096)
        for (int step = 0; step < 100; ++step) {
            bs = distBlock(rng);
            std::fill(scratchL.begin(), scratchL.begin() + bs, 0.0f);
            std::fill(scratchR.begin(), scratchR.begin() + bs, 0.0f);

            engine.process(scratchL.data(), scratchR.data(), bs, params, nullptr, 0);
            CHALLENGER_ASSERT(checkBufferFiniteAndBounded(scratchL.data(), bs, 1.2f, err), "Interleaved step " + std::to_string(step) + " (bs=" + std::to_string(bs) + "): " + err);
        }
    }
}

// ============================================================================
// Stress Test 2: Multiple Standard Sample Rates (44.1k, 48k, 88.2k, 96k, 192k Hz)
// ============================================================================
void test_multiple_sample_rates() {
    const std::vector<double> sampleRates = { 44100.0, 48000.0, 88200.0, 96000.0, 192000.0 };

    for (double sr : sampleRates) {
        braun::DspEngine engine;
        engine.prepare(sr, 512);

        braun::ParameterSnapshot params;
        params.felt_volume = 0.85f;
        params.felt_tone = 0.70f;
        params.drone1_pitch = 65.41f; // C2
        params.drone1_cutoff = 1200.0f;
        params.drone1_resonance = 5.0f;
        params.drone2_pitch = 98.00f; // G2
        params.tape_time = 0.35f;
        params.tape_feedback = 0.65f;
        params.shimmer_decay = 6.0f;
        params.shimmer_mix = 0.40f;
        params.master_volume = 0.80f;

        const braun::MidiEvent chord[4] = {
            { 0,   0x90, 48, 100 }, // C3
            { 16,  0x90, 52, 90  }, // E3
            { 32,  0x90, 55, 95  }, // G3
            { 64,  0x90, 59, 85  }  // B3
        };

        std::vector<float> bufL(512, 0.0f);
        std::vector<float> bufR(512, 0.0f);

        // Process first block with MIDI
        engine.process(bufL.data(), bufR.data(), 512, params, chord, 4);
        std::string err;
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufL.data(), 512, 1.2f, err), "SR " + std::to_string(sr) + " init: " + err);

        // Process 1 full second worth of blocks
        const int blocksPerSec = static_cast<int>(std::ceil(sr / 512.0));
        float peak = 0.0f;
        for (int b = 0; b < blocksPerSec; ++b) {
            std::fill(bufL.begin(), bufL.end(), 0.0f);
            std::fill(bufR.begin(), bufR.end(), 0.0f);
            engine.process(bufL.data(), bufR.data(), 512, params, nullptr, 0);

            CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufL.data(), 512, 1.2f, err), "SR " + std::to_string(sr) + " block " + std::to_string(b) + ": " + err);
            for (int s = 0; s < 512; ++s) {
                peak = std::max(peak, std::max(std::abs(bufL[s]), std::abs(bufR[s])));
            }
        }

        CHALLENGER_ASSERT(peak > 0.01f, "SR " + std::to_string(sr) + " produced no active audio: peak = " + std::to_string(peak));
        CHALLENGER_ASSERT(peak <= 1.05f, "SR " + std::to_string(sr) + " exceeded master limiting bounds: peak = " + std::to_string(peak));
    }
}

// ============================================================================
// Stress Test 3: Rapid Parameter Modulation Sweeps Across All 22 Parameters
// ============================================================================
void test_rapid_parameter_sweeps_22_params() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;

    // Start with note-on
    const braun::MidiEvent noteEv = { 0, 0x90, 60, 110 };
    std::vector<float> bufL(512, 0.0f);
    std::vector<float> bufR(512, 0.0f);
    engine.process(bufL.data(), bufR.data(), 512, params, &noteEv, 1);

    std::mt19937 rng(999);
    std::uniform_real_distribution<float> rand01(0.0f, 1.0f);

    constexpr int kTotalBlocks = 300; // 300 * 512 = 153,600 samples (> 100,000 samples)
    std::string err;

    for (int b = 0; b < kTotalBlocks; ++b) {
        const float t = static_cast<float>(b) / static_cast<float>(kTotalBlocks);
        const float sineMod = 0.5f + 0.5f * std::sin(braun::kTwoPi * t * 10.0f);

        // Rapidly modulate all 22 APVTS parameters:
        // 1. Felt piano parameters
        params.felt_volume = rand01(rng);
        params.felt_decay = 0.1f + rand01(rng) * 9.0f;
        params.felt_tone = sineMod;
        params.felt_hammer = rand01(rng);
        params.felt_space = rand01(rng);
        params.felt_waveform = (b % 5); // Cycle through Felt, Sine, Saw, Square, CS80

        // 2. Drone 1 parameters
        params.drone1_volume = rand01(rng);
        params.drone1_pitch = 30.0f + sineMod * 400.0f;
        params.drone1_fold = rand01(rng) * 100.0f;
        params.drone1_cutoff = 50.0f + rand01(rng) * 14000.0f;
        params.drone1_resonance = 0.5f + rand01(rng) * 11.5f;
        params.drone1_beat = -4.0f + rand01(rng) * 8.0f;
        params.drone1_detune = -40.0f + rand01(rng) * 80.0f;
        params.drone1_waveA = (b % 7);
        params.drone1_waveB = ((b + 2) % 7);
        params.drone1_isSubBass = (b % 20 == 0); // Periodic sub-bass toggle

        // 3. Drone 2 parameters
        params.drone2_volume = rand01(rng);
        params.drone2_pitch = 40.0f + (1.0f - sineMod) * 400.0f;
        params.drone2_fold = rand01(rng) * 100.0f;
        params.drone2_cutoff = 50.0f + (1.0f - sineMod) * 14000.0f;
        params.drone2_resonance = 0.5f + rand01(rng) * 11.5f;
        params.drone2_beat = -4.0f + rand01(rng) * 8.0f;
        params.drone2_detune = -40.0f + rand01(rng) * 80.0f;

        // 4. Tape delay parameters
        params.tape_time = 0.015f + rand01(rng) * 1.95f;
        params.tape_feedback = rand01(rng) * 0.92f;
        params.tape_mix = rand01(rng);
        params.tape_wow = rand01(rng);
        params.tape_tone = 800.0f + rand01(rng) * 10000.0f;

        // 5. Shimmer reverb parameters
        params.shimmer_mix = rand01(rng);
        params.shimmer_decay = 0.5f + rand01(rng) * 20.0f;
        params.shimmer_damping = 0.05f + rand01(rng) * 0.90f;
        params.shimmer_amount = rand01(rng);
        params.shimmer_freeze = (b % 35 == 0);

        // 6. Master parameters
        params.master_volume = 0.2f + rand01(rng) * 0.8f;

        std::fill(bufL.begin(), bufL.end(), 0.0f);
        std::fill(bufR.begin(), bufR.end(), 0.0f);

        engine.process(bufL.data(), bufR.data(), 512, params, nullptr, 0);

        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufL.data(), 512, 1.2f, err), "Modulation block " + std::to_string(b) + " L: " + err);
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufR.data(), 512, 1.2f, err), "Modulation block " + std::to_string(b) + " R: " + err);
    }
}

// ============================================================================
// Stress Test 4: Dense Polyphony Burst (128 Note-Ons/Offs & Heavy Sustain Toggles)
// ============================================================================
void test_dense_polyphony_and_voice_stealing() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.felt_volume = 0.90f;
    params.master_volume = 0.80f;

    std::vector<float> bufL(512, 0.0f);
    std::vector<float> bufR(512, 0.0f);
    std::string err;

    // Burst 1: Send all 128 MIDI Note-Ons across tight intervals
    std::vector<braun::MidiEvent> burstEvents;
    for (int note = 0; note < 128; ++note) {
        braun::MidiEvent ev;
        ev.sampleOffset = (note * 3) % 512;
        ev.status = 0x90;
        ev.data1 = static_cast<uint8_t>(note);
        ev.data2 = static_cast<uint8_t>(60 + (note % 60));
        burstEvents.push_back(ev);
    }

    // Sort events by sampleOffset
    std::sort(burstEvents.begin(), burstEvents.end(), [](const braun::MidiEvent& a, const braun::MidiEvent& b) {
        return a.sampleOffset < b.sampleOffset;
    });

    engine.process(bufL.data(), bufR.data(), 512, params, burstEvents.data(), static_cast<int>(burstEvents.size()));

    CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufL.data(), 512, 1.2f, err), "Burst 1 L: " + err);
    CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufR.data(), 512, 1.2f, err), "Burst 1 R: " + err);

    // Active voice count must strictly not exceed 24
    const int activeVoices = engine.getFeltPiano().getActiveVoiceCount();
    CHALLENGER_ASSERT(activeVoices <= 24, "Active voice count exceeded pool size 24: " + std::to_string(activeVoices));
    CHALLENGER_ASSERT(activeVoices == 24, "Active voices should be exactly 24 under burst load: " + std::to_string(activeVoices));

    // Burst 2: Heavy sustain pedal toggling (CC 64) with rapid Note-Ons and Note-Offs
    for (int cycle = 0; cycle < 30; ++cycle) {
        std::vector<braun::MidiEvent> pedalEvents;

        // Pedal Down
        pedalEvents.push_back({ 0, 0xB0, 64, 127 });

        // Trigger 10 notes
        for (int i = 0; i < 10; ++i) {
            const uint8_t note = static_cast<uint8_t>(36 + (cycle * 3 + i) % 70);
            pedalEvents.push_back({ 10 + i * 20, 0x90, note, 90 });
            // And release key (should latch because pedal is down)
            pedalEvents.push_back({ 15 + i * 20, 0x80, note, 0 });
        }

        // Pedal Up
        pedalEvents.push_back({ 350, 0xB0, 64, 0 });

        // Retrigger 5 notes after pedal release
        for (int i = 0; i < 5; ++i) {
            const uint8_t note = static_cast<uint8_t>(60 + i * 4);
            pedalEvents.push_back({ 380 + i * 20, 0x90, note, 100 });
        }

        std::sort(pedalEvents.begin(), pedalEvents.end(), [](const braun::MidiEvent& a, const braun::MidiEvent& b) {
            return a.sampleOffset < b.sampleOffset;
        });

        std::fill(bufL.begin(), bufL.end(), 0.0f);
        std::fill(bufR.begin(), bufR.end(), 0.0f);

        engine.process(bufL.data(), bufR.data(), 512, params, pedalEvents.data(), static_cast<int>(pedalEvents.size()));

        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufL.data(), 512, 1.2f, err), "Pedal cycle " + std::to_string(cycle) + " L: " + err);
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufR.data(), 512, 1.2f, err), "Pedal cycle " + std::to_string(cycle) + " R: " + err);
        CHALLENGER_ASSERT(engine.getFeltPiano().getActiveVoiceCount() <= 24, "Voices exceeded 24 during pedal cycle");
    }

    // Burst 3: All Notes Off (CC 123) and tail decay
    const braun::MidiEvent allOffEv = { 0, 0xB0, 123, 0 };
    engine.process(bufL.data(), bufR.data(), 512, params, &allOffEv, 1);

    // Process 100 decay blocks (approx 1.07s)
    for (int b = 0; b < 100; ++b) {
        std::fill(bufL.begin(), bufL.end(), 0.0f);
        std::fill(bufR.begin(), bufR.end(), 0.0f);
        engine.process(bufL.data(), bufR.data(), 512, params, nullptr, 0);
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufL.data(), 512, 1.2f, err), "Decay block " + std::to_string(b) + ": " + err);
    }

    const int remainingVoices = engine.getFeltPiano().getActiveVoiceCount();
    std::cout << "  [DEBUG] Active voices remaining after CC 123 and 100 decay blocks: " << remainingVoices << "\n";
    for (int i = 0; i < 24; ++i) {
        // Inspect each voice state
        // We can check if voice is active and what its parameters are
    }
    CHALLENGER_ASSERT(remainingVoices == 0, "All voices must reach 0 after release and decay (remaining: " + std::to_string(remainingVoices) + ")");
}

// ============================================================================
// Stress Test 4B: Isolated Reproduction of Voice Stealing vs Release Race Condition
// ============================================================================
void test_voice_stealing_release_race_condition() {
    braun::WavetableBank wavetables;
    braun::FeltPianoSynthesizer piano;
    piano.prepare(48000.0, &wavetables);

    // 1. Fill all 24 voices
    for (int n = 36; n < 36 + 24; ++n) {
        piano.noteOn(n, 0.8f);
    }
    CHALLENGER_ASSERT(piano.getActiveVoiceCount() == 24, "Failed to fill 24 voices");

    // Process 200 samples so voices are playing with envelope gain > 0.01
    std::vector<float> bufL(200, 0.0f);
    std::vector<float> bufR(200, 0.0f);
    piano.process(bufL.data(), bufR.data(), 200);

    // 2. Trigger note 80 (forces voice stealing). The stolen voice enters mIsStealing = true (5ms / 240 samples)
    piano.noteOn(80, 0.9f);

    // 3. Process only 10 samples (well within the 240-sample steal ramp)
    piano.process(bufL.data(), bufR.data(), 10);

    // 4. Now immediately send releaseAll()
    piano.releaseAll();

    // 5. Process 500 samples (enough for the 240-sample steal ramp to finish)
    std::vector<float> bufAfter(500, 0.0f);
    piano.process(bufAfter.data(), bufAfter.data(), 500);

    // 6. Process 1.0 second (48,000 samples) of decay
    // If release was honored, all voices should be idle (release time is 0.40s = 19,200 samples).
    std::vector<float> bufDecay(48000, 0.0f);
    piano.process(bufDecay.data(), bufDecay.data(), 48000);

    const int remaining = piano.getActiveVoiceCount();
    std::cout << "  [INFO] Voice count after steal + releaseAll + 1.0s decay: " << remaining << "\n";
    CHALLENGER_ASSERT(remaining == 0,
        "VOICE STEALING BUG: releaseAll() was overwritten by steal down-ramp transitioning to EnvStage::Attack! Remaining voices: " +
        std::to_string(remaining));
}

// ============================================================================
// Stress Test 5: Tape Delay Feedback Saturation Stress (100,000 continuous samples)
// ============================================================================
void test_tape_delay_feedback_saturation_stress() {
    braun::TapeDelayDsp delay;
    delay.prepare(48000.0, 3.5);

    braun::TapeDelayParams params;
    params.timeSec = 0.035f;      // Very short delay -> rapid recirculation (~1680 samples)
    params.feedback = 0.92f;     // Maximum feedback threshold
    params.toneHz = 4000.0f;
    params.wowAmount = 1.0f;     // Full mechanical wow/flutter
    params.mix = 1.0f;

    constexpr int kTotalSamples = 100000;
    std::vector<float> outL(kTotalSamples, 0.0f);
    std::vector<float> outR(kTotalSamples, 0.0f);

    // 1. Inject pathological spikes and overdrive in first 1,000 samples
    // Spikes of +10.0, full scale square waves, and noise bursts
    std::mt19937 rng(555);
    std::uniform_real_distribution<float> noiseDist(-2.0f, 2.0f);

    float peakEnergy = 0.0f;
    std::string err;

    for (int i = 0; i < 1000; ++i) {
        float inSample = 0.0f;
        if (i % 100 == 0) {
            inSample = 10.0f; // Massive impulse spike (+20 dBFS)
        } else if (i < 300) {
            inSample = (i % 20 < 10) ? 3.0f : -3.0f; // High amplitude square wave
        } else {
            inSample = noiseDist(rng); // Overdriven noise burst
        }

        delay.processSample(inSample, inSample, params, outL[i], outR[i]);
        CHALLENGER_ASSERT(!std::isnan(outL[i]) && !std::isinf(outL[i]), "NaN/Inf during tape spike injection at L[" + std::to_string(i) + "]");
        CHALLENGER_ASSERT(!std::isnan(outR[i]) && !std::isinf(outR[i]), "NaN/Inf during tape spike injection at R[" + std::to_string(i) + "]");
        peakEnergy = std::max(peakEnergy, std::max(std::abs(outL[i]), std::abs(outR[i])));
    }

    // Delay return limiter and saturator must prevent explosive gain
    CHALLENGER_ASSERT(peakEnergy < 2.0f, "Tape delay output exploded under overdrive: peak = " + std::to_string(peakEnergy));

    // 2. Feed silence for remaining 99,000 samples and monitor recirculation stability
    float silencePeak = 0.0f;
    for (int i = 1000; i < kTotalSamples; ++i) {
        delay.processSample(0.0f, 0.0f, params, outL[i], outR[i]);

        const float l = outL[i];
        const float r = outR[i];
        CHALLENGER_ASSERT(!std::isnan(l) && !std::isinf(l), "NaN/Inf during tape recirculation at L[" + std::to_string(i) + "]");
        CHALLENGER_ASSERT(!std::isnan(r) && !std::isinf(r), "NaN/Inf during tape recirculation at R[" + std::to_string(i) + "]");

        silencePeak = std::max(silencePeak, std::max(std::abs(l), std::abs(r)));
    }

    // Must remain stable and non-divergent
    CHALLENGER_ASSERT(silencePeak < 2.0f, "Tape delay recirculation exploded: peak = " + std::to_string(silencePeak));

    // Inspect tail energy at sample 99,999: must have decayed
    const float tailL = std::abs(outL[kTotalSamples - 1]);
    const float tailR = std::abs(outR[kTotalSamples - 1]);
    CHALLENGER_ASSERT(tailL < 0.05f, "Tape delay tail failed to decay: L = " + std::to_string(tailL));
    CHALLENGER_ASSERT(tailR < 0.05f, "Tape delay tail failed to decay: R = " + std::to_string(tailR));
}

// ============================================================================
// Stress Test 6: Master Limiter & Bus Overload Protection (+40dBFS Overdrive)
// ============================================================================
void test_master_limiter_overload_protection() {
    braun::MasterLimiterDsp limiter;
    limiter.prepare(48000.0);

    braun::MasterLimiterParams params;
    params.masterVolume = 1.0f;
    params.tapeWarmth = 0.18f;
    params.limiterKnee = 0.80f;

    // 1. Extreme overdrive: +40 dBFS (amplitude 100.0)
    for (int i = 0; i < 4800; ++i) {
        const float x = 100.0f * std::sin(braun::kTwoPi * 440.0f * static_cast<float>(i) / 48000.0f);
        float outL = 0.0f, outR = 0.0f;
        limiter.processSample(x, x, params, outL, outR);

        CHALLENGER_ASSERT(!std::isnan(outL) && !std::isinf(outL), "NaN/Inf in limiter output L");
        CHALLENGER_ASSERT(!std::isnan(outR) && !std::isinf(outR), "NaN/Inf in limiter output R");
        // Hermite soft limiter must bound strictly to <= 1.0001
        CHALLENGER_ASSERT(std::abs(outL) <= 1.001f, "Limiter output exceeded 1.0: " + std::to_string(outL));
        CHALLENGER_ASSERT(std::abs(outR) <= 1.001f, "Limiter output exceeded 1.0: " + std::to_string(outR));
    }

    // 2. DC offset rejection: +5.0 DC bias injected
    float finalOutL = 0.0f, finalOutR = 0.0f;
    for (int i = 0; i < 24000; ++i) {
        const float x = 5.0f; // Pure DC offset
        limiter.processSample(x, x, params, finalOutL, finalOutR);
    }
    // 15 Hz DC blocker must attenuate DC bias to near 0
    CHALLENGER_ASSERT(std::abs(finalOutL) < 0.05f, "DC blocker failed to remove DC bias: L = " + std::to_string(finalOutL));
    CHALLENGER_ASSERT(std::abs(finalOutR) < 0.05f, "DC blocker failed to remove DC bias: R = " + std::to_string(finalOutR));
}

// ============================================================================
// Stress Test 7: Hard Real-Time Memory Safety & Allocation Check
// ============================================================================
void test_realtime_memory_safety_and_allocations() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.felt_volume = 0.80f;
    params.drone1_active = true;
    params.drone2_active = true;

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // Warm up one block before tracking
    engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);

    // Now turn on allocation tracking
    gAllocationCount.store(0);
    gAllocatedBytes.store(0);
    gTrackAllocations.store(true);

    // Generate diverse MIDI events across multiple blocks
    for (int b = 0; b < 100; ++b) {
        // Fixed stack array: real-time MIDI test events must not allocate heap memory in the test harness
        const braun::MidiEvent events[6] = {
            { 0,   0x90, static_cast<uint8_t>(40 + (b % 50)), 90 },
            { 100, 0x90, static_cast<uint8_t>(50 + (b % 40)), 80 },
            { 200, 0xB0, 64, static_cast<uint8_t>((b % 2 == 0) ? 127 : 0) },
            { 300, 0xB0, 1, static_cast<uint8_t>(b % 128) },
            { 400, 0xE0, static_cast<uint8_t>(b * 10), static_cast<uint8_t>((b * 5) % 128) },
            { 450, 0x80, static_cast<uint8_t>(40 + (b % 50)), 0 }
        };

        engine.process(blockL.data(), blockR.data(), 512, params, events, 6);
    }

    gTrackAllocations.store(false);

    const size_t totalAllocations = gAllocationCount.load();
    const size_t totalBytes = gAllocatedBytes.load();

    std::cout << "  [INFO] Real-time memory check during process(): "
              << totalAllocations << " allocations (" << totalBytes << " bytes)\n";

    CHALLENGER_ASSERT(totalAllocations == 0,
        "HARD REAL-TIME VIOLATION: DspEngine::process() performed " +
        std::to_string(totalAllocations) + " heap allocations (" +
        std::to_string(totalBytes) + " bytes). Audio thread must be zero-allocation!");
}

// ============================================================================
// Stress Test 9: CS-80 Dual-Saw Brass Excitation with Min Damping & Shimmer Overload
// ============================================================================
void test_shimmer_reverb_cs80_adversarial_burst_and_damping_floor() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    braun::ParameterSnapshot params;
    params.felt_volume = 1.0f;
    params.felt_waveform = 4; // CS-80
    params.felt_tone = 1.0f;   // Maximum brightness
    params.felt_decay = 2.5f;
    params.felt_space = 0.5f;
    params.shimmer_mix = 1.0f;
    params.shimmer_decay = 25.0f; // Max decay
    params.shimmer_damping = 0.0f; // Min damping
    params.shimmer_amount = 1.0f;  // Max shimmer
    params.tape_mix = 0.40f;
    params.tape_feedback = 0.70f;
    params.master_volume = 0.90f;

    std::vector<float> blockL(512, 0.0f);
    std::vector<float> blockR(512, 0.0f);

    // Blast 8 dense CS-80 chords in rapid succession
    for (int chord = 0; chord < 8; ++chord) {
        const uint8_t baseNote = static_cast<uint8_t>(48 + (chord * 3) % 24);
        const braun::MidiEvent chordEvents[5] = {
            { 0,   0x90, baseNote, 127 },
            { 10,  0x90, static_cast<uint8_t>(baseNote + 4), 120 },
            { 20,  0x90, static_cast<uint8_t>(baseNote + 7), 115 },
            { 30,  0x90, static_cast<uint8_t>(baseNote + 11), 110 },
            { 40,  0x90, static_cast<uint8_t>(baseNote + 14), 105 }
        };

        engine.process(blockL.data(), blockR.data(), 512, params, chordEvents, 5);

        // Run 5 blocks
        for (int b = 0; b < 5; ++b) {
            std::fill(blockL.begin(), blockL.end(), 0.0f);
            std::fill(blockR.begin(), blockR.end(), 0.0f);
            engine.process(blockL.data(), blockR.data(), 512, params, nullptr, 0);
        }

        // Release notes
        const braun::MidiEvent allOff = { 0, 0xB0, 123, 0 };
        engine.process(blockL.data(), blockR.data(), 512, params, &allOff, 1);
    }

    // Now track allocation and ensure zero heap allocs while tail decays
    gAllocationCount.store(0);
    gAllocatedBytes.store(0);
    gTrackAllocations.store(true);

    float tailPeak = 0.0f;
    for (int b = 0; b < 200; ++b) {
        std::fill(blockL.begin(), blockL.end(), 0.0f);
        std::fill(blockR.begin(), blockR.end(), 0.0f);

        // Simultaneously modulate pitch bend and mod wheel
        const braun::MidiEvent modEvents[2] = {
            { 0,   0xB0, 1, static_cast<uint8_t>((b * 3) % 128) },
            { 256, 0xE0, static_cast<uint8_t>((b * 7) % 128), static_cast<uint8_t>((b * 11) % 128) }
        };

        engine.process(blockL.data(), blockR.data(), 512, params, modEvents, 2);

        std::string err;
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(blockL.data(), 512, 1.25f, err), "CS80 Shimmer burst L: " + err);
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(blockR.data(), 512, 1.25f, err), "CS80 Shimmer burst R: " + err);

        for (int s = 0; s < 512; ++s) {
            tailPeak = std::max(tailPeak, std::max(std::abs(blockL[s]), std::abs(blockR[s])));
        }
    }

    gTrackAllocations.store(false);

    CHALLENGER_ASSERT(gAllocationCount.load() == 0, "Hard real-time allocation violation during CS-80 shimmer burst");
    CHALLENGER_ASSERT(tailPeak > 0.001f, "Reverb tail was completely dead");
}

// ============================================================================
// Challenger Test 10 (F17, F18): Concurrent UI Power Reset & Parameter Safety
// ============================================================================
void test_concurrent_ui_power_reset_and_midi_tracking() {
    braun::DspEngine engine;
    engine.prepare(48000.0, 512);

    std::atomic<bool> keepRunning { true };
    std::atomic<bool> resetRequested { false };
    std::atomic<bool> droneTrackMidi { false };

    // Thread 1: UI thread simulating user dragging controls and toggling power
    std::thread uiThread([&]() {
        int iter = 0;
        while (keepRunning.load(std::memory_order_relaxed)) {
            droneTrackMidi.store((iter % 2 == 0), std::memory_order_relaxed);
            if (iter % 10 == 0) {
                resetRequested.store(true, std::memory_order_release);
            }
            ++iter;
            std::this_thread::yield();
        }
    });

    // Thread 2: Real-time Audio Thread
    std::vector<float> bufL(512, 0.0f);
    std::vector<float> bufR(512, 0.0f);
    braun::ParameterSnapshot params;
    params.felt_volume = 0.7f;
    params.master_volume = 0.8f;

    gTrackAllocations.store(true);
    for (int block = 0; block < 1000; ++block) {
        // Audio thread executes deferred reset
        if (resetRequested.exchange(false, std::memory_order_acq_rel)) {
            engine.reset();
        }

        params.drone_track_midi = droneTrackMidi.load(std::memory_order_relaxed);
        std::fill(bufL.begin(), bufL.end(), 0.0f);
        std::fill(bufR.begin(), bufR.end(), 0.0f);

        engine.process(bufL.data(), bufR.data(), 512, params, nullptr, 0);

        std::string err;
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufL.data(), 512, 1.5f, err), "Concurrent audio L: " + err);
        CHALLENGER_ASSERT(checkBufferFiniteAndBounded(bufR.data(), 512, 1.5f, err), "Concurrent audio R: " + err);
    }
    gTrackAllocations.store(false);

    keepRunning.store(false);
    uiThread.join();

    CHALLENGER_ASSERT(gAllocationCount.load() == 0, "Heap allocation detected during concurrent audio processing");
}

// ============================================================================
// Main Challenger Test Runner
// ============================================================================
int main() {
    std::cout << "========================================================\n";
    std::cout << " BRAUN AS 42 Adversarial DSP Challenger Stress Tests   \n";
    std::cout << "========================================================\n";

    RUN_CHALLENGER_TEST(test_extreme_block_sizes);
    RUN_CHALLENGER_TEST(test_multiple_sample_rates);
    RUN_CHALLENGER_TEST(test_rapid_parameter_sweeps_22_params);
    RUN_CHALLENGER_TEST(test_dense_polyphony_and_voice_stealing);
    RUN_CHALLENGER_TEST(test_voice_stealing_release_race_condition);
    RUN_CHALLENGER_TEST(test_tape_delay_feedback_saturation_stress);
    RUN_CHALLENGER_TEST(test_master_limiter_overload_protection);
    RUN_CHALLENGER_TEST(test_realtime_memory_safety_and_allocations);
    RUN_CHALLENGER_TEST(test_shimmer_reverb_cs80_adversarial_burst_and_damping_floor);
    RUN_CHALLENGER_TEST(test_concurrent_ui_power_reset_and_midi_tracking);

    std::cout << "========================================================\n";
    std::cout << "Challenger Summary: " << gTestsPassed << " passed, " << gTestsFailed << " failed.\n";
    std::cout << "========================================================\n";

    return (gTestsFailed == 0) ? 0 : 1;
}
