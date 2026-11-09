// The file itself (".js"): these modules also run outside Next (scripts, tests), whose Node needs the extension.
import { unstable_cache } from "next/cache.js";
import type { LeagueConfig } from "../config/leagues.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { archiveTag } from "./archiveTag.ts";
import { cacheScope, configFingerprint } from "./dataCacheKey.ts";
import { noDataCache, uncachedLeagueData, type LeagueData } from "./leagueData.ts";
import { buildReport, reportGames, seasonReports, type OddsReport, type SeasonReports } from "./oddsReports.ts";
import type { LeagueSnapshots } from "./snapshots.ts";

/*
 * A past round's odds report (/{league}/odds/matchday-n, any round but the
 * season's latest) is built from things that don't change: its two snapshots
 * (committed files) and the games played between them. So its page reads
 * them from one small entry of the data cache, this file's, and nothing tagged
 * with the league's live data: new results (the revalidation route) leave it
 * alone, and it is kept for ARCHIVE_KEEP_SECONDS. The latest report, and any
 * round this can't place, keep reading the league's live data (oddsPage.ts).
 *
 * What it doesn't do: outlive a deployment as a page. Each deployment starts
 * Vercel's page cache afresh (and the daily snapshot commit deploys), so each
 * page is rendered once again after one, from this entry (no ESPN download,
 * no live data read); the entry itself outlives deployments.
 *
 * Corrections:
 * - A snapshot retaken (`npm run snapshots -- <CODE> --rebuild`) changes the
 *   entry's key (both snapshots are fingerprinted): it's read again on its own.
 * - A change to how a report is put together from the snapshots and games
 *   (buildReport, reportGames, the entry's shape, how clubs are named or
 *   linked): bump ODDS_ARCHIVE_VERSION. A league's config, TEAM_OVERRIDES and
 *   CREST_FALLBACKS are fingerprinted.
 * - A result ESPN corrected after the round's snapshot, with no snapshot
 *   retaken: expire the league's archive (archiveTag) through the revalidation
 *   route, `/api/revalidate/leagues?archive=PL` (or `archive=all`), or the
 *   "Refresh league pages" workflow's `archive` input; otherwise it's read
 *   again after ARCHIVE_KEEP_SECONDS.
 */

/** Bump when a past round's report would come out differently from the same snapshots and games (see above). */
export const ODDS_ARCHIVE_VERSION = 1;

/** How long a past round's entry, and its pages, are kept at most: a safety net for corrections nobody expired by hand. */
export const ARCHIVE_KEEP_SECONDS = 2_592_000;

export { archiveTag };

/** What a past round's report needs besides its snapshots: the games between them, and the clubs it names. */
export interface ArchivedRound {
  games: Fixture[];
  teams: Team[];
}

/**
 * A past round of the latest season (by its snapshots): its season and report, or
 * undefined for the season's latest round, a round with no snapshot, or no
 * snapshots at all (those go the live way).
 */
export function pastRound(league: LeagueConfig, file: LeagueSnapshots | undefined, round: number): { season: SeasonReports; report: OddsReport } | undefined {
  const season = seasonReports(file);
  if (!season || season.snapshots.at(-1)!.round === round) return undefined;
  const report = buildReport(league, season, round);
  return report ? { season, report } : undefined;
}

/** The entry's key: everything the entry is worked out from. */
export function archiveKey(league: LeagueConfig, report: OddsReport, env: Record<string, string | undefined> = process.env, version = ODDS_ARCHIVE_VERSION): string[] {
  const fingerprint = configFingerprint({ league, snapshot: report.snapshot, previous: report.previous ?? null });
  return ["odds-archive", `v${version}`, cacheScope(env), league.code, report.seasonKey, String(report.snapshot.round), fingerprint];
}

/** The round's games and clubs, from the league's data (and last season's, for clubs that have left since). */
export function archivedRound(report: OddsReport, data: LeagueData | undefined, past: LeagueData | undefined): ArchivedRound {
  const games = data ? reportGames(report, data) : [];
  const wanted = new Set([...report.rows.map((r) => r.teamId), ...games.flatMap((g) => [g.homeId, g.awayId])]);
  const teams = new Map<number, Team>();
  for (const t of data?.teams ?? []) if (wanted.has(t.id)) teams.set(t.id, t);
  // An older season's report: its clubs that have left the league since, without a page.
  for (const t of past?.teams ?? []) if (wanted.has(t.id) && !teams.has(t.id)) teams.set(t.id, { ...t, slug: undefined, page: undefined } as Team);
  return { games, teams: [...teams.values()] };
}

/** This server's straight-from-the-source reads for entries, a few minutes each: a crawler's visit to a league's past rounds downloads it once. */
const sources = new Map<string, Promise<LeagueData | undefined>>();
const SOURCE_KEEP_MS = 300_000;

function sourceData(league: LeagueConfig, year?: number): Promise<LeagueData | undefined> {
  const id = `${league.code}:${year ?? "current"}`;
  let promise = sources.get(id);
  if (!promise) {
    promise = uncachedLeagueData(league, year);
    sources.set(id, promise);
    const forget = () => setTimeout(() => sources.delete(id), SOURCE_KEEP_MS).unref?.();
    promise.then(forget, forget);
  }
  return promise;
}

/** Works out a past round's entry; throws when the league's data can't be read (nothing is stored then). */
async function workOut(league: LeagueConfig, report: OddsReport): Promise<ArchivedRound> {
  const data = await sourceData(league);
  if (!data) throw new Error(`${league.code}: no data for round ${report.snapshot.round}'s report`);
  const missing = report.rows.some((r) => !data.teams.some((t) => t.id === r.teamId));
  const past = missing && data.seasonYear !== undefined ? await sourceData(league, data.seasonYear - 1) : undefined;
  return archivedRound(report, data, past);
}

/**
 * A past round's games and clubs, from the data cache (worked out once and
 * stored there, tagged archiveTag only). Undefined when it can't be worked out
 * (the league's data didn't load): the page then goes the live way.
 */
export async function readArchivedRound(league: LeagueConfig, report: OddsReport): Promise<ArchivedRound | undefined> {
  const work = () => workOut(league, report);
  try {
    return await unstable_cache(work, archiveKey(league, report), { tags: [archiveTag(league.code)], revalidate: ARCHIVE_KEEP_SECONDS })();
  } catch (error) {
    if (noDataCache(error)) return work().catch(() => undefined);
    console.warn(`${league.code}: round ${report.snapshot.round}'s report from live data instead:`, error);
    return undefined;
  }
}
