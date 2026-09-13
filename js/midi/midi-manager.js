/**
 * @file midi-manager.js
 * @brief Web MIDI API manager for BRAUN AS 42 ambient synthesizer.
 * Handles device discovery, hotplugging, Note-On/Off dispatch with velocity sensitivity,
 * CC 64 sustain pedal voice latching, CC 1 modulation wheel, and 14-bit pitch bend.
 */

import { midiToFrequency } from '../generative/scales.js';

export class BraunMidiManager {
  /**
   * @param {AudioEngine} engine
   * @param {AmbientApp} [app=null]
   */
  constructor(engine, app = null) {
    this.engine = engine;
    this.app = app;
    this.midiAccess = null;
    this.isSustainDown = false;
    this.pitchBendRangeSemitones = 2.0;
    this.currentPitchBendCents = 0.0;

    /** @type {Map<number, Set<any>>} Active voices mapped by MIDI note number (0-127) */
    this.activeNotes = new Map();

    /** @type {Set<any>} Voices sustained by pedal held after physical key release */
    this.latchedVoices = new Set();

    /** @type {Set<any>} Connected MIDI input ports currently monitored */
    this._attachedInputs = new Set();

    this._runningStatus = null;
    this._lastHandledEvent = null;
    this._lastHandledData = null;
    this._boundMessageHandler = (event) => this.handleMidiMessage(event);
    this._boundStateChangeHandler = (event) => this._handleStateChange(event);
  }

  /**
   * Safely query Web MIDI API and initialize device listeners.
   * If navigator.requestMIDIAccess is unavailable, unsupported, or rejects,
   * handles gracefully without error or breaking synthesizer operation.
   * @returns {Promise<boolean>} True if MIDI access was granted and initialized, false otherwise.
   */
  async init() {
    if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      if (!this.midiAccess) return false;

      this.midiAccess.onstatechange = this._boundStateChangeHandler;
      if (typeof this.midiAccess.addEventListener === 'function') {
        this.midiAccess.addEventListener('statechange', this._boundStateChangeHandler);
      }

      if (this.midiAccess.inputs) {
        if (typeof this.midiAccess.inputs.forEach === 'function') {
          this.midiAccess.inputs.forEach((input) => this._attachInput(input));
        } else if (typeof this.midiAccess.inputs.values === 'function') {
          for (const input of this.midiAccess.inputs.values()) {
            this._attachInput(input);
          }
        }
      }
      return true;
    } catch (err) {
      // Gracefully handle SecurityError, NotAllowedError, or denied permissions
      return false;
    }
  }

  /**
   * Attach listener to a MIDI input port
   * @param {MIDIInput} input
   */
  _attachInput(input) {
    if (!input || this._attachedInputs.has(input)) return;
    this._attachedInputs.add(input);

    if (typeof input.addEventListener === 'function') {
      input.addEventListener('midimessage', this._boundMessageHandler);
    } else {
      input.onmidimessage = this._boundMessageHandler;
    }
  }

  /**
   * Detach listener from a MIDI input port
   * @param {MIDIInput} input
   */
  _detachInput(input) {
    if (!input) return;
    this._attachedInputs.delete(input);

    if (typeof input.removeEventListener === 'function') {
      input.removeEventListener('midimessage', this._boundMessageHandler);
    }
    if (input.onmidimessage === this._boundMessageHandler) {
      input.onmidimessage = null;
    }
  }

  /**
   * Dynamic hotplug state change listener
   * @param {MIDIConnectionEvent} event
   */
  _handleStateChange(event) {
    const port = event?.port;
    if (!port || port.type !== 'input') return;

    if (port.state === 'connected') {
      this._attachInput(port);
    } else if (port.state === 'disconnected') {
      this._detachInput(port);
    }
  }

  /**
   * Decode and dispatch incoming MIDI messages
   * @param {MIDIMessageEvent|{data: Uint8Array|number[]}} event
   */
  handleMidiMessage(event) {
    if (!event) return;

    const data = event.data || (Array.isArray(event) || ArrayBuffer.isView(event) ? event : null);
    if (!data || data.length < 1) return;

    // De-duplicate if the exact same event wrapper object was dispatched twice with unmodified data
    const isEventWrapper = Boolean(event && typeof event === 'object' && 'data' in event);
    if (isEventWrapper && this._lastHandledEvent === event) {
      let isUnmodified = true;
      if (this._lastHandledData && this._lastHandledData.length === data.length) {
        for (let i = 0; i < data.length; i++) {
          if (this._lastHandledData[i] !== data[i]) {
            isUnmodified = false;
            break;
          }
        }
      } else {
        isUnmodified = false;
      }
      if (isUnmodified) return;
    }

    if (isEventWrapper) {
      this._lastHandledEvent = event;
      this._lastHandledData = Array.from(data);
    } else {
      this._lastHandledEvent = null;
      this._lastHandledData = null;
    }

    let status = data[0];
    let dataOffset = 1;

    // Running Status: If data byte (< 0x80) begins packet, decode using running status
    if (typeof status === 'number' && status < 0x80) {
      if (!this._runningStatus) return;
      status = this._runningStatus;
      dataOffset = 0;
    } else if (typeof status === 'number') {
      if (status >= 0x80 && status < 0xF0) {
        this._runningStatus = status;
      } else if (status >= 0xF0 && status <= 0xF7) {
        this._runningStatus = null;
      }
    }

    // System Reset / Panic (0xFF)
    if (status === 0xFF) {
      this.panic();
      return;
    }

    // Filter System Real-Time messages (0xF8 - 0xFE)
    if (typeof status !== 'number' || (status >= 0xF8 && status <= 0xFE)) {
      return;
    }

    const command = status & 0xF0;
    const data1 = data[dataOffset] !== undefined ? data[dataOffset] : 0;
    const data2 = data[dataOffset + 1] !== undefined ? data[dataOffset + 1] : 0;

    switch (command) {
      case 0x90: // Note-On
        if (data2 === 0) {
          // Standard MIDI Note-On with velocity 0 is treated as Note-Off
          this._handleNoteOff(data1);
        } else {
          this._handleNoteOn(data1, data2);
        }
        break;

      case 0x80: // Note-Off
        this._handleNoteOff(data1);
        break;

      case 0xB0: // Control Change
        this._handleControlChange(data1, data2);
        break;

      case 0xE0: // Pitch Bend
        this._handlePitchBend(data1, data2);
        break;

      default:
        break;
    }
  }

  /**
   * Handle Note-On with velocity scaling and auto-power wake
   * @param {number} note - MIDI note number (0-127)
   * @param {number} velocity - Raw MIDI velocity (1-127)
   */
  _handleNoteOn(note, velocity) {
    // Auto-wake audio context / engine if suspended or power is off
    if (this.app) {
      const isSuspended = Boolean(this.engine?.ctx && this.engine.ctx.state === 'suspended');
      const isPowerOff = !this.app.isPowerOn;
      if ((isSuspended || isPowerOff) && typeof this.app.startAudio === 'function') {
        this.app.startAudio().catch(() => {});
      }
    }

    if (!this.engine || !this.engine.feltPiano || typeof this.engine.feltPiano.playNote !== 'function') {
      return;
    }

    const a4 = (this.engine && typeof this.engine.a4 === 'number') ? this.engine.a4 : 440;
    const freq = midiToFrequency(note, a4);
    const normVelocity = Math.max(0.001, Math.min(1.0, velocity / 127.0));

    // Track drone pitches in bass/sub register if drone pitch tracking is enabled
    if (this.engine && typeof this.engine.trackDronePitch === 'function') {
      this.engine.trackDronePitch(note);
    }
    if (this.engine && typeof this.engine.noteOn === 'function') {
      this.engine.noteOn(note);
    }

    // Continuous sustain hold (20.0s isHold) until physical Note-Off or sustain pedal release
    const voice = this.engine.feltPiano.playNote(freq, normVelocity, 20.0, true);

    if (voice) {
      voice.currentMidi = note;

      // Remove stolen voice from any other note's set in activeNotes
      for (const [otherNote, voiceSet] of this.activeNotes.entries()) {
        if (otherNote !== note && voiceSet.has(voice)) {
          voiceSet.delete(voice);
          if (voiceSet.size === 0) {
            this.activeNotes.delete(otherNote);
          }
        }
      }

      // Ensure stolen voice is not in latchedVoices
      this.latchedVoices.delete(voice);

      if (!this.activeNotes.has(note)) {
        this.activeNotes.set(note, new Set());
      }
      this.activeNotes.get(note).add(voice);
    }

    // Visual chime strip feedback if available
    if (this.app?.playSurface && typeof this.app.playSurface.flashKey === 'function') {
      this.app.playSurface.flashKey(note);
    }
  }

  /**
   * Handle Note-Off with sustain pedal voice latching
   * @param {number} note - MIDI note number (0-127)
   */
  _handleNoteOff(note) {
    if (this.engine && typeof this.engine.noteOff === 'function') {
      this.engine.noteOff(note);
    }

    const voices = this.activeNotes.get(note);
    if (!voices || voices.size === 0) {
      this.activeNotes.delete(note);
      return;
    }

    for (const voice of voices) {
      // If voice was stolen to sound another note, do not release or latch it
      if (voice && typeof voice.currentMidi === 'number' && voice.currentMidi !== note) {
        continue;
      }
      if (this.isSustainDown) {
        // Pedal held down: latch voices to sound until pedal released
        this.latchedVoices.add(voice);
      } else {
        // Pedal up: release voices immediately
        if (voice && typeof voice.release === 'function') {
          voice.release();
        }
      }
    }
    this.activeNotes.delete(note);
  }

  /**
   * Handle Control Change (Sustain Pedal CC 64, Mod Wheel CC 1, All Notes Off CC 120/123)
   * @param {number} cc - Controller number
   * @param {number} value - Controller value (0-127)
   */
  _handleControlChange(cc, value) {
    if (cc === 64) {
      // CC 64: Sustain Pedal (Damper)
      if (value >= 64) {
        this.isSustainDown = true;
        if (this.engine && typeof this.engine.setSustainPedal === 'function') {
          this.engine.setSustainPedal(true);
        }
      } else {
        this.isSustainDown = false;
        if (this.engine && typeof this.engine.setSustainPedal === 'function') {
          this.engine.setSustainPedal(false);
        }
        // Collect all voices whose physical key is currently held down in activeNotes
        const heldVoices = new Set();
        for (const voiceSet of this.activeNotes.values()) {
          for (const v of voiceSet) {
            heldVoices.add(v);
          }
        }

        // Release only voices in latchedVoices whose physical key is NOT currently held
        for (const voice of this.latchedVoices) {
          if (!heldVoices.has(voice)) {
            if (voice && typeof voice.release === 'function') {
              voice.release();
            }
          }
        }
        this.latchedVoices.clear();
      }
    } else if (cc === 1) {
      // CC 1: Modulation Wheel
      const norm = Math.max(0, Math.min(1.0, value / 127.0));
      if (this.engine && typeof this.engine.setModulationWheel === 'function') {
        this.engine.setModulationWheel(norm);
      }
      if (this.app?.knobs?.feltTone && typeof this.app.knobs.feltTone.setValue === 'function') {
        this.app.knobs.feltTone.setValue(norm * 100, false);
      }
    } else if (cc === 120 || cc === 123) {
      // CC 120: All Sound Off, CC 123: All Notes Off
      this.panic();
    }
  }

  /**
   * Handle 14-bit Pitch Bend (status 0xE0-0xEF)
   * @param {number} lsb - Least significant 7 bits (data[1])
   * @param {number} msb - Most significant 7 bits (data[2])
   */
  _handlePitchBend(lsb, msb) {
    // 14-bit integer centered at 8192 (range 0..16383)
    const bend = (((msb & 0x7F) << 7) | (lsb & 0x7F)) - 8192;
    // Normalize to cents: +/- 2 semitones = +/- 200 cents
    const cents = (bend / 8192.0) * (this.pitchBendRangeSemitones * 100.0);
    this.currentPitchBendCents = cents;

    if (this.engine && typeof this.engine.setPitchBend === 'function') {
      this.engine.setPitchBend(cents);
    }
  }

  /**
   * Release all active and latched voices immediately
   */
  panic() {
    this._runningStatus = null;
    for (const voices of this.activeNotes.values()) {
      for (const voice of voices) {
        if (voice && typeof voice.release === 'function') {
          voice.release();
        }
      }
    }
    this.activeNotes.clear();

    for (const voice of this.latchedVoices) {
      if (voice && typeof voice.release === 'function') {
        voice.release();
      }
    }
    this.latchedVoices.clear();
    this.isSustainDown = false;
    if (this.engine && typeof this.engine.releaseAllNotes === 'function') {
      this.engine.releaseAllNotes();
    }
  }

  /**
   * Clean up all attached MIDI inputs and event handlers
   */
  destroy() {
    this.panic();
    for (const input of this._attachedInputs) {
      this._detachInput(input);
    }
    this._attachedInputs.clear();

    if (this.midiAccess) {
      if (this.midiAccess.onstatechange === this._boundStateChangeHandler) {
        this.midiAccess.onstatechange = null;
      }
      if (typeof this.midiAccess.removeEventListener === 'function') {
        this.midiAccess.removeEventListener('statechange', this._boundStateChangeHandler);
      }
      this.midiAccess = null;
    }
  }
}
