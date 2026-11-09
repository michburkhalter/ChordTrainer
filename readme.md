# ChordTrainer

A piano chord trainer web app. It shows a chord (all 24 major/minor triads, shuffled),
you play it on your keyboard, and when the chord tones are held for 0.5s the next
chord appears.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in **Chrome or Edge** (required for Web MIDI).

## Connecting your Clavinova CSP-150

1. Connect the CSP-150 to your computer with a **USB cable** (the `USB COMPUTER`
   port on the back of the piano — the same cable used for MIDI file transfer).
2. On the piano, press **[FUNCTION] → USB MIDI → MIDI IN/OUT** and make sure
   "MIDI IN/OUT" (or "Keyboard") is selected so key presses are transmitted.
3. In the app, click **Connect MIDI (USB)**. Windows may ask you to allow the
   browser to use MIDI — accept.
4. The status pill should show your device name. Play the highlighted chord.

Chord tones count in **any octave and any inversion**; extra notes are allowed.
All chord tones must be held for ~0.5 s to advance.

## Microphone fallback

Click **Use microphone** and allow access. The app detects pitch classes from
the audio with an FFT harmonic-sum analysis. It works, but is less accurate than
MIDI — prefer USB when possible.

## Stack

- Vite + React + TypeScript
- Web MIDI API (`src/lib/midi.ts`)
- FFT pitch-class detection (`src/lib/mic.ts`)
- Web Audio chord playback on success (`src/lib/sound.ts`)
