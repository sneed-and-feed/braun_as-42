#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <algorithm>
#include <limits>

BRAUN_AS42AudioProcessor::BRAUN_AS42AudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Parameters", braun::Parameters::createParameterLayout())
{
    if (wrapperType == juce::AudioProcessor::wrapperType_Standalone)
    {
        // Standalone launches cleanly in silent Standby with drones disarmed until user interaction
        isPoweredOn.store(false, std::memory_order_relaxed);
        powerLinear = 0.0f;
    }
    // Cache atomic parameter value pointers
    // 1. Felt Piano
    paramFeltVolume      = apvts.getRawParameterValue("felt_volume");
    paramFeltDecay       = apvts.getRawParameterValue("felt_decay");
    paramFeltTone        = apvts.getRawParameterValue("felt_tone");
    paramFeltHammer      = apvts.getRawParameterValue("felt_hammer");
    paramFeltSpace       = apvts.getRawParameterValue("felt_space");
    paramFeltWaveform    = apvts.getRawParameterValue("felt_waveform");

    // 2. Drone 1
    paramDrone1Volume    = apvts.getRawParameterValue("drone1_volume");
    paramDrone1Pitch     = apvts.getRawParameterValue("drone1_pitch");
    paramDrone1Fold      = apvts.getRawParameterValue("drone1_fold");
    paramDrone1Cutoff    = apvts.getRawParameterValue("drone1_cutoff");
    paramDrone1Resonance = apvts.getRawParameterValue("drone1_resonance");
    paramDrone1Beat      = apvts.getRawParameterValue("drone1_beat");
    paramDrone1Detune    = apvts.getRawParameterValue("drone1_detune");
    paramDrone1Lfo       = apvts.getRawParameterValue("drone1_lfo");
    paramDrone1WaveA     = apvts.getRawParameterValue("drone1_waveA");
    paramDrone1WaveB     = apvts.getRawParameterValue("drone1_waveB");
    paramDrone1IsSubBass = apvts.getRawParameterValue("drone1_isSubBass");

    // 3. Drone 2
    paramDrone2Volume    = apvts.getRawParameterValue("drone2_volume");
    paramDrone2Pitch     = apvts.getRawParameterValue("drone2_pitch");
    paramDrone2Fold      = apvts.getRawParameterValue("drone2_fold");
    paramDrone2Cutoff    = apvts.getRawParameterValue("drone2_cutoff");
    paramDrone2Resonance = apvts.getRawParameterValue("drone2_resonance");
    paramDrone2Beat      = apvts.getRawParameterValue("drone2_beat");
    paramDrone2Detune    = apvts.getRawParameterValue("drone2_detune");
    paramDrone2Lfo       = apvts.getRawParameterValue("drone2_lfo");
    paramDrone2WaveA     = apvts.getRawParameterValue("drone2_waveA");
    paramDrone2WaveB     = apvts.getRawParameterValue("drone2_waveB");

    // 4. Tape Delay
    paramTapeTime        = apvts.getRawParameterValue("tape_time");
    paramTapeFeedback    = apvts.getRawParameterValue("tape_feedback");
    paramTapeMix         = apvts.getRawParameterValue("tape_mix");
    paramTapeWow         = apvts.getRawParameterValue("tape_wow");
    paramTapeTone        = apvts.getRawParameterValue("tape_tone");

    // 5. Shimmer Reverb
    paramShimmerMix      = apvts.getRawParameterValue("shimmer_mix");
    paramShimmerDecay    = apvts.getRawParameterValue("shimmer_decay");
    paramShimmerDamping  = apvts.getRawParameterValue("shimmer_damping");
    paramShimmerAmount   = apvts.getRawParameterValue("shimmer_amount");
    paramShimmerFreeze   = apvts.getRawParameterValue("shimmer_freeze");

    // 6. Master Bus
    paramMasterVolume    = apvts.getRawParameterValue("master_volume");

    recorderThread.startThread();
}

BRAUN_AS42AudioProcessor::~BRAUN_AS42AudioProcessor()
{
    stopRecording();
    recorderThread.stopThread(2000);
}

const juce::String BRAUN_AS42AudioProcessor::getName() const
{
    return JucePlugin_Name;
}

bool BRAUN_AS42AudioProcessor::acceptsMidi() const
{
    return true;
}

bool BRAUN_AS42AudioProcessor::producesMidi() const
{
    return false;
}

bool BRAUN_AS42AudioProcessor::isMidiEffect() const
{
    return false;
}

double BRAUN_AS42AudioProcessor::getTailLengthSeconds() const
{
    if (!isPoweredOn.load(std::memory_order_acquire))
    {
        // Report 50 ms tail until the 45 ms C1 Hermite power-off fade reaches exact silence
        // so VST3/AU hosts never auto-suspend processBlock mid-fade and cause an audible cut.
        return dspSilent.load(std::memory_order_acquire) ? 0.0 : 0.05;
    }

    if (drone1Active.load(std::memory_order_relaxed)
        || drone2Active.load(std::memory_order_relaxed)
        || (paramShimmerFreeze != nullptr && paramShimmerFreeze->load(std::memory_order_relaxed) > 0.5f))
    {
        return std::numeric_limits<double>::infinity();
    }

    const double reverbDecay = (paramShimmerDecay != nullptr)
        ? static_cast<double>(paramShimmerDecay->load(std::memory_order_relaxed))
        : 8.5;
    const double delayTail = (paramTapeTime != nullptr)
        ? static_cast<double>(paramTapeTime->load(std::memory_order_relaxed)) * 4.0
        : 1.84;
    return std::max(8.0, reverbDecay + delayTail);
}

int BRAUN_AS42AudioProcessor::getNumPrograms()
{
    return 4;
}

int BRAUN_AS42AudioProcessor::getCurrentProgram()
{
    return currentProgram.load(std::memory_order_relaxed);
}

void BRAUN_AS42AudioProcessor::setCurrentProgramIndexOnly(int index) noexcept
{
    const int idx = std::clamp(index, 0, 3);
    currentProgram.store(idx, std::memory_order_relaxed);
    const juce::SpinLock::ScopedLockType sl(uiStateLock);
    uiExtendedState.isCustomPatch = false;
    uiExtendedState.customPatchJson.clear();
}

void BRAUN_AS42AudioProcessor::setCurrentProgram(int index)
{
    const int idx = std::clamp(index, 0, getNumPrograms() - 1);
    currentProgram.store(idx, std::memory_order_relaxed);
    fullSyncRequested.store(true, std::memory_order_release);

    auto setParam = [this](const juce::String& paramId, float plainVal) {
        if (auto* p = apvts.getParameter(paramId))
            p->setValueNotifyingHost(p->convertTo0to1(plainVal));
    };

    switch (idx)
    {
        case 0: // CALIBRATED DEFAULT
            setParam("felt_volume",      0.80f);
            setParam("felt_decay",       1.10f);
            setParam("felt_tone",        0.62f);
            setParam("felt_hammer",      0.45f);
            setParam("felt_space",       0.45f);
            setParam("felt_waveform",    0.0f); // Felt
            setParam("drone1_volume",    0.55f);
            setParam("drone1_pitch",     65.41f);
            setParam("drone1_fold",      45.0f);
            setParam("drone1_cutoff",    650.0f);
            setParam("drone1_resonance", 3.5f);
            setParam("drone1_beat",      0.35f);
            setParam("drone1_detune",    2.5f);
            setParam("drone1_lfo",       0.12f);
            setParam("drone1_waveA",     2.0f); // Saw
            setParam("drone1_waveB",     6.0f); // Warm
            setParam("drone1_isSubBass", 0.0f);
            setParam("drone2_volume",    0.55f);
            setParam("drone2_pitch",     98.00f);
            setParam("drone2_fold",      45.0f);
            setParam("drone2_cutoff",    850.0f);
            setParam("drone2_resonance", 3.5f);
            setParam("drone2_beat",      0.65f);
            setParam("drone2_detune",    -3.2f);
            setParam("drone2_lfo",       0.12f);
            setParam("drone2_waveA",     3.0f); // Square
            setParam("drone2_waveB",     5.0f); // Triangle
            setParam("tape_time",        0.460f);
            setParam("tape_feedback",    0.55f);
            setParam("tape_mix",         0.40f);
            setParam("tape_wow",         0.45f);
            setParam("tape_tone",        3600.0f);
            setParam("shimmer_mix",      0.45f);
            setParam("shimmer_decay",    8.5f);
            setParam("shimmer_damping",  0.60f);
            setParam("shimmer_amount",   0.45f);
            setParam("shimmer_freeze",   0.0f);
            setParam("master_volume",    0.80f);
            break;

        case 1: // HAROLD BUDD · PAVILION
            setParam("felt_volume",      0.85f);
            setParam("felt_decay",       1.60f);
            setParam("felt_tone",        0.35f);
            setParam("felt_hammer",      0.55f);
            setParam("felt_space",       0.65f);
            setParam("felt_waveform",    0.0f); // Felt
            setParam("drone1_volume",    0.48f);
            setParam("drone1_pitch",     65.41f);
            setParam("drone1_fold",      25.0f);
            setParam("drone1_cutoff",    480.0f);
            setParam("drone1_resonance", 2.2f);
            setParam("drone1_beat",      0.20f);
            setParam("drone1_detune",    1.8f);
            setParam("drone1_lfo",       0.08f);
            setParam("drone1_waveA",     1.0f); // Sine
            setParam("drone1_waveB",     6.0f); // Warm
            setParam("drone1_isSubBass", 0.0f);
            setParam("drone2_volume",    0.45f);
            setParam("drone2_pitch",     98.00f);
            setParam("drone2_fold",      20.0f);
            setParam("drone2_cutoff",    600.0f);
            setParam("drone2_resonance", 2.0f);
            setParam("drone2_beat",      0.40f);
            setParam("drone2_detune",    -2.0f);
            setParam("drone2_lfo",       0.08f);
            setParam("drone2_waveA",     5.0f); // Triangle
            setParam("drone2_waveB",     1.0f); // Sine
            setParam("tape_time",        0.520f);
            setParam("tape_feedback",    0.60f);
            setParam("tape_mix",         0.45f);
            setParam("tape_wow",         0.50f);
            setParam("tape_tone",        2800.0f);
            setParam("shimmer_mix",      0.55f);
            setParam("shimmer_decay",    12.0f);
            setParam("shimmer_damping",  0.70f);
            setParam("shimmer_amount",   0.35f);
            setParam("shimmer_freeze",   0.0f);
            setParam("master_volume",    0.82f);
            break;

        case 2: // VANGELIS · CS-80 BRASS
            setParam("felt_volume",      0.88f);
            setParam("felt_decay",       1.80f);
            setParam("felt_tone",        0.80f);
            setParam("felt_hammer",      0.20f);
            setParam("felt_space",       0.30f);
            setParam("felt_waveform",    4.0f); // CS-80
            setParam("drone1_volume",    0.42f);
            setParam("drone1_pitch",     65.41f);
            setParam("drone1_fold",      32.0f);
            setParam("drone1_cutoff",    600.0f);
            setParam("drone1_resonance", 2.6f);
            setParam("drone1_beat",      0.85f);
            setParam("drone1_detune",    4.5f);
            setParam("drone1_lfo",       0.25f);
            setParam("drone1_waveA",     2.0f); // Saw
            setParam("drone1_waveB",     2.0f); // Saw
            setParam("drone1_isSubBass", 0.0f);
            setParam("drone2_volume",    0.38f);
            setParam("drone2_pitch",     73.59f); // Major 9th
            setParam("drone2_fold",      36.0f);
            setParam("drone2_cutoff",    750.0f);
            setParam("drone2_resonance", 2.8f);
            setParam("drone2_beat",      1.20f);
            setParam("drone2_detune",    -5.0f);
            setParam("drone2_lfo",       0.30f);
            setParam("drone2_waveA",     2.0f); // Saw
            setParam("drone2_waveB",     3.0f); // Square
            setParam("tape_time",        0.380f);
            setParam("tape_feedback",    0.52f);
            setParam("tape_mix",         0.45f);
            setParam("tape_wow",         0.40f);
            setParam("tape_tone",        4500.0f);
            setParam("shimmer_mix",      0.50f);
            setParam("shimmer_decay",    9.0f);
            setParam("shimmer_damping",  0.45f);
            setParam("shimmer_amount",   0.65f);
            setParam("shimmer_freeze",   0.0f);
            setParam("master_volume",    0.78f);
            break;

        case 3: // ENO · MUSIC FOR AIRPORTS
            setParam("felt_volume",      0.75f);
            setParam("felt_decay",       2.00f);
            setParam("felt_tone",        0.70f);
            setParam("felt_hammer",      0.35f);
            setParam("felt_space",       0.55f);
            setParam("felt_waveform",    1.0f); // Sine
            setParam("drone1_volume",    0.45f);
            setParam("drone1_pitch",     32.70f); // C1 Sub-Bass
            setParam("drone1_fold",      15.0f);
            setParam("drone1_cutoff",    550.0f);
            setParam("drone1_resonance", 2.0f);
            setParam("drone1_beat",      0.35f);
            setParam("drone1_detune",    1.5f);
            setParam("drone1_lfo",       0.05f);
            setParam("drone1_waveA",     1.0f); // Sine
            setParam("drone1_waveB",     5.0f); // Triangle
            setParam("drone1_isSubBass", 1.0f); // Sub-Bass ON
            setParam("drone2_volume",    0.45f);
            setParam("drone2_pitch",     65.41f); // Unison
            setParam("drone2_fold",      15.0f);
            setParam("drone2_cutoff",    550.0f);
            setParam("drone2_resonance", 2.0f);
            setParam("drone2_beat",      0.35f);
            setParam("drone2_detune",    -1.5f);
            setParam("drone2_lfo",       0.05f);
            setParam("drone2_waveA",     1.0f); // Sine
            setParam("drone2_waveB",     5.0f); // Triangle
            setParam("tape_time",        0.680f);
            setParam("tape_feedback",    0.68f);
            setParam("tape_mix",         0.50f);
            setParam("tape_wow",         0.60f);
            setParam("tape_tone",        5000.0f);
            setParam("shimmer_mix",      0.58f);
            setParam("shimmer_decay",    15.0f);
            setParam("shimmer_damping",  0.55f);
            setParam("shimmer_amount",   0.55f);
            setParam("shimmer_freeze",   0.0f);
            setParam("master_volume",    0.80f);
            break;

        default:
            break;
    }

    {
        const juce::SpinLock::ScopedLockType sl(uiStateLock);
        uiExtendedState.isCustomPatch = false;
        uiExtendedState.customPatchJson.clear();
        switch (idx)
        {
            case 0: // CALIBRATED DEFAULT
                uiExtendedState.scaleKey = "BUDD_PENTATONIC";
                uiExtendedState.drone1Snap = "deep-tonic";
                uiExtendedState.drone2Snap = "perfect-5th";
                uiExtendedState.vectorX = 0.50f;
                uiExtendedState.vectorY = 0.50f;
                uiExtendedState.chordSpeed = "med";
                uiExtendedState.masterDrive = 18.0f;
                uiExtendedState.poissonDensity = 12.0f;
                uiExtendedState.poissonHumanize = 50.0f;
                break;
            case 1: // HAROLD BUDD · PAVILION
                uiExtendedState.scaleKey = "BUDD_PENTATONIC";
                uiExtendedState.drone1Snap = "deep-tonic";
                uiExtendedState.drone2Snap = "perfect-5th";
                uiExtendedState.vectorX = 0.25f;
                uiExtendedState.vectorY = 0.60f;
                uiExtendedState.chordSpeed = "slow";
                uiExtendedState.masterDrive = 14.0f;
                uiExtendedState.poissonDensity = 8.0f;
                uiExtendedState.poissonHumanize = 65.0f;
                break;
            case 2: // VANGELIS · CS-80 BRASS
                uiExtendedState.scaleKey = "AVALON_SPIRITED";
                uiExtendedState.drone1Snap = "deep-tonic";
                uiExtendedState.drone2Snap = "major-9th";
                uiExtendedState.vectorX = 0.81f;
                uiExtendedState.vectorY = 0.70f;
                uiExtendedState.chordSpeed = "fast";
                uiExtendedState.masterDrive = 28.0f;
                uiExtendedState.poissonDensity = 10.0f;
                uiExtendedState.poissonHumanize = 40.0f;
                break;
            case 3: // ENO · MUSIC FOR AIRPORTS
                uiExtendedState.scaleKey = "BUDD_PENTATONIC";
                uiExtendedState.drone1Snap = "sub-bass";
                uiExtendedState.drone2Snap = "beating-unison";
                uiExtendedState.vectorX = 0.68f;
                uiExtendedState.vectorY = 0.75f;
                uiExtendedState.chordSpeed = "slow";
                uiExtendedState.masterDrive = 12.0f;
                uiExtendedState.poissonDensity = 6.0f;
                uiExtendedState.poissonHumanize = 75.0f;
                break;
            default:
                break;
        }
        masterDriveNorm.store(uiExtendedState.masterDrive * 0.01f, std::memory_order_relaxed);
    }
}

const juce::String BRAUN_AS42AudioProcessor::getProgramName(int index)
{
    switch (index)
    {
        case 0: return "CALIBRATED DEFAULT";
        case 1: return "HAROLD BUDD " + juce::String::charToString(0x00B7) + " PAVILION";
        case 2: return "VANGELIS " + juce::String::charToString(0x00B7) + " CS-80 BRASS";
        case 3: return "ENO " + juce::String::charToString(0x00B7) + " MUSIC FOR AIRPORTS";
        default: return "CALIBRATED DEFAULT";
    }
}

void BRAUN_AS42AudioProcessor::changeProgramName(int, const juce::String&)
{
}

void BRAUN_AS42AudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    dspEngine.prepare(sampleRate, samplesPerBlock);
    const float fs = static_cast<float>(sampleRate > 100.0 ? sampleRate : 48000.0);
    powerFadeDownStep = 1.0f / std::max(1.0f, fs * 0.045f); // 45ms C1 Hermite anti-pop power-off fade
    powerFadeUpStep   = 1.0f / std::max(1.0f, fs * 0.015f); // 15ms C1 Hermite anti-pop power-on fade
    powerLinear       = isPoweredOn.load(std::memory_order_acquire) ? 1.0f : 0.0f;
    dspSilent.store(true, std::memory_order_release);
    pendingSilentPowerSnap.store(-1, std::memory_order_release);
    resetRequested.store(false, std::memory_order_release);
}

void BRAUN_AS42AudioProcessor::releaseResources()
{
    dspEngine.reset();
    dspSilent.store(true, std::memory_order_release);
    pendingSilentPowerSnap.store(-1, std::memory_order_release);
    powerLinear = isPoweredOn.load(std::memory_order_acquire) ? 1.0f : 0.0f;
}

bool BRAUN_AS42AudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    if (layouts.getMainOutputChannelSet() != juce::AudioChannelSet::mono()
     && layouts.getMainOutputChannelSet() != juce::AudioChannelSet::stereo())
        return false;

    return true;
}

void BRAUN_AS42AudioProcessor::pushUIMidiRaw(uint8_t status, uint8_t d1, uint8_t d2) noexcept
{
    const int write = uiMidiWritePos.load(std::memory_order_relaxed);
    const int nextWrite = (write + 1) % kUIMidiQueueSize;
    if (nextWrite != uiMidiReadPos.load(std::memory_order_acquire))
    {
        uiMidiQueue[write] = { status, d1, d2 };
        uiMidiWritePos.store(nextWrite, std::memory_order_release);
    }
}

void BRAUN_AS42AudioProcessor::pushUINoteOn(int noteNumber, float velocity) noexcept
{
    if (!isPoweredOn.load(std::memory_order_acquire))
    {
        isPoweredOn.store(true, std::memory_order_release);
        powerStateDirty.store(true, std::memory_order_release);
        resetRequested.store(false, std::memory_order_release);
        pendingSilentPowerSnap.store(-1, std::memory_order_release);
    }
    const uint8_t note = static_cast<uint8_t>(std::clamp(noteNumber, 0, 127));
    const uint8_t vel = static_cast<uint8_t>(std::clamp(static_cast<int>(std::round(velocity * 127.0f)), 1, 127));
    pushUIMidiRaw(0x90, note, vel);
}

void BRAUN_AS42AudioProcessor::pushUINoteOff(int noteNumber, float velocity) noexcept
{
    const uint8_t note = static_cast<uint8_t>(std::clamp(noteNumber, 0, 127));
    const uint8_t vel = static_cast<uint8_t>(std::clamp(static_cast<int>(std::round(velocity * 127.0f)), 0, 127));
    pushUIMidiRaw(0x80, note, vel);
}

void BRAUN_AS42AudioProcessor::pushUIAllNotesOff() noexcept
{
    pushUIMidiRaw(0xB0, 123, 0); // All Notes Off CC 123
    pushUIMidiRaw(0xB0, 120, 0); // All Sound Off CC 120
}

void BRAUN_AS42AudioProcessor::pushUIPitchBend(float pitchBendCents) noexcept
{
    const float norm = std::clamp((pitchBendCents / 200.0f) * 8192.0f + 8192.0f, 0.0f, 16383.0f);
    const int bend14 = static_cast<int>(std::round(norm));
    const uint8_t lsb = static_cast<uint8_t>(bend14 & 0x7F);
    const uint8_t msb = static_cast<uint8_t>((bend14 >> 7) & 0x7F);
    pushUIMidiRaw(0xE0, lsb, msb);
}

void BRAUN_AS42AudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;

    const int numSamples = buffer.getNumSamples();
    const int numChannels = buffer.getNumChannels();

    // Unconditionally clear all output channels before synthesis
    if (numSamples > 0 && numChannels > 0)
    {
        buffer.clear();
    }

    // Convert UI MIDI FIFO events + incoming juce::MidiBuffer to stack-allocated braun::MidiEvent array
    constexpr int kMaxMidiStack = 256;
    braun::MidiEvent midiEventsStack[kMaxMidiStack];
    int eventCount = 0;

    // 1. Drain UI MIDI events (note clicks, chord macros, computer keyboard, Poisson/Airports loops)
    int uiRead = uiMidiReadPos.load(std::memory_order_relaxed);
    const int uiWrite = uiMidiWritePos.load(std::memory_order_acquire);
    while (uiRead != uiWrite && eventCount < kMaxMidiStack)
    {
        midiEventsStack[eventCount].sampleOffset = 0;
        midiEventsStack[eventCount].status = uiMidiQueue[uiRead].status;
        midiEventsStack[eventCount].data1 = uiMidiQueue[uiRead].data1;
        midiEventsStack[eventCount].data2 = uiMidiQueue[uiRead].data2;
        ++eventCount;
        uiRead = (uiRead + 1) % kUIMidiQueueSize;
    }
    uiMidiReadPos.store(uiRead, std::memory_order_release);

    // 2. Append host DAW MIDI messages
    for (const auto metadata : midiMessages)
    {
        if (eventCount >= kMaxMidiStack)
            break;

        const auto* rawData = metadata.data;
        const int numBytes = metadata.numBytes;
        if (numBytes >= 1)
        {
            midiEventsStack[eventCount].sampleOffset = std::clamp(metadata.samplePosition, 0, std::max(0, numSamples - 1));
            midiEventsStack[eventCount].status = rawData[0];
            midiEventsStack[eventCount].data1 = (numBytes > 1) ? rawData[1] : 0;
            midiEventsStack[eventCount].data2 = (numBytes > 2) ? rawData[2] : 0;
            ++eventCount;
        }
    }
    midiMessages.clear();

    // Power gating: Check if plugin is powered on or woken by an incoming Note-On event.
    // IMPORTANT: Never auto-wake from steady-state drone1Active/drone2Active flags here;
    // rising-edge drone activation already wakes power in setDrone1Active/setDrone2Active,
    // whereas checking drone1Active/drone2Active here prevented powering off when drones were running!
    bool powered = isPoweredOn.load(std::memory_order_acquire);
    if (!powered)
    {
        bool hasNoteOn = false;
        for (int i = 0; i < eventCount; ++i)
        {
            if ((midiEventsStack[i].status & 0xF0) == 0x90 && midiEventsStack[i].data2 > 0)
            {
                hasNoteOn = true;
                break;
            }
        }

        if (hasNoteOn)
        {
            powered = true;
            isPoweredOn.store(true, std::memory_order_release);
            powerStateDirty.store(true, std::memory_order_release);
            resetRequested.store(false, std::memory_order_release);
            pendingSilentPowerSnap.store(-1, std::memory_order_release);
        }
    }

    const int snapReq = pendingSilentPowerSnap.exchange(-1, std::memory_order_acq_rel);
    if (snapReq >= 0 && dspSilent.load(std::memory_order_relaxed))
    {
        powerLinear = (snapReq > 0 && powered) ? 1.0f : 0.0f;
    }

    if (numSamples <= 0 || numChannels <= 0)
    {
        if (!powered && powerLinear <= 0.0f)
        {
            if (resetRequested.exchange(false, std::memory_order_acq_rel) || !dspSilent.load(std::memory_order_relaxed))
            {
                dspEngine.reset();
                dspSilent.store(true, std::memory_order_release);
            }
            return;
        }
        if (eventCount > 0)
        {
            braun::ParameterSnapshot dummySnapshot;
            dummySnapshot.drone_track_midi = droneTrackMidi.load(std::memory_order_relaxed);
            dspEngine.setDroneTrackMidi(dummySnapshot.drone_track_midi);
            dspEngine.process(nullptr, nullptr, 0, dummySnapshot, midiEventsStack, eventCount);
        }
        return;
    }

    // Fast Standby path once 45ms C1 Hermite power-off fade has reached exact 0.0f silence
    if (!powered && powerLinear <= 0.0f)
    {
        if (resetRequested.exchange(false, std::memory_order_acq_rel) || !dspSilent.load(std::memory_order_relaxed))
        {
            dspEngine.reset();
            dspSilent.store(true, std::memory_order_release);
        }
        if (auto* writer = activeWriter.load(std::memory_order_acquire))
        {
            activeWriterWorkers.fetch_add(1, std::memory_order_acquire);
            if (activeWriter.load(std::memory_order_relaxed) != nullptr)
            {
                const float* silentL = buffer.getReadPointer(0);
                const float* silentR = (numChannels > 1) ? buffer.getReadPointer(1) : silentL;
                const float* channels[] = { silentL, silentR };
                writer->write(channels, numSamples);
            }
            activeWriterWorkers.fetch_sub(1, std::memory_order_release);
        }
        return;
    }

    // Read atomic parameter values into Plain-Old-Data snapshot
    braun::ParameterSnapshot snapshot;
    if (paramFeltVolume)      snapshot.felt_volume = paramFeltVolume->load(std::memory_order_relaxed);
    if (paramFeltDecay)       snapshot.felt_decay = paramFeltDecay->load(std::memory_order_relaxed);
    if (paramFeltTone)        snapshot.felt_tone = paramFeltTone->load(std::memory_order_relaxed);
    if (paramFeltHammer)      snapshot.felt_hammer = paramFeltHammer->load(std::memory_order_relaxed);
    if (paramFeltSpace)       snapshot.felt_space = paramFeltSpace->load(std::memory_order_relaxed);
    if (paramFeltWaveform)    snapshot.felt_waveform = static_cast<int>(paramFeltWaveform->load(std::memory_order_relaxed));

    snapshot.drone1_active = drone1Active.load(std::memory_order_relaxed);
    if (paramDrone1Volume)    snapshot.drone1_volume = paramDrone1Volume->load(std::memory_order_relaxed);
    if (paramDrone1Pitch)     snapshot.drone1_pitch = paramDrone1Pitch->load(std::memory_order_relaxed);
    if (paramDrone1Fold)      snapshot.drone1_fold = paramDrone1Fold->load(std::memory_order_relaxed);
    if (paramDrone1Cutoff)    snapshot.drone1_cutoff = paramDrone1Cutoff->load(std::memory_order_relaxed);
    if (paramDrone1Resonance) snapshot.drone1_resonance = paramDrone1Resonance->load(std::memory_order_relaxed);
    if (paramDrone1Beat)      snapshot.drone1_beat = paramDrone1Beat->load(std::memory_order_relaxed);
    if (paramDrone1Detune)    snapshot.drone1_detune = paramDrone1Detune->load(std::memory_order_relaxed);
    if (paramDrone1Lfo)       snapshot.drone1_lfo = paramDrone1Lfo->load(std::memory_order_relaxed);
    if (paramDrone1WaveA)     snapshot.drone1_waveA = static_cast<int>(paramDrone1WaveA->load(std::memory_order_relaxed));
    if (paramDrone1WaveB)     snapshot.drone1_waveB = static_cast<int>(paramDrone1WaveB->load(std::memory_order_relaxed));
    if (paramDrone1IsSubBass) snapshot.drone1_isSubBass = (paramDrone1IsSubBass->load(std::memory_order_relaxed) > 0.5f);

    snapshot.drone2_active = drone2Active.load(std::memory_order_relaxed);
    if (paramDrone2Volume)    snapshot.drone2_volume = paramDrone2Volume->load(std::memory_order_relaxed);
    if (paramDrone2Pitch)     snapshot.drone2_pitch = paramDrone2Pitch->load(std::memory_order_relaxed);
    if (paramDrone2Fold)      snapshot.drone2_fold = paramDrone2Fold->load(std::memory_order_relaxed);
    if (paramDrone2Cutoff)    snapshot.drone2_cutoff = paramDrone2Cutoff->load(std::memory_order_relaxed);
    if (paramDrone2Resonance) snapshot.drone2_resonance = paramDrone2Resonance->load(std::memory_order_relaxed);
    if (paramDrone2Beat)      snapshot.drone2_beat = paramDrone2Beat->load(std::memory_order_relaxed);
    if (paramDrone2Detune)    snapshot.drone2_detune = paramDrone2Detune->load(std::memory_order_relaxed);
    if (paramDrone2Lfo)       snapshot.drone2_lfo = paramDrone2Lfo->load(std::memory_order_relaxed);
    if (paramDrone2WaveA)     snapshot.drone2_waveA = static_cast<int>(paramDrone2WaveA->load(std::memory_order_relaxed));
    if (paramDrone2WaveB)     snapshot.drone2_waveB = static_cast<int>(paramDrone2WaveB->load(std::memory_order_relaxed));

    snapshot.drone_track_midi = droneTrackMidi.load(std::memory_order_relaxed);
    dspEngine.setDroneTrackMidi(snapshot.drone_track_midi);

    if (paramTapeTime)        snapshot.tape_time = paramTapeTime->load(std::memory_order_relaxed);
    if (paramTapeFeedback)    snapshot.tape_feedback = paramTapeFeedback->load(std::memory_order_relaxed);
    if (paramTapeMix)         snapshot.tape_mix = paramTapeMix->load(std::memory_order_relaxed);
    if (paramTapeWow)         snapshot.tape_wow = paramTapeWow->load(std::memory_order_relaxed);
    if (paramTapeTone)        snapshot.tape_tone = paramTapeTone->load(std::memory_order_relaxed);

    if (paramShimmerMix)      snapshot.shimmer_mix = paramShimmerMix->load(std::memory_order_relaxed);
    if (paramShimmerDecay)    snapshot.shimmer_decay = paramShimmerDecay->load(std::memory_order_relaxed);
    if (paramShimmerDamping)  snapshot.shimmer_damping = paramShimmerDamping->load(std::memory_order_relaxed);
    if (paramShimmerAmount)   snapshot.shimmer_amount = paramShimmerAmount->load(std::memory_order_relaxed);
    if (paramShimmerFreeze)   snapshot.shimmer_freeze = (paramShimmerFreeze->load(std::memory_order_relaxed) > 0.5f);

    if (paramMasterVolume)    snapshot.master_volume = paramMasterVolume->load(std::memory_order_relaxed);
    snapshot.master_drive = masterDriveNorm.load(std::memory_order_relaxed);

    if (powered)
    {
        resetRequested.store(false, std::memory_order_relaxed);
        if (dspSilent.load(std::memory_order_relaxed) && powerLinear <= 0.0f && !snapshot.drone1_active && !snapshot.drone2_active)
        {
            // Waking from already-zeroed Standby with piano Note-On only: preserve full hammer transient
            powerLinear = 1.0f;
        }
        dspSilent.store(false, std::memory_order_release);
    }

    float* left = buffer.getWritePointer(0);
    float* right = (buffer.getNumChannels() > 1) ? buffer.getWritePointer(1) : left;

    dspEngine.process(left, right, numSamples, snapshot, midiEventsStack, eventCount);

    // Apply C1-smooth Hermite master power ramp (g = p^2 * (3 - 2p)) during power-off or power-on transitions
    if (!powered)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            if (powerLinear > 0.0f)
            {
                powerLinear = std::max(0.0f, powerLinear - powerFadeDownStep);
                const float g = powerLinear * powerLinear * (3.0f - 2.0f * powerLinear);
                left[i] *= g;
                if (right != left)
                    right[i] *= g;
            }
            else
            {
                left[i] = 0.0f;
                if (right != left)
                    right[i] = 0.0f;
            }
        }
        if (powerLinear <= 0.0f)
        {
            resetRequested.store(false, std::memory_order_release);
            dspEngine.reset();
            dspSilent.store(true, std::memory_order_release);
            clearScopeBuffers();
        }
    }
    else if (powerLinear < 1.0f)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            if (powerLinear < 1.0f)
            {
                powerLinear = std::min(1.0f, powerLinear + powerFadeUpStep);
                const float g = powerLinear * powerLinear * (3.0f - 2.0f * powerLinear);
                left[i] *= g;
                if (right != left)
                    right[i] *= g;
            }
        }
    }

    if (auto* writer = activeWriter.load(std::memory_order_acquire))
    {
        activeWriterWorkers.fetch_add(1, std::memory_order_acquire);
        if (activeWriter.load(std::memory_order_relaxed) != nullptr)
        {
            const float* channels[] = { left, right };
            writer->write(channels, numSamples);
        }
        activeWriterWorkers.fetch_sub(1, std::memory_order_release);
    }

    if (powered)
    {
        pushScopeSamples(left, right, numSamples);
    }
}

void BRAUN_AS42AudioProcessor::pushScopeSamples(const float* left, const float* right, int numSamples) noexcept
{
    if (left == nullptr || numSamples <= 0)
        return;

    int pos = scopeWritePos.load(std::memory_order_relaxed);
    for (int i = 0; i < numSamples; ++i)
    {
        scopeBufferL[pos] = left[i];
        scopeBufferR[pos] = (right != nullptr) ? right[i] : left[i];
        pos = (pos + 1);
        if (pos >= kScopeBufferSize)
            pos = 0;
    }
    scopeWritePos.store(pos, std::memory_order_release);
}

void BRAUN_AS42AudioProcessor::getScopeSamples(float* destL, float* destR, int numSamplesToRead) const noexcept
{
    if (destL == nullptr || numSamplesToRead <= 0)
        return;

    numSamplesToRead = std::min(numSamplesToRead, kScopeBufferSize);

    int writePos = scopeWritePos.load(std::memory_order_acquire);
    int readPos = ((writePos - numSamplesToRead) % kScopeBufferSize + kScopeBufferSize) % kScopeBufferSize;
    for (int i = 0; i < numSamplesToRead; ++i)
    {
        destL[i] = scopeBufferL[readPos];
        if (destR != nullptr)
            destR[i] = scopeBufferR[readPos];
        readPos = (readPos + 1);
        if (readPos >= kScopeBufferSize)
            readPos = 0;
    }
}

void BRAUN_AS42AudioProcessor::clearScopeBuffers() noexcept
{
    std::fill_n(scopeBufferL, kScopeBufferSize, 0.0f);
    std::fill_n(scopeBufferR, kScopeBufferSize, 0.0f);
    scopeWritePos.store(0, std::memory_order_release);
}

void BRAUN_AS42AudioProcessor::setPoweredOn(bool on) noexcept
{
    pendingSilentPowerSnap.store(-1, std::memory_order_release);
    isPoweredOn.store(on, std::memory_order_release);
    powerStateDirty.store(true, std::memory_order_release);
    if (!on)
    {
        clearScopeBuffers();
        resetRequested.store(true, std::memory_order_release);
    }
    else
    {
        resetRequested.store(false, std::memory_order_release);
    }
}

bool BRAUN_AS42AudioProcessor::getPoweredOn() const noexcept
{
    return isPoweredOn.load(std::memory_order_acquire);
}

bool BRAUN_AS42AudioProcessor::consumePowerStateDirty() noexcept
{
    return powerStateDirty.exchange(false, std::memory_order_acq_rel);
}

void BRAUN_AS42AudioProcessor::setDrone1Active(bool active) noexcept
{
    drone1Active.store(active, std::memory_order_release);
    drone1StateDirty.store(true, std::memory_order_release);
    if (active && !isPoweredOn.load(std::memory_order_acquire))
    {
        pendingSilentPowerSnap.store(-1, std::memory_order_release);
        isPoweredOn.store(true, std::memory_order_release);
        powerStateDirty.store(true, std::memory_order_release);
        resetRequested.store(false, std::memory_order_release);
    }
}

bool BRAUN_AS42AudioProcessor::getDrone1Active() const noexcept
{
    return drone1Active.load(std::memory_order_acquire);
}

bool BRAUN_AS42AudioProcessor::consumeDrone1StateDirty() noexcept
{
    return drone1StateDirty.exchange(false, std::memory_order_acq_rel);
}

void BRAUN_AS42AudioProcessor::setDrone2Active(bool active) noexcept
{
    drone2Active.store(active, std::memory_order_release);
    drone2StateDirty.store(true, std::memory_order_release);
    if (active && !isPoweredOn.load(std::memory_order_acquire))
    {
        pendingSilentPowerSnap.store(-1, std::memory_order_release);
        isPoweredOn.store(true, std::memory_order_release);
        powerStateDirty.store(true, std::memory_order_release);
        resetRequested.store(false, std::memory_order_release);
    }
}

bool BRAUN_AS42AudioProcessor::getDrone2Active() const noexcept
{
    return drone2Active.load(std::memory_order_acquire);
}

bool BRAUN_AS42AudioProcessor::consumeDrone2StateDirty() noexcept
{
    return drone2StateDirty.exchange(false, std::memory_order_acq_rel);
}

void BRAUN_AS42AudioProcessor::setDroneTrackMidi(bool track) noexcept
{
    droneTrackMidi.store(track, std::memory_order_relaxed);
    droneTrackMidiDirty.store(true, std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::getDroneTrackMidi() const noexcept
{
    return droneTrackMidi.load(std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::consumeDroneTrackMidiDirty() noexcept
{
    return droneTrackMidiDirty.exchange(false, std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::consumeFullSyncRequested() noexcept
{
    return fullSyncRequested.exchange(false, std::memory_order_acq_rel);
}

void BRAUN_AS42AudioProcessor::startRecording()
{
    const juce::ScopedLock sl(recorderLock);
    if (activeWriter.load(std::memory_order_relaxed) != nullptr || threadedWriter != nullptr)
        return;

    const double sampleRateToUse = getSampleRate() > 0.0 ? getSampleRate() : 44100.0;

    auto musicDir = juce::File::getSpecialLocation(juce::File::SpecialLocationType::userMusicDirectory);
    if (!musicDir.isDirectory())
    {
        musicDir = juce::File::getSpecialLocation(juce::File::SpecialLocationType::userDocumentsDirectory);
        if (!musicDir.isDirectory())
            musicDir = juce::File::getSpecialLocation(juce::File::SpecialLocationType::userHomeDirectory);
    }

    const auto recordingsDir = musicDir.getChildFile("Braun AS-42 Recordings");
    if (!recordingsDir.exists())
    {
        const auto result = recordingsDir.createDirectory();
        if (result.failed())
            return;
    }

    const juce::String timestamp = juce::Time::getCurrentTime().formatted("%Y-%m-%d-%H-%M-%S");
    const juce::File wavFile = recordingsDir.getNonexistentChildFile("braun-ambient-" + timestamp, ".wav");

    if (auto stream = wavFile.createOutputStream())
    {
        juce::WavAudioFormat wavFormat;
        if (auto* rawWriter = wavFormat.createWriterFor(stream.get(), sampleRateToUse, 2, 16, {}, 0))
        {
            stream.release();
            lastRecordedFile = wavFile;
            threadedWriter = std::make_unique<juce::AudioFormatWriter::ThreadedWriter>(rawWriter, recorderThread, 131072);
            activeWriter.store(threadedWriter.get(), std::memory_order_release);
        }
    }
}

void BRAUN_AS42AudioProcessor::stopRecording()
{
    const juce::ScopedLock sl(recorderLock);
    if (activeWriter.load(std::memory_order_relaxed) == nullptr && threadedWriter == nullptr)
        return;

    {
        const juce::ScopedLock slCb(getCallbackLock());
        activeWriter.store(nullptr, std::memory_order_release);
    }

    while (activeWriterWorkers.load(std::memory_order_acquire) > 0)
    {
        juce::Thread::yield();
    }

    threadedWriter.reset();

    recordingSavedDirty.store(true, std::memory_order_relaxed);

    if (lastRecordedFile.existsAsFile() && getActiveEditor() != nullptr)
    {
        juce::Thread::launch([f = lastRecordedFile] { f.revealToUser(); });
    }
}

bool BRAUN_AS42AudioProcessor::isRecording() const noexcept
{
    return activeWriter.load(std::memory_order_relaxed) != nullptr;
}

juce::File BRAUN_AS42AudioProcessor::getLastRecordedFile() const
{
    const juce::ScopedLock sl(recorderLock);
    return lastRecordedFile;
}

bool BRAUN_AS42AudioProcessor::consumeRecordingSavedDirty() noexcept
{
    return recordingSavedDirty.exchange(false, std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::hasEditor() const
{
    return true;
}

juce::AudioProcessorEditor* BRAUN_AS42AudioProcessor::createEditor()
{
    if (wrapperType == juce::AudioProcessor::wrapperType_Standalone)
    {
        // StandalonePluginHolder::init() always runs reloadPluginState() before createEditor().
        // Marking startup state consumed here ensures manual user file loads later in the session work normally.
        standaloneStartupStateConsumed.store(true, std::memory_order_release);
    }
    return new BRAUN_AS42AudioProcessorEditor(*this);
}

BRAUN_AS42AudioProcessor::UIExtendedState BRAUN_AS42AudioProcessor::getUIExtendedState() const
{
    const juce::SpinLock::ScopedLockType sl(uiStateLock);
    return uiExtendedState;
}

void BRAUN_AS42AudioProcessor::setUIExtendedProperty(const juce::String& key, const juce::var& value)
{
    const juce::SpinLock::ScopedLockType sl(uiStateLock);
    if (key.equalsIgnoreCase("uiTheme") || key.equalsIgnoreCase("theme"))
    {
        const juce::String t = value.toString().trim().toLowerCase();
        if (t == "dark" || t == "light")
            uiExtendedState.uiTheme = t;
    }
    else if (key.equalsIgnoreCase("rootPitchClass"))
    {
        uiExtendedState.rootPitchClass = std::clamp(static_cast<int>(value), 0, 11);
    }
    else if (key.equalsIgnoreCase("scaleKey") || key.equalsIgnoreCase("currentScaleKey"))
    {
        const juce::String s = value.toString().trim();
        if (s.isNotEmpty())
            uiExtendedState.scaleKey = s;
    }
    else if (key.equalsIgnoreCase("tuningA4") || key.equalsIgnoreCase("a4"))
    {
        const float a4 = static_cast<float>(value);
        if (a4 >= 400.0f && a4 <= 480.0f)
            uiExtendedState.tuningA4 = a4;
    }
    else if (key.equalsIgnoreCase("masterDrive") || key.equalsIgnoreCase("tapeDrive") || key.equalsIgnoreCase("master_drive"))
    {
        uiExtendedState.masterDrive = std::clamp(static_cast<float>(value), 0.0f, 100.0f);
        masterDriveNorm.store(uiExtendedState.masterDrive * 0.01f, std::memory_order_relaxed);
    }
    else if (key.equalsIgnoreCase("poissonDensity") || key.equalsIgnoreCase("poisson_density"))
    {
        uiExtendedState.poissonDensity = std::clamp(static_cast<float>(value), 4.0f, 30.0f);
    }
    else if (key.equalsIgnoreCase("poissonHumanize") || key.equalsIgnoreCase("poisson_humanize"))
    {
        uiExtendedState.poissonHumanize = std::clamp(static_cast<float>(value), 0.0f, 100.0f);
    }
    else if (key.equalsIgnoreCase("chordSpeed"))
    {
        const juce::String cs = value.toString().trim().toLowerCase();
        if (cs == "slow" || cs == "med" || cs == "fast" || cs == "instant")
            uiExtendedState.chordSpeed = cs;
    }
    else if (key.equalsIgnoreCase("scopeMode"))
    {
        const juce::String sm = value.toString().trim().toLowerCase();
        if (sm.isNotEmpty())
            uiExtendedState.scopeMode = sm;
    }
    else if (key.equalsIgnoreCase("drone1Snap"))
    {
        const juce::String ds = value.toString().trim();
        if (ds.isNotEmpty())
            uiExtendedState.drone1Snap = ds;
    }
    else if (key.equalsIgnoreCase("drone2Snap"))
    {
        const juce::String ds = value.toString().trim();
        if (ds.isNotEmpty())
            uiExtendedState.drone2Snap = ds;
    }
    else if (key.equalsIgnoreCase("vectorMode"))
    {
        const juce::String vm = value.toString().trim().toLowerCase();
        if (vm == "momentary" || vm == "latch")
            uiExtendedState.vectorMode = vm;
    }
    else if (key.equalsIgnoreCase("vectorX"))
    {
        uiExtendedState.vectorX = std::clamp(static_cast<float>(value), 0.0f, 1.0f);
    }
    else if (key.equalsIgnoreCase("vectorY"))
    {
        uiExtendedState.vectorY = std::clamp(static_cast<float>(value), 0.0f, 1.0f);
    }
    else if (key.equalsIgnoreCase("customPatchJson"))
    {
        const juce::String s = value.toString().trim();
        if (s.isNotEmpty() && s.length() <= 65536)
        {
            uiExtendedState.customPatchJson = s;
            uiExtendedState.isCustomPatch = true;
        }
        else
        {
            uiExtendedState.customPatchJson.clear();
            uiExtendedState.isCustomPatch = false;
        }
    }
}

void BRAUN_AS42AudioProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    state.setProperty("isPoweredOn", isPoweredOn.load(std::memory_order_acquire), nullptr);
    state.setProperty("drone1Active", drone1Active.load(std::memory_order_acquire), nullptr);
    state.setProperty("drone2Active", drone2Active.load(std::memory_order_acquire), nullptr);
    state.setProperty("droneTrackMidi", droneTrackMidi.load(std::memory_order_relaxed), nullptr);
    state.setProperty("currentProgram", currentProgram.load(std::memory_order_relaxed), nullptr);
    {
        const auto ui = getUIExtendedState();
        state.setProperty("uiTheme", ui.uiTheme, nullptr);
        state.setProperty("rootPitchClass", ui.rootPitchClass, nullptr);
        state.setProperty("scaleKey", ui.scaleKey, nullptr);
        state.setProperty("tuningA4", ui.tuningA4, nullptr);
        state.setProperty("masterDrive", ui.masterDrive, nullptr);
        state.setProperty("poissonDensity", ui.poissonDensity, nullptr);
        state.setProperty("poissonHumanize", ui.poissonHumanize, nullptr);
        state.setProperty("chordSpeed", ui.chordSpeed, nullptr);
        state.setProperty("scopeMode", ui.scopeMode, nullptr);
        state.setProperty("drone1Snap", ui.drone1Snap, nullptr);
        state.setProperty("drone2Snap", ui.drone2Snap, nullptr);
        state.setProperty("vectorMode", ui.vectorMode, nullptr);
        state.setProperty("vectorX", ui.vectorX, nullptr);
        state.setProperty("vectorY", ui.vectorY, nullptr);
        state.setProperty("isCustomPatch", ui.isCustomPatch, nullptr);
        state.setProperty("customPatchJson", ui.customPatchJson, nullptr);
    }
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void BRAUN_AS42AudioProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xmlState(getXmlFromBinary(data, sizeInBytes));
    if (xmlState != nullptr && xmlState->hasTagName(apvts.state.getType()))
    {
        const bool isStandaloneStartupReload =
            (wrapperType == juce::AudioProcessor::wrapperType_Standalone)
            && !standaloneStartupStateConsumed.exchange(true, std::memory_order_acq_rel);

        auto vt = juce::ValueTree::fromXml(*xmlState);
        apvts.replaceState(vt);

        const int prog = vt.hasProperty("currentProgram")
            ? std::clamp(static_cast<int>(vt.getProperty("currentProgram")), 0, getNumPrograms() - 1)
            : 0;
        currentProgram.store(prog, std::memory_order_relaxed);

        const bool savedTrack = vt.hasProperty("droneTrackMidi")
            ? static_cast<bool>(vt.getProperty("droneTrackMidi"))
            : false;
        setDroneTrackMidi(savedTrack);

        {
            {
                const juce::SpinLock::ScopedLockType sl(uiStateLock);
                uiExtendedState = UIExtendedState {};
                if (paramDrone1IsSubBass != nullptr && paramDrone1IsSubBass->load(std::memory_order_relaxed) > 0.5f)
                    uiExtendedState.drone1Snap = "sub-bass";
                masterDriveNorm.store(uiExtendedState.masterDrive * 0.01f, std::memory_order_relaxed);
            }
            static const char* const kUIProps[] = {
                "uiTheme", "rootPitchClass", "scaleKey", "tuningA4",
                "masterDrive", "poissonDensity", "poissonHumanize",
                "chordSpeed", "scopeMode", "drone1Snap", "drone2Snap",
                "vectorMode", "vectorX", "vectorY"
            };
            for (const char* prop : kUIProps)
            {
                if (vt.hasProperty(prop))
                    setUIExtendedProperty(prop, vt.getProperty(prop));
            }
            if (vt.hasProperty("isCustomPatch") && static_cast<bool>(vt.getProperty("isCustomPatch")) && vt.hasProperty("customPatchJson"))
            {
                setUIExtendedProperty("customPatchJson", vt.getProperty("customPatchJson"));
            }
        }

        if (isStandaloneStartupReload)
        {
            // Standalone cold-boot guard: JUCE StandalonePluginHolder auto-saves state on window close
            // and reloads it on launch. Disarm continuous sound latches (Drone 1/2, Shimmer Freeze) and
            // boot into silent Standby so launching BRAUN_AS42.exe never auto-starts drones from a prior exit,
            // while faithfully preserving user knob settings, waveforms, preset selection, and MIDI tracking.
            setDrone1Active(false);
            setDrone2Active(false);
            if (auto* freezeParam = apvts.getParameter("shimmer_freeze"))
            {
                freezeParam->setValueNotifyingHost(0.0f);
            }
            setPoweredOn(false);
            pendingSilentPowerSnap.store(0, std::memory_order_release);
        }
        else
        {
            const bool savedD1 = vt.hasProperty("drone1Active")
                ? static_cast<bool>(vt.getProperty("drone1Active"))
                : false;
            const bool savedD2 = vt.hasProperty("drone2Active")
                ? static_cast<bool>(vt.getProperty("drone2Active"))
                : false;

            setDrone1Active(savedD1);
            setDrone2Active(savedD2);

            const bool savedPower = vt.hasProperty("isPoweredOn")
                ? static_cast<bool>(vt.getProperty("isPoweredOn"))
                : true;
            setPoweredOn(savedPower);
            pendingSilentPowerSnap.store(savedPower ? 1 : 0, std::memory_order_release);
        }

        fullSyncRequested.store(true, std::memory_order_release);
    }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new BRAUN_AS42AudioProcessor();
}
