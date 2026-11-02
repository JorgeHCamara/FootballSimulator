import { expectedGoals, simulateScore } from "./match.ts";
import { seedByGroupPlace, simulatePlayoff, tieOutcome, type BracketOptions, type PlayoffConfig, type PlayoffTie } from "./playoffs.ts";
import type { LeagueModel } from "./ratings.ts";
import { createRng } from "./rng.ts";
import { computeStandings, type StandingsOptions } from "./standings.ts";
import type { Fixture, ResultMap, StandingRow, Team, TeamId } from "./types.ts";

export interface MonteCarloInput {
  teams: readonly Team[];
  fixtures: readonly Fixture[];
  /** Results treated as fixed (real results plus the user's own predictions). */
  fixed: ResultMap;
  model: LeagueModel;
  standings: StandingsOptions;
  iterations: number;
  seed: number;
  /**
   * Separate tables within the league (MLS conferences): each run ranks every
   * group on its own, and positions are within the team's group.
   */
  groups?: readonly (readonly TeamId[])[];
  /**
   * Also play the knockout phase after each run's table (UEFA): real knockout
   * results stand, everything else is simulated. With `groups`, only for a
   * knockout seeded from the group places (`seedFromGroups`, Libertadores).
   */
  /**
   * Clubs whose places pass down (qualified by another route): zone chances
   * then use positions among the other clubs (see `zonePositionCounts`).
   */
  passDown?: readonly TeamId[];
  playoff?: {
    config: PlayoffConfig;
    options: Omit<BracketOptions, "seasonComplete">;
    /** Clubs joining the knockout phase from another competition (see `seedFromGroups.external`). */
    external?: readonly StandingRow[];
  };
}

export interface MonteCarloResult {
  iterations: number;
  /** positionCounts[teamId][p] = number of runs the team finished in position p+1 (within its group, if any). */
  positionCounts: Record<TeamId, number[]>;
  averagePoints: Record<TeamId, number>;
  /** With `passDown`: zonePositionCounts[teamId][p] = runs at position p+1 among clubs not passing down. */
  zonePositionCounts?: Record<TeamId, number[]>;
  /** With `playoff`: playoffReached[teamId][r] = runs the club played in knockout round r. */
  playoffReached?: Record<TeamId, number[]>;
  /** With `playoff`: runs the club won the knockout phase. */
  playoffWins?: Record<TeamId, number>;
}

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const { teams, fixtures, fixed, model, standings, iterations } = input;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const tables = input.groups?.length
    ? input.groups.map((ids) => ids.flatMap((id) => byId.get(id) ?? []))
    : [teams];
  const rng = createRng(input.seed);
  const remaining = fixtures
    .filter((f) => !fixed[f.id])
    .map((f) => ({ id: f.id, xg: expectedGoals(model, f.homeId, f.awayId) }));

  const positionCounts: Record<TeamId, number[]> = {};
  const pointsTotal: Record<TeamId, number> = {};
  for (const t of teams) {
    const size = tables.find((table) => table.includes(t))?.length ?? teams.length;
    positionCounts[t.id] = new Array<number>(size).fill(0);
    pointsTotal[t.id] = 0;
  }

  const tableOptions: StandingsOptions = { ...standings, includeForm: false };
  const results: ResultMap = { ...fixed };
  const grouped = Boolean(input.groups?.length);
  const playoff = !grouped || input.playoff?.config.seedFromGroups ? input.playoff : undefined;
  const passDown = new Set(input.passDown ?? []);
  const zonePositionCounts: Record<TeamId, number[]> = {};
  if (passDown.size) for (const t of teams) zonePositionCounts[t.id] = new Array<number>(teams.length).fill(0);
  const playoffReached: Record<TeamId, number[]> = {};
  const playoffWins: Record<TeamId, number> = {};
  for (let i = 0; i < iterations; i++) {
    for (const r of remaining) results[r.id] = simulateScore(r.xg, rng);
    const groupRows: ReturnType<typeof computeStandings>[] = [];
    for (const group of tables) {
      const rows = computeStandings(group, fixtures, results, tableOptions);
      let zonePosition = 0;
      for (const row of rows) {
        positionCounts[row.teamId]![row.position - 1]!++;
        pointsTotal[row.teamId]! += row.points;
        if (passDown.size && !passDown.has(row.teamId)) zonePositionCounts[row.teamId]![zonePosition++]!++;
      }
      groupRows.push(rows);
    }
    if (playoff) {
      const seeding = playoff.config.seedFromGroups;
      const rows = grouped ? seedByGroupPlace(groupRows, playoff.external, seeding?.places, seeding?.interleave) : groupRows[0]!;
      // The bracket only needs the table and knockout results (real ones come with the options).
      const roundCount = playoff.config.rounds.length;
      let final: PlayoffTie | undefined;
      const played = simulatePlayoff(rows, playoff.config, {}, input.model, rng, playoff.options, (r, ties) => {
        for (const tie of ties) {
          for (const id of [tie.higher.teamId, tie.lower.teamId]) {
            if (id !== null) (playoffReached[id] ??= new Array<number>(roundCount).fill(0))[r]!++;
          }
        }
        if (r === roundCount - 1) final = ties[0];
      });
      const winner = final ? tieOutcome(final, played)?.winner : undefined;
      if (winner !== undefined) playoffWins[winner] = (playoffWins[winner] ?? 0) + 1;
    }
  }

  const averagePoints: Record<TeamId, number> = {};
  for (const t of teams) averagePoints[t.id] = iterations > 0 ? pointsTotal[t.id]! / iterations : 0;
  return {
    iterations,
    positionCounts,
    averagePoints,
    ...(passDown.size ? { zonePositionCounts } : {}),
    ...(playoff ? { playoffReached, playoffWins } : {}),
  };
}

/**
 * Probability that a team finishes within positions [from, to] (1-based,
 * inclusive); with `zone`, positions among the clubs not passing down.
 */
export function probabilityInRange(result: MonteCarloResult, teamId: TeamId, from: number, to: number, zone = false): number {
  const counts = (zone && result.zonePositionCounts ? result.zonePositionCounts : result.positionCounts)[teamId];
  if (!counts || result.iterations === 0) return 0;
  let n = 0;
  for (let p = from; p <= to; p++) n += counts[p - 1] ?? 0;
  return n / result.iterations;
}
