import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SIM_VERSION } from "./simVersion.ts";

/*
 * The cache key of a match's "What this result means" numbers (the impact
 * route keeps them in Next's data cache, which outlives deployments): what
 * the numbers depend on, so they're worked out again when one of those
 * changes, and only then, not on every deploy.
 */

/** A short fingerprint of a text: the first 12 hex digits of its SHA-256. */
export const fingerprintOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

const prints = new Map<string, Promise<string>>();

/**
 * The fingerprint of a league's xG file (src/data/xg/<CODE>.json), "none"
 * when it has none: new xG (the snapshots job's refresh) makes another key.
 * Read once per server: the files only change with a deployment.
 */
export function xgFingerprint(code: string): Promise<string> {
  let print = prints.get(code);
  if (!print) {
    print = readFile(join(process.cwd(), "src/data/xg", `${code}.json`), "utf8").then(fingerprintOf, () => "none");
    prints.set(code, print);
  }
  return print;
}

export interface ImpactKeyParts {
  /** The league's code ("PL"). */
  league: string;
  /** The match page's slug. */
  slug: string;
  /** The league's data version (dataVersion in clubOutlook.ts: every game's date and result). */
  dataVersion: string;
  /** Its xG file's fingerprint (xgFingerprint). */
  xg: string;
}

/** The key: league, match, data version, xG fingerprint and SIM_VERSION (no deployment id: a deploy alone changes nothing). */
export function impactCacheKey({ league, slug, dataVersion, xg }: ImpactKeyParts): string[] {
  return ["match-impact", league, slug, dataVersion, xg, `sim-${SIM_VERSION}`];
}
