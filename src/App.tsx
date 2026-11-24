import { useEffect, useMemo, useRef, useState } from 'react';
import Keyboard from './components/Keyboard';
import SettingsPanel from './components/SettingsPanel';
import SongsPanel from './components/SongsPanel';
import Waterfall from './components/Waterfall';
import { ALL_CHORDS, NOTE_NAMES, shuffle, midiToPitchClass, type Chord } from './lib/theory';
import { useMidiInput } from './lib/midi';
import { PitchDetector } from './lib/mic';
import { KeyLights } from './lib/keylights';
import { playChord, playClick, playConfirm } from './lib/sound';
import {
  BUILTIN_SONGS,
  parseSongText,
  type Song,
  type SongSync,
} from './lib/songs';
import { loadYouTubeApi } from './lib/youtube';

const HOLD_MS = 500;
const SONG_HOLD_MS = 300;
const SUCCESS_MS = 900;
const UPCOMING_COUNT = 4;
const COUNT_IN_BEATS = 4;
const STORAGE_KEY = 'chordtrainer.enabledChords';
const LIGHTS_KEY = 'chordtrainer.keylights';
const EXTRA_KEY = 'chordtrainer.allowExtra';
const OCTAVE_KEY = 'chordtrainer.anyOctave';
const LEFT_KEY = 'chordtrainer.leftHand';
const SONGS_KEY = 'chordtrainer.customSongs';
const TEMPO_KEY = 'chordtrainer.songTempo';
const SONGCHORDS_KEY = 'chordtrainer.songChords';
const SONGCLICK_KEY = 'chordtrainer.songClick';
const SONGSYNC_KEY = 'chordtrainer.songSync';
const APP_VERSION = '1.0.0';

function loadEnabledChords(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      const valid = arr.filter((s) => ALL_CHORDS.some((c) => c.symbol === s));
      if (valid.length > 0) return new Set(valid);
    }
  } catch {
    // ignore corrupted storage
  }
  return new Set(ALL_CHORDS.map((c) => c.symbol));
}

interface StoredSong {
  id: string;
  title: string;
  artist?: string;
  bpm: number;
  text: string;
}

function loadCustomSongs(): Song[] {
  try {
    const raw = localStorage.getItem(SONGS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as StoredSong[];
    const songs: Song[] = [];
    for (const s of arr) {
      const parsed = parseSongText(s.text);
      if ('error' in parsed) continue; // skip songs that no longer parse
      songs.push({ id: s.id, title: s.title, artist: s.artist, bpm: s.bpm, segments: parsed.segments, custom: true });
    }
    return songs;
  } catch {
    return [];
  }
}

/** Stored sync per song; null = user removed a built-in default link. */
function loadSongSync(): Record<string, SongSync | null> {
  try {
    const raw = localStorage.getItem(SONGSYNC_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, SongSync | null>;
    const out: Record<string, SongSync | null> = {};
    for (const [id, s] of Object.entries(obj)) {
      if (s === null) out[id] = null;
      else if (s && typeof s.videoId === 'string') {
        out[id] = {
          videoId: s.videoId,
          offsetSec: Number.isFinite(s.offsetSec) ? s.offsetSec : 0,
          bpm: Number.isFinite(s.bpm) ? s.bpm : 90,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function ytErrorMessage(code: number): string {
  if (code === 2) return 'Invalid YouTube video ID — edit the link';
  if (code === 100) return 'This video was removed or is private — try another upload of the song';
  if (code === 101 || code === 150)
    return "This video can't be embedded — try another upload of the song";
  return 'YouTube playback failed — try another video';
}

function freshDeck(pool: Chord[], avoid?: string): Chord[] {
  if (pool.length <= 1) return pool.slice();
  const deck = shuffle(pool);
  if (avoid && deck[0].symbol === avoid) {
    [deck[0], deck[1]] = [deck[1], deck[0]];
  }
  return deck;
}

function noteNameWithOctave(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Pure check: does the current input satisfy the target chord? */
function chordSatisfied(
  chord: Chord,
  requiredNotes: number[],
  activeNotes: number[],
  heardPitchClasses: Set<number>,
  allowExtra: boolean,
  anyOctave: boolean,
  leftHand: boolean,
): boolean {
  if (anyOctave) {
    if (!chord.pitchClasses.every((pc) => heardPitchClasses.has(pc))) return false;
    if (leftHand) {
      // the bass must sound below the chord root (left hand register)
      const hasBass = activeNotes.some(
        (m) => m < chord.voicing[0] && midiToPitchClass(m) === chord.root,
      );
      if (!hasBass) return false;
    }
    if (!allowExtra) {
      // strict: every sounding pitch class must belong to the chord
      for (const pc of heardPitchClasses) {
        if (!chord.pitchClasses.includes(pc)) return false;
      }
    }
    return true;
  }
  // exact keys: every required note must be held
  const held = new Set(activeNotes);
  if (!requiredNotes.every((m) => held.has(m))) return false;
  if (!allowExtra) {
    const allowed = new Set(requiredNotes);
    for (const m of activeNotes) {
      if (!allowed.has(m)) return false;
    }
  }
  return true;
}

/** Section label of a segment (carried forward from the last labelled one). */
function sectionAt(song: Song, index: number): string | undefined {
  for (let i = index; i >= 0; i--) {
    if (song.segments[i].section) return song.segments[i].section;
  }
  return undefined;
}

type Mode = 'practice' | 'songs';
type PlayState = 'idle' | 'countin' | 'playing' | 'done';

export default function App() {
  const midi = useMidiInput();
  const detectorRef = useRef<PitchDetector | null>(null);
  const [micNotes, setMicNotes] = useState<number[]>([]);
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const [enabledSymbols, setEnabledSymbols] = useState<Set<string>>(loadEnabledChords);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyLightsOn, setKeyLightsOn] = useState(
    () => localStorage.getItem(LIGHTS_KEY) !== '0',
  );
  const [allowExtra, setAllowExtra] = useState(
    () => localStorage.getItem(EXTRA_KEY) !== '0',
  );
  const [anyOctave, setAnyOctave] = useState(
    () => localStorage.getItem(OCTAVE_KEY) !== '0',
  );
  const [leftHand, setLeftHand] = useState(
    () => localStorage.getItem(LEFT_KEY) !== '0',
  );
  const lightsRef = useRef<KeyLights | null>(null);
  const lightsActiveRef = useRef(false);
  const welcomeIdRef = useRef(0);
  const poolChords = useMemo(
    () => ALL_CHORDS.filter((c) => enabledSymbols.has(c.symbol)),
    [enabledSymbols],
  );
  const [deck, setDeck] = useState<Chord[]>(() => freshDeck(poolChords));
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [phase, setPhase] = useState<'waiting' | 'holding' | 'success'>('waiting');

  const chord = deck[index % deck.length];

  // ---- Songs mode state ----
  const [mode, setMode] = useState<Mode>('practice');
  const [customSongs, setCustomSongs] = useState<Song[]>(loadCustomSongs);
  const [tempo, setTempo] = useState(() => {
    const v = Number(localStorage.getItem(TEMPO_KEY));
    return Number.isFinite(v) && v >= 50 && v <= 120 ? v : 100;
  });
  const [songChords, setSongChords] = useState(
    () => localStorage.getItem(SONGCHORDS_KEY) !== '0',
  );
  const [songClick, setSongClick] = useState(
    () => localStorage.getItem(SONGCLICK_KEY) !== '0',
  );
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [segIndex, setSegIndex] = useState(0);
  const [countInBeat, setCountInBeat] = useState(0);
  const [hits, setHits] = useState(0);
  const [segHit, setSegHit] = useState(false);
  const [progress, setProgress] = useState(0);
  const [introSec, setIntroSec] = useState(0);
  const [segBeat, setSegBeat] = useState(0);
  const [storedSync, setStoredSync] = useState<Record<string, SongSync | null>>(loadSongSync);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [ytVideoId, setYtVideoId] = useState<string | null>(null);
  const [ytRates, setYtRates] = useState<number[]>([1]);
  const [ytRate, setYtRate] = useState(1);
  const [ytNeedsPlay, setYtNeedsPlay] = useState(false);
  const songTimerRef = useRef<number | null>(null);
  const countInTimerRef = useRef<number | null>(null);
  const ytPlayerRef = useRef<YT.Player | null>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const playSyncRef = useRef<SongSync | null>(null);
  const lastPlayVideoRef = useRef(false);
  // Live chart position in beats for the waterfall (-Infinity when idle)
  const chartBeatRef = useRef<() => number>(() => -Infinity);
  const hitSegsRef = useRef<ReadonlySet<number>>(new Set());
  // YouTube clock: last known video time + perf.now for extrapolation
  const videoClockRef = useRef({ vt: 0, pt: 0, playing: false, rate: 1 });

  const allSongs = useMemo(() => [...BUILTIN_SONGS, ...customSongs], [customSongs]);
  // Effective links: built-in defaults overridden (or removed) by stored entries
  const songSync = useMemo(() => {
    const out: Record<string, SongSync> = {};
    for (const s of allSongs) if (s.defaultSync) out[s.id] = s.defaultSync;
    for (const [id, s] of Object.entries(storedSync)) {
      if (s) out[id] = s;
      else delete out[id];
    }
    return out;
  }, [allSongs, storedSync]);

  // Combine inputs: MIDI when connected, plus mic when enabled
  const activeNotes = useMemo(() => {
    const notes = new Set<number>();
    if (midi.connected) midi.activeNotes.forEach((n) => notes.add(n));
    if (micOn) micNotes.forEach((n) => notes.add(n));
    return [...notes].sort((a, b) => a - b);
  }, [midi.connected, midi.activeNotes, micOn, micNotes]);

  const heardPitchClasses = useMemo(
    () => new Set(activeNotes.map(midiToPitchClass)),
    [activeNotes],
  );

  // Chord currently shown: the song segment while a song is up, else the deck chord
  const songPlaying =
    mode === 'songs' &&
    currentSong !== null &&
    (playState === 'countin' || playState === 'playing');
  const songSegment = songPlaying ? currentSong.segments[Math.min(segIndex, currentSong.segments.length - 1)] : null;
  const displayChord = songSegment ? songSegment.chord : chord;

  const inCountIn = songPlaying && playState === 'countin';
  const inIntro = songPlaying && introSec > 0;

  // Next-chord card: the upcoming segment, or the FIRST chord during count-in/intro
  const cardSeg =
    songPlaying && currentSong
      ? inCountIn || inIntro
        ? currentSong.segments[0]
        : (currentSong.segments[segIndex + 1] ?? null)
      : null;
  const cardRequired = useMemo(
    () =>
      cardSeg
        ? leftHand
          ? [...cardSeg.chord.voicing, cardSeg.chord.bass]
          : cardSeg.chord.voicing
        : [],
    [cardSeg, leftHand],
  );
  const finalBeat = !!(
    songPlaying &&
    !inCountIn &&
    !inIntro &&
    songSegment &&
    segBeat >= songSegment.beats - 1
  );
  const ghostNotes = useMemo(() => (finalBeat ? cardRequired : []), [finalBeat, cardRequired]);

  const upcomingSegments = useMemo(() => {
    if (!songPlaying || !currentSong) return [];
    // the next card covers one segment; chips start after it
    const start = inCountIn || inIntro ? 1 : segIndex + 2;
    const out = [];
    for (
      let i = start;
      i <= Math.min(start + UPCOMING_COUNT - 1, currentSong.segments.length - 1);
      i++
    ) {
      out.push(currentSong.segments[i]);
    }
    return out;
  }, [songPlaying, currentSong, segIndex, inCountIn, inIntro]);

  // Notes the player must sound: chord voicing + optional left-hand bass
  const requiredNotes = useMemo(
    () => (leftHand ? [...chord.voicing, chord.bass] : chord.voicing),
    [chord, leftHand],
  );
  const displayRequired = useMemo(
    () => (leftHand ? [...displayChord.voicing, displayChord.bass] : displayChord.voicing),
    [displayChord, leftHand],
  );

  const satisfied = useMemo(
    () =>
      chordSatisfied(
        chord,
        requiredNotes,
        activeNotes,
        heardPitchClasses,
        allowExtra,
        anyOctave,
        leftHand,
      ),
    [chord, requiredNotes, heardPitchClasses, activeNotes, allowExtra, anyOctave, leftHand],
  );

  // Refs so the intervals always see fresh values without re-subscribing
  const satisfiedRef = useRef(satisfied);
  satisfiedRef.current = satisfied;
  const requiredRef = useRef(displayRequired);
  requiredRef.current = displayRequired;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const holdSinceRef = useRef<number | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const activeNotesRef = useRef(activeNotes);
  activeNotesRef.current = activeNotes;
  const heardPcsRef = useRef(heardPitchClasses);
  heardPcsRef.current = heardPitchClasses;
  const allowExtraRef = useRef(allowExtra);
  allowExtraRef.current = allowExtra;
  const anyOctaveRef = useRef(anyOctave);
  anyOctaveRef.current = anyOctave;
  const leftHandRef = useRef(leftHand);
  leftHandRef.current = leftHand;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const songChordsRef = useRef(songChords);
  songChordsRef.current = songChords;
  const songClickRef = useRef(songClick);
  songClickRef.current = songClick;
  const currentSongRef = useRef(currentSong);
  currentSongRef.current = currentSong;

  const clearSongTimers = () => {
    if (songTimerRef.current !== null) {
      window.clearInterval(songTimerRef.current);
      songTimerRef.current = null;
    }
    if (countInTimerRef.current !== null) {
      window.clearInterval(countInTimerRef.current);
      countInTimerRef.current = null;
    }
  };

  // Practice hold-time check loop (created once; practice mode only)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (modeRef.current !== 'practice') return;
      if (phaseRef.current === 'success') return;
      if (satisfiedRef.current) {
        const t = Date.now();
        if (holdSinceRef.current === null) {
          holdSinceRef.current = t;
          setPhase('holding');
        } else if (t - holdSinceRef.current >= HOLD_MS) {
          holdSinceRef.current = null;
          setPhase('success');
          playConfirm();
          playChord(requiredRef.current);
          window.setTimeout(() => {
            setCompleted((c) => c + 1);
            setIndex((i) => i + 1);
            setPhase('waiting');
          }, SUCCESS_MS);
        }
      } else if (holdSinceRef.current !== null) {
        holdSinceRef.current = null;
        setPhase('waiting');
      }
    }, 50);
    return () => window.clearInterval(id);
  }, []);

  // Reshuffle the deck when we run off the end
  useEffect(() => {
    if (index >= deck.length) {
      setDeck(freshDeck(poolChords, deck[deck.length - 1]?.symbol));
      setIndex(0);
    }
  }, [index, deck, poolChords]);

  const applyChordPool = (
    next: Set<string>,
    nextAllowExtra: boolean,
    nextAnyOctave: boolean,
    nextLeftHand: boolean,
  ) => {
    setEnabledSymbols(next);
    setAllowExtra(nextAllowExtra);
    setAnyOctave(nextAnyOctave);
    setLeftHand(nextLeftHand);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      localStorage.setItem(EXTRA_KEY, nextAllowExtra ? '1' : '0');
      localStorage.setItem(OCTAVE_KEY, nextAnyOctave ? '1' : '0');
      localStorage.setItem(LEFT_KEY, nextLeftHand ? '1' : '0');
    } catch {
      // storage unavailable
    }
    const pool = ALL_CHORDS.filter((c) => next.has(c.symbol));
    setDeck(freshDeck(pool, chord.symbol));
    setIndex(0);
    setPhase('waiting');
    holdSinceRef.current = null;
    setSettingsOpen(false);
  };

  // Mic toggle
  const toggleMic = async () => {
    if (micOn) {
      detectorRef.current?.stop();
      detectorRef.current = null;
      setMicOn(false);
      setMicNotes([]);
      return;
    }
    setMicError(null);
    try {
      if (!detectorRef.current) detectorRef.current = new PitchDetector();
      await detectorRef.current.start(setMicNotes);
      setMicOn(true);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Microphone access denied');
    }
  };

  // Welcome animation: Knight-Rider style — a single light sweeps
  // left to right and back across the keyboard, then settles on the chord.
  const runWelcome = () => {
    const lights = lightsRef.current;
    if (!lights) return;
    const id = ++welcomeIdRef.current;
    const steps: { notes: number[]; at: number }[] = [];
    let t = 0;
    for (let m = 36; m <= 79; m++) {
      steps.push({ notes: [m], at: t });
      t += 45;
    }
    for (let m = 78; m >= 37; m--) {
      steps.push({ notes: [m], at: t });
      t += 45;
    }
    steps.push({ notes: requiredRef.current, at: t + 80 });
    for (const st of steps) {
      window.setTimeout(() => {
        if (welcomeIdRef.current === id) lights.setNotes(st.notes);
      }, st.at);
    }
  };

  // Drive the Clavinova's key LEDs with the displayed chord; the next chord's
  // keys flash during the final beat of a song segment.
  const listeningKey = midi.listeningTo.join(',');
  const outputsKey = midi.outputs.map((o) => o.id).join(',');
  useEffect(() => {
    if (!keyLightsOn || !midi.connected || !midi.sysex) {
      welcomeIdRef.current++;
      lightsActiveRef.current = false;
      lightsRef.current?.disable();
      return;
    }
    if (!lightsRef.current) lightsRef.current = new KeyLights(midi.send);
    if (!lightsRef.current.enable()) return; // no output yet; retry on statechange
    if (!lightsActiveRef.current) {
      lightsActiveRef.current = true;
      runWelcome();
    } else {
      lightsRef.current.setLights(displayRequired, ghostNotes);
    }
  }, [keyLightsOn, midi.connected, midi.sysex, midi.send, displayRequired, ghostNotes, listeningKey, outputsKey]);

  useEffect(() => {
    return () => {
      welcomeIdRef.current++;
      detectorRef.current?.stop();
      lightsRef.current?.disable();
      clearSongTimers();
      destroyYtPlayer();
    };
  }, []);

  const toggleKeyLights = () => {
    setKeyLightsOn((v) => {
      const next = !v;
      try {
        localStorage.setItem(LIGHTS_KEY, next ? '1' : '0');
      } catch {
        // storage unavailable
      }
      return next;
    });
  };

  // ---- Song playback ----

  const destroyYtPlayer = () => {
    ytPlayerRef.current?.destroy();
    ytPlayerRef.current = null;
  };

  const stopPlayback = (backToList = true) => {
    clearSongTimers();
    destroyYtPlayer();
    setYtVideoId(null);
    setYtNeedsPlay(false);
    setIntroSec(0);
    setSegBeat(0);
    chartBeatRef.current = () => -Infinity;
    hitSegsRef.current = new Set();
    setPlayState('idle');
    setSegHit(false);
    setProgress(0);
    setSegIndex(0);
    setCountInBeat(0);
    if (backToList) setCurrentSong(null);
  };

  const saveSync = (songId: string, entry: SongSync | null) => {
    const hasDefault = allSongs.some((s) => s.id === songId && s.defaultSync);
    setStoredSync((prev) => {
      const next = { ...prev };
      if (entry || hasDefault) next[songId] = entry;
      else delete next[songId];
      try {
        localStorage.setItem(SONGSYNC_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  };

  // Adjust the live sync of the currently playing video song and persist it
  const updateLiveSync = (fn: (s: SongSync) => SongSync) => {
    const song = currentSongRef.current;
    const cur = playSyncRef.current;
    if (!song || !cur) return;
    const next = fn(cur);
    playSyncRef.current = next;
    saveSync(song.id, next);
  };

  /**
   * Run the chart. getChartMs() is the clock (wall time for synth mode, video
   * time minus offset for YouTube mode); getBeatMs() is re-read each tick so
   * BPM nudges apply immediately.
   */
  const beginSong = (
    song: Song,
    getChartMs: () => number,
    getBeatMs: () => number,
    opts: { video?: boolean } = {},
  ) => {
    // Segment boundaries in beats (converted to ms per tick)
    const startBeats: number[] = [];
    let accBeats = 0;
    for (const s of song.segments) {
      startBeats.push(accBeats);
      accBeats += s.beats;
    }
    const totalBeats = accBeats;
    let curSeg = -1;
    let lastBeat = -1;
    let holdMs = 0;
    const hitSegs = new Set<number>();
    hitSegsRef.current = hitSegs;

    setPlayState('playing');
    songTimerRef.current = window.setInterval(() => {
      const chartMs = getChartMs();
      const beatMs = getBeatMs();
      const total = totalBeats * beatMs;
      if (chartMs >= total) {
        clearSongTimers();
        ytPlayerRef.current?.pauseVideo();
        destroyYtPlayer();
        setYtVideoId(null);
        playConfirm();
        setProgress(1);
        setSegHit(false);
        setPlayState('done');
        return;
      }
      setProgress(Math.max(0, chartMs) / total);

      // Before the first chord (video intro): show the first chord and wait
      if (chartMs < 0) {
        setIntroSec(-chartMs / 1000);
        setSegBeat(0);
        if (curSeg !== 0) {
          curSeg = 0;
          holdMs = 0;
          setSegIndex(0);
          setSegHit(false);
        }
        return;
      }
      setIntroSec(0);

      const beat = chartMs / beatMs;
      let i = 0;
      while (i + 1 < startBeats.length && startBeats[i + 1] <= beat) i++;
      setSegBeat(beat - startBeats[i]);

      // metronome: one click per beat, accented on beat 1 of each 4/4 bar
      if (!opts.video) {
        const beatIdx = Math.floor(beat);
        if (beatIdx !== lastBeat) {
          lastBeat = beatIdx;
          if (songClickRef.current) playClick(beatIdx % 4 === 0);
        }
      }

      if (i !== curSeg) {
        curSeg = i;
        holdMs = 0;
        setSegIndex(i);
        setSegHit(false);
        if (!opts.video && songChordsRef.current) {
          const s = song.segments[i];
          const notes = leftHandRef.current
            ? [...s.chord.voicing, s.chord.bass]
            : s.chord.voicing;
          playChord(notes, Math.min((s.beats * beatMs) / 1000, 3));
        }
      }

      // scoring: chord held continuously for 300ms within its segment
      if (!hitSegs.has(i)) {
        const s = song.segments[i];
        const req = leftHandRef.current
          ? [...s.chord.voicing, s.chord.bass]
          : s.chord.voicing;
        if (
          chordSatisfied(
            s.chord,
            req,
            activeNotesRef.current,
            heardPcsRef.current,
            allowExtraRef.current,
            anyOctaveRef.current,
            leftHandRef.current,
          )
        ) {
          holdMs += 50;
          if (holdMs >= SONG_HOLD_MS) {
            hitSegs.add(i);
            setHits((h) => h + 1);
            setSegHit(true);
          }
        } else {
          holdMs = 0;
        }
      }
    }, 50);
  };

  const startSong = (song: Song, withVideo = false) => {
    const sync = withVideo ? songSync[song.id] : undefined;
    clearSongTimers();
    destroyYtPlayer();
    setVideoError(null);
    setCurrentSong(song);
    setSegIndex(0);
    setHits(0);
    setSegHit(false);
    setProgress(0);
    setIntroSec(0);
    setSegBeat(0);
    setYtNeedsPlay(false);
    hitSegsRef.current = new Set();
    chartBeatRef.current = () => -Infinity;
    lastPlayVideoRef.current = !!sync;

    if (sync) {
      // YouTube mode: no count-in, no synth — the video drives the clock.
      // The player is created by the effect below once its host div mounts.
      playSyncRef.current = { ...sync };
      videoClockRef.current = { vt: 0, pt: performance.now(), playing: false, rate: 1 };
      setYtRates([1]);
      setYtRate(1);
      setYtVideoId(sync.videoId);
      setPlayState('playing');
      return;
    }
    setYtVideoId(null);
    playSyncRef.current = null;

    const beatMs = 60000 / ((song.bpm * tempoRef.current) / 100);
    // Chart clock starts 4 count-in beats in the future: beat < 0 during the
    // count-in and hits 0 exactly on the first chord. The waterfall reads the
    // same clock via chartBeatRef so bars approach during the count-in.
    const t0 = performance.now() + COUNT_IN_BEATS * beatMs;
    chartBeatRef.current = () => (performance.now() - t0) / beatMs;
    setPlayState('countin');
    setCountInBeat(COUNT_IN_BEATS);
    playClick(false);
    let n = 0;
    countInTimerRef.current = window.setInterval(() => {
      n++;
      if (n < COUNT_IN_BEATS) {
        setCountInBeat(COUNT_IN_BEATS - n);
        playClick(n === COUNT_IN_BEATS - 1); // last count accented
      } else {
        if (countInTimerRef.current !== null) {
          window.clearInterval(countInTimerRef.current);
          countInTimerRef.current = null;
        }
        beginSong(song, () => performance.now() - t0, () => beatMs);
      }
    }, beatMs);
  };

  // Create the YouTube player once its host div is mounted and the API is ready
  useEffect(() => {
    if (!ytVideoId || playState !== 'playing' || !ytHostRef.current || ytPlayerRef.current) return;
    const videoId = ytVideoId;
    let cancelled = false;
    loadYouTubeApi()
      .then(() => {
        if (cancelled || !ytHostRef.current || ytPlayerRef.current) return;
        const song = currentSongRef.current;
        if (!song) return;
        // YT replaces its target with an iframe, so give it a non-React child
        const target = document.createElement('div');
        ytHostRef.current.replaceChildren(target);
        ytPlayerRef.current = new YT.Player(target, {
          videoId,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 1 },
          events: {
            onReady: (e) => {
              const rates = (e.target.getAvailablePlaybackRates() ?? []).filter((r) => r <= 1.25);
              setYtRates(rates.length ? rates : [1]);
              const vc = videoClockRef.current;
              vc.vt = e.target.getCurrentTime();
              vc.pt = performance.now();
              vc.playing = false;
              vc.rate = 1;
              e.target.playVideo();
              // Video clock: resync on getCurrentTime steps, extrapolate
              // between them while playing so the waterfall scrolls smoothly.
              const getChartMs = () => {
                const v = videoClockRef.current;
                const p = ytPlayerRef.current;
                if (p) {
                  const vt = p.getCurrentTime();
                  if (vt !== v.vt) {
                    v.vt = vt;
                    v.pt = performance.now();
                  }
                }
                const cur = v.playing
                  ? v.vt + ((performance.now() - v.pt) / 1000) * v.rate
                  : v.vt;
                return (cur - (playSyncRef.current?.offsetSec ?? 0)) * 1000;
              };
              const getBeatMs = () => 60000 / (playSyncRef.current?.bpm ?? song.bpm);
              chartBeatRef.current = () => getChartMs() / getBeatMs();
              beginSong(song, getChartMs, getBeatMs, { video: true });
            },
            onStateChange: (e) => {
              const vc = videoClockRef.current;
              vc.playing = e.data === YT.PlayerState.PLAYING;
              vc.vt = e.target.getCurrentTime();
              vc.pt = performance.now();
              setYtNeedsPlay(e.data === YT.PlayerState.UNSTARTED || e.data === YT.PlayerState.CUED);
            },
            onError: (e) => {
              stopPlayback();
              setVideoError(ytErrorMessage(e.data));
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          stopPlayback();
          setVideoError("Couldn't load YouTube (offline?)");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ytVideoId, playState]);

  const addCustomSong = (song: {
    title: string;
    artist?: string;
    bpm: number;
    text: string;
  }): string | null => {
    const parsed = parseSongText(song.text);
    if ('error' in parsed) return parsed.error;
    const stored: StoredSong = {
      id: `custom-${Date.now()}`,
      title: song.title,
      artist: song.artist,
      bpm: song.bpm,
      text: song.text,
    };
    const next = [...customSongs, { ...stored, segments: parsed.segments, custom: true }];
    setCustomSongs(next);
    try {
      const raw = localStorage.getItem(SONGS_KEY);
      const arr = raw ? (JSON.parse(raw) as StoredSong[]) : [];
      localStorage.setItem(SONGS_KEY, JSON.stringify([...arr, stored]));
    } catch {
      // storage unavailable
    }
    return null;
  };

  const deleteCustomSong = (id: string) => {
    setCustomSongs((prev) => prev.filter((s) => s.id !== id));
    saveSync(id, null);
    try {
      const raw = localStorage.getItem(SONGS_KEY);
      const arr = raw ? (JSON.parse(raw) as StoredSong[]) : [];
      localStorage.setItem(SONGS_KEY, JSON.stringify(arr.filter((s) => s.id !== id)));
    } catch {
      // storage unavailable
    }
  };

  const persistSetting = (key: string, v: string) => {
    try {
      localStorage.setItem(key, v);
    } catch {
      // storage unavailable
    }
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === 'practice') stopPlayback();
    setMode(next);
  };

  const upcoming = useMemo(() => {
    const out: Chord[] = [];
    for (let i = 1; i <= UPCOMING_COUNT; i++) {
      out.push(deck[(index + i) % deck.length]);
    }
    return out;
  }, [deck, index]);

  const inputStatus = midi.connected
    ? `MIDI: ${midi.listeningTo.join(', ') || 'no devices found'}`
    : micOn
      ? 'Microphone'
      : 'No input';

  const hasMidiDevice = midi.devices.length > 0 || midi.outputs.length > 0;

  const songEyebrow = () => {
    if (!currentSong) return '';
    if (playState === 'countin') return `Get ready… ${countInBeat}`;
    if (introSec > 0) return `Intro… first chord in ${introSec.toFixed(1)}s`;
    const section = sectionAt(currentSong, segIndex);
    return `${currentSong.title}${section ? ` — ${section}` : ''} · chord ${segIndex + 1}/${currentSong.segments.length}`;
  };

  const curSync = currentSong ? songSync[currentSong.id] : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-note">♪</span> ChordTrainer
        </div>
        <div className="controls">
          <div className="mode-toggle">
            <button
              className={mode === 'practice' ? 'on' : ''}
              onClick={() => switchMode('practice')}
            >
              Practice
            </button>
            <button
              className={mode === 'songs' ? 'on' : ''}
              onClick={() => switchMode('songs')}
            >
              Songs
            </button>
          </div>
          {!midi.connected ? (
            <button className="btn btn-primary" onClick={midi.connect} disabled={!midi.supported}>
              {midi.supported ? 'Connect MIDI (USB)' : 'MIDI not supported in this browser'}
            </button>
          ) : (
            <span className={`status-dot ${midi.listeningTo.length ? 'on' : 'off'}`}>
              {inputStatus}
            </span>
          )}
          <button
            className={`btn ${micOn ? 'btn-active' : ''}`}
            onClick={toggleMic}
            title="Use the microphone in addition to USB MIDI"
          >
            {micOn ? 'Mic: on' : 'Use microphone'}
          </button>
          {midi.connected && midi.sysex && (
            <button
              className={`btn ${keyLightsOn && hasMidiDevice ? 'btn-active' : ''}`}
              onClick={toggleKeyLights}
              disabled={!hasMidiDevice}
              title={
                hasMidiDevice
                  ? 'Light up the chord keys on the Clavinova\'s LEDs'
                  : 'No MIDI device connected'
              }
            >
              {keyLightsOn && hasMidiDevice ? '🔦 Lights: on' : '🔦 Lights: off'}
            </button>
          )}
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            ⚙ Chords ({enabledSymbols.size})
          </button>
        </div>
      </header>

      {(midi.error || micError) && <div className="error-banner">{midi.error || micError}</div>}

      <main className="stage">
        {mode === 'songs' && playState === 'idle' ? (
          <SongsPanel
            songs={allSongs}
            tempo={tempo}
            songChords={songChords}
            songClick={songClick}
            onTempo={(v) => {
              setTempo(v);
              persistSetting(TEMPO_KEY, String(v));
            }}
            onSongChords={(v) => {
              setSongChords(v);
              persistSetting(SONGCHORDS_KEY, v ? '1' : '0');
            }}
            onSongClick={(v) => {
              setSongClick(v);
              persistSetting(SONGCLICK_KEY, v ? '1' : '0');
            }}
            sync={songSync}
            videoError={videoError}
            onPlay={startSong}
            onPlayVideo={(song) => startSong(song, true)}
            onSaveSync={saveSync}
            onDelete={deleteCustomSong}
            onAdd={addCustomSong}
          />
        ) : mode === 'songs' && playState === 'done' && currentSong ? (
          <div className="chord-panel">
            <div className="chord-eyebrow">{currentSong.title} — finished!</div>
            <div className="song-result">
              <strong>
                {hits}/{currentSong.segments.length}
              </strong>{' '}
              chords · {Math.round((hits / currentSong.segments.length) * 100)}%
            </div>
            <div className="song-result-actions">
              <button
                className="btn btn-primary"
                onClick={() => startSong(currentSong, lastPlayVideoRef.current)}
              >
                Play again
              </button>
              <button className="btn" onClick={() => stopPlayback()}>
                Song list
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="chord-panel">
              <div className="chord-eyebrow">
                {songPlaying
                  ? songEyebrow()
                  : phase === 'success'
                    ? '✓ Correct!'
                    : 'Play this chord'}
              </div>
              <div className="chord-line">
                <div
                  className={`chord-name ${
                    songPlaying ? (segHit ? 'chord-success' : '') : phase === 'success' ? 'chord-success' : ''
                  }`}
                >
                  {displayChord.symbol}
                  <span className="chord-quality">{displayChord.quality}</span>
                </div>
                <div className="chord-notes">
                  {displayRequired.map((m) => (
                    <span key={m} className="chord-note">
                      {noteNameWithOctave(m)}
                    </span>
                  ))}
                </div>
              </div>
              {songPlaying ? (
                <div className="hold-bar">
                  <div className="hold-fill done" style={{ width: `${progress * 100}%` }} />
                </div>
              ) : (
                <div className="hold-bar">
                  <div
                    className={`hold-fill ${phase === 'holding' ? 'holding' : ''} ${phase === 'success' ? 'done' : ''}`}
                  />
                </div>
              )}
              <div className="up-next">
                {songPlaying
                  ? upcomingSegments.map((s, i) => (
                      <span key={`${s.chord.symbol}-${segIndex + 1 + i}`} className="up-next-chip">
                        {s.chord.symbol}
                        <em>{s.chord.quality === 'minor' ? 'm' : ''}</em>
                      </span>
                    ))
                  : upcoming.map((c, i) => (
                      <span key={`${c.symbol}-${i}`} className="up-next-chip">
                        {c.symbol}
                        <em>{c.quality === 'minor' ? 'm' : ''}</em>
                      </span>
                    ))}
              </div>
            </div>

            <div className={`play-area ${ytVideoId && songPlaying ? 'with-video' : ''}`}>
              <div className="play-main">
                {songPlaying && currentSong && (
                  <Waterfall
                    segments={currentSong.segments}
                    getBeat={() => chartBeatRef.current()}
                    hitSegsRef={hitSegsRef}
                    leftHand={leftHand}
                  />
                )}
                <Keyboard
                  targetNotes={displayRequired}
                  bassNotes={leftHand ? [displayChord.bass] : []}
                  chordPitchClasses={displayChord.pitchClasses}
                  pressedNotes={activeNotes}
                  heardPitchClasses={heardPitchClasses}
                  success={songPlaying ? segHit : phase === 'success'}
                  upcomingNotes={ghostNotes}
                />
              </div>
              {ytVideoId && songPlaying && (
                <div className="yt-box">
                  <div className="yt-player-wrap">
                    <div ref={ytHostRef} />
                  </div>
                  {ytNeedsPlay && <div className="yt-hint">Press play on the video</div>}
                  <div className="yt-controls">
                    <label className="yt-speed">
                      Speed
                      <select
                        value={ytRate}
                        onChange={(e) => {
                          const r = Number(e.target.value);
                          setYtRate(r);
                          ytPlayerRef.current?.setPlaybackRate(r);
                          const vc = videoClockRef.current;
                          vc.vt = ytPlayerRef.current?.getCurrentTime() ?? vc.vt;
                          vc.pt = performance.now();
                          vc.rate = r;
                        }}
                      >
                        {ytRates.map((r) => (
                          <option key={r} value={r}>
                            {r}×
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="btn yt-btn"
                      onClick={() =>
                        updateLiveSync((s) => ({
                          ...s,
                          offsetSec: ytPlayerRef.current?.getCurrentTime() ?? s.offsetSec,
                        }))
                      }
                    >
                      Tap: first chord now
                    </button>
                    <button
                      className="btn yt-btn"
                      onClick={() => updateLiveSync((s) => ({ ...s, offsetSec: s.offsetSec - 0.1 }))}
                    >
                      −0.1s
                    </button>
                    <button
                      className="btn yt-btn"
                      onClick={() => updateLiveSync((s) => ({ ...s, offsetSec: s.offsetSec + 0.1 }))}
                    >
                      +0.1s
                    </button>
                    <button
                      className="btn yt-btn"
                      onClick={() =>
                        updateLiveSync((s) => ({ ...s, bpm: Math.max(30, s.bpm - 0.5) }))
                      }
                    >
                      BPM −0.5
                    </button>
                    <button
                      className="btn yt-btn"
                      onClick={() =>
                        updateLiveSync((s) => ({ ...s, bpm: Math.min(300, s.bpm + 0.5) }))
                      }
                    >
                      BPM +0.5
                    </button>
                    {curSync && (
                      <span className="yt-values">
                        offset {curSync.offsetSec.toFixed(1)}s · {curSync.bpm} BPM
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <footer className="stats">
          {songPlaying ? (
            <>
              <span>
                Score: <strong>{hits}/{currentSong.segments.length}</strong>
              </span>
              <button className="btn" onClick={() => stopPlayback()}>
                ■ Stop
              </button>
            </>
          ) : (
            mode === 'practice' && (
              <>
                <span>
                  Completed: <strong>{completed}</strong>
                </span>
                <span>
                  Deck: <strong>{Math.min(index + 1, deck.length)}/{deck.length}</strong>
                </span>
              </>
            )
          )}
          <span className="hint">
            v{APP_VERSION} · MIT License · © 2026{' '}
            <a
              href="https://github.com/michburkhalter/ChordTrainer"
              target="_blank"
              rel="noopener noreferrer"
            >
              MichBurkhalter
            </a>
          </span>
          <span className="hint">
            {mode === 'songs'
              ? 'Song mode · chords advance automatically · play each one to score'
              : midi.connected || micOn
                ? `${anyOctave ? 'Chord tones in any octave' : 'Exact keys shown'} · ${allowExtra ? 'extra notes OK' : 'no extra notes'}${leftHand ? ' · LH bass' : ''} · hold 0.5s`
                : 'Connect your Clavinova via USB, or allow the microphone'}
          </span>
        </footer>
      </main>

      <SettingsPanel
        open={settingsOpen}
        enabled={enabledSymbols}
        allowExtra={allowExtra}
        anyOctave={anyOctave}
        leftHand={leftHand}
        onApply={applyChordPool}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
