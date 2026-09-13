#include "PluginEditor.h"

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

} // namespace

juce::WebBrowserComponent::Options BRAUN_AS42AudioProcessorEditor::createWebOptions(BRAUN_AS42AudioProcessorEditor& editor)
{
    auto options = juce::WebBrowserComponent::Options{}
#if JUCE_WINDOWS
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            juce::WebBrowserComponent::Options::WinWebView2{}
                .withUserDataFolder(juce::File::getSpecialLocation(juce::File::SpecialLocationType::tempDirectory).getChildFile("BraunAS42_WebView2")))
#endif
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
    addAndMakeVisible(webComponent);
    registerParameterListeners();

    setSize(1024, 720);
    setResizable(true, true);
    setResizeLimits(800, 560, 1920, 1080);

    startTimerHz(30);

    webComponent.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}

BRAUN_AS42AudioProcessorEditor::~BRAUN_AS42AudioProcessorEditor()
{
    stopTimer();
    unregisterParameterListeners();
}

void BRAUN_AS42AudioProcessorEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff222222));
}

void BRAUN_AS42AudioProcessorEditor::resized()
{
    webComponent.setBounds(getLocalBounds());
}

void BRAUN_AS42AudioProcessorEditor::parameterChanged(const juce::String& parameterID, float newValue)
{
    juce::Component::SafePointer<BRAUN_AS42AudioProcessorEditor> safeThis(this);
    juce::MessageManager::callAsync([safeThis, parameterID, newValue]()
    {
        if (safeThis != nullptr)
        {
            safeThis->sendParameterUpdateToWeb(parameterID, newValue);
        }
    });
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

            // Also emit under the native APVTS ID for direct bindings
            auto* obj2 = new juce::DynamicObject();
            obj2->setProperty("id", item.apvtsId);
            obj2->setProperty("value", newValue);
            webComponent.emitEventIfBrowserIsVisible("paramUpdate", juce::var(obj2));
            return;
        }
    }
}

void BRAUN_AS42AudioProcessorEditor::timerCallback()
{
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

void BRAUN_AS42AudioProcessorEditor::syncAllParametersToWeb()
{
    sendPowerUpdateToWeb(processorRef.getPoweredOn());
    sendDroneActiveUpdateToWeb(1, processorRef.getDrone1Active());
    sendDroneActiveUpdateToWeb(2, processorRef.getDrone2Active());

    for (const auto& item : kParamMap)
    {
        if (auto* param = processorRef.getAPVTS().getParameter(item.apvtsId))
        {
            const float currentVal = param->getValue() * (param->getNormalisableRange().end - param->getNormalisableRange().start) + param->getNormalisableRange().start;
            sendParameterUpdateToWeb(item.apvtsId, currentVal);
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

    // Handle discrete engine power and drone active state controls
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
