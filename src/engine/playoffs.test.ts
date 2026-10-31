import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAYOFF_ID_BASE, buildTwoLeggedTies, playoffLegIds, tieOutcome } from "./playoffs.ts";
import type { Fixture, ResultMap, StandingRow } from "./types.ts";

const row = (position: number, teamId: number): StandingRow => ({
  position,
  teamId,
  played: 38,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDifference: 0,
  points: 0,
  form: [],
});
// Team id = 100 + position, so 3rd is 103 and 6th is 106.
const rows = Array.from({ length: 8 }, (_, i) => row(i + 1, 101 + i));
const pairs = [[3, 6], [4, 5]] as const;
const options = { afterMatchday: 38, afterDate: "2026-11-15T20:00:00Z" };

describe("two-legged play-off", () => {
  const [semi1, semi2] = buildTwoLeggedTies(rows, pairs, options);

  it("seeds 3rd v 6th and 4th v 5th, higher seed at home in the second leg", () => {
    assert.deepEqual([semi1!.higher, semi1!.lower, semi2!.higher, semi2!.lower], [103, 106, 104, 105]);
    assert.deepEqual([semi1!.leg1.homeId, semi1!.leg1.awayId], [106, 103]);
    assert.deepEqual([semi1!.leg2.homeId, semi1!.leg2.awayId], [103, 106]);
    assert.deepEqual([semi1!.leg1.id, semi1!.leg2.id, semi2!.leg1.id, semi2!.leg2.id], playoffLegIds(2));
    assert.ok(semi1!.leg1.id > PLAYOFF_ID_BASE && semi1!.leg2.matchday === 40);
  });

  it("goes to the better-placed club on a level aggregate", () => {
    const results: ResultMap = { [semi1!.leg1.id]: { home: 2, away: 1 }, [semi1!.leg2.id]: { home: 1, away: 0 } };
    assert.deepEqual(tieOutcome(semi1!, results), { higherGoals: 2, lowerGoals: 2, winner: 103 });
  });

  it("goes to the lower seed only if it wins on aggregate", () => {
    const results: ResultMap = { [semi2!.leg1.id]: { home: 1, away: 0 }, [semi2!.leg2.id]: { home: 0, away: 0 } };
    assert.equal(tieOutcome(semi2!, results)!.winner, 105);
  });

  it("waits for both legs", () => {
    assert.equal(tieOutcome(semi1!, { [semi1!.leg1.id]: { home: 0, away: 0 } }), null);
  });

  it("uses real play-off results from the feed for matching legs", () => {
    const real: Fixture[] = [
      { id: 999, matchday: 1, utcDate: "2026-11-21T20:00Z", homeId: 106, awayId: 103, result: { home: 0, away: 2 } },
    ];
    const [tie] = buildTwoLeggedTies(rows, pairs, { ...options, real });
    assert.deepEqual(tie!.leg1.result, { home: 0, away: 2 });
    assert.equal(tie!.leg1.utcDate, "2026-11-21T20:00Z");
    assert.equal(tie!.leg2.result, null);
  });
});
