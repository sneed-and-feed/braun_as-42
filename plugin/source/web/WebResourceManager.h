#pragma once

#include <juce_gui_extra/juce_gui_extra.h>

#if JUCE_WEB_BROWSER
#include <optional>

namespace braun {

class WebResourceManager {
public:
    WebResourceManager();
    ~WebResourceManager() = default;

    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);

private:
    juce::String sanitizeUrl(const juce::String& url) const;
    juce::String getMimeTypeForPath(const juce::String& path) const;
};

} // namespace braun
#endif
