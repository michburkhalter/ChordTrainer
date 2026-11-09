/**
 * Polyphonic pitch-class detection from a microphone using an FFT chromagram.
 *
 * For every MIDI note we sum the spectral energy at its first few harmonics.
 * Notes whose score is high relative to the loudest note (and well above the
 * noise floor) are reported as "active". This tolerates chords because it does
 * not try to find a single f0 — it just asks which notes have harmonic energy.
 */

const FFT_SIZE = 4096;
const MIN_MIDI = 24;
const MAX_MIDI = 108;
const FRAME_MS = 90;
const DECAY = 0.86; // per-frame release for the smoothed note levels
const RELATIVE_THRESHOLD = 0.16; // active if >= this fraction of the max score
const NOISE_MULTIPLIER = 6; // ...and >= this multiple of the estimated noise floor

// Harmonic weights (1st harmonic strongest)
const HARMONICS = [
  { h: 1, w: 1.0 },
  { h: 2, w: 0.55 },
  { h: 3, w: 0.35 },
  { h: 4, w: 0.2 },
  { h: 5, w: 0.12 },
];

const midiFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class PitchDetector {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private spectrum: Float32Array<ArrayBuffer> | null = null;
  private levels = new Float32Array(128);
  private noiseFloor = 0;
  private timer: number | null = null;
  private onNotes: ((notes: number[]) => void) | null = null;

  async start(onNotes: (notes: number[]) => void): Promise<void> {
    if (this.ctx) {
      this.onNotes = onNotes;
      return;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.onNotes = onNotes;
    this.timer = window.setInterval(() => this.tick(), FRAME_MS);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.onNotes = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.levels.fill(0);
    this.noiseFloor = 0;
  }

  get running() {
    return this.ctx !== null;
  }

  private binMagnitude(freq: number): number {
    if (!this.analyser || !this.spectrum) return 0;
    const bin = (freq * FFT_SIZE) / this.ctx!.sampleRate;
    const i0 = Math.max(0, Math.floor(bin) - 1);
    const i1 = Math.min(this.spectrum.length - 1, Math.ceil(bin) + 1);
    let best = 0;
    for (let i = i0; i <= i1; i++) {
      const db = this.spectrum[i];
      const mag = db > -100 ? Math.pow(10, db / 20) : 0;
      if (mag > best) best = mag;
    }
    return best;
  }

  private tick() {
    if (!this.analyser || !this.spectrum || !this.onNotes) return;
    this.analyser.getFloatFrequencyData(this.spectrum);

    const nyquist = this.ctx!.sampleRate / 2;
    const scores = new Float32Array(128);

    for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
      const f0 = midiFreq(m);
      let score = 0;
      for (const { h, w } of HARMONICS) {
        const f = f0 * h;
        if (f > nyquist) break;
        score += this.binMagnitude(f) * w;
      }
      scores[m] = score;
    }

    // Smooth: fast attack, exponential release
    let maxScore = 0;
    for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
      const s = Math.max(scores[m], this.levels[m] * DECAY);
      this.levels[m] = s;
      if (s > maxScore) maxScore = s;
    }

    // Estimate the noise floor as an EMA of the median score
    const sorted = Array.from(this.levels.subarray(MIN_MIDI, MAX_MIDI + 1)).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.noiseFloor = this.noiseFloor === 0 ? median : this.noiseFloor * 0.98 + median * 0.02;

    const absFloor = this.noiseFloor * NOISE_MULTIPLIER;
    const relFloor = maxScore * RELATIVE_THRESHOLD;
    const threshold = Math.max(absFloor, relFloor, 1e-7);

    const active: number[] = [];
    for (let m = MIN_MIDI; m <= MAX_MIDI; m++) {
      if (this.levels[m] >= threshold) active.push(m);
    }
    this.onNotes(active);
  }
}
