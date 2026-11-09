import { useMemo } from 'react';
import { KEYBOARD_HIGH, KEYBOARD_LOW, isBlackMidi, midiToName, midiToPitchClass } from '../lib/theory';

interface Props {
  /** MIDI notes of the target chord voicing */
  targetNotes: number[];
  /** MIDI notes played by the left hand (bass) — highlighted differently */
  bassNotes?: number[];
  /** Pitch classes of the chord (for matching pressed notes in any octave) */
  chordPitchClasses: number[];
  /** MIDI notes currently held down */
  pressedNotes: number[];
  /** Pitch classes currently heard (used to light up target keys) */
  heardPitchClasses: Set<number>;
  /** True briefly after a successful chord */
  success: boolean;
}

const W = 1000;
const WHITE_H = 190;
const BLACK_H = 118;
const BLACK_W = 58;

export default function Keyboard({
  targetNotes,
  bassNotes = [],
  chordPitchClasses,
  pressedNotes,
  heardPitchClasses,
  success,
}: Props) {
  const keys = useMemo(() => {
    const all: number[] = [];
    for (let m = KEYBOARD_LOW; m <= KEYBOARD_HIGH; m++) all.push(m);
    const whites = all.filter((m) => !isBlackMidi(m));
    const keyW = W / whites.length;

    const whiteIndex = new Map<number, number>();
    whites.forEach((m, i) => whiteIndex.set(m, i));

    return all.map((midi) => {
      const black = isBlackMidi(midi);
      let x: number;
      if (black) {
        // position between the surrounding white keys
        const prevWhite = midi - 1;
        const idx = whiteIndex.get(prevWhite) ?? 0;
        x = (idx + 1) * keyW - BLACK_W / 2;
      } else {
        x = (whiteIndex.get(midi) ?? 0) * keyW;
      }
      return { midi, x, black, w: black ? BLACK_W : keyW };
    });
  }, []);

  const targetSet = useMemo(() => new Set(targetNotes), [targetNotes]);
  const bassSet = useMemo(() => new Set(bassNotes), [bassNotes]);
  const pressedSet = useMemo(() => new Set(pressedNotes), [pressedNotes]);
  const chordPcSet = useMemo(() => new Set(chordPitchClasses), [chordPitchClasses]);

  return (
    <svg
      className="keyboard"
      viewBox={`0 0 ${W} ${WHITE_H + 26}`}
      role="img"
      aria-label="Piano keyboard"
    >
      {/* white keys */}
      {keys
        .filter((k) => !k.black)
        .map((k) => {
          const isTarget = targetSet.has(k.midi);
          const isPressed = pressedSet.has(k.midi);
          const pcHeard = heardPitchClasses.has(midiToPitchClass(k.midi));
          const cls = [
            'key',
            'key-white',
            isTarget ? 'key-target' : '',
            isTarget && bassSet.has(k.midi) ? 'key-bass' : '',
            isTarget && pcHeard ? 'key-target-heard' : '',
            isPressed ? (chordPcSet.has(midiToPitchClass(k.midi)) ? 'key-pressed-good' : 'key-pressed-other') : '',
            success && isTarget ? 'key-success' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <g key={k.midi}>
              <rect className={cls} x={k.x + 1} y={1} width={k.w - 2} height={WHITE_H - 2} rx={4} />
              {isTarget && (
                <text
                  className={`key-label ${pcHeard || success ? 'key-label-heard' : ''}`}
                  x={k.x + k.w / 2}
                  y={WHITE_H - 46}
                  textAnchor="middle"
                >
                  {midiToName(k.midi)}
                </text>
              )}
              {midiToPitchClass(k.midi) === 0 && (
                <text className="key-octave" x={k.x + k.w / 2} y={18} textAnchor="middle">
                  C{k.midi / 12 - 1}
                </text>
              )}
            </g>
          );
        })}

      {/* black keys */}
      {keys
        .filter((k) => k.black)
        .map((k) => {
          const isTarget = targetSet.has(k.midi);
          const isPressed = pressedSet.has(k.midi);
          const pcHeard = heardPitchClasses.has(midiToPitchClass(k.midi));
          const cls = [
            'key',
            'key-black',
            isTarget ? 'key-target' : '',
            isTarget && bassSet.has(k.midi) ? 'key-bass' : '',
            isTarget && pcHeard ? 'key-target-heard' : '',
            isPressed ? (chordPcSet.has(midiToPitchClass(k.midi)) ? 'key-pressed-good' : 'key-pressed-other') : '',
            success && isTarget ? 'key-success' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <g key={k.midi}>
              <rect className={cls} x={k.x} y={1} width={k.w} height={BLACK_H} rx={3} />
              {isTarget && (
                <text
                  className={`key-label key-label-black ${pcHeard || success ? 'key-label-heard' : ''}`}
                  x={k.x + k.w / 2}
                  y={BLACK_H - 14}
                  textAnchor="middle"
                >
                  {midiToName(k.midi)}
                </text>
              )}
            </g>
          );
        })}
    </svg>
  );
}
