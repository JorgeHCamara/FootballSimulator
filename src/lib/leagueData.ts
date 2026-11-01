import type { LeagueConfig } from "../config/leagues.ts";
import { applyTeamOverrides } from "../config/teamOverrides.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { EspnError, espnFixtures, espnSplitSeason, espnTeams, fetchEspnSeason } from "./espn.ts";
import { FootballDataError, fetchMatches, mapMatches, seasonOf, teamsFromMatches, type ApiSeason } from "./footballData.ts";
import { sampleLeague } from "./sampleLeague.ts";

export interface LeagueData {
  teams: Team[];
  fixtures: Fixture[];
  /** Display label, e.g. "2026/27" or "2026". */
  season: string;
  /** Stable key for saved predictions: a new season starts with a clean slate. */
  seasonKey: string;
  source: "live" | "sample";
  /** Real post-season games (e.g. play-off legs) once the feed lists them. */
  postseason?: Fixture[];
}

/** Server responses are cached for an hour, well inside the free tier's rate limit. */
const REVALIDATE_SECONDS = 3600;

const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";

const inflight = new Map<string, Promise<LeagueData>>();

export function seasonLabel(season: Pick<ApiSeason, "startDate" | "endDate">): string {
  const start = season.startDate.slice(0, 4);
  const end = season.endDate.slice(0, 4);
  return start === end ? start : `${start}/${end.slice(2)}`;
}

async function loadLive(league: LeagueConfig, apiKey: string): Promise<LeagueData> {
  // One request per league: teams and season come embedded in the matches.
  // Build workers fetch in parallel and can hit the 10 requests/minute limit, so
  // the build waits for the limit to reset. At runtime a stale page is fine, so fail fast.
  const { matches } = await fetchMatches(
    league.code,
    apiKey,
    { next: { revalidate: REVALIDATE_SECONDS, tags: [`league:${league.code}`] } },
    { maxRetries: isBuildPhase() ? 2 : 0 },
  );
  // Knockout games after the regular season (e.g. Championship play-offs) feed the
  // play-off bracket instead of the table.
  const isLeague = (m: (typeof matches)[number]) => !m.stage || m.stage === "REGULAR_SEASON";
  const fixtures = mapMatches(matches.filter(isLeague));
  const postseason = mapMatches(matches.filter((m) => !isLeague(m)).map((m) => ({ ...m, matchday: m.matchday ?? 0 })));
  if (fixtures.length === 0) throw new Error(`No fixtures returned for ${league.code}`);
  const season = seasonOf(matches) ?? {
    id: 0,
    startDate: fixtures[0]!.utcDate,
    endDate: fixtures.at(-1)!.utcDate,
  };
  return {
    teams: applyTeamOverrides(teamsFromMatches(matches.filter(isLeague)), { league: league.code }),
    fixtures,
    season: seasonLabel(season),
    seasonKey: `${league.code}:${season.id || season.startDate.slice(0, 4)}`,
    source: "live",
    ...(postseason.length ? { postseason } : {}),
  };
}

/** The season currently being played, by its starting year (2026 = 2026/27). */
function currentSeasonYear(league: LeagueConfig, now = new Date()): number {
  const year = now.getUTCFullYear();
  // Split seasons start in August; from June on, try the new season first.
  return league.espn.seasons === "split" && now.getUTCMonth() < 5 ? year - 1 : year;
}

/**
 * ESPN's public feed: the main source for every league (no key, no tight rate
 * limit). football-data.org is the fallback, except for Série B.
 * Until at least half of a new season's fixtures are published, the previous
 * season is shown.
 */
async function loadEspn(league: LeagueConfig): Promise<LeagueData> {
  const { slug, seasons } = league.espn;
  const init = { next: { revalidate: REVALIDATE_SECONDS, tags: [`league:${league.code}`] } };
  const current = currentSeasonYear(league);
  for (const year of [current, current - 1]) {
    const all = await fetchEspnSeason(slug, year, seasons, init);
    // Games after a club's full league schedule are post-season (play-offs);
    // they feed the play-off bracket, or are left out when the site has none.
    const { league: events, postseason } = espnSplitSeason(all, (league.teams - 1) * 2);
    const fixtures = espnFixtures(events, (league.teams - 1) * 2);
    // A season has teams × (teams − 1) games; skip a year until at least half are published.
    if (fixtures.length < (league.teams * (league.teams - 1)) / 2) continue;
    const label = seasons === "split" ? `${year}/${String(year + 1).slice(2)}` : String(year);
    return {
      teams: applyTeamOverrides(espnTeams(events), { league: league.code }),
      fixtures,
      season: label,
      // ESPN and football-data.org use different match ids, so each source keeps
      // its own saved predictions (Série B has only ever used ESPN).
      seasonKey: league.espnOnly ? `${league.code}:${year}` : `${league.code}:espn:${year}`,
      source: "live",
      ...(league.playoff && postseason.length ? { postseason: espnFixtures(postseason) } : {}),
    };
  }
  throw new Error(`No ${league.code} fixtures on ESPN for ${current} or ${current - 1}`);
}

function loadSample(league: LeagueConfig): LeagueData {
  const { teams, fixtures } = sampleLeague(league);
  const year = new Date().getUTCFullYear();
  return {
    teams,
    fixtures,
    season: `${year}`,
    seasonKey: `${league.code}:sample`,
    source: "sample",
  };
}

/**
 * Real data, in order of preference: ESPN's public feed, then football-data.org
 * (when FOOTBALL_DATA_API_KEY is set and the league is in its free tier). Generated
 * sample leagues are only used for local development and tests (offline, or
 * FOOTSIMU_SAMPLE_DATA=1). If every source fails during runtime regeneration the
 * error is thrown, so the previously generated (real) page stays in place; on a
 * Vercel build it fails the deployment, so the live site keeps its real data.
 */
export function getLeagueData(league: LeagueConfig): Promise<LeagueData> {
  // Share one request per league across the 3 language versions of its page and
  // their metadata. During a build the result is kept for the whole build; at
  // runtime only while the request is in flight, so hourly refreshes still fetch.
  const pending = inflight.get(league.code);
  if (pending) return pending;
  const promise = loadLeagueData(league);
  inflight.set(league.code, promise);
  const forget = () => {
    if (!isBuildPhase()) inflight.delete(league.code);
  };
  promise.then(forget, () => inflight.delete(league.code));
  return promise;
}

async function loadLeagueData(league: LeagueConfig): Promise<LeagueData> {
  if (process.env.FOOTSIMU_SAMPLE_DATA === "1") return loadSample(league);

  const sources: { name: string; load: () => Promise<LeagueData> }[] = [{ name: "ESPN", load: () => loadEspn(league) }];
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (apiKey && !league.espnOnly) sources.push({ name: "football-data.org", load: () => loadLive(league, apiKey) });

  const failures: string[] = [];
  for (const source of sources) {
    try {
      const data = await source.load();
      if (failures.length) console.warn(`${league.code}: using ${source.name} after ${failures.join("; ")}`);
      return data;
    } catch (error) {
      const reason = error instanceof FootballDataError || error instanceof EspnError ? `HTTP ${error.status}` : String(error);
      failures.push(`${source.name} failed (${reason})`);
    }
  }

  const summary = `${league.code}: ${failures.join("; ")}`;
  // Never publish made-up clubs: at runtime Next.js keeps serving the last good
  // page, and a failed Vercel build keeps the current deployment live.
  if (process.env.NODE_ENV === "production" && (!isBuildPhase() || process.env.VERCEL)) {
    throw new Error(`No real data for ${summary}`);
  }
  console.error(`Falling back to sample data for ${summary}`);
  return loadSample(league);
}
