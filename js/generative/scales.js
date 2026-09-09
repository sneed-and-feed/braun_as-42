/**
 * @file scales.js
 * @brief Curated modal scales, microtonal calculations, foolproof quantizers,
 * and chord voicings for Harold Budd / Brian Eno / Elta Solar 42n ambient synthesis.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  BUDD_PENTATONIC: {
    id: 'BUDD_PENTATONIC',
    name: 'Budd Felt Pentatonic',
    intervals: [0, 2, 4, 7, 9],
    description: "Harold Budd's meditative open major pentatonic (no harsh tritones)"
  },
  LYDIAN_DREAM: {
    id: 'LYDIAN_DREAM',
    name: 'Lydian Ambient',
    intervals: [0, 2, 4, 6, 7, 9, 11],
    description: 'Brian Eno celestial floating mood with raised 4th (#11)'
  },
  DORIAN_MYSTIC: {
    id: 'DORIAN_MYSTIC',
    name: 'Dorian Mystic',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    description: 'Contemplative, melancholy modal color with hopeful natural 6th'
  },
  YOSHIMURA_AMBIENT: {
    id: 'YOSHIMURA_AMBIENT',
    name: 'Kankyo Ongaku',
    intervals: [0, 2, 5, 7, 9],
    description: 'Hiroshi Yoshimura environmental Japanese pentatonic'
  },
  AEOLIAN_MIDNIGHT: {
    id: 'AEOLIAN_MIDNIGHT',
    name: 'Aeolian Midnight',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    description: 'Deep nocturnal natural minor'
  },
  BUDD_HEXATONIC: {
    id: 'BUDD_HEXATONIC',
    name: 'Budd Hexatonic',
    intervals: [0, 2, 4, 5, 7, 9],
    description: 'Warm piano voicing scale with gentle singing 4th'
  },
  WHOLE_TONE: {
    id: 'WHOLE_TONE',
    name: 'Weightless Whole Tone',
    intervals: [0, 2, 4, 6, 8, 10],
    description: 'Zero gravity, suspended dream-like impressionist space'
  },
  AVALON_SPIRITED: {
    id: 'AVALON_SPIRITED',
    name: 'Avalon / Spirited Modal',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    description: 'Joe Hisaishi & Harold Budd nostalgic modal space (Spirited Away / Avalon Sutra)'
  }
};

export const CHORD_VOICINGS = {
  PAVILION_SUS: {
    id: 'PAVILION_SUS',
    name: 'Pavilion Suspended',
    intervals: [0, 7, 14, 16],
    description: 'Harold Budd signature open suspension (1 - 5 - 9 - 10)'
  },
  PLATEAUX_MAJ9: {
    id: 'PLATEAUX_MAJ9',
    name: 'Plateaux Major 9',
    intervals: [0, 4, 7, 11, 14],
    description: 'Warm lush major 9th felt piano voicing'
  },
  DEEP_DRONE_FIFTH: {
    id: 'DEEP_DRONE_FIFTH',
    name: 'Deep Drone Fifth',
    intervals: [0, 7, 12, 19, 24],
    description: 'Massive open fifths and octaves for microtonal drones'
  },
  ETHEREAL_11TH: {
    id: 'ETHEREAL_11TH',
    name: 'Ethereal 11th',
    intervals: [0, 7, 11, 14, 17, 24],
    description: 'Eno celestial shimmer voicing (1 - 5 - 7 - 9 - 11 - 15ma)'
  },
  LYDIAN_CASCADE: {
    id: 'LYDIAN_CASCADE',
    name: 'Lydian Cascade',
    intervals: [0, 4, 6, 7, 11, 14],
    description: 'Sparkling #11 bloom voicing'
  },
  SOLAR_BEATING: {
    id: 'SOLAR_BEATING',
    name: 'Solar Beating Drone',
    intervals: [0, 0.08, 7, 7.06, 12],
    description: 'Microtonally detuned acoustic beating cluster'
  },
  AVALON_MAJ9: {
    id: 'AVALON_MAJ9',
    name: 'Avalon Maj9',
    intervals: [0, 7, 11, 14, 16],
    description: 'Harold Budd luminous open Maj9 (1 - 5 - 7 - 9 - 10)'
  },
  SUMMERS_DAY: {
    id: 'SUMMERS_DAY',
    name: "Summer's Day",
    intervals: [0, 7, 14, 16, 19],
    description: 'Hisaishi nostalgic open 9th voicing (1 - 5 - 9 - 10 - 12)'
  },
  SPIRITED_SUS: {
    id: 'SPIRITED_SUS',
    name: 'Spirited Sus',
    intervals: [0, 7, 12, 14, 17],
    description: 'Hisaishi / Budd suspended floating cluster (1 - 5 - 8va - 9 - 11)'
  },
  NOSTALGIA_11TH: {
    id: 'NOSTALGIA_11TH',
    name: 'Nostalgia 11th',
    intervals: [0, 7, 10, 14, 15, 17],
    description: 'Lush bittersweet minor 11th (1 - 5 - b7 - 9 - b10 - 11)'
  },
  BLADE_RUNNER: {
    id: 'BLADE_RUNNER',
    name: 'Blade Runner',
    intervals: [0, 7, 10, 14, 17, 20],
    description: 'Vangelis CS-80 brass cluster (1 - 5 - b7 - 9 - 11 - b13)'
  },
  TEARS_IN_RAIN: {
    id: 'TEARS_IN_RAIN',
    name: 'Tears in Rain',
    intervals: [0, 7, 11, 14, 18, 21],
    description: 'Vangelis poignant resolution (1 - 5 - 7 - 9 - #11 - 13)'
  }
};

/**
 * Convert MIDI note number to frequency in Hertz
 * @param {number} midi - MIDI note number (can be floating point for microtonal tuning)
 * @param {number} [a4=440] - Concert pitch reference in Hz (e.g. 440 or 432)
 * @returns {number} Frequency in Hz
 */
export function midiToFrequency(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Convert frequency in Hertz to MIDI note number
 * @param {number} freq - Frequency in Hz
 * @param {number} [a4=440] - Concert pitch reference in Hz
 * @returns {number} Fractional MIDI note number
 */
export function frequencyToMidi(freq, a4 = 440) {
  if (freq <= 0) return 0;
  return 69 + 12 * Math.log2(freq / a4);
}

/**
 * Quantize any arbitrary MIDI note number to the nearest note in the given scale.
 * Guaranteed to keep any input harmonically consonant.
 * @param {number} midiNote - Raw input MIDI note (e.g. 62.4)
 * @param {number} rootPitchClass - Root note pitch class (0 = C, 1 = C#, ..., 11 = B)
 * @param {number[]} scaleIntervals - Array of semitone offsets from root (e.g. [0, 2, 4, 7, 9])
 * @returns {number} Quantized MIDI note number
 */
export function quantizeToScale(midiNote, rootPitchClass, scaleIntervals) {
  if (!scaleIntervals || scaleIntervals.length === 0) return Math.round(midiNote);

  // Normalize rootPitchClass
  const normRoot = ((rootPitchClass % 12) + 12) % 12;

  // Determine base octave and semitone relative to root
  const baseOctave = Math.floor((midiNote - normRoot) / 12);
  const relativeSemitone = (midiNote - normRoot) - (baseOctave * 12);

  // Find the closest scale degree
  let bestInterval = scaleIntervals[0];
  let minDiff = Infinity;

  // Check candidates in current octave, lower octave, and next octave
  for (const interval of scaleIntervals) {
    // interval in current octave
    const diff = Math.abs(relativeSemitone - interval);
    if (diff < minDiff) {
      minDiff = diff;
      bestInterval = interval;
    }
  }

  // Also check wrapping to next octave (e.g. interval 0 in next octave = 12)
  const wrapNext = Math.abs(relativeSemitone - (scaleIntervals[0] + 12));
  if (wrapNext < minDiff) {
    minDiff = wrapNext;
    bestInterval = scaleIntervals[0] + 12;
  }

  // Also check wrapping to previous octave
  const wrapPrev = Math.abs(relativeSemitone - (scaleIntervals[scaleIntervals.length - 1] - 12));
  if (wrapPrev < minDiff) {
    bestInterval = scaleIntervals[scaleIntervals.length - 1] - 12;
  }

  return normRoot + (baseOctave * 12) + bestInterval;
}

/**
 * Generate a sorted list of scale degrees across specified octaves
 * @param {number} rootPitchClass - 0 = C, 1 = C#, etc.
 * @param {number[]} scaleIntervals - Semitone offsets from root
 * @param {number} [startOctave=2] - Starting octave (e.g. 2 for C2)
 * @param {number} [endOctave=6] - Ending octave (e.g. 6 for C6)
 * @param {number} [a4=440] - Concert pitch reference
 * @returns {Array<{midi: number, freq: number, name: string, octave: number, degree: number}>}
 */
export function getScaleDegreesInOctaves(rootPitchClass, scaleIntervals, startOctave = 2, endOctave = 6, a4 = 440) {
  const notes = [];
  const normRoot = ((rootPitchClass % 12) + 12) % 12;

  for (let oct = startOctave; oct <= endOctave; oct++) {
    // C0 = MIDI 12, C1 = 24, C(oct) = (oct + 1) * 12
    const baseMidi = (oct + 1) * 12;
    for (let i = 0; i < scaleIntervals.length; i++) {
      const interval = scaleIntervals[i];
      const midi = baseMidi + normRoot + interval;
      const pitchClass = (normRoot + interval) % 12;
      const noteOctave = Math.floor(midi / 12) - 1;
      const noteName = `${NOTE_NAMES[pitchClass]}${noteOctave}`;
      const freq = midiToFrequency(midi, a4);

      notes.push({
        midi,
        freq,
        name: noteName,
        octave: noteOctave,
        degree: i + 1,
        interval
      });
    }
  }

  // Sort by MIDI note number
  notes.sort((a, b) => a.midi - b.midi);
  return notes;
}

/**
 * Return an array of frequencies for a chord voicing based on a root MIDI note
 * @param {number} rootMidi - Root MIDI note
 * @param {string} voicingId - ID from CHORD_VOICINGS
 * @param {number} [a4=440] - Reference frequency
 * @returns {number[]} Array of frequencies in Hz
 */
export function getChordFrequencies(rootMidi, voicingId, a4 = 440) {
  const voicing = CHORD_VOICINGS[voicingId] || CHORD_VOICINGS.PAVILION_SUS;
  return voicing.intervals.map(interval => midiToFrequency(rootMidi + interval, a4));
}
