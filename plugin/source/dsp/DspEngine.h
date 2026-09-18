#pragma once

#include "DspMath.h"
#include "Wavetables.h"
#include "FeltPianoDsp.h"
#include "DroneVoiceDsp.h"
#include "TapeDelayDsp.h"
#include "ShimmerReverbDsp.h"
#include "MasterLimiterDsp.h"
#include <cstdint>
#include <vector>
#include <bitset>

#if defined(JUCE_VERSION) || (defined(__has_include) && __has_include(<juce_audio_basics/juce_audio_basics.h>))
#include <juce_audio_basics/juce_audio_basics.h>
#define BRAUN_HAS_JUCE 1
#endif

namespace braun {

// ============================================================================
// ParameterSnapshot: Plain-Old-Data snapshot of all synthesizer parameters
// ============================================================================
struct ParameterSnapshot {
    // Felt Piano parameters
    float felt_volume { 0.80f };
    float felt_decay { 1.0f };
    float felt_tone { 0.62f };
    float felt_hammer { 0.45f };
    float felt_space { 0.45f };       // Sympathetic string resonance level
    int felt_waveform { 0 };          // 0: Felt, 1: Sine, 2: Saw, 3: Square, 4: CS80

    // Drone 1 parameters
    float drone1_volume { 0.55f };
    float drone1_pitch { 65.41f };     // C2
    float drone1_fold { 45.0f };
    float drone1_cutoff { 650.0f };
    float drone1_resonance { 3.5f };
    float drone1_beat { 0.35f };
    float drone1_detune { 2.5f };
    float drone1_lfo { 0.12f };
    float drone1_lfo_depth { 180.0f };
    int drone1_waveA { 2 };           // Saw
    int drone1_waveB { 6 };           // Warm
    bool drone1_isSubBass { false };
    bool drone1_active { false };

    // Drone 2 parameters
    float drone2_volume { 0.55f };
    float drone2_pitch { 98.00f };     // G2
    float drone2_fold { 45.0f };
    float drone2_cutoff { 850.0f };
    float drone2_resonance { 3.5f };
    float drone2_beat { 0.65f };
    float drone2_detune { -3.2f };
    float drone2_lfo { 0.12f };
    float drone2_lfo_depth { 180.0f };
    int drone2_waveA { 3 };           // Square
    int drone2_waveB { 5 };           // Triangle
    bool drone2_active { false };

    // Drone MIDI Note Tracking (follows piano roll notes in bass/sub octave with note-off gating)
    bool drone_track_midi { false };

    // Tape Delay parameters
    float tape_time { 0.46f };
    float tape_feedback { 0.55f };
    float tape_mix { 0.40f };
    float tape_wow { 0.45f };
    float tape_tone { 3600.0f };

    // Shimmer Reverb parameters
    float shimmer_mix { 0.45f };
    float shimmer_decay { 8.5f };
    float shimmer_damping { 0.60f };
    float shimmer_amount { 0.45f };
    bool shimmer_freeze { false };

    // Master Bus parameters
    float master_volume { 0.80f };
};

// ============================================================================
// Standard MIDI Event Representation
// ============================================================================
struct MidiEvent {
    int sampleOffset { 0 };
    uint8_t status { 0 };
    uint8_t data1 { 0 };
    uint8_t data2 { 0 };
};

// ============================================================================
// DspEngine: Master Container coordinating All Voices, Effects, and Master Bus
// ============================================================================
class DspEngine {
public:
    DspEngine();
    ~DspEngine() = default;

    // Hard real-time initialization and allocation
    void prepare(double sampleRate, int maxBlockSize);

    // Reset internal states, clear delays and voice pools
    void reset() noexcept;

    // Native audio block processing callback
    void process(float* left, float* right, int numSamples,
                 const ParameterSnapshot& params,
                 const MidiEvent* midiEvents, int numMidiEvents) noexcept;

#if defined(BRAUN_HAS_JUCE)
    // JUCE AudioBuffer / MidiBuffer adapter
    void process(juce::AudioBuffer<float>& buffer,
                 juce::MidiBuffer& midiMessages,
                 const ParameterSnapshot& params) noexcept;
#endif

    // Direct synthesizer access for inspection and testing
    FeltPianoSynthesizer& getFeltPiano() noexcept { return mFeltPiano; }
    void setVoiceStealPolicy(VoiceStealPolicy policy) noexcept { mFeltPiano.setVoiceStealPolicy(policy); }
    VoiceStealPolicy getVoiceStealPolicy() const noexcept { return mFeltPiano.getVoiceStealPolicy(); }
    SolarDroneVoice& getDrone1() noexcept { return mDrone1; }
    SolarDroneVoice& getDrone2() noexcept { return mDrone2; }
    TapeDelayDsp& getTapeDelay() noexcept { return mTapeDelay; }
    ShimmerReverbDsp& getShimmerReverb() noexcept { return mShimmerReverb; }
    MasterLimiterDsp& getMasterLimiter() noexcept { return mMasterLimiter; }
    const WavetableBank& getWavetables() const noexcept { return mWavetables; }

    // Drone MIDI Pitch Tracking Controls
    void setDroneTrackMidi(bool track) noexcept { mDroneTrackMidi = track; }
    bool getDroneTrackMidi() const noexcept { return mDroneTrackMidi; }
    int getLastTrackedMidiNote() const noexcept { return mLastTrackedMidiNote; }
    float getTrackedDrone1Freq() const noexcept { return mTrackedDrone1Freq; }
    float getTrackedDrone2Freq() const noexcept { return mTrackedDrone2Freq; }

    // Drone MIDI Note-Off Gating State & Helpers
    float getDroneGateGain() const noexcept { return mDroneGateGain; }
    bool hasActiveMidiNotes() const noexcept {
        return mHeldKeys.any() || (mSustainPedalDown && mLatchedKeys.any());
    }

private:
    void handleMidiEvent(const MidiEvent& event) noexcept;

    double mSampleRate { 48000.0 };
    int mMaxBlockSize { 512 };

    WavetableBank mWavetables;
    FeltPianoSynthesizer mFeltPiano;
    SolarDroneVoice mDrone1;
    SolarDroneVoice mDrone2;
    TapeDelayDsp mTapeDelay;
    ShimmerReverbDsp mShimmerReverb;
    MasterLimiterDsp mMasterLimiter;

    // Pre-allocated scratch buffers for block summing
    std::vector<float> mScratchPianoL;
    std::vector<float> mScratchPianoR;

    // MIDI Voice Latching and State
    bool mSustainPedalDown { false };
    std::bitset<128> mHeldKeys;
    std::bitset<128> mLatchedKeys;
    float mCurrentPitchBendCents { 0.0f };
    float mCurrentModWheel { 0.0f };

    // Drone Note Tracking State
    bool mDroneTrackMidi { false };
    int mLastTrackedMidiNote { -1 };
    float mTrackedDrone1Freq { 65.41f };
    float mTrackedDrone2Freq { 98.00f };

    // Drone Note-Off Gating in MIDI Track Mode (pop-free attack, 200ms release envelope)
    float mDroneGateGain { 0.0f };
    float mDroneGateAttackCoeff { 0.001f };
    float mDroneGateReleaseCoeff { 0.0001f };
};

} // namespace braun
