// Série C crests without their background: the CBF publishes each crest as a
// JPEG on a flat square (white, Volta Redonda's yellow), which shows as a box
// on the site's tables, in dark mode above all. This cuts the crest out as a
// transparent PNG: the background is the flat colour around the crest, found
// from the image's border and flood-filled inwards, so white inside the crest
// (Paysandu's, Santa Cruz's) stays wherever the crest's outline encloses it.
// Nothing is cut off the original's edges, where a crest's outline can run
// within a pixel of the border (Santa Cruz's, at 70 px: trimming the edges
// opened its outline, and the fill ran into the white within). The fill never
// comes within WALL pixels of the crest's solid pixels either, which closes a
// gap of a pixel in a thin outline; the band it leaves is the crest's soft edge.
// Pixels near the crest's edge get a partial alpha with the background's tint
// taken out, so the edge is smooth on any colour, without a pale halo. The
// result is trimmed to the crest and centred on a square, so every club's
// crest fills its badge the same way. Thin specks of the scan (a line along an
// edge: Volta Redonda's, Barra's) are dropped; a crest that is mostly black
// (Maringá's monogram, Botafogo-PB's and Volta Redonda's shields) gets a thin
// white outline, so it still shows on the dark theme.
//
// Used by scripts/import-serie-c.ts; on its own, to redo the PNGs from the
// saved originals (scripts/data/serie-c-crests) without the network:
//
//   node scripts/serieCCrests.ts
//
// It uses sharp, the image library Next.js installs with itself (an optional
// dependency of next), so there's nothing more to install.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ORIGINALS = join(ROOT, "scripts/data/serie-c-crests");
export const OUT = join(ROOT, "public/crests/serie-c");

/** Colour distance (0–441) under which the background's fill spreads from the border (not within WALL pixels of the crest)… */
const FILL = 70;
const WALL = 2;
/** …and under which a pixel next to it, at most EDGE_DEPTH pixels in, is the crest's soft edge… */
const EDGE_DEPTH = WALL + 1;
/** Background pixels this close to the crest's solid pixels can be its soft edge; further out, pale specks of the scan are clear. */
const SOFT = 2 * WALL + 2;
/** …and fully transparent below this, partly transparent up to FILL. */
const CLEAR = 18;
/** The square's side, and the crest's margin in it. */
const SIZE = 160;
const MARGIN = 0.04;
/** A crest at least this share near-black gets an outline, this share of its size thick. */
const DARK_SHARE = 0.55;
const OUTLINE = 0.02;

const dist = (r: number, g: number, b: number, bg: readonly number[]) => Math.hypot(r - bg[0]!, g - bg[1]!, b - bg[2]!);

/** The background colour: the median of the border's pixels. */
function borderColour(px: Uint8Array, w: number, h: number): number[] {
  const channels: number[][] = [[], [], []];
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 3;
    for (let c = 0; c < 3; c++) channels[c]!.push(px[i + c]!);
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    add(0, y);
    add(w - 1, y);
  }
  return channels.map((v) => v.sort((a, b) => a - b)[v.length >> 1]!);
}

/** A crest JPEG (or PNG) as a transparent PNG of SIZE × SIZE. */
export async function cutOut(input: Buffer): Promise<Buffer> {
  // Upscaled first (the smallest originals are 70 px), so the soft edge is drawn finely.
  const scale = 3;
  const meta = await sharp(input).metadata();
  const w = (meta.width ?? 0) * scale;
  const h = (meta.height ?? 0) * scale;
  const px = new Uint8Array(await sharp(input).removeAlpha().resize(w, h, { kernel: "lanczos3" }).raw().toBuffer());
  const bg = borderColour(px, w, h);
  // Flood fill from the border through background pixels.
  const inBg = new Uint8Array(w * h);
  const stack: number[] = [];
  const d = (p: number) => dist(px[p * 3]!, px[p * 3 + 1]!, px[p * 3 + 2]!, bg);
  // The crest's solid pixels grown by WALL (the fill doesn't go there) and by SOFT (where it can be the soft edge).
  const wall = new Uint8Array(w * h);
  const soft = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d(y * w + x) < FILL) continue;
      for (let yy = Math.max(0, y - SOFT); yy <= Math.min(h - 1, y + SOFT); yy++) {
        for (let xx = Math.max(0, x - SOFT); xx <= Math.min(w - 1, x + SOFT); xx++) {
          soft[yy * w + xx] = 1;
          if (Math.abs(xx - x) <= WALL && Math.abs(yy - y) <= WALL) wall[yy * w + xx] = 1;
        }
      }
    }
  }
  const near = (p: number) => !wall[p] && d(p) < FILL;
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (inBg[p] || !near(p)) continue;
    inBg[p] = 1;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  // The crest's soft edge: paler pixels touching the background, a few deep, which don't spread it.
  for (let ring = 0; ring < EDGE_DEPTH; ring++) {
    const next: number[] = [];
    for (let p = 0; p < w * h; p++) {
      if (inBg[p] || d(p) >= FILL) continue;
      const x = p % w;
      if ((x > 0 && inBg[p - 1]) || (x < w - 1 && inBg[p + 1]) || (p >= w && inBg[p - w]) || (p < w * (h - 1) && inBg[p + w])) next.push(p);
    }
    for (const p of next) inBg[p] = 1;
  }
  const out = Buffer.alloc(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    let [r, g, b] = [px[p * 3]!, px[p * 3 + 1]!, px[p * 3 + 2]!];
    let a = 1;
    if (inBg[p]) {
      const away = d(p);
      a = away <= CLEAR || !soft[p] ? 0 : Math.min(1, (away - CLEAR) / (FILL - CLEAR));
      // The background's share taken out of the colour (it was blended over bg with alpha a).
      if (a > 0) [r, g, b] = [r, g, b].map((v, c) => Math.max(0, Math.min(255, Math.round((v - bg[c]! * (1 - a)) / a)))) as [number, number, number];
    }
    out[p * 4] = r;
    out[p * 4 + 1] = g;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = Math.round(a * 255);
  }
  dropSpecks(out, w, h);
  if (darkShare(out) >= DARK_SHARE) addOutline(out, w, h, Math.max(1, Math.round(Math.max(w, h) * OUTLINE)));
  const inner = Math.round(SIZE * (1 - 2 * MARGIN));
  const trimmed = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .png()
    .toBuffer();
  return sharp(trimmed)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
    .extend({ top: (SIZE - inner) >> 1, bottom: SIZE - inner - ((SIZE - inner) >> 1), left: (SIZE - inner) >> 1, right: SIZE - inner - ((SIZE - inner) >> 1), background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Connected parts of the crest that are thin lines (a scan's line along an
 * edge), not part of it: made transparent with their faint fringe. Parts are
 * judged by their solid pixels (faint JPEG noise around them doesn't join them
 * to the crest); stars and letters are compact, and stay.
 */
function dropSpecks(rgba: Buffer, w: number, h: number) {
  const label = new Int32Array(w * h).fill(-1);
  const solid = (p: number) => rgba[p * 4 + 3]! >= 128;
  const lines: [number, number, number, number, number][] = [];
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || !solid(start)) continue;
    const id = next++;
    const stack = [start];
    label[start] = id;
    let [x0, x1, y0, y1] = [w, 0, h, 0];
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
        if (q >= 0 && q < w * h && label[q] === -1 && solid(q)) {
          label[q] = id;
          stack.push(q);
        }
      }
    }
    const thin = Math.min(x1 - x0, y1 - y0) + 1;
    const long = Math.max(x1 - x0, y1 - y0) + 1;
    if (thin <= w * 0.03 && long >= thin * 4) lines.push([id, x0, x1, y0, y1]);
  }
  // Each line, and the faint pixels around it (a few pixels out) that belong to no other part.
  const pad = 2 * EDGE_DEPTH + 2;
  for (const [id, x0, x1, y0, y1] of lines) {
    for (let y = Math.max(0, y0 - pad); y <= Math.min(h - 1, y1 + pad); y++) {
      for (let x = Math.max(0, x0 - pad); x <= Math.min(w - 1, x1 + pad); x++) {
        const p = y * w + x;
        if (label[p] === id || label[p] === -1) rgba[p * 4 + 3] = 0;
      }
    }
  }
}

/** Share of the crest (its opaque pixels) that is near-black. */
function darkShare(rgba: Buffer): number {
  let opaque = 0;
  let dark = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! < 200) continue;
    opaque++;
    if (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]! < 50) dark++;
  }
  return opaque ? dark / opaque : 0;
}

/** A white outline `r` pixels wide around the crest, under it. */
function addOutline(rgba: Buffer, w: number, h: number, r: number) {
  const alpha = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) alpha[p] = rgba[p * 4 + 3]! / 255;
  const ring: [number, number][] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) ring.push([dx, dy]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (alpha[p] === 1) continue;
      let grown = 0;
      for (const [dx, dy] of ring) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && alpha[yy * w + xx]! > grown) grown = alpha[yy * w + xx]!;
        if (grown === 1) break;
      }
      const a = alpha[p]!;
      if (grown <= a) continue;
      // The crest's pixel over white: white where the outline is, the crest's colour on top.
      const outA = a + grown * (1 - a);
      for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.round((rgba[p * 4 + c]! * a + 255 * grown * (1 - a)) / outA);
      rgba[p * 4 + 3] = Math.round(outA * 255);
    }
  }
}

/** Every saved original, cut out into public/crests/serie-c/{id}.png. */
export async function writeCrests(): Promise<number> {
  const files = (await readdir(ORIGINALS)).filter((f) => f.endsWith(".jpg"));
  for (const file of files) await writeFile(join(OUT, file.replace(/\.jpg$/, ".png")), await cutOut(await readFile(join(ORIGINALS, file))));
  return files.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Wrote ${await writeCrests()} crests`);
}
