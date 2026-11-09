// Generates PWA icons (PNG) for ChordTrainer.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// ---------- minimal PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, px) {
  // px: Uint8Array RGBA, size*size*4
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const ro = y * (1 + size * 4);
    raw[ro] = 0; // filter: none
    px.copy ? px.copy(raw, ro + 1, y * size * 4, (y + 1) * size * 4) : raw.set(px.subarray(y * size * 4, (y + 1) * size * 4), ro + 1);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- icon drawing (supersampled, then box-downsampled) ----------
const BG = [0x17, 0x1b, 0x2e]; // #171b2e
const NOTE = [0x9d, 0x6b, 0xff]; // #9d6bff
const SS = 3;

function render(size, { maskable = false } = {}) {
  const N = size * SS;
  const mask = new Uint8Array(N * N); // 1 = note shape
  const bgMask = new Uint8Array(N * N); // 1 = background shape
  const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const inPoly = (x, y, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  // layout fractions (of N); shrunk for maskable safe zone
  const s = maskable ? 0.82 : 1;
  const cx = N / 2;
  const cy = N / 2;
  const fx = (v) => cx + (v - 0.5) * N * s;
  const fy = (v) => cy + (v - 0.5) * N * s;

  const head = { cx: fx(0.40), cy: fy(0.68), rx: 0.10 * N * s, ry: 0.068 * N * s };
  const stem = { x0: fx(0.472), x1: fx(0.503), y0: fy(0.20), y1: fy(0.665) };
  const flag = [
    [fx(0.503), fy(0.20)],
    [fx(0.70), fy(0.27)],
    [fx(0.68), fy(0.335)],
    [fx(0.503), fy(0.385)],
  ];
  const radius = maskable ? 0 : 0.22 * N;

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      // background: rounded rect (or full bleed when maskable)
      let bg = true;
      if (radius > 0) {
        const qx = Math.min(x, N - 1 - x);
        const qy = Math.min(y, N - 1 - y);
        if (qx < radius && qy < radius) {
          const dx = radius - qx;
          const dy = radius - qy;
          bg = dx * dx + dy * dy <= radius * radius;
        } else {
          bg = qx >= 0 && qy >= 0;
        }
      }
      bgMask[i] = bg ? 1 : 0;

      if (
        inEllipse(x + 0.5, y + 0.5, head.cx, head.cy, head.rx, head.ry) ||
        (x + 0.5 >= stem.x0 && x + 0.5 <= stem.x1 && y + 0.5 >= stem.y0 && y + 0.5 <= stem.y1) ||
        inPoly(x + 0.5, y + 0.5, flag)
      ) {
        mask[i] = 1;
      }
    }
  }

  // downsample SS x SS -> size
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let noteCov = 0;
      let bgCov = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const si = (y * SS + dy) * N + (x * SS + dx);
          noteCov += mask[si];
          bgCov += bgMask[si];
        }
      }
      const o = (y * size + x) * 4;
      const n = noteCov / (SS * SS);
      const b = bgCov / (SS * SS);
      // note on top of bg; outside bg -> transparent
      const alpha = Math.max(n, b);
      px[o] = Math.round((NOTE[0] * n + BG[0] * (b - n)) / Math.max(b, 1e-6));
      px[o + 1] = Math.round((NOTE[1] * n + BG[1] * (b - n)) / Math.max(b, 1e-6));
      px[o + 2] = Math.round((NOTE[2] * n + BG[2] * (b - n)) / Math.max(b, 1e-6));
      px[o + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

for (const [size, opts, name] of [
  [192, {}, 'icon-192.png'],
  [512, {}, 'icon-512.png'],
  [512, { maskable: true }, 'icon-maskable-512.png'],
  [180, {}, 'apple-touch-icon.png'],
]) {
  const file = join(OUT, name);
  writeFileSync(file, encodePng(size, render(size, opts)));
  console.log('wrote', file);
}
