import { createHash } from "node:crypto";
import { SIM_VERSION } from "./simVersion.ts";

/*
 * The cache key of a match's "What this result means" numbers (the impact
 * route keeps them in Next's data cache, which outlives deployments): what
 * the numbers depend on, so they're worked out again when one of those
 * changes, and only then, not on every deploy.
 */

/** A short fingerprint of a text: the first 12 hex digits of its SHA-256. */
export const fingerprintOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

/**
 * The fingerprint of the xG a league's model is built with (LeagueData.xg:
 * the played games' stored xG), "none" when it uses none: new xG makes
 * another key.
 */
export function xgFingerprint(xg: Readonly<Record<number, readonly [number, number]>> | undefined): string {
  const games = Object.entries(xg ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  return games.length ? fingerprintOf(games.map(([id, [home, away]]) => `${id}:${home},${away}`).join(";")) : "none";
}

export interface ImpactKeyParts {
  /** The league's code ("PL"). */
  league: string;
  /** The match page's slug. */
  slug: string;
  /** The league's data version (dataVersion in clubOutlook.ts: every game's date and result). */
  dataVersion: string;
  /** The fingerprint of the xG its model uses (xgFingerprint). */
  xg: string;
}

/** The key: league, match, data version, xG fingerprint and SIM_VERSION (no deployment id: a deploy alone changes nothing). */
export function impactCacheKey({ league, slug, dataVersion, xg }: ImpactKeyParts): string[] {
  return ["match-impact", league, slug, dataVersion, xg, `sim-${SIM_VERSION}`];
}
