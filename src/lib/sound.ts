let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function midiFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Play a soft piano-ish chord (triangle + octave sine) for the given MIDI notes. */
export function playChord(midis: number[], duration = 1.6) {
  const ac = getCtx();
  const t = ac.currentTime;

  for (const midi of midis) {
    const freq = midiFreq(midi);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3500;

    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2;
    const g2 = ac.createGain();
    g2.gain.value = 0.25;

    osc.connect(gain);
    osc2.connect(g2).connect(gain);
    gain.connect(filter).connect(ac.destination);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + duration + 0.1);
    osc2.stop(t + duration + 0.1);
  }
}

/** Short confirmation blip when the hold completes. */
export function playConfirm() {
  const ac = getCtx();
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.08, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.3);
}
