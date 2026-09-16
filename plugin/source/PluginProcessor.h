#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include "dsp/DspEngine.h"
#include "Parameters.h"

class BRAUN_AS42AudioProcessor : public juce::AudioProcessor
{
public:
    BRAUN_AS42AudioProcessor();
    ~BRAUN_AS42AudioProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;

    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;

    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override;

    const juce::String getName() const override;

    bool acceptsMidi() const override;
    bool producesMidi() const override;
    bool isMidiEffect() const override;
    double getTailLengthSeconds() const override;

    int getNumPrograms() override;
    int getCurrentProgram() override;
    void setCurrentProgram(int index) override;
    const juce::String getProgramName(int index) override;
    void changeProgramName(int index, const juce::String& newName) override;

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState& getAPVTS() noexcept { return apvts; }
    braun::DspEngine& getDspEngine() noexcept { return dspEngine; }

    void setPoweredOn(bool on) noexcept;
    bool getPoweredOn() const noexcept;
    bool consumePowerStateDirty() noexcept;

    void setDrone1Active(bool active) noexcept;
    bool getDrone1Active() const noexcept;
    bool consumeDrone1StateDirty() noexcept;

    void setDrone2Active(bool active) noexcept;
    bool getDrone2Active() const noexcept;
    bool consumeDrone2StateDirty() noexcept;

    void setDroneTrackMidi(bool track) noexcept;
    bool getDroneTrackMidi() const noexcept;
    bool consumeDroneTrackMidiDirty() noexcept;

    // Lock-free UI MIDI Event injection (for onscreen play surface, macros, chords, and keyboard shortcuts)
    void pushUINoteOn(int noteNumber, float velocity) noexcept;
    void pushUINoteOff(int noteNumber, float velocity = 0.0f) noexcept;
    void pushUIAllNotesOff() noexcept;
    void pushUIPitchBend(float pitchBendCents) noexcept;
    void pushUIMidiRaw(uint8_t status, uint8_t d1, uint8_t d2) noexcept;

    // Lock-free oscilloscope visualizer buffer
    static constexpr int kScopeBufferSize = 2048;
    void pushScopeSamples(const float* left, const float* right, int numSamples) noexcept;
    void getScopeSamples(float* destL, float* destR, int numSamplesToRead) const noexcept;

    // Lossless WAV Background Recorder
    void startRecording();
    void stopRecording();
    bool isRecording() const noexcept;
    juce::File getLastRecordedFile() const;
    bool consumeRecordingSavedDirty() noexcept;

private:
    juce::AudioProcessorValueTreeState apvts;
    braun::DspEngine dspEngine;

    // Power, drone voice active states, and drone MIDI tracking state
    std::atomic<bool> isPoweredOn { false };
    std::atomic<bool> powerStateDirty { false };
    std::atomic<bool> resetRequested { false };
    std::atomic<bool> drone1Active { false };
    std::atomic<bool> drone1StateDirty { false };
    std::atomic<bool> drone2Active { false };
    std::atomic<bool> drone2StateDirty { false };
    std::atomic<bool> droneTrackMidi { false };
    std::atomic<bool> droneTrackMidiDirty { false };

    // Lock-free FIFO queue for UI MIDI events
    struct UIMidiEvent {
        uint8_t status { 0 };
        uint8_t data1 { 0 };
        uint8_t data2 { 0 };
    };
    static constexpr int kUIMidiQueueSize = 256;
    UIMidiEvent uiMidiQueue[kUIMidiQueueSize] {};
    std::atomic<int> uiMidiWritePos { 0 };
    std::atomic<int> uiMidiReadPos { 0 };

    // Cached raw atomic parameter pointers for lock-free, zero-overhead audio thread reads
    // 1. Felt Piano
    std::atomic<float>* paramFeltVolume { nullptr };
    std::atomic<float>* paramFeltDecay { nullptr };
    std::atomic<float>* paramFeltTone { nullptr };
    std::atomic<float>* paramFeltHammer { nullptr };
    std::atomic<float>* paramFeltSpace { nullptr };
    std::atomic<float>* paramFeltWaveform { nullptr };

    // 2. Drone 1
    std::atomic<float>* paramDrone1Volume { nullptr };
    std::atomic<float>* paramDrone1Pitch { nullptr };
    std::atomic<float>* paramDrone1Fold { nullptr };
    std::atomic<float>* paramDrone1Cutoff { nullptr };
    std::atomic<float>* paramDrone1Resonance { nullptr };
    std::atomic<float>* paramDrone1Beat { nullptr };
    std::atomic<float>* paramDrone1Detune { nullptr };
    std::atomic<float>* paramDrone1Lfo { nullptr };
    std::atomic<float>* paramDrone1WaveA { nullptr };
    std::atomic<float>* paramDrone1WaveB { nullptr };
    std::atomic<float>* paramDrone1IsSubBass { nullptr };

    // 3. Drone 2
    std::atomic<float>* paramDrone2Volume { nullptr };
    std::atomic<float>* paramDrone2Pitch { nullptr };
    std::atomic<float>* paramDrone2Fold { nullptr };
    std::atomic<float>* paramDrone2Cutoff { nullptr };
    std::atomic<float>* paramDrone2Resonance { nullptr };
    std::atomic<float>* paramDrone2Beat { nullptr };
    std::atomic<float>* paramDrone2Detune { nullptr };
    std::atomic<float>* paramDrone2Lfo { nullptr };
    std::atomic<float>* paramDrone2WaveA { nullptr };
    std::atomic<float>* paramDrone2WaveB { nullptr };

    // 4. Tape Delay
    std::atomic<float>* paramTapeTime { nullptr };
    std::atomic<float>* paramTapeFeedback { nullptr };
    std::atomic<float>* paramTapeMix { nullptr };
    std::atomic<float>* paramTapeWow { nullptr };
    std::atomic<float>* paramTapeTone { nullptr };

    // 5. Shimmer Reverb
    std::atomic<float>* paramShimmerMix { nullptr };
    std::atomic<float>* paramShimmerDecay { nullptr };
    std::atomic<float>* paramShimmerDamping { nullptr };
    std::atomic<float>* paramShimmerAmount { nullptr };
    std::atomic<float>* paramShimmerFreeze { nullptr };

    // 6. Master Bus
    std::atomic<float>* paramMasterVolume { nullptr };

    std::atomic<int> scopeWritePos { 0 };
    float scopeBufferL[kScopeBufferSize] {};
    float scopeBufferR[kScopeBufferSize] {};

    // Lock-free background WAV recorder
    juce::TimeSliceThread recorderThread { "Braun AS-42 WAV Recorder Thread" };
    std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> threadedWriter;
    std::atomic<juce::AudioFormatWriter::ThreadedWriter*> activeWriter { nullptr };
    std::atomic<int> activeWriterWorkers { 0 };
    juce::File lastRecordedFile;
    std::atomic<bool> recordingSavedDirty { false };
    juce::CriticalSection recorderLock;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BRAUN_AS42AudioProcessor)
};
