import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectedGoals, likelyScores, MAX_SCORE, outcomeProbabilities, sampleScore, scoreMatrix, scoreSampler } from "./match.ts";
import { buildLeagueModel, decayWeight, DIXON_COLES, matchParamOptions, RATING_HALF_LIFE, TEAM_HOME_ADVANTAGE, type LeagueModel } from "./ratings.ts";
import { createRng } from "./rng.ts";
import { doubleRoundRobin } from "./schedule.ts";
import type { ResultMap, Team } from "./types.ts";

const xg = { home: 1.6, away: 1.1 };
const size = MAX_SCORE + 1;
const at = (m: Float64Array, home: number, away: number) => m[home * size + away]!;
const sum = (m: Float64Array) => m.reduce((a, b) => a + b, 0);
const poisson = (l: number, k: number) => (Math.exp(-l) * l ** k) / [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800][k]!;

describe("the score distribution (Dixon–Coles)", () => {
  it("sums to 1", () => {
    for (const rho of [0, -0.05, -0.15, -0.2]) assert.ok(Math.abs(sum(scoreMatrix(xg, rho)) - 1) < 1e-12, String(rho));
  });

  it("with rho = 0 it is two independent Poisson counts (renormalised over 0..10)", () => {
    const m = scoreMatrix(xg, 0);
    let mass = 0;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) mass += poisson(xg.home, i) * poisson(xg.away, j);
    for (const [i, j] of [[0, 0], [1, 0], [2, 1], [3, 3], [5, 2]] as const) {
      assert.ok(Math.abs(at(m, i, j) - (poisson(xg.home, i) * poisson(xg.away, j)) / mass) < 1e-12, `${i}-${j}`);
    }
  });

  it("a negative rho makes 0–0 and 1–1 more likely, and 1–0 and 0–1 less", () => {
    const plain = scoreMatrix(xg, 0);
    const dc = scoreMatrix(xg, -0.12);
    assert.ok(at(dc, 0, 0) > at(plain, 0, 0));
    assert.ok(at(dc, 1, 1) > at(plain, 1, 1));
    assert.ok(at(dc, 1, 0) < at(plain, 1, 0));
    assert.ok(at(dc, 0, 1) < at(plain, 0, 1));
    assert.ok(outcomeProbabilities(xg, -0.12).draw > outcomeProbabilities(xg, 0).draw);
  });

  it("home, draw and away chances add up to 100%; the likeliest scores come from the same matrix", () => {
    for (const rho of [0, -0.1]) {
      const p = outcomeProbabilities(xg, rho);
      assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-12);
    }
    const m = scoreMatrix(xg, -0.1);
    const top = likelyScores(xg, -0.1, 3);
    assert.equal(top.length, 3);
    assert.ok(top[0]!.p >= top[1]!.p && top[1]!.p >= top[2]!.p);
    assert.equal(top[0]!.p, Math.max(...m));
  });

  it("sampling follows the matrix", () => {
    const sampler = scoreSampler(xg, -0.12);
    const rng = createRng(7);
    const n = 40000;
    let draws00 = 0;
    for (let k = 0; k < n; k++) {
      const s = sampleScore(sampler, rng);
      if (s.home === 0 && s.away === 0) draws00++;
    }
    assert.ok(Math.abs(draws00 / n - at(scoreMatrix(xg, -0.12), 0, 0)) < 0.006);
  });
});

describe("team home advantage", () => {
  const model: LeagueModel = {
    avgHomeGoals: 1.5,
    avgAwayGoals: 1.2,
    strengths: new Map([
      [1, { attack: 1, defence: 1 }],
      [2, { attack: 1, defence: 1 }],
    ]),
  };

  it("a club with no split plays at the league's home advantage", () => {
    assert.deepEqual(expectedGoals(model, 1, 2), { home: 1.5, away: 1.2 });
    assert.deepEqual(expectedGoals({ ...model, homeFactor: new Map([[3, 1.2]]) }, 1, 2), { home: 1.5, away: 1.2 });
  });

  it("a club's split k makes its home/away ratio k times the league's", () => {
    const k = 1.2;
    const m = { ...model, homeFactor: new Map([[1, k]]) };
    const home = expectedGoals(m, 1, 2);
    const away = expectedGoals(m, 2, 1);
    // Club 1's goal ratio at home over away (for and against), against the league's.
    const ratio = (home.home / home.away) / (away.away / away.home);
    const league = (1.5 / 1.2) / (1.2 / 1.5);
    assert.ok(Math.abs(ratio / league - k) < 1e-9, String(ratio / league));
  });

  it("generated splits stay within ±30% of the league's (see scripts/priorsLib.ts) and the switch is set by the backtest", () => {
    // The clamp is applied when the priors are built; here, the stored ones.
    return import("../data/priors/index.ts").then(({ PRIOR_SEASONS }) => {
      for (const season of Object.values(PRIOR_SEASONS)) {
        for (const league of Object.values(season)) for (const k of Object.values(league.home)) assert.ok(k >= 0.7 && k <= 1.3, String(k));
      }
      assert.equal(DIXON_COLES, true);
      assert.equal(TEAM_HOME_ADVANTAGE, false, "off: the backtest found it worse");
      assert.equal(matchParamOptions({ rho: -0.1 }).homeFactor, undefined);
    });
  });
});

describe("recency weighting", () => {
  const teams: Team[] = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `T${id}`, shortName: `T${id}`, tla: `T${id}` }));
  const fixtures = doubleRoundRobin(teams.map((t) => t.id));
  // A season where club 1 starts badly and finishes well.
  const results: ResultMap = Object.fromEntries(
    fixtures.map((f) => {
      const late = f.matchday > 5;
      const one = f.homeId === 1 || f.awayId === 1;
      const oneHome = f.homeId === 1;
      if (!one) return [f.id, { home: 1, away: 1 }];
      const oneWins = late;
      return [f.id, oneWins === oneHome ? { home: 2, away: 0 } : { home: 0, away: 2 }];
    }),
  );

  it("weights fall with age, and are all 1 with no half-life", () => {
    assert.equal(decayWeight(0, 10), 1);
    assert.ok(Math.abs(decayWeight(10, 10) - 0.5) < 1e-12);
    assert.ok(decayWeight(3, 10) > decayWeight(4, 10));
    assert.equal(decayWeight(25, Infinity), 1);
    assert.equal(RATING_HALF_LIFE, Infinity, "off: the backtest found every half-life worse");
  });

  it("an infinite half-life reproduces the plain ratings exactly", () => {
    const plain = buildLeagueModel(teams, fixtures, results, { priorGames: 6 });
    const infinite = buildLeagueModel(teams, fixtures, results, { priorGames: 6, halfLife: Infinity });
    assert.deepEqual([...infinite.strengths], [...plain.strengths]);
  });

  it("with a half-life, a strong finish counts for more; the league still averages 1.0", () => {
    const plain = buildLeagueModel(teams, fixtures, results, { priorGames: 6 });
    const recent = buildLeagueModel(teams, fixtures, results, { priorGames: 6, halfLife: 3 });
    assert.ok(recent.strengths.get(1)!.attack > plain.strengths.get(1)!.attack);
    const mean = (k: "attack" | "defence") => [...recent.strengths.values()].reduce((s, x) => s + x[k], 0) / recent.strengths.size;
    assert.ok(Math.abs(mean("attack") - 1) < 1e-9 && Math.abs(mean("defence") - 1) < 1e-9);
  });

  it("a short streak can't stand for less than the minimum of games against the prior", () => {
    // Two games, a very short half-life: the weighted games are floored at the two played.
    const early = fixtures.filter((f) => f.matchday <= 2);
    const few = Object.fromEntries(early.map((f) => [f.id, results[f.id]!]));
    const priorStrengths = new Map(teams.map((t) => [t.id, { attack: 1, defence: 1 }]));
    const floored = buildLeagueModel(teams, early, few, { priorGames: 6, halfLife: 0.5, priorStrengths });
    const unweighted = buildLeagueModel(teams, early, few, { priorGames: 6, priorStrengths });
    // Same shrinkage weight as the two plain games (2 / (2 + 6)), not the near-zero decayed sum.
    assert.ok(Math.abs(floored.strengths.get(1)!.attack - 1) > 0.5 * Math.abs(unweighted.strengths.get(1)!.attack - 1));
  });
});
