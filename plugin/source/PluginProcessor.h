#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "dsp/DspEngine.h"
#include "Parameters.h"

class BRAUN_AS42AudioProcessor : public juce::AudioProcessor
{
public:
    BRAUN_AS42AudioProcessor();
    ~BRAUN_AS42AudioProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;

    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override;

    const juce::String getName() const override;

    bool acceptsMidi() const override;
    bool producesMidi() const override;
    bool isMidiEffect() const override;
    double getTailLengthSeconds() const override;

    int getNumPrograms() override;
    int getCurrentProgram() override;
    void setCurrentProgram(int index) override;
    const juce::String getProgramName(int index) override;
    void changeProgramName(int index, const juce::String& newName) override;

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState& getAPVTS() noexcept { return apvts; }
    braun::DspEngine& getDspEngine() noexcept { return dspEngine; }

    void setPoweredOn(bool on) noexcept;
    bool getPoweredOn() const noexcept;
    bool consumePowerStateDirty() noexcept;

    void setDrone1Active(bool active) noexcept;
    bool getDrone1Active() const noexcept;
    bool consumeDrone1StateDirty() noexcept;

    void setDrone2Active(bool active) noexcept;
    bool getDrone2Active() const noexcept;
    bool consumeDrone2StateDirty() noexcept;

private:
    juce::AudioProcessorValueTreeState apvts;
    braun::DspEngine dspEngine;

    // Power and generative voice active states (silent on startup until triggered or powered on)
    std::atomic<bool> isPoweredOn { false };
    std::atomic<bool> powerStateDirty { false };
    std::atomic<bool> drone1Active { false };
    std::atomic<bool> drone1StateDirty { false };
    std::atomic<bool> drone2Active { false };
    std::atomic<bool> drone2StateDirty { false };

    // Cached raw atomic parameter pointers for lock-free, zero-overhead audio thread reads
    std::atomic<float>* paramFeltVolume { nullptr };
    std::atomic<float>* paramFeltDecay { nullptr };
    std::atomic<float>* paramFeltTone { nullptr };
    std::atomic<float>* paramFeltHammer { nullptr };
    std::atomic<float>* paramFeltSpace { nullptr };

    std::atomic<float>* paramDrone1Volume { nullptr };
    std::atomic<float>* paramDrone1Pitch { nullptr };
    std::atomic<float>* paramDrone1Fold { nullptr };
    std::atomic<float>* paramDrone1Cutoff { nullptr };
    std::atomic<float>* paramDrone1Resonance { nullptr };

    std::atomic<float>* paramDrone2Volume { nullptr };
    std::atomic<float>* paramDrone2Pitch { nullptr };
    std::atomic<float>* paramDrone2Fold { nullptr };
    std::atomic<float>* paramDrone2Cutoff { nullptr };
    std::atomic<float>* paramDrone2Resonance { nullptr };

    std::atomic<float>* paramTapeTime { nullptr };
    std::atomic<float>* paramTapeFeedback { nullptr };
    std::atomic<float>* paramTapeMix { nullptr };
    std::atomic<float>* paramTapeWow { nullptr };

    std::atomic<float>* paramShimmerMix { nullptr };
    std::atomic<float>* paramShimmerDecay { nullptr };

    std::atomic<float>* paramMasterVolume { nullptr };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BRAUN_AS42AudioProcessor)
};
