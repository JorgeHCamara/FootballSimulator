import type { Fixture, ResultMap } from "../engine/types.ts";

// Compact, URL-safe encoding of a user's predictions so a simulated table can be
// shared without a server. Fixtures are referenced by their index in the season's
// fixture list sorted by id, which keeps each entry to 4 bytes:
//   [version:u8] then per entry [index:u16be][home:u8][away:u8]

const VERSION = 1;
const MAX_GOALS = 99;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const fixtureOrder = (fixtures: readonly Fixture[]) => [...fixtures].map((f) => f.id).sort((a, b) => a - b);

export function encodeResults(fixtures: readonly Fixture[], results: ResultMap): string {
  const order = fixtureOrder(fixtures);
  const entries: [number, number, number][] = [];
  order.forEach((id, index) => {
    const r = results[id];
    if (r) entries.push([index, Math.min(r.home, MAX_GOALS), Math.min(r.away, MAX_GOALS)]);
  });

  const bytes = new Uint8Array(1 + entries.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, VERSION);
  entries.forEach(([index, home, away], i) => {
    const o = 1 + i * 4;
    view.setUint16(o, index);
    view.setUint8(o + 2, home);
    view.setUint8(o + 3, away);
  });
  return toBase64Url(bytes);
}

/** Returns null when the code is malformed or from an unknown version. */
export function decodeResults(fixtures: readonly Fixture[], code: string): ResultMap | null {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(code);
  } catch {
    return null;
  }
  if (bytes.length < 1 || (bytes.length - 1) % 4 !== 0 || bytes[0] !== VERSION) return null;

  const order = fixtureOrder(fixtures);
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
