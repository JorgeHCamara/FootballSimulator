// Crests that come with a background: a club's crest saved on a flat square
// (white, sometimes a colour) instead of on transparency shows as a box on the
// site's tables, in dark mode above all. This finds them and cuts each one out
// as a transparent PNG, saved with the site:
//
//   npm run crests:backgrounds              # every crest: the feeds' (network) and the saved ones
//   npm run crests:backgrounds -- --local   # only redo the cut-outs from the saved originals (no network)
//
// Which crests it looks at:
// - Every club of every league and cup on the site, in its current ESPN season
//   (ESPN's crest URL, as the site shows it), and the saved fallback crests
//   (src/config/crests.ts). One "comes with a background" when its four corners
//   are opaque and its border is one flat colour (Rochdale's, on white). Each is
//   saved as it was (scripts/data/crest-originals/{ESPN id}.png), cut out to
//   public/crests/cutout/{ESPN id}.png, and listed in src/config/crestCutouts.ts
//   with the crest it was made from: the site shows the cut-out only while the
//   feed still gives that crest (a new one shows as it is until this runs again).
//   A crest whose square is its design, not a background, goes in
//   scripts/crest-backgrounds.json ("keep": ESPN id → why) and is left alone.
// - Série C's, the site's own (scripts/import-serie-c.ts): every CBF crest is a
//   JPEG on a square, so all of them are cut out, from
//   scripts/data/serie-c-crests to public/crests/serie-c/{CBF id}.png.
//
// How a crest is cut out: the background is the flat colour around the crest,
// found from the image's border and flood-filled inwards, so white inside the
// crest (Paysandu's, Santa Cruz's) stays wherever the crest's outline encloses
// it. Nothing is cut off the original's edges, where a crest's outline can run
// within a pixel of the border (Santa Cruz's, at 70 px: trimming the edges
// opened its outline, and the fill ran into the white within). The fill never
// comes within WALL pixels of the crest's solid pixels either, which closes a
// gap of a pixel in a thin outline; the band it leaves is the crest's soft edge.
// Pixels near the crest's edge get a partial alpha with the background's tint
// taken out, so the edge is smooth on any colour, without a pale halo. The
// result is trimmed to the crest and centred on a square, so every club's
// crest fills its badge the same way. Thin specks of a scan (a line along an
// edge: Volta Redonda's, Barra's) are dropped; a crest that is mostly black
// (Maringá's monogram, Botafogo-PB's and Volta Redonda's shields) gets a thin
// white outline, so it still shows on the dark theme.
//
// It uses sharp, the image library Next.js installs with itself (an optional
// dependency of next), so there's nothing more to install.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Série C: the CBF's originals, and their cut-outs. */
export const SERIE_C_ORIGINALS = join(ROOT, "scripts/data/serie-c-crests");
export const SERIE_C_OUT = join(ROOT, "public/crests/serie-c");
/** Feed crests with a background: as they came, and cut out. */
const FEED_ORIGINALS = join(ROOT, "scripts/data/crest-originals");
const FEED_OUT = join(ROOT, "public/crests/cutout");
const MAP = join(ROOT, "src/config/crestCutouts.ts");
const SETTINGS = join(ROOT, "scripts/crest-backgrounds.json");

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

/** Share of the border that must be the background's colour (within this distance) for a crest to "come with" one. */
const FLAT_BORDER = 0.9;
const FLAT_DISTANCE = 40;

/**
 * The flat background a crest image comes with, or null: its four corners
 * opaque and its border one colour (a crest already on transparency, or one
 * whose image runs to its edges in several colours, has none).
 */
export async function backgroundOf(input: Buffer): Promise<number[] | null> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  if (w < 8 || h < 8) return null;
  const alpha = (x: number, y: number) => data[(y * w + x) * 4 + 3]!;
  if ([alpha(0, 0), alpha(w - 1, 0), alpha(0, h - 1), alpha(w - 1, h - 1)].some((a) => a < 250)) return null;
  const rgb = new Uint8Array(w * h * 3);
  for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) rgb[p * 3 + c] = data[p * 4 + c]!;
  const bg = borderColour(rgb, w, h);
  let flat = 0;
  let all = 0;
  const check = (x: number, y: number) => {
    const p = y * w + x;
    all++;
    if (data[p * 4 + 3]! >= 250 && dist(rgb[p * 3]!, rgb[p * 3 + 1]!, rgb[p * 3 + 2]!, bg) < FLAT_DISTANCE) flat++;
  };
  for (let x = 0; x < w; x++) {
    check(x, 0);
    check(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    check(0, y);
    check(w - 1, y);
  }
  return flat / all >= FLAT_BORDER ? bg : null;
}

/** A crest image (JPEG or PNG) as a transparent PNG of SIZE × SIZE, its background cut away. */
export async function cutOut(input: Buffer): Promise<Buffer> {
  // Upscaled first (the smallest originals are 70 px), so the soft edge is drawn finely.
  const scale = 3;
  const meta = await sharp(input).metadata();
  const w = (meta.width ?? 0) * scale;
  const h = (meta.height ?? 0) * scale;
  // Any transparent pixels (a PNG's) take the border's colour first: they're background too.
  const { data: first } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const firstRgb = new Uint8Array((meta.width ?? 0) * (meta.height ?? 0) * 3);
  for (let p = 0; p < firstRgb.length / 3; p++) for (let c = 0; c < 3; c++) firstRgb[p * 3 + c] = first[p * 4 + c]!;
  const [r0, g0, b0] = borderColour(firstRgb, meta.width ?? 0, meta.height ?? 0);
  const px = new Uint8Array(
    await sharp(input).flatten({ background: { r: r0!, g: g0!, b: b0! } }).resize(w, h, { kernel: "lanczos3" }).raw().toBuffer(),
  );
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

/** Every Série C original, cut out into public/crests/serie-c/{id}.png. */
export async function writeSerieCCrests(): Promise<number> {
  await mkdir(SERIE_C_OUT, { recursive: true });
  const files = (await readdir(SERIE_C_ORIGINALS)).filter((f) => f.endsWith(".jpg"));
  for (const file of files) await writeFile(join(SERIE_C_OUT, file.replace(/\.jpg$/, ".png")), await cutOut(await readFile(join(SERIE_C_ORIGINALS, file))));
  return files.length;
}

/** A feed crest with a background: the club, and the crest it came with (a URL, or a saved fallback's path). */
interface FeedCrest {
  id: number;
  name: string;
  from: string;
}

/** Each saved original's source, kept beside it so --local can redo the map. */
const SOURCES = join(FEED_ORIGINALS, "sources.json");

async function readSettings(): Promise<{ keep: Record<string, string> }> {
  return existsSync(SETTINGS) ? (JSON.parse(await readFile(SETTINGS, "utf8")) as { keep: Record<string, string> }) : { keep: {} };
}

/** Every club's crest on the site: each league's and cup's current ESPN season, then the saved fallbacks for clubs without one. */
export async function feedCrests(): Promise<FeedCrest[]> {
  const { LEAGUES } = await import("../src/config/leagues.ts");
  const { CUPS } = await import("../src/config/cups.ts");
  const { CREST_FALLBACKS } = await import("../src/config/crests.ts");
  const { fetchEspnSeason } = await import("../src/lib/espn.ts");
  const now = new Date();
  const crests = new Map<number, FeedCrest>();
  const feeds = [...LEAGUES.flatMap((l) => (l.espn ? [{ code: l.code, feed: l.espn }] : [])), ...CUPS.map((c) => ({ code: c.code, feed: c.espn }))];
  for (const { code, feed } of feeds) {
    const year = feed.seasons === "split" && now.getUTCMonth() < 5 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    try {
      for (const event of await fetchEspnSeason(feed.slug, year, feed.seasons)) {
        for (const side of event.competitions[0]?.competitors ?? []) {
          const id = Number(side.team.id);
          if (!Number.isInteger(id) || crests.has(id)) continue;
          const from = side.team.logo ?? CREST_FALLBACKS[id];
          if (from) crests.set(id, { id, name: side.team.displayName.trim(), from });
        }
      }
    } catch (error) {
      console.warn(`${code}: no ESPN season (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return [...crests.values()];
}

/** A crest's bytes: from the site (a saved fallback, "/crests/…") or its URL. */
export async function crestBytes(from: string): Promise<Buffer> {
  if (from.startsWith("/")) return readFile(join(ROOT, "public", from));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(from);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 2 || res.status === 404) throw new Error(`${from}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

/** The map the site reads (src/config/crestCutouts.ts). */
async function writeMap(entries: (FeedCrest & { crest: string })[]) {
  const lines = [...entries]
    .sort((a, b) => a.id - b.id)
    .map((e) => `  ${e.id}: { from: ${JSON.stringify(e.from)}, crest: ${JSON.stringify(e.crest)} }, // ${e.name}`);
  await writeFile(
    MAP,
    `// Crests that come with a background (a flat square behind the crest), cut out as
// transparent PNGs by scripts/crest-backgrounds.ts, keyed by ESPN team id. A
// club shows its cut-out only while its crest is still \`from\` (a new crest
// from the feed shows as it is until the script runs again). Regenerate:
//   npm run crests:backgrounds

export interface CrestCutout {
  /** The crest it was made from (the feed's URL, or a saved fallback's path). */
  from: string;
  /** The cut-out, served by the site. */
  crest: string;
}

export const CREST_CUTOUTS: Readonly<Record<number, CrestCutout>> = {
${lines.join("\n")}
};
`,
  );
}

/**
 * Feed crests: every club's crest looked at, those with a background saved
 * and cut out, and the map written. With `local`, the saved originals only.
 */
export async function writeFeedCrests(local = false): Promise<number> {
  await mkdir(FEED_ORIGINALS, { recursive: true });
  await mkdir(FEED_OUT, { recursive: true });
  const { keep } = await readSettings();
  const saved: Record<string, FeedCrest> = existsSync(SOURCES) ? JSON.parse(await readFile(SOURCES, "utf8")) : {};
  const found: Record<string, FeedCrest> = {};
  if (local) {
    Object.assign(found, saved);
  } else {
    const crests = await feedCrests();
    console.log(`Looking at ${crests.length} crests…`);
    let next = 0;
    const worker = async () => {
      while (next < crests.length) {
        const crest = crests[next++]!;
        if (keep[crest.id]) continue;
        try {
          const bytes = await crestBytes(crest.from);
          if (!(await backgroundOf(bytes))) continue;
          await writeFile(join(FEED_ORIGINALS, `${crest.id}.png`), await sharp(bytes).png().toBuffer());
          found[crest.id] = crest;
          console.log(`  ${crest.name} (${crest.id}): comes with a background`);
        } catch (error) {
          console.warn(`  ${crest.name} (${crest.id}): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    await writeFile(SOURCES, `${JSON.stringify(Object.fromEntries(Object.entries(found).sort(([a], [b]) => Number(a) - Number(b))), null, 1)}\n`);
  }
  const entries: (FeedCrest & { crest: string })[] = [];
  for (const crest of Object.values(found)) {
    if (keep[crest.id]) continue;
    await writeFile(join(FEED_OUT, `${crest.id}.png`), await cutOut(await readFile(join(FEED_ORIGINALS, `${crest.id}.png`))));
    entries.push({ ...crest, crest: `/crests/cutout/${crest.id}.png` });
  }
  await writeMap(entries);
  return entries.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const local = process.argv.includes("--local");
  console.log(`Série C: ${await writeSerieCCrests()} crests cut out`);
  console.log(`Feeds: ${await writeFeedCrests(local)} crests with a background, cut out`);
}
