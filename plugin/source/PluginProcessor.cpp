#include "PluginProcessor.h"
#include "PluginEditor.h"

BRAUN_AS42AudioProcessor::BRAUN_AS42AudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Parameters", braun::Parameters::createParameterLayout())
{
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
    return 8.0;
}

int BRAUN_AS42AudioProcessor::getNumPrograms()
{
    return 1;
}

int BRAUN_AS42AudioProcessor::getCurrentProgram()
{
    return 0;
}

void BRAUN_AS42AudioProcessor::setCurrentProgram(int)
{
}

const juce::String BRAUN_AS42AudioProcessor::getProgramName(int)
{
    return "Default";
}

void BRAUN_AS42AudioProcessor::changeProgramName(int, const juce::String&)
{
}

void BRAUN_AS42AudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    dspEngine.prepare(sampleRate, samplesPerBlock);
}

void BRAUN_AS42AudioProcessor::releaseResources()
{
    dspEngine.reset();
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
    if (!isPoweredOn.load(std::memory_order_relaxed))
    {
        isPoweredOn.store(true, std::memory_order_relaxed);
        powerStateDirty.store(true, std::memory_order_relaxed);
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
    if (numSamples <= 0 || buffer.getNumChannels() <= 0)
        return;

    // Unconditionally clear the audio buffer before synthesis.
    // As a synthesizer generator with 0 inputs, all output channels must be cleared
    // to prevent leaking uninitialized host buffers, garbage memory, or extra channel data.
    buffer.clear();

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
            midiEventsStack[eventCount].sampleOffset = metadata.samplePosition;
            midiEventsStack[eventCount].status = rawData[0];
            midiEventsStack[eventCount].data1 = (numBytes > 1) ? rawData[1] : 0;
            midiEventsStack[eventCount].data2 = (numBytes > 2) ? rawData[2] : 0;
            ++eventCount;
        }
    }
    midiMessages.clear();

    // Power gating: Check if plugin is powered on or triggered by Note-On from UI or Host MIDI
    if (!isPoweredOn.load(std::memory_order_relaxed))
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
            isPoweredOn.store(true, std::memory_order_relaxed);
            powerStateDirty.store(true, std::memory_order_relaxed);
        }
        else
        {
            return;
        }
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

    float* left = buffer.getWritePointer(0);
    float* right = (buffer.getNumChannels() > 1) ? buffer.getWritePointer(1) : left;

    dspEngine.process(left, right, numSamples, snapshot, midiEventsStack, eventCount);

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

    pushScopeSamples(left, right, numSamples);
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

void BRAUN_AS42AudioProcessor::setPoweredOn(bool on) noexcept
{
    isPoweredOn.store(on, std::memory_order_relaxed);
    powerStateDirty.store(true, std::memory_order_relaxed);
    if (!on)
    {
        dspEngine.reset();
    }
}

bool BRAUN_AS42AudioProcessor::getPoweredOn() const noexcept
{
    return isPoweredOn.load(std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::consumePowerStateDirty() noexcept
{
    return powerStateDirty.exchange(false, std::memory_order_relaxed);
}

void BRAUN_AS42AudioProcessor::setDrone1Active(bool active) noexcept
{
    drone1Active.store(active, std::memory_order_relaxed);
    drone1StateDirty.store(true, std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::getDrone1Active() const noexcept
{
    return drone1Active.load(std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::consumeDrone1StateDirty() noexcept
{
    return drone1StateDirty.exchange(false, std::memory_order_relaxed);
}

void BRAUN_AS42AudioProcessor::setDrone2Active(bool active) noexcept
{
    drone2Active.store(active, std::memory_order_relaxed);
    drone2StateDirty.store(true, std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::getDrone2Active() const noexcept
{
    return drone2Active.load(std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::consumeDrone2StateDirty() noexcept
{
    return drone2StateDirty.exchange(false, std::memory_order_relaxed);
}

void BRAUN_AS42AudioProcessor::setDroneTrackMidi(bool track) noexcept
{
    droneTrackMidi.store(track, std::memory_order_relaxed);
    droneTrackMidiDirty.store(true, std::memory_order_relaxed);
    dspEngine.setDroneTrackMidi(track);
}

bool BRAUN_AS42AudioProcessor::getDroneTrackMidi() const noexcept
{
    return droneTrackMidi.load(std::memory_order_relaxed);
}

bool BRAUN_AS42AudioProcessor::consumeDroneTrackMidiDirty() noexcept
{
    return droneTrackMidiDirty.exchange(false, std::memory_order_relaxed);
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

    if (lastRecordedFile.existsAsFile())
    {
        lastRecordedFile.revealToUser();
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
    return new BRAUN_AS42AudioProcessorEditor(*this);
}

void BRAUN_AS42AudioProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    state.setProperty("isPoweredOn", isPoweredOn.load(std::memory_order_relaxed), nullptr);
    state.setProperty("drone1Active", drone1Active.load(std::memory_order_relaxed), nullptr);
    state.setProperty("drone2Active", drone2Active.load(std::memory_order_relaxed), nullptr);
    state.setProperty("droneTrackMidi", droneTrackMidi.load(std::memory_order_relaxed), nullptr);
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void BRAUN_AS42AudioProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xmlState(getXmlFromBinary(data, sizeInBytes));
    if (xmlState != nullptr && xmlState->hasTagName(apvts.state.getType()))
    {
        auto vt = juce::ValueTree::fromXml(*xmlState);
        apvts.replaceState(vt);
        if (vt.hasProperty("isPoweredOn"))
            setPoweredOn(static_cast<bool>(vt.getProperty("isPoweredOn")));
        if (vt.hasProperty("drone1Active"))
            setDrone1Active(static_cast<bool>(vt.getProperty("drone1Active")));
        if (vt.hasProperty("drone2Active"))
            setDrone2Active(static_cast<bool>(vt.getProperty("drone2Active")));
        if (vt.hasProperty("droneTrackMidi"))
            setDroneTrackMidi(static_cast<bool>(vt.getProperty("droneTrackMidi")));
    }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new BRAUN_AS42AudioProcessor();
}
