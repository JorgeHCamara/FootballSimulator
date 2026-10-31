import type { Fixture, Team } from "../engine/types.ts";

// Client for ESPN's public site API, used for competitions football-data.org's
// free tier doesn't cover (Brasileirão Série B). The feed is unofficial and
// undocumented: it needs no key, but its shape may change without notice.

const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer";

export interface EspnCompetitor {
  homeAway: "home" | "away";
  score?: string;
  team: {
    id: string;
    displayName: string;
    shortDisplayName?: string;
    abbreviation?: string;
    logo?: string;
  };
}

export interface EspnEvent {
  id: string;
  date: string;
  season?: { year: number };
  status: { type: { name: string; state: string; completed: boolean } };
  competitions: { competitors: EspnCompetitor[] }[];
}

export interface EspnScoreboard {
  events: EspnEvent[];
}

export class EspnError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every event of one season (ESPN's "dates" filter accepts a plain year). */
export async function fetchEspnSeason(slug: string, year: number, init: RequestInit = {}): Promise<EspnScoreboard> {
  const res = await fetch(`${BASE_URL}/${slug}/scoreboard?dates=${year}&limit=1000`, init);
  if (!res.ok) throw new EspnError(res.status, `ESPN ${slug} ${year}: HTTP ${res.status}`);
  return (await res.json()) as EspnScoreboard;
}

/** Placeholder sides for knockout games whose teams aren't decided yet. */
const isPlaceholder = (c: EspnCompetitor) => /^TBD\b/i.test(c.team.displayName) || !/^\d+$/.test(c.team.id);

const DROPPED_STATUSES = new Set(["STATUS_CANCELED", "STATUS_ABANDONED", "STATUS_FORFEIT"]);

interface LeagueMatch {
  event: EspnEvent;
  home: EspnCompetitor;
  away: EspnCompetitor;
}

/** League games only: both sides known, not cancelled. */
function leagueMatches(events: readonly EspnEvent[]): LeagueMatch[] {
  const out: LeagueMatch[] = [];
  for (const event of events) {
    if (DROPPED_STATUSES.has(event.status.type.name)) continue;
    const competitors = event.competitions[0]?.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away || isPlaceholder(home) || isPlaceholder(away)) continue;
    out.push({ event, home, away });
  }
  return out;
}

export function espnTeams(events: readonly EspnEvent[]): Team[] {
  const teams = new Map<number, Team>();
  for (const { home, away } of leagueMatches(events)) {
    for (const { team } of [home, away]) {
      const id = Number(team.id);
      if (teams.has(id)) continue;
      teams.set(id, {
        id,
        name: team.displayName,
        shortName: team.shortDisplayName ?? team.displayName,
        tla: team.abbreviation ?? team.displayName.slice(0, 3).toUpperCase(),
        ...(team.logo ? { crest: team.logo } : {}),
      });
    }
  }
  return [...teams.values()];
}

/**
 * Maps ESPN events to fixtures. ESPN doesn't say which round a game belongs to,
 * so rounds are rebuilt in kick-off order: each game goes in the earliest round
 * where neither team has played yet. A postponed game therefore returns to its
 * original round instead of creating a new one.
 */
export function espnFixtures(events: readonly EspnEvent[]): Fixture[] {
  const matches = leagueMatches(events).sort(
    (a, b) => a.event.date.localeCompare(b.event.date) || Number(a.event.id) - Number(b.event.id),
  );
  const roundsByTeam = new Map<number, Set<number>>();
  const busy = (teamId: number) => {
    let rounds = roundsByTeam.get(teamId);
    if (!rounds) roundsByTeam.set(teamId, (rounds = new Set()));
    return rounds;
  };

  return matches.map(({ event, home, away }) => {
    const homeId = Number(home.team.id);
    const awayId = Number(away.team.id);
    let round = 1;
    while (busy(homeId).has(round) || busy(awayId).has(round)) round++;
    busy(homeId).add(round);
    busy(awayId).add(round);

    const finished = event.status.type.completed && event.status.type.state === "post";
    const homeGoals = Number(home.score);
    const awayGoals = Number(away.score);
    const hasScore = home.score !== undefined && away.score !== undefined && Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
    return {
      id: Number(event.id),
      matchday: round,
      utcDate: event.date,
      homeId,
      awayId,
      result: finished && hasScore ? { home: homeGoals, away: awayGoals } : null,
    };
  });
}
