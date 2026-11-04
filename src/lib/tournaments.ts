import type { EspnStages, LeagueConfig } from "../config/leagues.ts";
import { realChampion } from "../engine/playoffs.ts";
import { realResults } from "../engine/results.ts";
import { computeStandings } from "../engine/standings.ts";
import type { Fixture, Team, TeamId } from "../engine/types.ts";
import type { Tournament } from "./leagueData.ts";

/** A tournament's own format: the league's, with what its stage config changes. */
export function tournamentConfig(league: LeagueConfig, stage: EspnStages | undefined): LeagueConfig {
  if (!stage) return league;
  const playoff = stage.playoff === null ? undefined : (stage.playoff ?? league.playoff);
  return {
    ...league,
    ...(stage.gamesPerTeam ? { gamesPerTeam: stage.gamesPerTeam } : {}),
    ...(stage.zones ? { zones: stage.zones } : {}),
    ...(stage.groups ? { groups: stage.groups } : {}),
    playoff,
  };
}

/**
 * A tournament's champion from real results: its play-off final when it has a
 * play-off, else the leader once every game is played.
 */
export function tournamentChampion(config: LeagueConfig, teams: readonly Team[], tournament: Tournament): TeamId | null {
  if (config.playoff) return realChampion(tournament.postseason);
  if (tournament.fixtures.some((f) => !f.result)) return null;
  const clubs = new Set(tournament.fixtures.flatMap((f) => [f.homeId, f.awayId]));
  const table = computeStandings(
    teams.filter((t) => clubs.has(t.id)),
    tournament.fixtures,
    realResults(tournament.fixtures),
    { tiebreakers: config.tiebreakers, includeForm: false },
  );
  return table[0]?.teamId ?? null;
}

/**
 * The annual table's games: every tournament's regular phase (and, where it
 * counts, its real play-off games), later tournaments' rounds numbered after
 * the earlier ones'. Tournaments oldest first.
 */
export function annualFixtures(league: LeagueConfig & { annual: NonNullable<LeagueConfig["annual"]> }, ordered: readonly Tournament[]): Fixture[] {
  let offset = 0;
  const fixtures: Fixture[] = [];
  for (const tournament of ordered) {
    const rounds = Math.max(0, ...tournament.fixtures.map((f) => f.matchday));
    fixtures.push(...tournament.fixtures.map((f) => ({ ...f, matchday: f.matchday + offset })));
    if (league.annual.includePostseason) {
      fixtures.push(...(tournament.postseason ?? []).filter((f) => f.result).map((f) => ({ ...f, matchday: rounds + 1 + offset })));
    }
    offset += rounds + (league.annual.includePostseason && tournament.postseason?.length ? 1 : 0);
  }
  return fixtures;
}

/** The season's tournament stages (Argentina: Clausura, Apertura), latest first. */
export const tournamentStages = (league: LeagueConfig): readonly EspnStages[] =>
  league.espn.stages && !("table" in league.espn.stages) ? league.espn.stages : [];
