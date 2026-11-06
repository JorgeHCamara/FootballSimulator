// First-party leagues: the site's own committed data, never a feed. Série C
// 2026 was imported once from the CBF (scripts/import-serie-c.ts) into
// src/data/serie-c/2026.json, crests included (public/crests/serie-c): loading
// the league reads that file and nothing else, so no request leaves the site
// for its games or crests.
import type { LeagueConfig } from "../config/leagues.ts";
import { splitFixtureId } from "../engine/split.ts";
import type { Fixture, Team, TeamId } from "../engine/types.ts";
import serieC2026 from "../data/serie-c/2026.json" with { type: "json" };
import type { LeagueData } from "./leagueData.ts";

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

const SEASONS: Record<string, Record<number, FirstPartySeason>> = {
  BSC: { 2026: serieC2026 as FirstPartySeason },
};

/** A first-party league's committed season, or undefined (not first-party, or no such season). */
export function firstPartySeason(league: LeagueConfig, year = league.firstParty?.season): FirstPartySeason | undefined {
  if (!league.firstParty || year === undefined) return undefined;
  return SEASONS[league.code]?.[year];
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
