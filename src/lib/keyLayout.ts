import { KEYBOARD_HIGH, KEYBOARD_LOW, isBlackMidi } from './theory';

/** Logical width of the keyboard SVG/canvas (height is set by the component). */
export const KEYBOARD_W = 1000;
export const WHITE_H = 190;
export const BLACK_H = 118;
export const BLACK_W = 58;

export interface KeyGeom {
  midi: number;
  x: number;
  black: boolean;
  w: number;
}

let cached: KeyGeom[] | null = null;

/** Shared key geometry so the keyboard and the falling-notes strip line up. */
export function keyLayout(): KeyGeom[] {
  if (cached) return cached;
  const all: number[] = [];
  for (let m = KEYBOARD_LOW; m <= KEYBOARD_HIGH; m++) all.push(m);
  const whites = all.filter((m) => !isBlackMidi(m));
  const keyW = KEYBOARD_W / whites.length;

  const whiteIndex = new Map<number, number>();
  whites.forEach((m, i) => whiteIndex.set(m, i));

  cached = all.map((midi) => {
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
  return cached;
}
