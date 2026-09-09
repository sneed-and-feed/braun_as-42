import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import {
  midiToFrequency,
  frequencyToMidi,
  quantizeToScale,
  getScaleDegreesInOctaves,
  getChordFrequencies,
  SCALES,
  CHORD_VOICINGS
} from '../js/generative/scales.js';

describe('Scales and Tuning Math', () => {
  it('correctly calculates concert pitch A4 (MIDI 69 = 440 Hz)', () => {
    const fA4 = midiToFrequency(69, 440);
    assert.strictEqual(Math.round(fA4), 440);
  });

  it('correctly calculates C4 (MIDI 60 ~ 261.63 Hz)', () => {
    const fC4 = midiToFrequency(60, 440);
    assert.strictEqual(fC4.toFixed(2), '261.63');
  });

  it('correctly handles 432 Hz concert pitch', () => {
    const fA4_432 = midiToFrequency(69, 432);
    assert.strictEqual(Math.round(fA4_432), 432);
  });

  it('inverts frequency to MIDI correctly', () => {
    const midi = frequencyToMidi(440, 440);
    assert.strictEqual(Math.round(midi), 69);

    const midiC4 = frequencyToMidi(261.6255653, 440);
    assert.strictEqual(Math.round(midiC4), 60);
  });

  it('quantizes chromatic notes to Budd Major Pentatonic', () => {
    // In C major pentatonic: C, D, E, G, A (intervals 0, 2, 4, 7, 9)
    // C4 is 60.
    // 60 -> 60 (C)
    assert.strictEqual(quantizeToScale(60, 0, SCALES.BUDD_PENTATONIC.intervals), 60);

    // 61 (C#) should quantize to 60 (C) or 62 (D). In our math, diff to 60 is 1, diff to 62 is 1 -> 60 or 62.
    const q61 = quantizeToScale(61, 0, SCALES.BUDD_PENTATONIC.intervals);
    assert.ok(q61 === 60 || q61 === 62);

    // 65 (F) -> intervals are E (64) and G (67). Diff to 64 is 1, diff to 67 is 2 -> should be 64 (E)
    assert.strictEqual(quantizeToScale(65, 0, SCALES.BUDD_PENTATONIC.intervals), 64);

    // 66 (F#) -> intervals are E (64) and G (67). Diff to 67 is 1 -> 67 (G)
    assert.strictEqual(quantizeToScale(66, 0, SCALES.BUDD_PENTATONIC.intervals), 67);

    // 71 (B) -> intervals are A (69) and high C (72). Diff to 72 is 1 -> 72 (C5)
    assert.strictEqual(quantizeToScale(71, 0, SCALES.BUDD_PENTATONIC.intervals), 72);
  });

  it('generates scale degrees across octaves properly', () => {
    const degrees = getScaleDegreesInOctaves(0, SCALES.BUDD_PENTATONIC.intervals, 3, 4, 440);
    // 2 octaves * 5 notes per octave = 10 notes
    assert.strictEqual(degrees.length, 10);
    assert.strictEqual(degrees[0].name, 'C3');
    assert.ok(degrees[0].freq > 120 && degrees[0].freq < 140);
    assert.strictEqual(degrees[degrees.length - 1].name, 'A4');
  });

  it('calculates chord frequencies for Harold Budd Pavilion Sus', () => {
    const freqs = getChordFrequencies(60, 'PAVILION_SUS', 440);
    // Intervals [0, 7, 14, 16] -> MIDI [60, 67, 74, 76]
    assert.strictEqual(freqs.length, 4);
    assert.strictEqual(Math.round(frequencyToMidi(freqs[0], 440)), 60);
    assert.strictEqual(Math.round(frequencyToMidi(freqs[1], 440)), 67);
    assert.strictEqual(Math.round(frequencyToMidi(freqs[2], 440)), 74);
    assert.strictEqual(Math.round(frequencyToMidi(freqs[3], 440)), 76);
  });

  it('quantizes and generates degrees for Avalon / Spirited Modal scale', () => {
    const scale = SCALES.AVALON_SPIRITED;
    assert.ok(scale);
    assert.deepStrictEqual(scale.intervals, [0, 2, 4, 5, 7, 9, 11]);

    // Chromatic notes quantize cleanly
    assert.strictEqual(quantizeToScale(60, 0, scale.intervals), 60); // C4
    assert.strictEqual(quantizeToScale(65, 0, scale.intervals), 65); // F4
    assert.strictEqual(quantizeToScale(71, 0, scale.intervals), 71); // B4

    const degrees = getScaleDegreesInOctaves(0, scale.intervals, 3, 4, 440);
    // 2 octaves * 7 notes per octave = 14 notes
    assert.strictEqual(degrees.length, 14);
    assert.strictEqual(degrees[0].name, 'C3');
    assert.strictEqual(degrees[degrees.length - 1].name, 'B4');
  });

  it('calculates chord frequencies for Avalon Maj9 and Spirited Away signature voicings', () => {
    // Avalon Maj9: [0, 7, 11, 14, 16] -> MIDI [60, 67, 71, 74, 76]
    const avalonFreqs = getChordFrequencies(60, 'AVALON_MAJ9', 440);
    assert.strictEqual(avalonFreqs.length, 5);
    const avalonMidis = avalonFreqs.map(f => Math.round(frequencyToMidi(f, 440)));
    assert.deepStrictEqual(avalonMidis, [60, 67, 71, 74, 76]);

    // Summer's Day: [0, 7, 14, 16, 19] -> MIDI [60, 67, 74, 76, 79]
    const summersFreqs = getChordFrequencies(60, 'SUMMERS_DAY', 440);
    assert.strictEqual(summersFreqs.length, 5);
    const summersMidis = summersFreqs.map(f => Math.round(frequencyToMidi(f, 440)));
    assert.deepStrictEqual(summersMidis, [60, 67, 74, 76, 79]);

    // Spirited Sus: [0, 7, 12, 14, 17] -> MIDI [60, 67, 72, 74, 77]
    const susFreqs = getChordFrequencies(60, 'SPIRITED_SUS', 440);
    assert.strictEqual(susFreqs.length, 5);
    const susMidis = susFreqs.map(f => Math.round(frequencyToMidi(f, 440)));
    assert.deepStrictEqual(susMidis, [60, 67, 72, 74, 77]);

    // Nostalgia 11th: [0, 7, 10, 14, 15, 17] -> MIDI [60, 67, 70, 74, 75, 77]
    const nostFreqs = getChordFrequencies(60, 'NOSTALGIA_11TH', 440);
    assert.strictEqual(nostFreqs.length, 6);
    const nostMidis = nostFreqs.map(f => Math.round(frequencyToMidi(f, 440)));
    assert.deepStrictEqual(nostMidis, [60, 67, 70, 74, 75, 77]);

    // Blade Runner (Vangelis CS-80 Brass Cluster): [0, 7, 10, 14, 17, 20] -> MIDI [60, 67, 70, 74, 77, 80]
    const brFreqs = getChordFrequencies(60, 'BLADE_RUNNER', 440);
    assert.strictEqual(brFreqs.length, 6);
    const brMidis = brFreqs.map(f => Math.round(frequencyToMidi(f, 440)));
    assert.deepStrictEqual(brMidis, [60, 67, 70, 74, 77, 80]);
    assert.strictEqual(CHORD_VOICINGS.BLADE_RUNNER.name, 'Blade Runner');
    assert.strictEqual(CHORD_VOICINGS.BLADE_RUNNER.description, 'Vangelis CS-80 brass cluster (1 - 5 - b7 - 9 - 11 - b13)');

    // Tears in Rain (Vangelis CS-80 Poignant Resolution): [0, 7, 11, 14, 18, 21] -> MIDI [60, 67, 71, 74, 78, 81]
    const tirFreqs = getChordFrequencies(60, 'TEARS_IN_RAIN', 440);
    assert.strictEqual(tirFreqs.length, 6);
    const tirMidis = tirFreqs.map(f => Math.round(frequencyToMidi(f, 440)));
    assert.deepStrictEqual(tirMidis, [60, 67, 71, 74, 78, 81]);
    assert.strictEqual(CHORD_VOICINGS.TEARS_IN_RAIN.name, 'Tears in Rain');
    assert.strictEqual(CHORD_VOICINGS.TEARS_IN_RAIN.description, 'Vangelis poignant resolution (1 - 5 - 7 - 9 - #11 - 13)');
  });

  it('diversifies ETHEREAL_11TH with Eno celestial shimmer voicing distinct from NOSTALGIA_11TH', () => {
    // Ethereal 11th (Cluster 4): [0, 7, 11, 14, 17, 24] -> MIDI [60, 67, 71, 74, 77, 84]
    const ethFreqs = getChordFrequencies(60, 'ETHEREAL_11TH', 440);
    assert.strictEqual(ethFreqs.length, 6);
    const ethMidis = ethFreqs.map(f => Math.round(frequencyToMidi(f, 440)));
    assert.deepStrictEqual(ethMidis, [60, 67, 71, 74, 77, 84]);
    assert.strictEqual(CHORD_VOICINGS.ETHEREAL_11TH.name, 'Ethereal 11th');
    assert.strictEqual(CHORD_VOICINGS.ETHEREAL_11TH.description, 'Eno celestial shimmer voicing (1 - 5 - 7 - 9 - 11 - 15ma)');

    // Nostalgia 11th (Cluster 0): [0, 7, 10, 14, 15, 17] -> MIDI [60, 67, 70, 74, 75, 77]
    const nostFreqs = getChordFrequencies(60, 'NOSTALGIA_11TH', 440);
    const nostMidis = nostFreqs.map(f => Math.round(frequencyToMidi(f, 440)));

    // Assert that Cluster 4 and Cluster 0 are not identical and have distinct intervals
    assert.notDeepStrictEqual(CHORD_VOICINGS.ETHEREAL_11TH.intervals, CHORD_VOICINGS.NOSTALGIA_11TH.intervals);
    assert.notDeepStrictEqual(ethMidis, nostMidis);
    // Cluster 4 has Major 7 (11) and 15ma octave shimmer (24), whereas Cluster 0 has b7 (10) and b10 (15)
    assert.ok(CHORD_VOICINGS.ETHEREAL_11TH.intervals.includes(11), 'Cluster 4 must feature Major 7th (11)');
    assert.ok(CHORD_VOICINGS.ETHEREAL_11TH.intervals.includes(24), 'Cluster 4 must feature 15ma high shimmer octave (24)');
    assert.ok(!CHORD_VOICINGS.ETHEREAL_11TH.intervals.includes(10), 'Cluster 4 must not duplicate b7 (10)');
    assert.ok(!CHORD_VOICINGS.ETHEREAL_11TH.intervals.includes(15), 'Cluster 4 must not duplicate b10 (15)');
  });

  it('maps A through \' keys across single-row 11-key chime strip and excludes semitone keys W, E, R, T, U', async () => {
    const {
      getChimeKeyIndex,
      isPlayableSynthesizerKey
    } = await import('../js/ui/keyboard.js');

    // Diatonic 11-key range: A, S, D, F, G, H, J, K, L, ;, '
    const codes = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
    codes.forEach((code, idx) => {
      assert.strictEqual(getChimeKeyIndex({ code }), idx, `Code ${code} must map to chime index ${idx}`);
      assert.strictEqual(isPlayableSynthesizerKey({ code }), true, `Code ${code} must be a playable synthesizer key`);
    });

    // Keys W, E, R, T, Y, U, etc. must not trigger semitones or be playable synthesizer keys
    const nonPlayable = ['KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'];
    nonPlayable.forEach((code) => {
      assert.strictEqual(getChimeKeyIndex({ code }), null, `Code ${code} must not be a chime key`);
      assert.strictEqual(isPlayableSynthesizerKey({ code }), false, `Code ${code} must not be a playable synthesizer key`);
    });
  });
});
