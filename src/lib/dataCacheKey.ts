import { createHash } from "node:crypto";
import { CREST_FALLBACKS } from "../config/crests.ts";
import { TEAM_OVERRIDES } from "../config/teamOverrides.ts";

/*
 * The data cache keys of the feeds' data as read (keptEspn and keptEspnGroups
 * in leagueData.ts, keptEspnCup in cupData.ts, keptStartCup in
 * myWorldStart.ts). Next's data cache outlives deployments, which is the
 * point: a deployment that reads the feed the same way reuses what the last
 * one read, instead of downloading every league's season again (they were
 * keyed by deployment until this file). What still has to keep an entry from
 * being reused:
 *
 * - How the feed is read: ESPN_PARSER_VERSION, by hand (below).
 * - What it's read with: the competition's config and the shared club
 *   tables (names, crests), fingerprinted automatically (configFingerprint),
 *   so adding a stage, a group or a club's name never needs a bump.
 * - Which season: the current season's year is in the key, so the season
 *   rollover (currentSeasonYear) starts new entries on its own.
 * - Where it runs: production deployments share their entries; each preview
 *   branch has its own; a local build has its own (cacheScope). A preview's
 *   experimental reading never lands in production's entries.
 *
 * Sample data, first-party leagues and football-data.org never go through
 * these keys.
 */

/**
 * Bump when a change could make data read before it wrong now: the parsing
 * in src/lib/espn.ts (espnFixtures, espnTeams, espnVenues, espnSplitSeason,
 * the deductions and groups readers), loadEspn and loadEspnGroups in
 * leagueData.ts, loadEspnCup in cupData.ts or startCup in myWorldStart.ts, or
 * the shape of what they return (LeagueData, CupData, StartCup). Not for a
 * change to a league's or cup's config, TEAM_OVERRIDES or CREST_FALLBACKS
 * (fingerprinted), or to what's done with the data afterwards (withXg,
 * withClubPages, the outlook: worked out on every read).
 */
export const ESPN_PARSER_VERSION = 1;

/**
 * Whose entries: "production" for every production deployment, a preview
 * branch's own ("preview:<branch>"), "development", or "local" (a build on a
 * machine, the e2e builds included).
 */
export function cacheScope(env: Record<string, string | undefined> = process.env): string {
  switch (env.VERCEL_ENV) {
    case "production":
      return "production";
    case "preview":
      return `preview:${env.VERCEL_GIT_COMMIT_REF || env.VERCEL_DEPLOYMENT_ID || "unknown"}`;
    case undefined:
    case "":
      return "local";
    default:
      return env.VERCEL_ENV;
  }
}

/** JSON with every object's keys in order, so the same config always gives the same text. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** The shared club tables every competition's data is read with. */
const SHARED_TABLES = hash(stableJson({ overrides: TEAM_OVERRIDES, crests: CREST_FALLBACKS }));

/** A short fingerprint of what a competition's data is read with: its config and the shared club tables. */
export function configFingerprint(config: unknown): string {
  return hash(`${stableJson(config)}|${SHARED_TABLES}`);
}

/**
 * The key of a competition's data as read from ESPN: what it is ("league-data",
 * "cup-data"…), the parser version, the cache scope, the provider, the
 * competition's code, its season ("current-2026" for the season being played
 * as of now, or the years asked for) and its config's fingerprint.
 */
export function espnDataKey(
  kind: string,
  code: string,
  season: string,
  config: unknown,
  env: Record<string, string | undefined> = process.env,
  version: number = ESPN_PARSER_VERSION,
): string[] {
  return [kind, `parser-${version}`, cacheScope(env), "espn", code, season, configFingerprint(config)];
}
