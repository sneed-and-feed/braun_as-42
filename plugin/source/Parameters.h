#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <memory>

namespace braun {

namespace Parameters {

// Parameter ID constants (APVTS parameter IDs)
inline const juce::ParameterID felt_volume      { "felt_volume", 1 };
inline const juce::ParameterID felt_decay       { "felt_decay", 1 };
inline const juce::ParameterID felt_tone        { "felt_tone", 1 };
inline const juce::ParameterID felt_hammer      { "felt_hammer", 1 };
inline const juce::ParameterID felt_space       { "felt_space", 1 };
inline const juce::ParameterID felt_waveform    { "felt_waveform", 1 };

inline const juce::ParameterID drone1_volume    { "drone1_volume", 1 };
inline const juce::ParameterID drone1_pitch     { "drone1_pitch", 1 };
inline const juce::ParameterID drone1_fold      { "drone1_fold", 1 };
inline const juce::ParameterID drone1_cutoff    { "drone1_cutoff", 1 };
inline const juce::ParameterID drone1_resonance { "drone1_resonance", 1 };
inline const juce::ParameterID drone1_beat      { "drone1_beat", 1 };
inline const juce::ParameterID drone1_detune    { "drone1_detune", 1 };
inline const juce::ParameterID drone1_lfo       { "drone1_lfo", 1 };
inline const juce::ParameterID drone1_waveA     { "drone1_waveA", 1 };
inline const juce::ParameterID drone1_waveB     { "drone1_waveB", 1 };
inline const juce::ParameterID drone1_isSubBass { "drone1_isSubBass", 1 };

inline const juce::ParameterID drone2_volume    { "drone2_volume", 1 };
inline const juce::ParameterID drone2_pitch     { "drone2_pitch", 1 };
inline const juce::ParameterID drone2_fold      { "drone2_fold", 1 };
inline const juce::ParameterID drone2_cutoff    { "drone2_cutoff", 1 };
inline const juce::ParameterID drone2_resonance { "drone2_resonance", 1 };
inline const juce::ParameterID drone2_beat      { "drone2_beat", 1 };
inline const juce::ParameterID drone2_detune    { "drone2_detune", 1 };
inline const juce::ParameterID drone2_lfo       { "drone2_lfo", 1 };
inline const juce::ParameterID drone2_waveA     { "drone2_waveA", 1 };
inline const juce::ParameterID drone2_waveB     { "drone2_waveB", 1 };

inline const juce::ParameterID tape_time        { "tape_time", 1 };
inline const juce::ParameterID tape_feedback    { "tape_feedback", 1 };
inline const juce::ParameterID tape_mix         { "tape_mix", 1 };
inline const juce::ParameterID tape_wow         { "tape_wow", 1 };
inline const juce::ParameterID tape_tone        { "tape_tone", 1 };

inline const juce::ParameterID shimmer_mix      { "shimmer_mix", 1 };
inline const juce::ParameterID shimmer_decay    { "shimmer_decay", 1 };
inline const juce::ParameterID shimmer_damping  { "shimmer_damping", 1 };
inline const juce::ParameterID shimmer_amount   { "shimmer_amount", 1 };
inline const juce::ParameterID shimmer_freeze   { "shimmer_freeze", 1 };

inline const juce::ParameterID master_volume    { "master_volume", 1 };

/**
 * Creates the complete APVTS parameter layout with all synthesizer parameters.
 */
inline juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    // 1. Felt Piano (6 parameters)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_volume, "Felt Piano Volume",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.80f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_decay, "Felt Piano Decay",
        juce::NormalisableRange<float>(0.2f, 3.5f, 0.01f), 1.0f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_tone, "Felt Piano Tone",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.62f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_hammer, "Felt Piano Hammer",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.45f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_space, "Felt Sympathetic Resonance",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.45f));

    params.push_back(std::make_unique<juce::AudioParameterInt>(
        felt_waveform, "Felt Piano Waveform",
        0, 4, 0));

    // 2. Drone 1 (11 parameters)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_volume, "Drone 1 Volume",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.55f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_pitch, "Drone 1 Pitch",
        juce::NormalisableRange<float>(20.0f, 400.0f, 0.1f), 65.41f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_fold, "Drone 1 Wavefold",
        juce::NormalisableRange<float>(0.0f, 100.0f, 0.1f), 45.0f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_cutoff, "Drone 1 Cutoff",
        juce::NormalisableRange<float>(50.0f, 8000.0f, 1.0f, 0.35f), 650.0f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_resonance, "Drone 1 Resonance",
        juce::NormalisableRange<float>(0.5f, 10.0f, 0.1f), 3.5f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_beat, "Drone 1 Beating",
        juce::NormalisableRange<float>(0.0f, 5.0f, 0.01f), 0.35f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_detune, "Drone 1 Detune",
        juce::NormalisableRange<float>(-35.0f, 35.0f, 0.1f), 2.5f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_lfo, "Drone 1 LFO",
        juce::NormalisableRange<float>(0.02f, 1.5f, 0.01f), 0.12f));

    params.push_back(std::make_unique<juce::AudioParameterInt>(
        drone1_waveA, "Drone 1 Wave A",
        0, 6, 2)); // Saw

    params.push_back(std::make_unique<juce::AudioParameterInt>(
        drone1_waveB, "Drone 1 Wave B",
        0, 6, 6)); // Warm

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_isSubBass, "Drone 1 Sub Bass",
        juce::NormalisableRange<float>(0.0f, 1.0f, 1.0f), 0.0f));

    // 3. Drone 2 (10 parameters)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone2_volume, "Drone 2 Volume",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.55f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone2_pitch, "Drone 2 Pitch",
        juce::NormalisableRange<float>(20.0f, 400.0f, 0.1f), 98.00f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone2_fold, "Drone 2 Wavefold",
        juce::NormalisableRange<float>(0.0f, 100.0f, 0.1f), 45.0f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone2_cutoff, "Drone 2 Cutoff",
        juce::NormalisableRange<float>(50.0f, 8000.0f, 1.0f, 0.35f), 850.0f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone2_resonance, "Drone 2 Resonance",
        juce::NormalisableRange<float>(0.5f, 10.0f, 0.1f), 3.5f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone2_beat, "Drone 2 Beating",
        juce::NormalisableRange<float>(0.0f, 5.0f, 0.01f), 0.65f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone2_detune, "Drone 2 Detune",
        juce::NormalisableRange<float>(-35.0f, 35.0f, 0.1f), -3.2f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone2_lfo, "Drone 2 LFO",
        juce::NormalisableRange<float>(0.02f, 1.5f, 0.01f), 0.12f));

    params.push_back(std::make_unique<juce::AudioParameterInt>(
        drone2_waveA, "Drone 2 Wave A",
        0, 6, 3)); // Square

    params.push_back(std::make_unique<juce::AudioParameterInt>(
        drone2_waveB, "Drone 2 Wave B",
        0, 6, 5)); // Triangle

    // 4. Tape Delay (5 parameters)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        tape_time, "Tape Delay Time",
        juce::NormalisableRange<float>(0.10f, 1.50f, 0.001f), 0.46f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        tape_feedback, "Tape Delay Feedback",
        juce::NormalisableRange<float>(0.0f, 0.90f, 0.01f), 0.55f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        tape_mix, "Tape Delay Mix",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.40f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        tape_wow, "Tape Delay Wow",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.45f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        tape_tone, "Tape Delay Tone",
        juce::NormalisableRange<float>(1000.0f, 10000.0f, 1.0f), 3600.0f));

    // 5. Shimmer Reverb (4 parameters)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        shimmer_mix, "Shimmer Reverb Mix",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.45f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        shimmer_decay, "Shimmer Reverb Decay",
        juce::NormalisableRange<float>(0.5f, 20.0f, 0.1f), 8.5f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        shimmer_damping, "Shimmer Reverb Damping",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.60f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        shimmer_amount, "Shimmer Reverb Amount",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.45f));

    params.push_back(std::make_unique<juce::AudioParameterBool>(
        shimmer_freeze, "Shimmer Reverb Freeze",
        false));

    // 6. Master (1 parameter)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        master_volume, "Master Volume",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.80f));

    return { params.begin(), params.end() };
}

} // namespace Parameters

} // namespace braun
