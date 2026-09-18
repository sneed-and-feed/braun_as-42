#include "PluginEditor.h"
#include <juce_data_structures/juce_data_structures.h>
#include <cstdlib>
#include <cmath>
#if JUCE_WINDOWS
#include <windows.h>
#endif

namespace {

struct ParamInfo {
    const char* apvtsId;
    const char* webId;
    float webScale; // factor to convert web value to apvts value
};

static const ParamInfo kParamMap[] = {
    // 1. Felt Piano (6)
    { "felt_volume",      "feltLevel",     0.01f },
    { "felt_decay",       "feltDecay",     1.0f  },
    { "felt_tone",        "feltTone",      0.01f },
    { "felt_hammer",      "feltHammer",    0.01f },
    { "felt_space",       "feltSymp",      0.01f },
    { "felt_waveform",    "feltWaveform",  1.0f  },

    // 2. Drone 1 (11)
    { "drone1_volume",    "drone1Vol",     0.01f },
    { "drone1_pitch",     "drone1Pitch",   1.0f  },
    { "drone1_fold",      "drone1Fold",    1.0f  },
    { "drone1_cutoff",    "drone1Cutoff",  1.0f  },
    { "drone1_resonance", "drone1Res",     1.0f  },
    { "drone1_beat",      "drone1Beat",    1.0f  },
    { "drone1_detune",    "drone1Detune",  1.0f  },
    { "drone1_lfo",       "drone1Lfo",     1.0f  },
    { "drone1_waveA",     "drone1WaveA",   1.0f  },
    { "drone1_waveB",     "drone1WaveB",   1.0f  },
    { "drone1_isSubBass", "drone1SubBass", 1.0f  },

    // 3. Drone 2 (10)
    { "drone2_volume",    "drone2Vol",     0.01f },
    { "drone2_pitch",     "drone2Pitch",   1.0f  },
    { "drone2_fold",      "drone2Fold",    1.0f  },
    { "drone2_cutoff",    "drone2Cutoff",  1.0f  },
    { "drone2_resonance", "drone2Res",     1.0f  },
    { "drone2_beat",      "drone2Beat",    1.0f  },
    { "drone2_detune",    "drone2Detune",  1.0f  },
    { "drone2_lfo",       "drone2Lfo",     1.0f  },
    { "drone2_waveA",     "drone2WaveA",   1.0f  },
    { "drone2_waveB",     "drone2WaveB",   1.0f  },

    // 4. Tape Delay (5)
    { "tape_time",        "delayTime",     0.001f }, // 460ms -> 0.46s
    { "tape_feedback",    "delayFeedback", 0.01f },
    { "tape_mix",         "delayWet",      0.01f },
    { "tape_wow",         "delayWow",      0.01f },
    { "tape_tone",        "delayTone",     1.0f  },

    // 5. Shimmer Reverb (5)
    { "shimmer_mix",      "reverbWet",     0.01f },
    { "shimmer_decay",    "reverbDecay",   1.0f  },
    { "shimmer_damping",  "reverbDamping", 0.01f },
    { "shimmer_amount",   "reverbShimmer", 0.01f },
    { "shimmer_freeze",   "reverbFreeze",  1.0f  },

    // 6. Master Bus (1)
    { "master_volume",    "masterVol",     0.01f }
};

static_assert(std::size(kParamMap) == BRAUN_AS42AudioProcessorEditor::kNumTrackedParams,
              "kParamMap size must match pendingParamValues array size");

static int waveformFromString(const juce::var& v)
{
    if (v.isString())
    {
        const juce::String s = v.toString().trim().toLowerCase();
        if (s == "felt") return 0;
        if (s == "sine" || s == "sin") return 1;
        if (s == "saw" || s == "sawtooth") return 2;
        if (s == "square" || s == "sqr") return 3;
        if (s == "cs80" || s == "cs-80" || s == "vangelis") return 4;
        if (s == "triangle" || s == "tri") return 5;
        if (s == "warm") return 6;
        return s.getIntValue();
    }
    return static_cast<int>(v);
}

} // namespace

juce::WebBrowserComponent::Options BRAUN_AS42AudioProcessorEditor::createWebOptions(BRAUN_AS42AudioProcessorEditor& editor)
{
#if JUCE_WINDOWS
    // Configure WebView2 Chromium flags for host DAW embedding (FL Studio, Ableton, Reaper, etc.):
    // - Mute browser audio output (C++ DSP engine handles all audio synthesis)
    // - Disable Web MIDI in Chromium (prevents WinMM device contention with DAW MIDI inputs)
    // - Disable background Chromium features that create unneeded threads / network queries
    // - Disable CalculateNativeWinOcclusion to eliminate global SetWinEventHook desktop dragging lag
    // - Disable backgrounding and timer throttling for occluded windows to prevent dirty rect stalls
    _wputenv_s(
        L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        L"--mute-audio "
        L"--disable-audio-output "
        L"--disable-web-midi "
        L"--disable-background-timer-throttling "
        L"--disable-backgrounding-occluded-windows "
        L"--disable-renderer-backgrounding "
        L"--disable-features=Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions,CalculateNativeWinOcclusion"
    );
#endif

    auto options = juce::WebBrowserComponent::Options{}
#if JUCE_WINDOWS
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            juce::WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(juce::File::getSpecialLocation(juce::File::SpecialLocationType::tempDirectory).getChildFile("BraunAS42_WebView2"))
                .withBackgroundColour(juce::Colour(0xff121414)))
#endif
        .withUserScript("window.__IS_JUCE__ = true;")
        .withNativeIntegrationEnabled()
        .withResourceProvider([&editor](const juce::String& url) {
            return editor.getResource(url);
        })
        .withEventListener("paramChange", [&editor](const juce::var& data) {
            editor.handleParamChangeFromWeb(data);
        })
        .withEventListener("noteOn", [&editor](const juce::var& data) {
            editor.handleNoteOnFromWeb(data);
        })
        .withEventListener("noteOff", [&editor](const juce::var& data) {
            editor.handleNoteOffFromWeb(data);
        })
        .withEventListener("allNotesOff", [&editor](const juce::var& data) {
            editor.handleAllNotesOffFromWeb(data);
        })
        .withEventListener("pitchBend", [&editor](const juce::var& data) {
            editor.handlePitchBendFromWeb(data);
        })
        .withEventListener("startRecording", [&editor](const juce::var& /*data*/) {
            editor.handleStartRecordingFromWeb();
        })
        .withEventListener("stopRecording", [&editor](const juce::var& /*data*/) {
            editor.handleStopRecordingFromWeb();
        })
        .withEventListener("showContextMenu", [&editor](const juce::var& data) {
            if (data.isObject())
            {
                const juce::String id = data.getProperty("id", "").toString();
                const int x = static_cast<int>(data.getProperty("x", 0));
                const int y = static_cast<int>(data.getProperty("y", 0));
                if (auto* slot = editor.findKnob(id))
                {
                    editor.showKnobContextMenu(*slot, { x, y });
                }
            }
        });

    return options;
}

BRAUN_AS42AudioProcessorEditor::BRAUN_AS42AudioProcessorEditor(BRAUN_AS42AudioProcessor& p)
    : AudioProcessorEditor(&p),
      processorRef(p),
      webComponent(createWebOptions(*this))
{
    setLookAndFeel(&braunLookAndFeel);
    setOpaque(true);
    webComponent.setOpaque(true);

    setupNativeControls();
    addAndMakeVisible(webComponent);

    // Restore persistent UI mode (Web UI vs Native JUCE UI)
    bool loadedMode = false;
    {
        auto settingsFile = getSettingsFile();
        if (settingsFile.existsAsFile())
        {
            juce::PropertiesFile::Options opts;
            opts.storageFormat = juce::PropertiesFile::storeAsXML;
            juce::PropertiesFile props(settingsFile, opts);
            loadedMode = props.getBoolValue("useNativeUI", false);
        }
    }
    useNativeUI = loadedMode;
    setNativeMode(useNativeUI);

    registerParameterListeners();

    setSize(1240, 780);
    setResizable(true, true);
    setResizeLimits(960, 600, 2560, 1440);

    startTimerHz(30);

    webComponent.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}

BRAUN_AS42AudioProcessorEditor::~BRAUN_AS42AudioProcessorEditor()
{
    setLookAndFeel(nullptr);
    stopTimer();
    removeMouseListener(this);
    unregisterParameterListeners();
    for (auto& slot : knobSlots)
    {
        if (slot != nullptr)
        {
            slot->slider.removeMouseListener(this);
            slot->nameLabel.removeMouseListener(this);
        }
    }
    knobSlots.clear();
    buttonSlots.clear();
    comboSlots.clear();
}

void BRAUN_AS42AudioProcessorEditor::paint(juce::Graphics& g)
{
    if (useNativeUI)
    {
        drawBraunChassis(g, getLocalBounds());
    }
    else
    {
        g.fillAll(juce::Colour(0xff121414));
    }
}

void BRAUN_AS42AudioProcessorEditor::resized()
{
    if (!useNativeUI)
        webComponent.setBounds(getLocalBounds());
    else
        webComponent.setBounds(0, 0, 0, 0);
    updateNativeControlLayout();
}

void BRAUN_AS42AudioProcessorEditor::parentHierarchyChanged()
{
    AudioProcessorEditor::parentHierarchyChanged();
    hwndStylesConfigured = false;
    if (!useNativeUI)
    {
        ensureHwndStyles();
    }
}

void BRAUN_AS42AudioProcessorEditor::ensureHwndStyles()
{
#if JUCE_WINDOWS
    if (useNativeUI)
        return;

    if (auto* peer = getPeer())
    {
        HWND hwnd = static_cast<HWND>(peer->getNativeHandle());
        if (hwnd == nullptr || !::IsWindow(hwnd))
            return;

        // Apply WS_CLIPCHILDREN | WS_CLIPSIBLINGS to our own plugin HWND only.
        // We NEVER touch ancestor/parent windows to avoid corrupting FL Studio or host DAW title bars/frames.
        LONG_PTR style = ::GetWindowLongPtr(hwnd, GWL_STYLE);
        if ((style & (WS_CLIPCHILDREN | WS_CLIPSIBLINGS)) != (WS_CLIPCHILDREN | WS_CLIPSIBLINGS))
        {
            ::SetWindowLongPtr(hwnd, GWL_STYLE, style | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
        }

        // Also ensure child windows (WebView2 host HWNDs and render widget) enforce clipping
        int childCount = 0;
        ::EnumChildWindows(hwnd, [](HWND child, LPARAM lParam) -> BOOL {
            if (child == nullptr || !::IsWindow(child))
                return TRUE;
            auto* count = reinterpret_cast<int*>(lParam);
            (*count)++;
            LONG_PTR childStyle = ::GetWindowLongPtr(child, GWL_STYLE);
            if ((childStyle & (WS_CLIPCHILDREN | WS_CLIPSIBLINGS)) != (WS_CLIPCHILDREN | WS_CLIPSIBLINGS))
            {
                ::SetWindowLongPtr(child, GWL_STYLE, childStyle | WS_CLIPCHILDREN | WS_CLIPSIBLINGS);
            }
            return TRUE;
        }, reinterpret_cast<LPARAM>(&childCount));

        if (childCount > 0)
            hwndStylesConfigured = true;
    }
#endif
}

void BRAUN_AS42AudioProcessorEditor::parameterChanged(const juce::String& parameterID, float newValue)
{
    // Coalesce parameter changes into atomic array without calling MessageManager::callAsync
    // to prevent flooding the Win32 message loop during rapid host automation.
    for (size_t i = 0; i < std::size(kParamMap); ++i)
    {
        if (parameterID == kParamMap[i].apvtsId)
        {
            pendingParamValues[i].store(newValue, std::memory_order_relaxed);
            paramDirty[i].store(true, std::memory_order_relaxed);
            break;
        }
    }
}

void BRAUN_AS42AudioProcessorEditor::sendParameterUpdateToWeb(const juce::String& paramID, float newValue)
{
    for (const auto& item : kParamMap)
    {
        if (paramID == item.apvtsId)
        {
            const float webValue = (item.webScale != 0.0f) ? (newValue / item.webScale) : newValue;

            // Emit to web UI under the JavaScript knob ID
            auto* obj1 = new juce::DynamicObject();
            obj1->setProperty("id", item.webId);
            obj1->setProperty("value", webValue);
            webComponent.emitEventIfBrowserIsVisible("paramUpdate", juce::var(obj1));

            // Also emit under secondary alias if applicable
            if (juce::String(item.webId) == "drone1Vol")
            {
                auto* objAlias = new juce::DynamicObject();
                objAlias->setProperty("id", "drone1Level");
                objAlias->setProperty("value", webValue);
                webComponent.emitEventIfBrowserIsVisible("paramUpdate", juce::var(objAlias));
            }
            else if (juce::String(item.webId) == "drone2Vol")
            {
                auto* objAlias = new juce::DynamicObject();
                objAlias->setProperty("id", "drone2Level");
                objAlias->setProperty("value", webValue);
                webComponent.emitEventIfBrowserIsVisible("paramUpdate", juce::var(objAlias));
            }
            return;
        }
    }
}

void BRAUN_AS42AudioProcessorEditor::timerCallback()
{
    if (!useNativeUI && webComponent.isVisible())
    {
        if (!hwndStylesConfigured || ++hwndCheckCounter >= 25)
        {
            hwndCheckCounter = 0;
            ensureHwndStyles();
        }

        if (!initialSyncDone && webComponent.isVisible())
        {
            syncAllParametersToWeb();
            initialSyncDone = true;
        }

        if (processorRef.consumePowerStateDirty())
        {
            sendPowerUpdateToWeb(processorRef.getPoweredOn());
        }
        if (processorRef.consumeDrone1StateDirty())
        {
            sendDroneActiveUpdateToWeb(1, processorRef.getDrone1Active());
        }
        if (processorRef.consumeDrone2StateDirty())
        {
            sendDroneActiveUpdateToWeb(2, processorRef.getDrone2Active());
        }
        if (processorRef.consumeDroneTrackMidiDirty())
        {
            sendDroneTrackUpdateToWeb(processorRef.getDroneTrackMidi());
        }
        if (processorRef.consumeRecordingSavedDirty())
        {
            auto* obj = new juce::DynamicObject();
            obj->setProperty("path", processorRef.getLastRecordedFile().getFullPathName());
            webComponent.emitEventIfBrowserIsVisible("recordingSaved", juce::var(obj));
        }

        // Coalesced dirty parameter dispatch at a smooth, stable 30 Hz
        for (size_t i = 0; i < std::size(kParamMap); ++i)
        {
            if (paramDirty[i].exchange(false, std::memory_order_relaxed))
            {
                const float val = pendingParamValues[i].load(std::memory_order_relaxed);
                sendParameterUpdateToWeb(kParamMap[i].apvtsId, val);
            }
        }

        sendScopeDataToWeb();
    }
    else
    {
        // Native UI: update status button texts and states
        powerButton.setButtonText(processorRef.getPoweredOn() ? "POWER ON" : "STANDBY");
        powerButton.setToggleState(processorRef.getPoweredOn(), juce::dontSendNotification);

        recordButton.setButtonText(processorRef.isRecording() ? "RECORDING..." : "REC WAV");
        recordButton.setToggleState(processorRef.isRecording(), juce::dontSendNotification);

        drone1ActiveBtn.setToggleState(processorRef.getDrone1Active(), juce::dontSendNotification);
        drone1ActiveBtn.setButtonText(processorRef.getDrone1Active() ? "DRONE 1 [ON]" : "DRONE 1 [OFF]");

        drone2ActiveBtn.setToggleState(processorRef.getDrone2Active(), juce::dontSendNotification);
        drone2ActiveBtn.setButtonText(processorRef.getDrone2Active() ? "DRONE 2 [ON]" : "DRONE 2 [OFF]");

        droneTrackMidiBtn.setToggleState(processorRef.getDroneTrackMidi(), juce::dontSendNotification);
        droneTrackMidiBtn.setButtonText(processorRef.getDroneTrackMidi() ? "MIDI TRACK [ON]" : "MIDI TRACK [OFF]");

        const int currentProg = processorRef.getCurrentProgram();
        if (presetComboBox.getSelectedId() != currentProg + 1)
        {
            presetComboBox.setSelectedId(currentProg + 1, juce::dontSendNotification);
        }

        // Repaint CRT scope display area
        auto crtArea = getLocalBounds().withTrimmedTop(54).removeFromTop(120).reduced(16, 4);
        repaint(crtArea);
    }
}

void BRAUN_AS42AudioProcessorEditor::sendScopeDataToWeb()
{
    if (!processorRef.getPoweredOn() || !webComponent.isVisible())
        return;

    constexpr int kSamples = 512;
    float sL[kSamples];
    float sR[kSamples];
    processorRef.getScopeSamples(sL, sR, kSamples);

    bool hasSignal = false;
    for (int i = 0; i < kSamples; ++i)
    {
        if (std::abs(sL[i]) > 0.002f || std::abs(sR[i]) > 0.002f)
        {
            hasSignal = true;
            break;
        }
    }

    if (!hasSignal)
    {
        if (++silentFrameCounter > 4)
        {
            // During prolonged silence, throttle IPC dispatch to ~2 Hz
            if (silentFrameCounter % 12 != 0)
                return;
        }
    }
    else
    {
        silentFrameCounter = 0;
    }

    uint8_t bytesL[kSamples];
    uint8_t bytesR[kSamples];
    for (int i = 0; i < kSamples; ++i)
    {
        const float sampL = std::clamp(sL[i], -1.0f, 1.0f);
        const float sampR = std::clamp(sR[i], -1.0f, 1.0f);
        bytesL[i] = static_cast<uint8_t>(std::clamp(static_cast<int>(std::round(128.0f + sampL * 127.0f)), 0, 255));
        bytesR[i] = static_cast<uint8_t>(std::clamp(static_cast<int>(std::round(128.0f + sampR * 127.0f)), 0, 255));
    }

    auto* obj = new juce::DynamicObject();
    obj->setProperty("l", juce::Base64::toBase64(bytesL, kSamples));
    obj->setProperty("r", juce::Base64::toBase64(bytesR, kSamples));
    webComponent.emitEventIfBrowserIsVisible("scopeFrame", juce::var(obj));
}

void BRAUN_AS42AudioProcessorEditor::sendPowerUpdateToWeb(bool on)
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty("id", "power");
    obj->setProperty("value", on ? 1.0f : 0.0f);
    webComponent.emitEventIfBrowserIsVisible("paramUpdate", juce::var(obj));
}

void BRAUN_AS42AudioProcessorEditor::sendDroneActiveUpdateToWeb(int droneId, bool active)
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty("id", droneId == 1 ? "drone1_active" : "drone2_active");
    obj->setProperty("value", active ? 1.0f : 0.0f);
    webComponent.emitEventIfBrowserIsVisible("paramUpdate", juce::var(obj));
}

void BRAUN_AS42AudioProcessorEditor::sendDroneTrackUpdateToWeb(bool track)
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty("id", "drone_track_midi");
    obj->setProperty("value", track ? 1.0f : 0.0f);
    webComponent.emitEventIfBrowserIsVisible("paramUpdate", juce::var(obj));
}

void BRAUN_AS42AudioProcessorEditor::sendRecordingStateUpdateToWeb(bool isRecording)
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty("id", "isRecording");
    obj->setProperty("value", isRecording ? 1.0f : 0.0f);
    webComponent.emitEventIfBrowserIsVisible("paramUpdate", juce::var(obj));
}

void BRAUN_AS42AudioProcessorEditor::syncAllParametersToWeb()
{
    sendPowerUpdateToWeb(processorRef.getPoweredOn());
    sendDroneActiveUpdateToWeb(1, processorRef.getDrone1Active());
    sendDroneActiveUpdateToWeb(2, processorRef.getDrone2Active());
    sendDroneTrackUpdateToWeb(processorRef.getDroneTrackMidi());
    sendRecordingStateUpdateToWeb(processorRef.isRecording());

    for (const auto& item : kParamMap)
    {
        if (auto* rawVal = processorRef.getAPVTS().getRawParameterValue(item.apvtsId))
        {
            sendParameterUpdateToWeb(item.apvtsId, rawVal->load(std::memory_order_relaxed));
        }
    }
}

void BRAUN_AS42AudioProcessorEditor::handleNoteOnFromWeb(const juce::var& data)
{
    if (!data.isObject())
        return;
    auto* obj = data.getDynamicObject();
    if (obj == nullptr)
        return;
    const int note = static_cast<int>(obj->getProperty("note"));
    const float velocity = obj->hasProperty("velocity") ? static_cast<float>(obj->getProperty("velocity")) : 0.65f;
    processorRef.pushUINoteOn(note, velocity);
}

void BRAUN_AS42AudioProcessorEditor::handleNoteOffFromWeb(const juce::var& data)
{
    if (!data.isObject())
        return;
    auto* obj = data.getDynamicObject();
    if (obj == nullptr)
        return;
    const int note = static_cast<int>(obj->getProperty("note"));
    const float velocity = obj->hasProperty("velocity") ? static_cast<float>(obj->getProperty("velocity")) : 0.0f;
    processorRef.pushUINoteOff(note, velocity);
}

void BRAUN_AS42AudioProcessorEditor::handleAllNotesOffFromWeb(const juce::var& /*data*/)
{
    processorRef.pushUIAllNotesOff();
}

void BRAUN_AS42AudioProcessorEditor::handlePitchBendFromWeb(const juce::var& data)
{
    if (!data.isObject())
        return;
    auto* obj = data.getDynamicObject();
    if (obj == nullptr)
        return;
    const float cents = static_cast<float>(obj->getProperty("cents"));
    processorRef.pushUIPitchBend(cents);
}

void BRAUN_AS42AudioProcessorEditor::handleStartRecordingFromWeb()
{
    processorRef.startRecording();
}

void BRAUN_AS42AudioProcessorEditor::handleStopRecordingFromWeb()
{
    processorRef.stopRecording();
}

void BRAUN_AS42AudioProcessorEditor::handleParamChangeFromWeb(const juce::var& data)
{
    if (!data.isObject())
        return;

    auto* obj = data.getDynamicObject();
    if (obj == nullptr)
        return;

    const juce::String incomingId = obj->getProperty("id").toString();
    const juce::var rawVal = obj->getProperty("value");
    const float incomingVal = rawVal.isString() ? static_cast<float>(rawVal.toString().getDoubleValue()) : static_cast<float>(rawVal);

    // Handle switching to native JUCE UI
    if (incomingId.equalsIgnoreCase("toggleNativeUI") ||
        incomingId.equalsIgnoreCase("nativeUI") ||
        incomingId.equalsIgnoreCase("switchUI"))
    {
        setNativeMode(true);
        return;
    }

    // Handle recording commands sent as paramChange
    if (incomingId.equalsIgnoreCase("startRecording"))
    {
        processorRef.startRecording();
        return;
    }
    if (incomingId.equalsIgnoreCase("stopRecording"))
    {
        processorRef.stopRecording();
        return;
    }

    // Handle state sync request from WebView2
    if (incomingId.equalsIgnoreCase("requestSync") || incomingId.equalsIgnoreCase("requestState"))
    {
        syncAllParametersToWeb();
        return;
    }

    // Handle discrete engine power, drone active state controls, and MIDI pitch tracking
    if (incomingId.equalsIgnoreCase("power"))
    {
        processorRef.setPoweredOn(incomingVal > 0.5f);
        return;
    }
    if (incomingId.equalsIgnoreCase("drone1_active") || incomingId.equalsIgnoreCase("drone1Active"))
    {
        processorRef.setDrone1Active(incomingVal > 0.5f);
        return;
    }
    if (incomingId.equalsIgnoreCase("drone2_active") || incomingId.equalsIgnoreCase("drone2Active"))
    {
        processorRef.setDrone2Active(incomingVal > 0.5f);
        return;
    }
    if (incomingId.equalsIgnoreCase("drone_track_midi") || incomingId.equalsIgnoreCase("droneTrackMidi") || incomingId.equalsIgnoreCase("droneTrack"))
    {
        processorRef.setDroneTrackMidi(incomingVal > 0.5f);
        return;
    }

    // Check for waveform string / int parameters
    if (incomingId.equalsIgnoreCase("felt_waveform") || incomingId.equalsIgnoreCase("feltWaveform") || incomingId.equalsIgnoreCase("pianoWave"))
    {
        const int waveIdx = waveformFromString(rawVal);
        if (auto* param = processorRef.getAPVTS().getParameter("felt_waveform"))
        {
            param->setValueNotifyingHost(param->convertTo0to1(static_cast<float>(waveIdx)));
        }
        return;
    }
    if (incomingId.equalsIgnoreCase("drone1_waveA") || incomingId.equalsIgnoreCase("drone1WaveA"))
    {
        const int waveIdx = waveformFromString(rawVal);
        if (auto* param = processorRef.getAPVTS().getParameter("drone1_waveA"))
        {
            param->setValueNotifyingHost(param->convertTo0to1(static_cast<float>(waveIdx)));
        }
        return;
    }
    if (incomingId.equalsIgnoreCase("drone1_waveB") || incomingId.equalsIgnoreCase("drone1WaveB"))
    {
        const int waveIdx = waveformFromString(rawVal);
        if (auto* param = processorRef.getAPVTS().getParameter("drone1_waveB"))
        {
            param->setValueNotifyingHost(param->convertTo0to1(static_cast<float>(waveIdx)));
        }
        return;
    }
    if (incomingId.equalsIgnoreCase("drone2_waveA") || incomingId.equalsIgnoreCase("drone2WaveA"))
    {
        const int waveIdx = waveformFromString(rawVal);
        if (auto* param = processorRef.getAPVTS().getParameter("drone2_waveA"))
        {
            param->setValueNotifyingHost(param->convertTo0to1(static_cast<float>(waveIdx)));
        }
        return;
    }
    if (incomingId.equalsIgnoreCase("drone2_waveB") || incomingId.equalsIgnoreCase("drone2WaveB"))
    {
        const int waveIdx = waveformFromString(rawVal);
        if (auto* param = processorRef.getAPVTS().getParameter("drone2_waveB"))
        {
            param->setValueNotifyingHost(param->convertTo0to1(static_cast<float>(waveIdx)));
        }
        return;
    }
    if (incomingId.equalsIgnoreCase("shimmer_freeze") || incomingId.equalsIgnoreCase("reverbFreeze") || incomingId.equalsIgnoreCase("freeze"))
    {
        if (auto* param = processorRef.getAPVTS().getParameter("shimmer_freeze"))
        {
            param->setValueNotifyingHost(incomingVal > 0.5f ? 1.0f : 0.0f);
        }
        return;
    }

    juce::String targetApvtsId;
    float targetApvtsVal = incomingVal;

    for (const auto& item : kParamMap)
    {
        if (incomingId.equalsIgnoreCase(item.webId))
        {
            targetApvtsId = item.apvtsId;
            targetApvtsVal = incomingVal * item.webScale;
            break;
        }
        if (incomingId.equalsIgnoreCase(item.apvtsId))
        {
            targetApvtsId = item.apvtsId;
            // If APVTS parameter is on 0..1 range and webScale is 0.01 (e.g. passed 0..100), auto-scale
            if (item.webScale == 0.01f && incomingVal > 1.0f)
                targetApvtsVal = incomingVal * 0.01f;
            else if (juce::String(item.apvtsId) == "tape_time" && incomingVal > 10.0f)
                targetApvtsVal = incomingVal * 0.001f;
            else
                targetApvtsVal = incomingVal;
            break;
        }
    }

    if (targetApvtsId.isEmpty())
    {
        if (incomingId.equalsIgnoreCase("drone1Level") || incomingId.equalsIgnoreCase("drone1Volume") || incomingId.equalsIgnoreCase("drone1_volume"))
        {
            targetApvtsId = "drone1_volume";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("drone2Level") || incomingId.equalsIgnoreCase("drone2Volume") || incomingId.equalsIgnoreCase("drone2_volume"))
        {
            targetApvtsId = "drone2_volume";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("drone1SubBass") || incomingId.equalsIgnoreCase("subBass") || incomingId.equalsIgnoreCase("drone1_isSubBass"))
        {
            targetApvtsId = "drone1_isSubBass";
            targetApvtsVal = (incomingVal > 0.5f) ? 1.0f : 0.0f;
        }
        else if (incomingId.equalsIgnoreCase("pianoLevel") || incomingId.equalsIgnoreCase("pianoVolume") || incomingId.equalsIgnoreCase("feltVolume") || incomingId.equalsIgnoreCase("felt_volume") || incomingId.equalsIgnoreCase("feltLevel"))
        {
            targetApvtsId = "felt_volume";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("feltSympathetic") || incomingId.equalsIgnoreCase("felt_space") || incomingId.equalsIgnoreCase("feltSpace") || incomingId.equalsIgnoreCase("sympathetic") || incomingId.equalsIgnoreCase("feltSymp") || incomingId.equalsIgnoreCase("symp"))
        {
            targetApvtsId = "felt_space";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("feltHammer") || incomingId.equalsIgnoreCase("hammer") || incomingId.equalsIgnoreCase("felt_hammer"))
        {
            targetApvtsId = "felt_hammer";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("feltDecay") || incomingId.equalsIgnoreCase("decay") || incomingId.equalsIgnoreCase("felt_decay"))
        {
            targetApvtsId = "felt_decay";
            targetApvtsVal = incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("feltTone") || incomingId.equalsIgnoreCase("tone") || incomingId.equalsIgnoreCase("felt_tone") || incomingId.equalsIgnoreCase("feltDamp") || incomingId.equalsIgnoreCase("damp"))
        {
            targetApvtsId = "felt_tone";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("tapeMix") || incomingId.equalsIgnoreCase("delayMix") || incomingId.equalsIgnoreCase("tape_mix") || incomingId.equalsIgnoreCase("delay_wet") || incomingId.equalsIgnoreCase("delayWet"))
        {
            targetApvtsId = "tape_mix";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("tapeTime") || incomingId.equalsIgnoreCase("delay_time") || incomingId.equalsIgnoreCase("tape_time") || incomingId.equalsIgnoreCase("delayTime"))
        {
            targetApvtsId = "tape_time";
            targetApvtsVal = (incomingVal > 10.0f) ? (incomingVal * 0.001f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("tapeFeedback") || incomingId.equalsIgnoreCase("delay_feedback") || incomingId.equalsIgnoreCase("tape_feedback") || incomingId.equalsIgnoreCase("delayFeedback"))
        {
            targetApvtsId = "tape_feedback";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("tapeWow") || incomingId.equalsIgnoreCase("delay_wow") || incomingId.equalsIgnoreCase("tape_wow") || incomingId.equalsIgnoreCase("delayWow"))
        {
            targetApvtsId = "tape_wow";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("tapeTone") || incomingId.equalsIgnoreCase("delay_tone") || incomingId.equalsIgnoreCase("tape_tone") || incomingId.equalsIgnoreCase("delayTone"))
        {
            targetApvtsId = "tape_tone";
            targetApvtsVal = incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("reverbMix") || incomingId.equalsIgnoreCase("shimmerMix") || incomingId.equalsIgnoreCase("shimmer_mix") || incomingId.equalsIgnoreCase("reverb_wet") || incomingId.equalsIgnoreCase("reverbWet"))
        {
            targetApvtsId = "shimmer_mix";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("reverbDecay") || incomingId.equalsIgnoreCase("shimmerDecay") || incomingId.equalsIgnoreCase("shimmer_decay") || incomingId.equalsIgnoreCase("reverb_decay"))
        {
            targetApvtsId = "shimmer_decay";
            targetApvtsVal = incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("reverbDamping") || incomingId.equalsIgnoreCase("shimmerDamping") || incomingId.equalsIgnoreCase("shimmer_damping") || incomingId.equalsIgnoreCase("reverb_damping"))
        {
            targetApvtsId = "shimmer_damping";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("reverbShimmer") || incomingId.equalsIgnoreCase("shimmerAmount") || incomingId.equalsIgnoreCase("shimmer_amount") || incomingId.equalsIgnoreCase("reverb_shimmer"))
        {
            targetApvtsId = "shimmer_amount";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
        else if (incomingId.equalsIgnoreCase("masterVolume") || incomingId.equalsIgnoreCase("master_volume") || incomingId.equalsIgnoreCase("master_vol"))
        {
            targetApvtsId = "master_volume";
            targetApvtsVal = (incomingVal > 1.0f) ? (incomingVal * 0.01f) : incomingVal;
        }
    }

    if (targetApvtsId.isNotEmpty())
    {
        if (auto* param = processorRef.getAPVTS().getParameter(targetApvtsId))
        {
            const float norm = param->convertTo0to1(targetApvtsVal);
            param->setValueNotifyingHost(std::clamp(norm, 0.0f, 1.0f));
        }
    }
}

std::optional<juce::WebBrowserComponent::Resource> BRAUN_AS42AudioProcessorEditor::getResource(const juce::String& url)
{
    return resourceManager.getResource(url);
}

void BRAUN_AS42AudioProcessorEditor::registerParameterListeners()
{
    for (const auto& item : kParamMap)
    {
        processorRef.getAPVTS().addParameterListener(item.apvtsId, this);
    }
}

void BRAUN_AS42AudioProcessorEditor::unregisterParameterListeners()
{
    for (const auto& item : kParamMap)
    {
        processorRef.getAPVTS().removeParameterListener(item.apvtsId, this);
    }
}

//==============================================================================
// Native JUCE UI Layer: Persistence, Controls & Rams Vector Graphics
//==============================================================================
juce::File BRAUN_AS42AudioProcessorEditor::getSettingsFile()
{
    return juce::File::getSpecialLocation(juce::File::SpecialLocationType::userApplicationDataDirectory)
        .getChildFile("Braun")
        .getChildFile("AS42_settings.xml");
}

void BRAUN_AS42AudioProcessorEditor::updateNativeControlVisibility()
{
    viewModeButton.setVisible(useNativeUI);
    viewModeButton.setButtonText("SWITCH TO WEB UI");
    if (useNativeUI)
        viewModeButton.toFront(true);

    const bool nativeVisible = useNativeUI;
    powerButton.setVisible(nativeVisible);
    themeButton.setVisible(nativeVisible);
    recordButton.setVisible(nativeVisible);
    presetLabel.setVisible(nativeVisible);
    presetComboBox.setVisible(nativeVisible);
    prevPresetBtn.setVisible(nativeVisible);
    nextPresetBtn.setVisible(nativeVisible);
    drone1ActiveBtn.setVisible(nativeVisible);
    drone2ActiveBtn.setVisible(nativeVisible);
    droneTrackMidiBtn.setVisible(nativeVisible);
    chordTriggerBtn.setVisible(nativeVisible);
    impulseTriggerBtn.setVisible(nativeVisible);

    for (auto& slot : knobSlots)
    {
        slot->slider.setVisible(nativeVisible);
        slot->nameLabel.setVisible(nativeVisible);
        if (nativeVisible)
        {
            slot->slider.toFront(false);
            slot->nameLabel.toFront(false);
        }
    }
    for (auto& slot : buttonSlots)
    {
        slot->button.setVisible(nativeVisible);
        if (nativeVisible)
            slot->button.toFront(false);
    }
    for (auto& slot : comboSlots)
    {
        slot->comboBox.setVisible(nativeVisible);
        slot->label.setVisible(nativeVisible);
        if (nativeVisible)
        {
            slot->comboBox.toFront(false);
            slot->label.toFront(false);
        }
    }

    if (useNativeUI)
    {
        powerButton.toFront(false);
        themeButton.toFront(false);
        recordButton.toFront(false);
        presetLabel.toFront(false);
        presetComboBox.toFront(false);
        prevPresetBtn.toFront(false);
        nextPresetBtn.toFront(false);
        drone1ActiveBtn.toFront(false);
        drone2ActiveBtn.toFront(false);
        droneTrackMidiBtn.toFront(false);
        chordTriggerBtn.toFront(false);
        impulseTriggerBtn.toFront(false);
    }
}

void BRAUN_AS42AudioProcessorEditor::setNativeMode(bool native)
{
    useNativeUI = native;

    // Save mode so it persists across DAW sessions
    auto settingsFile = getSettingsFile();
    settingsFile.getParentDirectory().createDirectory();
    juce::PropertiesFile::Options opts;
    opts.storageFormat = juce::PropertiesFile::storeAsXML;
    juce::PropertiesFile props(settingsFile, opts);
    props.setValue("useNativeUI", useNativeUI);
    props.saveIfNeeded();

    if (useNativeUI)
    {
        webComponent.setVisible(false);
        webComponent.setBounds(0, 0, 0, 0);
        webComponent.toBack();
    }
    else
    {
        webComponent.setVisible(true);
        webComponent.setBounds(getLocalBounds());
        webComponent.toFront(false);
    }

    updateNativeControlVisibility();
    resized();
    repaint();
}

void BRAUN_AS42AudioProcessorEditor::setupNativeControls()
{
    addMouseListener(this, true);

    // Power button
    powerButton.setButtonText(processorRef.getPoweredOn() ? "POWER ON" : "STANDBY");
    powerButton.setClickingTogglesState(false);
    powerButton.onClick = [this] {
        const bool nextPwr = !processorRef.getPoweredOn();
        processorRef.setPoweredOn(nextPwr);
        powerButton.setButtonText(nextPwr ? "POWER ON" : "STANDBY");
        powerButton.setToggleState(nextPwr, juce::dontSendNotification);
        sendPowerUpdateToWeb(nextPwr);
    };
    addChildComponent(powerButton);

    // Theme button
    themeButton.setButtonText(braunLookAndFeel.isDarkTheme() ? "THEME: DARK" : "THEME: LIGHT");
    themeButton.onClick = [this] {
        braunLookAndFeel.setDarkTheme(!braunLookAndFeel.isDarkTheme());
        themeButton.setButtonText(braunLookAndFeel.isDarkTheme() ? "THEME: DARK" : "THEME: LIGHT");
        sendLookAndFeelChange();
        repaint();
    };
    addChildComponent(themeButton);

    // Record button
    recordButton.setButtonText(processorRef.isRecording() ? "RECORDING..." : "REC WAV");
    recordButton.onClick = [this] {
        if (processorRef.isRecording())
            processorRef.stopRecording();
        else
            processorRef.startRecording();
        recordButton.setButtonText(processorRef.isRecording() ? "RECORDING..." : "REC WAV");
        recordButton.setToggleState(processorRef.isRecording(), juce::dontSendNotification);
        sendRecordingStateUpdateToWeb(processorRef.isRecording());
    };
    addChildComponent(recordButton);

    // View Mode button (Switch back to Web UI)
    viewModeButton.setButtonText("SWITCH TO WEB UI");
    viewModeButton.onClick = [this] {
        setNativeMode(false);
    };
    addChildComponent(viewModeButton);

    // Preset management controls for Native UI
    presetLabel.setText("PRESET:", juce::dontSendNotification);
    presetLabel.setFont(juce::Font(juce::FontOptions(10.0f, juce::Font::bold)));
    presetLabel.setJustificationType(juce::Justification::centredRight);
    addChildComponent(presetLabel);

    const int numPrograms = processorRef.getNumPrograms();
    for (int i = 0; i < numPrograms; ++i)
    {
        presetComboBox.addItem(processorRef.getProgramName(i), i + 1);
    }
    presetComboBox.setSelectedId(processorRef.getCurrentProgram() + 1, juce::dontSendNotification);
    presetComboBox.onChange = [this] {
        const int selected = presetComboBox.getSelectedId() - 1;
        if (selected >= 0 && selected < processorRef.getNumPrograms())
        {
            processorRef.setCurrentProgram(selected);
        }
    };
    addChildComponent(presetComboBox);

    prevPresetBtn.setButtonText("<");
    prevPresetBtn.onClick = [this] {
        const int total = processorRef.getNumPrograms();
        if (total > 0)
        {
            const int nextIdx = (processorRef.getCurrentProgram() - 1 + total) % total;
            processorRef.setCurrentProgram(nextIdx);
            presetComboBox.setSelectedId(nextIdx + 1, juce::dontSendNotification);
        }
    };
    addChildComponent(prevPresetBtn);

    nextPresetBtn.setButtonText(">");
    nextPresetBtn.onClick = [this] {
        const int total = processorRef.getNumPrograms();
        if (total > 0)
        {
            const int nextIdx = (processorRef.getCurrentProgram() + 1) % total;
            processorRef.setCurrentProgram(nextIdx);
            presetComboBox.setSelectedId(nextIdx + 1, juce::dontSendNotification);
        }
    };
    addChildComponent(nextPresetBtn);

    // Quick Audition & Performance Strip
    chordTriggerBtn.setButtonText("AMBIENT CHORD");
    chordTriggerBtn.onClick = [this] {
        if (!processorRef.getPoweredOn()) processorRef.setPoweredOn(true);
        processorRef.pushUINoteOn(60, 0.70f);
        processorRef.pushUINoteOn(64, 0.65f);
        processorRef.pushUINoteOn(67, 0.65f);
        processorRef.pushUINoteOn(71, 0.60f);
    };
    addChildComponent(chordTriggerBtn);

    impulseTriggerBtn.setButtonText("DIRAC IMPULSE");
    impulseTriggerBtn.onClick = [this] {
        if (!processorRef.getPoweredOn()) processorRef.setPoweredOn(true);
        processorRef.pushUINoteOn(60, 1.0f);
    };
    addChildComponent(impulseTriggerBtn);

    drone1ActiveBtn.setButtonText("DRONE 1 [OFF]");
    drone1ActiveBtn.onClick = [this] {
        const bool nextActive = !processorRef.getDrone1Active();
        processorRef.setDrone1Active(nextActive);
        drone1ActiveBtn.setToggleState(nextActive, juce::dontSendNotification);
        drone1ActiveBtn.setButtonText(nextActive ? "DRONE 1 [ON]" : "DRONE 1 [OFF]");
        sendDroneActiveUpdateToWeb(1, nextActive);
    };
    addChildComponent(drone1ActiveBtn);

    drone2ActiveBtn.setButtonText("DRONE 2 [OFF]");
    drone2ActiveBtn.onClick = [this] {
        const bool nextActive = !processorRef.getDrone2Active();
        processorRef.setDrone2Active(nextActive);
        drone2ActiveBtn.setToggleState(nextActive, juce::dontSendNotification);
        drone2ActiveBtn.setButtonText(nextActive ? "DRONE 2 [ON]" : "DRONE 2 [OFF]");
        sendDroneActiveUpdateToWeb(2, nextActive);
    };
    addChildComponent(drone2ActiveBtn);

    droneTrackMidiBtn.setButtonText("MIDI TRACK [OFF]");
    droneTrackMidiBtn.onClick = [this] {
        const bool nextTrack = !processorRef.getDroneTrackMidi();
        processorRef.setDroneTrackMidi(nextTrack);
        droneTrackMidiBtn.setToggleState(nextTrack, juce::dontSendNotification);
        droneTrackMidiBtn.setButtonText(nextTrack ? "MIDI TRACK [ON]" : "MIDI TRACK [OFF]");
        sendDroneTrackUpdateToWeb(nextTrack);
    };
    addChildComponent(droneTrackMidiBtn);

    // Helpers to instantiate param slots
    auto addKnob = [this](const juce::String& paramId, const juce::String& displayName, const juce::String& unit) {
        auto slot = std::make_unique<KnobSlot>();
        slot->paramId = paramId;
        slot->slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
        slot->slider.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 55, 15);
        if (unit.isNotEmpty())
            slot->slider.setTextValueSuffix(" " + unit);

        slot->nameLabel.setText(displayName, juce::dontSendNotification);
        slot->nameLabel.setJustificationType(juce::Justification::centred);
        slot->nameLabel.setFont(juce::Font(juce::FontOptions(9.5f, juce::Font::bold)));

        slot->attachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
            processorRef.getAPVTS(), paramId, slot->slider);

        slot->slider.addMouseListener(this, false);
        slot->nameLabel.addMouseListener(this, false);

        addChildComponent(slot->slider);
        addChildComponent(slot->nameLabel);
        knobSlots.push_back(std::move(slot));
    };

    auto addButton = [this](const juce::String& paramId, const juce::String& displayName) {
        auto slot = std::make_unique<ButtonSlot>();
        slot->paramId = paramId;
        slot->button.setButtonText(displayName);
        slot->attachment = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(
            processorRef.getAPVTS(), paramId, slot->button);
        addChildComponent(slot->button);
        buttonSlots.push_back(std::move(slot));
    };

    auto addCombo = [this](const juce::String& paramId, const juce::String& displayName, const juce::StringArray& choices) {
        auto slot = std::make_unique<ComboSlot>();
        slot->paramId = paramId;
        slot->label.setText(displayName, juce::dontSendNotification);
        slot->label.setJustificationType(juce::Justification::centred);
        slot->label.setFont(juce::Font(juce::FontOptions(9.5f, juce::Font::bold)));

        slot->comboBox.addItemList(choices, 1);
        slot->attachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
            processorRef.getAPVTS(), paramId, slot->comboBox);

        addChildComponent(slot->label);
        addChildComponent(slot->comboBox);
        comboSlots.push_back(std::move(slot));
    };

    // 1. Felt Piano (5 Knobs + 1 Combo = 6)
    addKnob("felt_volume", "Volume", "%");
    addKnob("felt_decay", "Decay", "s");
    addKnob("felt_tone", "Tone", "%");
    addKnob("felt_hammer", "Hammer", "%");
    addKnob("felt_space", "Symp Res", "%");
    addCombo("felt_waveform", "Piano Waveform", juce::StringArray { "Felt", "Sine", "Saw", "Square", "CS-80" });

    // 2. Drone 1 (8 Knobs + 2 Combos + 1 Toggle = 11)
    addKnob("drone1_volume", "Volume", "%");
    addKnob("drone1_pitch", "Pitch", "Hz");
    addKnob("drone1_fold", "Wavefold", "%");
    addKnob("drone1_cutoff", "Cutoff", "Hz");
    addKnob("drone1_resonance", "Resonance", "");
    addKnob("drone1_beat", "Beating", "Hz");
    addKnob("drone1_detune", "Detune", "ct");
    addKnob("drone1_lfo", "LFO Rate", "Hz");
    addCombo("drone1_waveA", "Wave A", juce::StringArray { "Felt", "Sine", "Saw", "Square", "CS-80", "Triangle", "Warm" });
    addCombo("drone1_waveB", "Wave B", juce::StringArray { "Felt", "Sine", "Saw", "Square", "CS-80", "Triangle", "Warm" });
    addButton("drone1_isSubBass", "Sub Bass Preserver");

    // 3. Drone 2 (8 Knobs + 2 Combos = 10)
    addKnob("drone2_volume", "Volume", "%");
    addKnob("drone2_pitch", "Pitch", "Hz");
    addKnob("drone2_fold", "Wavefold", "%");
    addKnob("drone2_cutoff", "Cutoff", "Hz");
    addKnob("drone2_resonance", "Resonance", "");
    addKnob("drone2_beat", "Beating", "Hz");
    addKnob("drone2_detune", "Detune", "ct");
    addKnob("drone2_lfo", "LFO Rate", "Hz");
    addCombo("drone2_waveA", "Wave A", juce::StringArray { "Felt", "Sine", "Saw", "Square", "CS-80", "Triangle", "Warm" });
    addCombo("drone2_waveB", "Wave B", juce::StringArray { "Felt", "Sine", "Saw", "Square", "CS-80", "Triangle", "Warm" });

    // 4. Tape Delay (5 Knobs)
    addKnob("tape_time", "Time", "s");
    addKnob("tape_feedback", "Feedback", "%");
    addKnob("tape_mix", "Mix", "%");
    addKnob("tape_wow", "Wow", "%");
    addKnob("tape_tone", "Tone", "Hz");

    // 5. Shimmer Reverb (4 Knobs + 1 Toggle = 5)
    addKnob("shimmer_mix", "Mix", "%");
    addKnob("shimmer_decay", "Decay", "s");
    addKnob("shimmer_damping", "Damping", "%");
    addKnob("shimmer_amount", "Shimmer", "%");
    addButton("shimmer_freeze", "Infinite Freeze");

    // 6. Master Bus (1 Knob = 1)
    addKnob("master_volume", "Master Volume", "%");
}

void BRAUN_AS42AudioProcessorEditor::updateNativeControlLayout()
{
    auto bounds = getLocalBounds();
    if (bounds.isEmpty()) return;

    // 1. Header controls
    auto headerArea = bounds.removeFromTop(54);
    auto rightArea = headerArea.removeFromRight(juce::jmax(200, headerArea.getWidth() - 360)).reduced(8, 10);
    viewModeButton.setBounds(rightArea.removeFromRight(130).reduced(3, 1));
    recordButton.setBounds(rightArea.removeFromRight(105).reduced(3, 1));
    themeButton.setBounds(rightArea.removeFromRight(105).reduced(3, 1));
    powerButton.setBounds(rightArea.removeFromRight(95).reduced(3, 1));

    if (rightArea.getWidth() >= 160)
    {
        nextPresetBtn.setBounds(rightArea.removeFromRight(26).reduced(2, 2));
        const int comboW = juce::jlimit(100, 180, rightArea.getWidth() - 85);
        presetComboBox.setBounds(rightArea.removeFromRight(comboW).reduced(2, 2));
        prevPresetBtn.setBounds(rightArea.removeFromRight(26).reduced(2, 2));
        presetLabel.setBounds(rightArea.removeFromRight(juce::jmin(65, rightArea.getWidth())).reduced(2, 2));
    }

    // 2. CRT Display Area
    bounds.removeFromTop(120);

    // 3. Performance & Audition Strip
    auto auditionArea = bounds.removeFromTop(32).reduced(16, 2);
    auditionArea.removeFromLeft(125); // skip label area
    chordTriggerBtn.setBounds(auditionArea.removeFromLeft(120).reduced(3, 1));
    impulseTriggerBtn.setBounds(auditionArea.removeFromLeft(120).reduced(3, 1));
    drone1ActiveBtn.setBounds(auditionArea.removeFromLeft(120).reduced(3, 1));
    drone2ActiveBtn.setBounds(auditionArea.removeFromLeft(120).reduced(3, 1));
    droneTrackMidiBtn.setBounds(auditionArea.removeFromLeft(140).reduced(3, 1));

    // 4. 6 Decks Grid
    auto gridArea = bounds.reduced(16, 6);
    const int numCols = 3;
    const int numRows = 2;
    const int colWidth = gridArea.getWidth() / numCols;
    const int rowHeight = gridArea.getHeight() / numRows;

    auto getCellBounds = [&](int row, int col) {
        return juce::Rectangle<int>(gridArea.getX() + col * colWidth,
                                    gridArea.getY() + row * rowHeight,
                                    colWidth, rowHeight).reduced(4);
    };

    auto layoutKnob = [](KnobSlot* slot, juce::Rectangle<int> area) {
        if (slot == nullptr) return;
        auto labelArea = area.removeFromBottom(16);
        slot->nameLabel.setBounds(labelArea);
        slot->slider.setBounds(area);
    };

    auto layoutCombo = [](ComboSlot* slot, juce::Rectangle<int> area) {
        if (slot == nullptr) return;
        auto labelArea = area.removeFromTop(16);
        slot->label.setBounds(labelArea);
        slot->comboBox.setBounds(area.reduced(2, 1));
    };

    // DECK 1: FELT PIANO (Row 0, Col 0)
    // 5 Knobs: felt_volume, felt_decay, felt_tone, felt_hammer, felt_space
    // 1 Combo: felt_waveform
    {
        auto cell = getCellBounds(0, 0);
        cell.removeFromTop(22);
        auto comboArea = cell.removeFromBottom(42).reduced(6, 2);
        layoutCombo(findCombo("felt_waveform"), comboArea);

        auto topRow = cell.removeFromTop(cell.getHeight() / 2);
        auto bottomRow = cell;

        const int topW = topRow.getWidth() / 3;
        layoutKnob(findKnob("felt_volume"), topRow.removeFromLeft(topW).reduced(2));
        layoutKnob(findKnob("felt_decay"), topRow.removeFromLeft(topW).reduced(2));
        layoutKnob(findKnob("felt_tone"), topRow.reduced(2));

        const int btmW = bottomRow.getWidth() / 2;
        layoutKnob(findKnob("felt_hammer"), bottomRow.removeFromLeft(btmW).reduced(4));
        layoutKnob(findKnob("felt_space"), bottomRow.reduced(4));
    }

    // DECK 2: DRONE VOICE 1 (Row 0, Col 1)
    // 8 Knobs: drone1_volume, drone1_pitch, drone1_fold, drone1_cutoff, drone1_resonance, drone1_beat, drone1_detune, drone1_lfo
    // 2 Combos: drone1_waveA, drone1_waveB
    // 1 Toggle: drone1_isSubBass
    {
        auto cell = getCellBounds(0, 1);
        cell.removeFromTop(22);
        auto bottomControlRow = cell.removeFromBottom(42).reduced(4, 2);
        if (auto* btn = findButton("drone1_isSubBass"))
        {
            btn->button.setBounds(bottomControlRow.removeFromRight(110).reduced(2, 2));
        }
        const int comboW = bottomControlRow.getWidth() / 2;
        layoutCombo(findCombo("drone1_waveA"), bottomControlRow.removeFromLeft(comboW).reduced(2));
        layoutCombo(findCombo("drone1_waveB"), bottomControlRow.reduced(2));

        auto topRow = cell.removeFromTop(cell.getHeight() / 2);
        auto midRow = cell;

        const int topW = topRow.getWidth() / 4;
        layoutKnob(findKnob("drone1_volume"), topRow.removeFromLeft(topW).reduced(2));
        layoutKnob(findKnob("drone1_pitch"), topRow.removeFromLeft(topW).reduced(2));
        layoutKnob(findKnob("drone1_fold"), topRow.removeFromLeft(topW).reduced(2));
        layoutKnob(findKnob("drone1_cutoff"), topRow.reduced(2));

        const int midW = midRow.getWidth() / 4;
        layoutKnob(findKnob("drone1_resonance"), midRow.removeFromLeft(midW).reduced(2));
        layoutKnob(findKnob("drone1_beat"), midRow.removeFromLeft(midW).reduced(2));
        layoutKnob(findKnob("drone1_detune"), midRow.removeFromLeft(midW).reduced(2));
        layoutKnob(findKnob("drone1_lfo"), midRow.reduced(2));
    }

    // DECK 3: DRONE VOICE 2 (Row 0, Col 2)
    // 8 Knobs: drone2_volume, drone2_pitch, drone2_fold, drone2_cutoff, drone2_resonance, drone2_beat, drone2_detune, drone2_lfo
    // 2 Combos: drone2_waveA, drone2_waveB
    {
        auto cell = getCellBounds(0, 2);
        cell.removeFromTop(22);
        auto comboRow = cell.removeFromBottom(42).reduced(4, 2);
        const int comboW = comboRow.getWidth() / 2;
        layoutCombo(findCombo("drone2_waveA"), comboRow.removeFromLeft(comboW).reduced(4));
        layoutCombo(findCombo("drone2_waveB"), comboRow.reduced(4));

        auto topRow = cell.removeFromTop(cell.getHeight() / 2);
        auto midRow = cell;

        const int topW = topRow.getWidth() / 4;
        layoutKnob(findKnob("drone2_volume"), topRow.removeFromLeft(topW).reduced(2));
        layoutKnob(findKnob("drone2_pitch"), topRow.removeFromLeft(topW).reduced(2));
        layoutKnob(findKnob("drone2_fold"), topRow.removeFromLeft(topW).reduced(2));
        layoutKnob(findKnob("drone2_cutoff"), topRow.reduced(2));

        const int midW = midRow.getWidth() / 4;
        layoutKnob(findKnob("drone2_resonance"), midRow.removeFromLeft(midW).reduced(2));
        layoutKnob(findKnob("drone2_beat"), midRow.removeFromLeft(midW).reduced(2));
        layoutKnob(findKnob("drone2_detune"), midRow.removeFromLeft(midW).reduced(2));
        layoutKnob(findKnob("drone2_lfo"), midRow.reduced(2));
    }

    // DECK 4: TAPE DELAY (Row 1, Col 0)
    // 5 Knobs: tape_time, tape_feedback, tape_mix, tape_wow, tape_tone
    {
        auto cell = getCellBounds(1, 0);
        cell.removeFromTop(22);
        auto topRow = cell.removeFromTop(cell.getHeight() / 2);
        auto bottomRow = cell;

        const int topW = topRow.getWidth() / 3;
        layoutKnob(findKnob("tape_time"), topRow.removeFromLeft(topW).reduced(3));
        layoutKnob(findKnob("tape_feedback"), topRow.removeFromLeft(topW).reduced(3));
        layoutKnob(findKnob("tape_mix"), topRow.reduced(3));

        const int btmW = bottomRow.getWidth() / 2;
        layoutKnob(findKnob("tape_wow"), bottomRow.removeFromLeft(btmW).reduced(4));
        layoutKnob(findKnob("tape_tone"), bottomRow.reduced(4));
    }

    // DECK 5: SHIMMER REVERB (Row 1, Col 1)
    // 4 Knobs: shimmer_mix, shimmer_decay, shimmer_damping, shimmer_amount
    // 1 Toggle: shimmer_freeze
    {
        auto cell = getCellBounds(1, 1);
        cell.removeFromTop(22);
        auto toggleRow = cell.removeFromBottom(28).reduced(8, 2);
        if (auto* btn = findButton("shimmer_freeze"))
        {
            btn->button.setBounds(toggleRow);
        }

        auto topRow = cell.removeFromTop(cell.getHeight() / 2);
        auto bottomRow = cell;

        const int topW = topRow.getWidth() / 2;
        layoutKnob(findKnob("shimmer_mix"), topRow.removeFromLeft(topW).reduced(4));
        layoutKnob(findKnob("shimmer_decay"), topRow.reduced(4));

        const int btmW = bottomRow.getWidth() / 2;
        layoutKnob(findKnob("shimmer_damping"), bottomRow.removeFromLeft(btmW).reduced(4));
        layoutKnob(findKnob("shimmer_amount"), bottomRow.reduced(4));
    }

    // DECK 6: MASTER BUS & OUTPUT (Row 1, Col 2)
    // 1 Knob: master_volume
    {
        auto cell = getCellBounds(1, 2);
        cell.removeFromTop(22);
        cell.removeFromBottom(24);
        auto knobArea = cell.reduced(24, 6);
        layoutKnob(findKnob("master_volume"), knobArea);
    }
}

void BRAUN_AS42AudioProcessorEditor::drawBraunChassis(juce::Graphics& g, juce::Rectangle<int> bounds)
{
    g.fillAll(braunLookAndFeel.findColour(braun::BraunColours::bgAppColourId));
    g.setColour(braunLookAndFeel.findColour(braun::BraunColours::borderLineColourId));
    g.drawRect(bounds.toFloat(), 1.5f);

    auto headerArea = bounds.removeFromTop(54);
    g.setColour(braunLookAndFeel.findColour(braun::BraunColours::bgPanelColourId));
    g.fillRect(headerArea);
    g.setColour(braunLookAndFeel.findColour(braun::BraunColours::borderLineColourId));
    g.drawHorizontalLine(headerArea.getBottom(), 0.0f, static_cast<float>(bounds.getWidth()));

    g.setColour(braunLookAndFeel.findColour(braun::BraunColours::textPrimaryColourId));
    g.setFont(juce::Font(juce::FontOptions(18.0f, juce::Font::bold)));
    g.drawText("BRAUN AS-42", headerArea.removeFromLeft(170).reduced(16, 0), juce::Justification::centredLeft);

    g.setColour(braunLookAndFeel.findColour(braun::BraunColours::textMutedColourId));
    g.setFont(juce::Font(juce::FontOptions(10.0f, juce::Font::plain)));
    g.drawText(juce::String("AMBIENT GENERATIVE SYNTHESIZER ") + juce::String::charToString(0x00B7) + " DIN 1451", headerArea.removeFromLeft(270).reduced(4, 0), juce::Justification::centredLeft);

    auto crtArea = bounds.removeFromTop(120).reduced(16, 4);
    drawCrtDisplay(g, crtArea);

    auto auditionArea = bounds.removeFromTop(32).reduced(16, 2);
    g.setColour(braunLookAndFeel.findColour(braun::BraunColours::bgPanelColourId));
    g.fillRoundedRectangle(auditionArea.toFloat(), 3.0f);
    g.setColour(braunLookAndFeel.findColour(braun::BraunColours::borderLineColourId));
    g.drawRoundedRectangle(auditionArea.toFloat(), 3.0f, 1.0f);

    auto auditionLabelArea = auditionArea.removeFromLeft(125);
    g.setColour(braunLookAndFeel.findColour(braun::BraunColours::textMutedColourId));
    g.setFont(juce::Font(juce::FontOptions(9.0f, juce::Font::bold)));
    g.drawText("QUICK AUDITION:", auditionLabelArea.reduced(8, 0), juce::Justification::centredLeft);

    auto gridArea = bounds.reduced(16, 6);
    const int numCols = 3;
    const int numRows = 2;
    const int colWidth = gridArea.getWidth() / numCols;
    const int rowHeight = gridArea.getHeight() / numRows;

    const char* deckTitles[6] = {
        "1. FELT PIANO",
        "2. DRONE VOICE 1",
        "3. DRONE VOICE 2",
        "4. TAPE DELAY",
        "5. SHIMMER REVERB",
        "6. MASTER OUTPUT"
    };

    for (int r = 0; r < numRows; ++r)
    {
        for (int c = 0; c < numCols; ++c)
        {
            const int idx = r * numCols + c;
            auto cell = juce::Rectangle<int>(gridArea.getX() + c * colWidth, gridArea.getY() + r * rowHeight, colWidth, rowHeight).reduced(4);

            g.setColour(braunLookAndFeel.findColour(braun::BraunColours::bgPanelColourId));
            g.fillRoundedRectangle(cell.toFloat(), 3.0f);
            g.setColour(braunLookAndFeel.findColour(braun::BraunColours::borderLineColourId));
            g.drawRoundedRectangle(cell.toFloat(), 3.0f, 1.0f);

            auto deckHeader = cell.removeFromTop(22);
            g.setColour(braunLookAndFeel.findColour(braun::BraunColours::braunOrangeColourId));
            g.setFont(juce::Font(juce::FontOptions(10.0f, juce::Font::bold)));
            g.drawText(deckTitles[idx], deckHeader.reduced(8, 0), juce::Justification::centredLeft);

            if (idx == 5)
            {
                auto infoArea = cell.removeFromBottom(24).reduced(8, 2);
                g.setColour(braunLookAndFeel.findColour(braun::BraunColours::textMutedColourId));
                g.setFont(juce::Font(juce::FontOptions(9.0f, juce::Font::plain)));
                g.drawText("TRUE PEAK LIMITER ACTIVE " + juce::String::charToString(0x00B7) + " 48 KHZ", infoArea, juce::Justification::centred);
            }
        }
    }
}

void BRAUN_AS42AudioProcessorEditor::drawCrtDisplay(juce::Graphics& g, juce::Rectangle<int> bounds)
{
    g.setColour(juce::Colour(braun::BraunColours::Dark_BgBezel));
    g.fillRoundedRectangle(bounds.toFloat(), 4.0f);
    g.setColour(juce::Colour(0xff202622));
    g.drawRoundedRectangle(bounds.toFloat(), 4.0f, 1.5f);

    auto inner = bounds.reduced(8);
    auto scopeArea = inner.removeFromLeft(inner.getWidth() / 2);
    auto meterArea = inner.reduced(8, 0);

    g.setColour(juce::Colour(0xff162419));
    g.drawHorizontalLine(scopeArea.getCentreY(), static_cast<float>(scopeArea.getX()), static_cast<float>(scopeArea.getRight()));
    g.drawVerticalLine(scopeArea.getCentreX(), static_cast<float>(scopeArea.getY()), static_cast<float>(scopeArea.getBottom()));

    g.setColour(juce::Colours::white.withAlpha(0.12f));
    const float stepX = static_cast<float>(scopeArea.getWidth()) / 8.0f;
    const float stepY = static_cast<float>(scopeArea.getHeight()) / 6.0f;
    for (int i = 1; i < 8; ++i)
    {
        float x = static_cast<float>(scopeArea.getX()) + i * stepX;
        g.drawVerticalLine(static_cast<int>(x), static_cast<float>(scopeArea.getCentreY() - 3), static_cast<float>(scopeArea.getCentreY() + 3));
    }
    for (int j = 1; j < 6; ++j)
    {
        float y = static_cast<float>(scopeArea.getY()) + j * stepY;
        g.drawHorizontalLine(static_cast<int>(y), static_cast<float>(scopeArea.getCentreX() - 3), static_cast<float>(scopeArea.getCentreX() + 3));
    }

    constexpr int kSamples = 240;
    float sL[kSamples], sR[kSamples];
    processorRef.getScopeSamples(sL, sR, kSamples);

    juce::Path wavePath;
    const float midY = static_cast<float>(scopeArea.getCentreY());
    const float heightScale = static_cast<float>(scopeArea.getHeight()) * 0.45f;
    const float step = static_cast<float>(scopeArea.getWidth()) / static_cast<float>(kSamples);

    float rmsL = 0.0f;
    float rmsR = 0.0f;
    for (int i = 0; i < kSamples; ++i)
    {
        rmsL += sL[i] * sL[i];
        rmsR += sR[i] * sR[i];
        const float x = static_cast<float>(scopeArea.getX()) + i * step;
        const float y = midY - (0.5f * (sL[i] + sR[i]) * heightScale);
        if (i == 0) wavePath.startNewSubPath(x, y);
        else wavePath.lineTo(x, y);
    }
    rmsL = std::sqrt(rmsL / (float)kSamples);
    rmsR = std::sqrt(rmsR / (float)kSamples);

    g.setColour(juce::Colour(braun::BraunColours::PhosphorGreen).withAlpha(0.25f));
    g.strokePath(wavePath, juce::PathStrokeType(3.0f));

    g.setColour(juce::Colour(braun::BraunColours::PhosphorGreen));
    g.strokePath(wavePath, juce::PathStrokeType(1.2f));

    g.setFont(juce::Font(juce::FontOptions(juce::Font::getDefaultMonospacedFontName(), 9.0f, juce::Font::plain)));
    g.drawText("CRT PHOSPHOR OSCILLOSCOPE [48 KHZ]", scopeArea.getX() + 6, scopeArea.getY() + 4, 220, 12, juce::Justification::left);

    auto drawBar = [&](const juce::String& label, float rms, juce::Colour col, int yOffset) {
        const float db = 20.0f * std::log10(juce::jmax(1e-5f, rms));
        const float pct = juce::jlimit(0.0f, 1.0f, (db + 60.0f) / 60.0f);
        auto row = juce::Rectangle<int>(meterArea.getX(), meterArea.getY() + yOffset, meterArea.getWidth(), 14);
        g.setColour(juce::Colour(0xff8E9094));
        g.setFont(juce::Font(juce::FontOptions(9.0f, juce::Font::bold)));
        g.drawText(label, row.removeFromLeft(50), juce::Justification::centredLeft);

        g.setColour(juce::Colour(0xff18201B));
        g.fillRect(row);
        g.setColour(col);
        g.fillRect(row.removeFromLeft(static_cast<int>(row.getWidth() * pct)));
    };

    drawBar("OUT L", rmsL, juce::Colour(braun::BraunColours::PhosphorGreen), 12);
    drawBar("OUT R", rmsR, juce::Colour(braun::BraunColours::PhosphorGreen), 34);
    drawBar("PWR", processorRef.getPoweredOn() ? 0.9f : 0.0f, juce::Colour(braun::BraunColours::Accent_BraunOrange), 56);
    drawBar("MIDI", processorRef.getDroneTrackMidi() ? 0.8f : 0.2f, juce::Colour(0xff24B8FF), 78);
}

BRAUN_AS42AudioProcessorEditor::KnobSlot* BRAUN_AS42AudioProcessorEditor::findKnob(const juce::String& paramId)
{
    for (auto& slot : knobSlots)
    {
        if (slot->paramId.equalsIgnoreCase(paramId))
            return slot.get();
    }

    for (const auto& item : kParamMap)
    {
        if (paramId.equalsIgnoreCase(item.apvtsId) || paramId.equalsIgnoreCase(item.webId))
        {
            for (auto& slot : knobSlots)
            {
                if (slot->paramId.equalsIgnoreCase(item.apvtsId))
                    return slot.get();
            }
        }
    }

    juce::String cleanId = paramId;
    if (cleanId.startsWithIgnoreCase("knob-") || cleanId.startsWithIgnoreCase("knob_"))
        cleanId = cleanId.substring(5);
    cleanId = cleanId.replaceCharacter('-', '_');

    for (auto& slot : knobSlots)
    {
        if (slot->paramId.equalsIgnoreCase(cleanId))
            return slot.get();
    }
    for (const auto& item : kParamMap)
    {
        if (cleanId.equalsIgnoreCase(item.apvtsId) || cleanId.equalsIgnoreCase(item.webId))
        {
            for (auto& slot : knobSlots)
            {
                if (slot->paramId.equalsIgnoreCase(item.apvtsId))
                    return slot.get();
            }
        }
    }

    return nullptr;
}

BRAUN_AS42AudioProcessorEditor::ButtonSlot* BRAUN_AS42AudioProcessorEditor::findButton(const juce::String& id)
{
    for (auto& slot : buttonSlots)
    {
        if (slot->paramId == id)
            return slot.get();
    }
    return nullptr;
}

BRAUN_AS42AudioProcessorEditor::ComboSlot* BRAUN_AS42AudioProcessorEditor::findCombo(const juce::String& id)
{
    for (auto& slot : comboSlots)
    {
        if (slot->paramId == id)
            return slot.get();
    }
    return nullptr;
}

void BRAUN_AS42AudioProcessorEditor::mouseDown(const juce::MouseEvent& e)
{
    if (!useNativeUI)
        return;

    if (e.mods.isPopupMenu())
    {
        if (dynamic_cast<juce::TextEditor*>(e.eventComponent) != nullptr
            || (e.eventComponent != nullptr && e.eventComponent->findParentComponentOfClass<juce::TextEditor>() != nullptr))
            return;

        for (auto& slot : knobSlots)
        {
            if (e.eventComponent == &slot->slider || slot->slider.isParentOf(e.eventComponent)
                || e.eventComponent == &slot->nameLabel || slot->nameLabel.isParentOf(e.eventComponent))
            {
                // If a slider currently has an active text box open for exact entry, allow text editor to handle mouse events
                for (int i = 0; i < slot->slider.getNumChildComponents(); ++i)
                {
                    auto* child = slot->slider.getChildComponent(i);
                    if (dynamic_cast<juce::TextEditor*>(child) != nullptr)
                        return;
                    if (auto* lbl = dynamic_cast<juce::Label*>(child))
                    {
                        if (lbl->isBeingEdited())
                            return;
                    }
                }

                showKnobContextMenu(*slot, e.getScreenPosition());
                return;
            }
        }
    }
}

void BRAUN_AS42AudioProcessorEditor::showKnobContextMenu(KnobSlot& slot, juce::Point<int> screenPos)
{
    auto* param = processorRef.getAPVTS().getParameter(slot.paramId);
    if (auto* hContext = getHostContext())
    {
        if (auto hostMenu = hContext->getContextMenuForParameter(param))
        {
            auto localPos = getLocalPoint(nullptr, screenPos);
            hostMenu->showNativeMenu(localPos);
            return;
        }
    }

    auto* rangedParam = dynamic_cast<juce::RangedAudioParameter*>(param);

    juce::PopupMenu menu;
    const juce::String currentValueStr = slot.slider.getTextFromValue(slot.slider.getValue());
    const juce::String title = slot.nameLabel.getText().isNotEmpty()
        ? (slot.nameLabel.getText().toUpperCase() + "  (" + currentValueStr + ")")
        : (slot.paramId.toUpperCase() + "  (" + currentValueStr + ")");
    menu.addSectionHeader(title);
    menu.addSeparator();

    juce::String defaultText;
    float defaultDenormVal = 0.0f;
    if (rangedParam != nullptr)
    {
        defaultDenormVal = rangedParam->getNormalisableRange().convertFrom0to1(rangedParam->getDefaultValue());
        defaultText = rangedParam->getText(rangedParam->getDefaultValue(), 1024);
        if (defaultText.isEmpty())
            defaultText = slot.slider.getTextFromValue(defaultDenormVal);
    }
    else
    {
        defaultDenormVal = static_cast<float>(slot.slider.getMinimum());
        defaultText = slot.slider.getTextFromValue(defaultDenormVal);
    }

    menu.addItem(1, "Reset to Default (" + defaultText + ")");
    menu.addItem(2, "Set to Minimum (" + slot.slider.getTextFromValue(slot.slider.getMinimum()) + ")");
    menu.addItem(3, "Set to Maximum (" + slot.slider.getTextFromValue(slot.slider.getMaximum()) + ")");
    menu.addSeparator();
    menu.addItem(4, "Set to Exact Value...");

    juce::Component::SafePointer<BRAUN_AS42AudioProcessorEditor> safeThis(this);
    const juce::String paramId = slot.paramId;

    menu.showMenuAsync(
        juce::PopupMenu::Options()
            .withTargetScreenArea(juce::Rectangle<int>(screenPos.x, screenPos.y, 1, 1))
            .withTargetComponent(&slot.slider)
            .withParentComponent(this),
        [safeThis, paramId, defaultDenormVal](int result)
        {
            if (safeThis == nullptr || result <= 0)
                return;

            auto* currentSlot = safeThis->findKnob(paramId);
            if (currentSlot == nullptr)
                return;

            if (result == 1) // Reset to Default
            {
                currentSlot->slider.setValue(defaultDenormVal, juce::sendNotificationSync);
            }
            else if (result == 2) // Minimum
            {
                currentSlot->slider.setValue(currentSlot->slider.getMinimum(), juce::sendNotificationSync);
            }
            else if (result == 3) // Maximum
            {
                currentSlot->slider.setValue(currentSlot->slider.getMaximum(), juce::sendNotificationSync);
            }
            else if (result == 4) // Exact Value
            {
                if (safeThis->isNativeModeActive())
                {
                    currentSlot->slider.showTextBox();
                }
            }
        });
}


