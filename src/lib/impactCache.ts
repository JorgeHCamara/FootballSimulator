import { createHash } from "node:crypto";
import { SIM_VERSION } from "./simVersion.ts";

/*
 * The cache key of a match's "What this result means" numbers (the impact
 * route keeps them in Next's data cache, which outlives deployments): what
 * the numbers depend on, so they're worked out again when one of those
 * changes, and only then, not on every deploy. One entry per game, whatever
 * the language: the numbers are the same in every language (the words are
 * added per language afterwards, see impactView), so there's no locale in
 * the key.
 *
 * A game more than IMPACT_FAR_MS away (48 hours) is keyed by the game alone
 * (its league, address and kick-off), not by its league's data version or
 * xG: a result elsewhere in the league no longer makes a new entry for every
 * far-off game, and the entry is worked out again when it's IMPACT_KEEP_SECONDS
 * old (24 hours) instead. Within 48 hours of kick-off, the key follows the
 * league's data as before, so the numbers are worked out again for each new
 * result while the game draws near.
 */

/** How long an entry is kept in the data cache, and the route's response by the CDN (seconds): 24 hours. */
export const IMPACT_KEEP_SECONDS = 86_400;

/** Beyond this long before kick-off (ms), the entry isn't keyed by the league's data version: 48 hours. */
export const IMPACT_FAR_MS = 48 * 3_600_000;

/** Is the game more than IMPACT_FAR_MS away from kick-off? */
export const isFarFromKickoff = (kickoff: string, now: number = Date.now()) => Date.parse(kickoff) - now > IMPACT_FAR_MS;

/** The route's answer for a game far from kick-off, at most: kept a day by the CDN, served stale a week while it's redrawn. */
export const IMPACT_CACHE_CONTROL = `public, max-age=0, s-maxage=${IMPACT_KEEP_SECONDS}, stale-while-revalidate=604800`;

/** …and for a game within 48 hours of kick-off (or under way): three hours, stale a day, as before the far key. */
export const IMPACT_NEAR_CACHE_CONTROL = "public, max-age=0, s-maxage=10800, stale-while-revalidate=86400";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The route's Cache-Control for a game, by its kick-off, split as its key is
 * (impactKeyFor): within 48 hours of kick-off or after it, IMPACT_NEAR_CACHE_CONTROL,
 * so the CDN copy follows each new result as it did before. Further off, the
 * CDN may keep it as long as the game stays far, T seconds (until 48 hours
 * before kick-off): s-maxage T, between three hours and a day, and
 * stale-while-revalidate T, between a day and a week. A far copy then
 * outlives the 48-hour line by no more than the near margins.
 */
export function impactCacheControl(kickoff: string, now: number = Date.now()): string {
  if (!isFarFromKickoff(kickoff, now)) return IMPACT_NEAR_CACHE_CONTROL;
  const untilNear = Math.floor((Date.parse(kickoff) - IMPACT_FAR_MS - now) / 1000);
  return `public, max-age=0, s-maxage=${clamp(untilNear, 10_800, IMPACT_KEEP_SECONDS)}, stale-while-revalidate=${clamp(untilNear, 86_400, 604_800)}`;
}

/** The route's 404 (no such game, or moved): kept an hour by the CDN, so a crawler's repeats don't each look it up. */
export const IMPACT_MISSING_CACHE_CONTROL = "public, max-age=0, s-maxage=3600";

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


/** A far-off game's key: league, match, kick-off and SIM_VERSION (no data version, no xG, no locale). */
export function farImpactCacheKey({ league, slug, kickoff }: { league: string; slug: string; kickoff: string }): string[] {
  return ["match-impact", league, slug, `far@${kickoff}`, `sim-${SIM_VERSION}`];
}

/**
 * The key a game's numbers are kept under now: by the game alone more than
 * 48 hours before kick-off (farImpactCacheKey), by the league's data within
 * them (impactCacheKey). `parts()` is only read for the latter.
 */
export function impactKeyFor(game: { league: string; slug: string; kickoff: string }, parts: () => Pick<ImpactKeyParts, "dataVersion" | "xg">, now: number = Date.now()): { key: string[]; far: boolean } {
  if (isFarFromKickoff(game.kickoff, now)) return { key: farImpactCacheKey(game), far: true };
  return { key: impactCacheKey({ league: game.league, slug: game.slug, ...parts() }), far: false };
}
