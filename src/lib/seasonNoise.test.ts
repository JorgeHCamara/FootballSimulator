import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import { expectedGoals, outcomeProbabilities, sampleLikelyScore } from "../engine/match.ts";
import { runMonteCarlo } from "../engine/montecarlo.ts";
import { buildLeagueModel } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import { createRng } from "../engine/rng.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { leagueOutlook, outlookSetup } from "./clubOutlook.ts";
import { withClubPages } from "./clubs.ts";
import { getLeagueData, type LeagueData } from "./leagueData.ts";
import { gameXg, preMatchModel } from "./matchPreview.ts";
import { domesticModelOptions } from "./priors.ts";
import { scenarioSimulation } from "./scenario.ts";
import { SEASON_RATING_NOISE, seasonRatingNoise } from "./seasonNoise.ts";
import { SIM_VERSION } from "./simVersion.ts";

const pl = getLeagueByCode("PL")!;
const snap = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const data: LeagueData = { teams: withClubPages(pl, snap.teams), fixtures: snap.fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live" };
const nextGame = data.fixtures.filter((f) => !f.result).sort((a, b) => a.utcDate.localeCompare(b.utcDate))[0]!;
/** The model with no outlook around it: what a game's own odds come from. */
const plainModel = () => buildLeagueModel(data.teams, data.fixtures, realResults(data.fixtures), domesticModelOptions(pl, data.seasonYear, data.xg));

describe("rating noise in the season outlook", () => {
  it("one constant: sd 0.15, k 5 (the backtest's choice), for domestic leagues only; the model version moved with it", () => {
    assert.deepEqual(SEASON_RATING_NOISE, { sd: 0.15, k: 5 });
    assert.equal(seasonRatingNoise(pl), SEASON_RATING_NOISE);
    assert.equal(seasonRatingNoise(getLeagueByCode("BSA")!), SEASON_RATING_NOISE);
    assert.equal(seasonRatingNoise(getLeagueByCode("UCL")!), undefined);
    assert.equal(seasonRatingNoise(getLeagueByCode("LIB")!), undefined);
    assert.equal(SIM_VERSION, "2");
  });

  it("every outlook setup carries it: one table (and the share card), conferences, a split, annual tables", async () => {
    assert.deepEqual(outlookSetup(pl, data)!.input.ratingNoise, SEASON_RATING_NOISE);
    assert.deepEqual(scenarioSimulation(pl, data, {})!.input.ratingNoise, SEASON_RATING_NOISE);
    process.env.FOOTSIMU_SAMPLE_DATA = "1";
    for (const code of ["MLS", "GSL", "ARG", "BSA"]) {
      const league = getLeagueByCode(code)!;
      const s = outlookSetup(league, await getLeagueData(league))!;
      assert.deepEqual(s.input.ratingNoise, SEASON_RATING_NOISE, code);
    }
  });

  it("the outlook's chances are the noisy run's (not the plain one's)", () => {
    const s = outlookSetup(pl, data)!;
    const outlook = leagueOutlook(pl, data, 2000, undefined, s)!;
    const noisy = runMonteCarlo({ ...s.input, iterations: 2000, seed: 2026 });
    const { ratingNoise: _, ...plain } = s.input;
    const without = runMonteCarlo({ ...plain, iterations: 2000, seed: 2026 });
    const leader = outlook.order[0]!;
    const title = (r: typeof noisy) => r.positionCounts[leader]![0]! / r.iterations;
    assert.equal(outlook.clubs.get(leader)!.zones.find((z) => z.kind === "title")!.chance, title(noisy));
    assert.notEqual(title(noisy), title(without));
  });

  it("is off for a game's own odds and the dice: they come from the plain model, which a noisy run leaves as it was", () => {
    const s = outlookSetup(pl, data)!;
    const before = new Map([...s.model.strengths].map(([id, x]) => [id, { ...x }]));
    runMonteCarlo({ ...s.input, iterations: 500, seed: 2026 });
    assert.deepEqual(new Map([...s.model.strengths].map(([id, x]) => [id, { ...x }])), before, "the run doesn't touch the model");
    // The match page: odds and likely scores from the outlook's model, exactly the plain model's.
    const model = preMatchModel(pl, data, nextGame, s.model)!;
    const plain = plainModel();
    assert.deepEqual(gameXg(model, nextGame), expectedGoals(plain, nextGame.homeId, nextGame.awayId));
    assert.deepEqual(outcomeProbabilities(gameXg(model, nextGame), model.rho ?? 0), outcomeProbabilities(expectedGoals(plain, nextGame.homeId, nextGame.awayId), plain.rho ?? 0));
    // The dice: the same rolls from the same expected goals (likely rolls only).
    const xg = gameXg(model, nextGame);
    const rolls = (seed: number) => Array.from({ length: 20 }, (_, i) => sampleLikelyScore(xg, createRng(seed + i), model.rho ?? 0));
    assert.deepEqual(rolls(1), Array.from({ length: 20 }, (_, i) => sampleLikelyScore(expectedGoals(plain, nextGame.homeId, nextGame.awayId), createRng(1 + i), plain.rho ?? 0)));
  });
});
