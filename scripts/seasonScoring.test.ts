import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../src/config/leagues.ts";
import { baselinePredictions, categoriesOf, chooseNoise, metrics, noiseConfigs, scoreClubs, type Metrics, type PooledScores } from "./seasonScoring.ts";

describe("the season backtest's scores", () => {
  it("the chances scored come from the league's places", () => {
    const pl = getLeagueByCode("PL")!;
    // The Champions League places (league phase and qualifying) count as one, from the top.
    const lastChampionsLeague = Math.max(...pl.zones.filter((z) => z.kind.startsWith("championsLeague")).map((z) => z.to));
    assert.deepEqual(categoriesOf(pl.zones, true), [
      { key: "title", ranges: [[1, 1]] },
      { key: "top", ranges: [[1, lastChampionsLeague]] },
      { key: "relegation", ranges: [[18, 20]] },
    ]);
    const elc = getLeagueByCode("ELC")!;
    const keys = categoriesOf(elc.zones, true).map((c) => c.key);
    assert.deepEqual(keys, ["title", "top", "relegation", "promotionPlayoff"], "a second tier: promotion is its top places");
    // No title in the table (MLS: the play-offs decide it), but play-off places.
    assert.deepEqual(categoriesOf(getLeagueByCode("MLS")!.zones, false).map((c) => c.key), ["playoffs"]);
  });

  it("a certain, right prediction scores 0; a certain, wrong one scores the most", () => {
    const league = { final: { 1: 1, 2: 2, 3: 3 }, tableSize: { 1: 3, 2: 3, 3: 3 }, categories: [{ key: "title", ranges: [[1, 1]] as [number, number][] }] };
    const right = metrics(scoreClubs(league, baselinePredictions(league, { 1: 1, 2: 2, 3: 3 })));
    assert.equal(right.rps, 0);
    assert.equal(right.brier.title, 0);
    assert.equal(right.mae, 0);
    const wrong = metrics(scoreClubs(league, baselinePredictions(league, { 1: 3, 2: 2, 3: 1 })));
    // Club 1 put 3rd, club 3 put 1st: RPS (1 + 1) / 2 for each of them, 0 for club 2.
    assert.ok(Math.abs(wrong.rps - 2 / 3) < 1e-12);
    assert.ok(Math.abs(wrong.brier.title! - 2 / 3) < 1e-12);
    assert.ok(Math.abs(wrong.mae - 4 / 3) < 1e-12);
  });

  it("the ranked probability score of a spread prediction, by hand", () => {
    const league = { final: { 1: 2 }, tableSize: { 1: 3 }, categories: [] };
    // Chances 0.5 / 0.3 / 0.2 of 1st / 2nd / 3rd, the club 2nd: ((0.5 − 0)² + (0.8 − 1)²) / 2 = 0.145.
    const m = metrics(scoreClubs(league, { 1: { dist: [0.5, 0.3, 0.2], expected: 1.7 } }));
    assert.ok(Math.abs(m.rps - 0.145) < 1e-12);
    assert.ok(Math.abs(m.mae - 0.3) < 1e-12);
  });

  it("calibration buckets: the average chance against how often it happened, the count, the small ones flagged", () => {
    const final: Record<string, number> = {};
    const preds: Record<string, { dist: number[]; expected: number }> = {};
    // 40 clubs given a 20% title chance, 8 of them champions; 10 given 95%, 9 champions.
    for (let i = 1; i <= 50; i++) {
      const p = i <= 40 ? 0.2 : 0.95;
      preds[i] = { dist: [p, 1 - p], expected: 2 - p };
      final[i] = (i <= 40 ? i <= 8 : i <= 49) ? 1 : 2;
    }
    const m = metrics(scoreClubs({ final, categories: [{ key: "title", ranges: [[1, 1]] }] }, preds));
    const b20 = m.calibration.find((b) => b.bucket === "15–30%")!;
    assert.equal(b20.n, 40);
    assert.ok(Math.abs(b20.predicted - 0.2) < 1e-12 && Math.abs(b20.actual - 0.2) < 1e-12);
    assert.equal(b20.tooFewToTrust, false);
    const b95 = m.calibration.find((b) => b.bucket === "90–100%")!;
    assert.equal(b95.n, 10);
    assert.equal(b95.tooFewToTrust, true);
    // Calibration error: 0 for the first bucket, |0.95 − 0.9| for the 10 in the last.
    assert.ok(Math.abs(m.calibrationError - (10 * 0.05) / 50) < 1e-12);
  });
});

describe("rating-noise runs and the selection rule", () => {
  it("no noise once, then every spread with every fade constant", () => {
    assert.deepEqual(noiseConfigs([0, 0.1], [5, 20]).map((c) => c.key), ["0", "0.1/5", "0.1/20"]);
    // A single k keeps the plain keys of earlier runs.
    assert.deepEqual(noiseConfigs([0, 0.05, 0.1], [18]).map((c) => [c.key, c.sd, c.k]), [["0", 0, 18], ["0.05", 0.05, 18], ["0.1", 0.1, 18]]);
  });

  const scores = (rps: number, calibration: number[], title: number): PooledScores => {
    const m = (rpsValue: number, ce: number): Metrics => ({ clubs: 100, brier: { title }, rps: rpsValue, mae: 2, calibration: [], calibrationError: ce });
    return { all: m(rps, Math.max(...calibration)), byCheckpoint: Object.fromEntries(calibration.map((ce, i) => [String(i * 10), m(rps, ce)])) };
  };

  it("the lowest RPS that keeps calibration and the title Brier within their margins", () => {
    const runs = {
      0: scores(0.1, [0.02, 0.01], 0.03),
      // Best RPS, but one checkpoint's calibration error 0.003 worse: out.
      "0.3/5": scores(0.09, [0.02, 0.013], 0.03),
      // Title Brier 2% worse: out.
      "0.25/10": scores(0.091, [0.01, 0.01], 0.0306),
      "0.2/20": scores(0.093, [0.015, 0.0115], 0.0302),
      "0.15/40": scores(0.095, [0.01, 0.01], 0.03),
    };
    const { chosen, runnerUp, candidates } = chooseNoise(runs);
    assert.equal(chosen, "0.2/20");
    assert.equal(runnerUp, "0.15/40");
    assert.deepEqual(candidates.map((c) => [c.key, c.eligible]), [["0.3/5", false], ["0.25/10", false], ["0.2/20", true], ["0.15/40", true]]);
    assert.ok(Math.abs(candidates[1]!.titleBrierChange - 0.02) < 1e-9);
  });

  it("nothing better than no noise: none chosen (keep it off)", () => {
    const { chosen, candidates } = chooseNoise({ 0: scores(0.1, [0.01], 0.03), "0.2/10": scores(0.101, [0.01], 0.03) });
    assert.equal(chosen, undefined);
    assert.equal(candidates[0]!.eligible, false);
  });
});

