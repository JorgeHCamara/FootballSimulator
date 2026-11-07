import { seedByGroupPlace } from "../engine/playoffs.ts";
import { balancedDoubleRoundRobin } from "../engine/schedule.ts";
import { buildSplitPhase, groupRoundKey, splitFixtures, splitGroupTable, type SplitGroupConfig } from "../engine/split.ts";
import { computeStandings, sortFixtures, type StandingsOptions } from "../engine/standings.ts";
import type { Fixture, ResultMap, StandingRow, Team, TeamId } from "../engine/types.ts";

/*
 * Brazil's Série C in My World (src/lib/myWorld.ts): a league of two phases
 * and a final, whose size grows as the CBF set it for 2026–2029. Its first
 * phase is a table (or two), its second phase groups of four home and away,
 * the top two of each going up to Série B and the group winners playing the
 * final over two legs (the better campaign hosting the second; level on
 * aggregate, penalties). The site's split-league engine (src/engine/split.ts)
 * plays the phases, as on the Série C page.
 *
 * - 2026: 20 clubs, one round robin (19 games each); its 1st, 4th, 5th and 8th
 *   make one group, its 2nd, 3rd, 6th and 7th the other; the bottom two down.
 * - 2027: 24 clubs, the same way (23 games each); the bottom two down.
 * - 2028 on: 28 clubs in two groups of 14, home and away (26 games each); each
 *   group's top four play a group of four; the bottom three of each group go
 *   down. (The CBF announced the groups, the four promoted, two from each
 *   group, and the six relegated; how the four are decided after the groups
 *   wasn't published, so the second phase is the 2026 one within each group.)
 *
 * Six clubs come up from Série D every year: 20 + 6 − 2 = 24, 24 + 6 − 2 = 28,
 * then six each way. (The groups are regional in real life; a world's are
 * drawn in turn by rating, the stronger clubs spread across both.)
 */

export interface SerieCFormat {
  clubs: number;
  /** First-phase tables: one round robin, or two groups. */
  groups: 1 | 2;
  /** Each pairing of the first phase plays once, or home and away. */
  legs: 1 | 2;
  /** Clubs relegated from the bottom of each first-phase table. */
  relegated: number;
  /** Clubs coming up from Série D at the season's end. */
  arrivals: number;
}

const FORMATS: readonly { from: number; format: SerieCFormat }[] = [
  { from: 2026, format: { clubs: 20, groups: 1, legs: 1, relegated: 2, arrivals: 6 } },
  { from: 2027, format: { clubs: 24, groups: 1, legs: 1, relegated: 2, arrivals: 6 } },
  { from: 2028, format: { clubs: 28, groups: 2, legs: 2, relegated: 3, arrivals: 6 } },
];

/** Série C's format in a season (the 2026 one before it). */
export const serieCFormat = (year: number): SerieCFormat => [...FORMATS].reverse().find((f) => f.from <= year)?.format ?? FORMATS[0]!.format;

/** The divisions played this way. */
export const SPLIT_DIVISIONS = ["BSC"] as const;
export const isSplitDivision = (code: string) => (SPLIT_DIVISIONS as readonly string[]).includes(code);

/** One round robin: the second phase's groups of four, by first-phase place. */
export const SECOND_PHASE: readonly SplitGroupConfig[] = [
  { size: 4, legs: 2, carryOver: 0, places: [1, 4, 5, 8] },
  { size: 4, legs: 2, carryOver: 0, places: [2, 3, 6, 7] },
];
/** Two first-phase groups: each one's top four. */
const TOP_FOUR: SplitGroupConfig = { size: 4, legs: 2, carryOver: 0 };

/** The last round of the first phase. */
export const firstPhaseRounds = (format: SerieCFormat) => (format.groups === 1 ? format.clubs - 1 : 2 * (format.clubs / 2 - 1));

/** Two first-phase groups drawn in turn from the clubs, strongest first: A, B, B, A, A, B… */
export function serieCGroups(byStrength: readonly TeamId[]): TeamId[][] {
  const groups: TeamId[][] = [[], []];
  byStrength.forEach((id, i) => groups[[0, 1, 1, 0][i % 4]!]!.push(id));
  return groups;
}

/** A generated season's first phase: one round robin (the first half of a balanced double one), or each group's double round robin, ids apart. */
export function serieCFixtures(clubs: readonly TeamId[], format: SerieCFormat, startDate: string, groups?: readonly (readonly TeamId[])[]): Fixture[] {
  if (format.groups === 1) return balancedDoubleRoundRobin(clubs, startDate).filter((f) => f.matchday <= clubs.length - 1);
  return (groups ?? serieCGroups(clubs)).flatMap((ids, g) => balancedDoubleRoundRobin(ids, startDate).map((f) => ({ ...f, id: (g + 1) * 1000 + f.id })));
}

/** A second-phase place standing in for a club not known yet: "1st" (one table), or a group's place. */
export const serieCSlot = (group: number | null, place: number): TeamId => -((group === null ? 0 : (group + 1) * 100) + place);
const SLOT_FIXTURE_BASE = 3_100_000_000;

export interface SerieCPhase {
  format: SerieCFormat;
  /** The first phase's games. */
  firstFixtures: Fixture[];
  /** Its table, or each group's. */
  firstTables: StandingRow[][];
  /** Its clubs in their groups (two groups), as given. */
  firstGroups: TeamId[][];
  firstComplete: boolean;
  /** The second phase's groups, once the first phase is complete. */
  members: TeamId[][] | null;
  /** The second phase's games, by group round (groupRoundKey); places standing in for the clubs before the groups are known. */
  secondFixtures: Fixture[];
  secondTables: StandingRow[][];
  secondComplete: boolean;
  /** The second phase's clubs ranked for the final (group winners first, by campaign). */
  finalRows: StandingRow[];
  /** The first phase's relegated clubs, once it's complete. */
  relegated: TeamId[];
  /** Each place standing in for a club: its group (null: the one table) and place. */
  slots: Map<TeamId, { group: number | null; place: number }>;
}

/**
 * A Série C season's phases from its first-phase games (with any real
 * second-phase games of a world's first season) and the scores so far.
 */
export function serieCPhase(input: {
  teams: readonly Team[];
  fixtures: readonly Fixture[];
  results: ResultMap;
  format: SerieCFormat;
  groups?: readonly (readonly TeamId[])[];
  options: StandingsOptions;
  groupOptions: StandingsOptions;
}): SerieCPhase {
  const { teams, results, format, options, groupOptions } = input;
  const afterRound = firstPhaseRounds(format);
  const slots = new Map<TeamId, { group: number | null; place: number }>();
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  if (format.groups === 1) {
    const phase = buildSplitPhase({ teams, fixtures: input.fixtures, results, groups: SECOND_PHASE, afterRound, options });
    const secondTables = phase.members ? phase.members.map((_, g) => splitGroupTable(phase, g, teams, results, groupOptions)) : [];
    const secondFixtures = phase.groupFixtures.flat();
    for (const f of secondFixtures) for (const id of [f.homeId, f.awayId]) if (id < 0) slots.set(id, { group: null, place: -id });
    const secondComplete = Boolean(phase.members) && secondFixtures.every((f) => results[f.id]);
    return {
      format,
      firstFixtures: phase.firstPhase,
      firstTables: [phase.firstTable],
      firstGroups: [teams.map((t) => t.id)],
      firstComplete: phase.complete,
      members: phase.members,
      secondFixtures,
      secondTables,
      secondComplete,
      finalRows: phase.members ? seedByGroupPlace(secondTables, [], 1, false, phase.firstTable) : [],
      relegated: phase.complete ? phase.firstTable.slice(-format.relegated).map((r) => r.teamId) : [],
      slots,
    };
  }
  // Two first-phase groups, home and away; each group's top four play a group of four.
  const firstGroups = (input.groups ?? serieCGroups(teams.map((t) => t.id))).map((ids) => [...ids]);
  const firstFixtures = input.fixtures.filter((f) => f.matchday <= afterRound);
  const firstComplete = firstFixtures.length > 0 && firstFixtures.every((f) => results[f.id]);
  const firstTables = firstGroups.map((ids) => {
    const own = new Set(ids);
    return computeStandings(ids.flatMap((id) => teamMap.get(id) ?? []), firstFixtures.filter((f) => own.has(f.homeId) && own.has(f.awayId)), results, { ...options, includeForm: false });
  });
  const lastDate = firstFixtures.reduce((max, f) => (f.utcDate > max ? f.utcDate : max), "");
  const numbered = (group: number, games: readonly Fixture[]) => games.map((f) => ({ ...f, matchday: groupRoundKey(group, f.matchday - afterRound) }));
  const members = firstComplete ? firstTables.map((table) => table.slice(0, 4).map((r) => r.teamId)) : null;
  const secondFixtures = members
    ? members.flatMap((ids, g) => numbered(g, splitFixtures([ids], [TOP_FOUR], afterRound, lastDate)))
    : firstGroups.flatMap((_, g) => {
        const ids = [1, 2, 3, 4].map((place) => serieCSlot(g, place));
        ids.forEach((id, i) => slots.set(id, { group: g, place: i + 1 }));
        return numbered(g, splitFixtures([ids], [TOP_FOUR], afterRound, lastDate)).map((f) => ({ ...f, id: SLOT_FIXTURE_BASE - f.homeId * 1000 - f.awayId }));
      });
  const campaign = firstTables.flat();
  const secondTables = members
    ? members.map((ids, g) => {
        const own = new Set(ids);
        return computeStandings(
          ids.flatMap((id) => teamMap.get(id) ?? []),
          secondFixtures.filter((f) => own.has(f.homeId) && own.has(f.awayId)),
          results,
          { ...groupOptions, includeForm: false, fallbackOrder: firstTables[g]!.map((r) => r.teamId) },
        );
      })
    : [];
  return {
    format,
    firstFixtures,
    firstTables,
    firstGroups,
    firstComplete,
    members,
    secondFixtures,
    secondTables,
    secondComplete: Boolean(members) && secondFixtures.every((f) => results[f.id]),
    finalRows: members ? seedByGroupPlace(secondTables, [], 1, false, campaign) : [],
    relegated: firstComplete ? firstTables.flatMap((table) => table.slice(-format.relegated).map((r) => r.teamId)) : [],
    slots,
  };
}

/** Every league game of the season: the first phase's and the second phase's. */
export const serieCLeagueFixtures = (phase: SerieCPhase): Fixture[] => sortFixtures([...phase.firstFixtures, ...phase.secondFixtures]);

/**
 * The season's final classification, as saved: the two finalists (the
 * champion first, once known), the rest of the second phase by place and
 * campaign, then the first phase's other clubs by place (the two groups' alike
 * places together, by points), each club with its record over both phases.
 */
export function serieCClassification(phase: SerieCPhase, teams: readonly Team[], results: ResultMap, options: StandingsOptions, champion?: TeamId): StandingRow[] {
  const totals = new Map(computeStandings(teams, serieCLeagueFixtures(phase), results, { ...options, includeForm: false }).map((r) => [r.teamId, r]));
  const second = phase.members ? seedByGroupPlace(phase.secondTables, [], Infinity, false, phase.firstTables.flat()).map((r) => r.teamId) : [];
  if (champion !== undefined && second[1] === champion) [second[0], second[1]] = [second[1]!, second[0]!];
  const inSecond = new Set(second);
  const rest = phase.firstTables
    .flatMap((table) => table.filter((r) => !inSecond.has(r.teamId)))
    .sort((a, b) => a.position - b.position || b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.teamId - b.teamId)
    .map((r) => r.teamId);
  return [...second, ...rest].map((id, i) => ({ ...totals.get(id)!, position: i + 1 }));
}

/** A table of Série C's season, with its places' colours, for the page. */
export interface SerieCTable {
  /** "first" (one table), "firstGroup" (two groups), "second" (a group of four). */
  kind: "first" | "firstGroup" | "second";
  /** Its group, 0 or 1 (none for the one first-phase table). */
  group: number | null;
  rows: StandingRow[];
  zones: { kind: "promotionPlayoff" | "promotion" | "relegation"; from: number; to: number }[];
}

/** The season's tables: the first phase's (one, or each group's), then the second phase's groups once known. */
export function serieCTables(phase: SerieCPhase): SerieCTable[] {
  const { format } = phase;
  const first: SerieCTable[] = phase.firstTables.map((rows, g) => {
    const size = phase.firstGroups[g]?.length ?? rows.length;
    const through = format.groups === 1 ? 8 : 4;
    return {
      kind: format.groups === 1 ? "first" : "firstGroup",
      group: format.groups === 1 ? null : g,
      rows,
      zones: [
        { kind: "promotionPlayoff", from: 1, to: through },
        { kind: "relegation", from: size - format.relegated + 1, to: size },
      ],
    };
  });
  const second: SerieCTable[] = phase.secondTables.map((rows, g) => ({ kind: "second", group: g, rows, zones: [{ kind: "promotion", from: 1, to: 2 }] }));
  return [...first, ...second];
}

/** The final classification's colours: the four promoted, the relegated at the bottom. */
export const serieCFinalZones = (year: number, clubs: number) => {
  const { groups, relegated } = serieCFormat(year);
  const down = groups * relegated;
  return [
    { kind: "promotion" as const, from: 1, to: 4 },
    { kind: "relegation" as const, from: clubs - down + 1, to: clubs },
  ];
};
