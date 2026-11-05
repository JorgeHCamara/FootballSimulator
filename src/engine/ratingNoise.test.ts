import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectedGoals, sampleDixonColes, scoreMatrix, MAX_SCORE } from "./match.ts";
import { ratingNoiseSd, runMonteCarlo, type MonteCarloInput } from "./montecarlo.ts";
import { buildLeagueModel } from "./ratings.ts";
import { realResults } from "./results.ts";
import { createRng } from "./rng.ts";
import { doubleRoundRobin } from "./schedule.ts";
import type { Fixture, Team } from "./types.ts";

// A small league: 8 clubs of different strength, the first half of a double round robin played.
const teams: Team[] = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Club ${i + 1}`, shortName: `C${i + 1}`, tla: `C${i + 1}` }));
const rng = createRng(5);
const fixtures: Fixture[] = doubleRoundRobin(teams.map((t) => t.id)).map((f, i) => ({
  ...f,
  id: i + 1,
  utcDate: new Date(Date.UTC(2026, 7, 1) + f.matchday * 7 * 86_400_000).toISOString(),
  result: f.matchday <= 7 ? { home: Math.floor(rng() * (f.homeId < 4 ? 4 : 2)), away: Math.floor(rng() * (f.awayId < 4 ? 4 : 2)) } : null,
}));
const fixed = realResults(fixtures);
const model = { ...buildLeagueModel(teams, fixtures, fixed), rho: -0.1 };
const input: MonteCarloInput = { teams, fixtures, fixed, model, standings: { tiebreakers: ["points", "goalDifference", "goalsFor"] }, iterations: 3000, seed: 2026 };

describe("rating noise (the season backtest's option)", () => {
  it("off, or with a spread of 0, the run is exactly as without it", () => {
    const plain = runMonteCarlo(input);
    assert.deepEqual(runMonteCarlo({ ...input, ratingNoise: { sd: 0, k: 18 } }), plain);
  });

  it("each club's spread shrinks as its games come in: sd × √(k / (k + games))", () => {
    assert.equal(ratingNoiseSd(0.1, 18, 0), 0.1);
    assert.ok(Math.abs(ratingNoiseSd(0.1, 18, 18) - 0.1 / Math.SQRT2) < 1e-12);
    assert.ok(ratingNoiseSd(0.1, 18, 38) < ratingNoiseSd(0.1, 18, 10));
    assert.equal(ratingNoiseSd(0.1, 0, 5), 0);
  });

  it("noise makes the season less certain: the favourite's title chance falls, the outsider's rises", () => {
    const plain = runMonteCarlo(input);
    const noisy = runMonteCarlo({ ...input, ratingNoise: { sd: 0.3, k: 18 } });
    const first = (r: typeof plain, id: number) => r.positionCounts[id]![0]! / r.iterations;
    const favourite = teams.map((t) => t.id).sort((a, b) => first(plain, b) - first(plain, a))[0]!;
    const outsider = teams.map((t) => t.id).sort((a, b) => first(plain, a) - first(plain, b))[0]!;
    assert.ok(first(noisy, favourite) < first(plain, favourite), `${first(noisy, favourite)} vs ${first(plain, favourite)}`);
    assert.ok(first(noisy, outsider) >= first(plain, outsider));
    // Every season still has a full table.
    for (const t of teams) assert.equal(noisy.positionCounts[t.id]!.reduce((a, b) => a + b, 0), 3000);
  });

  it("draws scores from the same Dixon–Coles distribution as the score matrix", () => {
    const xg = expectedGoals(model, 1, 8);
    const matrix = scoreMatrix(xg, -0.1);
    const draws = createRng(9);
    const n = 200_000;
    const counts = new Float64Array(matrix.length);
    for (let i = 0; i < n; i++) {
      const s = sampleDixonColes(xg, -0.1, draws);
      counts[s.home * (MAX_SCORE + 1) + s.away]!++;
    }
    for (const [cell, p] of matrix.entries()) {
      const se = Math.sqrt((p * (1 - p)) / n);
      assert.ok(Math.abs(counts[cell]! / n - p) <= 5 * se + 1e-5, `cell ${cell}: ${counts[cell]! / n} vs ${p}`);
    }
  });
});
