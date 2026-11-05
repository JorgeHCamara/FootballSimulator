import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProjectedHistory, type ProjectedClub } from "./projected.ts";
import { SIM_VERSION } from "./simVersion.ts";
import type { OddsSnapshot, TeamSnapshot } from "./snapshots.ts";

const team = (position: number, projected?: number): TeamSnapshot => ({
  position,
  points: 10 - position,
  played: 3,
  expectedPosition: position,
  averagePoints: 30 - position,
  chances: {},
  ...(projected !== undefined ? { projected, projectedChance: 0.4 } : {}),
});
const snapshot = (round: number, played: number, teams: Record<string, TeamSnapshot>): OddsSnapshot => ({
  round,
  date: `2026-09-0${round}`,
  asOf: `2026-09-0${round}T20:00:00Z`,
  takenAt: `2026-09-0${round}T21:00:00Z`,
  played,
  iterations: 10000,
  scope: "table",
  teams,
});
const now = (played: number, places: Record<string, number>) => ({
  played,
  scope: "table" as const,
  iterations: 10000,
  teams: Object.fromEntries(Object.entries(places).map(([id, place]): [string, ProjectedClub] => [id, { place, chance: 0.3, position: place, points: 0, averagePoints: 20 }])),
});
const zones = [{ kind: "relegation" as const, from: 3, to: 3 }];

describe("the projected table's history", () => {
  const rounds = [snapshot(1, 2, { 1: team(1, 2), 2: team(2, 1), 3: team(3, 3) }), snapshot(2, 4, { 1: team(1, 1), 2: team(2, 2), 3: team(3, 3) })];

  it("one entry per round with projected places, then the latest when games were played since", () => {
    const h = buildProjectedHistory(rounds, now(5, { 1: 1, 2: 3, 3: 2 }), undefined, zones)!;
    assert.deepEqual(h.entries.map((e) => e.round ?? "now"), [1, 2, "now"]);
    assert.deepEqual(h.entries.map((e) => e.teams["2"]!.place), [1, 2, 3]);
    assert.deepEqual(h.tables, [{ id: "table", teamIds: [1, 2, 3] }]);
    assert.equal(h.entries[0]!.teams["1"]!.chance, 0.4);
  });

  it("an entry worked out with another model than the one before is marked: a round, or the latest after older rounds", () => {
    const marks = (h: ReturnType<typeof buildProjectedHistory>) => h!.entries.map((e) => Boolean(e.modelChange));
    // Round 2 taken with today's model, round 1 before snapshots carried one.
    assert.deepEqual(marks(buildProjectedHistory([rounds[0]!, { ...rounds[1]!, modelVersion: SIM_VERSION }], now(5, { 1: 1, 2: 3, 3: 2 }), undefined, zones)), [false, true, false]);
    // Both rounds older: the latest (today's model) is the change.
    assert.deepEqual(marks(buildProjectedHistory(rounds, now(5, { 1: 1, 2: 3, 3: 2 }), undefined, zones)), [false, false, true]);
    // One model throughout: nothing marked.
    const today = rounds.map((r) => ({ ...r, modelVersion: SIM_VERSION }));
    assert.deepEqual(marks(buildProjectedHistory(today, now(5, { 1: 1, 2: 3, 3: 2 }), undefined, zones)), [false, false, false]);
  });

  it("no latest entry when nothing was played since the last round; rounds without projected places are left out", () => {
    assert.deepEqual(buildProjectedHistory(rounds, now(4, { 1: 1, 2: 2, 3: 3 }), undefined, zones)!.entries.map((e) => e.round), [1, 2]);
    const old = snapshot(3, 6, { 1: team(1), 2: team(2), 3: team(3) });
    assert.deepEqual(buildProjectedHistory([...rounds, old], undefined, undefined, zones)!.entries.map((e) => e.round), [1, 2]);
  });

  it("only the latest before the first round is complete; nothing at all: none", () => {
    assert.deepEqual(buildProjectedHistory([], now(1, { 1: 2, 2: 1 }), undefined, zones)!.entries.length, 1);
    assert.equal(buildProjectedHistory([], undefined, undefined, zones), undefined);
  });

  it("a table per conference, with only the clubs it has", () => {
    const h = buildProjectedHistory(rounds, undefined, [
      { id: "east", teamIds: [1, 3, 99] },
      { id: "west", teamIds: [2] },
      { id: "empty", teamIds: [42] },
    ], zones)!;
    assert.deepEqual(h.tables.map((t) => [t.id, t.teamIds]), [["east", [1, 3]], ["west", [2]]]);
  });
});
