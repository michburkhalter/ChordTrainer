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
}

export const KEYBOARD_LOW = 48; // C3
export const KEYBOARD_HIGH = 72; // C5

const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

/**
 * Build a root-position voicing of the chord inside [KEYBOARD_LOW, KEYBOARD_HIGH].
 * Prefers a compact voicing with the root closest to MIDI 55 (G3).
 */
export function chordVoicing(rootPc: number, quality: ChordQuality): number[] {
  const thirdPc = (rootPc + (quality === 'minor' ? 3 : 4)) % 12;
  const fifthPc = (rootPc + 7) % 12;
  const pcs = [rootPc, thirdPc, fifthPc];

  const candidates = pcs.map((pc) => {
    const list: number[] = [];
    for (let m = KEYBOARD_LOW; m <= KEYBOARD_HIGH; m++) {
      if (((m % 12) + 12) % 12 === pc) list.push(m);
    }
    return list;
  });

  let best: number[] | null = null;
  let bestScore = Infinity;

  for (const r of candidates[0]) {
    for (const t of candidates[1]) {
      for (const f of candidates[2]) {
        if (!(r < t && t < f)) continue; // root position only
        const span = f - r;
        // prefer compact voicings, then root near 55
        const score = span * 10 + Math.abs(r - 55);
        if (score < bestScore) {
          bestScore = score;
          best = [r, t, f];
        }
      }
    }
  }

  // Fallback (shouldn't happen for triads in this range): any in-range combo
  if (!best) {
    best = pcs.map((_pc, i) => candidates[i][0]);
  }
  return best;
}

export function makeChord(root: number, quality: ChordQuality): Chord {
  const third = quality === 'minor' ? 3 : 4;
  return {
    root,
    quality,
    symbol: NOTE_NAMES[root] + (quality === 'minor' ? 'm' : ''),
    pitchClasses: [root, (root + third) % 12, (root + 7) % 12],
    voicing: chordVoicing(root, quality),
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
