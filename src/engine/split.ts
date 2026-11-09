import { doubleRoundRobin } from "./schedule.ts";
import { computeStandings, type StandingsOptions } from "./standings.ts";
import type { Fixture, FixtureId, ResultMap, StandingRow, Team, TeamId } from "./types.ts";

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
  /**
   * The first phase's places that make up the group, when they aren't the next
   * `size` (Série C: 1st, 4th, 5th and 8th in one group, 2nd, 3rd, 6th and 7th
   * in the other). Clubs at places no group names are out after the first
   * phase. Such groups always follow the first phase's table, predictions
   * included (see buildSplitPhase).
   */
  places?: readonly number[];
}

/** The split's groups are named places (Série C), not the table cut in order. */
export const placedGroups = (groups: readonly SplitGroupConfig[]) => groups.some((g) => g.places);

/** The first phase's places of each group: named, or the next `size` (the last group takes the rest of `teams`). */
export function groupPlaces(groups: readonly SplitGroupConfig[], teams: number): number[][] {
  let start = 0;
  return groups.map((group, i) => {
    if (group.places) return [...group.places].sort((a, b) => a - b);
    const size = i === groups.length - 1 ? teams - start : group.size;
    const places = Array.from({ length: size }, (_, k) => start + k + 1);
    start += group.size;
    return places;
  });
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
  if (placedGroups(groups)) return groupPlaces(groups, ids.length).map((places) => places.flatMap((p) => (ids[p - 1] === undefined ? [] : [ids[p - 1]!])));
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

/** Fixture-list rounds of a split's groups: group g's round r is (g + 1) × 1000 + r. */
export const GROUP_ROUND_BASE = 1000;
export const groupRoundKey = (group: number, round: number) => (group + 1) * GROUP_ROUND_BASE + round;
/** The group of a round key, or null for a first-phase matchday. */
export const groupOfRound = (key: number): number | null => (key >= GROUP_ROUND_BASE ? Math.floor(key / GROUP_ROUND_BASE) - 1 : null);

/** A place at the split before the clubs are known ("1st"), as a stand-in club id. */
export const slotTeamId = (place: number) => -place;
export const isSlotTeamId = (id: TeamId) => id < 0;
const SLOT_FIXTURE_BASE = 3_000_000_000;

export interface SplitPhaseInput {
  teams: readonly Team[];
  /** Real fixtures, first phase and (once published) the split's. */
  fixtures: readonly Fixture[];
  /** Real results with the user's predictions (any fixture id). */
  results: ResultMap;
  groups: readonly SplitGroupConfig[];
  /** Last round of the first phase. */
  afterRound: number;
  /** The groups' clubs once ESPN publishes them. */
  realGroups?: readonly (readonly TeamId[])[];
  /** The first phase's games by the feed's stage tag (a postponed one can be played during the split); else by round. */
  firstPhaseIds?: readonly FixtureId[];
  /** Options of the first phase's table (tiebreakers, deductions). */
  options: StandingsOptions;
}

export interface SplitPhase {
  /** The first phase's real fixtures. */
  firstPhase: Fixture[];
  /** Every first-phase game has a score. */
  complete: boolean;
  /** The first phase's table (its clubs' starting points and places for the groups). */
  firstTable: StandingRow[];
  /** Each group's clubs, once known (real groups, or the first phase complete). */
  members: TeamId[][] | null;
  /** Each group's games, real or generated, with round keys for matchdays; slot games while the clubs aren't known. */
  groupFixtures: Fixture[][];
  /** The groups' games are generated (no real ones yet). */
  generated: boolean;
  /** Each group's starting points, by club. */
  startPoints: Record<TeamId, number>[];
}

/**
 * A split league's second phase as separate tables (Greece's play-offs,
 * Ecuador's final stage): who is in each group, and each group's games
 * numbered as its own rounds. Real games once ESPN has them; otherwise
 * generated from the first phase's table once it is complete, and before
 * that games between places ("1st v 2nd") as stand-ins.
 */
export function buildSplitPhase(input: SplitPhaseInput): SplitPhase {
  const { teams, fixtures, results, groups, afterRound, options } = input;
  const tagged = input.firstPhaseIds?.length ? new Set(input.firstPhaseIds) : null;
  const isFirst = (f: Fixture) => (tagged ? tagged.has(f.id) : f.matchday <= afterRound);
  const firstPhase = fixtures.filter(isFirst);
  const later = fixtures.filter((f) => !isFirst(f));
  const complete = firstPhase.length > 0 && firstPhase.every((f) => results[f.id]);
  const firstTable = computeStandings(teams, firstPhase, results, { ...options, split: undefined, includeForm: false });
  const members = input.realGroups?.length
    ? input.realGroups.map((ids) => [...ids])
    : complete
      ? splitGroupsFrom(firstTable, groups)
      : null;
  const lastDate = firstPhase.reduce((max, f) => (f.utcDate > max ? f.utcDate : max), "");
  const numbered = (group: number, games: readonly Fixture[]) => {
    const rounds = [...new Set(games.map((f) => f.matchday))].sort((a, b) => a - b);
    return games.map((f) => ({ ...f, matchday: groupRoundKey(group, rounds.indexOf(f.matchday) + 1) }));
  };
  let groupFixtures: Fixture[][];
  let generated = false;
  // Named places (Série C): the groups follow the table, predictions
  // included, so a group can hold other clubs than the real one. Its real
  // games stand only while it is the real group (none of them is against a
  // club outside it); otherwise its games are generated.
  const regroup = placedGroups(groups);
  if (members && later.length) {
    groupFixtures = members.map((ids, g) => {
      const own = new Set(ids);
      if (regroup && later.some((f) => own.has(f.homeId) !== own.has(f.awayId))) {
        generated = true;
        return numbered(g, splitFixtures([ids], [groups[g]!], afterRound, lastDate));
      }
      return numbered(g, later.filter((f) => own.has(f.homeId) && own.has(f.awayId)));
    });
  } else if (members) {
    generated = true;
    groupFixtures = members.map((ids, g) => numbered(g, splitFixtures([ids], [groups[g]!], afterRound, lastDate)));
  } else {
    // Places at the split stand in for the clubs.
    const slots = groupPlaces(groups, teams.length).map((places) => places.map(slotTeamId));
    groupFixtures = slots.map((ids, g) =>
      numbered(
        g,
        splitFixtures([ids], [groups[g]!], afterRound, lastDate).map((f) => ({ ...f, id: SLOT_FIXTURE_BASE - f.homeId * 1000 - f.awayId })),
      ),
    );
  }
  const points = new Map(firstTable.map((r) => [r.teamId, r.points]));
  const startPoints = (members ?? []).map((ids, g) =>
    Object.fromEntries(ids.map((id) => [id, Math.ceil((points.get(id) ?? 0) * (groups[g]?.carryOver ?? 1))])),
  );
  return { firstPhase, complete, firstTable, members, groupFixtures, generated, startPoints };
}

/**
 * A group's table: its own games only, from its starting points; level clubs
 * by their place in the first phase. With the "seeded" criterion, the group's
 * head (its best-placed club in the first phase: Primera B's 1st and 2nd head
 * the two groups) prevails over the clubs level with it.
 */
export function splitGroupTable(phase: SplitPhase, group: number, teams: readonly Team[], results: ResultMap, options: StandingsOptions): StandingRow[] {
  const ids = phase.members?.[group];
  if (!ids) return [];
  const members = new Set(ids);
  const head = options.tiebreakers.includes("seeded") ? phase.firstTable.find((r) => members.has(r.teamId))?.teamId : undefined;
  return computeStandings(
    teams.filter((t) => members.has(t.id)),
    phase.groupFixtures[group] ?? [],
    results,
    {
      ...options,
      split: undefined,
      deductions: undefined,
      startPoints: phase.startPoints[group] ?? {},
      fallbackOrder: phase.firstTable.map((r) => r.teamId),
      ...(head !== undefined ? { seeded: [head] } : {}),
    },
  );
}
