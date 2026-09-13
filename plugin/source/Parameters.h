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

inline const juce::ParameterID drone1_volume    { "drone1_volume", 1 };
inline const juce::ParameterID drone1_pitch     { "drone1_pitch", 1 };
inline const juce::ParameterID drone1_fold      { "drone1_fold", 1 };
inline const juce::ParameterID drone1_cutoff    { "drone1_cutoff", 1 };
inline const juce::ParameterID drone1_resonance { "drone1_resonance", 1 };

inline const juce::ParameterID drone2_volume    { "drone2_volume", 1 };
inline const juce::ParameterID drone2_pitch     { "drone2_pitch", 1 };
inline const juce::ParameterID drone2_fold      { "drone2_fold", 1 };
inline const juce::ParameterID drone2_cutoff    { "drone2_cutoff", 1 };
inline const juce::ParameterID drone2_resonance { "drone2_resonance", 1 };

inline const juce::ParameterID tape_time        { "tape_time", 1 };
inline const juce::ParameterID tape_feedback    { "tape_feedback", 1 };
inline const juce::ParameterID tape_mix         { "tape_mix", 1 };
inline const juce::ParameterID tape_wow         { "tape_wow", 1 };

inline const juce::ParameterID shimmer_mix      { "shimmer_mix", 1 };
inline const juce::ParameterID shimmer_decay    { "shimmer_decay", 1 };

inline const juce::ParameterID master_volume    { "master_volume", 1 };

/**
 * Creates the complete APVTS parameter layout with all 22 synthesizer parameters.
 * Ranges and default values correspond directly to Section 6.4 of Explorer 3 analysis.
 */
inline juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    // 1. Felt Piano (5 parameters)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_volume, "Felt Piano Volume",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.80f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_decay, "Felt Piano Decay",
        juce::NormalisableRange<float>(0.5f, 2.5f, 0.01f), 1.10f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_tone, "Felt Piano Tone",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.62f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_hammer, "Felt Piano Hammer",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.45f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        felt_space, "Felt Sympathetic Resonance",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.45f));

    // 2. Drone 1 (5 parameters)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone1_volume, "Drone 1 Volume",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.70f));

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

    // 3. Drone 2 (5 parameters)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        drone2_volume, "Drone 2 Volume",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.70f));

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

    // 4. Tape Delay (4 parameters)
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

    // 5. Shimmer Reverb (2 parameters)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        shimmer_mix, "Shimmer Reverb Mix",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.45f));

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        shimmer_decay, "Shimmer Reverb Decay",
        juce::NormalisableRange<float>(0.5f, 20.0f, 0.1f), 8.0f));

    // 6. Master (1 parameter)
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        master_volume, "Master Volume",
        juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.80f));

    return { params.begin(), params.end() };
}

} // namespace Parameters

} // namespace braun
