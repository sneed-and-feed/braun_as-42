#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#if JUCE_WEB_BROWSER
#include "web/WebResourceManager.h"
#endif
#include "LookAndFeel/BraunLookAndFeel.h"
#include "Parameters.h"
#include <atomic>
#include <vector>
#include <memory>

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
    void mouseDown(const juce::MouseEvent& e) override;

    // juce::AudioProcessorValueTreeState::Listener callback
    void parameterChanged(const juce::String& parameterID, float newValue) override;

    // Native vs WebView GUI switching
    bool isNativeModeActive() const noexcept { return useNativeUI; }
    void setNativeMode(bool native);

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
#if JUCE_WEB_BROWSER
    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);
#endif

    static constexpr size_t kNumTrackedParams = 38;

private:
    void timerCallback() override;

#if JUCE_WEB_BROWSER
    static juce::WebBrowserComponent::Options createWebOptions(BRAUN_AS42AudioProcessorEditor& editor);
#endif

    BRAUN_AS42AudioProcessor& processorRef;
#if JUCE_WEB_BROWSER
    braun::WebResourceManager resourceManager;
    juce::WebBrowserComponent webComponent;
#endif
    braun::BraunLookAndFeel braunLookAndFeel;
    bool useNativeUI { false };
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

    // Native JUCE UI Presentation Layer: Dieter Rams Vector Graphics
    void drawBraunChassis(juce::Graphics& g, juce::Rectangle<int> bounds);
    void drawCrtDisplay(juce::Graphics& g, juce::Rectangle<int> bounds);

    // Native Header & Utility Controls
    juce::TextButton viewModeButton;
    juce::TextButton powerButton;
    juce::TextButton themeButton;
    juce::TextButton recordButton;

    // Presets
    juce::Label presetLabel;
    juce::ComboBox presetComboBox;
    juce::TextButton prevPresetBtn;
    juce::TextButton nextPresetBtn;

    // Performance Strip Controls
    juce::TextButton chordTriggerBtn;
    juce::TextButton impulseTriggerBtn;
    juce::TextButton drone1ActiveBtn;
    juce::TextButton drone2ActiveBtn;
    juce::TextButton droneTrackMidiBtn;

    // Parameter Attachment Slots
    struct KnobSlot {
        juce::String paramId;
        juce::Slider slider;
        juce::Label nameLabel;
        std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> attachment;
    };
    std::vector<std::unique_ptr<KnobSlot>> knobSlots;

    struct ButtonSlot {
        juce::String paramId;
        juce::ToggleButton button;
        std::unique_ptr<juce::AudioProcessorValueTreeState::ButtonAttachment> attachment;
    };
    std::vector<std::unique_ptr<ButtonSlot>> buttonSlots;

    struct ComboSlot {
        juce::String paramId;
        juce::Label label;
        juce::ComboBox comboBox;
        std::unique_ptr<juce::AudioProcessorValueTreeState::ComboBoxAttachment> attachment;
    };
    std::vector<std::unique_ptr<ComboSlot>> comboSlots;

    void setupNativeControls();
    void updateNativeControlLayout();
    void updateNativeControlVisibility();
    void showKnobContextMenu(KnobSlot& slot, juce::Point<int> screenPos);

    KnobSlot* findKnob(const juce::String& id);
    ButtonSlot* findButton(const juce::String& id);
    ComboSlot* findCombo(const juce::String& id);

    static juce::File getSettingsFile();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BRAUN_AS42AudioProcessorEditor)
};
