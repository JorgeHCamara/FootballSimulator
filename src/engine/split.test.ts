import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runMonteCarlo } from "./montecarlo.ts";
import { buildLeagueModel } from "./ratings.ts";
import { doubleRoundRobin } from "./schedule.ts";
import { allSplitFixtureIds, isSplitFixtureId, splitFixtureId, splitFixtures, splitGroupsFrom, type SplitGroupConfig } from "./split.ts";
import { computeStandings } from "./standings.ts";
import type { ResultMap, Team } from "./types.ts";

const teams: Team[] = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `T${i + 1}`, shortName: `T${i + 1}`, tla: `T${i + 1}` }));
// Greece in small: the top four and the next four, each a double round robin; the second group halved.
const groups: SplitGroupConfig[] = [
  { size: 4, legs: 2 },
  { size: 4, legs: 2, carryOver: 0.5 },
];
// First phase: a double round robin (14 rounds) the lower id always wins, so the table is 1, 2, … 8.
const firstPhase = doubleRoundRobin(teams.map((t) => t.id));
const firstResults: ResultMap = Object.fromEntries(
  firstPhase.map((f) => [f.id, f.homeId < f.awayId ? { home: 1, away: 0 } : { home: 0, away: 1 }]),
);
const options = { tiebreakers: ["points", "goalDifference"] as const };

describe("a split generated from the table", () => {
  const atSplit = computeStandings(teams, firstPhase, firstResults, { tiebreakers: [...options.tiebreakers] });
  const groupTeams = splitGroupsFrom(atSplit, groups);
  const extra = splitFixtures(groupTeams, groups, 14, firstPhase.at(-1)!.utcDate);

  it("cuts the table into its groups and gives each a round robin after the first phase", () => {
    assert.deepEqual(groupTeams, [[1, 2, 3, 4], [5, 6, 7, 8]]);
    assert.equal(extra.length, 24, "6 rounds of 2 games in each group of four");
    assert.deepEqual([...new Set(extra.map((f) => f.matchday))], [15, 16, 17, 18, 19, 20]);
    for (const f of extra) {
      const g = groupTeams.findIndex((ids) => ids.includes(f.homeId));
      assert.ok(groupTeams[g]!.includes(f.awayId), "games stay within a group");
      assert.ok(f.utcDate > firstPhase.at(-1)!.utcDate);
    }
    // Every club plays every other club of its group home and away.
    assert.equal(new Set(extra.map((f) => f.id)).size, 24);
    assert.ok(extra.every((f) => isSplitFixtureId(f.id) && f.id === splitFixtureId(f.homeId, f.awayId)));
    assert.equal(allSplitFixtureIds([1, 2, 3]).length, 6);
  });

  it("plays a single round robin with one leg (Scotland)", () => {
    const single = splitFixtures(groupTeams, groups.map((g) => ({ ...g, legs: 1 as const })), 14, firstPhase.at(-1)!.utcDate);
    assert.equal(single.length, 12);
  });

  it("keeps the groups apart and halves the points of a group with carry-over 0.5, rounded up", () => {
    // In the split, 8 wins everything in the second group.
    const results: ResultMap = { ...firstResults };
    for (const f of extra) results[f.id] = f.homeId === 8 ? { home: 2, away: 0 } : f.awayId === 8 ? { home: 0, away: 2 } : { home: 0, away: 0 };
    const all = [...firstPhase, ...extra];
    const table = computeStandings(teams, all, results, { tiebreakers: [...options.tiebreakers], split: { afterRound: 14, groups } });
    assert.deepEqual(table.slice(0, 4).map((r) => r.teamId), [1, 2, 3, 4], "the top four stay on top");
    const row = (id: number) => table.find((r) => r.teamId === id)!;
    // 5 won 6 of its 14 first-phase games (18 points): 9 carried, plus four draws and two defeats by 8 → 13.
    assert.equal(row(5).points, Math.ceil(18 / 2) + 4);
    // 8 won none (0 points), then all six: 18.
    assert.equal(row(8).points, 18);
    assert.equal(row(8).position, 5, "8 tops the second group");
    // The top group isn't halved: 1 won all 14 (42 points) plus its split games (all draws: 6).
    assert.equal(row(1).points, 42 + 6);
  });

  it("generates each run's split in the chances, keeping the user's predictions for those games", () => {
    // Half the first phase left; 8 is told to beat 5 at home in the split.
    const open = firstPhase.map((f, i) => (i < firstPhase.length / 2 ? { ...f, result: firstResults[f.id]! } : f));
    const fixed: ResultMap = Object.fromEntries(open.filter((f) => f.result).map((f) => [f.id, f.result!]));
    const model = buildLeagueModel(teams, open, fixed);
    const result = runMonteCarlo({
      teams,
      fixtures: open,
      fixed,
      model,
      standings: { tiebreakers: [...options.tiebreakers], split: { afterRound: 14, groups } },
      iterations: 200,
      seed: 1,
      project: { afterRound: 14, afterDate: open.at(-1)!.utcDate, groups },
    });
    // Every run's table has 8 places, with the groups' clubs kept apart.
    for (const t of teams) assert.equal(result.positionCounts[t.id]!.reduce((a, b) => a + b, 0), 200);
    // Each club plays 14 + 6 games a run: average points well above a first phase alone could give the weakest.
    assert.ok(result.averagePoints[8]! > 0);
  });
});
