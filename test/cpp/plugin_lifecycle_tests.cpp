#include "PluginProcessor.h"
#if JUCE_WEB_BROWSER
#include "web/WebResourceManager.h"
#endif

#include <juce_events/juce_events.h>
#include <cmath>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

namespace {

int gTestsPassed = 0;
int gTestsFailed = 0;

#define TEST_ASSERT(cond, msg) \
    do { \
        if (!(cond)) { \
            std::cerr << "  [FAIL] Line " << __LINE__ << ": " << (msg) << "\n"; \
            ++gTestsFailed; \
            return; \
        } \
    } while (0)

#define RUN_TEST(fn) \
    do { \
        const int beforeFail = gTestsFailed; \
        std::cout << "[RUN ] " #fn "\n"; \
        fn(); \
        if (gTestsFailed == beforeFail) { \
            ++gTestsPassed; \
            std::cout << "[PASS] " #fn "\n"; \
        } \
    } while (0)

void setPlainParam(BRAUN_AS42AudioProcessor& proc, const char* id, float plainValue) {
    if (auto* p = proc.getAPVTS().getParameter(id)) {
        p->setValueNotifyingHost(p->convertTo0to1(plainValue));
    }
}

float getPlainParam(BRAUN_AS42AudioProcessor& proc, const char* id) {
    if (auto* raw = proc.getAPVTS().getRawParameterValue(id)) {
        return raw->load();
    }
    return 0.0f;
}

// ============================================================================
// Test 1: Standalone Startup Reload Disarms Drones & Freeze (Critical Bug Fix)
// ============================================================================
void test_standalone_startup_disarms_drones_and_freeze_on_reload() {
    juce::MemoryBlock savedStandaloneSettings;

    // 1. Simulate Session 1 of BRAUN_AS42.exe (Standalone): user enables drones & freeze, tweaks knobs, exits
    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Standalone);
        BRAUN_AS42AudioProcessor session1;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        TEST_ASSERT(session1.wrapperType == juce::AudioProcessor::wrapperType_Standalone,
                    "Session 1 must run under wrapperType_Standalone");
        TEST_ASSERT(!session1.getPoweredOn(), "Fresh Standalone instance must start in silent Standby");
        TEST_ASSERT(!session1.getDrone1Active(), "Fresh Standalone Drone 1 must start OFF");
        TEST_ASSERT(!session1.getDrone2Active(), "Fresh Standalone Drone 2 must start OFF");

        session1.prepareToPlay(48000.0, 512);
        session1.setCurrentProgram(2); // VANGELIS · CS-80 BRASS
        setPlainParam(session1, "drone1_cutoff", 1420.0f);
        setPlainParam(session1, "felt_tone", 0.77f);
        setPlainParam(session1, "shimmer_freeze", 1.0f);
        session1.setDroneTrackMidi(false);
        session1.setDrone1Active(true);
        session1.setDrone2Active(true);

        TEST_ASSERT(session1.getPoweredOn(), "Enabling drones in Session 1 must auto-wake power");

        juce::AudioBuffer<float> buf(2, 512);
        juce::MidiBuffer midi;
        float maxSession1Peak = 0.0f;
        for (int b = 0; b < 10; ++b) {
            session1.processBlock(buf, midi);
            maxSession1Peak = std::max(maxSession1Peak, buf.getMagnitude(0, 512));
        }
        TEST_ASSERT(maxSession1Peak > 0.02f, "Session 1 with active drones must produce audible output");

        // Simulate StandalonePluginHolder::savePluginState() on window close
        session1.getStateInformation(savedStandaloneSettings);
        TEST_ASSERT(savedStandaloneSettings.getSize() > 0, "Serialized Standalone state must be non-empty");
    }

    // 2. Simulate Session 2 of BRAUN_AS42.exe (Standalone cold launch reloading saved .settings!)
    //    Matches JUCE StandalonePluginHolder::init(): createPlugin -> reloadPluginState -> startPlaying
    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Standalone);
        BRAUN_AS42AudioProcessor session2;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        session2.setStateInformation(savedStandaloneSettings.getData(),
                                     static_cast<int>(savedStandaloneSettings.getSize()));
        session2.prepareToPlay(48000.0, 512);

        // Continuous sound latches MUST be disarmed on Standalone launch!
        TEST_ASSERT(!session2.getDrone1Active(), "Standalone cold boot MUST disarm Drone 1");
        TEST_ASSERT(!session2.getDrone2Active(), "Standalone cold boot MUST disarm Drone 2");
        TEST_ASSERT(!session2.getPoweredOn(), "Standalone cold boot MUST remain in Standby");
        TEST_ASSERT(getPlainParam(session2, "shimmer_freeze") < 0.5f,
                    "Standalone cold boot MUST disarm Shimmer Freeze");
        TEST_ASSERT(session2.consumeFullSyncRequested(),
                    "setStateInformation must request full WebView parameter sync");

        // User's sound design parameters & program selection MUST still be preserved!
        TEST_ASSERT(session2.getCurrentProgram() == 2, "Standalone reload must preserve currentProgram");
        TEST_ASSERT(std::abs(getPlainParam(session2, "drone1_cutoff") - 1420.0f) < 1.5f,
                    "Standalone reload must preserve drone1_cutoff");
        TEST_ASSERT(std::abs(getPlainParam(session2, "felt_tone") - 0.77f) < 0.02f,
                    "Standalone reload must preserve felt_tone");

        // Verify 20 audio blocks produce 100% bit-exact 0.0f silence on startup
        juce::AudioBuffer<float> buf(2, 512);
        juce::MidiBuffer emptyMidi;
        for (int b = 0; b < 20; ++b) {
            buf.setSample(0, 0, 0.5f); // Dirty host buffer check
            session2.processBlock(buf, emptyMidi);
            TEST_ASSERT(buf.getMagnitude(0, 512) == 0.0f,
                        "Standalone startup must output bit-exact 0.0f silence");
        }

        // Even after user clicks POWER ON, output MUST remain 0.0f until user explicitly engages drones/notes
        session2.setPoweredOn(true);
        for (int b = 0; b < 20; ++b) {
            session2.processBlock(buf, emptyMidi);
            TEST_ASSERT(buf.getMagnitude(0, 512) == 0.0f,
                        "Powering ON Standalone without engaging drones must still output bit-exact 0.0f");
        }

        // Once user explicitly engages Drone 1, audio renders cleanly
        session2.setDrone1Active(true);
        float maxEngagedPeak = 0.0f;
        for (int b = 0; b < 10; ++b) {
            session2.processBlock(buf, emptyMidi);
            maxEngagedPeak = std::max(maxEngagedPeak, buf.getMagnitude(0, 512));
        }
        TEST_ASSERT(maxEngagedPeak > 0.02f, "Explicitly engaging Drone 1 in Session 2 must produce audio");
    }

    // 3. Also verify prepareToPlay -> setStateInformation order in Standalone
    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Standalone);
        BRAUN_AS42AudioProcessor session2Alt;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        session2Alt.prepareToPlay(48000.0, 512);
        session2Alt.setStateInformation(savedStandaloneSettings.getData(),
                                        static_cast<int>(savedStandaloneSettings.getSize()));
        TEST_ASSERT(!session2Alt.getDrone1Active() && !session2Alt.getDrone2Active(),
                    "Standalone startup guard must hold regardless of prepareToPlay order");
    }
}

// ============================================================================
// Test 2: VST3 / DAW Host Session Recall Restores Active Drones Faithfully
// ============================================================================
void test_vst3_daw_session_recall_restores_active_drones() {
    juce::MemoryBlock dawSessionData;

    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor vstSave;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        TEST_ASSERT(vstSave.wrapperType == juce::AudioProcessor::wrapperType_VST3, "Must be VST3 wrapper");
        TEST_ASSERT(vstSave.getPoweredOn(), "VST3 instance must default to powered-on ready state");

        vstSave.prepareToPlay(48000.0, 512);
        vstSave.setDrone1Active(true);
        vstSave.setDrone2Active(true);
        vstSave.setDroneTrackMidi(false);
        vstSave.getStateInformation(dawSessionData);
    }

    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor vstLoad;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        vstLoad.prepareToPlay(48000.0, 512);
        vstLoad.setStateInformation(dawSessionData.getData(), static_cast<int>(dawSessionData.getSize()));

        TEST_ASSERT(vstLoad.getDrone1Active(), "VST3 DAW project recall MUST restore Drone 1 active state");
        TEST_ASSERT(vstLoad.getDrone2Active(), "VST3 DAW project recall MUST restore Drone 2 active state");
        TEST_ASSERT(vstLoad.getPoweredOn(), "VST3 DAW project recall MUST restore power state");

        juce::AudioBuffer<float> buf(2, 512);
        juce::MidiBuffer emptyMidi;
        float peak = 0.0f;
        for (int b = 0; b < 10; ++b) {
            vstLoad.processBlock(buf, emptyMidi);
            peak = std::max(peak, buf.getMagnitude(0, 512));
        }
        TEST_ASSERT(peak > 0.02f, "Restored VST3 DAW project with active drones must render audio immediately");
    }
}

// ============================================================================
// Test 3: Lifecycle Re-Entry, Tail Length, Scope Flush & 0-Sample MIDI Blocks
// ============================================================================
void test_lifecycle_reentry_tail_length_scope_and_zero_sample_midi() {
    juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
    BRAUN_AS42AudioProcessor proc;
    juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

    proc.prepareToPlay(44100.0, 256);

    // Tail length semantics: finite >= 8s when idle/playing, infinity when drone/freeze active, 0 when Standby
    TEST_ASSERT(proc.getTailLengthSeconds() >= 8.0 && std::isfinite(proc.getTailLengthSeconds()),
                "Default powered tail length must be finite >= 8.0s");

    proc.setDrone1Active(true);
    TEST_ASSERT(std::isinf(proc.getTailLengthSeconds()),
                "Active drone must report infinite tail length to prevent DAW auto-suspend");
    proc.setDrone1Active(false);

    // Trigger MIDI note-on, render audio, verify scope buffer populated, then power off -> scope must flush to 0
    juce::AudioBuffer<float> buf(2, 256);
    juce::MidiBuffer midiOn;
    midiOn.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(100)), 0);
    proc.processBlock(buf, midiOn);
    for (int b = 0; b < 4; ++b) {
        juce::MidiBuffer empty;
        proc.processBlock(buf, empty);
    }
    TEST_ASSERT(proc.getDspEngine().hasActiveMidiNotes(), "Note 60 must be held");

    // Deliver Note-Off via a 0-sample VST3 parameter-flush block
    juce::AudioBuffer<float> zeroSampleBuf(2, 0);
    juce::MidiBuffer midiOff;
    midiOff.addEvent(juce::MidiMessage::noteOff(1, 60), 0);
    proc.processBlock(zeroSampleBuf, midiOff);
    TEST_ASSERT(!proc.getDspEngine().hasActiveMidiNotes(),
                "Note-Off in 0-sample processBlock must release held MIDI key");

    // Power off -> tail length 0.0 and scope buffers flushed
    proc.setPoweredOn(false);
    TEST_ASSERT(proc.getTailLengthSeconds() == 0.0, "Standby tail length must be 0.0s");
    std::vector<float> scopeL(256, 1.0f), scopeR(256, 1.0f);
    proc.getScopeSamples(scopeL.data(), scopeR.data(), 256);
    for (int i = 0; i < 256; ++i) {
        TEST_ASSERT(scopeL[i] == 0.0f && scopeR[i] == 0.0f, "Standby must flush oscilloscope ring buffers");
    }

    // Lifecycle re-entry: releaseResources -> prepareToPlay at 96 kHz with >2048 block size
    proc.setPoweredOn(true);
    proc.releaseResources();
    proc.prepareToPlay(96000.0, 4096);

    juce::AudioBuffer<float> largeBuf(2, 4096);
    juce::MidiBuffer chordMidi;
    chordMidi.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(95)), 0);
    chordMidi.addEvent(juce::MidiMessage::noteOn(1, 67, static_cast<juce::uint8>(95)), 128);
    proc.processBlock(largeBuf, chordMidi);

    for (int ch = 0; ch < 2; ++ch) {
        const float* ptr = largeBuf.getReadPointer(ch);
        for (int i = 0; i < 4096; ++i) {
            TEST_ASSERT(std::isfinite(ptr[i]) && std::abs(ptr[i]) <= 1.0f,
                        "96 kHz 4096-sample block after lifecycle re-entry produced invalid sample");
        }
    }
}

#if JUCE_WEB_BROWSER
// ============================================================================
// Test 4: WebResourceManager Path Traversal Security Guard
// ============================================================================
void test_web_resource_manager_path_traversal_guard() {
    braun::WebResourceManager resMgr;

    auto okRoot = resMgr.getResource("https://juce.backend/index.html");
    TEST_ASSERT(okRoot.has_value() && !okRoot->data.empty(),
                "Valid index.html asset must resolve cleanly");

    auto blockedUnix = resMgr.getResource("https://juce.backend/../../CMakeLists.txt");
    TEST_ASSERT(!blockedUnix.has_value(), "Unix-style .. traversal must be rejected");

    auto blockedWin = resMgr.getResource("https://juce.backend/..\\..\\CMakeLists.txt");
    TEST_ASSERT(!blockedWin.has_value(), "Windows-style .. traversal must be rejected");

    auto blockedDrive = resMgr.getResource("https://juce.backend/C:/Windows/win.ini");
    TEST_ASSERT(!blockedDrive.has_value(), "Drive-qualified path must be rejected");
}
#endif

} // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juceInit;

    std::cout << "========================================================\n";
    std::cout << "  BRAUN AS 42 JUCE AudioProcessor Lifecycle Test Suite  \n";
    std::cout << "========================================================\n";

    RUN_TEST(test_standalone_startup_disarms_drones_and_freeze_on_reload);
    RUN_TEST(test_vst3_daw_session_recall_restores_active_drones);
    RUN_TEST(test_lifecycle_reentry_tail_length_scope_and_zero_sample_midi);
#if JUCE_WEB_BROWSER
    RUN_TEST(test_web_resource_manager_path_traversal_guard);
#endif

    std::cout << "========================================================\n";
    std::cout << "Summary: " << gTestsPassed << " passed, " << gTestsFailed << " failed.\n";
    std::cout << "========================================================\n";

    return (gTestsFailed == 0) ? 0 : 1;
}
