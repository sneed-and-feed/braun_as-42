#include "PluginEditor.h"
#include <cstdlib>
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
    { "felt_volume",      "feltLevel",     0.01f },
    { "felt_decay",       "feltDecay",     1.0f  },
    { "felt_tone",        "feltTone",      0.01f },
    { "felt_hammer",      "feltHammer",    0.01f },
    { "felt_space",       "feltSymp",      0.01f },
    { "drone1_volume",    "drone1Vol",     0.01f },
    { "drone1_pitch",     "drone1Pitch",   1.0f  },
    { "drone1_fold",      "drone1Fold",    1.0f  },
    { "drone1_cutoff",    "drone1Cutoff",  1.0f  },
    { "drone1_resonance", "drone1Res",     1.0f  },
    { "drone2_volume",    "drone2Vol",     0.01f },
    { "drone2_pitch",     "drone2Pitch",   1.0f  },
    { "drone2_fold",      "drone2Fold",    1.0f  },
    { "drone2_cutoff",    "drone2Cutoff",  1.0f  },
    { "drone2_resonance", "drone2Res",     1.0f  },
    { "tape_time",        "delayTime",     0.001f }, // 460ms -> 0.46s
    { "tape_feedback",    "delayFeedback", 0.01f },
    { "tape_mix",         "delayWet",      0.01f },
    { "tape_wow",         "delayWow",      0.01f },
    { "shimmer_mix",      "reverbWet",     0.01f },
    { "shimmer_decay",    "reverbDecay",   1.0f  },
    { "master_volume",    "masterVol",     0.01f }
};

static_assert(std::size(kParamMap) == 22, "kParamMap size must match pendingParamValues array size");

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
        });

    return options;
}

BRAUN_AS42AudioProcessorEditor::BRAUN_AS42AudioProcessorEditor(BRAUN_AS42AudioProcessor& p)
    : AudioProcessorEditor(&p),
      processorRef(p),
      webComponent(createWebOptions(*this))
{
    // Prevent FL Studio and Windows DWM from performing expensive alpha compositing
    setOpaque(true);
    webComponent.setOpaque(true);

    addAndMakeVisible(webComponent);
    registerParameterListeners();

    setSize(1024, 720);
    setResizable(true, true);
    setResizeLimits(800, 560, 1920, 1080);

    startTimerHz(25);

    webComponent.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}

BRAUN_AS42AudioProcessorEditor::~BRAUN_AS42AudioProcessorEditor()
{
    stopTimer();
    unregisterParameterListeners();
}

void BRAUN_AS42AudioProcessorEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff121414));
}

void BRAUN_AS42AudioProcessorEditor::resized()
{
    webComponent.setBounds(getLocalBounds());
}

void BRAUN_AS42AudioProcessorEditor::parentHierarchyChanged()
{
    AudioProcessorEditor::parentHierarchyChanged();
    hwndStylesConfigured = false;
    ensureHwndStyles();
}

void BRAUN_AS42AudioProcessorEditor::ensureHwndStyles()
{
#if JUCE_WINDOWS
    if (auto* peer = getPeer())
    {
        HWND hwnd = static_cast<HWND>(peer->getNativeHandle());
        if (hwnd == nullptr)
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

    // Coalesced dirty parameter dispatch at a smooth, stable 25 Hz
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

void BRAUN_AS42AudioProcessorEditor::syncAllParametersToWeb()
{
    sendPowerUpdateToWeb(processorRef.getPoweredOn());
    sendDroneActiveUpdateToWeb(1, processorRef.getDrone1Active());
    sendDroneActiveUpdateToWeb(2, processorRef.getDrone2Active());
    sendDroneTrackUpdateToWeb(processorRef.getDroneTrackMidi());

    for (const auto& item : kParamMap)
    {
        if (auto* rawVal = processorRef.getAPVTS().getRawParameterValue(item.apvtsId))
        {
            sendParameterUpdateToWeb(item.apvtsId, rawVal->load(std::memory_order_relaxed));
        }
    }
}

void BRAUN_AS42AudioProcessorEditor::handleParamChangeFromWeb(const juce::var& data)
{
    if (!data.isObject())
        return;

    auto* obj = data.getDynamicObject();
    if (obj == nullptr)
        return;

    const juce::String incomingId = obj->getProperty("id").toString();
    const float incomingVal = static_cast<float>(obj->getProperty("value"));

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
            targetApvtsVal = incomingVal;
            break;
        }
    }

    if (targetApvtsId.isEmpty())
    {
        if (incomingId.equalsIgnoreCase("drone1Level"))
        {
            targetApvtsId = "drone1_volume";
            targetApvtsVal = incomingVal * 0.01f;
        }
        else if (incomingId.equalsIgnoreCase("drone2Level"))
        {
            targetApvtsId = "drone2_volume";
            targetApvtsVal = incomingVal * 0.01f;
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
