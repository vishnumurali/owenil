// Renders the Owenil app icon to PNG with no native deps: a tiny rasteriser
// (4×4 supersampling) + a minimal PNG encoder using zlib.
//   web:     public/owenil-icon-192.png, -512.png, docs/brand/owenil-icon-1024.png
//   android: launcher icons (legacy, round, adaptive layers) and splash screens
//   ios:     the app icon (1024×1024, opaque) and the launch-screen image
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.cwd();

// ---------- The design (64×64 units) -------------------------------------------
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
/** How much white the coin halves add at (x, y): 1 = left half, 0.72 = right half, 0 = none. */
function halves(x, y) {
  const left = x <= 30 && (x - 30) ** 2 + (y - 30) ** 2 <= 18 * 18;
  const right = x >= 34 && (x - 34) ** 2 + (y - 34) ** 2 <= 18 * 18;
  return left ? 1 : right ? 0.72 : 0;
}
function inShape(x, y, shape) {
  if (x < 0 || x > 64 || y < 0 || y > 64) return false;
  if (shape === 'square') return true;
  if (shape === 'circle') return (x - 32) ** 2 + (y - 32) ** 2 <= 32 * 32;
  const r = 16;
  const cx = Math.min(Math.max(x, r), 64 - r);
  const cy = Math.min(Math.max(y, r), 64 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
/** The full icon (gradient + halves) clipped to a shape. */
function icon(x, y, shape) {
  if (!inShape(x, y, shape)) return [0, 0, 0, 0];
  let [rr, gg, bb] = grad(Math.min(1, Math.max(0, (x + y) / 128)));
  const a = halves(x, y);
  rr += (255 - rr) * a; gg += (255 - gg) * a; bb += (255 - bb) * a;
  return [rr, gg, bb, 255];
}

// ---------- Raster + PNG ----------------------------------------------------------
/**
 * fn(px, py) → [r, g, b, a(0..255)] in pixel space (sub-pixel coordinates).
 * opaque: write RGB without an alpha channel (iOS app icons must not have one).
 */
function png(width, height, fn, ss = 4, opaque = false) {
  const bpp = opaque ? 3 : 4;
  const raw = Buffer.alloc((width * bpp + 1) * height);
  for (let py = 0; py < height; py++) {
    raw[py * (width * bpp + 1)] = 0;
    for (let px = 0; px < width; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const s = fn(px + (sx + 0.5) / ss, py + (sy + 0.5) / ss);
        acc[0] += s[0] * s[3]; acc[1] += s[1] * s[3]; acc[2] += s[2] * s[3]; acc[3] += s[3];
      }
      const o = py * (width * bpp + 1) + 1 + px * bpp;
      const alpha = acc[3] / (ss * ss);
      raw[o] = alpha ? Math.round(acc[0] / acc[3]) : 0;
      raw[o + 1] = alpha ? Math.round(acc[1] / acc[3]) : 0;
      raw[o + 2] = alpha ? Math.round(acc[2] / acc[3]) : 0;
      if (!opaque) raw[o + 3] = Math.round(alpha);
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
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const square = (size, shape) => png(size, size, (px, py) => icon((px / size) * 64, (py / size) * 64, shape));

// ---------- Web ---------------------------------------------------------------------
const out = join(ROOT, 'public');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'owenil-icon-192.png'), square(192, 'rounded'));
writeFileSync(join(out, 'owenil-icon-512.png'), square(512, 'square')); // full-bleed for maskable
mkdirSync(join(ROOT, 'docs', 'brand'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'brand', 'owenil-icon-1024.png'), square(1024, 'square'));
console.log('Web icons written to public/ and docs/brand/');

// ---------- Android ---------------------------------------------------------------
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
if (existsSync(RES)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    const dir = join(RES, `mipmap-${d}`);
    mkdirSync(dir, { recursive: true });
    // Legacy launcher icons (48dp).
    writeFileSync(join(dir, 'ic_launcher.png'), square(Math.round(48 * k), 'rounded'));
    writeFileSync(join(dir, 'ic_launcher_round.png'), square(Math.round(48 * k), 'circle'));
    // Adaptive icon layers (108dp canvas; the coin art fits the 66dp safe zone).
    const a = Math.round(108 * k);
    writeFileSync(join(dir, 'ic_launcher_background.png'), png(a, a, (px, py) => {
      const [r, g, b] = grad(Math.min(1, Math.max(0, (px + py) / (2 * a))));
      return [r, g, b, 255];
    }, 1));
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), png(a, a, (px, py) => {
      const dp = 108 / a;
      const x = (px * dp - 54) / 1.45 + 32;
      const y = (py * dp - 54) / 1.45 + 32;
      const w = halves(x, y);
      return w ? [255, 255, 255, Math.round(255 * w)] : [0, 0, 0, 0];
    }));
  }
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  writeFileSync(join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
  writeFileSync(join(RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);

  // Splash screens (older Android): the app's light background with the icon centred.
  const BG = [0xf9, 0xf8, 0xf5, 255];
  const splashes = ['drawable', ...['port', 'land'].flatMap((o) => Object.keys(densities).map((d) => `drawable-${o}-${d}`))];
  for (const dir of splashes) {
    const file = join(RES, dir, 'splash.png');
    if (!existsSync(file)) continue;
    const head = readFileSync(file);
    const w = head.readUInt32BE(16);
    const h = head.readUInt32BE(20);
    const s = Math.round(Math.min(w, h) * 0.28);
    const x0 = (w - s) / 2;
    const y0 = (h - s) / 2;
    writeFileSync(file, png(w, h, (px, py) => {
      if (px < x0 || px > x0 + s || py < y0 || py > y0 + s) return BG;
      const c = icon(((px - x0) / s) * 64, ((py - y0) / s) * 64, 'rounded');
      return c[3] ? c : BG;
    }, 2));
  }
  console.log('Android launcher icons and splash screens written to android/app/src/main/res/');
}

// ---------- iOS -------------------------------------------------------------------
const XCASSETS = join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets');
if (existsSync(XCASSETS)) {
  // App icon: square (iOS rounds the corners itself) and opaque.
  writeFileSync(join(XCASSETS, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), png(1024, 1024, (px, py) => icon((px / 1024) * 64, (py / 1024) * 64, 'square'), 4, true));
  // Launch screen: the app's light background with the icon centred (one image, three scales).
  const S = 2732;
  const BG = [0xf9, 0xf8, 0xf5, 255];
  const s = Math.round(S * 0.2);
  const x0 = (S - s) / 2;
  const splash = png(S, S, (px, py) => {
    if (px < x0 || px > x0 + s || py < x0 || py > x0 + s) return BG;
    const c = icon(((px - x0) / s) * 64, ((py - x0) / s) * 64, 'rounded');
    return c[3] ? c : BG;
  }, 2, true);
  for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) writeFileSync(join(XCASSETS, 'Splash.imageset', f), splash);
  console.log('iOS app icon and launch screen written to ios/App/App/Assets.xcassets/');
}
