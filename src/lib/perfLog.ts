/*
 * One structured line per expensive operation, for Vercel's runtime logs (free):
 *   [perf] {"op":"…","key":"…","ms":123,"cache":"hit"|"miss",…}
 * Filter the logs on "[perf]" to see which routes spend the CPU. Nothing is
 * logged about the visitor beyond a coarse bot / not-bot flag (isBot): no IP,
 * no user agent. Each line stays under PERF_LINE_MAX bytes.
 */

/** The longest line logged, in bytes ("[perf] " included). */
export const PERF_LINE_MAX = 300;

/** The longest key kept (the rest is cut). */
const KEY_MAX = 120;

export type PerfExtra = Record<string, string | number | boolean | undefined>;

export interface PerfEntry extends PerfExtra {
  /** What ran: "league-outlook", "match-impact", "og-image"… */
  op: string;
  /** Which one: a league, a match, a route… */
  key: string;
  /** How long it took (milliseconds, rounded). */
  ms: number;
  /** Whether the work was served from a cache ("hit") or done ("miss"). */
  cache: "hit" | "miss";
}

/** The line for an entry (without the "[perf] " prefix): JSON, cut to fit PERF_LINE_MAX. */
export function perfLine(entry: PerfEntry): string {
  const { op, key, ms, cache, ...extra } = entry;
  // Only plain characters in the key (a path a crawler made up may hold anything): nothing JSON escapes, so it stays short.
  const plain = key.replace(/[^\w\-./:@%+,=~?&]/g, "_");
  const head = { op, key: plain.length > KEY_MAX ? `${plain.slice(0, KEY_MAX)}…` : plain, ms: Math.round(ms), cache };
  const room = PERF_LINE_MAX - "[perf] ".length;
  const fields = Object.entries(extra).filter(([, v]) => v !== undefined);
  // Extra fields in order while they fit; the head always does.
  for (let i = fields.length; i > 0; i--) {
    const candidate = JSON.stringify({ ...head, ...Object.fromEntries(fields.slice(0, i)) });
    if (Buffer.byteLength(candidate) <= room) return candidate;
  }
  return JSON.stringify(head);
}

/**
 * Logs an entry: `console.info("[perf]", line)`. Never throws. Only inside a
 * Next.js server or build (NEXT_RUNTIME set): the scripts and tests that run
 * the same code outside Next stay quiet.
 */
export function perfLog(entry: PerfEntry, enabled: boolean = Boolean(process.env.NEXT_RUNTIME)): void {
  // `process.env.NEXT_RUNTIME` written out in full: Next's bundler replaces it with "nodejs"/"edge" at build time.
  if (!enabled) return;
  try {
    console.info("[perf]", perfLine(entry));
  } catch {
    // Logging must never break a request.
  }
}

/** Milliseconds since `start` (performance.now()), rounded. */
export const since = (start: number) => Math.round(performance.now() - start);

/** A coarse bot flag from a user-agent header (crawlers, link previews, scripts). Only the flag is logged. */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|headless|scrapy|httpclient/i.test(userAgent);
}
