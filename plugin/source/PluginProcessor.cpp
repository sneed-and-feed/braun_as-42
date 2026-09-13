#include "PluginProcessor.h"
#include "PluginEditor.h"

BRAUN_AS42AudioProcessor::BRAUN_AS42AudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Parameters", braun::Parameters::createParameterLayout())
{
    // Cache atomic parameter value pointers
    paramFeltVolume      = apvts.getRawParameterValue("felt_volume");
    paramFeltDecay       = apvts.getRawParameterValue("felt_decay");
    paramFeltTone        = apvts.getRawParameterValue("felt_tone");
    paramFeltHammer      = apvts.getRawParameterValue("felt_hammer");
    paramFeltSpace       = apvts.getRawParameterValue("felt_space");

    paramDrone1Volume    = apvts.getRawParameterValue("drone1_volume");
    paramDrone1Pitch     = apvts.getRawParameterValue("drone1_pitch");
    paramDrone1Fold      = apvts.getRawParameterValue("drone1_fold");
    paramDrone1Cutoff    = apvts.getRawParameterValue("drone1_cutoff");
    paramDrone1Resonance = apvts.getRawParameterValue("drone1_resonance");

    paramDrone2Volume    = apvts.getRawParameterValue("drone2_volume");
    paramDrone2Pitch     = apvts.getRawParameterValue("drone2_pitch");
    paramDrone2Fold      = apvts.getRawParameterValue("drone2_fold");
    paramDrone2Cutoff    = apvts.getRawParameterValue("drone2_cutoff");
    paramDrone2Resonance = apvts.getRawParameterValue("drone2_resonance");

    paramTapeTime        = apvts.getRawParameterValue("tape_time");
    paramTapeFeedback    = apvts.getRawParameterValue("tape_feedback");
    paramTapeMix         = apvts.getRawParameterValue("tape_mix");
    paramTapeWow         = apvts.getRawParameterValue("tape_wow");

    paramShimmerMix      = apvts.getRawParameterValue("shimmer_mix");
    paramShimmerDecay    = apvts.getRawParameterValue("shimmer_decay");

    paramMasterVolume    = apvts.getRawParameterValue("master_volume");
}

BRAUN_AS42AudioProcessor::~BRAUN_AS42AudioProcessor()
{
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

void BRAUN_AS42AudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;

    const int numSamples = buffer.getNumSamples();
    if (numSamples <= 0)
        return;

    // Read atomic parameter values into Plain-Old-Data snapshot
    braun::ParameterSnapshot snapshot;
    if (paramFeltVolume)      snapshot.felt_volume = paramFeltVolume->load(std::memory_order_relaxed);
    if (paramFeltDecay)       snapshot.felt_decay = paramFeltDecay->load(std::memory_order_relaxed);
    if (paramFeltTone)        snapshot.felt_tone = paramFeltTone->load(std::memory_order_relaxed);
    if (paramFeltHammer)      snapshot.felt_hammer = paramFeltHammer->load(std::memory_order_relaxed);
    if (paramFeltSpace)       snapshot.felt_space = paramFeltSpace->load(std::memory_order_relaxed);

    if (paramDrone1Volume)    snapshot.drone1_volume = paramDrone1Volume->load(std::memory_order_relaxed);
    if (paramDrone1Pitch)     snapshot.drone1_pitch = paramDrone1Pitch->load(std::memory_order_relaxed);
    if (paramDrone1Fold)      snapshot.drone1_fold = paramDrone1Fold->load(std::memory_order_relaxed);
    if (paramDrone1Cutoff)    snapshot.drone1_cutoff = paramDrone1Cutoff->load(std::memory_order_relaxed);
    if (paramDrone1Resonance) snapshot.drone1_resonance = paramDrone1Resonance->load(std::memory_order_relaxed);

    if (paramDrone2Volume)    snapshot.drone2_volume = paramDrone2Volume->load(std::memory_order_relaxed);
    if (paramDrone2Pitch)     snapshot.drone2_pitch = paramDrone2Pitch->load(std::memory_order_relaxed);
    if (paramDrone2Fold)      snapshot.drone2_fold = paramDrone2Fold->load(std::memory_order_relaxed);
    if (paramDrone2Cutoff)    snapshot.drone2_cutoff = paramDrone2Cutoff->load(std::memory_order_relaxed);
    if (paramDrone2Resonance) snapshot.drone2_resonance = paramDrone2Resonance->load(std::memory_order_relaxed);

    if (paramTapeTime)        snapshot.tape_time = paramTapeTime->load(std::memory_order_relaxed);
    if (paramTapeFeedback)    snapshot.tape_feedback = paramTapeFeedback->load(std::memory_order_relaxed);
    if (paramTapeMix)         snapshot.tape_mix = paramTapeMix->load(std::memory_order_relaxed);
    if (paramTapeWow)         snapshot.tape_wow = paramTapeWow->load(std::memory_order_relaxed);

    if (paramShimmerMix)      snapshot.shimmer_mix = paramShimmerMix->load(std::memory_order_relaxed);
    if (paramShimmerDecay)    snapshot.shimmer_decay = paramShimmerDecay->load(std::memory_order_relaxed);

    if (paramMasterVolume)    snapshot.master_volume = paramMasterVolume->load(std::memory_order_relaxed);

    // Convert incoming juce::MidiBuffer to stack-allocated braun::MidiEvent array (zero heap allocations)
    constexpr int kMaxMidiStack = 256;
    braun::MidiEvent midiEventsStack[kMaxMidiStack];
    int eventCount = 0;

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

    float* left = buffer.getWritePointer(0);
    float* right = (buffer.getNumChannels() > 1) ? buffer.getWritePointer(1) : left;

    dspEngine.process(left, right, numSamples, snapshot, midiEventsStack, eventCount);
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
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void BRAUN_AS42AudioProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xmlState(getXmlFromBinary(data, sizeInBytes));
    if (xmlState != nullptr && xmlState->hasTagName(apvts.state.getType()))
        apvts.replaceState(juce::ValueTree::fromXml(*xmlState));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new BRAUN_AS42AudioProcessor();
}
