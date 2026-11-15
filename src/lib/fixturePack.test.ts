import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAGUES } from "../config/leagues.ts";
import type { Fixture } from "../engine/types.ts";
import { isPacked, packFixtures, unpackFixtures } from "./fixturePack.ts";
import { sampleLeague } from "./sampleLeague.ts";

/*
 * The league page sends its simulator the fixtures packed (src/lib/fixturePack.ts);
 * unpacked, they must be exactly what it sent before: the same values, the same
 * keys in the same order (JSON of them is identical), whatever their shape.
 */

const roundTrip = (fixtures: Fixture[]) => unpackFixtures(JSON.parse(JSON.stringify(packFixtures(fixtures))));

describe("packed fixtures", () => {
  it("every sample league's season comes back exactly as it was, and in far fewer bytes", () => {
    for (const league of LEAGUES.filter((l) => !l.continental).slice(0, 12)) {
      const { fixtures } = sampleLeague(league);
      const back = roundTrip(fixtures);
      assert.deepEqual(back, fixtures, league.code);
      assert.equal(JSON.stringify(back), JSON.stringify(fixtures), `${league.code}: same keys, same order`);
      assert.ok(JSON.stringify(packFixtures(fixtures)).length < JSON.stringify(fixtures).length * 0.45, `${league.code}: smaller`);
    }
  });

  it("games of another shape (neutral ground, a shoot-out, keys in another order) travel as they are", () => {
    const fixtures: Fixture[] = [
      { id: 1, matchday: 1, utcDate: "2026-08-15T14:00:00Z", homeId: 10, awayId: 20, result: { home: 2, away: 1 } },
      { id: 2, matchday: 1, utcDate: "2026-08-15T14:00:00Z", homeId: 30, awayId: 40, result: null },
      { id: 3, matchday: 38, utcDate: "2027-05-30T15:00:00Z", homeId: 10, awayId: 30, result: { home: 1, away: 1 }, penalties: { home: 4, away: 3 } },
      { id: 4, matchday: 38, utcDate: "2027-05-30T15:00:00Z", homeId: 20, awayId: 40, result: null, neutral: true },
      { matchday: 2, id: 5, utcDate: "2026-08-22T14:00:00Z", homeId: 40, awayId: 10, result: null },
      { id: 6, matchday: 2, utcDate: "2026-08-22T14:00:00Z", homeId: 20, awayId: 30, result: { away: 0, home: 3 } },
    ];
    const packed = packFixtures(fixtures);
    assert.equal(packed.rows.filter((r) => Array.isArray(r)).length, 2, "only the two plain games are rows");
    assert.deepEqual(packed.dates, ["2026-08-15T14:00:00Z"], "each kick-off once");
    assert.equal(JSON.stringify(roundTrip(fixtures)), JSON.stringify(fixtures));
  });

  it("fixtures as they are pass through untouched (the same array: client-side callers keep their identity)", () => {
    const fixtures: Fixture[] = [{ id: 1, matchday: 1, utcDate: "2026-08-15T14:00:00Z", homeId: 10, awayId: 20, result: null }];
    assert.equal(unpackFixtures(fixtures), fixtures);
    assert.equal(isPacked(fixtures), false);
    assert.equal(isPacked(packFixtures(fixtures)), true);
    assert.deepEqual(unpackFixtures(packFixtures([])), []);
  });
});
