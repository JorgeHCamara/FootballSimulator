import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRng } from "./rng.ts";
import {
  PLAYOFF_ID_BASE,
  buildBracket,
  needsShootout,
  playoffIds,
  playoffWinners,
  simulatePenalties,
  simulatePlayoff,
  tieOutcome,
  type PlayoffConfig,
} from "./playoffs.ts";
import type { LeagueModel } from "./ratings.ts";
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
const rows = Array.from({ length: 24 }, (_, i) => row(i + 1, 101 + i));
const options = { seasonComplete: true, afterMatchday: 38, afterDate: "2026-11-15T20:00:00Z" };

const serieB: PlayoffConfig = {
  rounds: [{ key: "semiFinals", legs: 2, levelTie: "betterPlaced", pairs: [[3, 6], [4, 5]] }],
  directPromotion: [1, 2],
  promotedTo: "Série A",
};

const championship: PlayoffConfig = {
  rounds: [
    { key: "eliminators", legs: 1, levelTie: "penalties", pairs: [[5, 8], [6, 7]] },
    { key: "semiFinals", legs: 2, levelTie: "penalties", entrants: [3, 4] },
    { key: "final", legs: 1, levelTie: "penalties", venue: "Wembley" },
  ],
  directPromotion: [1, 2],
  promotedTo: "Premier League",
};

const model: LeagueModel = {
  avgHomeGoals: 1.5,
  avgAwayGoals: 1.2,
  strengths: new Map(rows.map((r) => [r.teamId, { attack: 1, defence: 1 }])),
};

describe("Série B play-off (two legs, draw advantage)", () => {
  const [[semi1, semi2]] = buildBracket(rows, serieB, {}, options) as [[ReturnType<typeof buildBracket>[0][0], ReturnType<typeof buildBracket>[0][0]]];

  it("seeds 3rd v 6th and 4th v 5th, better-placed club at home in the second leg", () => {
    assert.deepEqual([semi1.higher.teamId, semi1.lower.teamId, semi2.higher.teamId, semi2.lower.teamId], [103, 106, 104, 105]);
    assert.deepEqual([semi1.legs[0]!.homeId, semi1.legs[1]!.homeId], [106, 103]);
    // Ids are unchanged from the first version, so old share links still work.
    assert.deepEqual(playoffIds(serieB), [1, 2, 3, 4].map((n) => PLAYOFF_ID_BASE + n));
    assert.equal(semi1.shootout, null);
  });

  it("goes to the better-placed club on a level aggregate", () => {
    const results: ResultMap = { [semi1.legs[0]!.id]: { home: 2, away: 1 }, [semi1.legs[1]!.id]: { home: 1, away: 0 } };
    assert.deepEqual(tieOutcome(semi1, results), { higherGoals: 2, lowerGoals: 2, winner: 103, onPenalties: false });
  });

  it("shows positions only until the season is complete", () => {
    const [[tie]] = buildBracket(rows, serieB, {}, { ...options, seasonComplete: false }) as [[(typeof semi1)]];
    assert.deepEqual([tie.higher.position, tie.lower.position, tie.higher.teamId], [3, 6, null]);
    assert.equal(tie.legs.length, 0);
  });

  it("uses real play-off results from the feed for matching legs", () => {
    const real: Fixture[] = [{ id: 999, matchday: 1, utcDate: "2026-11-21T20:00Z", homeId: 106, awayId: 103, result: { home: 0, away: 2 } }];
    const [[tie]] = buildBracket(rows, serieB, {}, { ...options, real }) as [[(typeof semi1)]];
    assert.deepEqual(tie.legs[0]!.result, { home: 0, away: 2 });
    assert.equal(tie.legs[0]!.utcDate, "2026-11-21T20:00Z");
  });
});

describe("Championship 2026/27 play-off", () => {
  it("plays single-leg eliminators at the better-placed club, with penalties if level", () => {
    const [eliminators] = buildBracket(rows, championship, {}, options);
    const [e1, e2] = eliminators!;
    assert.deepEqual([e1!.higher.teamId, e1!.lower.teamId, e2!.higher.teamId, e2!.lower.teamId], [105, 108, 106, 107]);
    assert.equal(e1!.legs.length, 1);
    assert.equal(e1!.legs[0]!.homeId, 105);

    const level: ResultMap = { [e1!.legs[0]!.id]: { home: 1, away: 1 } };
    assert.equal(tieOutcome(e1!, level), null, "level and no shoot-out yet");
    assert.ok(needsShootout(e1!, level));
    const pens = { ...level, [e1!.shootout!.id]: { home: 3, away: 4 } };
    assert.deepEqual(tieOutcome(e1!, pens), { higherGoals: 1, lowerGoals: 1, winner: 108, onPenalties: true });
  });

  it("re-seeds the semi-finals: 3rd v the lowest-placed winner, 3rd and 4th host the second leg", () => {
    const [eliminators] = buildBracket(rows, championship, {}, options);
    // 8th beats 5th, 6th beats 7th → semis 3rd v 8th, 4th v 6th.
    const results: ResultMap = {
      [eliminators![0]!.legs[0]!.id]: { home: 0, away: 1 },
      [eliminators![1]!.legs[0]!.id]: { home: 2, away: 0 },
    };
    const semis = buildBracket(rows, championship, results, options)[1]!;
    assert.deepEqual(semis.map((t) => [t.higher.teamId, t.lower.teamId]), [[103, 108], [104, 106]]);
    assert.deepEqual(semis[0]!.legs.map((l) => l.homeId), [108, 103]);
  });

  it("leaves the semi-final opponents open until both eliminators are decided", () => {
    const semis = buildBracket(rows, championship, {}, options)[1]!;
    assert.deepEqual(semis.map((t) => t.higher.position), [3, 4]);
    assert.ok(semis.every((t) => t.lower.teamId === null && t.lower.from && t.legs.length === 0));
  });

  it("plays the final at a neutral ground and promotes its winner", () => {
    const results = simulatePlayoff(rows, championship, {}, model, createRng(7), options);
    const bracket = buildBracket(rows, championship, results, options);
    const final = bracket[2]![0]!;
    assert.equal(final.legs.length, 1);
    assert.equal(final.legs[0]!.neutral, true);
    const [winner] = playoffWinners(bracket, results);
    assert.ok(winner !== null && [103, 104, 105, 106, 107, 108].includes(winner!));
    // Every tie in every round is decided.
    for (const round of bracket) for (const tie of round) assert.ok(tieOutcome(tie, results), `round ${tie.round} tie ${tie.index}`);
  });

  it("lists every leg and shoot-out id", () => {
    const ids = playoffIds(championship);
    // 2 eliminators (1 leg + pens), 2 semis (2 legs + pens), 1 final (1 leg + pens)
    assert.equal(ids.length, 2 * 2 + 2 * 3 + 2);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("penalty shoot-out", () => {
  it("always has a winner", () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      const s = simulatePenalties(rng);
      assert.notEqual(s.home, s.away);
      assert.ok(Math.max(s.home, s.away) >= 3);
    }
  });
});
