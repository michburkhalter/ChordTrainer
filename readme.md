# ChordTrainer

A piano chord trainer web app. It shows a chord (all 24 major/minor triads, shuffled),
you play it on your keyboard, and when the chord tones are held for 0.5s the next
chord appears. Simply Piano-style interface, with optional control of the
Clavinova's Stream Lights.

**Try it online: https://michburkhalter.github.io/ChordTrainer/**

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in **Chrome or Edge** (required for Web MIDI).
The app also works as an installable PWA (manifest + service worker in `public/`).

## Connecting your Clavinova CSP-150

1. Connect the CSP-150 to your computer with a **USB cable** (the `USB COMPUTER`
   port on the back of the piano — the same cable used for MIDI file transfer).
2. On the piano, press **[FUNCTION] → USB MIDI → MIDI IN/OUT** and make sure
   "MIDI IN/OUT" (or "Keyboard") is selected so key presses are transmitted.
3. The app **auto-connects on page load** — accept the browser's MIDI permission
   prompt if it appears. You can also click **Connect MIDI (USB)** to retry.
   Devices plugged in later are picked up automatically.
4. The status pill should show your device name. Play the highlighted chord.

All chord tones must be held for ~0.5 s to advance.

## Settings (⚙ Chords)

- **Chord selection** — enable/disable any of the 24 chords, with presets
  (All, None, Majors, Minors, Open chords). Persisted across reloads.
- **Matching rules** (also persisted):

| any octave | extra notes | left hand | result |
|---|---|---|---|
| on | on | off | chord tones anywhere, anything else ignored (easiest) |
| on | off | off | chord tones anywhere, but nothing outside the chord |
| off | on | off | exact keys required, other notes tolerated |
| off | off | off | exactly the shown keys, nothing else (strictest) |

With **Left hand (bass note)** enabled, the chord root one octave below the
voicing must also be played (shown in amber on the keyboard).

## Key lights (CSP Stream Lights)

When connected over USB with SysEx permitted, the app can light the chord's keys
on the piano's own LEDs via Yamaha's "MIDI Key LED Mode" (`src/lib/keylights.ts`).
Toggle it with the **🔦 Lights** button; the setting is remembered across reloads.
When the link comes up, a Knight-Rider-style sweep plays across the keyboard
once, then the target chord's keys stay lit.

Note: this uses the documented Clavinova LED protocol; if the CSP-150 doesn't
respond, the lights simply stay dark — everything else keeps working.

## Microphone fallback

Click **Use microphone** and allow access. The app detects pitch classes from
the audio with an FFT harmonic-sum analysis. It works, but is less accurate than
MIDI — prefer USB when possible. (This is also the only option on Android
tablets, where browsers don't expose Web MIDI.)

## Songs mode

Switch to **Songs** in the top bar to play along with a song library — including
*I Can See Clearly Now* (Jimmy Cliff), *Let It Be*, *Stand By Me* and
*A Horse with No Name*. Pick a song, get a 4-beat count-in, then play each chord
as it comes up; chords advance automatically and you score a point for every
chord held in time. A falling-notes strip above the keyboard shows what's
coming: each bar sits over the key to press, its length is how long the chord
lasts, and it turns green once you hit it — play the notes as they reach the
line. In the final beat the next chord's keys also ghost on the keyboard and
flash on the Clavinova's Stream Lights when enabled.

- **Tempo slider** — 50–120 % of the song's original BPM.
- **Play chords (accompaniment)** — a synthesized chord guide plays each
  change; it is *not* the original recording.
- **Metronome click** — a tick per beat, accented on beat 1.
- **Your own song** — enter a name, BPM and a chord chart like
  `C G Am F` or with per-chord beats `C:2 G:2 Am:4 F:4`. Custom songs are
  saved in the browser.

### Play along with YouTube

Press **🔗** on any song to paste a YouTube link (or video ID). A
**▶ YouTube** button then plays the chart synced to a video shown beside the
falling-notes strip (above it on narrower screens) — the audio comes from YouTube itself, nothing is
downloaded, and the synth accompaniment/metronome are muted.

- **First chord at (s)** — where in the video the chart starts. Easiest:
  start playback and hit **Tap: first chord now** right on the first chord,
  then fine-tune with the −0.1/+0.1 s buttons.
- **BPM** — adjust with the −0.5/+0.5 buttons until the chart lines up.
  Sync settings are saved per song.
- **Speed** — slows the video (0.5×–1.25×) for practicing; the chart follows
  automatically. Pausing or seeking the video re-syncs instantly.
- Some videos disallow embedding — if one fails, the app tells you; just
  link a different upload of the song.

## Deployment

GitHub Pages serves the `docs/` folder on `master` (`vite.config.ts` sets
`base: '/ChordTrainer/'` and `build.outDir: 'docs'`). Run `npm run build` and
commit `docs/` to publish.

## Stack

- Vite + React + TypeScript
- Web MIDI API (`src/lib/midi.ts`)
- CSP Stream Lights / SysEx control (`src/lib/keylights.ts`)
- FFT pitch-class detection (`src/lib/mic.ts`)
- Web Audio chord playback on success (`src/lib/sound.ts`)

MIT License — © 2026 MichBurkhalter. v1.0.0
