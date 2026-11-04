import { doubleRoundRobin } from "./schedule.ts";
import type { Fixture, FixtureId, StandingRow, TeamId } from "./types.ts";

/**
 * A league that splits after a first phase (Greece's play-offs, Ecuador's final
 * stage, Scotland's split): until the real fixtures of the split are published,
 * they are generated from the table after the first phase.
 */

/** One group of the split: the next `size` places, playing each other `legs` times. */
export interface SplitGroupConfig {
  size: number;
  legs: 1 | 2;
  /** Share of the first phase's points the group starts with (Greece's Europe play-offs: 0.5, rounded up). */
  carryOver?: number;
}

/**
 * A generated game's id: from its two clubs, so a prediction stays with the
 * game whatever the places (a game between other clubs is another id).
 * Negative, clear of real ids and play-off legs.
 */
export function splitFixtureId(homeId: TeamId, awayId: TeamId): FixtureId {
  return -(homeId * 1_000_000 + awayId);
}

export const isSplitFixtureId = (id: FixtureId) => id < 0;

/** Every id a generated game between these clubs can have (for the share links). */
export function allSplitFixtureIds(teamIds: readonly TeamId[]): FixtureId[] {
  return teamIds.flatMap((home) => teamIds.filter((away) => away !== home).map((away) => splitFixtureId(home, away)));
}

/** The clubs of each group, in their order at the split; the last group takes the rest. */
export function splitGroupsFrom(atSplit: readonly StandingRow[], groups: readonly SplitGroupConfig[]): TeamId[][] {
  const ids = [...atSplit].sort((a, b) => a.position - b.position).map((r) => r.teamId);
  let start = 0;
  return groups.map((group, i) => {
    const members = i === groups.length - 1 ? ids.slice(start) : ids.slice(start, start + group.size);
    start += group.size;
    return members;
  });
}

/**
 * Each group's round robin after round `afterRound`, a round a week from
 * `afterDate`. Within a group the higher-placed clubs come first in the circle
 * method, so the pairings depend only on the places.
 */
export function splitFixtures(
  groupTeams: readonly (readonly TeamId[])[],
  groups: readonly SplitGroupConfig[],
  afterRound: number,
  afterDate: string,
): Fixture[] {
  const week = 7 * 24 * 60 * 60 * 1000;
  const start = Date.parse(afterDate) || Date.now();
  return groupTeams.flatMap((teams, i) => {
    const legs = groups[i]?.legs ?? 2;
    const rounds = teams.length - 1 + (teams.length % 2);
    return doubleRoundRobin(teams)
      .filter((f) => legs === 2 || f.matchday <= rounds)
      .map((f) => ({
        id: splitFixtureId(f.homeId, f.awayId),
        matchday: afterRound + f.matchday,
        utcDate: new Date(start + f.matchday * week).toISOString(),
        homeId: f.homeId,
        awayId: f.awayId,
        result: null,
      }));
  });
}
