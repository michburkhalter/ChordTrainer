import { useEffect, useMemo, useRef, useState } from 'react';
import Keyboard from './components/Keyboard';
import SettingsPanel from './components/SettingsPanel';
import { ALL_CHORDS, NOTE_NAMES, shuffle, midiToPitchClass, type Chord } from './lib/theory';
import { useMidiInput } from './lib/midi';
import { PitchDetector } from './lib/mic';
import { KeyLights } from './lib/keylights';
import { playChord, playConfirm } from './lib/sound';

const HOLD_MS = 500;
const SUCCESS_MS = 900;
const UPCOMING_COUNT = 4;
const STORAGE_KEY = 'chordtrainer.enabledChords';
const LIGHTS_KEY = 'chordtrainer.keylights';
const EXTRA_KEY = 'chordtrainer.allowExtra';
const OCTAVE_KEY = 'chordtrainer.anyOctave';

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
  const lightsRef = useRef<KeyLights | null>(null);
  const poolChords = useMemo(
    () => ALL_CHORDS.filter((c) => enabledSymbols.has(c.symbol)),
    [enabledSymbols],
  );
  const [deck, setDeck] = useState<Chord[]>(() => freshDeck(poolChords));
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [phase, setPhase] = useState<'waiting' | 'holding' | 'success'>('waiting');

  const chord = deck[index % deck.length];

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

  const satisfied = useMemo(() => {
    if (anyOctave) {
      if (!chord.pitchClasses.every((pc) => heardPitchClasses.has(pc))) return false;
      if (!allowExtra) {
        // strict: every sounding pitch class must belong to the chord
        for (const pc of heardPitchClasses) {
          if (!chord.pitchClasses.includes(pc)) return false;
        }
      }
      return true;
    }
    // exact keys: every note of the displayed voicing must be held
    const held = new Set(activeNotes);
    if (!chord.voicing.every((m) => held.has(m))) return false;
    if (!allowExtra) {
      const allowed = new Set(chord.voicing);
      for (const m of activeNotes) {
        if (!allowed.has(m)) return false;
      }
    }
    return true;
  }, [chord, heardPitchClasses, activeNotes, allowExtra, anyOctave]);

  // Refs so the interval always sees fresh values without re-subscribing
  const satisfiedRef = useRef(satisfied);
  satisfiedRef.current = satisfied;
  const chordRef = useRef(chord);
  chordRef.current = chord;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const holdSinceRef = useRef<number | null>(null);

  // Hold-time check loop (created once)
  useEffect(() => {
    const id = window.setInterval(() => {
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
          playChord(chordRef.current.voicing);
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

  const applyChordPool = (next: Set<string>, nextAllowExtra: boolean, nextAnyOctave: boolean) => {
    setEnabledSymbols(next);
    setAllowExtra(nextAllowExtra);
    setAnyOctave(nextAnyOctave);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      localStorage.setItem(EXTRA_KEY, nextAllowExtra ? '1' : '0');
      localStorage.setItem(OCTAVE_KEY, nextAnyOctave ? '1' : '0');
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

  // Drive the Clavinova's key LEDs with the target chord
  const listeningKey = midi.listeningTo.join(',');
  useEffect(() => {
    if (!keyLightsOn || !midi.connected || !midi.sysex) {
      lightsRef.current?.disable();
      return;
    }
    if (!lightsRef.current) lightsRef.current = new KeyLights(midi.send);
    lightsRef.current.enable();
    lightsRef.current.setNotes(chord.voicing);
  }, [keyLightsOn, midi.connected, midi.sysex, midi.send, chord, listeningKey]);

  useEffect(() => {
    return () => {
      detectorRef.current?.stop();
      lightsRef.current?.disable();
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

  const upcoming = useMemo(() => {
    const out: Chord[] = [];
    for (let i = 1; i <= UPCOMING_COUNT; i++) {
      out.push(deck[(index + i) % deck.length]);
    }
    return out;
  }, [deck, index]);

  const inputStatus = midi.connected
    ? `MIDI: ${midi.listeningTo.join(', ') || 'connected'}`
    : micOn
      ? 'Microphone'
      : 'No input';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-note">♪</span> ChordTrainer
        </div>
        <div className="controls">
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
              className={`btn ${keyLightsOn ? 'btn-active' : ''}`}
              onClick={toggleKeyLights}
              title="Light up the chord keys on the Clavinova's LEDs"
            >
              {keyLightsOn ? '🔦 Lights: on' : '🔦 Lights: off'}
            </button>
          )}
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            ⚙ Chords ({enabledSymbols.size})
          </button>
        </div>
      </header>

      {(midi.error || micError) && <div className="error-banner">{midi.error || micError}</div>}

      <main className="stage">
        <div className="chord-panel">
          <div className="chord-eyebrow">
            {phase === 'success' ? '✓ Correct!' : 'Play this chord'}
          </div>
          <div className={`chord-name ${phase === 'success' ? 'chord-success' : ''}`}>
            {chord.symbol}
            <span className="chord-quality">{chord.quality}</span>
          </div>
          <div className="chord-notes">
            {chord.voicing.map((m) => (
              <span key={m} className="chord-note">
                {noteNameWithOctave(m)}
              </span>
            ))}
          </div>
          <div className="hold-bar">
            <div
              className={`hold-fill ${phase === 'holding' ? 'holding' : ''} ${phase === 'success' ? 'done' : ''}`}
            />
          </div>
          <div className="up-next">
            {upcoming.map((c, i) => (
              <span key={`${c.symbol}-${i}`} className="up-next-chip">
                {c.symbol}
                <em>{c.quality === 'minor' ? 'm' : ''}</em>
              </span>
            ))}
          </div>
        </div>

        <Keyboard
          targetNotes={chord.voicing}
          chordPitchClasses={chord.pitchClasses}
          pressedNotes={activeNotes}
          heardPitchClasses={heardPitchClasses}
          success={phase === 'success'}
        />

        <footer className="stats">
          <span>
            Completed: <strong>{completed}</strong>
          </span>
          <span>
            Deck: <strong>{Math.min(index + 1, deck.length)}/{deck.length}</strong>
          </span>
          <span className="hint">
            {midi.connected || micOn
              ? `${anyOctave ? 'Chord tones in any octave' : 'Exact keys shown'} · ${allowExtra ? 'extra notes OK' : 'no extra notes'} · hold 0.5s`
              : 'Connect your Clavinova via USB, or allow the microphone'}
          </span>
        </footer>
      </main>

      <SettingsPanel
        open={settingsOpen}
        enabled={enabledSymbols}
        allowExtra={allowExtra}
        anyOctave={anyOctave}
        onApply={applyChordPool}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
