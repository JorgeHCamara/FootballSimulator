// First-party leagues: the site's own committed data, never a feed. Série C
// 2026 was imported once from the CBF (scripts/import-serie-c.ts) into
// src/data/serie-c/2026.json, crests included (public/crests/serie-c); Primera
// B 2026 (Colombia) is imported by hand when it should be brought up to date
// (scripts/import-primera-b.ts) into src/data/primera-b/2026.json, crests in
// public/crests/primera-b. Loading the league reads that file and nothing
// else, so no request leaves the site for its games or crests.
import type { LeagueConfig } from "../config/leagues.ts";
import { splitFixtureId } from "../engine/split.ts";
import type { Fixture, Team, TeamId } from "../engine/types.ts";
import { realResults } from "../engine/results.ts";
import { computeStandings } from "../engine/standings.ts";
import serieC2026 from "../data/serie-c/2026.json" with { type: "json" };
import primeraB2026 from "../data/primera-b/2026.json" with { type: "json" };
import type { LeagueData, Tournament } from "./leagueData.ts";

/** A row of an official table, as the CBF published it. */
export interface OfficialRow {
  position: number;
  clubId: number;
  cbfName: string;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  yellowCards: number;
  redCards: number;
}

/** A committed season (see scripts/import-serie-c.ts). */
export interface FirstPartySeason {
  season: string;
  clubs: { id: number; name: string; tla: string; state: string; cbfName: string; crest: string }[];
  games: {
    id: number;
    number: number;
    /** The first phase (the table), the second (the groups) or the final. */
    phase: "first" | "second" | "final";
    group: string;
    round: number;
    kickoff: string;
    venue: string;
    homeId: number;
    awayId: number;
    score: { home: number; away: number };
    penalties?: { home: number; away: number };
  }[];
  /** The CBF's own tables, to check the data against (the first phase's, then each second-phase group's). */
  official: { firstPhase: OfficialRow[]; secondPhase: OfficialRow[][] };
}

/** A row of one of the article's tables (Primera B), as Wikipedia published it. */
export interface ArticleRow {
  position: number;
  clubId: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

/** A committed season of several tournaments (see scripts/import-primera-b.ts). */
export interface TournamentsSeason {
  season: string;
  clubs: { id: number; name: string; shortName?: string; tla: string; crest: string }[];
  /** Each tournament's groups (by its number), as drawn. */
  groups: Record<string, Record<string, number[]>>;
  games: {
    /** 1, 2: the tournaments (in the config's tournaments, oldest first); 3: the season's promotion games. */
    tournament: number;
    phase: "first" | "second" | "final" | "grandFinal" | "playoff";
    group?: string;
    round: number;
    kickoff: string;
    /** Not set by the league yet: a few days after the round before. */
    estimated?: boolean;
    venue: string;
    homeId: number;
    awayId: number;
    score: { home: number; away: number } | null;
    penalties?: { home: number; away: number };
  }[];
  /** The source's own tables, to check the data against: each tournament's round robin and groups, and the aggregate table. */
  article: { "1": Record<string, ArticleRow[]>; "2": Record<string, ArticleRow[]>; aggregate: ArticleRow[] };
}

const SEASONS: Record<string, Record<number, FirstPartySeason>> = {
  BSC: { 2026: serieC2026 as FirstPartySeason },
};
const TOURNAMENT_SEASONS: Record<string, Record<number, TournamentsSeason>> = {
  COLB: { 2026: primeraB2026 as TournamentsSeason },
};

/** A first-party league's committed season, or undefined (not first-party, or no such season). */
export function firstPartySeason(league: LeagueConfig, year = league.firstParty?.season): FirstPartySeason | undefined {
  if (!league.firstParty || year === undefined) return undefined;
  return SEASONS[league.code]?.[year];
}

/** A first-party league's committed season of several tournaments (Primera B), or undefined. */
export function tournamentsSeason(league: LeagueConfig, year = league.firstParty?.season): TournamentsSeason | undefined {
  if (!league.firstParty?.tournaments || year === undefined) return undefined;
  return TOURNAMENT_SEASONS[league.code]?.[year];
}

/**
 * A game's id in a season of tournaments: from its tournament, phase and
 * clubs (by their place in the data's club list), so it stays the same
 * whatever order the source lists the games in; well clear of the play-off
 * legs' ids (PLAYOFF_ID_BASE).
 */
export function tournamentGameId(tournament: number, phase: TournamentsSeason["games"][number]["phase"], home: number, away: number, round = 0): number {
  const code = { first: 1, second: 2, final: 3, grandFinal: 4, playoff: 5 }[phase];
  return tournament * 1_000_000 + code * 100_000 + (phase === "first" || phase === "second" ? 0 : round * 10_000) + home * 100 + away;
}

/**
 * The league's data from a committed season of tournaments (Primera B): each
 * tournament's round robin, then its groups (rounds after it), its final as
 * post-season, and its groups as drawn (each group's head first); the
 * current tournament is the latest with games. The season's promotion games
 * (grand final, play-off) once played are `promotionGames`.
 */
function tournamentsData(league: LeagueConfig): LeagueData {
  const year = league.firstParty?.season;
  const season = tournamentsSeason(league);
  const stages = league.firstParty?.tournaments ?? [];
  if (!season || year === undefined) throw new Error(`${league.code}: no first-party season`);
  const teams: Team[] = season.clubs.map((c) => ({ id: c.id, name: c.name, shortName: c.shortName ?? c.name, tla: c.tla, crest: c.crest }));
  const index = new Map(season.clubs.map((c, i) => [c.id, i]));
  const afterRound = league.split?.afterRound ?? 0;
  const venues: Record<number, string> = {};
  const fixture = (g: TournamentsSeason["games"][number], matchday: number): Fixture => {
    const id = tournamentGameId(g.tournament, g.phase, index.get(g.homeId)!, index.get(g.awayId)!, g.round);
    venues[id] = g.venue;
    return {
      id,
      matchday,
      utcDate: g.kickoff,
      homeId: g.homeId,
      awayId: g.awayId,
      result: g.score ? { ...g.score } : null,
      ...(g.penalties ? { penalties: { ...g.penalties } } : {}),
    };
  };
  // Oldest first, as the data numbers them; the config lists them latest first.
  const oldestFirst = [...stages].reverse();
  const tournaments: Tournament[] = oldestFirst.flatMap((stage, i) => {
    const n = i + 1;
    const games = season.games.filter((g) => g.tournament === n);
    if (!games.length) return [];
    const fixtures = games.flatMap((g) => (g.phase === "first" ? [fixture(g, g.round)] : g.phase === "second" ? [fixture(g, afterRound + g.round)] : []));
    const postseason = games.filter((g) => g.phase === "final").map((g) => fixture(g, 0));
    // Each group's clubs, its head (the best placed in the round robin) first.
    const first = computeStandings(teams, fixtures.filter((f) => f.matchday <= afterRound), realResults(fixtures), { tiebreakers: league.tiebreakers, includeForm: false });
    const place = new Map(first.map((r) => [r.teamId, r.position]));
    const drawn = season.groups[String(n)] ?? {};
    const groups = (league.groups ?? []).flatMap((g) => {
      const ids = drawn[g.id];
      return ids?.length ? [{ id: g.id, teamIds: [...ids].sort((a, b) => (place.get(a) ?? 99) - (place.get(b) ?? 99)) }] : [];
    });
    return [
      {
        id: stage.table,
        name: stage.name ?? stage.table,
        season: `${stage.name ?? stage.table} ${year}`,
        fixtures,
        ...(postseason.length ? { postseason } : {}),
        seasonKey: `${league.code}:${year}:${stage.table}`,
        ...(groups.length ? { groups } : {}),
      },
    ];
  });
  const current = tournaments.at(-1);
  if (!current) throw new Error(`${league.code}: no tournament with games`);
  const promotionGames = season.games.filter((g) => g.tournament === 3).map((g) => ({ ...fixture(g, 0), phase: g.phase as "grandFinal" | "playoff" }));
  return {
    teams,
    fixtures: current.fixtures,
    season: current.season,
    seasonKey: current.seasonKey,
    seasonYear: year,
    source: "live",
    provider: "first-party",
    ...(current.postseason ? { postseason: current.postseason } : {}),
    ...(current.groups ? { groups: current.groups } : {}),
    // Latest first, as the config lists them.
    tournaments: [...tournaments].reverse(),
    venues,
    ...(promotionGames.length ? { promotionGames } : {}),
  };
}

/**
 * The league's data from its committed season: the first phase's games by
 * round, the second phase's after them (rounds 20–25, ids from their clubs as
 * the split's generated games have, so a prediction stays with the game
 * whoever ends up in which group) and the final's two legs as post-season.
 * Clubs level on every criterion the site counts are ordered by the CBF's
 * next ones, fewer red then fewer yellow cards in the first phase
 * (`fallbackOrder`).
 */
export function firstPartyData(league: LeagueConfig): LeagueData {
  if (league.firstParty?.tournaments) return tournamentsData(league);
  const year = league.firstParty?.season;
  const season = firstPartySeason(league);
  if (!season || year === undefined) throw new Error(`${league.code}: no first-party season`);
  const teams: Team[] = season.clubs.map((c) => ({ id: c.id, name: c.name, shortName: c.name, tla: c.tla, crest: c.crest }));
  const afterRound = league.split?.afterRound ?? 0;
  const fixture = (g: FirstPartySeason["games"][number], id: number, matchday: number): Fixture => ({
    id,
    matchday,
    utcDate: g.kickoff,
    homeId: g.homeId,
    awayId: g.awayId,
    result: { ...g.score },
    ...(g.penalties ? { penalties: { ...g.penalties } } : {}),
  });
  const fixtures = season.games.flatMap((g) =>
    g.phase === "first" ? [fixture(g, g.id, g.round)] : g.phase === "second" ? [fixture(g, splitFixtureId(g.homeId, g.awayId), afterRound + g.round)] : [],
  );
  const postseason = season.games.filter((g) => g.phase === "final").map((g) => fixture(g, g.id, 0));
  const venues: Record<number, string> = {};
  for (const g of season.games) venues[g.phase === "second" ? splitFixtureId(g.homeId, g.awayId) : g.id] = g.venue;
  // Fully level clubs: fewer red cards, then fewer yellow (then the CBF's draw: its table's order).
  const cards = [...season.official.firstPhase].sort((a, b) => a.redCards - b.redCards || a.yellowCards - b.yellowCards || a.position - b.position);
  const fallbackOrder: TeamId[] = cards.map((r) => r.clubId);
  return {
    teams,
    fixtures,
    season: season.season,
    seasonKey: `${league.code}:${year}`,
    seasonYear: year,
    source: "live",
    provider: "first-party",
    postseason,
    venues,
    fallbackOrder,
  };
}
