import { cache } from "react";
import { getLeagueBySlug, LEAGUES, type LeagueConfig } from "../config/leagues.ts";
import type { Team, TeamId } from "../engine/types.ts";
import { hasClubPages } from "./clubs.ts";
import { getLeagueData, getPastSeasonData, type LeagueData } from "./leagueData.ts";
import { buildReport, latestReportPath, readSnapshots, reportPath, seasonReports, type OddsReport } from "./oddsReports.ts";

export interface LoadedReport {
  league: LeagueConfig;
  report: OddsReport;
  /** The league's current data (results for the report's sentences), when it loads. */
  data?: LeagueData;
  /** Every club in the report, by id (last season's too, for an older season's report). */
  teams: Map<TeamId, Team>;
  /** Is it the season's latest report? */
  latest: boolean;
}

/**
 * A league's report for a round (its latest without one), or undefined: an
 * unknown league, one without reports, or a round with none. Shared by the
 * page, its metadata and its card within a request.
 */
export const loadReport = cache(async (leagueSlug: string, round?: number): Promise<LoadedReport | undefined> => {
  const league = getLeagueBySlug(leagueSlug);
  if (!league || !hasClubPages(league)) return undefined;
  const [file, data] = await Promise.all([readSnapshots(league.code), getLeagueData(league).catch(() => undefined)]);
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
  return { league, report, ...(data ? { data } : {}), teams, latest: report.snapshot.round === season.snapshots.at(-1)!.round };
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
      latest.push(latestReportPath(league));
      for (const s of season.snapshots) rounds.push({ path: reportPath(league, s.round), date: s.date });
    }),
  );
  return { latest, rounds };
}

/** The hub's list: each league with reports, its latest round and its leader in the race the reports follow. */
export async function latestReports(): Promise<LoadedReport[]> {
  const loaded = await Promise.all(LEAGUES.filter(hasClubPages).map((l) => loadReport(l.slug).catch(() => undefined)));
  return loaded.flatMap((r) => (r ? [r] : []));
}
