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

let warnedMissingKey = false;

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

/**
 * Leagues outside football-data.org's free tier come from ESPN's public feed.
 * Brazilian seasons follow the calendar year; before a new season's fixtures are
 * published, the previous season is shown.
 */
async function loadEspn(league: LeagueConfig, slug: string): Promise<LeagueData> {
  const init = { next: { revalidate: REVALIDATE_SECONDS, tags: [`league:${league.code}`] } };
  const thisYear = new Date().getUTCFullYear();
  for (const year of [thisYear, thisYear - 1]) {
    const { events: all } = await fetchEspnSeason(slug, year, init);
    // Keep play-off games out of the league table once their clubs are known.
    const { league: events, postseason } = league.playoff
      ? espnSplitSeason(all, (league.teams - 1) * 2)
      : { league: all, postseason: [] };
    const fixtures = espnFixtures(events);
    // A season has teams × (teams − 1) games; skip a year until at least half are published.
    if (fixtures.length < (league.teams * (league.teams - 1)) / 2) continue;
    return {
      teams: applyTeamOverrides(espnTeams(events), { league: league.code }),
      fixtures,
      season: String(year),
      seasonKey: `${league.code}:${year}`,
      source: "live",
      ...(postseason.length ? { postseason: espnFixtures(postseason) } : {}),
    };
  }
  throw new Error(`No ${league.code} fixtures on ESPN for ${thisYear} or ${thisYear - 1}`);
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
 * Real data from football-data.org when FOOTBALL_DATA_API_KEY is set (or from ESPN
 * for leagues configured with that source), otherwise a
 * generated sample league so the site still runs locally. If the API fails during
 * a build the sample league is used; during runtime regeneration the error is
 * thrown so the previously generated (real) page stays in place.
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
  const source = league.source ?? { provider: "football-data" };
  let loadReal: (() => Promise<LeagueData>) | undefined;
  if (source.provider === "espn") {
    loadReal = () => loadEspn(league, source.slug);
  } else {
    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey && process.env.NODE_ENV === "production" && !warnedMissingKey) {
      warnedMissingKey = true;
      console.warn("FOOTBALL_DATA_API_KEY is not set: serving generated sample leagues instead of real data.");
    }
    if (apiKey) loadReal = () => loadLive(league, apiKey);
  }

  if (loadReal) {
    try {
      return await loadReal();
    } catch (error) {
      const reason = error instanceof FootballDataError || error instanceof EspnError ? `HTTP ${error.status}` : String(error);
      // At runtime (hourly regeneration) fail instead: Next.js keeps serving the
      // last good page rather than caching sample data over real data.
      if (process.env.NODE_ENV === "production" && !isBuildPhase()) {
        throw new Error(`${source.provider} failed for ${league.code} (${reason}); keeping the previous page`);
      }
      console.error(`Falling back to sample data for ${league.code} (${reason}):`, error);
    }
  }
  return loadSample(league);
}
