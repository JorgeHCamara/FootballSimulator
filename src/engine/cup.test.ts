import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CUPS } from "../config/cups.ts";
import { groupLegs } from "../lib/cupData.ts";
import {
  bracketSides,
  bracketLines,
  bracketPairs,
  bracketColumns,
  buildCup,
  clubsAlive,
  cupGameId,
  cupIds,
  cupSecondLegId,
  clubTiers,
  hostFirst,
  cupShootoutId,
  cupWinner,
  drawRound,
  hashSeed,
  isCupShootoutId,
  needsShootout,
  simulateCup,
  simulateCupRound,
  tieAggregate,
  tieWinner,
  type RealCupTie,
} from "./cup.ts";
import { CUP_AVG_AWAY_GOALS, CUP_AVG_HOME_GOALS, buildCupModel, cupModelFor, tierStrength } from "./cupModel.ts";
import { runCupMonteCarlo } from "./cupMontecarlo.ts";
import { expectedGoals, expectedGoalsNeutral, likelyScoreSet } from "./match.ts";
import type { LeagueModel } from "./ratings.ts";
import { createRng } from "./rng.ts";
import type { Fixture, ResultMap, TeamId } from "./types.ts";

const faCup = CUPS[0]!;
// First-round clubs 1001–1080; Premier League 1–20 and Championship 21–44 enter in the third round.
const firstRound = Array.from({ length: 80 }, (_, i) => 1001 + i);
const entrants = { thirdRound: Array.from({ length: 44 }, (_, i) => i + 1) };
const fixture = (id: number, homeId: TeamId, awayId: TeamId, result: Fixture["result"] = null, penalties?: Fixture["penalties"]): Fixture => ({
  id,
  matchday: 1,
  utcDate: "2026-11-07T15:00:00Z",
  homeId,
  awayId,
  result,
  ...(penalties ? { penalties } : {}),
});
/** The real first-round draw: 1001 v 1002, 1003 v 1004, … */
const realFirstRound: RealCupTie[] = Array.from({ length: 40 }, (_, t) => ({
  round: "firstRound",
  homeId: 1001 + 2 * t,
  awayId: 1002 + 2 * t,
  legs: [fixture(500_000 + t, 1001 + 2 * t, 1002 + 2 * t)],
}));
const options = { entrants, drawSalt: 0, roundDates: { secondRound: "2026-12-05T15:00:00Z" } };
const model: LeagueModel = { avgHomeGoals: 1.5, avgAwayGoals: 1.2, strengths: new Map() };
const homeWins = (ties: { game: Fixture }[]): ResultMap => Object.fromEntries(ties.map((t) => [t.game.id, { home: 1, away: 0 }]));

describe("cup ids", () => {
  it("gives every tie of every round a fixed game and shoot-out slot", () => {
    const ids = cupIds(faCup);
    assert.equal(ids.length, 2 * (40 + 20 + 32 + 16 + 8 + 4 + 2 + 1));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(isCupShootoutId(cupShootoutId(2, 5)));
    assert.ok(!isCupShootoutId(cupGameId(2, 5)));
  });
});

describe("drawRound", () => {
  it("fair: every pairing as likely as any other, each season's draw independent of the last (slots named alike don't keep meeting)", () => {
    const clubs = Array.from({ length: 64 }, (_, i) => 1000 + i * 7);
    const runs = 3000;
    const counts = new Map<string, number>();
    let repeated = 0;
    let previous = new Set<string>();
    for (let year = 0; year < runs; year++) {
      const salt = (12345 ^ Math.imul(year + 1, 0x9e3779b1)) >>> 0;
      const pairs = new Set(drawRound(clubs, hashSeed("CDB", 3, salt), (id) => `e${id}`, true).map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
      for (const key of pairs) counts.set(key, (counts.get(key) ?? 0) + 1);
      repeated += [...pairs].filter((key) => previous.has(key)).length;
      previous = pairs;
    }
    const expected = runs / 63;
    assert.equal(counts.size, (64 * 63) / 2, "every pairing happens");
    assert.ok(Math.max(...counts.values()) < expected * 2, `a pairing ${Math.max(...counts.values())} times, ${expected.toFixed(0)} expected`);
    const perSeason = repeated / (runs - 1);
    assert.ok(Math.abs(perSeason - 32 / 63) < 0.1, `${perSeason.toFixed(2)} of last season's pairings again, ${(32 / 63).toFixed(2)} expected`);
  });

  it("is deterministic per seed, uses every club once, and changes with the seed", () => {
    const clubs = firstRound.slice(0, 20);
    const a = drawRound(clubs, 7);
    assert.deepEqual(a, drawRound(clubs, 7));
    assert.equal(a.length, 10);
    assert.deepEqual([...a.flat()].sort((x, y) => x - y), clubs);
    assert.notDeepEqual(a, drawRound(clubs, 8));
  });

  it("keeps most pairings when one club is swapped", () => {
    const clubs = firstRound.slice(0, 40);
    const before = drawRound(clubs, 3).map((p) => p.join("-"));
    const after = drawRound([...clubs.slice(0, 39), 1999], 3).map((p) => p.join("-"));
    const kept = before.filter((p) => after.includes(p)).length;
    assert.ok(kept >= 10, `only ${kept} of 20 pairings kept`);
  });

  it("with slots, draws the same pairings whichever club fills a slot", () => {
    const clubs = firstRound.slice(0, 16);
    const slot = new Map(clubs.map((id, i) => [id, `w${i}`] as const));
    const before = drawRound(clubs, 3, (id) => slot.get(id)!);
    // Another club wins slot 5's tie: it takes the same place in the same tie.
    const other = clubs.map((id, i) => (i === 5 ? 1999 : id));
    slot.set(1999, "w5");
    const after = drawRound(other, 3, (id) => slot.get(id)!);
    assert.deepEqual(after, before.map((pair) => pair.map((id) => (id === clubs[5] ? 1999 : id))));
  });
});

describe("buildCup: a simulated draw follows the slots, not the clubs", () => {
  /** Every round played to the final, the home club winning, except for `flips` (game id → away win). */
  const play = (flips: readonly number[]) => {
    const results: ResultMap = {};
    let rounds = buildCup(faCup, realFirstRound, results, options);
    for (let r = 0; r < rounds.length; r++) {
      for (const tie of rounds[r]!.ties) results[tie.game.id] = flips.includes(tie.game.id) ? { home: 0, away: 1 } : { home: 1, away: 0 };
      rounds = buildCup(faCup, realFirstRound, results, options);
    }
    return rounds;
  };
  const pairs = (rounds: ReturnType<typeof play>, from: number) => rounds.slice(from).map((round) => round.ties.map((t) => [t.homeId, t.awayId]));

  it("knows each round's feeders before the results: the ties whose winners meet", () => {
    const rounds = play([]);
    for (const round of rounds.slice(3)) {
      assert.ok(round.feeders, `${round.config.key}: feeders`);
      const previous = rounds[round.index - 1]!;
      round.ties.forEach((tie, j) => {
        const winners = round.feeders![j]!.map((i) => previous.ties[i]!.homeId); // the home club wins every tie here
        assert.deepEqual([tie.homeId, tie.awayId].sort(), [...winners].sort(), `${round.config.key} tie ${j}`);
      });
    }
    // The third round has clubs entering: its draw isn't the slots' alone.
    assert.equal(rounds[2]!.feeders, undefined);
    // Known while the round itself is still waiting for results.
    const waiting = buildCup(faCup, realFirstRound, {}, options);
    assert.deepEqual(waiting[7]!.feeders, rounds[7]!.feeders);
    assert.equal(waiting[7]!.drawn, "pending");
  });

  it("lays the bracket out the same, decided or not, whoever goes through", () => {
    const before = play([]);
    const last = (rounds: ReturnType<typeof play>, results: ResultMap) => bracketColumns(rounds.slice(5), results).map((col) => col.map((t) => t.index));
    const results = (rounds: ReturnType<typeof play>) => Object.fromEntries(rounds.flatMap((r) => r.ties.map((t) => [t.game.id, { home: 1, away: 0 }])));
    const layout = last(before, results(before));
    // Another quarter-final winner: the same layout.
    const flipped = play([before[5]!.ties[2]!.game.id]);
    const flippedResults = { ...results(flipped), [before[5]!.ties[2]!.game.id]: { home: 0, away: 1 } };
    assert.deepEqual(last(flipped, flippedResults), layout);
    // The semi-finals not played yet (so no final drawn): the quarter-finals still sit where they did.
    const open: ResultMap = { ...results(before) };
    for (const tie of before[6]!.ties) delete open[tie.game.id];
    const undecided = buildCup(faCup, realFirstRound, open, options);
    assert.equal(undecided[7]!.ties.length, 0);
    assert.deepEqual(last(undecided, open).slice(0, 2), layout.slice(0, 2));
  });

  for (const [name, round] of [["a fifth-round", 4], ["a quarter-final", 5]] as const) {
    it(`another winner of ${name} tie only takes that club's place, round after round`, () => {
      const before = play([]);
      const tie = before[round]!.ties[1]!;
      const after = play([tie.game.id]);
      // Every round up to it is the same draw; from the next one, the same ties in the same order,
      // with the tie's away club wherever its home club was.
      assert.deepEqual(pairs(after, 0).slice(0, round + 1), pairs(before, 0).slice(0, round + 1));
      const swapped = pairs(before, round + 1).map((ties) => ties.map((t) => t.map((id) => (id === tie.homeId ? tie.awayId : id))));
      // Later rounds: the away club goes on winning at home, as the home club did; its later opponents and slots are unchanged.
      assert.deepEqual(pairs(after, round + 1).map((ties) => ties.length), swapped.map((ties) => ties.length));
      assert.deepEqual(pairs(after, round + 1)[0], swapped[0]);
    });
  }
});

describe("buildCup", () => {
  it("fills the first round from the real draw and leaves the second round pending", () => {
    const rounds = buildCup(faCup, realFirstRound, {}, options);
    assert.equal(rounds.length, 8);
    assert.equal(rounds[0]!.drawn, "real");
    assert.equal(rounds[0]!.ties.length, 40);
    assert.deepEqual([rounds[0]!.ties[3]!.homeId, rounds[0]!.ties[3]!.awayId, rounds[0]!.ties[3]!.game.id], [1007, 1008, cupGameId(0, 3)]);
    assert.equal(rounds[1]!.drawn, "pending");
    assert.equal(rounds[1]!.ties.length, 0);
    assert.equal(rounds[2]!.drawn, "pending");
  });

  it("draws the second round once every first-round tie is decided, home clubs winning", () => {
    const rounds0 = buildCup(faCup, realFirstRound, {}, options);
    const results = homeWins(rounds0[0]!.ties);
    const rounds = buildCup(faCup, realFirstRound, results, options);
    const second = rounds[1]!;
    assert.equal(second.drawn, "simulated");
    assert.equal(second.ties.length, 20);
    const clubs = second.ties.flatMap((t) => [t.homeId, t.awayId]).sort((a, b) => a - b);
    assert.deepEqual(clubs, firstRound.filter((id) => id % 2 === 1)); // the home clubs 1001, 1003, …
    assert.equal(second.ties[0]!.game.utcDate, "2026-12-05T15:00:00Z");
    assert.equal(second.ties[0]!.real, false);
    assert.deepEqual(second.ties.map((t) => t.game.id), Array.from({ length: 20 }, (_, t) => cupGameId(1, t)));
  });

  it("adds the 44 Premier League and Championship clubs in the third round", () => {
    const results: ResultMap = {};
    let rounds = buildCup(faCup, realFirstRound, results, options);
    Object.assign(results, homeWins(rounds[0]!.ties));
    rounds = buildCup(faCup, realFirstRound, results, options);
    Object.assign(results, homeWins(rounds[1]!.ties));
    rounds = buildCup(faCup, realFirstRound, results, options);
    const third = rounds[2]!;
    assert.equal(third.ties.length, 32);
    assert.equal(third.participants.length, 64);
    assert.ok(entrants.thirdRound.every((id) => third.participants.includes(id)));
    assert.equal(rounds[3]!.drawn, "pending");
  });

  it("keeps real ties of a partly drawn round and draws the rest", () => {
    const rounds0 = buildCup(faCup, realFirstRound, {}, options);
    const results = homeWins(rounds0[0]!.ties);
    // ESPN already lists one second-round tie: 1001 v 1003.
    const real = [...realFirstRound, { round: "secondRound" as const, homeId: 1001, awayId: 1003, legs: [fixture(600_000, 1001, 1003)] }];
    const second = buildCup(faCup, real, results, options)[1]!;
    assert.equal(second.drawn, "simulated");
    assert.deepEqual([second.ties[0]!.homeId, second.ties[0]!.awayId, second.ties[0]!.real], [1001, 1003, true]);
    const clubs = second.ties.flatMap((t) => [t.homeId, t.awayId]);
    assert.equal(new Set(clubs).size, 40, "each winner once");
  });

  it("changes a simulated draw with the salt, and only that", () => {
    const rounds0 = buildCup(faCup, realFirstRound, {}, options);
    const results = homeWins(rounds0[0]!.ties);
    const a = buildCup(faCup, realFirstRound, results, options)[1]!.ties.map((t) => `${t.homeId}-${t.awayId}`);
    const b = buildCup(faCup, realFirstRound, results, { ...options, drawSalt: 1 })[1]!.ties.map((t) => `${t.homeId}-${t.awayId}`);
    assert.notDeepEqual(a, b);
    assert.deepEqual(buildCup(faCup, realFirstRound, results, { ...options, drawSalt: 1 })[0]!.ties.map((t) => t.homeId), rounds0[0]!.ties.map((t) => t.homeId));
  });
});

describe("tie outcome", () => {
  const tie = buildCup(faCup, realFirstRound, {}, options)[0]!.ties[0]!;

  it("needs a shoot-out when level, decided by its score", () => {
    const level: ResultMap = { [tie.game.id]: { home: 2, away: 2 } };
    assert.equal(tieWinner(tie, level), null);
    assert.ok(needsShootout(tie, level));
    assert.equal(tieWinner(tie, { ...level, [tie.shootout.id]: { home: 3, away: 4 } }), tie.awayId);
    assert.equal(tieWinner(tie, { [tie.game.id]: { home: 0, away: 1 } }), tie.awayId);
  });

  it("takes a real shoot-out from the feed", () => {
    const real = [{ ...realFirstRound[0]!, legs: [fixture(500_000, 1001, 1002, { home: 1, away: 1 }, { home: 5, away: 4 })] }];
    const withPens = buildCup(faCup, real, {}, options)[0]!.ties[0]!;
    assert.deepEqual(withPens.shootout.result, { home: 5, away: 4 });
    assert.equal(tieWinner(withPens, {}), 1001);
    assert.equal(withPens.game.penalties, undefined);
  });
});

describe("simulateCup", () => {
  it("plays every round down to one winner, drawing each round from the winners", () => {
    const results = simulateCup(faCup, realFirstRound, {}, model, createRng(4), options);
    const rounds = buildCup(faCup, realFirstRound, results, options);
    assert.deepEqual(rounds.map((r) => r.ties.length), [40, 20, 32, 16, 8, 4, 2, 1]);
    assert.ok(rounds.every((r) => r.drawn !== "pending"));
    const winner = cupWinner(rounds, results);
    assert.ok(winner !== null);
    assert.equal(clubsAlive(rounds, results, [...firstRound, ...entrants.thirdRound]).size, 1);
    // Wembley: no home advantage.
    assert.equal(rounds[7]!.ties[0]!.game.neutral, true);
    // Only slot ids were written.
    const ids = new Set(cupIds(faCup));
    assert.ok(Object.keys(results).every((id) => ids.has(Number(id))));
  });

  it("leaves decided ties alone", () => {
    const rounds0 = buildCup(faCup, realFirstRound, {}, options);
    const known = homeWins(rounds0[0]!.ties.slice(0, 10));
    const added = simulateCup(faCup, realFirstRound, known, model, createRng(1), options);
    for (const id of Object.keys(known)) assert.equal(added[Number(id)], undefined);
  });
});

describe("cup model", () => {
  it("scales each league's ratings by its tier", () => {
    const pl: LeagueModel = { avgHomeGoals: 1.5, avgAwayGoals: 1.2, strengths: new Map([[1, { attack: 1.2, defence: 0.8 }]]) };
    const l2: LeagueModel = { avgHomeGoals: 1.5, avgAwayGoals: 1.2, strengths: new Map([[90, { attack: 1, defence: 1 }]]) };
    const cup = buildCupModel([
      { tier: 0, model: pl },
      { tier: 3, model: l2 },
    ]);
    const xg = expectedGoals(cup, 1, 90);
    assert.ok(xg.home > 2.3 && xg.home < 3.2, `PL at home v League Two: ${xg.home}`);
    assert.ok(xg.away > 0.4 && xg.away < 0.8, `League Two away at a PL club: ${xg.away}`);
    assert.equal(cup.avgHomeGoals, CUP_AVG_HOME_GOALS);
    assert.equal(cup.avgAwayGoals, CUP_AVG_AWAY_GOALS);
  });

  it("treats unknown clubs as non-league sides", () => {
    const full = cupModelFor(new Map([[1, { attack: 1, defence: 1 }]]), [1, 5000]);
    assert.deepEqual(full.strengths.get(5000), tierStrength(4.5));
    const xg = expectedGoals(full, 1, 5000);
    assert.ok(xg.home > 2.8 && xg.away < 0.7, `${xg.home} v ${xg.away}`);
  });
});

describe("runCupMonteCarlo", () => {
  it("counts every club once per round it reaches and one winner per run", () => {
    const strengths = Object.fromEntries(entrants.thirdRound.map((id) => [id, { attack: 1.2, defence: 0.8 }]));
    const mc = runCupMonteCarlo({ config: faCup, real: realFirstRound, fixed: {}, strengths, options: { entrants }, iterations: 50, seed: 2 });
    for (let r = 0; r < 8; r++) {
      const inRound = Object.values(mc.reached).reduce((n, counts) => n + counts[r]!, 0);
      assert.equal(inRound, 50 * [80, 40, 64, 32, 16, 8, 4, 2][r]!, `round ${r}`);
    }
    assert.equal(Object.values(mc.won).reduce((a, b) => a + b, 0), 50);
    // Premier League clubs (strong, entering later) win far more often than first-round sides.
    const plWins = entrants.thirdRound.reduce((n, id) => n + (mc.won[id] ?? 0), 0);
    assert.ok(plWins > 40, `${plWins} wins for the 44 entrants`);
  });

  it("honours predictions on real ties but redraws simulated rounds", () => {
    const strengths = {};
    const tie = buildCup(faCup, realFirstRound, {}, options)[0]!.ties[0]!;
    const fixed: ResultMap = { [tie.game.id]: { home: 0, away: 3 } };
    const mc = runCupMonteCarlo({ config: faCup, real: realFirstRound, fixed, strengths, options: { entrants }, iterations: 30, seed: 9 });
    assert.equal(mc.reached[1002]![1], 30, "the away club always goes through");
    assert.equal(mc.reached[1001]![1], 0);
  });
});

describe("Copa do Brasil (two legs, Série A entering in the fifth round, neutral final)", () => {
  const copa = CUPS.find((c) => c.code === "CDB")!;
  // Rounds 1–4 from the real draw: 28 clubs (2001–2028) in round one, then the
  // feed's later entrants. Here only the fifth round onwards is built: the 12
  // fourth-round winners (3001–3012) meet the 20 Série A clubs (1–20).
  const serieA = Array.from({ length: 20 }, (_, i) => i + 1);
  const fourthWinners = Array.from({ length: 12 }, (_, i) => 3001 + i);
  const fourthRound: RealCupTie[] = fourthWinners.map((id, t) => ({
    round: "fourthRound",
    homeId: id,
    awayId: 4001 + t,
    legs: [fixture(700_000 + t, id, 4001 + t, { home: 1, away: 0 })],
  }));
  // Rounds 1–3 already played as real ties (winners feed nothing we test here).
  const earlier: RealCupTie[] = [
    ...Array.from({ length: 14 }, (_, t) => ({ round: "firstRound" as const, homeId: 5001 + 2 * t, awayId: 5002 + 2 * t, legs: [fixture(710_000 + t, 5001 + 2 * t, 5002 + 2 * t, { home: 1, away: 0 })] })),
    ...Array.from({ length: 44 }, (_, t) => ({ round: "secondRound" as const, homeId: 6001 + 2 * t, awayId: 6002 + 2 * t, legs: [fixture(720_000 + t, 6001 + 2 * t, 6002 + 2 * t, { home: 1, away: 0 })] })),
    ...Array.from({ length: 24 }, (_, t) => ({ round: "thirdRound" as const, homeId: 7001 + 2 * t, awayId: 7002 + 2 * t, legs: [fixture(730_000 + t, 7001 + 2 * t, 7002 + 2 * t, { home: 1, away: 0 })] })),
  ];
  const real = [...earlier, ...fourthRound];
  const copaOptions = { entrants: { fifthRound: serieA }, drawSalt: 0, roundDates: { fifthRound: "2026-04-22T22:00:00Z" } };

  it("keeps the FA Cup's ids and gives two-legged ties a second-leg slot", () => {
    const ids = cupIds(copa);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 2 * (14 + 44 + 24 + 12 + 16 + 8 + 4 + 2 + 1) + (16 + 8 + 4 + 2));
    assert.equal(cupIds(faCup).length, 246, "FA Cup unchanged");
    assert.ok(!isCupShootoutId(cupSecondLegId(4, 3)));
    assert.ok(isCupShootoutId(cupShootoutId(4, 3)));
  });

  it("draws the fifth round from 12 winners and 20 Série A clubs, over two legs", () => {
    const rounds = buildCup(copa, real, {}, copaOptions);
    const fifth = rounds[4]!;
    assert.equal(fifth.drawn, "simulated");
    assert.equal(fifth.ties.length, 16);
    assert.equal(new Set(fifth.ties.flatMap((t) => [t.homeId, t.awayId])).size, 32);
    const tie = fifth.ties[0]!;
    assert.equal(tie.legs.length, 2);
    assert.deepEqual([tie.legs[1]!.homeId, tie.legs[1]!.awayId], [tie.awayId, tie.homeId], "second leg at the other club");
    assert.equal(tie.legs[1]!.id, cupSecondLegId(4, 0));
    assert.equal(rounds[5]!.drawn, "pending");
  });

  it("decides a two-legged tie on aggregate, then penalties after the second leg", () => {
    const tie = buildCup(copa, real, {}, copaOptions)[4]!.ties[0]!;
    const [first, second] = tie.legs as [Fixture, Fixture];
    // 2–1 at the first club's ground, 0–1 at the other: 2–2 on aggregate.
    const level: ResultMap = { [first.id]: { home: 2, away: 1 }, [second.id]: { home: 1, away: 0 } };
    assert.deepEqual(tieAggregate(tie, level), { home: 2, away: 2 });
    assert.ok(needsShootout(tie, level));
    assert.equal(tieWinner(tie, level), null);
    // The shoot-out is at the second leg's ground: its home club is tie.awayId.
    assert.equal(tie.shootout.homeId, tie.awayId);
    assert.equal(tieWinner(tie, { ...level, [tie.shootout.id]: { home: 4, away: 2 } }), tie.awayId);
    // 2–1 then 1–1: the first club goes through without penalties.
    assert.equal(tieWinner(tie, { [first.id]: { home: 2, away: 1 }, [second.id]: { home: 1, away: 1 } }), tie.homeId);
    // Only the first leg played: undecided, and simulating plays only the second leg.
    const partial = { [first.id]: { home: 3, away: 0 } };
    assert.equal(tieWinner(tie, partial), null);
    const added = simulateCupRound({ ...buildCup(copa, real, {}, copaOptions)[4]!, ties: [tie] }, partial, model, createRng(3));
    assert.equal(added[first.id], undefined);
    assert.ok(added[second.id]);
  });

  it("takes real legs (paired by club) and a real shoot-out on the second leg", () => {
    const legs = groupLegs([
      fixture(800_002, 2, 1, { home: 1, away: 0 }, { home: 2, away: 4 }),
      fixture(800_001, 1, 2, { home: 1, away: 0 }),
      fixture(800_003, 3, 4, null),
    ].map((f, i) => ({ ...f, utcDate: i === 0 ? "2026-05-14T22:00Z" : "2026-04-23T22:00Z" })));
    assert.deepEqual(legs.map((l) => l.map((f) => f.id)), [[800_001, 800_002], [800_003]]);
    const realFifth: RealCupTie = { round: "fifthRound", homeId: 1, awayId: 2, legs: legs[0]! };
    const tie = buildCup(copa, [...real, realFifth], {}, copaOptions)[4]!.ties[0]!;
    assert.deepEqual([tie.homeId, tie.awayId, tie.real], [1, 2, true]);
    assert.deepEqual(tie.shootout.result, { home: 2, away: 4 });
    assert.equal(tieWinner(tie, {}), 1, "1 won the shoot-out away at 2");
  });

  it("waits for the real draw when a round's entrants aren't known", () => {
    // Only the first round is known: the second round's 74 entrants come from the real draw.
    const onlyFirst = earlier.filter((t) => t.round === "firstRound");
    const rounds = buildCup(copa, onlyFirst, {}, copaOptions);
    assert.equal(rounds[1]!.drawn, "pending");
    assert.equal(rounds[1]!.ties.length, 0);
  });

  it("plays down to a neutral final between the two semi-final winners", () => {
    const results = simulateCup(copa, real, {}, model, createRng(8), copaOptions);
    const rounds = buildCup(copa, real, results, copaOptions);
    assert.deepEqual(rounds.slice(4).map((r) => r.ties.length), [16, 8, 4, 2, 1]);
    const final = rounds[8]!;
    assert.equal(final.drawn, "determined");
    assert.equal(final.ties[0]!.legs.length, 1);
    assert.equal(final.ties[0]!.game.neutral, true);
    assert.ok(cupWinner(rounds, results) !== null);
  });

  it("Simulate all with likely rolls: every leg of every two-legged tie from its likely set", () => {
    const results = simulateCup(copa, real, {}, model, createRng(8), copaOptions, { likely: true });
    let checked = 0;
    for (const tie of buildCup(copa, real, results, copaOptions).flatMap((r) => r.ties)) {
      for (const leg of tie.legs) {
        const score = results[leg.id];
        if (!score || isCupShootoutId(leg.id)) continue;
        const xg = leg.neutral ? expectedGoalsNeutral(model, leg.homeId, leg.awayId) : expectedGoals(model, leg.homeId, leg.awayId);
        assert.ok(likelyScoreSet(xg, model.rho).some((s) => s.home === score.home && s.away === score.away), `${score.home}-${score.away}`);
        checked++;
      }
    }
    assert.ok(checked > 30, `${checked} legs`);
  });

    it("runs the Monte Carlo through two-legged rounds", () => {
    const mc = runCupMonteCarlo({ config: copa, real, fixed: {}, strengths: {}, options: { entrants: { fifthRound: serieA } }, iterations: 40, seed: 5 });
    for (const [r, clubs] of [[4, 32], [5, 16], [6, 8], [7, 4], [8, 2]] as const) {
      assert.equal(Object.values(mc.reached).reduce((n, c) => n + c[r]!, 0), 40 * clubs, `round ${r}`);
    }
    assert.equal(Object.values(mc.won).reduce((a, b) => a + b, 0), 40);
  });
});

describe("Copa del Rey (lower-division club hosts, Supercopa clubs enter in the round of 32)", () => {
  const cdr = CUPS.find((c) => c.code === "CDR")!;

  it("has the 2026/27 rounds: two-legged qualifier and semi-finals, neutral final", () => {
    assert.deepEqual(cdr.rounds.map((r) => r.ties), [10, 56, 28, 16, 8, 4, 2, 1]);
    assert.deepEqual(cdr.rounds.map((r) => r.legs ?? 1), [2, 1, 1, 1, 1, 1, 2, 1]);
    assert.equal(cdr.rounds.at(-1)!.venue, "La Cartuja");
    assert.equal(cdr.rounds[3]!.entrantsNotYetIn, true);
  });

  it("puts the lower-division club at home in single games", () => {
    const tiers = clubTiers(cdr, { 1: "PD", 2: "SD" }, [1, 2, 3]);
    assert.deepEqual(tiers, { 1: 0, 2: 1, 3: 3 });
    const single = cdr.rounds[1]!;
    assert.deepEqual(hostFirst(single, 1, 2, tiers), [2, 1], "Segunda club hosts La Liga club");
    assert.deepEqual(hostFirst(single, 3, 2, tiers), [3, 2], "already at the lower club");
    assert.deepEqual(hostFirst(single, 1, 1, tiers), [1, 1]);
    assert.deepEqual(hostFirst(cdr.rounds[6]!, 1, 3, tiers), [1, 3], "two legs: draw order");
    assert.deepEqual(hostFirst(faCup.rounds[0]!, 1, 3, tiers), [1, 3], "FA Cup: draw order");
  });

  it("draws the round of 32 from 28 winners and the 4 Supercopa clubs, lower clubs at home", () => {
    // Second round already played: 28 real ties, home clubs (9001…) win.
    const second: RealCupTie[] = Array.from({ length: 28 }, (_, t) => ({
      round: "secondRound",
      homeId: 9001 + t,
      awayId: 9101 + t,
      legs: [fixture(950_000 + t, 9001 + t, 9101 + t, { home: 1, away: 0 })],
    }));
    const supercopa = [1, 2, 3, 4];
    const divisions: Record<number, string> = { 1: "PD", 2: "PD", 3: "PD", 4: "PD", 9001: "PD", 9002: "SD" };
    const tiers = clubTiers(cdr, divisions, [...supercopa, ...second.map((t) => t.homeId)]);
    const rounds = buildCup(cdr, second, {}, { entrants: { roundOf32: supercopa }, drawSalt: 0, roundDates: {}, tiers });
    const r32 = rounds[3]!;
    assert.equal(r32.ties.length, 16);
    assert.equal(new Set(r32.ties.flatMap((t) => [t.homeId, t.awayId])).size, 32);
    for (const tie of r32.ties) assert.ok(tiers[tie.homeId]! >= tiers[tie.awayId]!, `lower club hosts: ${tie.homeId} v ${tie.awayId}`);
  });
});

describe("Coppa Italia (fixed bracket, no draws)", () => {
  const cit = CUPS.find((c) => c.code === "CIT")!;
  // The 2026/27 round of 16, in ESPN's (fixture id) order, home clubs winning.
  const r16Pairs: [TeamId, TeamId][] = [
    [110, 3263], // Inter–Genoa
    [2572, 4050], // Como–Cremonese
    [111, 3997], // Juventus–Sassuolo
    [107, 2923], // Bologna–Palermo
    [114, 109], // Napoli–Fiorentina
    [104, 119], // Roma–Verona
    [103, 4007], // Milan–Monza
    [105, 118], // Atalanta–Udinese
  ];
  const r16: RealCupTie[] = r16Pairs.map(([h, a], t) => ({ round: "roundOf16", homeId: h, awayId: a, legs: [fixture(700_000 + t, h, a)] }));
  // Results go by slot: the round of 16 is round 0 of `late`.
  const won: ResultMap = Object.fromEntries(r16.map((_, t) => [cupGameId(0, t), { home: 1, away: 0 }]));
  const build = (results: ResultMap) => buildCup(cit, r16, results, { entrants: {}, drawSalt: 0, roundDates: {} });
  // Only the round of 16 onwards, so it starts the cup.
  const late = { ...cit, rounds: cit.rounds.slice(3) };
  const buildLate = (results: ResultMap, salt = 0) => buildCup(late, r16, results, { entrants: {}, drawSalt: salt, roundDates: {} });

  it("has the 2026/27 rounds: two-legged semi-finals, final at the Olimpico", () => {
    assert.deepEqual(cit.rounds.map((r) => r.ties), [4, 16, 8, 8, 4, 2, 1]);
    assert.deepEqual(cit.rounds.map((r) => r.legs ?? 1), [1, 1, 1, 1, 1, 2, 1]);
    assert.deepEqual(cit.rounds.map((r) => Boolean(r.bracket)), [false, false, false, false, true, true, true]);
    assert.equal(cit.rounds.at(-1)!.venue, "Stadio Olimpico");
    assert.ok(build({})[0]!.drawn === "pending");
  });

  it("pairs neighbouring lines, upper line at home", () => {
    const lines = new Map([[1, 0], [2, 1], [3, 2], [4, 3]]);
    assert.deepEqual(bracketPairs([4, 2, 3, 1], lines, 1), { pairs: [[1, 2], [3, 4]], rest: [] });
    assert.deepEqual(bracketPairs([4, 1], lines, 2), { pairs: [[1, 4]], rest: [] });
    assert.deepEqual(bracketPairs([4, 3, 9], lines, 1), { pairs: [[3, 4]], rest: [9] });
  });

  it("uses the official bracket order when it names every tie, else slot order", () => {
    const lines = bracketLines(cit, r16);
    assert.equal(lines.get(110), 0);
    assert.equal(lines.get(3263), 0);
    assert.equal(lines.get(107), 1, "Bologna next to Inter");
    assert.equal(lines.get(105), 7);
    const other = bracketLines(cit, [{ homeId: 1, awayId: 2 }, { homeId: 3, awayId: 4 }]);
    assert.deepEqual([...other.values()], [0, 0, 1, 1]);
  });

  it("sets the quarter-finals and semi-finals by the bracket, the same with any draw salt", () => {
    const rounds = buildLate(won);
    const qf = rounds[1]!;
    assert.equal(qf.drawn, "determined");
    assert.deepEqual(qf.ties.map((t) => [t.homeId, t.awayId]), [[110, 107], [103, 2572], [104, 111], [114, 105]]);
    assert.deepEqual(buildLate(won, 5)[1]!.ties.map((t) => t.homeId), qf.ties.map((t) => t.homeId));
    const semis = buildLate({ ...won, ...homeWins(qf.ties) })[2]!;
    assert.deepEqual(semis.ties.map((t) => [t.homeId, t.awayId]), [[110, 103], [104, 114]]);
    assert.equal(semis.ties[0]!.legs.length, 2);
    // Upsets keep the bracket: Bologna beats Inter, Monza beats Milan.
    const qfUpsets = { ...won, [qf.ties[0]!.game.id]: { home: 0, away: 1 } };
    const r16Upset = { ...qfUpsets, [cupGameId(0, 6)]: { home: 0, away: 2 } };
    const qf2 = buildLate(r16Upset)[1]!;
    assert.deepEqual(qf2.ties[1]!.homeId, 4007, "Monza takes Milan's line");
  });

  it("names who can reach each side of a pending bracket round", () => {
    const open = buildLate({});
    assert.equal(open[1]!.drawn, "pending");
    assert.deepEqual(bracketSides(late, open, 1, {}), [[[110, 3263], [107, 2923]], [[103, 4007], [2572, 4050]], [[104, 119], [111, 3997]], [[114, 109], [105, 118]]]);
    // Semi-final 1 before the quarter-finals: Inter's quarter v Milan's; a decided tie leaves only its winner.
    const interOut = { [cupGameId(0, 0)]: { home: 0, away: 1 } };
    assert.deepEqual(bracketSides(late, buildLate(interOut), 2, interOut)![0], [[3263, 107, 2923], [103, 4007, 2572, 4050]]);
    assert.equal(bracketSides(late, open, 3, {})![0]![0]!.length, 8);
    assert.equal(bracketSides(faCup, buildCup(faCup, realFirstRound, {}, options), 5, {}), null);
  });

  it("only ever meets Inter and Milan in the semi-final, never earlier", () => {
    const strengths = Object.fromEntries(r16Pairs.flat().map((id) => [id, { attack: 1, defence: 1 }]));
    const mc = runCupMonteCarlo({ config: late, real: r16, fixed: {}, strengths, options: { entrants: {} }, iterations: 400, seed: 3 });
    assert.equal(Object.values(mc.won).reduce((a, b) => a + b, 0), 400);
    for (const id of r16Pairs.flat()) assert.equal(mc.reached[id]![0], 400);
    const qfClubs = r16Pairs.flat().reduce((sum, id) => sum + mc.reached[id]![1]!, 0);
    assert.equal(qfClubs, 400 * 8);
    // Inter's side (lines 0-3) supplies exactly one finalist per run.
    const top = [110, 3263, 107, 2923, 103, 4007, 2572, 4050].reduce((sum, id) => sum + mc.reached[id]![3]!, 0);
    assert.equal(top, 400);
  });
});

describe("DFB-Pokal (amateur clubs host professional ones)", () => {
  const dfb = CUPS.find((c) => c.code === "DFB")!;
  // 1–18 Bundesliga, 19–36 2. Bundesliga, 37+ 3. Liga and amateur clubs.
  const divisions: Record<number, string> = {};
  for (let id = 1; id <= 36; id++) divisions[id] = id <= 18 ? "BL1" : "BL2";

  it("has the 2026/27 rounds: single games, final in Berlin", () => {
    assert.deepEqual(dfb.rounds.map((r) => r.ties), [32, 16, 8, 4, 2, 1]);
    assert.ok(dfb.rounds.every((r) => (r.legs ?? 1) === 1));
    assert.equal(dfb.rounds.at(-1)!.venue, "Olympiastadion Berlin");
    assert.equal(dfb.hostTier, 2);
  });

  it("puts an amateur club at home against a professional one, else keeps the draw order", () => {
    const tiers = clubTiers(dfb, divisions, [1, 20, 40, 41]);
    assert.deepEqual(tiers, { 1: 0, 20: 1, 40: 2.5, 41: 2.5 });
    const round = dfb.rounds[2]!;
    assert.deepEqual(hostFirst(round, 1, 40, tiers, dfb), [40, 1], "amateur hosts Bundesliga club");
    assert.deepEqual(hostFirst(round, 20, 40, tiers, dfb), [40, 20], "amateur hosts 2. Bundesliga club");
    assert.deepEqual(hostFirst(round, 1, 20, tiers, dfb), [1, 20], "2. Bundesliga club drawn away stays away");
    assert.deepEqual(hostFirst(round, 40, 41, tiers, dfb), [40, 41], "two amateurs: draw order");
    assert.deepEqual(hostFirst(dfb.rounds[5]!, 1, 40, tiers, dfb), [1, 40], "final: no home rule");
  });

  it("never draws a professional club at home to an amateur one", () => {
    // Second round played: 16 real ties, the home clubs win (8 amateurs, 8 pros).
    const winners = [1, 2, 3, 4, 19, 20, 21, 22, 40, 41, 42, 43, 44, 45, 46, 47];
    const second: RealCupTie[] = winners.map((id, t) => ({
      round: "secondRound",
      homeId: id,
      awayId: 100 + t,
      legs: [fixture(960_000 + t, id, 100 + t, { home: 2, away: 0 })],
    }));
    const tiers = clubTiers(dfb, divisions, [...winners, ...second.map((t) => t.awayId)]);
    for (const salt of [0, 1, 2, 3, 4]) {
      const r16 = buildCup(dfb, second, {}, { entrants: {}, drawSalt: salt, roundDates: {}, tiers })[2]!;
      assert.equal(r16.ties.length, 8);
      for (const tie of r16.ties) assert.ok(!(tiers[tie.homeId]! < 2 && tiers[tie.awayId]! >= 2), `pro hosts amateur: ${tie.homeId} v ${tie.awayId}`);
    }
  });
});

describe("cup buttons fill in likely rolls; the cup chances keep the full distribution", () => {
  // Clubs of different strengths, so the likely sets differ from game to game.
  const strengths = new Map(
    [...firstRound, ...entrants.thirdRound].map((id) => [id, { attack: 0.7 + ((id * 37) % 60) / 60, defence: 0.7 + ((id * 53) % 60) / 60 }]),
  );
  const varied: LeagueModel = { avgHomeGoals: 1.5, avgAwayGoals: 1.2, strengths, rho: -0.1 };
  /** Every simulated game (not a shoot-out) has a score from its likely set. */
  const assertLikely = (config: typeof faCup, real: readonly RealCupTie[], results: ResultMap, buildOptions: Parameters<typeof buildCup>[3]) => {
    const rounds = buildCup(config, real, results, buildOptions);
    let checked = 0;
    for (const tie of rounds.flatMap((r) => r.ties)) {
      for (const leg of tie.legs) {
        const score = results[leg.id];
        if (!score || isCupShootoutId(leg.id)) continue;
        const xg = leg.neutral ? expectedGoalsNeutral(varied, leg.homeId, leg.awayId) : expectedGoals(varied, leg.homeId, leg.awayId);
        const set = likelyScoreSet(xg, varied.rho);
        assert.ok(set.some((s) => s.home === score.home && s.away === score.away), `${leg.homeId} v ${leg.awayId}: ${score.home}-${score.away}`);
        checked++;
      }
    }
    return checked;
  };

  it("Simulate round: every game of the round from its likely set", () => {
    const round = buildCup(faCup, realFirstRound, {}, options)[0]!;
    for (const seed of [1, 2, 3]) {
      const added = simulateCupRound(round, {}, varied, createRng(seed), { likely: true });
      assert.equal(assertLikely(faCup, realFirstRound, added, options), 40);
    }
  });

  it("Simulate all: every game down to the final from its likely set", () => {
    for (const seed of [4, 5]) {
      const results = simulateCup(faCup, realFirstRound, {}, varied, createRng(seed), options, { likely: true });
      assert.equal(assertLikely(faCup, realFirstRound, results, options), 40 + 20 + 32 + 16 + 8 + 4 + 2 + 1);
      assert.ok(cupWinner(buildCup(faCup, realFirstRound, results, options), results) !== null);
    }
  });

  it("without the option, games can come out of the likely set (the full distribution)", () => {
    const round = buildCup(faCup, realFirstRound, {}, options)[0]!;
    let outside = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const added = simulateCupRound(round, {}, varied, createRng(seed));
      for (const tie of round.ties) {
        const score = added[tie.game.id]!;
        const set = likelyScoreSet(expectedGoals(varied, tie.game.homeId, tie.game.awayId), varied.rho);
        if (!set.some((s) => s.home === score.home && s.away === score.away)) outside++;
      }
    }
    assert.ok(outside > 0);
  });

  it("the cup chances are the same as before for the same seed", () => {
    const strengths = Object.fromEntries(entrants.thirdRound.map((id) => [id, { attack: 1 + (45 - id) / 50, defence: 1 - (45 - id) / 120 }]));
    const mc = runCupMonteCarlo({ config: faCup, real: realFirstRound, fixed: {}, strengths, options: { entrants }, iterations: 300, seed: 11 });
    // Recorded with the code before the cup buttons' likely rolls: titles and finals by club.
    const won: Record<string, number> = {"1": 31, "2": 25, "3": 24, "4": 14, "5": 23, "6": 9, "7": 10, "8": 12, "9": 14, "10": 11, "11": 15, "12": 17, "13": 9, "14": 10, "15": 10, "16": 6, "17": 4, "18": 6, "19": 3, "20": 6, "21": 4, "22": 2, "23": 3, "24": 7, "25": 3, "26": 2, "27": 4, "28": 1, "29": 2, "30": 2, "31": 1, "32": 1, "33": 1, "36": 2, "37": 1, "38": 1, "40": 3, "44": 1};
    const finals: Record<string, number> = {"1": 51, "2": 38, "3": 43, "4": 22, "5": 42, "6": 20, "7": 19, "8": 27, "9": 29, "10": 19, "11": 30, "12": 28, "13": 18, "14": 24, "15": 16, "16": 10, "17": 14, "18": 12, "19": 13, "20": 11, "21": 13, "22": 6, "23": 6, "24": 12, "25": 8, "26": 9, "27": 9, "28": 4, "29": 5, "30": 5, "31": 1, "32": 2, "33": 8, "34": 2, "35": 1, "36": 4, "37": 3, "38": 3, "39": 2, "40": 4, "41": 3, "42": 2, "44": 2};
    assert.deepEqual(Object.fromEntries(Object.entries(mc.won).filter(([, n]) => n > 0)), won);
    assert.deepEqual(Object.fromEntries(Object.entries(mc.reached).filter(([, c]) => c[7]! > 0).map(([id, c]) => [id, c[7]])), finals);
  });
});

describe("Coupe de France (from the seventh round; a club two divisions below hosts)", () => {
  const cdf = CUPS.find((c) => c.code === "CDF")!;
  /** The real seventh round: clubs 2001 to 2184, 2001 v 2002, 2003 v 2004, … (`count` of its 92 ties listed). */
  const seventh = (count: number): RealCupTie[] =>
    Array.from({ length: count }, (_, t) => ({ round: "seventhRound", homeId: 2001 + 2 * t, awayId: 2002 + 2 * t, legs: [fixture(600_000 + t, 2001 + 2 * t, 2002 + 2 * t)] }));
  const ligue1 = Array.from({ length: 18 }, (_, i) => i + 1);

  it("plays the seventh and eighth rounds, then the Ligue 1 clubs join in the round of 64; final at the Stade de France", () => {
    assert.deepEqual(cdf.rounds.map((r) => r.ties), [92, 46, 32, 16, 8, 4, 2, 1]);
    assert.deepEqual(cdf.rounds[2]!.entrantsFrom, ["FL1"]);
    assert.equal(cdf.rounds.at(-1)!.venue, "Stade de France");
    assert.ok(cdf.rounds.slice(0, -1).every((r) => r.noExtraTime === true), "straight to penalties before the final");
    assert.equal(cdf.rounds.at(-1)!.noExtraTime, false, "extra time in the final");
  });

  it("gives the home game to a club at least two divisions below", () => {
    // 1 Ligue 1, 2 Ligue 2, 3 and 4 amateur (tier 3).
    const tiers = clubTiers(cdf, { 1: "FL1", 2: "FL2" }, [1, 2, 3, 4]);
    assert.deepEqual(tiers, { 1: 0, 2: 1, 3: 3, 4: 3 });
    const round = cdf.rounds[3]!;
    assert.deepEqual(hostFirst(round, 1, 3, tiers, cdf), [3, 1], "amateur hosts Ligue 1");
    assert.deepEqual(hostFirst(round, 2, 3, tiers, cdf), [3, 2], "amateur hosts Ligue 2");
    assert.deepEqual(hostFirst(round, 1, 2, tiers, cdf), [1, 2], "one division apart: draw order");
    assert.deepEqual(hostFirst(round, 3, 4, tiers, cdf), [3, 4], "same level: draw order");
    assert.deepEqual(hostFirst(cdf.rounds.at(-1)!, 1, 3, tiers, cdf), [1, 3], "final: neutral");
  });

  it("with the whole seventh round, draws every round to the final, the Ligue 1 clubs in the round of 64", () => {
    const real = seventh(92);
    const opts = { entrants: { roundOf64: ligue1 }, drawSalt: 0, roundDates: {} };
    const first = buildCup(cdf, real, {}, opts);
    assert.equal(first[0]!.drawn, "real");
    const rounds = buildCup(cdf, real, homeWins(first[0]!.ties), opts);
    assert.equal(rounds[1]!.drawn, "simulated");
    assert.equal(rounds[1]!.ties.length, 46);
    assert.equal(rounds[2]!.participants.length, 0, "the round of 64 waits for the eighth round's results");
  });

  it("plays a seventh round the feed lists a tie short; the eighth is drawn from its 91 winners, one through without a game", () => {
    const real = seventh(91);
    const opts = { entrants: { roundOf64: ligue1 }, drawSalt: 0, roundDates: {} };
    const rounds = buildCup(cdf, real, {}, opts);
    assert.equal(rounds[0]!.drawn, "real", "the listed ties are the round");
    assert.equal(rounds[0]!.ties.length, 91);
    assert.equal(rounds[1]!.drawn, "pending", "the eighth waits for the seventh's results");
    const played = buildCup(cdf, real, homeWins(rounds[0]!.ties), opts);
    const eighth = played[1]!;
    assert.equal(eighth.drawn, "simulated");
    assert.equal(eighth.ties.length, 45, "91 winners: 45 ties");
    assert.equal(eighth.byes!.length, 1, "and one club through without a game");
    const inEighth = new Set([...eighth.ties.flatMap((t) => [t.homeId, t.awayId]), ...eighth.byes!]);
    assert.equal(inEighth.size, 91, "every winner, once");
    // The round of 64: the eighth's 45 winners and the bye, with the 18 Ligue 1 clubs.
    const through = buildCup(cdf, real, { ...homeWins(rounds[0]!.ties), ...homeWins(eighth.ties) }, opts);
    assert.equal(through[2]!.ties.length, 32);
    assert.ok(through[2]!.participants.includes(eighth.byes![0]!), "the bye plays the round of 64");
    // Three short is more than a feed slip: the round waits.
    assert.equal(buildCup(cdf, seventh(89), {}, opts)[0]!.drawn, "pending");
    // A full seventh round: no byes.
    const full = buildCup(cdf, seventh(92), {}, opts);
    assert.equal(buildCup(cdf, seventh(92), homeWins(full[0]!.ties), opts)[1]!.byes, undefined);
    // The chances run the short round, and on to the final.
    const mc = runCupMonteCarlo({ config: cdf, real, fixed: {}, strengths: {}, options: { entrants: { roundOf64: ligue1 } }, iterations: 20, seed: 1 });
    assert.equal(mc.reached[2001]![0], 20, "every club listed plays the seventh round");
    assert.equal(Object.values(mc.won).reduce((n, w) => n + w, 0), 20, "a winner every run");
  });
});
