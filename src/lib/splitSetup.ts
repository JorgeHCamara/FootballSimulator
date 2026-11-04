import type { LeagueConfig } from "../config/leagues.ts";
import { playoffIds } from "../engine/playoffs.ts";
import { allSplitFixtureIds } from "../engine/split.ts";
import { sortFixtures } from "../engine/standings.ts";
import type { Fixture, Team } from "../engine/types.ts";

/**
 * How a league's season is set up for the simulator, from its config and data
 * alone (not the predictions), so the simulator in the browser, the share
 * page and the share card agree. Kept free of server-only data.
 */

type Groups = readonly { id: string; teamIds: readonly number[] }[] | undefined;

/** ESPN's groups, when the league has groups and they're published. */
export const realGroupsOf = (league: LeagueConfig, groups: Groups) => (league.groups && groups?.length ? groups : undefined);

/**
 * A split league whose split isn't published yet can have its split's games
 * generated: a set last round that is the last one out, or (by default) the
 * last round out once every club has a full double round robin.
 */
export function canGenerateSplit(league: LeagueConfig, fixtures: readonly Fixture[], teams: readonly Team[], groups: Groups): boolean {
  const split = league.split;
  const last = sortFixtures(fixtures).at(-1);
  if (!split || !last || realGroupsOf(league, groups)) return false;
  if (split.afterRound !== undefined) return last.matchday === split.afterRound;
  const games = new Map<number, number>();
  for (const f of fixtures) for (const id of [f.homeId, f.awayId]) games.set(id, (games.get(id) ?? 0) + 1);
  return teams.every((tm) => (games.get(tm.id) ?? 0) >= 2 * (teams.length - 1));
}

/**
 * The last round of a split's first phase: set, or (once ESPN has the
 * groups) the last round with a game between two groups, or the last round out.
 */
export function splitRoundOf(league: LeagueConfig, fixtures: readonly Fixture[], groups: Groups): number {
  const split = league.split;
  if (!split) return 0;
  if (split.afterRound !== undefined) return split.afterRound;
  const real = realGroupsOf(league, groups);
  if (real) {
    const groupOf = new Map(real.flatMap((g) => g.teamIds.map((id) => [id, g.id] as const)));
    return Math.max(0, ...fixtures.filter((f) => groupOf.get(f.homeId) !== groupOf.get(f.awayId)).map((f) => f.matchday));
  }
  return sortFixtures(fixtures).at(-1)?.matchday ?? 0;
}

/**
 * Every fixture a share code can hold a score for: the real ones, the
 * play-off legs and, while a split can be generated, every game it could
 * hold. Their ids, sorted, index the code (see shareCodec), so it only
 * depends on the data, not on who qualifies.
 */
export function shareFixtureList(league: LeagueConfig, fixtures: readonly Fixture[], teams: readonly Team[], groups: Groups): Fixture[] {
  const extra = [
    ...(league.playoff ? playoffIds(league.playoff) : []),
    ...(canGenerateSplit(league, fixtures, teams, groups) ? allSplitFixtureIds(teams.map((t) => t.id)) : []),
  ];
  return [...fixtures, ...extra.map((id) => ({ id, matchday: 0, utcDate: "", homeId: 0, awayId: 0, result: null }))];
}

/**
 * Leagues whose share link opens a predicted final table with its own card:
 * one table over the season (splits included). Conferences (MLS), annual
 * tables over several tournaments (Argentina) and continental competitions
 * share their league page with the scenario instead (?r=).
 */
export function shareCardSupported(league: LeagueConfig): boolean {
  return !league.continental && !league.annual && (!league.groups || Boolean(league.split));
}
