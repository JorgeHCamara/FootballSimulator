import type { Fixture, ResultMap } from "../engine/types.ts";

// Compact, URL-safe encoding of a user's predictions so a simulated table can be
// shared without a server: the predictions travel in the link itself. Fixtures
// are referenced by their index in the season's fixture list sorted by id.
//
// Version 2 (written now), for links short enough to share:
//   [2] [n: varint, the fixture count]
//   [run lengths: varints, alternately not predicted / predicted, adding up to n]
//   [scores: three per 16-bit big-endian word, each symbol home×6+away for
//    scores up to 5–5, else 36 (escape)] [escaped scores: home, away bytes]
// A rest-of-season prediction for a 20-club league takes ~200 bytes (~270
// characters), against ~1,500 for version 1.
//
// Version 1 (read only, older links): [1] then per entry [index:u16be][home:u8][away:u8].

const MAX_GOALS = 99;
const SMALL = 6; // scores 0–5 per side fit a symbol
const ESCAPE = SMALL * SMALL;
const BASE = ESCAPE + 1; // 37 symbols: three fit in 16 bits (37³ = 50,653)

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const fixtureOrder = (fixtures: readonly Fixture[]) => [...fixtures].map((f) => f.id).sort((a, b) => a - b);

function pushVarint(out: number[], value: number) {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

class Reader {
  offset = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  byte(): number {
    const b = this.bytes[this.offset++];
    if (b === undefined) throw new Error("truncated");
    return b;
  }
  varint(): number {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const b = this.byte();
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return value;
    }
    throw new Error("bad varint");
  }
}

export function encodeResults(fixtures: readonly Fixture[], results: ResultMap): string {
  const order = fixtureOrder(fixtures);
  const out: number[] = [2];
  pushVarint(out, order.length);
  // Runs: not predicted, predicted, not predicted…
  const predicted = order.map((id) => Boolean(results[id]));
  let i = 0;
  let want = false;
  while (i < order.length) {
    let run = 0;
    while (i < order.length && predicted[i] === want) {
      run++;
      i++;
    }
    pushVarint(out, run);
    want = !want;
  }
  const scores = order.flatMap((id) => {
    const r = results[id];
    return r ? [{ home: Math.min(r.home, MAX_GOALS), away: Math.min(r.away, MAX_GOALS) }] : [];
  });
  const symbols = scores.map((s) => (s.home < SMALL && s.away < SMALL ? s.home * SMALL + s.away : ESCAPE));
  for (let k = 0; k < symbols.length; k += 3) {
    const word = (symbols[k] ?? 0) * BASE * BASE + (symbols[k + 1] ?? 0) * BASE + (symbols[k + 2] ?? 0);
    out.push(word >> 8, word & 0xff);
  }
  symbols.forEach((symbol, k) => {
    if (symbol === ESCAPE) out.push(scores[k]!.home, scores[k]!.away);
  });
  return toBase64Url(Uint8Array.from(out));
}

/** Returns null when the code is malformed, from an unknown version, or for another fixture list. */
export function decodeResults(fixtures: readonly Fixture[], code: string): ResultMap | null {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(code);
  } catch {
    return null;
  }
  const order = fixtureOrder(fixtures);
  if (bytes[0] === 1) return decodeV1(order, bytes);
  if (bytes[0] === 2) {
    try {
      return decodeV2(order, bytes);
    } catch {
      return null;
    }
  }
  return null;
}

function decodeV2(order: readonly number[], bytes: Uint8Array): ResultMap | null {
  const reader = new Reader(bytes);
  reader.byte();
  if (reader.varint() !== order.length) return null;
  const ids: number[] = [];
  let index = 0;
  let predicted = false;
  while (index < order.length) {
    const run = reader.varint();
    if (index + run > order.length) return null;
    if (predicted) ids.push(...order.slice(index, index + run));
    index += run;
    predicted = !predicted;
  }
  const symbols: number[] = [];
  for (let k = 0; k < ids.length; k += 3) {
    const word = reader.byte() * 256 + reader.byte();
    symbols.push(Math.floor(word / (BASE * BASE)), Math.floor(word / BASE) % BASE, word % BASE);
  }
  const out: ResultMap = {};
  for (const [k, id] of ids.entries()) {
    const symbol = symbols[k]!;
    if (symbol > ESCAPE) return null;
    const score = symbol === ESCAPE ? { home: reader.byte(), away: reader.byte() } : { home: Math.floor(symbol / SMALL), away: symbol % SMALL };
    if (score.home > MAX_GOALS || score.away > MAX_GOALS) return null;
    out[id] = score;
  }
  return reader.offset === bytes.length ? out : null;
}

function decodeV1(order: readonly number[], bytes: Uint8Array): ResultMap | null {
  if ((bytes.length - 1) % 4 !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: ResultMap = {};
  for (let o = 1; o < bytes.length; o += 4) {
    const id = order[view.getUint16(o)];
    const home = view.getUint8(o + 2);
    const away = view.getUint8(o + 3);
    if (id === undefined || home > MAX_GOALS || away > MAX_GOALS) return null;
    out[id] = { home, away };
  }
  return out;
}

/** Version 1, kept so tests can check old links still open. */
export function encodeResultsV1(fixtures: readonly Fixture[], results: ResultMap): string {
  const order = fixtureOrder(fixtures);
  const entries: [number, number, number][] = [];
  order.forEach((id, index) => {
    const r = results[id];
    if (r) entries.push([index, Math.min(r.home, MAX_GOALS), Math.min(r.away, MAX_GOALS)]);
  });
  const bytes = new Uint8Array(1 + entries.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 1);
  entries.forEach(([index, home, away], i) => {
    const o = 1 + i * 4;
    view.setUint16(o, index);
    view.setUint8(o + 2, home);
    view.setUint8(o + 3, away);
  });
  return toBase64Url(bytes);
}
