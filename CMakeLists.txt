cmake_minimum_required(VERSION 3.22)

# Configure Apple deployment target before project()
if(APPLE)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS deployment target")
    if(NOT CMAKE_OSX_ARCHITECTURES)
        set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "macOS architectures")
    endif()
endif()

project(BRAUN_AS42_PROJECT VERSION 1.3.2 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Enable MSVC UTF-8 character encoding and warning level 4
if(MSVC)
    add_compile_options(/utf-8 /W4)
endif()

# ==============================================================================
# 1. Provision Microsoft.Web.WebView2 NuGet Package for Windows
# ==============================================================================
if(WIN32)
    set(WEBVIEW2_VERSION "1.0.2849.39")
    set(WEBVIEW2_DIR "${CMAKE_BINARY_DIR}/packages/Microsoft.Web.WebView2.${WEBVIEW2_VERSION}")
    if(NOT EXISTS "${WEBVIEW2_DIR}/build/native/include/WebView2.h")
        message(STATUS "Downloading Microsoft.Web.WebView2 NuGet package (${WEBVIEW2_VERSION})...")
        set(WEBVIEW2_ZIP "${CMAKE_BINARY_DIR}/webview2_${WEBVIEW2_VERSION}.zip")
        file(DOWNLOAD
            "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WEBVIEW2_VERSION}"
            "${WEBVIEW2_ZIP}"
            SHOW_PROGRESS
        )
        file(ARCHIVE_EXTRACT
            INPUT "${WEBVIEW2_ZIP}"
            DESTINATION "${WEBVIEW2_DIR}"
        )
        file(REMOVE "${WEBVIEW2_ZIP}")
    endif()
    set(JUCE_WEBVIEW2_PACKAGE_LOCATION "${CMAKE_BINARY_DIR}/packages" CACHE PATH "Path to WebView2 package" FORCE)
endif()

# ==============================================================================
# 2. Fetch and Configure JUCE 8
# ==============================================================================
include(FetchContent)
message(STATUS "Fetching JUCE 8 (8.0.6)...")
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.6
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

# ==============================================================================
# 3. Create Web Assets Archive (web_assets.zip)
# ==============================================================================
set(WEB_ASSETS_ZIP "${CMAKE_BINARY_DIR}/web_assets.zip")
file(GLOB_RECURSE WEB_ASSETS_FILES
    "${CMAKE_CURRENT_SOURCE_DIR}/index.html"
    "${CMAKE_CURRENT_SOURCE_DIR}/css/*"
    "${CMAKE_CURRENT_SOURCE_DIR}/js/*"
)

add_custom_command(
    OUTPUT "${WEB_ASSETS_ZIP}"
    COMMAND ${CMAKE_COMMAND} -E tar cf "${WEB_ASSETS_ZIP}" --format=zip index.html css js
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    DEPENDS ${WEB_ASSETS_FILES}
    COMMENT "Packaging web assets into web_assets.zip"
)
add_custom_target(PackageWebAssets DEPENDS "${WEB_ASSETS_ZIP}")

# Embed web assets via juce_add_binary_data
juce_add_binary_data(BraunWebAssets
    SOURCES "${WEB_ASSETS_ZIP}"
)
add_dependencies(BraunWebAssets PackageWebAssets)

# ==============================================================================
# 4. Declare BRAUN_AS42 Plugin Target
# ==============================================================================
set(PLUGIN_FORMATS VST3 Standalone)
if(APPLE)
    list(APPEND PLUGIN_FORMATS AU)
endif()

set(AS42_EXTRA_PLUGIN_ARGS "")
if(WIN32)
    list(APPEND AS42_EXTRA_PLUGIN_ARGS NEEDS_WEBVIEW2 TRUE)
endif()
if(UNIX AND NOT APPLE)
    list(APPEND AS42_EXTRA_PLUGIN_ARGS NEEDS_WEB_BROWSER TRUE)
endif()

juce_add_plugin(BRAUN_AS42
    COMPANY_NAME "Braun"
    VERSION 1.3.2
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
    PLUGIN_MANUFACTURER_CODE Brun
    PLUGIN_CODE As42
    FORMATS ${PLUGIN_FORMATS}
    PRODUCT_NAME "BRAUN_AS42"
    ${AS42_EXTRA_PLUGIN_ARGS}
)

target_sources(BRAUN_AS42
    PRIVATE
        plugin/source/PluginProcessor.cpp
        plugin/source/PluginProcessor.h
        plugin/source/PluginEditor.cpp
        plugin/source/PluginEditor.h
        plugin/source/Parameters.h
        plugin/source/dsp/DspEngine.cpp
        plugin/source/dsp/DspEngine.h
        plugin/source/dsp/DspMath.h
        plugin/source/dsp/FeltPianoDsp.h
        plugin/source/dsp/DroneVoiceDsp.h
        plugin/source/dsp/TapeDelayDsp.h
        plugin/source/dsp/ShimmerReverbDsp.h
        plugin/source/dsp/MasterLimiterDsp.h
        plugin/source/dsp/Wavetables.h
        plugin/source/web/WebResourceManager.cpp
        plugin/source/web/WebResourceManager.h
)

target_include_directories(BRAUN_AS42
    PRIVATE
        plugin/source
        plugin/source/dsp
)

target_compile_definitions(BRAUN_AS42
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_VST3_CAN_REPLACE_VST2=0
)
if(WIN32)
    target_compile_definitions(BRAUN_AS42
        PUBLIC
            JUCE_USE_WIN_WEBVIEW2=1
            JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    )
endif()

target_link_libraries(BRAUN_AS42
    PRIVATE
        BraunWebAssets
        juce::juce_audio_basics
        juce::juce_audio_devices
        juce::juce_audio_formats
        juce::juce_audio_plugin_client
        juce::juce_audio_processors
        juce::juce_audio_utils
        juce::juce_dsp
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags
)

if(UNIX AND NOT APPLE)
    find_package(CURL REQUIRED)
    target_link_libraries(BRAUN_AS42 PRIVATE CURL::libcurl)
endif()

# ==============================================================================
# 5. C++ DSP Test Executables
# ==============================================================================
option(AS42_BUILD_TESTS "Build AS-42 test executables" ON)

if(AS42_BUILD_TESTS)
    enable_testing()

    add_executable(dsp_tests
        test/cpp/dsp_tests.cpp
        plugin/source/dsp/DspEngine.cpp
    )
    target_include_directories(dsp_tests PRIVATE
        plugin/source
        plugin/source/dsp
    )
    add_test(NAME dsp_tests COMMAND dsp_tests)

    add_executable(challenger_stress_tests
        test/cpp/challenger_stress_tests.cpp
        plugin/source/dsp/DspEngine.cpp
    )
    target_include_directories(challenger_stress_tests PRIVATE
        plugin/source
        plugin/source/dsp
    )
    add_test(NAME challenger_stress_tests COMMAND challenger_stress_tests)

    add_executable(adversarial_challenge_suite
        test/cpp/adversarial_challenge_suite.cpp
        plugin/source/dsp/DspEngine.cpp
    )
    target_include_directories(adversarial_challenge_suite PRIVATE
        plugin/source
        plugin/source/dsp
    )
    add_test(NAME adversarial_challenge_suite COMMAND adversarial_challenge_suite)
endif()
