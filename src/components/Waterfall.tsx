import { useEffect, useMemo, useRef } from 'react';
import type { SongSegment } from '../lib/songs';
import { keyLayout, KEYBOARD_W } from '../lib/keyLayout';

interface Props {
  segments: SongSegment[];
  /** Live chart position in beats (may be negative during count-in/intro) */
  getBeat: () => number;
  /** Segments already scored (read each frame) */
  hitSegsRef: React.RefObject<ReadonlySet<number>>;
  leftHand: boolean;
}

const LOOKAHEAD_BEATS = 8;
const GAP = 3; // px between consecutive segment bars

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export default function Waterfall({ segments, getBeat, hitSegsRef, leftHand }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ cssW: 0, cssH: 0 });
  const propsRef = useRef({ segments, getBeat, hitSegsRef, leftHand });
  propsRef.current = { segments, getBeat, hitSegsRef, leftHand };

  const keys = useMemo(keyLayout, []);
  const keyByMidi = useMemo(() => {
    const m = new Map<number, (typeof keys)[number]>();
    for (const k of keys) m.set(k.midi, k);
    return m;
  }, [keys]);

  const startBeats = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (const s of segments) {
      out.push(acc);
      acc += s.beats;
    }
    return out;
  }, [segments]);

  const startBeatsRef = useRef(startBeats);
  startBeatsRef.current = startBeats;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = window.devicePixelRatio || 1;

    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      sizeRef.current = { cssW: rect.width, cssH: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    });
    ro.observe(canvas);

    let raf = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const { cssW, cssH } = sizeRef.current;
      if (cssW <= 0 || cssH <= 0) return;
      const { segments: segs, getBeat: gb, hitSegsRef: hits, leftHand: lh } = propsRef.current;
      const now = gb();
      const sb = startBeatsRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      if (!Number.isFinite(now)) {
        // clock not running yet (e.g. YouTube still loading)
        ctx.fillStyle = 'rgba(238,240,255,0.85)';
        ctx.fillRect(0, cssH - 2, cssW, 2);
        return;
      }
      const sx = cssW / KEYBOARD_W;
      const pxPerBeat = cssH / LOOKAHEAD_BEATS;
      const y = (b: number) => cssH - (b - now) * pxPerBeat;

      // beat grid lines
      ctx.lineWidth = 1;
      const firstLine = Math.ceil(now);
      for (let b = firstLine; b <= now + LOOKAHEAD_BEATS; b++) {
        const yy = y(b);
        if (yy < 0) break;
        ctx.strokeStyle = b % 4 === 0 ? 'rgba(139,144,179,0.28)' : 'rgba(139,144,179,0.1)';
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(cssW, yy);
        ctx.stroke();
      }

      // bars
      const pulse = reduced ? 0.5 : (Math.sin(t / 220) + 1) / 2;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const start = sb[i];
        const end = start + s.beats;
        if (end <= now - 1) continue; // fully scrolled below the now-line
        if (start >= now + LOOKAHEAD_BEATS) break; // above the strip
        const top = Math.max(-4, y(end) + GAP / 2);
        const bottom = Math.min(cssH + 4, y(start) - GAP / 2);
        if (bottom <= top) continue;

        const hit = hits.current.has(i);
        const current = start <= now && now < end;
        const past = end <= now;

        let fill: string;
        let fillBass: string;
        if (hit) {
          fill = 'rgba(46,204,113,0.75)';
          fillBass = 'rgba(46,204,113,0.6)';
        } else if (past) {
          fill = 'rgba(108,123,255,0.16)';
          fillBass = 'rgba(245,158,11,0.14)';
        } else if (current) {
          fill = `rgba(108,123,255,${0.75 + pulse * 0.25})`;
          fillBass = `rgba(245,158,11,${0.7 + pulse * 0.3})`;
        } else {
          fill = 'rgba(108,123,255,0.45)';
          fillBass = 'rgba(245,158,11,0.45)';
        }

        const notes = lh ? [...s.chord.voicing, s.chord.bass] : s.chord.voicing;
        const glow = current && !reduced;
        if (glow) {
          ctx.shadowColor = 'rgba(157,107,255,0.9)';
          ctx.shadowBlur = 10 + pulse * 8;
        }
        let labelX = Infinity;
        for (let n = 0; n < notes.length; n++) {
          const k = keyByMidi.get(notes[n]);
          if (!k) continue;
          const isBass = lh && n === notes.length - 1;
          const x = k.x * sx + (k.black ? 0 : 1);
          const w = k.w * sx - (k.black ? 0 : 2);
          ctx.fillStyle = isBass ? fillBass : fill;
          roundRect(ctx, x, top, w, bottom - top, 3);
          ctx.fill();
          if (!isBass) labelX = Math.min(labelX, x);
        }
        ctx.shadowBlur = 0;

        // chord label inside the bottom of the leftmost RH bar
        if (labelX < Infinity && bottom - top >= 16 && bottom > 0 && top < cssH) {
          const labelY = Math.min(bottom - 5, cssH - 4);
          ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
          ctx.fillStyle = past && !hit ? 'rgba(238,240,255,0.35)' : 'rgba(255,255,255,0.9)';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(s.chord.symbol, labelX + 4, labelY);
        }
      }

      // now-line
      ctx.fillStyle = 'rgba(238,240,255,0.85)';
      ctx.fillRect(0, cssH - 2, cssW, 2);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [keyByMidi]);

  return <canvas ref={canvasRef} className="waterfall" aria-hidden="true" />;
}
