#include "WebResourceManager.h"

#if JUCE_WEB_BROWSER
#include <BinaryData.h>
#include <juce_core/juce_core.h>

namespace braun {

WebResourceManager::WebResourceManager()
{
}

juce::String WebResourceManager::sanitizeUrl(const juce::String& url) const
{
    juce::String path = url;

    // Strip scheme and virtual host
    if (path.startsWithIgnoreCase("https://juce.backend/"))
        path = path.substring(21);
    else if (path.startsWithIgnoreCase("http://juce.backend/"))
        path = path.substring(20);
    else if (path.startsWithIgnoreCase("https://juce.backend"))
        path = path.substring(20);
    else if (path.startsWithIgnoreCase("http://juce.backend"))
        path = path.substring(19);

    // Strip query string and URL fragments
    const int queryIdx = path.indexOfChar('?');
    if (queryIdx >= 0)
        path = path.substring(0, queryIdx);

    const int hashIdx = path.indexOfChar('#');
    if (hashIdx >= 0)
        path = path.substring(0, hashIdx);

    // Remove leading slashes
    while (path.startsWithChar('/') || path.startsWithChar('\\'))
        path = path.substring(1);

    if (path.isEmpty())
        path = "index.html";

    return path;
}

juce::String WebResourceManager::getMimeTypeForPath(const juce::String& path) const
{
    if (path.endsWithIgnoreCase(".html") || path.endsWithIgnoreCase(".htm"))
        return "text/html; charset=utf-8";
    if (path.endsWithIgnoreCase(".css"))
        return "text/css; charset=utf-8";
    if (path.endsWithIgnoreCase(".js") || path.endsWithIgnoreCase(".mjs"))
        return "text/javascript; charset=utf-8";
    if (path.endsWithIgnoreCase(".json"))
        return "application/json";
    if (path.endsWithIgnoreCase(".svg"))
        return "image/svg+xml";
    if (path.endsWithIgnoreCase(".png"))
        return "image/png";
    if (path.endsWithIgnoreCase(".jpg") || path.endsWithIgnoreCase(".jpeg"))
        return "image/jpeg";
    if (path.endsWithIgnoreCase(".woff2"))
        return "font/woff2";
    if (path.endsWithIgnoreCase(".woff"))
        return "font/woff";
    if (path.endsWithIgnoreCase(".ttf"))
        return "font/ttf";
    if (path.endsWithIgnoreCase(".wasm"))
        return "application/wasm";

    return "application/octet-stream";
}

std::optional<juce::WebBrowserComponent::Resource> WebResourceManager::getResource(const juce::String& url)
{
    const juce::String cleanPath = sanitizeUrl(url);
    const juce::String mimeType = getMimeTypeForPath(cleanPath);

    // 1. Check local file system fallback
    auto checkDiskFile = [&](const juce::File& file) -> std::optional<juce::WebBrowserComponent::Resource>
    {
        if (file.existsAsFile())
        {
            juce::MemoryBlock mb;
            if (file.loadFileAsData(mb))
            {
                std::vector<std::byte> data(mb.getSize());
                std::memcpy(data.data(), mb.getData(), mb.getSize());
                return juce::WebBrowserComponent::Resource { std::move(data), mimeType };
            }
        }
        return std::nullopt;
    };

    // Check current working directory
    if (auto res = checkDiskFile(juce::File::getCurrentWorkingDirectory().getChildFile(cleanPath)))
        return res;

    // Check ancestor directories of executable for local project layout
    auto dir = juce::File::getSpecialLocation(juce::File::SpecialLocationType::currentExecutableFile).getParentDirectory();
    for (int depth = 0; depth < 5; ++depth)
    {
        if (auto res = checkDiskFile(dir.getChildFile(cleanPath)))
            return res;
        dir = dir.getParentDirectory();
    }

    // 2. Unpack from embedded binary zip archive (BraunWebAssets)
    if (BinaryData::web_assets_zipSize > 0 && BinaryData::web_assets_zip != nullptr)
    {
        juce::MemoryInputStream memStream(BinaryData::web_assets_zip, static_cast<size_t>(BinaryData::web_assets_zipSize), false);
        juce::ZipFile zip(memStream);

        const juce::String normalizedPath = cleanPath.replaceCharacter('\\', '/');

        int entryIndex = zip.getIndexOfFileName(normalizedPath);
        if (entryIndex < 0)
        {
            // Search all entries case-insensitively without leading slashes
            for (int i = 0; i < zip.getNumEntries(); ++i)
            {
                const auto* entry = zip.getEntry(i);
                if (entry != nullptr)
                {
                    juce::String name = entry->filename.replaceCharacter('\\', '/');
                    while (name.startsWithChar('/'))
                        name = name.substring(1);

                    if (name.equalsIgnoreCase(normalizedPath))
                    {
                        entryIndex = i;
                        break;
                    }
                }
            }
        }

        if (entryIndex >= 0)
        {
            const auto* entry = zip.getEntry(entryIndex);
            if (entry != nullptr)
            {
                std::unique_ptr<juce::InputStream> stream(zip.createStreamForEntry(*entry));
                if (stream != nullptr)
                {
                    const size_t len = static_cast<size_t>(stream->getTotalLength());
                    std::vector<std::byte> data(len);
                    stream->read(data.data(), static_cast<int>(len));
                    return juce::WebBrowserComponent::Resource { std::move(data), mimeType };
                }
            }
        }
    }

    return std::nullopt;
}

} // namespace braun
#endif
