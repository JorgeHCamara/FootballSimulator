import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expectedGoals, outcomeProbabilities, samplePoisson, simulateFixtures } from "./match.ts";
import { probabilityInRange, runMonteCarlo } from "./montecarlo.ts";
import { buildLeagueModel, type LeagueModel } from "./ratings.ts";
import { effectiveResults } from "./results.ts";
import { createRng } from "./rng.ts";
import { doubleRoundRobin } from "./schedule.ts";
import { computeStandings } from "./standings.ts";
import type { ResultMap, Team } from "./types.ts";

const makeTeams = (n: number): Team[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Team ${String(i + 1).padStart(2, "0")}`, shortName: `T${i + 1}`, tla: `T${i + 1}` }));

const neutralModel = (teams: Team[]): LeagueModel => ({
  avgHomeGoals: 1.55,
  avgAwayGoals: 1.25,
  strengths: new Map(teams.map((t) => [t.id, { attack: 1, defence: 1 }])),
});

/** Team 1 strongest, last team weakest. */
const gradedModel = (teams: Team[]): LeagueModel => ({
  avgHomeGoals: 1.55,
  avgAwayGoals: 1.25,
  strengths: new Map(
    teams.map((t, i) => {
      const x = 1 - (2 * i) / (teams.length - 1); // +1 .. -1
      return [t.id, { attack: Math.exp(0.4 * x), defence: Math.exp(-0.4 * x) }];
    }),
  ),
});

const pearson = (xs: number[], ys: number[]) => {
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i]! - my);
    dx += (x - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  });
  return num / Math.sqrt(dx * dy);
};

describe("rng", () => {
  it("is deterministic per seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = Array.from({ length: 5 }, a);
    assert.deepEqual(seqA, Array.from({ length: 5 }, b));
    assert.notDeepEqual(seqA, Array.from({ length: 5 }, c));
    assert.ok(seqA.every((x) => x >= 0 && x < 1));
  });
});

describe("match model", () => {
  it("samples Poisson with the right mean and variance", () => {
    const rng = createRng(7);
    const lambda = 1.4;
    const n = 50_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const k = samplePoisson(lambda, rng);
      sum += k;
      sumSq += k * k;
    }
    const mean = sum / n;
    assert.ok(Math.abs(mean - lambda) < 0.03, `mean ${mean}`);
    assert.ok(Math.abs(sumSq / n - mean * mean - lambda) < 0.05);
  });

  it("gives exact outcome probabilities that sum to 1 and favour the stronger side", () => {
    const even = outcomeProbabilities({ home: 1.3, away: 1.3 });
    assert.ok(Math.abs(even.home + even.draw + even.away - 1) < 1e-9);
    assert.ok(Math.abs(even.home - even.away) < 1e-9);
    const lopsided = outcomeProbabilities({ home: 2.5, away: 0.6 });
    assert.ok(lopsided.home > 0.7 && lopsided.away < 0.1);
  });

  it("includes home advantage via league averages", () => {
    const teams = makeTeams(2);
    const xg = expectedGoals(neutralModel(teams), 1, 2);
    assert.equal(xg.home, 1.55);
    assert.equal(xg.away, 1.25);
  });

  it("only simulates fixtures without a known result", () => {
    const teams = makeTeams(4);
    const fixtures = doubleRoundRobin(teams.map((t) => t.id));
    const known: ResultMap = { 1: { home: 9, away: 9 } };
    const sim = simulateFixtures(fixtures, known, neutralModel(teams), createRng(1));
    assert.equal(sim[1], undefined);
    assert.equal(Object.keys(sim).length, fixtures.length - 1);
  });

  it("produces a season whose goals per game match the model", () => {
    const teams = makeTeams(20);
    const fixtures = doubleRoundRobin(teams.map((t) => t.id));
    const rng = createRng(2025);
    let goals = 0;
    let games = 0;
    for (let season = 0; season < 20; season++) {
      const sim = simulateFixtures(fixtures, {}, neutralModel(teams), rng);
      for (const r of Object.values(sim)) {
        goals += r.home + r.away;
        games++;
      }
    }
    const perGame = goals / games;
    assert.ok(Math.abs(perGame - 2.8) / 2.8 < 0.1, `goals per game ${perGame}`);
  });
});

describe("league model (ratings)", () => {
  it("starts every team at 1.0 with no matches played", () => {
    const teams = makeTeams(4);
    const model = buildLeagueModel(teams, doubleRoundRobin(teams.map((t) => t.id)), {});
    for (const s of model.strengths.values()) assert.deepEqual(s, { attack: 1, defence: 1 });
    assert.equal(model.avgHomeGoals, 1.55);
  });

  it("shrinks early-season ratings toward the prior", () => {
    const teams = makeTeams(4);
    const fixtures = doubleRoundRobin(teams.map((t) => t.id));
    const first = fixtures[0]!;
    const results: ResultMap = { [first.id]: { home: 6, away: 0 } };
    const model = buildLeagueModel(teams, fixtures, results);
    const winner = model.strengths.get(first.homeId)!;
    assert.ok(winner.attack > 1 && winner.attack < 2, `attack ${winner.attack}`);
    assert.ok(winner.defence < 1);
  });

  it("recovers team quality from half a season of results", () => {
    const teams = makeTeams(20);
    const truth = gradedModel(teams);
    const fixtures = doubleRoundRobin(teams.map((t) => t.id));
    const firstHalf = fixtures.filter((f) => f.matchday <= 19);
    const results = simulateFixtures(firstHalf, {}, truth, createRng(99));
    const model = buildLeagueModel(teams, fixtures, results);
    const trueAttack = teams.map((t) => truth.strengths.get(t.id)!.attack);
    const estAttack = teams.map((t) => model.strengths.get(t.id)!.attack);
    const trueDef = teams.map((t) => truth.strengths.get(t.id)!.defence);
    const estDef = teams.map((t) => model.strengths.get(t.id)!.defence);
    assert.ok(pearson(trueAttack, estAttack) > 0.6, "attack correlation");
    assert.ok(pearson(trueDef, estDef) > 0.6, "defence correlation");
  });
});

describe("doubleRoundRobin", () => {
  it("schedules every pairing home and away, one game per team per matchday", () => {
    const teams = makeTeams(20);
    const fixtures = doubleRoundRobin(teams.map((t) => t.id));
    assert.equal(fixtures.length, 380);
    assert.equal(new Set(fixtures.map((f) => f.matchday)).size, 38);
    const pairs = new Set(fixtures.map((f) => `${f.homeId}-${f.awayId}`));
    assert.equal(pairs.size, 380);
    for (let md = 1; md <= 38; md++) {
      const playing = fixtures.filter((f) => f.matchday === md).flatMap((f) => [f.homeId, f.awayId]);
      assert.equal(new Set(playing).size, 20);
    }
    for (const t of teams) assert.equal(fixtures.filter((f) => f.homeId === t.id).length, 19);
  });

  it("handles an odd number of teams with byes", () => {
    const fixtures = doubleRoundRobin([1, 2, 3, 4, 5]);
    assert.equal(fixtures.length, 20);
  });
});

describe("runMonteCarlo", () => {
  const teams = makeTeams(10);
  const fixtures = doubleRoundRobin(teams.map((t) => t.id));
  const standings = { tiebreakers: ["points", "goalDifference", "goalsFor"] as const };

  it("counts every team once per run and is deterministic per seed", () => {
    const input = { teams, fixtures, fixed: {}, model: gradedModel(teams), standings, iterations: 300, seed: 5 };
    const a = runMonteCarlo(input);
    const b = runMonteCarlo(input);
    assert.deepEqual(a, b);
    for (const t of teams) assert.equal(a.positionCounts[t.id]!.reduce((x, y) => x + y, 0), 300);
    for (let p = 0; p < teams.length; p++) {
      assert.equal(teams.reduce((n, t) => n + a.positionCounts[t.id]![p]!, 0), 300);
    }
    assert.ok(probabilityInRange(a, 1, 1, 1) > probabilityInRange(a, 10, 1, 1));
    assert.ok(a.averagePoints[1]! > a.averagePoints[10]!);
  });

  it("returns certainty once every result is fixed", () => {
    const fixed = effectiveResults(fixtures, simulateFixtures(fixtures, {}, gradedModel(teams), createRng(3)));
    const table = computeStandings(teams, fixtures, fixed, standings);
    const mc = runMonteCarlo({ teams, fixtures, fixed, model: gradedModel(teams), standings, iterations: 20, seed: 1 });
    for (const row of table) assert.equal(probabilityInRange(mc, row.teamId, row.position, row.position), 1);
  });

  it("ranks each group (MLS conference) on its own", () => {
    const groups = [[1, 3, 5, 7, 9], [2, 4, 6, 8, 10]];
    const mc = runMonteCarlo({ teams, fixtures, fixed: {}, model: gradedModel(teams), standings, iterations: 200, seed: 9, groups });
    for (const group of groups) {
      for (const id of group) {
        assert.equal(mc.positionCounts[id]!.length, 5, "positions within the group only");
        assert.equal(mc.positionCounts[id]!.reduce((x, y) => x + y, 0), 200);
      }
      for (let p = 0; p < 5; p++) assert.equal(group.reduce((n, id) => n + mc.positionCounts[id]![p]!, 0), 200);
    }
  });
});
