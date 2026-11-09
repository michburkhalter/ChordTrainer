export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export type ChordQuality = 'major' | 'minor';

export interface Chord {
  /** Pitch class of the root, 0 = C */
  root: number;
  quality: ChordQuality;
  /** e.g. "C", "F#m" */
  symbol: string;
  /** The three pitch classes that make up the chord */
  pitchClasses: number[];
  /** Suggested MIDI notes to play (root position, within keyboard range) */
  voicing: number[];
  /** Left-hand bass note: chord root one octave below the voicing root */
  bass: number;
}

export const KEYBOARD_LOW = 36; // C2 (display range, includes left-hand bass)
export const KEYBOARD_HIGH = 79; // G5 (highest chord tone is F#5 for B-rooted chords)
const VOICING_LOW = 60; // C4 (chord roots live in the C4–B4 octave)

const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

const THIRD_TOP = 70; // A#4/Bb4 — thirds never sound above this
const FIFTH_TOP = 71; // B4 — the fifth may reach B4 (it tops the chord)

/**
 * Root-position voicing with the root in the C4–B4 octave (MIDI 60–71).
 * The third drops an octave above A#4, the fifth above B4 — e.g. the C of
 * F major sounds at C4, the B of G major at B3, while Em keeps its B4.
 */
export function chordVoicing(rootPc: number, quality: ChordQuality): number[] {
  const third = quality === 'minor' ? 3 : 4;
  const root = VOICING_LOW + rootPc; // 60 + pc -> 60..71
  const cap = (m: number, top: number) => (m > top ? m - 12 : m);
  return [root, cap(root + third, THIRD_TOP), cap(root + 7, FIFTH_TOP)];
}

export function makeChord(root: number, quality: ChordQuality): Chord {
  const third = quality === 'minor' ? 3 : 4;
  const voicing = chordVoicing(root, quality);
  return {
    root,
    quality,
    symbol: NOTE_NAMES[root] + (quality === 'minor' ? 'm' : ''),
    pitchClasses: [root, (root + third) % 12, (root + 7) % 12],
    voicing,
    bass: voicing[0] - 12,
  };
}

/** All 24 major/minor triads, ordered by circle of fifths for a pleasant sequence. */
export const ALL_CHORDS: Chord[] = (() => {
  // Circle of fifths roots starting at C: C G D A E B F# C# Ab Eb Bb F
  const fifthsOrder = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  const chords: Chord[] = [];
  for (const root of fifthsOrder) {
    chords.push(makeChord(root, 'major'), makeChord(root, 'minor'));
  }
  return chords;
})();

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const midiToPitchClass = (midi: number) => ((midi % 12) + 12) % 12;
export const isBlackMidi = isBlackKey;
export const midiToName = (midi: number) => NOTE_NAMES[midiToPitchClass(midi)];
