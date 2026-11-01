import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import { computeStandings } from "./standings.ts";
import type { Fixture, ResultMap, Team, Tiebreaker } from "./types.ts";

const team = (id: number, name: string): Team => ({ id, name, shortName: name, tla: name.slice(0, 3) });
const teams = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"].map((n, i) => team(i + 1, n));

/** Builds fixtures + results from [home, away, homeGoals, awayGoals] tuples. */
function games(list: [number, number, number, number][]): { fixtures: Fixture[]; results: ResultMap } {
  const fixtures: Fixture[] = [];
  const results: ResultMap = {};
  list.forEach(([homeId, awayId, home, away], i) => {
    const id = i + 1;
    fixtures.push({ id, matchday: i + 1, utcDate: `2025-08-${String(i + 1).padStart(2, "0")}`, homeId, awayId, result: null });
    results[id] = { home, away };
  });
  return { fixtures, results };
}

const tiebreakers = (code: string): readonly Tiebreaker[] => getLeagueByCode(code)!.tiebreakers;
const order = (rows: { teamId: number }[]) => rows.map((r) => r.teamId);

describe("computeStandings", () => {
  it("counts matches against clubs outside the table (MLS conferences)", () => {
    // Alpha and Bravo are East; Charlie is West.
    const { fixtures, results } = games([
      [1, 3, 2, 0],
      [3, 2, 1, 1],
      [1, 2, 0, 1],
    ]);
    const east = computeStandings([teams[0]!, teams[1]!], fixtures, results, { tiebreakers: tiebreakers("MLS") });
    assert.deepEqual(
      east.map((r) => [r.teamId, r.played, r.points]),
      [[2, 2, 4], [1, 2, 3]],
    );
  });

  // Alpha and Bravo finish level on 6 points. Alpha has the better goal
  // difference, Bravo won the head-to-head.
  const levelOnPoints = games([
    [2, 1, 1, 0],
    [1, 3, 5, 0],
    [1, 4, 1, 0],
    [2, 3, 1, 0],
  ]);

  it("tallies a basic table", () => {
    const rows = computeStandings(teams, levelOnPoints.fixtures, levelOnPoints.results, { tiebreakers: tiebreakers("PL") });
    const alpha = rows.find((r) => r.teamId === 1)!;
    assert.deepEqual(
      { p: alpha.played, w: alpha.won, d: alpha.drawn, l: alpha.lost, gf: alpha.goalsFor, ga: alpha.goalsAgainst, gd: alpha.goalDifference, pts: alpha.points },
      { p: 3, w: 2, d: 0, l: 1, gf: 6, ga: 1, gd: 5, pts: 6 },
    );
    assert.equal(rows.length, teams.length);
    assert.deepEqual(rows.map((r) => r.position), [1, 2, 3, 4, 5, 6]);
  });

  it("Premier League ranks goal difference before head-to-head", () => {
    const rows = computeStandings(teams, levelOnPoints.fixtures, levelOnPoints.results, { tiebreakers: tiebreakers("PL") });
    assert.deepEqual(order(rows).slice(0, 2), [1, 2]);
  });

  it("La Liga and Serie A rank head-to-head before goal difference", () => {
    for (const code of ["PD", "SA"]) {
      const rows = computeStandings(teams, levelOnPoints.fixtures, levelOnPoints.results, { tiebreakers: tiebreakers(code) });
      assert.deepEqual(order(rows).slice(0, 2), [2, 1], code);
    }
  });

  it("Brasileirão ranks number of wins before goal difference", () => {
    // Alpha: 2W 1L (6 pts, GD +1). Bravo: 1W 3D (6 pts, GD +5).
    const { fixtures, results } = games([
      [1, 3, 1, 0],
      [1, 4, 1, 0],
      [5, 1, 1, 0],
      [2, 6, 5, 0],
      [2, 3, 0, 0],
      [2, 4, 0, 0],
      [2, 5, 0, 0],
    ]);
    const bsa = computeStandings(teams, fixtures, results, { tiebreakers: tiebreakers("BSA") });
    const pl = computeStandings(teams, fixtures, results, { tiebreakers: tiebreakers("PL") });
    assert.deepEqual(order(bsa).slice(0, 2), [1, 2]);
    assert.deepEqual(order(pl).slice(0, 2), [2, 1]);
  });

  it("recomputes head-to-head as a mini-league among the tied teams only", () => {
    // Alpha, Bravo, Charlie each beat one another in a cycle (3 pts each in the
    // mini-league); Charlie's wins are by more goals so it tops the H2H goal difference.
    const { fixtures, results } = games([
      [1, 2, 1, 0],
      [2, 3, 1, 0],
      [3, 1, 3, 0],
      [1, 4, 1, 0],
      [2, 4, 1, 0],
      [3, 4, 1, 0],
    ]);
    const rows = computeStandings(teams, fixtures, results, { tiebreakers: tiebreakers("SA") });
    // All three on 6 points and 3 H2H points; H2H GD: Charlie +2, Bravo 0, Alpha -2.
    assert.deepEqual(order(rows).slice(0, 3), [3, 2, 1]);
  });

  it("applies points deductions", () => {
    const rows = computeStandings(teams, levelOnPoints.fixtures, levelOnPoints.results, {
      tiebreakers: tiebreakers("PL"),
      deductions: { 1: 4 },
    });
    assert.equal(rows.find((r) => r.teamId === 1)!.points, 2);
    assert.equal(rows[0]!.teamId, 2);
  });

  it("falls back to alphabetical order when teams are fully level", () => {
    const rows = computeStandings(teams, [], {}, { tiebreakers: tiebreakers("PL") });
    assert.deepEqual(rows.map((r) => r.teamId), [1, 2, 3, 4, 5, 6]);
    assert.ok(rows.every((r) => r.points === 0 && r.played === 0));
  });

  it("builds form in chronological order, most recent last, capped at 5", () => {
    const { fixtures, results } = games([
      [1, 2, 1, 0],
      [3, 1, 2, 2],
      [1, 4, 0, 1],
      [5, 1, 0, 3],
      [1, 6, 2, 0],
      [2, 1, 0, 0],
    ]);
    const rows = computeStandings(teams, fixtures, results, { tiebreakers: tiebreakers("PL") });
    assert.deepEqual(rows.find((r) => r.teamId === 1)!.form, ["D", "L", "W", "W", "D"]);
  });
});
