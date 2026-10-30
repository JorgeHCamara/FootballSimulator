import { expectedGoals, simulateScore } from "./match.ts";
import type { LeagueModel } from "./ratings.ts";
import { createRng } from "./rng.ts";
import { computeStandings, type StandingsOptions } from "./standings.ts";
import type { Fixture, ResultMap, Team, TeamId } from "./types.ts";

export interface MonteCarloInput {
  teams: readonly Team[];
  fixtures: readonly Fixture[];
  /** Results treated as fixed (real results plus the user's own predictions). */
  fixed: ResultMap;
  model: LeagueModel;
  standings: StandingsOptions;
  iterations: number;
  seed: number;
}

export interface MonteCarloResult {
  iterations: number;
  /** positionCounts[teamId][p] = number of runs the team finished in position p+1. */
  positionCounts: Record<TeamId, number[]>;
  averagePoints: Record<TeamId, number>;
}

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const { teams, fixtures, fixed, model, standings, iterations } = input;
  const rng = createRng(input.seed);
  const remaining = fixtures
    .filter((f) => !fixed[f.id])
    .map((f) => ({ id: f.id, xg: expectedGoals(model, f.homeId, f.awayId) }));

  const positionCounts: Record<TeamId, number[]> = {};
  const pointsTotal: Record<TeamId, number> = {};
  for (const t of teams) {
    positionCounts[t.id] = new Array<number>(teams.length).fill(0);
    pointsTotal[t.id] = 0;
  }

  const tableOptions: StandingsOptions = { ...standings, includeForm: false };
  const results: ResultMap = { ...fixed };
  for (let i = 0; i < iterations; i++) {
    for (const r of remaining) results[r.id] = simulateScore(r.xg, rng);
    const table = computeStandings(teams, fixtures, results, tableOptions);
    for (const row of table) {
      positionCounts[row.teamId]![row.position - 1]!++;
      pointsTotal[row.teamId]! += row.points;
    }
  }

  const averagePoints: Record<TeamId, number> = {};
  for (const t of teams) averagePoints[t.id] = iterations > 0 ? pointsTotal[t.id]! / iterations : 0;
  return { iterations, positionCounts, averagePoints };
}

/** Probability that a team finishes within positions [from, to] (1-based, inclusive). */
export function probabilityInRange(result: MonteCarloResult, teamId: TeamId, from: number, to: number): number {
  const counts = result.positionCounts[teamId];
  if (!counts || result.iterations === 0) return 0;
  let n = 0;
  for (let p = from; p <= to; p++) n += counts[p - 1] ?? 0;
  return n / result.iterations;
}
