import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import { LIKELY_MAX_SCORES, LIKELY_MIN_SCORES, likelyScoreSet, outcomeProbabilities, sampleLikelyScore, scoreMatrix, MAX_SCORE } from "./match.ts";
import { runMonteCarlo } from "./montecarlo.ts";
import { buildLeagueModel } from "./ratings.ts";
import { realResults } from "./results.ts";
import { createRng } from "./rng.ts";
import type { Fixture, Score, Team } from "./types.ts";

const key = (s: Score) => `${s.home}-${s.away}`;
const resultOf = (s: Score) => Math.sign(s.home - s.away);
const roll = (xg: { home: number; away: number }, rho: number, n: number, seed = 1) => {
  const rng = createRng(seed);
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const s = sampleLikelyScore(xg, rng, rho);
    counts.set(key(s), (counts.get(key(s)) ?? 0) + 1);
  }
  return counts;
};

describe("likely roll (the simulator's buttons)", () => {
  const balanced = { home: 1.4, away: 1.2 };

  it("3 to 6 scores, the likeliest ones, with chances adding up to 1", () => {
    for (const xg of [balanced, { home: 2.8, away: 0.4 }, { home: 0.6, away: 0.6 }, { home: 0.9, away: 2.1 }]) {
      const set = likelyScoreSet(xg, -0.1);
      assert.ok(set.length >= LIKELY_MIN_SCORES && set.length <= LIKELY_MAX_SCORES, `${set.length} scores`);
      assert.ok(Math.abs(set.reduce((a, s) => a + s.p, 0) - 1) < 1e-12);
      // In order of chance, the first being the matrix's likeliest score.
      for (let i = 1; i < set.length; i++) assert.ok(set[i - 1]!.p >= set[i]!.p);
      const matrix = scoreMatrix(xg, -0.1);
      const best = matrix.indexOf(Math.max(...matrix));
      assert.equal(key(set[0]!), `${Math.floor(best / (MAX_SCORE + 1))}-${best % (MAX_SCORE + 1)}`);
    }
  });

  it("only ever rolls a score from the set, the likeliest most often", () => {
    const set = likelyScoreSet(balanced, -0.1);
    const counts = roll(balanced, -0.1, 10_000);
    for (const score of counts.keys()) assert.ok(set.some((s) => key(s) === score), score);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    assert.equal(top, key(set[0]!));
  });

  it("a balanced Premier League game (1.4 v 1.2) never gives 5 or more goals", () => {
    for (const rho of [0, -0.12]) {
      const rng = createRng(3);
      for (let i = 0; i < 10_000; i++) {
        const s = sampleLikelyScore(balanced, rng, rho);
        assert.ok(s.home + s.away < 5, key(s));
      }
    }
  });

  it("every result at least 20% likely can come out", () => {
    for (let home = 0.4; home <= 3; home += 0.2) {
      for (let away = 0.4; away <= 3; away += 0.2) {
        const xg = { home, away };
        const p = outcomeProbabilities(xg, -0.1);
        const set = likelyScoreSet(xg, -0.1);
        for (const [result, chance] of [[1, p.home], [0, p.draw], [-1, p.away]] as const) {
          if (chance >= 0.2) assert.ok(set.some((s) => resultOf(s) === result), `${home.toFixed(1)} v ${away.toFixed(1)}: result ${result} at ${chance.toFixed(2)}`);
        }
      }
    }
    // …and does, in the rolls: a balanced game's draw (~27%) and away win (~30%).
    const results = new Set([...roll(balanced, -0.1, 2000).keys()].map((k) => Math.sign(Number(k.split("-")[0]) - Number(k.split("-")[1]))));
    assert.deepEqual([...results].sort(), [-1, 0, 1]);
  });

  it("re-rolling gives another score than the one already there", () => {
    const rng = createRng(9);
    const current = likelyScoreSet(balanced, -0.1)[0]!;
    for (let i = 0; i < 500; i++) assert.notEqual(key(sampleLikelyScore(balanced, rng, -0.1, current)), key(current));
  });
});

describe("the chances keep the full score distribution", () => {
  it("the season Monte Carlo gives the same counts as before the likely roll (same seed)", () => {
    const snap = JSON.parse(readFileSync(new URL("../lib/testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
    const pl = getLeagueByCode("PL")!;
    const fixed = realResults(snap.fixtures);
    const model = buildLeagueModel(snap.teams, snap.fixtures, fixed, { priorGames: 18, rho: -0.12 });
    const r = runMonteCarlo({ teams: snap.teams, fixtures: snap.fixtures, fixed, model, standings: { tiebreakers: pl.tiebreakers }, iterations: 2000, seed: 42 });
    // Recorded with the previous commit's code (title wins, relegations), by ESPN club id.
    const before: Record<number, [number, number]> = {
      306: [2, 99], 331: [862, 0], 337: [51, 9], 349: [6, 59], 357: [3, 76], 359: [695, 0], 360: [0, 605], 361: [1, 294], 362: [3, 136], 363: [54, 13],
      364: [19, 9], 366: [0, 1107], 367: [0, 138], 368: [4, 80], 370: [1, 354], 373: [1, 311], 382: [298, 0], 384: [0, 1191], 388: [0, 607], 393: [0, 912],
    };
    for (const t of snap.teams) {
      const counts = r.positionCounts[t.id]!;
      assert.deepEqual([counts[0], counts.slice(17).reduce((a, b) => a + b, 0)], before[t.id], t.name);
    }
  });
});
