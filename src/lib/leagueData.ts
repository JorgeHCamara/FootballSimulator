import type { LeagueConfig } from "../config/leagues.ts";
import { applyTeamOverrides } from "../config/teamOverrides.ts";
import type { Fixture, Team } from "../engine/types.ts";
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
}

/** Server responses are cached for an hour, well inside the free tier's rate limit. */
const REVALIDATE_SECONDS = 3600;

let warnedMissingKey = false;

const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";

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
  const fixtures = mapMatches(matches);
  if (fixtures.length === 0) throw new Error(`No fixtures returned for ${league.code}`);
  const season = seasonOf(matches) ?? {
    id: 0,
    startDate: fixtures[0]!.utcDate,
    endDate: fixtures.at(-1)!.utcDate,
  };
  return {
    teams: applyTeamOverrides(teamsFromMatches(matches)),
    fixtures,
    season: seasonLabel(season),
    seasonKey: `${league.code}:${season.id || season.startDate.slice(0, 4)}`,
    source: "live",
  };
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
 * Real data from football-data.org when FOOTBALL_DATA_API_KEY is set, otherwise a
 * generated sample league so the site still runs locally. If the API fails during
 * a build the sample league is used; during runtime regeneration the error is
 * thrown so the previously generated (real) page stays in place.
 */
export async function getLeagueData(league: LeagueConfig): Promise<LeagueData> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey && process.env.NODE_ENV === "production" && !warnedMissingKey) {
    warnedMissingKey = true;
    console.warn("FOOTBALL_DATA_API_KEY is not set: serving generated sample leagues instead of real data.");
  }
  if (apiKey) {
    try {
      return await loadLive(league, apiKey);
    } catch (error) {
      const reason = error instanceof FootballDataError ? `HTTP ${error.status}` : String(error);
      // At runtime (hourly regeneration) fail instead: Next.js keeps serving the
      // last good page rather than caching sample data over real data.
      if (process.env.NODE_ENV === "production" && !isBuildPhase()) {
        throw new Error(`football-data.org failed for ${league.code} (${reason}); keeping the previous page`);
      }
      console.error(`Falling back to sample data for ${league.code} (${reason}):`, error);
    }
  }
  return loadSample(league);
}
