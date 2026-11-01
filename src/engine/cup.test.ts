import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CUPS } from "../config/cups.ts";
import {
  buildCup,
  clubsAlive,
  cupGameId,
  cupIds,
  cupShootoutId,
  cupWinner,
  drawRound,
  isCupShootoutId,
  needsShootout,
  simulateCup,
  tieWinner,
  type RealCupTie,
} from "./cup.ts";
import { CUP_AVG_AWAY_GOALS, CUP_AVG_HOME_GOALS, buildCupModel, cupModelFor, tierStrength } from "./cupModel.ts";
import { runCupMonteCarlo } from "./cupMontecarlo.ts";
import { expectedGoals } from "./match.ts";
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
  fixture: fixture(500_000 + t, 1001 + 2 * t, 1002 + 2 * t),
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
    const real = [...realFirstRound, { round: "secondRound" as const, homeId: 1001, awayId: 1003, fixture: fixture(600_000, 1001, 1003) }];
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
    const real = [{ ...realFirstRound[0]!, fixture: fixture(500_000, 1001, 1002, { home: 1, away: 1 }, { home: 5, away: 4 }) }];
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
