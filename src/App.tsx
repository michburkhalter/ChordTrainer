import { useEffect, useMemo, useRef, useState } from 'react';
import Keyboard from './components/Keyboard';
import { ALL_CHORDS, NOTE_NAMES, shuffle, midiToPitchClass, type Chord } from './lib/theory';
import { useMidiInput } from './lib/midi';
import { PitchDetector } from './lib/mic';
import { playChord, playConfirm } from './lib/sound';

const HOLD_MS = 500;
const SUCCESS_MS = 900;
const UPCOMING_COUNT = 4;

function freshDeck(avoid?: string): Chord[] {
  const deck = shuffle(ALL_CHORDS);
  if (avoid && deck[0].symbol === avoid && deck.length > 1) {
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

  const [deck, setDeck] = useState<Chord[]>(() => freshDeck());
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

  const satisfied = useMemo(
    () => chord.pitchClasses.every((pc) => heardPitchClasses.has(pc)),
    [chord, heardPitchClasses],
  );

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
      setDeck(freshDeck(deck[deck.length - 1]?.symbol));
      setIndex(0);
    }
  }, [index, deck]);

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

  useEffect(() => {
    return () => detectorRef.current?.stop();
  }, []);

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
              ? 'Chord tones in any octave · extra notes OK · hold 0.5s'
              : 'Connect your Clavinova via USB, or allow the microphone'}
          </span>
        </footer>
      </main>
    </div>
  );
}
