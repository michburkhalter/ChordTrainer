/**
 * Control the CSP-150/170 "Stream Lights" (the LEDs above each key) via the
 * documented Yamaha Clavinova "MIDI Key LED Mode" SysEx plus per-note
 * Note On messages whose velocity selects the LED state.
 *
 * Enable (per channel, notes don't sound):
 *   F0 43 73 01 11 <ch> 47 01 F7      ch = 0-based channel
 * Disable:
 *   F0 43 73 01 11 <ch> 47 00 F7
 *
 * With LED mode on, a Note On on that channel sets the key LED:
 *   velocity 0 -> off, 1 -> flash, >=2 -> on
 *
 * Stream Lights are also enabled globally via the CSP property command
 * (Set StreamLights = 1), matching the ConPianist/Smart Pianist protocol:
 *   F0 43 73 01 52 25 26 01 01 04 02 00 01 00 01 00 01 01 F7
 */

const CSP_PREFIX = [0x43, 0x73, 0x01];

const KEY_LED_ON = (ch: number) => [0xf0, ...CSP_PREFIX, 0x11, ch, 0x47, 0x01, 0xf7];
const KEY_LED_OFF = (ch: number) => [0xf0, ...CSP_PREFIX, 0x11, ch, 0x47, 0x00, 0xf7];

const STREAM_LIGHTS_ON = [
  0xf0, 0x43, 0x73, 0x01, 0x52, 0x25, 0x26,
  0x01, 0x01, 0x04, 0x02, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01,
  0xf7,
];

export class KeyLights {
  private lit = new Map<number, number>(); // note -> velocity (1 flash, 2 solid)
  private enabled = false;

  constructor(
    private send: (data: number[]) => boolean,
    private channel = 0, // MIDI channel 1
  ) {}

  /**
   * Send the enable messages (idempotent). Returns false when no MIDI output
   * is available yet, so callers can retry once a device is hot-plugged.
   */
  enable(): boolean {
    if (this.enabled) return true;
    const ok = this.send(KEY_LED_ON(this.channel)) && this.send(STREAM_LIGHTS_ON);
    this.enabled = ok;
    return ok;
  }

  /** Turn all lights off and leave LED mode. */
  disable() {
    if (!this.enabled) return;
    this.setNotes([]);
    this.send(KEY_LED_OFF(this.channel));
    this.enabled = false;
  }

  /**
   * Light exactly the given MIDI notes; all previously lit keys turn off.
   * vel=2 gives a solid LED, vel=1 a flashing one.
   */
  setNotes(notes: number[], flash = false) {
    this.setLights(flash ? [] : notes, flash ? notes : []);
  }

  /**
   * Light `solid` notes steadily and `flash` notes blinking (a note in both
   * stays solid). Only keys whose state actually changed get a MIDI message.
   */
  setLights(solid: number[], flash: number[] = []) {
    if (!this.enabled) return;
    const next = new Map<number, number>();
    for (const n of flash) next.set(n, 1);
    for (const n of solid) next.set(n, 2); // solid wins on overlap
    for (const [n] of this.lit) {
      if (!next.has(n)) this.send([0x90 | this.channel, n, 0]);
    }
    for (const [n, vel] of next) {
      if (this.lit.get(n) !== vel) this.send([0x90 | this.channel, n, vel]);
    }
    this.lit = next;
  }
}
