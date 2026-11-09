import { cache } from "react";
import { getLeagueBySlug, LEAGUES, type LeagueConfig } from "../config/leagues.ts";
import type { Fixture, Team, TeamId } from "../engine/types.ts";
import { hasClubPages } from "./clubs.ts";
import { unstable_cache } from "next/cache.js";
import { getLeagueData, getPastSeasonData, leagueDataKeepSeconds, noDataCache } from "./leagueData.ts";
import { dataTag } from "./sharedOutlook.ts";
import { pastRound, readArchivedRound } from "./oddsArchive.ts";
import { buildReport, latestReportPath, readSnapshots, reportGames, reportPath, seasonReports, type OddsReport } from "./oddsReports.ts";

export interface LoadedReport {
  league: LeagueConfig;
  report: OddsReport;
  /** The games played between the report's snapshot and the one before (results for its sentences); none when the league's data didn't load. */
  games: Fixture[];
  /** Every club in the report, by id (last season's too, for an older season's report). */
  teams: Map<TeamId, Team>;
  /** Is it the season's latest report? */
  latest: boolean;
}

/**
 * Tags a report read from the league's live data with the league's data tag,
 * and keeps it no longer than the data (leagueDataKeepSeconds): a tiny entry
 * read on every such render. The data's own read does both, except when the
 * render reuses another's read in flight, which tags only the other page;
 * the past rounds' route is otherwise kept for 30 days (oddsArchive.ts).
 */
async function markLiveReport(code: string): Promise<void> {
  try {
    await unstable_cache(async () => code, ["odds-live-report", code], { tags: [dataTag(code)], revalidate: leagueDataKeepSeconds() })();
  } catch (error) {
    if (!noDataCache(error)) throw error;
  }
}

/**
 * A league's report for a round (its latest without one), or undefined: an
 * unknown league, one without reports, or a round with none. Shared by the
 * page, its metadata and its card within a request.
 *
 * A past round (any but the season's latest) is read from its archive entry
 * (src/lib/oddsArchive.ts), not from the league's live data, so new results
 * don't rebuild it; the latest report, and a round the archive can't place,
 * read the live data as before.
 */
export const loadReport = cache(async (leagueSlug: string, round?: number): Promise<LoadedReport | undefined> => {
  const league = getLeagueBySlug(leagueSlug);
  if (!league || !hasClubPages(league)) return undefined;
  if (round !== undefined) {
    const past = pastRound(league, await readSnapshots(league.code), round);
    const archived = past && (await readArchivedRound(league, past.report));
    if (past && archived) return { league, report: past.report, games: archived.games, teams: new Map(archived.teams.map((t) => [t.id, t])), latest: false };
  }
  const [file, data] = await Promise.all([readSnapshots(league.code), getLeagueData(league).catch(() => undefined), markLiveReport(league.code)]);
  const season = seasonReports(file, data?.seasonKey);
  if (!season) return undefined;
  const report = buildReport(league, season, round);
  if (!report) return undefined;
  const teams = new Map((data?.teams ?? []).map((t) => [t.id, t]));
  // An older season's report: its clubs that have left the league since.
  const missing = report.rows.some((r) => !teams.has(r.teamId));
  if (missing && data?.seasonYear !== undefined) {
    const past = await getPastSeasonData(league, data.seasonYear - 1);
    for (const t of past?.teams ?? []) if (!teams.has(t.id)) teams.set(t.id, { ...t, slug: undefined, page: undefined } as Team);
  }
  return { league, report, games: data ? reportGames(report, data) : [], teams, latest: report.snapshot.round === season.snapshots.at(-1)!.round };
});

/** Every report's address (without the locale), and each league's latest-report page, for the sitemap. */
export async function reportPaths(): Promise<{ latest: string[]; rounds: { path: string; date: string }[] }> {
  const leagues = LEAGUES.filter(hasClubPages);
  const latest: string[] = [];
  const rounds: { path: string; date: string }[] = [];
  await Promise.all(
    leagues.map(async (league) => {
      const season = seasonReports(await readSnapshots(league.code));
      if (!season) return;
      // The season's first report has no changes (noindex): left out, as is the latest page while it's the only one.
      if (season.snapshots.length > 1) latest.push(latestReportPath(league));
      for (const s of season.snapshots.slice(1)) rounds.push({ path: reportPath(league, s.round), date: s.date });
    }),
  );
  return { latest, rounds };
}

/** The hub's list: each league with reports, its latest round and its leader in the race the reports follow. */
export async function latestReports(): Promise<LoadedReport[]> {
  const loaded = await Promise.all(LEAGUES.filter(hasClubPages).map((l) => loadReport(l.slug).catch(() => undefined)));
  return loaded.flatMap((r) => (r ? [r] : []));
}
