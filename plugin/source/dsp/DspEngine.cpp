#include "DspEngine.h"
#include <cmath>
#include <algorithm>

namespace braun {

DspEngine::DspEngine() {
}

void DspEngine::prepare(double sampleRate, int maxBlockSize) {
    mSampleRate = sampleRate > 100.0 ? sampleRate : 48000.0;
    mMaxBlockSize = maxBlockSize > 0 ? maxBlockSize : 512;

    mWavetables.initTables();
    mFeltPiano.prepare(mSampleRate, &mWavetables);
    mDrone1.prepare(mSampleRate, &mWavetables, 1);
    mDrone2.prepare(mSampleRate, &mWavetables, 2);
    mTapeDelay.prepare(mSampleRate, 3.5);
    mShimmerReverb.prepare(mSampleRate);
    mMasterLimiter.prepare(mSampleRate);

    const size_t scratchCapacity = std::max(static_cast<size_t>(mMaxBlockSize), static_cast<size_t>(8192));
    mScratchPianoL.assign(scratchCapacity, 0.0f);
    mScratchPianoR.assign(scratchCapacity, 0.0f);

    reset();
}

void DspEngine::reset() noexcept {
    mFeltPiano.reset();
    mDrone1.reset();
    mDrone2.reset();
    mTapeDelay.reset();
    mShimmerReverb.reset();
    mMasterLimiter.reset();

    std::fill(mScratchPianoL.begin(), mScratchPianoL.end(), 0.0f);
    std::fill(mScratchPianoR.begin(), mScratchPianoR.end(), 0.0f);

    mSustainPedalDown = false;
    mHeldKeys.reset();
    mLatchedKeys.reset();
    mCurrentPitchBendCents = 0.0f;
    mCurrentModWheel = 0.0f;
    mLastTrackedMidiNote = -1;
    mTrackedDrone1Freq = 65.41f;
    mTrackedDrone2Freq = 98.00f;
}

void DspEngine::handleMidiEvent(const MidiEvent& event) noexcept {
    const uint8_t command = event.status & 0xF0;

    switch (command) {
        case 0x90: { // Note On
            const uint8_t note = event.data1;
            const uint8_t vel = event.data2;
            if (vel > 0) {
                if (note < 128) {
                    mHeldKeys.set(note, true);
                    mLatchedKeys.set(note, false);
                    mLastTrackedMidiNote = static_cast<int>(note);
                }
                const float velNorm = static_cast<float>(vel) / 127.0f;
                mFeltPiano.noteOn(note, velNorm, 3.5f, true, false);
            } else {
                // Note-On with velocity 0 is Note-Off
                if (note < 128) {
                    mHeldKeys.reset(note);
                    if (mSustainPedalDown) {
                        mLatchedKeys.set(note, true);
                    } else {
                        mFeltPiano.noteOff(note);
                    }

                    if (mLastTrackedMidiNote == static_cast<int>(note) && mHeldKeys.any()) {
                        for (int k = 127; k >= 0; --k) {
                            if (mHeldKeys.test(k)) {
                                mLastTrackedMidiNote = k;
                                break;
                            }
                        }
                    }
                }
            }
            break;
        }
        case 0x80: { // Note Off
            const uint8_t note = event.data1;
            if (note < 128) {
                mHeldKeys.reset(note);
                if (mSustainPedalDown) {
                    mLatchedKeys.set(note, true);
                } else {
                    mFeltPiano.noteOff(note);
                }

                if (mLastTrackedMidiNote == static_cast<int>(note) && mHeldKeys.any()) {
                    for (int k = 127; k >= 0; --k) {
                        if (mHeldKeys.test(k)) {
                            mLastTrackedMidiNote = k;
                            break;
                        }
                    }
                }
            }
            break;
        }
        case 0xB0: { // Control Change
            const uint8_t ccNum = event.data1;
            const uint8_t ccVal = event.data2;
            if (ccNum == 64) { // Sustain Pedal
                const bool pedalDown = (ccVal >= 64);
                if (mSustainPedalDown && !pedalDown) {
                    // Pedal released: release all latched voices whose physical keys are not held
                    for (size_t n = 0; n < 128; ++n) {
                        if (mLatchedKeys.test(n)) {
                            if (!mHeldKeys.test(n)) {
                                mFeltPiano.noteOff(static_cast<int>(n));
                            }
                        }
                    }
                    mLatchedKeys.reset();
                }
                mSustainPedalDown = pedalDown;
            } else if (ccNum == 1) { // Modulation Wheel (Felt Tone damping)
                mCurrentModWheel = static_cast<float>(ccVal) / 127.0f;
            } else if (ccNum == 120 || ccNum == 123) { // All Sound Off / All Notes Off
                mFeltPiano.releaseAll();
                mHeldKeys.reset();
                mLatchedKeys.reset();
            }
            break;
        }
        case 0xE0: { // Pitch Bend
            const int16_t bend14 = static_cast<int16_t>(event.data1) | (static_cast<int16_t>(event.data2) << 7);
            // 8192 is center (0 cents), range +/- 200 cents (+/- 2 semitones)
            const float cents = (static_cast<float>(bend14 - 8192) / 8192.0f) * 200.0f;
            mCurrentPitchBendCents = cents;
            mFeltPiano.setPitchBend(cents);
            break;
        }
        default:
            break;
    }
}

void DspEngine::process(float* left, float* right, int numSamples,
                        const ParameterSnapshot& params,
                        const MidiEvent* midiEvents, int numMidiEvents) noexcept {
    // 1. Scoped denormal protection ensures denormals cannot throttle CPU
    ScopedNoDenormals noDenormals;

    // 2. Setup DSP subsystem parameters
    FeltPianoParams pianoParams;
    // Map CC 1 mod wheel onto felt tone if mod wheel is actively engaged
    const float effectiveTone = (mCurrentModWheel > 0.001f)
        ? (params.felt_tone * 0.5f + mCurrentModWheel * 0.5f)
        : params.felt_tone;
    pianoParams.tone = effectiveTone;
    pianoParams.hammer = params.felt_hammer;
    pianoParams.decay = params.felt_decay;
    pianoParams.release = 1.8f;
    pianoParams.volume = params.felt_volume;
    pianoParams.sympathetic = params.felt_space;
    pianoParams.waveform = static_cast<WaveformType>(params.felt_waveform);
    mFeltPiano.setParams(pianoParams);

    DroneVoiceParams drone1Params;
    drone1Params.waveA = static_cast<WaveformType>(params.drone1_waveA);
    drone1Params.waveB = static_cast<WaveformType>(params.drone1_waveB);
    drone1Params.pitchHz = params.drone1_pitch;
    drone1Params.beatHz = params.drone1_beat;
    drone1Params.detuneCents = params.drone1_detune;
    drone1Params.foldPercent = params.drone1_fold;
    drone1Params.cutoffHz = params.drone1_cutoff;
    drone1Params.resonance = params.drone1_resonance;
    drone1Params.lfoRate = 0.12f;
    drone1Params.lfoDepth = 180.0f;
    drone1Params.volume = params.drone1_volume;
    drone1Params.isSubBass = params.drone1_isSubBass;
    drone1Params.active = params.drone1_active;

    DroneVoiceParams drone2Params;
    drone2Params.waveA = static_cast<WaveformType>(params.drone2_waveA);
    drone2Params.waveB = static_cast<WaveformType>(params.drone2_waveB);
    drone2Params.pitchHz = params.drone2_pitch;
    drone2Params.beatHz = params.drone2_beat;
    drone2Params.detuneCents = params.drone2_detune;
    drone2Params.foldPercent = params.drone2_fold;
    drone2Params.cutoffHz = params.drone2_cutoff;
    drone2Params.resonance = params.drone2_resonance;
    drone2Params.lfoRate = 0.12f;
    drone2Params.lfoDepth = 180.0f;
    drone2Params.volume = params.drone2_volume;
    drone2Params.isSubBass = false;
    drone2Params.active = params.drone2_active;

    TapeDelayParams delayParams;
    delayParams.timeSec = params.tape_time;
    delayParams.feedback = params.tape_feedback;
    delayParams.toneHz = params.tape_tone;
    delayParams.wowAmount = params.tape_wow;
    delayParams.mix = params.tape_mix;

    ShimmerReverbParams reverbParams;
    reverbParams.decaySec = params.shimmer_decay;
    reverbParams.damping = params.shimmer_damping;
    reverbParams.shimmer = params.shimmer_amount;
    reverbParams.mix = params.shimmer_mix;
    reverbParams.freeze = params.shimmer_freeze;

    MasterLimiterParams masterParams;
    masterParams.masterVolume = params.master_volume;
    masterParams.tapeWarmth = 0.18f;
    masterParams.limiterKnee = 0.80f;

    // 3. Process block with sample-accurate MIDI event dispatching
    const bool trackingActive = mDroneTrackMidi && params.drone_track_midi;
    auto updatePitches = [&]() noexcept {
        if (trackingActive && mLastTrackedMidiNote >= 0) {
            int minNote = 36;
            int maxNote = 47;
            if (params.drone1_isSubBass || params.drone1_pitch < 45.0f) {
                minNote = 24;
                maxNote = 35;
            } else if (params.drone1_pitch >= 90.0f && params.drone1_pitch < 180.0f) {
                minNote = 48;
                maxNote = 59;
            } else if (params.drone1_pitch >= 180.0f) {
                minNote = 60;
                maxNote = 71;
            }

            int trackedNote = mLastTrackedMidiNote;
            while (trackedNote > maxNote) trackedNote -= 12;
            while (trackedNote < minNote) trackedNote += 12;

            const float f1 = 440.0f * std::pow(2.0f, static_cast<float>(trackedNote - 69) / 12.0f);
            drone1Params.pitchHz = f1;
            mTrackedDrone1Freq = f1;

            const float ratio = (params.drone1_pitch > 1.0f)
                ? (params.drone2_pitch / params.drone1_pitch)
                : 1.5f;
            const float f2 = f1 * ratio;
            drone2Params.pitchHz = f2;
            mTrackedDrone2Freq = f2;
        } else {
            drone1Params.pitchHz = params.drone1_pitch;
            drone2Params.pitchHz = params.drone2_pitch;
            mTrackedDrone1Freq = params.drone1_pitch;
            mTrackedDrone2Freq = params.drone2_pitch;
        }
    };
    updatePitches();

    int currentSample = 0;
    int midiIdx = 0;

    while (currentSample < numSamples) {
        // Dispatch all MIDI events scheduled at or before this sample offset
        bool midiChanged = false;
        while (midiIdx < numMidiEvents && midiEvents[midiIdx].sampleOffset <= currentSample) {
            handleMidiEvent(midiEvents[midiIdx]);
            ++midiIdx;
            midiChanged = true;
        }

        if (midiChanged) {
            updatePitches();
        }

        // Determine slice length until next MIDI event
        int nextMidiSample = numSamples;
        if (midiIdx < numMidiEvents && midiEvents[midiIdx].sampleOffset > currentSample) {
            nextMidiSample = std::min(numSamples, midiEvents[midiIdx].sampleOffset);
        }
        const int maxChunk = static_cast<int>(mScratchPianoL.size());
        const int sliceSamples = std::min(nextMidiSample - currentSample, maxChunk);

        std::fill(mScratchPianoL.begin(), mScratchPianoL.begin() + sliceSamples, 0.0f);
        std::fill(mScratchPianoR.begin(), mScratchPianoR.begin() + sliceSamples, 0.0f);

        mFeltPiano.process(mScratchPianoL.data(), mScratchPianoR.data(), sliceSamples);

        // Process slice sample-by-sample through signal graph
        for (int i = 0; i < sliceSamples; ++i) {
            const int s = currentSample + i;

            const float pianoL = mScratchPianoL[i];
            const float pianoR = mScratchPianoR[i];

            // Render Drone Voices (Voice 1 & Voice 2)
            float droneL = 0.0f;
            float droneR = 0.0f;
            mDrone1.processSample(drone1Params, droneL, droneR);
            mDrone2.processSample(drone2Params, droneL, droneR);

            // Calibrated Drone Bus Gain = 0.22 (-8.0dB relative to felt piano bus)
            constexpr float kDroneBusGain = 0.22f;
            const float droneBusL = droneL * kDroneBusGain;
            const float droneBusR = droneR * kDroneBusGain;

            // FX Feeds: Tape Delay & Shimmer Reverb receive Piano + Drone
            const float fxSendL = pianoL + droneBusL;
            const float fxSendR = pianoR + droneBusR;

            float delayL = 0.0f;
            float delayR = 0.0f;
            mTapeDelay.processSample(fxSendL, fxSendR, delayParams, delayL, delayR);

            // Shimmer reverb input: Piano + Drone + Delay Return
            const float revSendL = fxSendL + delayL;
            const float revSendR = fxSendR + delayR;

            float reverbL = 0.0f;
            float reverbR = 0.0f;
            mShimmerReverb.processSample(revSendL, revSendR, reverbParams, reverbL, reverbR);

            // Master summing bus: Piano + Drone + Delay Return + Shimmer Return
            const float masterSumL = pianoL + droneBusL + delayL + reverbL;
            const float masterSumR = pianoR + droneBusR + delayR + reverbR;

            // Master Bus Dynamics, Tape Saturation, Hermite Limiter, and DC Blocker
            float finalL = 0.0f;
            float finalR = 0.0f;
            mMasterLimiter.processSample(masterSumL, masterSumR, masterParams, finalL, finalR);

            left[s] = finalL;
            right[s] = finalR;
        }

        currentSample += sliceSamples;
    }
}

#if defined(BRAUN_HAS_JUCE)
void DspEngine::process(juce::AudioBuffer<float>& buffer,
                        juce::MidiBuffer& midiMessages,
                        const ParameterSnapshot& params) noexcept {
    const int numSamples = buffer.getNumSamples();
    if (numSamples <= 0) return;

    // Convert JUCE MidiBuffer into lightweight MidiEvent array on stack
    constexpr int kMaxMidiStack = 128;
    MidiEvent midiEventsStack[kMaxMidiStack];
    int eventCount = 0;

    for (const auto metadata : midiMessages) {
        if (eventCount >= kMaxMidiStack) break;
        const auto* rawData = metadata.data;
        const int numBytes = metadata.numBytes;
        if (numBytes >= 1) {
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

    process(left, right, numSamples, params, midiEventsStack, eventCount);
}
#endif

} // namespace braun
