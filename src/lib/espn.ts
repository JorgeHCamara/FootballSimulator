import type { Fixture, Team } from "../engine/types.ts";

// Client for ESPN's public site API: the only source for competitions
// football-data.org's free tier doesn't cover (Brasileirão Série B) and the
// fallback for every other league. The feed is unofficial and undocumented: it
// needs no key, but its shape may change without notice.

const BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer";

export interface EspnCompetitor {
  homeAway: "home" | "away";
  score?: string;
  /** Penalty shoot-out goals, for a knockout game decided on penalties. */
  shootoutScore?: number | string;
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
  /** The season the game belongs to, by its starting year (2026 = 2026/27). */
  season?: { year: number; slug?: string };
  status: { type: { name: string; state: string; completed: boolean } };
  competitions: { competitors: EspnCompetitor[] }[];
}

export interface EspnCalendarEntry {
  label: string;
  startDate: string;
  endDate: string;
}

export interface EspnScoreboard {
  events: EspnEvent[];
  leagues?: {
    season?: { year: number };
    /** Cup rounds (or league phases) with their date windows. */
    calendar?: { entries?: EspnCalendarEntry[] }[];
  }[];
}

export class EspnError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Every event in one calendar year (ESPN's "dates" filter accepts a plain year, not a range). */
export async function fetchEspnYear(slug: string, year: number, init: RequestInit = {}): Promise<EspnScoreboard> {
  const res = await fetch(`${BASE_URL}/${slug}/scoreboard?dates=${year}&limit=1000`, init);
  if (!res.ok) throw new EspnError(res.status, `ESPN ${slug} ${year}: HTTP ${res.status}`);
  return (await res.json()) as EspnScoreboard;
}

interface EspnStandings {
  children?: { name: string; standings?: { entries?: { team: { id: string } }[] } }[];
}

/** Separate tables of a league (MLS conferences) from ESPN's standings feed. */
export async function fetchEspnGroups(
  slug: string,
  year: number,
  init: RequestInit = {},
): Promise<{ name: string; teamIds: number[] }[]> {
  const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${slug}/standings?season=${year}`, init);
  if (!res.ok) throw new EspnError(res.status, `ESPN ${slug} standings ${year}: HTTP ${res.status}`);
  const data = (await res.json()) as EspnStandings;
  return (data.children ?? []).map((group) => ({
    name: group.name,
    teamIds: (group.standings?.entries ?? []).map((e) => Number(e.team.id)),
  }));
}

/**
 * Every event of the season starting in `year`. A split season (2026/27) spans
 * two calendar years, each of which also holds games of a neighbouring season,
 * so both years are fetched and filtered by the season ESPN tags each game with.
 */
export async function fetchEspnSeason(
  slug: string,
  year: number,
  seasons: "split" | "calendar",
  init: RequestInit = {},
): Promise<EspnEvent[]> {
  const years = seasons === "split" ? [year, year + 1] : [year];
  const boards = await Promise.all(years.map((y) => fetchEspnYear(slug, y, init)));
  const byId = new Map<string, EspnEvent>();
  for (const event of boards.flatMap((b) => b.events ?? [])) {
    if (event.season && event.season.year !== year) continue;
    byId.set(event.id, event);
  }
  return [...byId.values()];
}

/** Placeholder sides for knockout games whose teams aren't decided yet. */
const isPlaceholder = (c: EspnCompetitor) => /^TBD\b/i.test(c.team.displayName) || !/^\d+$/.test(c.team.id);

/** Games that may be listed again under a new date. */
const REPLACEABLE_STATUSES = new Set(["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_ABANDONED", "STATUS_SUSPENDED"]);

interface LeagueMatch {
  event: EspnEvent;
  home: EspnCompetitor;
  away: EspnCompetitor;
}

/** Games with both sides known (abandoned or postponed ones stay, without a result). */
function leagueMatches(events: readonly EspnEvent[]): LeagueMatch[] {
  const out: LeagueMatch[] = [];
  for (const event of events) {
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
 * ESPN sometimes keeps a postponed, abandoned or cancelled game next to its
 * rescheduled replacement. Drops such a game when the same home/away pairing appears again later
 * (a play-off rematch of a league pairing is a different, later game, so it stays).
 */
export function dropReplacedPostponements(events: readonly EspnEvent[]): EspnEvent[] {
  const pairing = (e: EspnEvent) => {
    const competitors = e.competitions[0]?.competitors ?? [];
    const side = (s: "home" | "away") => competitors.find((c) => c.homeAway === s)?.team.id;
    return `${side("home")}-${side("away")}`;
  };
  const latest = new Map<string, string>();
  for (const e of events) {
    const key = pairing(e);
    if ((latest.get(key) ?? "") < e.date) latest.set(key, e.date);
  }
  return events.filter((e) => !REPLACEABLE_STATUSES.has(e.status.type.name) || latest.get(pairing(e))! <= e.date);
}

interface Game {
  home: number;
  away: number;
  time: number;
}

/** Each game in the earliest round where neither team has played yet. */
function greedyRounds(games: readonly Game[]): number[] {
  const busy = new Map<number, Set<number>>();
  const rounds = (team: number) => busy.get(team) ?? busy.set(team, new Set()).get(team)!;
  return games.map((g) => {
    let round = 0;
    while (rounds(g.home).has(round) || rounds(g.away).has(round)) round++;
    rounds(g.home).add(round);
    rounds(g.away).add(round);
    return round;
  });
}

const DAY_MS = 86_400_000;

/**
 * Rebuilds a league's rounds (0-based) when the number of rounds is known.
 * ESPN doesn't publish round numbers, and games moved for cup ties or TV are
 * played out of order, so each round gets an expected date (the median date of
 * every club's n-th game) and each game goes to the closest round in which
 * neither club already plays. Games left over are placed by swapping two rounds
 * along a chain of games (a Kempe chain), keeping every club to one game per round.
 */
export function assignRounds(games: readonly Game[], roundCount: number): number[] {
  const teams = [...new Set(games.flatMap((g) => [g.home, g.away]))];
  const datesByTeam = new Map(teams.map((t) => [t, [] as number[]]));
  for (const g of games) {
    datesByTeam.get(g.home)!.push(g.time);
    datesByTeam.get(g.away)!.push(g.time);
  }
  for (const dates of datesByTeam.values()) dates.sort((a, b) => a - b);

  const anchors: number[] = [];
  for (let r = 0; r < roundCount; r++) {
    const nth = [...datesByTeam.values()].flatMap((d) => (r < d.length ? [d[r]!] : [])).sort((a, b) => a - b);
    const median = nth.length ? nth[Math.floor(nth.length / 2)]! : (anchors[r - 1] ?? 0) + 7 * DAY_MS;
    anchors.push(Math.max(median, anchors[r - 1] ?? -Infinity));
  }
  const cost = (g: Game, r: number) => Math.abs(g.time - anchors[r]!);

  /** slot.get(team)[round] = index of the game that team plays in that round. */
  const slot = new Map(teams.map((t) => [t, new Array<number | undefined>(roundCount)]));
  const round = new Array<number>(games.length).fill(-1);
  const place = (i: number, r: number) => {
    round[i] = r;
    slot.get(games[i]!.home)![r] = i;
    slot.get(games[i]!.away)![r] = i;
  };
  const isFree = (team: number, r: number) => slot.get(team)![r] === undefined;

  // 1. Closest free round first, over every (game, round) pair.
  const options: [number, number, number][] = [];
  games.forEach((g, i) => {
    for (let r = 0; r < roundCount; r++) options.push([cost(g, r), i, r]);
  });
  options.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [, i, r] of options) {
    if (round[i] === -1 && isFree(games[i]!.home, r) && isFree(games[i]!.away, r)) place(i, r);
  }

  // 2. Leftovers: free a common round by swapping rounds a and b along a chain.
  const byCost = (g: Game) => [...Array(roundCount).keys()].sort((x, y) => cost(g, x) - cost(g, y));
  for (let i = 0; i < games.length; i++) {
    if (round[i] !== -1) continue;
    const g = games[i]!;
    const freeHome = byCost(g).filter((r) => isFree(g.home, r));
    const freeAway = byCost(g).filter((r) => isFree(g.away, r));
    const common = freeHome.find((r) => isFree(g.away, r));
    if (common !== undefined) {
      place(i, common);
      continue;
    }
    swap: for (const a of freeHome) {
      tryB: for (const b of freeAway) {
        // Walk from the away club: its round-a game, then the next club's round-b game, …
        const chain: number[] = [];
        let team = g.away;
        let colour = a;
        while (true) {
          const j = slot.get(team)![colour];
          if (j === undefined) break;
          if (chain.includes(j) || chain.length > games.length) continue tryB;
          chain.push(j);
          const other = games[j]!.home === team ? games[j]!.away : games[j]!.home;
          if (other === g.home) continue tryB; // would clash with the home club
          team = other;
          colour = colour === a ? b : a;
        }
        for (const j of chain) {
          slot.get(games[j]!.home)![round[j]!] = undefined;
          slot.get(games[j]!.away)![round[j]!] = undefined;
        }
        for (const j of chain) place(j, round[j] === a ? b : a);
        place(i, a);
        break swap;
      }
    }
    // 3. Never happens for a valid schedule; keep the game in its closest round.
    if (round[i] === -1) round[i] = byCost(g)[0]!;
  }
  return round;
}

/**
 * Calendar weeks (Monday to Sunday, UTC) numbered from the first week with a
 * game; weeks without games (e.g. a World Cup break) are skipped.
 */
function weeklyRounds(games: readonly Game[]): number[] {
  const weekOf = (time: number) => Math.floor((time / DAY_MS + 3) / 7); // the Unix epoch was a Thursday
  const weeks = [...new Set(games.map((g) => weekOf(g.time)))].sort((a, b) => a - b);
  const index = new Map(weeks.map((w, i) => [w, i]));
  return games.map((g) => index.get(weekOf(g.time))!);
}

export interface EspnFixtureOptions {
  /** A league's full number of rounds: rounds are rebuilt by expected round dates. */
  roundCount?: number;
  /** Group by calendar week instead (leagues without fixed rounds, like MLS). */
  weekly?: boolean;
}

/**
 * Maps ESPN events to fixtures. ESPN doesn't say which round a game belongs to,
 * so rounds are rebuilt: by calendar week, with `roundCount` by expected round
 * dates, otherwise in kick-off order.
 */
export function espnFixtures(events: readonly EspnEvent[], { roundCount, weekly }: EspnFixtureOptions = {}): Fixture[] {
  const matches = leagueMatches(dropReplacedPostponements(events)).sort(
    (a, b) => a.event.date.localeCompare(b.event.date) || Number(a.event.id) - Number(b.event.id),
  );
  const games = matches.map(({ event, home, away }) => ({
    home: Number(home.team.id),
    away: Number(away.team.id),
    time: Date.parse(event.date),
  }));
  const rounds = weekly ? weeklyRounds(games) : roundCount ? assignRounds(games, roundCount) : greedyRounds(games);

  return matches.map(({ event, home, away }, i) => {
    const finished = event.status.type.completed && event.status.type.state === "post";
    const homeGoals = Number(home.score);
    const awayGoals = Number(away.score);
    const hasScore = home.score !== undefined && away.score !== undefined && Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
    return {
      id: Number(event.id),
      matchday: rounds[i]! + 1,
      utcDate: event.date,
      homeId: games[i]!.home,
      awayId: games[i]!.away,
      result: finished && hasScore ? { home: homeGoals, away: awayGoals } : null,
      ...(finished && hasScore && homeGoals === awayGoals && home.shootoutScore != null && away.shootoutScore != null
        ? { penalties: { home: Number(home.shootoutScore), away: Number(away.shootoutScore) } }
        : {}),
    };
  });
}

/**
 * Splits a season into league games and the knockout games played after them
 * (e.g. a promotion play-off), using each club's game count: once a club has
 * played `leagueGamesPerTeam`, its later games are post-season.
 */
export function espnSplitSeason(events: readonly EspnEvent[], leagueGamesPerTeam: number) {
  const played = new Map<string, number>();
  events = dropReplacedPostponements(events);
  const league: EspnEvent[] = [];
  const postseason: EspnEvent[] = [];
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id));
  for (const event of sorted) {
    const ids = (event.competitions[0]?.competitors ?? []).map((c) => c.team.id);
    const isLeague = ids.length === 2 && ids.every((id) => (played.get(id) ?? 0) < leagueGamesPerTeam);
    if (isLeague) {
      for (const id of ids) played.set(id, (played.get(id) ?? 0) + 1);
      league.push(event);
    } else {
      postseason.push(event);
    }
  }
  return { league, postseason };
}
