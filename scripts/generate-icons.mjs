// Renders the Owenil app icon to PNG (192, 512, 1024) with no native deps:
// a tiny rasteriser (4×4 supersampling) + a minimal PNG encoder using zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.cwd();

const stops = [[0, [0x34, 0xd3, 0x99]], [0.55, [0x14, 0xb8, 0xa6]], [1, [0x0e, 0xa5, 0xe9]]];
const grad = (t) => {
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    const [t0, c0] = stops[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return c0.map((c, j) => c + (c1[j] - c) * k);
    }
  }
  return stops[stops.length - 1][1];
};
function sample(x, y, rounded) {
  // Coordinates in the 64×64 design space.
  const r = 16;
  const inRect = (() => {
    if (!rounded) return x >= 0 && x <= 64 && y >= 0 && y <= 64;
    const cx = Math.min(Math.max(x, r), 64 - r);
    const cy = Math.min(Math.max(y, r), 64 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && x <= 64 && y >= 0 && y <= 64;
  })();
  if (!inRect) return [0, 0, 0, 0];
  let [rr, gg, bb] = grad(Math.min(1, Math.max(0, (x + y) / 128)));
  const left = x <= 30 && (x - 30) ** 2 + (y - 30) ** 2 <= 18 * 18;
  const right = x >= 34 && (x - 34) ** 2 + (y - 34) ** 2 <= 18 * 18;
  const a = left ? 1 : right ? 0.72 : 0;
  rr += (255 - rr) * a; gg += (255 - gg) * a; bb += (255 - bb) * a;
  return [rr, gg, bb, 255];
}
function render(size, rounded) {
  const ss = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const s = sample(((px + (sx + 0.5) / ss) / size) * 64, ((py + (sy + 0.5) / ss) / size) * 64, rounded);
        acc[0] += s[0] * s[3]; acc[1] += s[1] * s[3]; acc[2] += s[2] * s[3]; acc[3] += s[3];
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const alpha = acc[3] / (ss * ss);
      raw[o] = alpha ? Math.round(acc[0] / acc[3]) : 0;
      raw[o + 1] = alpha ? Math.round(acc[1] / acc[3]) : 0;
      raw[o + 2] = alpha ? Math.round(acc[2] / acc[3]) : 0;
      raw[o + 3] = Math.round(alpha);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const out = join(ROOT, 'public');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'owenil-icon-192.png'), render(192, true));
writeFileSync(join(out, 'owenil-icon-512.png'), render(512, false)); // full-bleed for maskable
mkdirSync(join(ROOT, 'docs', 'brand'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'brand', 'owenil-icon-1024.png'), render(1024, false));
console.log('Icons written to public/ and docs/brand/');
