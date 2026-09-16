#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include "web/WebResourceManager.h"

class BRAUN_AS42AudioProcessorEditor : public juce::AudioProcessorEditor,
                                       public juce::AudioProcessorValueTreeState::Listener,
                                       private juce::Timer
{
public:
    explicit BRAUN_AS42AudioProcessorEditor(BRAUN_AS42AudioProcessor&);
    ~BRAUN_AS42AudioProcessorEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;
    void parentHierarchyChanged() override;

    // juce::AudioProcessorValueTreeState::Listener callback
    void parameterChanged(const juce::String& parameterID, float newValue) override;

    // Web integration helpers
    void handleParamChangeFromWeb(const juce::var& data);
    void handleNoteOnFromWeb(const juce::var& data);
    void handleNoteOffFromWeb(const juce::var& data);
    void handleAllNotesOffFromWeb(const juce::var& data);
    void handlePitchBendFromWeb(const juce::var& data);
    void handleStartRecordingFromWeb();
    void handleStopRecordingFromWeb();

    void sendParameterUpdateToWeb(const juce::String& paramID, float newValue);
    void sendPowerUpdateToWeb(bool isPoweredOn);
    void sendDroneActiveUpdateToWeb(int droneId, bool active);
    void sendDroneTrackUpdateToWeb(bool track);
    void sendRecordingStateUpdateToWeb(bool isRecording);
    void syncAllParametersToWeb();
    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);

    static constexpr size_t kNumTrackedParams = 38;

private:
    void timerCallback() override;

    static juce::WebBrowserComponent::Options createWebOptions(BRAUN_AS42AudioProcessorEditor& editor);

    BRAUN_AS42AudioProcessor& processorRef;
    braun::WebResourceManager resourceManager;
    juce::WebBrowserComponent webComponent;
    bool initialSyncDone { false };

    // Lock-free parameter change coalescing to avoid flooding Win32 message loop
    std::atomic<float> pendingParamValues[kNumTrackedParams] {};
    std::atomic<bool> paramDirty[kNumTrackedParams] {};

    bool hwndStylesConfigured { false };
    int hwndCheckCounter { 0 };
    void ensureHwndStyles();

    int silentFrameCounter { 0 };
    void sendScopeDataToWeb();

    void registerParameterListeners();
    void unregisterParameterListeners();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BRAUN_AS42AudioProcessorEditor)
};
