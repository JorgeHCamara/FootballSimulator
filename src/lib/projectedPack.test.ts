import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProjectedHistory } from "./projected.ts";
import { packHistory, unpackHistory } from "./projectedPack.ts";

/* The projected table's history, packed for the page and unpacked by ProjectedTable: exactly what it was. */

const history: ProjectedHistory = {
  scope: "table",
  tables: [{ id: "table", teamIds: [1, 2, 3] }],
  entries: [
    { round: 10, date: "2026-10-07", played: 100, teams: { "1": { place: 2, chance: 0.31, position: 3, points: 18, averagePoints: 61.2 }, "2": { place: 1, chance: 0.4, position: 1, points: 22, averagePoints: 70.04 }, "3": { place: 3, position: 2, points: 19, averagePoints: 58 } } },
    { round: 11, date: "2026-10-14", played: 110, teams: { "1": { place: 1, chance: 0.35, position: 1, points: 21, averagePoints: 64.5 } }, modelChange: true },
    { played: 113, teams: { "2": { place: 2, chance: 0, position: 2, points: 22, averagePoints: 66 } } },
  ],
  zones: [{ kind: "relegation", from: 18, to: 20 }],
  iterations: 10_000,
};

describe("the projected table's packed history", () => {
  it("comes back exactly as it was, through JSON as the page sends it", () => {
    assert.deepEqual(unpackHistory(JSON.parse(JSON.stringify(packHistory(history)))), history);
  });

  it("an unpacked history passes through as it is, and packing is smaller", () => {
    assert.equal(unpackHistory(history), history);
    assert.ok(JSON.stringify(packHistory(history)).length < JSON.stringify(history).length);
  });
});
