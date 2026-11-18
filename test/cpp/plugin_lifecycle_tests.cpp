#include "PluginProcessor.h"
#include "PluginEditor.h"
#if JUCE_WEB_BROWSER
#include "web/WebResourceManager.h"
#endif

#include <juce_events/juce_events.h>
#include <juce_gui_basics/juce_gui_basics.h>
#if JUCE_WINDOWS
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif
#include <atomic>
#include <cmath>
#include <iostream>
#include <limits>
#include <string>
#include <thread>
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
            TEST_ASSERT(std::abs(buf.getMagnitude(0, 512)) <= 0.0f,
                        "Standalone startup must output bit-exact 0.0f silence");
        }

        // Even after user clicks POWER ON, output MUST remain 0.0f until user explicitly engages drones/notes
        session2.setPoweredOn(true);
        for (int b = 0; b < 20; ++b) {
            session2.processBlock(buf, emptyMidi);
            TEST_ASSERT(std::abs(buf.getMagnitude(0, 512)) <= 0.0f,
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

    // Power off -> scope buffers flushed immediately; tail length stays > 0.0 (50 ms guard)
    // until the 45 ms C1 Hermite power-off fade reaches silence, then drops to exact 0.0s!
    proc.setPoweredOn(false);
    TEST_ASSERT(proc.getTailLengthSeconds() > 0.0 && proc.getTailLengthSeconds() <= 0.1,
                "Active power-off fade must report 50ms tail so VST3/AU hosts never suspend mid-fade");
    std::vector<float> scopeL(256, 1.0f), scopeR(256, 1.0f);
    proc.getScopeSamples(scopeL.data(), scopeR.data(), 256);
    for (size_t i = 0; i < 256; ++i) {
        TEST_ASSERT(std::abs(scopeL[i]) <= 0.0f && std::abs(scopeR[i]) <= 0.0f,
                    "Standby must flush oscilloscope ring buffers");
    }
    for (int b = 0; b < 12; ++b) {
        juce::MidiBuffer empty;
        proc.processBlock(buf, empty);
    }
    TEST_ASSERT(std::abs(proc.getTailLengthSeconds()) <= 0.0,
                "Standby tail length must drop to 0.0s once 45ms Hermite fade reaches dspSilent");

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

// ============================================================================
// Test 5: Power Off While Drones Are Running Stays Off & Fades Click-Free
// ============================================================================
void test_power_off_with_active_drones_stays_off_and_fades_click_free() {
    juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Standalone);
    BRAUN_AS42AudioProcessor proc;
    juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

    proc.prepareToPlay(48000.0, 512);

    // Engage both Drone 1 (Sub-Bass ON, max volume), Drone 2 (max volume), and Shimmer Freeze
    setPlainParam(proc, "drone1_volume", 1.0f);
    setPlainParam(proc, "drone1_isSubBass", 1.0f);
    setPlainParam(proc, "drone1_pitch", 32.70f);
    setPlainParam(proc, "drone2_volume", 1.0f);
    setPlainParam(proc, "shimmer_freeze", 1.0f);
    setPlainParam(proc, "master_volume", 0.90f);
    proc.setDrone1Active(true);
    proc.setDrone2Active(true);

    TEST_ASSERT(proc.getPoweredOn(), "Engaging drones must auto-wake power");

    juce::AudioBuffer<float> buf(2, 512);
    juce::MidiBuffer emptyMidi;

    // Render 20 blocks (~213 ms) so drones, delay, and shimmer reverb reach full steady-state oscillation
    float steadyPeak = 0.0f;
    for (int b = 0; b < 20; ++b) {
        proc.processBlock(buf, emptyMidi);
        steadyPeak = std::max(steadyPeak, buf.getMagnitude(0, 512));
    }
    TEST_ASSERT(steadyPeak > 0.08f, "Active drones must produce strong steady-state signal prior to power-off");

    float prevL = buf.getSample(0, 511);
    float prevR = buf.getSample(1, 511);
    proc.consumePowerStateDirty();

    // Press POWER OFF while BOTH drones and Shimmer Freeze are actively running!
    proc.setPoweredOn(false);
    TEST_ASSERT(!proc.getPoweredOn(), "setPoweredOn(false) must immediately set isPoweredOn = false");
    TEST_ASSERT(proc.consumePowerStateDirty(), "setPoweredOn(false) must mark powerStateDirty");

    // Process 12 blocks (~128 ms > 45 ms Hermite fade) and verify:
    // 1) isPoweredOn NEVER flips back to true even though drone1Active & drone2Active remain true!
    // 2) Sample-to-sample derivative across the power-off boundary and entire fade has ZERO click/pop!
    // 3) Audio reaches exact 0.0f silence after the 45 ms fade and stays strictly 0.0f!
    float maxSampleDelta = 0.0f;
    for (int b = 0; b < 12; ++b) {
        proc.processBlock(buf, emptyMidi);
        TEST_ASSERT(!proc.getPoweredOn(),
                    "processBlock MUST NOT re-enable power while drones remain armed after setPoweredOn(false)");
        TEST_ASSERT(!proc.consumePowerStateDirty(),
                    "processBlock MUST NOT emit spurious powerStateDirty while powered off with armed drones");

        const float* l = buf.getReadPointer(0);
        const float* r = buf.getReadPointer(1);
        for (int i = 0; i < 512; ++i) {
            TEST_ASSERT(std::isfinite(l[i]) && std::isfinite(r[i]), "Fade-out sample must be finite");
            const float dL = std::abs(l[i] - prevL);
            const float dR = std::abs(r[i] - prevR);
            maxSampleDelta = std::max(maxSampleDelta, std::max(dL, dR));
            prevL = l[i];
            prevR = r[i];
        }
    }

    TEST_ASSERT(maxSampleDelta < 0.05f,
                "Power-off with running sub-bass & drones must fade click-free without step discontinuity");

    // Subsequent blocks must be bit-exact 0.0f silence while drones stay armed
    for (int b = 0; b < 10; ++b) {
        buf.setSample(0, 0, 0.25f);
        proc.processBlock(buf, emptyMidi);
        TEST_ASSERT(!proc.getPoweredOn(), "Synth must remain powered off");
        TEST_ASSERT(proc.getDrone1Active() && proc.getDrone2Active(), "Drone switches remain armed");
        TEST_ASSERT(buf.getMagnitude(0, 512) == 0.0f,
                    "Post-fade Standby blocks must output bit-exact 0.0f silence");
    }

    // Power back ON with armed drones: must start click-free from 0 and smoothly ramp back up,
    // and survive rapid mid-fade Power ON -> OFF -> ON toggling without pops!
    proc.setPoweredOn(true);
    prevL = 0.0f;
    prevR = 0.0f;
    float rapidToggleMaxDelta = 0.0f;
    for (int b = 0; b < 2; ++b) {
        proc.processBlock(buf, emptyMidi);
        const float* l = buf.getReadPointer(0);
        const float* r = buf.getReadPointer(1);
        for (int i = 0; i < 512; ++i) {
            rapidToggleMaxDelta = std::max(rapidToggleMaxDelta,
                                           std::max(std::abs(l[i] - prevL), std::abs(r[i] - prevR)));
            prevL = l[i];
            prevR = r[i];
        }
    }
    // Toggle OFF mid-fade-in, render 1 block (~10.6 ms), then toggle ON again!
    proc.setPoweredOn(false);
    proc.processBlock(buf, emptyMidi);
    for (int i = 0; i < 512; ++i) {
        rapidToggleMaxDelta = std::max(rapidToggleMaxDelta,
            std::max(std::abs(buf.getSample(0, i) - prevL), std::abs(buf.getSample(1, i) - prevR)));
        prevL = buf.getSample(0, i);
        prevR = buf.getSample(1, i);
    }
    proc.setPoweredOn(true);
    float resumedPeak = 0.0f;
    for (int b = 0; b < 12; ++b) {
        proc.processBlock(buf, emptyMidi);
        for (int i = 0; i < 512; ++i) {
            rapidToggleMaxDelta = std::max(rapidToggleMaxDelta,
                std::max(std::abs(buf.getSample(0, i) - prevL), std::abs(buf.getSample(1, i) - prevR)));
            prevL = buf.getSample(0, i);
            prevR = buf.getSample(1, i);
        }
        resumedPeak = std::max(resumedPeak, buf.getMagnitude(0, 512));
    }
    TEST_ASSERT(rapidToggleMaxDelta < 0.06f,
                "Rapid mid-fade power ON/OFF/ON toggling must remain strictly click-free");
    TEST_ASSERT(resumedPeak > 0.05f,
                "Powering back ON with armed drones must smoothly resume audio");
}

// ============================================================================
// Test 6: Editor Minimize/Close/Reopen & Extended UI State Persistence
// ============================================================================
void test_editor_reopen_and_extended_ui_state_persistence() {
    juce::MemoryBlock stateBlob;

    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor proc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        proc.prepareToPlay(48000.0, 512);
        proc.setCurrentProgram(2); // VANGELIS
        setPlainParam(proc, "felt_tone", 0.84f);
        setPlainParam(proc, "drone1_cutoff", 1950.0f);
        setPlainParam(proc, "shimmer_decay", 16.5f);

        // Simulate user customizing non-APVTS Web UI settings via handleParamChangeFromWeb
        {
            std::unique_ptr<juce::AudioProcessorEditor> ed1(proc.createEditor());
            auto* as42Ed1 = dynamic_cast<BRAUN_AS42AudioProcessorEditor*>(ed1.get());
            TEST_ASSERT(as42Ed1 != nullptr, "Editor must be BRAUN_AS42AudioProcessorEditor");

            auto sendWebParam = [&](const char* id, const juce::var& val) {
                auto* obj = new juce::DynamicObject();
                obj->setProperty("id", id);
                obj->setProperty("value", val);
                as42Ed1->handleParamChangeFromWeb(juce::var(obj));
            };

            sendWebParam("uiTheme", "dark");
            sendWebParam("rootPitchClass", 6);
            sendWebParam("scaleKey", "LYDIAN_AMBIENT");
            sendWebParam("tuningA4", 432.0f);
            sendWebParam("masterDrive", 44.0f);
            sendWebParam("poissonDensity", 22.0f);
            sendWebParam("poissonHumanize", 81.0f);
            sendWebParam("chordSpeed", "slow");
            sendWebParam("scopeMode", "lissajous");
            sendWebParam("drone1Snap", "warm-root");
            sendWebParam("drone2Snap", "major-9th");
            sendWebParam("vectorX", 0.77f);
            sendWebParam("vectorY", 0.33f);
            sendWebParam("requestSync", 1.0f);
        }

        // Destroy editor 1 and reopen editor 2 (simulating DAW plugin window close/minimize & reopen)
        {
            std::unique_ptr<juce::AudioProcessorEditor> ed2(proc.createEditor());
            TEST_ASSERT(ed2 != nullptr, "Reopened editor must construct cleanly");
        }

        TEST_ASSERT(proc.getCurrentProgram() == 2, "Editor close/reopen must preserve currentProgram");
        TEST_ASSERT(std::abs(getPlainParam(proc, "felt_tone") - 0.84f) < 0.01f,
                    "Editor close/reopen must preserve felt_tone");
        TEST_ASSERT(std::abs(getPlainParam(proc, "drone1_cutoff") - 1950.0f) < 2.0f,
                    "Editor close/reopen must preserve drone1_cutoff");

        // Also test VST3 state save while powered OFF with Drone 1 armed
        proc.setDrone1Active(true);
        proc.setPoweredOn(false);
        proc.getStateInformation(stateBlob);
    }

    // Restore into a new VST3 processor instance and verify 100% of APVTS + extended UI + power state!
    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor restored;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        restored.prepareToPlay(48000.0, 512);
        restored.setStateInformation(stateBlob.getData(), static_cast<int>(stateBlob.getSize()));

        TEST_ASSERT(restored.getDrone1Active(), "Restored VST3 must preserve armed Drone 1");
        TEST_ASSERT(!restored.getPoweredOn(),
                    "Restored VST3 saved in Standby with armed drone MUST stay in Standby");
        TEST_ASSERT(restored.getCurrentProgram() == 2, "Restored VST3 must preserve currentProgram");
        TEST_ASSERT(std::abs(getPlainParam(restored, "felt_tone") - 0.84f) < 0.01f,
                    "Restored VST3 must preserve felt_tone");
        TEST_ASSERT(std::abs(getPlainParam(restored, "shimmer_decay") - 16.5f) < 0.1f,
                    "Restored VST3 must preserve shimmer_decay");

        const auto ui = restored.getUIExtendedState();
        TEST_ASSERT(ui.uiTheme == "dark", "uiTheme must persist");
        TEST_ASSERT(ui.rootPitchClass == 6, "rootPitchClass must persist");
        TEST_ASSERT(ui.scaleKey == "LYDIAN_AMBIENT", "scaleKey must persist");
        TEST_ASSERT(std::abs(ui.tuningA4 - 432.0f) < 0.01f, "tuningA4 must persist");
        TEST_ASSERT(std::abs(ui.masterDrive - 44.0f) < 0.01f, "masterDrive must persist");
        TEST_ASSERT(std::abs(ui.poissonDensity - 22.0f) < 0.01f, "poissonDensity must persist");
        TEST_ASSERT(std::abs(ui.poissonHumanize - 81.0f) < 0.01f, "poissonHumanize must persist");
        TEST_ASSERT(ui.chordSpeed == "slow", "chordSpeed must persist");
        TEST_ASSERT(ui.scopeMode == "lissajous", "scopeMode must persist");
        TEST_ASSERT(ui.drone1Snap == "warm-root", "drone1Snap must persist");
        TEST_ASSERT(ui.drone2Snap == "major-9th", "drone2Snap must persist");
        TEST_ASSERT(std::abs(ui.vectorX - 0.77f) < 0.01f, "vectorX must persist");
        TEST_ASSERT(std::abs(ui.vectorY - 0.33f) < 0.01f, "vectorY must persist");
    }
}

// ============================================================================
// Test 7: Extreme Block Sizes (1 & 8192), MIDI Noise in Standby, & Master Drive
// ============================================================================
void test_extreme_blocks_midi_noise_and_master_drive_dsp() {
    auto runPowerOffContinuityCase = [](double sampleRate, int blockSize) -> bool {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Standalone);
        BRAUN_AS42AudioProcessor proc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        proc.prepareToPlay(sampleRate, blockSize);
        setPlainParam(proc, "drone1_volume", 1.0f);
        setPlainParam(proc, "drone1_isSubBass", 1.0f);
        setPlainParam(proc, "drone1_resonance", 0.95f);
        setPlainParam(proc, "drone1_wavefold", 1.0f);
        setPlainParam(proc, "drone2_volume", 1.0f);
        setPlainParam(proc, "drone2_resonance", 0.95f);
        setPlainParam(proc, "drone2_wavefold", 1.0f);
        setPlainParam(proc, "master_volume", 0.95f);
        proc.setDrone1Active(true);
        proc.setDrone2Active(true);

        juce::AudioBuffer<float> buf(2, blockSize);
        juce::MidiBuffer emptyMidi;

        const int warmupSamples = static_cast<int>(sampleRate * 0.12); // 120 ms warmup
        const int warmupBlocks = std::max(2, (warmupSamples + blockSize - 1) / blockSize);
        float peakBeforeOff = 0.0f;
        for (int b = 0; b < warmupBlocks; ++b) {
            proc.processBlock(buf, emptyMidi);
            peakBeforeOff = std::max(peakBeforeOff, buf.getMagnitude(0, blockSize));
        }
        if (peakBeforeOff <= 0.05f) return false;

        float prevL = buf.getSample(0, blockSize - 1);
        float prevR = buf.getSample(1, blockSize - 1);

        // Press Power Off mid-stream with max resonance + wavefold drones running
        proc.setPoweredOn(false);

        const int fadeBlocks = std::max(2, static_cast<int>((sampleRate * 0.10 + blockSize - 1) / blockSize));
        float maxDelta = 0.0f;
        for (int b = 0; b < fadeBlocks; ++b) {
            proc.processBlock(buf, emptyMidi);
            if (proc.getPoweredOn()) return false;
            const float* l = buf.getReadPointer(0);
            const float* r = buf.getReadPointer(1);
            for (int i = 0; i < blockSize; ++i) {
                if (!std::isfinite(l[i]) || !std::isfinite(r[i])) return false;
                maxDelta = std::max(maxDelta, std::max(std::abs(l[i] - prevL), std::abs(r[i] - prevR)));
                prevL = l[i];
                prevR = r[i];
            }
        }
        // High-frequency wavefolded drones have higher natural slope at 44.1 kHz vs 192 kHz,
        // but must never exhibit a full-scale step discontinuity
        const float maxAllowedSlope = (sampleRate > 100000.0) ? 0.08f : 0.25f;
        if (maxDelta > maxAllowedSlope) return false;

        // Post-fade blocks must be bit-exact 0.0f
        proc.processBlock(buf, emptyMidi);
        return (buf.getMagnitude(0, blockSize) == 0.0f && !proc.getPoweredOn());
    };

    TEST_ASSERT(runPowerOffContinuityCase(44100.0, 1),
                "1-sample blocks at 44.1 kHz must fade power off cleanly without clicks or auto-wake");
    TEST_ASSERT(runPowerOffContinuityCase(44100.0, 8192),
                "8192-sample blocks at 44.1 kHz must fade power off cleanly within a single oversized block");
    TEST_ASSERT(runPowerOffContinuityCase(192000.0, 8192),
                "8192-sample blocks at 192 kHz must fade power off cleanly to bit-exact 0.0f");

    // Verify MIDI controller noise (CC1, CC64, PitchBend, Active Sensing 0xFE, NoteOn vel=0, NoteOff)
    // NEVER wakes Standby while drones are armed, whereas real NoteOn(vel>0) DOES wake Standby
    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Standalone);
        BRAUN_AS42AudioProcessor proc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        proc.prepareToPlay(48000.0, 256);
        proc.setDrone1Active(true);
        proc.setPoweredOn(false);

        juce::AudioBuffer<float> buf(2, 256);
        juce::MidiBuffer waitFade;
        for (int b = 0; b < 12; ++b) proc.processBlock(buf, waitFade);
        TEST_ASSERT(!proc.getPoweredOn() && buf.getMagnitude(0, 256) == 0.0f, "Must settle into Standby silence");

        juce::MidiBuffer controllerNoise;
        controllerNoise.addEvent(juce::MidiMessage::controllerEvent(1, 1, 90), 0);   // CC1 Mod Wheel
        controllerNoise.addEvent(juce::MidiMessage::controllerEvent(1, 64, 127), 4); // CC64 Sustain
        controllerNoise.addEvent(juce::MidiMessage::pitchWheel(1, 12000), 8);        // Pitch Bend
        controllerNoise.addEvent(juce::MidiMessage(0xFE), 12);                       // Active Sensing
        controllerNoise.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(0)), 16); // vel=0 NoteOff
        controllerNoise.addEvent(juce::MidiMessage::noteOff(1, 60), 20);

        proc.processBlock(buf, controllerNoise);
        TEST_ASSERT(!proc.getPoweredOn(), "MIDI CC / PitchBend / ActiveSensing / vel=0 MUST NOT wake Standby");
        TEST_ASSERT(buf.getMagnitude(0, 256) == 0.0f, "Standby with MIDI controller chatter must output 0.0f");

        juce::MidiBuffer genuineNoteOn;
        genuineNoteOn.addEvent(juce::MidiMessage::noteOn(1, 60, static_cast<juce::uint8>(100)), 0);
        proc.processBlock(buf, genuineNoteOn);
        TEST_ASSERT(proc.getPoweredOn(), "Genuine MIDI Note-On (vel > 0) MUST auto-wake Standby");
    }

    // Verify masterDrive (TAPE DRIVE) is wired through to C++ MasterLimiterDsp saturation
    auto renderRmsWithDrive = [](float drivePct) -> double {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor proc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);
        proc.prepareToPlay(48000.0, 512);
        proc.setUIExtendedProperty("masterDrive", drivePct);
        setPlainParam(proc, "drone1_volume", 0.90f);
        setPlainParam(proc, "master_volume", 0.90f);
        proc.setDrone1Active(true);

        juce::AudioBuffer<float> buf(2, 512);
        juce::MidiBuffer empty;
        for (int b = 0; b < 6; ++b) proc.processBlock(buf, empty);
        double energy = 0.0;
        const float* l = buf.getReadPointer(0);
        for (int i = 0; i < 512; ++i) energy += static_cast<double>(l[i]) * static_cast<double>(l[i]);
        return std::sqrt(energy / 512.0);
    };
    const double rmsZeroDrive = renderRmsWithDrive(0.0f);
    const double rmsMaxDrive  = renderRmsWithDrive(100.0f);
    TEST_ASSERT(std::abs(rmsMaxDrive - rmsZeroDrive) > 1e-4,
                "masterDrive (TAPE DRIVE) must audibly modulate C++ MasterLimiterDsp tape warmth");
}

// ============================================================================
// Test 8: Vector Latch, Custom Patch, Native Theme, & Live Minimize/Restore
// ============================================================================
void test_vector_latch_custom_patch_native_theme_and_live_window_minimize() {
    // Snapshot %APPDATA%/Braun/AS42_settings.xml so toggling setNativeMode leaves machine state untouched
    juce::PropertiesFile::Options propOpts;
    propOpts.applicationName = "AS42_settings";
    propOpts.filenameSuffix = ".xml";
    propOpts.folderName = "Braun";
    propOpts.osxLibrarySubFolder = "Application Support";
    const juce::File settingsFile = juce::PropertiesFile(propOpts).getFile();
    const bool hadSettingsFile = settingsFile.existsAsFile();
    const juce::String originalSettingsXml = hadSettingsFile ? settingsFile.loadFileAsString() : juce::String();

    struct SettingsRestoreGuard {
        juce::File file;
        bool existed;
        juce::String content;
        ~SettingsRestoreGuard() {
            if (existed) {
                file.replaceWithText(content);
            } else if (file.existsAsFile()) {
                file.deleteFile();
            }
        }
    } restoreGuard { settingsFile, hadSettingsFile, originalSettingsXml };

    juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
    BRAUN_AS42AudioProcessor proc;
    juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

    proc.prepareToPlay(48000.0, 512);
    setPlainParam(proc, "felt_tone", 0.78f);
    setPlainParam(proc, "drone1_cutoff", 2140.0f);
    setPlainParam(proc, "drone2_beat", 2.40f);
    proc.setDrone1Active(true);

    const juce::String customJson =
        R"({"format":"BRAUN_AS42_PATCH","version":1,"name":"Adversarial Audit Patch","knobs":{"feltTone":78,"drone1Cutoff":2140,"drone2Beat":2.4}})";

    // 1. Verify vectorState (latch + coordinates), customPatchJson, and Dark Theme persist across Editor close/reopen
    {
        std::unique_ptr<juce::AudioProcessorEditor> ed1(proc.createEditor());
        auto* as42Ed1 = dynamic_cast<BRAUN_AS42AudioProcessorEditor*>(ed1.get());
        TEST_ASSERT(as42Ed1 != nullptr, "Editor 1 must construct");

        auto sendWebParam = [&](const char* id, const juce::var& val) {
            auto* obj = new juce::DynamicObject();
            obj->setProperty("id", id);
            obj->setProperty("value", val);
            as42Ed1->handleParamChangeFromWeb(juce::var(obj));
        };

        sendWebParam("uiTheme", "dark");
        sendWebParam("customPatchJson", customJson);

        auto* vecObj = new juce::DynamicObject();
        vecObj->setProperty("x", 0.82);
        vecObj->setProperty("y", 0.22);
        vecObj->setProperty("mode", "latch");
        as42Ed1->handleVectorStateFromWeb(juce::var(vecObj));

        TEST_ASSERT(as42Ed1->isDarkThemeActive(), "Editor 1 must apply dark theme to BraunLookAndFeel");
    }

    // Reopen Editor 2 -> Native BraunLookAndFeel dark theme + customPatchJson + vector latch must be intact!
    {
        std::unique_ptr<juce::AudioProcessorEditor> ed2(proc.createEditor());
        auto* as42Ed2 = dynamic_cast<BRAUN_AS42AudioProcessorEditor*>(ed2.get());
        TEST_ASSERT(as42Ed2 != nullptr, "Editor 2 must construct");
        TEST_ASSERT(as42Ed2->isDarkThemeActive(),
                    "Reopened Editor 2 MUST initialize BraunLookAndFeel dark theme from UIExtendedState");
    }

    {
        const auto ui = proc.getUIExtendedState();
        TEST_ASSERT(ui.isCustomPatch && ui.customPatchJson == customJson, "customPatchJson must persist");
        TEST_ASSERT(ui.vectorMode == "latch", "vectorMode 'latch' must persist");
        TEST_ASSERT(std::abs(ui.vectorX - 0.82f) < 0.005f && std::abs(ui.vectorY - 0.22f) < 0.005f,
                    "Latched vectorX/vectorY must persist");
    }

    // Verify getStateInformation / setStateInformation round-trips customPatchJson & vectorMode,
    // and selecting a factory program cleanly clears isCustomPatch
    {
        juce::MemoryBlock blob;
        proc.getStateInformation(blob);

        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor copyProc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);
        copyProc.setStateInformation(blob.getData(), static_cast<int>(blob.getSize()));

        const auto copyUi = copyProc.getUIExtendedState();
        TEST_ASSERT(copyUi.isCustomPatch && copyUi.customPatchJson == customJson,
                    "VST3 state recall must restore customPatchJson");
        TEST_ASSERT(copyUi.vectorMode == "latch", "VST3 state recall must restore vectorMode");

        copyProc.setCurrentProgram(1); // HAROLD BUDD
        TEST_ASSERT(!copyProc.getUIExtendedState().isCustomPatch,
                    "Selecting factory program must clear isCustomPatch");
    }

#if JUCE_WINDOWS && JUCE_WEB_BROWSER
    // 2. Live Desktop Window + Real Edge WebView2 Minimize -> Restore & Native <-> Web UI Cycle
    {
        auto pumpWin32Messages = [](int durationMs) {
            const DWORD startTick = GetTickCount();
            while (static_cast<int>(GetTickCount() - startTick) < durationMs) {
                MSG msg {};
                while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                Sleep(5);
            }
        };

        std::unique_ptr<juce::AudioProcessorEditor> liveEdOwner(proc.createEditor());
        auto* liveEd = dynamic_cast<BRAUN_AS42AudioProcessorEditor*>(liveEdOwner.get());
        TEST_ASSERT(liveEd != nullptr, "Live editor must construct");
        liveEd->setNativeMode(false);

        juce::DocumentWindow hostWin("AS-42 Minimize/Restore Test",
                                     juce::Colours::black,
                                     juce::DocumentWindow::allButtons,
                                     true);
        hostWin.setUsingNativeTitleBar(true);
        hostWin.setContentNonOwned(liveEd, true);
        hostWin.setTopLeftPosition(60, 60);
        hostWin.setVisible(true);

        for (int tick = 0; tick < 80 && !liveEd->isWebBridgeReady(); ++tick) {
            pumpWin32Messages(50);
        }

        if (liveEd->isWebBridgeReady()) {
            std::cout << "  [INFO] Live Edge WebView2 booted & synchronized via requestSync.\n";
            pumpWin32Messages(120);

            // Verify WebView2 JS boot did NOT overwrite C++ APVTS or extended UI state with PRESETS.DEFAULT!
            TEST_ASSERT(std::abs(getPlainParam(proc, "felt_tone") - 0.78f) < 0.015f,
                        "Live WebView2 boot must NOT clobber felt_tone with PRESETS.DEFAULT (0.62)");
            TEST_ASSERT(std::abs(getPlainParam(proc, "drone1_cutoff") - 2140.0f) < 5.0f,
                        "Live WebView2 boot must NOT clobber drone1_cutoff");
            TEST_ASSERT(proc.getUIExtendedState().isCustomPatch,
                        "Live WebView2 boot must NOT clobber customPatchJson");

            // MINIMIZE the live Win32 window, pump message loop, then RESTORE!
            hostWin.setMinimised(true);
            pumpWin32Messages(200);
            hostWin.setMinimised(false);
            hostWin.toFront(false);
            pumpWin32Messages(250);

            TEST_ASSERT(std::abs(getPlainParam(proc, "felt_tone") - 0.78f) < 0.015f,
                        "Minimize -> Restore MUST preserve felt_tone");
            TEST_ASSERT(std::abs(getPlainParam(proc, "drone1_cutoff") - 2140.0f) < 5.0f,
                        "Minimize -> Restore MUST preserve drone1_cutoff");
            TEST_ASSERT(std::abs(getPlainParam(proc, "drone2_beat") - 2.40f) < 0.05f,
                        "Minimize -> Restore MUST preserve drone2_beat");
            TEST_ASSERT(proc.getUIExtendedState().uiTheme == "dark",
                        "Minimize -> Restore MUST preserve uiTheme == dark");
            TEST_ASSERT(proc.getUIExtendedState().vectorMode == "latch" &&
                        std::abs(proc.getUIExtendedState().vectorX - 0.82f) < 0.01f &&
                        std::abs(proc.getUIExtendedState().vectorY - 0.22f) < 0.01f,
                        "Minimize -> Restore MUST preserve latched Vector Pad coordinates & mode");
            TEST_ASSERT(proc.getUIExtendedState().isCustomPatch,
                        "Minimize -> Restore MUST preserve CUSTOM patch state");

            // Switch to Native UI, turn Power OFF while drone is armed, then switch back to Web UI!
            liveEd->setNativeMode(true);
            pumpWin32Messages(100);
            proc.setPoweredOn(false);
            liveEd->sendPowerUpdateToWeb(false);
            pumpWin32Messages(120);

            liveEd->setNativeMode(false);
            pumpWin32Messages(200);

            TEST_ASSERT(!proc.getPoweredOn(),
                        "Native UI -> Web UI switch after Power Off MUST keep synth in Standby");
            TEST_ASSERT(std::abs(getPlainParam(proc, "drone1_cutoff") - 2140.0f) < 5.0f,
                        "Native UI <-> Web UI round-trip MUST preserve drone1_cutoff");
        } else {
            std::cout << "  [WARN] WebView2 runtime did not signal requestSync within 4s (headless/sandbox session).\n";
        }

        hostWin.setVisible(false);
        hostWin.clearContentComponent();
    }
#endif
}

// ============================================================================
// Test 9: Concurrent Audio/Message Thread State Recall & Legacy Preset Isolation
// ============================================================================
void test_concurrent_state_recall_tail_guard_and_legacy_preset_isolation() {
    // 1. Legacy v1.5.0 / v1.4.x XML state without extended UI properties must reset stale extended UI fields
    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor proc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        proc.prepareToPlay(48000.0, 256);
        // Cold-prepared processor in Standby before any audio block must report 0.0s tail immediately
        proc.setPoweredOn(false);
        TEST_ASSERT(std::abs(proc.getTailLengthSeconds()) <= 0.0,
                    "Cold-silent Standby processor must report 0.0s tail immediately");
        proc.setPoweredOn(true);

        // Dirty extended UI state with non-default values
        proc.setUIExtendedProperty("uiTheme", "dark");
        proc.setUIExtendedProperty("rootPitchClass", 9);
        proc.setUIExtendedProperty("masterDrive", 88.0f);
        proc.setUIExtendedProperty("vectorMode", "latch");
        proc.setUIExtendedProperty("vectorX", 0.91f);
        proc.setUIExtendedProperty("customPatchJson", R"({"name":"Dirty"})");

        // Craft a legacy state XML without extended UI attributes, with drone1_isSubBass = 1.0f
        setPlainParam(proc, "drone1_isSubBass", 1.0f);
        auto legacyVt = proc.getAPVTS().copyState();
        legacyVt.setProperty("isPoweredOn", true, nullptr);
        legacyVt.setProperty("drone1Active", false, nullptr);
        legacyVt.setProperty("drone2Active", false, nullptr);
        legacyVt.setProperty("currentProgram", 3, nullptr);
        std::unique_ptr<juce::XmlElement> legacyXml(legacyVt.createXml());
        juce::MemoryBlock legacyBlob;
        juce::AudioProcessor::copyXmlToBinary(*legacyXml, legacyBlob);

        proc.setStateInformation(legacyBlob.getData(), static_cast<int>(legacyBlob.getSize()));
        const auto ui = proc.getUIExtendedState();
        TEST_ASSERT(ui.uiTheme == "light", "Legacy state recall must reset stale uiTheme to light");
        TEST_ASSERT(ui.rootPitchClass == 0, "Legacy state recall must reset stale rootPitchClass to 0");
        TEST_ASSERT(std::abs(ui.masterDrive - 18.0f) < 0.01f, "Legacy state recall must reset stale masterDrive to 18%");
        TEST_ASSERT(ui.vectorMode == "momentary", "Legacy state recall must reset stale vectorMode to momentary");
        TEST_ASSERT(!ui.isCustomPatch && ui.customPatchJson.isEmpty(), "Legacy state recall must clear customPatchJson");
        TEST_ASSERT(ui.drone1Snap == "sub-bass", "Legacy state with drone1_isSubBass=1 must infer drone1Snap='sub-bass'");
    }

    // 2. Multi-threaded race stress: Audio thread (processBlock + getTailLengthSeconds) vs
    //    Message thread (setStateInformation + getStateInformation + setPoweredOn + setDrone1Active)
    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor proc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        proc.prepareToPlay(48000.0, 128);
        proc.setDrone1Active(true);
        proc.setPoweredOn(true);
        juce::MemoryBlock snapshotOn;
        proc.getStateInformation(snapshotOn);

        proc.setPoweredOn(false);
        juce::MemoryBlock snapshotStandby;
        proc.getStateInformation(snapshotStandby);
        proc.setPoweredOn(true);

        std::atomic<bool> stopThreads { false };
        std::atomic<bool> audioValid { true };

        std::thread audioThread([&]() {
            juce::AudioBuffer<float> buf(2, 128);
            juce::MidiBuffer midi;
            while (!stopThreads.load(std::memory_order_relaxed)) {
                proc.processBlock(buf, midi);
                const double tail = proc.getTailLengthSeconds();
                if (std::isnan(tail) || tail < 0.0) {
                    audioValid.store(false, std::memory_order_relaxed);
                    break;
                }
                for (int ch = 0; ch < 2; ++ch) {
                    const float* ptr = buf.getReadPointer(ch);
                    for (int i = 0; i < 128; ++i) {
                        if (!std::isfinite(ptr[i]) || std::abs(ptr[i]) > 1.2f) {
                            audioValid.store(false, std::memory_order_relaxed);
                            break;
                        }
                    }
                }
            }
        });

        std::thread messageThread([&]() {
            juce::MemoryBlock scratch;
            float scopeL[256] {};
            float scopeR[256] {};
            for (int iter = 0; iter < 120 && audioValid.load(std::memory_order_relaxed); ++iter) {
                if ((iter % 2) == 0) {
                    proc.setStateInformation(snapshotStandby.getData(), static_cast<int>(snapshotStandby.getSize()));
                } else {
                    proc.setStateInformation(snapshotOn.getData(), static_cast<int>(snapshotOn.getSize()));
                }
                proc.setPoweredOn((iter % 3) != 0);
                proc.setDrone2Active((iter % 4) == 0);
                proc.setUIExtendedProperty("masterDrive", static_cast<float>((iter * 7) % 100));
                proc.getScopeSamples(scopeL, scopeR, 256);
                proc.getStateInformation(scratch);
            }
            stopThreads.store(true, std::memory_order_release);
        });

        messageThread.join();
        audioThread.join();

        TEST_ASSERT(audioValid.load(),
                    "Concurrent audio/message thread state recall and power toggling must produce finite bounded audio");
    }
}

// ============================================================================
// Test 10: Host Program Sync, Idle->Standby Drone Guard, Octave-Up Pitch & Child-HWND Visibility
// ============================================================================
void test_vst3_host_program_sync_idle_standby_drone_guard_and_child_hwnd_visibility() {
    // 1. Verify updateHostDisplay notifications keep VST3 ProgramChangeParameter in sync
    //    without marking freshly loaded DAW projects dirty!
    struct HostDisplaySpy : public juce::AudioProcessorListener {
        int programChangedCount { 0 };
        int nonParamStateChangedCount { 0 };
        void audioProcessorParameterChanged(juce::AudioProcessor*, int, float) override {}
        void audioProcessorChanged(juce::AudioProcessor*, const ChangeDetails& details) override {
            if (details.programChanged) ++programChangedCount;
            if (details.nonParameterStateChanged) ++nonParamStateChangedCount;
        }
    };

    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor proc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        HostDisplaySpy spy;
        proc.addListener(&spy);

        proc.setCurrentProgramIndexOnly(2); // Web UI selects VANGELIS
        TEST_ASSERT(spy.programChangedCount == 1 && spy.nonParamStateChangedCount == 1,
                    "setCurrentProgramIndexOnly must notify VST3 host of program & non-param state change");

        proc.setCurrentProgram(1); // Native UI / Host selects HAROLD BUDD
        TEST_ASSERT(spy.programChangedCount == 2 && spy.nonParamStateChangedCount == 2,
                    "setCurrentProgram must notify VST3 host of program & non-param state change");

        juce::MemoryBlock savedBlob;
        proc.getStateInformation(savedBlob);

        spy.programChangedCount = 0;
        spy.nonParamStateChangedCount = 0;
        proc.setStateInformation(savedBlob.getData(), static_cast<int>(savedBlob.getSize()));
        TEST_ASSERT(spy.programChangedCount == 1 && spy.nonParamStateChangedCount == 0,
                    "setStateInformation must sync VST3 program index without marking a freshly opened DAW session dirty");

        proc.removeListener(&spy);
    }

    // 2. Idle VST3 blocks followed by Standby state recall with armed Drone 1 MUST NOT emit a 45ms drone burst!
    {
        juce::MemoryBlock standbyWithArmedDrone;
        {
            juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
            BRAUN_AS42AudioProcessor saver;
            juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);
            saver.prepareToPlay(48000.0, 512);
            setPlainParam(saver, "drone1_volume", 1.0f);
            setPlainParam(saver, "master_volume", 0.95f);
            saver.setDrone1Active(true);
            saver.setPoweredOn(false);
            saver.getStateInformation(standbyWithArmedDrone);
        }

        // Case A: Host runs 5 silent idle blocks on a fresh powered VST3, then recalls Standby+ArmedDrone
        {
            juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
            BRAUN_AS42AudioProcessor vstIdle;
            juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);
            vstIdle.prepareToPlay(48000.0, 512);

            juce::AudioBuffer<float> buf(2, 512);
            juce::MidiBuffer emptyMidi;
            for (int b = 0; b < 5; ++b) {
                vstIdle.processBlock(buf, emptyMidi);
                TEST_ASSERT(buf.getMagnitude(0, 512) == 0.0f, "Idle VST3 block must be silent");
            }

            vstIdle.setStateInformation(standbyWithArmedDrone.getData(),
                                        static_cast<int>(standbyWithArmedDrone.getSize()));
            TEST_ASSERT(!vstIdle.getPoweredOn() && vstIdle.getDrone1Active(),
                        "Recalled state must be Standby with Drone 1 armed");
            TEST_ASSERT(std::abs(vstIdle.getTailLengthSeconds()) <= 0.0,
                        "Idle VST3 recalling Standby state must report 0.0s tail immediately");

            for (int b = 0; b < 6; ++b) {
                vstIdle.processBlock(buf, emptyMidi);
                TEST_ASSERT(buf.getMagnitude(0, 512) == 0.0f,
                            "Recalling Standby with armed Drone 1 after idle blocks MUST output 0.0f (zero drone burst)");
            }
        }

        // Case B: Piano note is actively ringing while Drone 1 is OFF, then host recalls Standby+ArmedDrone:
        // Piano must fade out over 45ms WITHOUT igniting cold Drone 1!
        {
            juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
            BRAUN_AS42AudioProcessor vstRinging;
            juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);
            vstRinging.prepareToPlay(48000.0, 512);

            juce::AudioBuffer<float> buf(2, 512);
            juce::MidiBuffer noteOnMidi;
            noteOnMidi.addEvent(juce::MidiMessage::noteOn(1, 72, static_cast<juce::uint8>(100)), 0);
            vstRinging.processBlock(buf, noteOnMidi);
            TEST_ASSERT(!vstRinging.getDspEngine().getDrone1().isGateTailActive(), "Drone 1 must be cold");

            vstRinging.setStateInformation(standbyWithArmedDrone.getData(),
                                           static_cast<int>(standbyWithArmedDrone.getSize()));
            TEST_ASSERT(vstRinging.getTailLengthSeconds() > 0.0,
                        "Ringing piano recalling Standby must hold 50ms tail for fade-out");

            juce::MidiBuffer emptyMidi;
            vstRinging.processBlock(buf, emptyMidi);
            TEST_ASSERT(!vstRinging.getDspEngine().getDrone1().isGateTailActive(),
                        "Cold armed Drone 1 MUST NOT ignite during ringing piano's power-off fade");
        }
    }

    // 3. Verify OCTAVE UP + PERFECT 5TH on Root B (B4 = 493.88 Hz, F#5 = 740.82 Hz) never clamps at 400 Hz!
    {
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor proc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);

        setPlainParam(proc, "drone1_pitch", 493.88f);
        setPlainParam(proc, "drone2_pitch", 740.82f);
        TEST_ASSERT(std::abs(getPlainParam(proc, "drone1_pitch") - 493.88f) < 0.02f,
                    "drone1_pitch must support Octave-Up B4 (493.88 Hz) without clamping at 400 Hz");
        TEST_ASSERT(std::abs(getPlainParam(proc, "drone2_pitch") - 740.82f) < 0.02f,
                    "drone2_pitch must support Perfect-5th F#5 (740.82 Hz) without clamping at 400 Hz");
    }

#if JUCE_WINDOWS && JUCE_WEB_BROWSER
    // 4. Verify VST3 child-HWND embedded inside a DAW wrapper parent HWND detects both
    //    wrapper SW_HIDE (FL Studio / Reaper plugin window close) and root SW_MINIMIZE!
    {
        juce::PropertiesFile::Options propOpts;
        propOpts.applicationName = "AS42_settings";
        propOpts.filenameSuffix = ".xml";
        propOpts.folderName = "Braun";
        propOpts.osxLibrarySubFolder = "Application Support";
        const juce::File settingsFile = juce::PropertiesFile(propOpts).getFile();
        const bool hadSettingsFile = settingsFile.existsAsFile();
        const juce::String originalSettingsXml = hadSettingsFile ? settingsFile.loadFileAsString() : juce::String();
        struct RestoreGuard {
            juce::File file; bool existed; juce::String content;
            ~RestoreGuard() { if (existed) file.replaceWithText(content); else if (file.existsAsFile()) file.deleteFile(); }
        } guard { settingsFile, hadSettingsFile, originalSettingsXml };

        auto pumpWin32 = [](int ms) {
            const DWORD t0 = GetTickCount();
            while (static_cast<int>(GetTickCount() - t0) < ms) {
                MSG msg {};
                while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                Sleep(5);
            }
        };

        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_VST3);
        BRAUN_AS42AudioProcessor proc;
        juce::AudioProcessor::setTypeOfNextNewPlugin(juce::AudioProcessor::wrapperType_Undefined);
        proc.prepareToPlay(48000.0, 512);
        setPlainParam(proc, "felt_tone", 0.81f);

        // Simulate VST3 host window hierarchy: top-level DAW window -> native child wrapper HWND -> PluginEditor WS_CHILD HWND
        juce::DocumentWindow dawRootWin("Mock DAW Root", juce::Colours::black, juce::DocumentWindow::allButtons, true);
        dawRootWin.setUsingNativeTitleBar(true);
        dawRootWin.setBounds(80, 80, 1260, 800);
        dawRootWin.setVisible(true);

        HWND rootHwnd = static_cast<HWND>(dawRootWin.getWindowHandle());
        HWND wrapperHwnd = ::CreateWindowExW(
            0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
            0, 0, 1240, 780, rootHwnd, nullptr, ::GetModuleHandleW(nullptr), nullptr);
        TEST_ASSERT(wrapperHwnd != nullptr, "Mock VST3 wrapper child HWND must be created");

        std::unique_ptr<juce::AudioProcessorEditor> edOwner(proc.createEditor());
        auto* ed = dynamic_cast<BRAUN_AS42AudioProcessorEditor*>(edOwner.get());
        TEST_ASSERT(ed != nullptr, "Editor must construct");
        ed->setNativeMode(false);
        ed->setOpaque(true);
        ed->setVisible(true);
        ed->addToDesktop(0, wrapperHwnd); // Creates real WS_CHILD HWND inside wrapperHwnd (exact VST3 IPlugView::attached path!)

        pumpWin32(120);
        TEST_ASSERT(ed->isWebViewActuallyShowing(),
                    "Embedded VST3 WS_CHILD editor must report isWebViewActuallyShowing() == true when visible");

        // Hide intermediate DAW wrapper HWND via SW_HIDE (exact FL Studio / Reaper close behavior)
        ::ShowWindow(wrapperHwnd, SW_HIDE);
        pumpWin32(60);
        TEST_ASSERT(!ed->isWebViewActuallyShowing(),
                    "SW_HIDE on VST3 parent wrapper HWND MUST flip isWebViewActuallyShowing() to false");

        ::ShowWindow(wrapperHwnd, SW_SHOW);
        pumpWin32(60);
        TEST_ASSERT(ed->isWebViewActuallyShowing(),
                    "SW_SHOW on VST3 parent wrapper HWND MUST restore isWebViewActuallyShowing() to true");

        // Minimize top-level DAW root window while child HWNDs remain SW_SHOWNORMAL
        ::ShowWindow(rootHwnd, SW_MINIMIZE);
        pumpWin32(80);
        TEST_ASSERT(!ed->isWebViewActuallyShowing(),
                    "Minimizing top-level DAW root HWND MUST flip child VST3 isWebViewActuallyShowing() to false");

        ::ShowWindow(rootHwnd, SW_RESTORE);
        pumpWin32(80);
        TEST_ASSERT(ed->isWebViewActuallyShowing(),
                    "Restoring top-level DAW root HWND MUST restore child VST3 isWebViewActuallyShowing() to true");
        TEST_ASSERT(std::abs(getPlainParam(proc, "felt_tone") - 0.81f) < 0.015f,
                    "VST3 child-HWND hide/minimize/restore cycle must preserve felt_tone");

        ed->removeFromDesktop();
        edOwner.reset();
        ::DestroyWindow(wrapperHwnd);
        dawRootWin.setVisible(false);
    }
#endif
}

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
    RUN_TEST(test_power_off_with_active_drones_stays_off_and_fades_click_free);
    RUN_TEST(test_editor_reopen_and_extended_ui_state_persistence);
    RUN_TEST(test_extreme_blocks_midi_noise_and_master_drive_dsp);
    RUN_TEST(test_vector_latch_custom_patch_native_theme_and_live_window_minimize);
    RUN_TEST(test_concurrent_state_recall_tail_guard_and_legacy_preset_isolation);
    RUN_TEST(test_vst3_host_program_sync_idle_standby_drone_guard_and_child_hwnd_visibility);

    std::cout << "========================================================\n";
    std::cout << "Summary: " << gTestsPassed << " passed, " << gTestsFailed << " failed.\n";
    std::cout << "========================================================\n";

    return (gTestsFailed == 0) ? 0 : 1;
}
