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

/** Team as embedded in a match; fields are null for undecided slots. */
export interface ApiMatchTeam {
  id: number | null;
  name?: string | null;
  shortName?: string | null;
  tla?: string | null;
  crest?: string | null;
}

export interface ApiMatch {
  id: number;
  utcDate: string;
  status: ApiMatchStatus;
  matchday: number | null;
  season?: Pick<ApiSeason, "id" | "startDate" | "endDate">;
  homeTeam: ApiMatchTeam;
  awayTeam: ApiMatchTeam;
  score: { fullTime: { home: number | null; away: number | null } };
}

export interface ApiSeason {
  id: number;
  startDate: string;
  endDate: string;
  currentMatchday: number | null;
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

const MAX_RETRIES = 2;
const MAX_WAIT_SECONDS = 65;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET with the API key. On HTTP 429 (free tier: 10 requests/minute) waits until
 * the counter resets, as reported in X-RequestCounter-Reset, and retries.
 */
export async function request<T>(
  path: string,
  apiKey: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
  maxRetries = MAX_RETRIES,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      headers: { ...init.headers, "X-Auth-Token": apiKey },
    });
    if (res.status === 429 && attempt < maxRetries) {
      const reset = Number(res.headers.get("X-RequestCounter-Reset"));
      const seconds = Number.isFinite(reset) && reset >= 0 ? Math.min(reset + 1, MAX_WAIT_SECONDS) : MAX_WAIT_SECONDS;
      console.warn(`football-data.org rate limit on ${path}; retrying in ${seconds}s`);
      await sleep(seconds * 1000);
      continue;
    }
    if (!res.ok) throw new FootballDataError(res.status, `football-data.org ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

export const fetchMatches = (
  code: string,
  apiKey: string,
  init?: RequestInit,
  options: { fetchImpl?: typeof fetch; maxRetries?: number } = {},
) => request<ApiMatchesResponse>(`/competitions/${code}/matches`, apiKey, init, options.fetchImpl, options.maxRetries);

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
 * Builds the league's team list from its matches, so one request per league is
 * enough (the /teams endpoint would double the rate-limit cost).
 */
export function teamsFromMatches(matches: readonly ApiMatch[]): Team[] {
  const teams = new Map<number, Team>();
  for (const m of matches) {
    for (const t of [m.homeTeam, m.awayTeam]) {
      if (t.id === null || !t.name || teams.has(t.id)) continue;
      teams.set(t.id, mapTeam({ id: t.id, name: t.name, shortName: t.shortName ?? null, tla: t.tla ?? null, crest: t.crest ?? null }));
    }
  }
  return [...teams.values()];
}

/** The season the matches belong to (they all share it). */
export function seasonOf(matches: readonly ApiMatch[]): ApiMatch["season"] {
  return matches.find((m) => m.season)?.season;
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
