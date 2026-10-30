import type { Fixture, Team } from "../engine/types.ts";

// Minimal typed client for football-data.org v4 (free tier: 10 requests/minute).
// Docs: https://docs.football-data.org/general/v4/index.html

const BASE_URL = "https://api.football-data.org/v4";

export interface ApiTeam {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
  crest: string | null;
}

export type ApiMatchStatus =
  | "SCHEDULED"
  | "TIMED"
  | "IN_PLAY"
  | "PAUSED"
  | "FINISHED"
  | "SUSPENDED"
  | "POSTPONED"
  | "CANCELLED"
  | "AWARDED";

export interface ApiMatch {
  id: number;
  utcDate: string;
  status: ApiMatchStatus;
  matchday: number | null;
  homeTeam: { id: number | null };
  awayTeam: { id: number | null };
  score: { fullTime: { home: number | null; away: number | null } };
}

export interface ApiSeason {
  id: number;
  startDate: string;
  endDate: string;
  currentMatchday: number | null;
}

export interface ApiTeamsResponse {
  season: ApiSeason;
  teams: ApiTeam[];
}

export interface ApiMatchesResponse {
  matches: ApiMatch[];
}

export class FootballDataError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "X-Auth-Token": apiKey } });
  if (!res.ok) throw new FootballDataError(res.status, `football-data.org ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchTeams = (code: string, apiKey: string) =>
  request<ApiTeamsResponse>(`/competitions/${code}/teams`, apiKey);

export const fetchMatches = (code: string, apiKey: string) =>
  request<ApiMatchesResponse>(`/competitions/${code}/matches`, apiKey);

export function mapTeam(t: ApiTeam): Team {
  return {
    id: t.id,
    name: t.name,
    shortName: t.shortName ?? t.name,
    tla: t.tla ?? t.name.slice(0, 3).toUpperCase(),
    ...(t.crest ? { crest: t.crest } : {}),
  };
}

/**
 * Maps API matches to engine fixtures. Matches without both teams or a matchday
 * (e.g. undecided playoff slots) are dropped. Only FINISHED/AWARDED scores count
 * as real results; live scores are ignored until the match ends.
 */
export function mapMatches(matches: readonly ApiMatch[]): Fixture[] {
  const out: Fixture[] = [];
  for (const m of matches) {
    if (m.homeTeam.id === null || m.awayTeam.id === null || m.matchday === null) continue;
    if (m.status === "CANCELLED") continue;
    const { home, away } = m.score.fullTime;
    const finished = (m.status === "FINISHED" || m.status === "AWARDED") && home !== null && away !== null;
    out.push({
      id: m.id,
      matchday: m.matchday,
      utcDate: m.utcDate,
      homeId: m.homeTeam.id,
      awayId: m.awayTeam.id,
      result: finished ? { home, away } : null,
    });
  }
  return out;
}
