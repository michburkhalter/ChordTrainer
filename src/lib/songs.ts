import { ALL_CHORDS, type Chord } from './theory';

export interface SongSegment {
  chord: Chord;
  beats: number;
  /** Section label (e.g. "Verse 1"), set on the first segment of a section */
  section?: string;
}

/** Per-song YouTube sync settings, stored under chordtrainer.songSync. */
export interface SongSync {
  videoId: string;
  /** Video time (s) at which the first chart chord starts */
  offsetSec: number;
  /** Chart BPM for this video (defaults to the song's BPM) */
  bpm: number;
}

export interface Song {
  id: string;
  title: string;
  artist?: string;
  bpm: number;
  segments: SongSegment[];
  custom?: boolean;
}

const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
};

/**
 * Normalize a chord symbol the user typed (C, c#, F#m, Bb, Ebm, ...) to one of
 * the ALL_CHORDS symbols, or null if it isn't a known major/minor triad.
 */
export function normalizeSymbol(raw: string): string | null {
  const m = /^([A-Ga-g])([#bB]?)(m|M|min|maj)?$/.exec(raw.trim());
  if (!m) return null;
  let root = m[1].toUpperCase() + m[2];
  root = root.replace(/b$/i, 'b');
  if (root.endsWith('b')) {
    const sharp = FLAT_TO_SHARP[root[0].toUpperCase() + 'b'];
    if (!sharp) return null;
    root = sharp;
  } else {
    root = root[0].toUpperCase() + root.slice(1);
  }
  const quality = m[3] && m[3] !== 'M' && m[3] !== 'maj' ? 'm' : '';
  const symbol = root + quality;
  return ALL_CHORDS.some((c) => c.symbol === symbol) ? symbol : null;
}

/**
 * Parse a chord chart: tokens split on whitespace, commas or "|".
 * Each token is `Chord` or `Chord:beats` (beats default 4, allowed 0.5–32).
 */
export function parseSongText(
  text: string,
): { segments: SongSegment[] } | { error: string } {
  const tokens = text.split(/[\s,|]+/).filter(Boolean);
  if (tokens.length === 0) return { error: 'No chords found' };
  const segments: SongSegment[] = [];
  for (const token of tokens) {
    const parts = token.split(':');
    if (parts.length > 2) return { error: `Can't parse "${token}"` };
    const symbol = normalizeSymbol(parts[0]);
    if (!symbol) return { error: `Unknown chord "${parts[0]}"` };
    let beats = 4;
    if (parts.length === 2) {
      beats = Number(parts[1]);
      if (!Number.isFinite(beats) || beats < 0.5 || beats > 32) {
        return { error: `Bad beat count in "${token}" (use 0.5–32)` };
      }
    }
    segments.push({ chord: ALL_CHORDS.find((c) => c.symbol === symbol)!, beats });
  }
  return { segments };
}

export function songDurationMs(song: Song, bpm: number): number {
  const beats = song.segments.reduce((sum, s) => sum + s.beats, 0);
  return (beats * 60000) / bpm;
}

function chart(section: string, ...bars: string[]): SongSegment[] {
  const segments: SongSegment[] = [];
  for (const bar of bars) {
    const result = parseSongText(bar);
    if ('error' in result) throw new Error(`${section}: ${result.error}`);
    segments.push(...result.segments);
  }
  segments[0].section = section;
  return segments;
}

const ICSCN_VERSE = 'D:8 G:4 D:4 | D:8 G:4 A:4 | D:8 G:4 D:4 | C:4 G:4 D:8';

export const BUILTIN_SONGS: Song[] = [
  {
    id: 'i-can-see-clearly-now',
    title: 'I Can See Clearly Now',
    artist: 'Jimmy Cliff',
    bpm: 120,
    segments: [
      ...chart('Verse 1', ICSCN_VERSE),
      ...chart('Verse 2', ICSCN_VERSE),
      ...chart('Bridge', 'F:8 C:8 F:8 A:8 | C#m:4 G:4 C#m:4 G:4 C:4 Bm:4 A:8'),
      ...chart('Verse 3', ICSCN_VERSE),
      ...chart('Outro', 'D:8'),
    ],
  },
  {
    id: 'let-it-be',
    title: 'Let It Be',
    artist: 'The Beatles',
    bpm: 72,
    segments: [
      ...chart('Verse 1', 'C:4 G:4 Am:4 F:4'),
      ...chart('Verse 2', 'C:4 G:4 Am:4 F:4'),
    ],
  },
  {
    id: 'stand-by-me',
    title: 'Stand By Me',
    artist: 'Ben E. King',
    bpm: 118,
    segments: [
      ...chart('Verse 1', 'G:8 Em:8 C:4 D:4 G:8'),
      ...chart('Verse 2', 'G:8 Em:8 C:4 D:4 G:8'),
    ],
  },
  {
    id: 'horse-with-no-name',
    title: 'A Horse with No Name',
    artist: 'America',
    bpm: 122,
    segments: [
      ...chart('Verse', 'Em:4 D:4'),
      ...chart('', 'Em:4 D:4'),
      ...chart('', 'Em:4 D:4'),
      ...chart('', 'Em:4 D:4'),
    ],
  },
];
