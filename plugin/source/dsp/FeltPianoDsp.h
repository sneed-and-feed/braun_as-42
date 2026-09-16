#pragma once

#include "DspMath.h"
#include "Wavetables.h"
#include <array>
#include <vector>
#include <cmath>
#include <algorithm>
#include <random>

namespace braun {

struct FeltPianoParams {
    float tone { 0.60f };          // Damping (0 = ultra soft, 1 = bright chime)
    float hammer { 0.45f };        // Hammer impact level
    float decay { 1.0f };          // Decay length multiplier
    float release { 1.8f };        // Release time
    float volume { 0.80f };        // Volume
    float sympathetic { 0.45f };   // Sympathetic string coupling level
    WaveformType waveform { WaveformType::Felt };
};

// ============================================================================
// Single Felt Piano Voice
// ============================================================================
class FeltPianoVoice {
public:
    void prepare(float sampleRate, const WavetableBank* wavetables, const float* hammerBuffer,
                 size_t hammerBufferSize, int voiceIndex) noexcept {
        mSampleRate = sampleRate > 100.0f ? sampleRate : 48000.0f;
        mWavetables = wavetables;
        mHammerBuffer = hammerBuffer;
        mHammerBufferSize = hammerBufferSize;
        mVoiceIndex = voiceIndex;

        // Golden-ratio quasi-random micro-dispersion detuning per voice
        const float phiMod = std::fmod(static_cast<float>(voiceIndex) * 1.6180339887f, 1.0f);
        mDispersionOffsetCents = (phiMod - 0.5f) * 2.8f; // -1.4 to +1.4 cents
        const float overtoneMod = std::fmod(static_cast<float>(voiceIndex) * 3.0f, 5.0f);
        mOvertoneSpreadCents = 1.5f + overtoneMod * 0.22f; // 1.5 to 2.38 cents

        // CS-80 chorus LFO
        mChorusRate = 0.65f + std::fmod(static_cast<float>(voiceIndex) * 0.11f, 0.30f);
        mChorusPhase = 0.0f;

        mPitchBendSmoother.setSampleRate(mSampleRate);
        mPitchBendSmoother.setTimeConstant(0.015f);
        mPitchBendSmoother.reset(0.0f);

        reset();
    }

    void reset() noexcept {
        mIsActive = false;
        mIsHold = false;
        mIsChord = false;
        mIsStealing = false;
        mPhase1 = 0.0f;
        mPhase2 = 0.0f;
        mChorusPhase = 0.0f;
        mEnvStage = EnvStage::Idle;
        mEnvGain = 0.0f;
        mStealGain = 0.0f;
        mStealFreq = 220.0f;
        mNoteSampleCount = 0;
        mCurrentFreq = 220.0f;
        mCurrentMidi = 57;
        mFilterSubBlockCounter = 0;

        mFilter1.reset();
        mFilter2.reset();
        mBodyFilter.reset();
        mHammerFilter.reset();

        mHammerIndex = 0;
        mHammerPlaying = false;
        mHammerGain = 0.0f;
        mHammerTargetGain = 0.0f;
        mCurrentCutoff = 500.0f;
        mReleaseStartCutoff = 500.0f;
    }

    bool isActive() const noexcept { return mIsActive; }
    bool isHold() const noexcept { return mIsHold; }
    bool isChord() const noexcept { return mIsChord; }
    bool isStealing() const noexcept { return mIsStealing; }
    float getStealFreq() const noexcept { return mStealFreq; }
    float getCurrentFreq() const noexcept { return mCurrentFreq; }
    int getCurrentMidi() const noexcept { return mCurrentMidi; }
    float getEnvGain() const noexcept { return mEnvGain; }
    float getCurrentCutoff() const noexcept { return mCurrentCutoff; }
    float getMaxFilterCutoff() const noexcept { return mMaxFilterCutoff; }
    float getRestFilterCutoff() const noexcept { return mRestFilterCutoff; }
    uint64_t getStartSample() const noexcept { return mStartSample; }

    void setPitchBend(float cents) noexcept {
        mPitchBendSmoother.setTarget(cents);
    }

    void trigger(float freq, float velocity, float durationSec, const FeltPianoParams& params,
                 bool isHold, bool isChord, uint64_t currentSampleCount) noexcept {
        const float oldFreq = mCurrentFreq;
        mCurrentFreq = freq;
        mCurrentVelocity = std::clamp(velocity, 0.01f, 1.0f);
        mDurationSec = durationSec;
        mIsHold = isHold;
        mIsChord = isChord;
        mStartSample = currentSampleCount;
        mCurrentWaveform = params.waveform;

        const bool isCS80 = (mCurrentWaveform == WaveformType::CS80);
        mCurrentMidi = static_cast<int>(std::round(69.0f + 12.0f * std::log2(std::max(20.0f, freq) / 440.0f)));

        const bool isBass = mCurrentMidi < 48;
        const bool isTreble = mCurrentMidi >= 72;

        float registerDecayMult = 1.0f;
        float hammerCutoff = 280.0f;
        float hammerThumpGainMult = 0.20f;
        float thumpDuration = 0.025f;
        float bodyFormantHz = 540.0f;
        float osc1Vol = 0.48f;
        float osc2Vol = 0.16f;

        if (isBass) {
            registerDecayMult = 1.45f + std::max(0.0f, static_cast<float>(48 - mCurrentMidi) * 0.04f);
            osc1Vol = 0.60f;
            osc2Vol = 0.12f;
            hammerCutoff = std::min(220.0f, std::max(110.0f, freq * 1.3f));
            hammerThumpGainMult = 0.26f;
            thumpDuration = 0.032f;
            bodyFormantHz = std::clamp(300.0f + static_cast<float>(mCurrentMidi - 24) * 5.0f, 280.0f, 420.0f);
            mFilterAttackSec = 0.009f;
            mFilterDecaySec = (0.26f + (1.0f - params.tone) * 0.25f) * std::clamp(params.decay, 0.4f, 2.5f);
            mMaxFilterCutoff = std::min(6000.0f, std::max(freq * 1.7f, 360.0f + (params.tone * 2200.0f * mCurrentVelocity)));
            mRestFilterCutoff = std::clamp(freq * (1.4f + params.tone * 3.6f), 160.0f, 9500.0f);
        } else if (isTreble) {
            registerDecayMult = std::max(0.48f, 1.0f - static_cast<float>(mCurrentMidi - 71) * 0.035f);
            osc1Vol = 0.44f;
            osc2Vol = 0.18f;
            hammerCutoff = std::min(1400.0f, std::max(550.0f, freq * 0.9f));
            hammerThumpGainMult = 0.16f;
            thumpDuration = 0.016f;
            bodyFormantHz = std::min(950.0f, 680.0f + static_cast<float>(mCurrentMidi - 72) * 12.0f);
            mFilterAttackSec = 0.009f;
            mFilterDecaySec = (0.12f + (1.0f - params.tone) * 0.25f) * std::clamp(params.decay, 0.4f, 2.5f);
            mMaxFilterCutoff = std::min(9500.0f, std::max(freq * 2.2f, 750.0f + (params.tone * 3600.0f * mCurrentVelocity)));
            mRestFilterCutoff = std::clamp(freq * (1.4f + params.tone * 3.6f), 160.0f, 9500.0f);
        } else {
            registerDecayMult = 1.0f;
            bodyFormantHz = 480.0f + static_cast<float>(mCurrentMidi - 48) * 5.5f;
            hammerCutoff = std::min(450.0f, std::max(240.0f, freq * 1.2f));
            hammerThumpGainMult = 0.20f;
            thumpDuration = 0.025f;
            mFilterAttackSec = 0.009f;
            mFilterDecaySec = (0.18f + (1.0f - params.tone) * 0.25f) * std::clamp(params.decay, 0.4f, 2.5f);
            mMaxFilterCutoff = std::min(7500.0f, std::max(freq * 1.8f, 420.0f + (params.tone * 2600.0f * mCurrentVelocity)));
            mRestFilterCutoff = std::clamp(freq * (1.4f + params.tone * 3.6f), 160.0f, 9500.0f);
        }

        if (mCurrentWaveform == WaveformType::Sine) {
            mMaxFilterCutoff = std::min(2200.0f, std::max(freq * 1.5f, 600.0f + params.tone * 600.0f * mCurrentVelocity));
        }

        if (isCS80) {
            osc1Vol = 0.48f;
            osc2Vol = 0.46f;
            bodyFormantHz = 1150.0f;
            mFilterAttackSec = 0.095f;
            mFilterDecaySec = 0.50f * params.decay;
            mStartFilterCutoff = std::clamp(freq * 1.4f, 280.0f, 2400.0f);
            mMaxFilterCutoff = std::min(16000.0f, std::max(freq * 4.5f, 3200.0f + params.tone * 8000.0f * mCurrentVelocity));
            mRestFilterCutoff = std::min(12000.0f, std::max(freq * 2.5f, 1800.0f + params.tone * 5000.0f * mCurrentVelocity));
        } else {
            // Guarantee attack filter cutoff is at least rest cutoff across all acoustic registers, velocities, and waveforms.
            // Eliminates inverted filter sweeps where cutoff dips on strike and sweeps up during decay.
            mMaxFilterCutoff = std::max(mMaxFilterCutoff, mRestFilterCutoff);
        }

        mOsc1Gain = osc1Vol;
        mOsc2Gain = osc2Vol;

        // Timbre trim
        switch (mCurrentWaveform) {
            case WaveformType::Felt:    mTimbreTrim = 1.55f; break;
            case WaveformType::Sine:    mTimbreTrim = 1.65f; break;
            case WaveformType::Saw:     mTimbreTrim = 1.10f; break;
            case WaveformType::Square:  mTimbreTrim = 1.00f; break;
            case WaveformType::CS80:    mTimbreTrim = 0.90f; break;
            default:                    mTimbreTrim = 1.00f; break;
        }

        // Configure body soundboard peaking formant filter
        mBodyFilter.configure(Biquad::Type::Peaking, mSampleRate, bodyFormantHz, 1.2f, 1.5f);

        // Configure hammer filter
        mHammerFilter.configure(Biquad::Type::Bandpass, mSampleRate, hammerCutoff, 2.0f);

        // Amplitude envelope timings
        const float baseAttack = isCS80 ? 0.024f : 0.0080f;
        const float attackTime = isCS80 ? 0.024f : std::clamp(baseAttack + (1.0f - mCurrentVelocity) * 0.002f, 0.0075f, 0.0095f);
        mAttackSamples = std::max(1u, static_cast<uint32_t>(attackTime * mSampleRate));

        mPeakGain = isCS80
            ? std::max(0.01f, mCurrentVelocity * (isBass ? 0.38f : isTreble ? 0.35f : 0.32f))
            : std::max(0.005f, mCurrentVelocity * (isBass ? 0.28f : isTreble ? 0.26f : 0.24f));
        mSustainLevel = isCS80 ? (mPeakGain * 0.72f) : (mPeakGain * 0.50f);

        const float baseDecay = std::clamp(7.5f * std::pow(220.0f / std::max(60.0f, freq), 0.45f), 1.2f, 10.0f)
                                * params.decay * registerDecayMult;
        const float decayDuration = isCS80 ? (0.25f * params.decay) : baseDecay;
        mDecaySamples = std::max(1u, static_cast<uint32_t>(decayDuration * mSampleRate));
        mReleaseSamples = std::max(1u, static_cast<uint32_t>((isCS80 ? 0.65f : 0.40f) * mSampleRate));

        // Hammer thump setup
        const float effectiveHammer = (mCurrentWaveform == WaveformType::Sine) ? 0.0f : params.hammer;
        const float chordScale = mIsChord ? 0.40f : 1.0f;
        if (!isCS80 && effectiveHammer > 0.01f && mHammerBuffer != nullptr && mHammerBufferSize > 0) {
            mHammerPlaying = true;
            mHammerIndex = 0;
            mHammerTargetGain = mCurrentVelocity * effectiveHammer * hammerThumpGainMult * chordScale;
            mHammerGain = 0.0f;
            mHammerAttackSamples = static_cast<uint32_t>((mCurrentWaveform == WaveformType::Sine ? 0.0065f : 0.0050f) * mSampleRate);
            mHammerDecaySamples = static_cast<uint32_t>(thumpDuration * mSampleRate);
            mHammerStep = 0;
        } else {
            mHammerPlaying = false;
        }

        // Stealing micro-ramp (5ms declick ramp down if voice was active)
        if (mIsActive && mEnvGain > 0.001f) {
            mIsStealing = true;
            mStealGain = mEnvGain;
            mStealFreq = oldFreq;
            mStealSamplesTotal = static_cast<uint32_t>(0.005f * mSampleRate);
            mStealSamplesLeft = mStealSamplesTotal;
        } else {
            mIsStealing = false;
            mStealFreq = freq;
            mEnvGain = 0.0f;
        }

        mEnvStage = EnvStage::Attack;
        mEnvSampleCount = 0;
        mNoteSampleCount = 0;
        mIsActive = true;
        mFilterSubBlockCounter = 0;
    }

    void release() noexcept {
        if (!mIsActive) return;
        mIsHold = false;
        mIsChord = false;
        if (mIsStealing) {
            // Smoothly complete the steal fade-out to 0.0f rather than snapping to zero.
            // Setting mEnvStage to Idle prevents transitioning to Attack when fade-out finishes.
            mEnvStage = EnvStage::Idle;
            return;
        }
        mEnvStage = EnvStage::Release;
        mReleaseStartGain = std::max(0.0001f, mEnvGain);
        mReleaseStartCutoff = mCurrentCutoff;
        mEnvSampleCount = 0;
        mFilterSubBlockCounter = 0;
    }

    inline float processSample(const FeltPianoParams& /*params*/) noexcept {
        if (!mIsActive) return 0.0f;

        // 1. Handle voice stealing declick down-ramp
        if (mIsStealing) {
            if (mStealSamplesLeft > 0) {
                --mStealSamplesLeft;
                const float frac = static_cast<float>(mStealSamplesLeft) / static_cast<float>(mStealSamplesTotal);
                mEnvGain = mStealGain * frac;
                if (mStealSamplesLeft == 0) {
                    mIsStealing = false;
                    mEnvGain = 0.0f;
                    if (mEnvStage == EnvStage::Attack && mIsActive) {
                        mEnvSampleCount = 0;
                        mNoteSampleCount = 0;
                    } else {
                        mIsActive = false;
                        mEnvStage = EnvStage::Idle;
                    }
                }
            }
        } else {
            // 2. Advance amplitude envelope
            switch (mEnvStage) {
                case EnvStage::Attack: {
                    ++mEnvSampleCount;
                    const float frac = std::min(1.0f, static_cast<float>(mEnvSampleCount) / static_cast<float>(mAttackSamples));
                    mEnvGain = frac * mPeakGain;
                    if (mEnvSampleCount >= mAttackSamples) {
                        mEnvStage = EnvStage::Decay;
                        mEnvSampleCount = 0;
                    }
                    break;
                }
                case EnvStage::Decay: {
                    ++mEnvSampleCount;
                    const float frac = std::min(1.0f, static_cast<float>(mEnvSampleCount) / static_cast<float>(mDecaySamples));
                    // Acoustic piano strings decay to silence even while held. Permanent sustain is reserved for synth pad modes (CS-80).
                    const bool isCS80 = (mCurrentWaveform == WaveformType::CS80);
                    const float target = (isCS80 && mIsHold) ? mSustainLevel : 0.0001f;
                    mEnvGain = mPeakGain * std::pow(std::max(0.0001f, target) / mPeakGain, frac);
                    if (mEnvSampleCount >= mDecaySamples) {
                        if (isCS80 && mIsHold) {
                            mEnvStage = EnvStage::Sustain;
                            mEnvGain = mSustainLevel;
                        } else {
                            mIsActive = false;
                            mEnvStage = EnvStage::Idle;
                            mEnvGain = 0.0f;
                        }
                    }
                    break;
                }
                case EnvStage::Sustain: {
                    mEnvGain = mSustainLevel;
                    break;
                }
                case EnvStage::Release: {
                    ++mEnvSampleCount;
                    const float frac = std::min(1.0f, static_cast<float>(mEnvSampleCount) / static_cast<float>(mReleaseSamples));
                    mEnvGain = mReleaseStartGain * std::pow(0.0001f / mReleaseStartGain, frac);
                    if (mEnvSampleCount >= mReleaseSamples || mEnvGain <= 0.0001f) {
                        mIsActive = false;
                        mEnvStage = EnvStage::Idle;
                        mEnvGain = 0.0f;
                    }
                    break;
                }
                case EnvStage::Idle:
                default:
                    mEnvGain = 0.0f;
                    break;
            }
        }

        if (!mIsActive) return 0.0f;

        // 3. Dynamic filter cutoff computation
        const bool isCS80 = (mCurrentWaveform == WaveformType::CS80);
        float currentCutoff = mRestFilterCutoff;

        if (mEnvStage == EnvStage::Release) {
            const float frac = std::min(1.0f, static_cast<float>(mEnvSampleCount) / static_cast<float>(mReleaseSamples));
            const float releaseTargetCutoff = std::max(160.0f, mCurrentFreq * 1.1f);
            currentCutoff = mReleaseStartCutoff * std::pow(releaseTargetCutoff / std::max(releaseTargetCutoff, mReleaseStartCutoff), frac);
        } else {
            ++mNoteSampleCount;
            const float attackSec = mFilterAttackSec;
            const float decaySec = mFilterDecaySec;
            const float t = static_cast<float>(mNoteSampleCount) / mSampleRate;

            if (isCS80) {
                if (t <= attackSec) {
                    const float frac = t / std::max(0.001f, attackSec);
                    currentCutoff = mStartFilterCutoff + frac * (mMaxFilterCutoff - mStartFilterCutoff);
                } else {
                    const float frac = std::min(1.0f, (t - attackSec) / std::max(0.001f, decaySec));
                    currentCutoff = mMaxFilterCutoff * std::pow(mRestFilterCutoff / mMaxFilterCutoff, frac);
                }
            } else {
                if (t <= attackSec) {
                    const float frac = t / std::max(0.001f, attackSec);
                    currentCutoff = mRestFilterCutoff + frac * (mMaxFilterCutoff - mRestFilterCutoff);
                } else {
                    const float frac = std::min(1.0f, (t - attackSec) / std::max(0.001f, decaySec));
                    currentCutoff = mMaxFilterCutoff * std::pow(mRestFilterCutoff / mMaxFilterCutoff, frac);
                }
            }
        }
        mCurrentCutoff = currentCutoff;

        if (mFilterSubBlockCounter == 0) {
            const float filterQ1 = isCS80 ? 1.85f : 0.7071f;
            mFilter1.configure(Biquad::Type::Lowpass, mSampleRate, currentCutoff, filterQ1);
            if (isCS80) {
                const float filterQ2 = 1.45f;
                mFilter2.configure(Biquad::Type::Lowpass, mSampleRate, currentCutoff, filterQ2);
            } else {
                mFilter2.copyCoefficientsFrom(mFilter1);
            }
            mFilterSubBlockCounter = kFilterSubBlockSize - 1;
        } else {
            --mFilterSubBlockCounter;
        }

        // 4. Calculate oscillator frequencies including pitch bend, micro-dispersion, and CS-80 chorus
        const float pitchBend = mPitchBendSmoother.next();
        float detune1 = mDispersionOffsetCents + pitchBend;
        float detune2 = mDispersionOffsetCents + mOvertoneSpreadCents + pitchBend;

        if (isCS80) {
            detune1 = (mDispersionOffsetCents - 5.5f) + pitchBend;
            // Chorus LFO modulation on Osc 2
            mChorusPhase += mChorusRate / mSampleRate;
            if (mChorusPhase >= 1.0f) mChorusPhase -= 1.0f;
            const float chorusMod = std::sin(kTwoPi * mChorusPhase) * 4.5f;
            detune2 = (mDispersionOffsetCents + 6.5f) + pitchBend + chorusMod;
        }

        const float activeFreq = mIsStealing ? mStealFreq : mCurrentFreq;
        const float freq1 = activeFreq * std::pow(2.0f, detune1 / 1200.0f);
        const float freq2 = activeFreq * std::pow(2.0f, detune2 / 1200.0f);

        // Advance phases
        mPhase1 += freq1 / mSampleRate;
        if (mPhase1 >= 1.0f) mPhase1 -= 1.0f;
        mPhase2 += freq2 / mSampleRate;
        if (mPhase2 >= 1.0f) mPhase2 -= 1.0f;

        // Waveform mapping matching Web Audio felt-piano.js:
        // - Felt: Osc 1 = Sine, Osc 2 = Triangle
        // - Sine: Osc 1 = Sine, Osc 2 = Sine
        // - Saw: Osc 1 = Saw, Osc 2 = Warm
        // - Square: Osc 1 = Square, Osc 2 = Square
        // - CS80: Osc 1 = Saw, Osc 2 = Warm
        WaveformType wave1 = WaveformType::Sine;
        WaveformType wave2 = WaveformType::Triangle;
        switch (mCurrentWaveform) {
            case WaveformType::Sine:
                wave1 = WaveformType::Sine;
                wave2 = WaveformType::Sine;
                break;
            case WaveformType::Saw:
                wave1 = WaveformType::Saw;
                wave2 = WaveformType::Warm;
                break;
            case WaveformType::Square:
                wave1 = WaveformType::Square;
                wave2 = WaveformType::Square;
                break;
            case WaveformType::CS80:
                wave1 = WaveformType::Saw;
                wave2 = WaveformType::Warm;
                break;
            case WaveformType::Felt:
            default:
                wave1 = WaveformType::Felt;
                wave2 = WaveformType::Felt;
                break;
        }

        // Generate oscillator outputs
        const float osc1 = mWavetables->readSample(wave1, mPhase1) * mOsc1Gain;
        const float osc2 = mWavetables->readSample(wave2, mPhase2) * mOsc2Gain;
        const float oscMix = osc1 + osc2;

        // 5. Internal saturation shaper
        const float saturatedOsc = softClip(oscMix, 1.15f);

        // 6. Hammer transient burst
        float hammerOut = 0.0f;
        if (mHammerPlaying && mHammerBuffer != nullptr) {
            ++mHammerStep;
            if (mHammerStep < mHammerAttackSamples) {
                mHammerGain = mHammerTargetGain * (static_cast<float>(mHammerStep) / static_cast<float>(mHammerAttackSamples));
            } else if (mHammerStep < mHammerDecaySamples) {
                const float frac = static_cast<float>(mHammerStep - mHammerAttackSamples) / static_cast<float>(mHammerDecaySamples - mHammerAttackSamples);
                mHammerGain = mHammerTargetGain * std::exp(-frac * 4.0f);
            } else {
                mHammerPlaying = false;
                mHammerGain = 0.0f;
            }

            if (mHammerIndex < mHammerBufferSize) {
                const float rawNoise = mHammerBuffer[mHammerIndex++];
                hammerOut = mHammerFilter.process(rawNoise) * mHammerGain;
            }
        }

        // 7. Filter cascade: (SaturatedOsc + Hammer) -> Filter 1 -> Filter 2 -> Body Peaking -> VoiceGain -> TimbreTrim
        const float filterIn = saturatedOsc + hammerOut;
        const float f1 = mFilter1.process(filterIn);
        const float f2 = mFilter2.process(f1);
        const float body = mBodyFilter.process(f2);

        return body * mEnvGain * mTimbreTrim;
    }

private:
    enum class EnvStage {
        Idle,
        Attack,
        Decay,
        Sustain,
        Release
    };

    float mSampleRate { 48000.0f };
    const WavetableBank* mWavetables { nullptr };
    const float* mHammerBuffer { nullptr };
    size_t mHammerBufferSize { 0 };
    int mVoiceIndex { 0 };

    bool mIsActive { false };
    bool mIsHold { false };
    bool mIsChord { false };
    bool mIsStealing { false };
    uint64_t mStartSample { 0 };

    float mCurrentFreq { 220.0f };
    int mCurrentMidi { 57 };
    float mCurrentVelocity { 0.6f };
    float mDurationSec { 3.5f };
    WaveformType mCurrentWaveform { WaveformType::Felt };

    float mDispersionOffsetCents { 0.0f };
    float mOvertoneSpreadCents { 0.0f };
    float mChorusRate { 0.65f };
    float mChorusPhase { 0.0f };
    OnePoleSmoother mPitchBendSmoother;

    float mPhase1 { 0.0f };
    float mPhase2 { 0.0f };
    float mOsc1Gain { 0.48f };
    float mOsc2Gain { 0.16f };
    float mTimbreTrim { 1.55f };

    Biquad mFilter1;
    Biquad mFilter2;
    Biquad mBodyFilter;
    Biquad mHammerFilter;

    static constexpr uint32_t kFilterSubBlockSize = 16;
    uint32_t mFilterSubBlockCounter { 0 };

    float mStartFilterCutoff { 280.0f };
    float mMaxFilterCutoff { 2000.0f };
    float mRestFilterCutoff { 500.0f };
    float mCurrentCutoff { 500.0f };
    float mReleaseStartCutoff { 500.0f };
    float mFilterAttackSec { 0.009f };
    float mFilterDecaySec { 0.18f };

    EnvStage mEnvStage { EnvStage::Idle };
    uint32_t mEnvSampleCount { 0 };
    uint32_t mNoteSampleCount { 0 };
    uint32_t mAttackSamples { 400 };
    uint32_t mDecaySamples { 100000 };
    uint32_t mReleaseSamples { 19200 };
    float mPeakGain { 0.25f };
    float mSustainLevel { 0.125f };
    float mReleaseStartGain { 0.1f };
    float mEnvGain { 0.0f };

    float mStealGain { 0.0f };
    float mStealFreq { 220.0f };
    uint32_t mStealSamplesTotal { 240 };
    uint32_t mStealSamplesLeft { 0 };

    bool mHammerPlaying { false };
    size_t mHammerIndex { 0 };
    uint32_t mHammerStep { 0 };
    uint32_t mHammerAttackSamples { 240 };
    uint32_t mHammerDecaySamples { 1200 };
    float mHammerGain { 0.0f };
    float mHammerTargetGain { 0.0f };
};

// ============================================================================
// FeltPianoSynthesizer: 24-Voice Polyphonic Synthesizer
// ============================================================================
class FeltPianoSynthesizer {
public:
    static constexpr size_t kNumVoices = 24;

    void prepare(double sampleRate, const WavetableBank* wavetables) {
        mSampleRate = static_cast<float>(sampleRate);
        mWavetables = wavetables;

        generateHammerBuffer();

        for (size_t i = 0; i < kNumVoices; ++i) {
            mVoices[i].prepare(mSampleRate, mWavetables, mHammerBuffer.data(), mHammerBuffer.size(), static_cast<int>(i));
        }

        updateSympatheticFilters();

        mHeadroomSmoother.setSampleRate(mSampleRate);
        mHeadroomSmoother.setTimeConstant(0.075f);
        mHeadroomSmoother.reset(0.38f);

        mCurrentSampleCount = 0;
        mVoiceIndex = 0;
        mPitchBendCents = 0.0f;
        mNumActiveVoices = 0;
    }

    void reset() noexcept {
        for (auto& voice : mVoices) {
            voice.reset();
        }
        mSympatheticFilter1.reset();
        mSympatheticFilter2.reset();
        mHeadroomSmoother.reset(0.38f);
        mVoiceIndex = 0;
        mCurrentSampleCount = 0;
        mNumActiveVoices = 0;
    }

    void addActiveVoice(size_t voiceIdx) noexcept {
        const uint8_t idx = static_cast<uint8_t>(voiceIdx);
        size_t insertPos = mNumActiveVoices;
        for (size_t a = 0; a < mNumActiveVoices; ++a) {
            if (mActiveVoices[a] == idx) {
                return; // already present
            }
            if (mActiveVoices[a] > idx) {
                insertPos = a;
                break;
            }
        }
        if (mNumActiveVoices < kNumVoices) {
            for (size_t a = mNumActiveVoices; a > insertPos; --a) {
                mActiveVoices[a] = mActiveVoices[a - 1];
            }
            mActiveVoices[insertPos] = idx;
            ++mNumActiveVoices;
        }
    }

    void noteOn(int midiNote, float velocity, float durationSec = 3.5f, bool isHold = false, bool isChord = false) noexcept {
        const float freq = 440.0f * std::pow(2.0f, static_cast<float>(midiNote - 69) / 12.0f);
        playNote(freq, velocity, durationSec, isHold, isChord);
    }

    void noteOff(int midiNote) noexcept {
        const float freq = 440.0f * std::pow(2.0f, static_cast<float>(midiNote - 69) / 12.0f);
        release(freq);
    }

    void playNote(float freq, float velocity, float durationSec = 3.5f, bool isHold = false, bool isChord = false) noexcept {
        FeltPianoVoice* voice = nullptr;

        // 1. If an active voice is already playing this exact note, re-trigger it (even if held via sustain pedal)
        for (auto& v : mVoices) {
            if (v.isActive() && std::abs(v.getCurrentFreq() - freq) < 0.5f) {
                voice = &v;
                break;
            }
        }

        // 2. Find free inactive voice using round-robin scan
        if (voice == nullptr) {
            for (size_t i = 0; i < kNumVoices; ++i) {
                const size_t idx = (mVoiceIndex + i) % kNumVoices;
                if (!mVoices[idx].isActive()) {
                    voice = &mVoices[idx];
                    mVoiceIndex = (idx + 1) % kNumVoices;
                    break;
                }
            }
        }

        // 3. Priority voice stealing: protect held notes
        if (voice == nullptr) {
            voice = &mVoices[0];
            const uint64_t recentThreshold = static_cast<uint64_t>(0.060f * mSampleRate);

            for (size_t i = 1; i < kNumVoices; ++i) {
                FeltPianoVoice& cand = mVoices[i];
                // Priority 1: Never steal held notes if candidate is not held
                if (cand.isHold() && !voice->isHold()) continue;
                if (!cand.isHold() && voice->isHold()) {
                    voice = &cand;
                    continue;
                }

                // Priority 2: Never steal chord notes if candidate is non-chord
                if (cand.isChord() && !voice->isChord()) continue;
                if (!cand.isChord() && voice->isChord()) {
                    voice = &cand;
                    continue;
                }

                // Priority 3: Protect notes triggered in last 60ms
                const bool candRecent = (mCurrentSampleCount - cand.getStartSample()) < recentThreshold;
                const bool voiceRecent = (mCurrentSampleCount - voice->getStartSample()) < recentThreshold;
                if (candRecent && !voiceRecent) continue;
                if (!candRecent && voiceRecent) {
                    voice = &cand;
                    continue;
                }

                // Priority 4: Compare current envelope gain (steal quietest)
                if (cand.getEnvGain() < voice->getEnvGain() - 0.01f) {
                    voice = &cand;
                } else if (std::abs(cand.getEnvGain() - voice->getEnvGain()) <= 0.01f &&
                           cand.getStartSample() < voice->getStartSample()) {
                    voice = &cand;
                }
            }

            // Advance round robin past stolen voice
            for (size_t i = 0; i < kNumVoices; ++i) {
                if (&mVoices[i] == voice) {
                    mVoiceIndex = (i + 1) % kNumVoices;
                    break;
                }
            }
        }

        voice->setPitchBend(mPitchBendCents);
        voice->trigger(freq, velocity, durationSec, mParams, isHold, isChord, mCurrentSampleCount);
        addActiveVoice(static_cast<size_t>(voice - &mVoices[0]));
        updateHeadroomTarget();
    }

    void release(float freq) noexcept {
        for (auto& v : mVoices) {
            if (v.isActive() && std::abs(v.getCurrentFreq() - freq) < 0.5f) {
                v.release();
            }
        }
    }

    void releaseAll() noexcept {
        for (auto& v : mVoices) {
            if (v.isActive()) {
                v.release();
            }
        }
    }

    void setPitchBend(float cents) noexcept {
        mPitchBendCents = cents;
        for (auto& v : mVoices) {
            v.setPitchBend(cents);
        }
    }

    void setParams(const FeltPianoParams& params) noexcept {
        mParams = params;
        updateHeadroomTarget();
        updateSympatheticFilters();
    }

    // Process a block of samples, summing into left and right
    void process(float* outL, float* outR, int numSamples) noexcept {
        if (mParams.volume < 1.0e-5f) {
            return;
        }

        const float symGain = (0.08f + mParams.tone * 0.10f) * (mParams.sympathetic / 0.45f);

        for (int s = 0; s < numSamples; ++s) {
            ++mCurrentSampleCount;
            float voiceSum = 0.0f;
            int activeCount = 0;
            size_t writeIdx = 0;

            for (size_t a = 0; a < mNumActiveVoices; ++a) {
                const uint8_t vIdx = mActiveVoices[a];
                auto& voice = mVoices[vIdx];
                voiceSum += voice.processSample(mParams);
                ++activeCount;

                if (voice.isActive()) {
                    mActiveVoices[writeIdx++] = vIdx;
                }
            }
            mNumActiveVoices = writeIdx;

            // Check if active voice count changed for headroom scaling
            if (activeCount != mLastActiveCount) {
                mLastActiveCount = activeCount;
                updateHeadroomTarget();
            }

            const float headroom = mHeadroomSmoother.next();

            // Sympathetic string resonance: dual bandpass filters in parallel with tone and sympathetic tracking
            const float sym1 = mSympatheticFilter1.process(voiceSum);
            const float sym2 = mSympatheticFilter2.process(voiceSum);
            const float symCoupling = (sym1 + sym2) * symGain;

            const float finalSample = (voiceSum + symCoupling) * headroom;
            outL[s] += finalSample;
            outR[s] += finalSample;
        }
    }

    int getActiveVoiceCount() const noexcept {
        return static_cast<int>(mNumActiveVoices);
    }

private:
    void updateHeadroomTarget() noexcept {
        const float polyHeadroom = 1.0f / std::sqrt(std::max(1.0f, static_cast<float>(mLastActiveCount)));
        const float targetGain = 0.38f * polyHeadroom * mParams.volume;
        mHeadroomSmoother.setTarget(targetGain);
    }

    void updateSympatheticFilters() noexcept {
        const float f1 = 220.0f + mParams.tone * 120.0f;
        const float f2 = 440.0f + mParams.tone * 200.0f;
        mSympatheticFilter1.configure(Biquad::Type::Bandpass, mSampleRate, f1, 3.2f);
        mSympatheticFilter2.configure(Biquad::Type::Bandpass, mSampleRate, f2, 3.5f);
    }

    void generateHammerBuffer() {
        // 40ms noise buffer with zero DC offset and Hann attack & release
        const size_t thumpSamples = static_cast<size_t>(mSampleRate * 0.040f);
        mHammerBuffer.assign(thumpSamples, 0.0f);

        // 1. Generate zero-mean raw noise
        std::mt19937 rng(1337);
        std::uniform_real_distribution<float> dist(-1.0f, 1.0f);

        float rawSum = 0.0f;
        for (size_t i = 0; i < thumpSamples; ++i) {
            const float s = dist(rng);
            mHammerBuffer[i] = s;
            rawSum += s;
        }
        const float mean = rawSum / static_cast<float>(thumpSamples);
        for (size_t i = 0; i < thumpSamples; ++i) {
            mHammerBuffer[i] -= mean;
        }

        // 2. Windowed exponential decay with smooth Hann attack & release windows
        const size_t attackSamples = std::max(size_t(2), static_cast<size_t>(mSampleRate * 0.0035f));
        const size_t releaseSamples = std::max(size_t(2), static_cast<size_t>(mSampleRate * 0.006f));
        const size_t releaseStart = thumpSamples - releaseSamples;

        for (size_t i = 0; i < thumpSamples; ++i) {
            float s = mHammerBuffer[i] * std::exp(-static_cast<float>(i) / (mSampleRate * 0.007f));
            if (i < attackSamples) {
                s *= 0.5f * (1.0f - std::cos(kPi * static_cast<float>(i) / static_cast<float>(attackSamples)));
            } else if (i >= releaseStart) {
                const size_t relIdx = i - releaseStart;
                s *= 0.5f * (1.0f + std::cos(kPi * static_cast<float>(relIdx) / static_cast<float>(releaseSamples)));
            }
            mHammerBuffer[i] = s;
        }

        // 3. High-precision zero-boundary DC removal using sin^2(pi*i / (N-1))
        float sumD = 0.0f;
        float sumW = 0.0f;
        std::vector<float> weights(thumpSamples, 0.0f);
        for (size_t i = 0; i < thumpSamples; ++i) {
            sumD += mHammerBuffer[i];
            const float sinVal = std::sin(kPi * static_cast<float>(i) / static_cast<float>(thumpSamples - 1));
            const float w = sinVal * sinVal;
            weights[i] = w;
            sumW += w;
        }

        const float dcOffsetFactor = (sumW > 0.0f) ? (sumD / sumW) : 0.0f;
        for (size_t i = 0; i < thumpSamples; ++i) {
            mHammerBuffer[i] -= dcOffsetFactor * weights[i];
        }
        mHammerBuffer[0] = 0.0f;
        mHammerBuffer[thumpSamples - 1] = 0.0f;
    }

    float mSampleRate { 48000.0f };
    const WavetableBank* mWavetables { nullptr };
    std::vector<float> mHammerBuffer;

    std::array<FeltPianoVoice, kNumVoices> mVoices;
    std::array<uint8_t, kNumVoices> mActiveVoices {};
    size_t mNumActiveVoices { 0 };
    size_t mVoiceIndex { 0 };
    uint64_t mCurrentSampleCount { 0 };
    int mLastActiveCount { 0 };

    Biquad mSympatheticFilter1;
    Biquad mSympatheticFilter2;
    OnePoleSmoother mHeadroomSmoother;

    float mPitchBendCents { 0.0f };
    FeltPianoParams mParams;
};

} // namespace braun
