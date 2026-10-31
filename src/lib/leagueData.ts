import type { LeagueConfig } from "../config/leagues.ts";
import { applyTeamOverrides } from "../config/teamOverrides.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { fetchMatches, fetchTeams, mapMatches, mapTeam, type ApiSeason } from "./footballData.ts";
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

export function seasonLabel(season: Pick<ApiSeason, "startDate" | "endDate">): string {
  const start = season.startDate.slice(0, 4);
  const end = season.endDate.slice(0, 4);
  return start === end ? start : `${start}/${end.slice(2)}`;
}

async function loadLive(league: LeagueConfig, apiKey: string): Promise<LeagueData> {
  const init = { next: { revalidate: REVALIDATE_SECONDS, tags: [`league:${league.code}`] } };
  const [teamsRes, matchesRes] = await Promise.all([
    fetchTeams(league.code, apiKey, init),
    fetchMatches(league.code, apiKey, init),
  ]);
  return {
    teams: applyTeamOverrides(teamsRes.teams.map(mapTeam)),
    fixtures: mapMatches(matchesRes.matches),
    season: seasonLabel(teamsRes.season),
    seasonKey: `${league.code}:${teamsRes.season.id}`,
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
 * generated sample league so the site still runs (e.g. locally, or if the API is down).
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
      console.error(`Falling back to sample data for ${league.code}:`, error);
    }
  }
  return loadSample(league);
}
