import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupOfRound } from "../engine/split.ts";
import type { Fixture, ResultMap, Team } from "../engine/types.ts";
import { firstPhaseRounds, serieCClassification, serieCFinalZones, serieCFixtures, serieCFormat, serieCGroups, serieCLeagueFixtures, serieCPhase, serieCTables } from "./worldSerieC.ts";

const teams = (n: number): Team[] => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Club ${i + 1}`, shortName: `C${i + 1}`, tla: `C${i + 1}` }));
const options = { tiebreakers: ["points", "wins", "goalDifference", "goalsFor"] as const, includeForm: false };
/** Every game won by the lower id, by a goal per place apart: the table is the clubs in id order. */
const byId = (fixtures: readonly Fixture[], results: ResultMap = {}): ResultMap => {
  const out: ResultMap = { ...results };
  for (const f of fixtures) if (!out[f.id] && f.homeId > 0 && f.awayId > 0) out[f.id] = f.homeId < f.awayId ? { home: 1 + (f.awayId - f.homeId), away: 0 } : { home: 0, away: 1 + (f.homeId - f.awayId) };
  return out;
};
const phaseOf = (year: number, results: ResultMap, list = teams(serieCFormat(year).clubs), groups?: number[][]) =>
  serieCPhase({ teams: list, fixtures: serieCFixtures(list.map((t) => t.id), serieCFormat(year), "2026-04-01T15:00:00Z", groups), results, format: serieCFormat(year), ...(groups ? { groups } : {}), options: { ...options, tiebreakers: [...options.tiebreakers] }, groupOptions: { ...options, tiebreakers: [...options.tiebreakers] } });

describe("My World: Série C's formats", () => {
  it("grows from 20 clubs (2026) to 24 (2027) and 28 (from 2028), six up from Série D each season, two down until 2027 and three from each group after", () => {
    assert.deepEqual([2025, 2026, 2027, 2028, 2029, 2040].map((y) => [serieCFormat(y).clubs, serieCFormat(y).groups, serieCFormat(y).relegated, serieCFormat(y).arrivals]), [
      [20, 1, 2, 6],
      [20, 1, 2, 6],
      [24, 1, 2, 6],
      [28, 2, 3, 6],
      [28, 2, 3, 6],
      [28, 2, 3, 6],
    ]);
    // The sizes add up: this season's clubs, less 4 up and the relegated, plus 4 down from Série B and the arrivals.
    for (const year of [2026, 2027, 2028, 2029]) {
      const f = serieCFormat(year);
      assert.equal(f.clubs - 4 - f.groups * f.relegated + 4 + f.arrivals, serieCFormat(year + 1).clubs, String(year));
    }
  });

  it("a generated first phase: one round robin of 19 or 23 rounds, or two groups of 14 home and away (26 rounds)", () => {
    const one = serieCFixtures(teams(20).map((t) => t.id), serieCFormat(2026), "2026-04-01T15:00:00Z");
    assert.equal(one.length, 190);
    assert.equal(firstPhaseRounds(serieCFormat(2026)), 19);
    assert.equal(Math.max(...one.map((f) => f.matchday)), 19);
    const pairs = new Set(one.map((f) => [f.homeId, f.awayId].sort((a, b) => a - b).join("-")));
    assert.equal(pairs.size, 190, "every pairing once");
    assert.equal(serieCFixtures(teams(24).map((t) => t.id), serieCFormat(2027), "2027-04-01T15:00:00Z").length, 276);
    const groups = serieCGroups(teams(28).map((t) => t.id));
    assert.deepEqual(groups.map((g) => g.length), [14, 14]);
    assert.deepEqual(groups.map((g) => g.slice(0, 4)), [[1, 4, 5, 8], [2, 3, 6, 7]], "the strongest spread across both");
    const two = serieCFixtures(teams(28).map((t) => t.id), serieCFormat(2028), "2028-04-01T15:00:00Z", groups);
    assert.equal(two.length, 364);
    assert.equal(new Set(two.map((f) => f.id)).size, 364, "ids apart");
    assert.ok(two.every((f) => groups.some((g) => g.includes(f.homeId) && g.includes(f.awayId))), "every game within a group");
  });
});

describe("My World: Série C's phases", () => {
  it("one round robin: places stand in for the second phase until the first is complete, then 1st, 4th, 5th and 8th and 2nd, 3rd, 6th and 7th, the bottom two down", () => {
    const pending = phaseOf(2026, {});
    assert.equal(pending.firstComplete, false);
    assert.equal(pending.members, null);
    assert.equal(pending.secondFixtures.length, 24, "two groups of four, home and away");
    assert.ok(pending.secondFixtures.every((f) => f.homeId < 0 && f.awayId < 0 && groupOfRound(f.matchday) !== null));
    assert.deepEqual([...pending.slots.values()].map((s) => s.place).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
    const first = byId(pending.firstFixtures);
    const phase = phaseOf(2026, first);
    assert.equal(phase.firstComplete, true);
    assert.deepEqual(phase.members, [[1, 4, 5, 8], [2, 3, 6, 7]]);
    assert.deepEqual(phase.relegated, [19, 20]);
    assert.ok(phase.secondFixtures.every((f) => f.homeId > 0 && f.id < 0), "the groups' games, generated");
    assert.equal(phase.secondComplete, false);
    const done = phaseOf(2026, byId(phase.secondFixtures, first));
    assert.equal(done.secondComplete, true);
    // The final: the two group winners, the better campaign first (it hosts the second leg).
    assert.deepEqual(done.finalRows.slice(0, 2).map((r) => r.teamId), [1, 2]);
    assert.equal(serieCLeagueFixtures(done).length, 214);
    // The classification: the champion first, then the other finalist, the rest of the second phase, then the first phase's order.
    const results = byId(done.secondFixtures, first);
    const rows = serieCClassification(done, teams(20), results, { ...options, tiebreakers: [...options.tiebreakers] }, 2);
    assert.deepEqual(rows.map((r) => r.teamId), [2, 1, 3, 4, 5, 6, 7, 8, ...Array.from({ length: 12 }, (_, i) => i + 9)]);
    assert.ok(rows.every((r, i) => r.position === i + 1));
    assert.equal(rows.find((r) => r.teamId === 1)!.played, 25, "both phases' games");
    assert.deepEqual(serieCTables(done).map((t) => [t.kind, t.group, t.rows.length]), [["first", null, 20], ["second", 0, 4], ["second", 1, 4]]);
    assert.deepEqual(serieCFinalZones(2026, 20), [{ kind: "promotion", from: 1, to: 4 }, { kind: "relegation", from: 19, to: 20 }]);
  });

  it("two groups (from 2028): each group's top four play a group of four, the bottom three of each down", () => {
    const groups = serieCGroups(teams(28).map((t) => t.id));
    const pending = phaseOf(2028, {}, teams(28), groups);
    assert.equal(pending.firstTables.length, 2);
    assert.equal(pending.secondFixtures.length, 24);
    assert.equal(new Set(pending.secondFixtures.map((f) => f.id)).size, 24, "places of both groups apart");
    assert.deepEqual([...new Set([...pending.slots.values()].map((s) => s.group))].sort(), [0, 1]);
    const first = byId(pending.firstFixtures);
    const phase = phaseOf(2028, first, teams(28), groups);
    assert.deepEqual(phase.members, groups.map((g) => g.slice(0, 4)));
    assert.deepEqual(phase.relegated, [...groups[0]!.slice(-3), ...groups[1]!.slice(-3)]);
    const done = phaseOf(2028, byId(phase.secondFixtures, first), teams(28), groups);
    assert.equal(done.secondComplete, true);
    assert.deepEqual(done.finalRows.slice(0, 2).map((r) => r.teamId).sort((a, b) => a - b), [1, 2]);
    assert.deepEqual(serieCTables(done).map((t) => [t.kind, t.group, t.rows.length, t.zones.at(-1)!.from]), [["firstGroup", 0, 14, 12], ["firstGroup", 1, 14, 12], ["second", 0, 4, 1], ["second", 1, 4, 1]]);
    assert.deepEqual(serieCFinalZones(2028, 28), [{ kind: "promotion", from: 1, to: 4 }, { kind: "relegation", from: 23, to: 28 }]);
  });
});
