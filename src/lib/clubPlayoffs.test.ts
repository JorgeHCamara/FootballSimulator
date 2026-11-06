import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import { runMonteCarlo, runMonteCarloVariants } from "../engine/montecarlo.ts";
import { leagueOutlook, outlookSetup, type ClubOutlook } from "./clubOutlook.ts";
import { getLeagueData } from "./leagueData.ts";

// The generated sample leagues (no network).
process.env.FOOTSIMU_SAMPLE_DATA = "1";

const ITERATIONS = 2000;
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual}, expected ${expected}`);
const sum = (clubs: ClubOutlook[], value: (c: ClubOutlook) => number) => clubs.reduce((total, c) => total + value(c), 0);

async function outlookOf(code: string) {
  const league = getLeagueByCode(code)!;
  const data = await getLeagueData(league);
  const setup = outlookSetup(league, data)!;
  const outlook = leagueOutlook(league, data, ITERATIONS, undefined, setup)!;
  return { league, setup, outlook, clubs: [...outlook.clubs.values()] };
}

describe("play-offs on club pages", () => {
  it("the Championship: promotion via the play-offs, and promotion in all (the two automatic places and the play-off winner)", async () => {
    const { setup, clubs } = await outlookOf("ELC");
    assert.ok(setup.input.playoff, "the outlook plays the play-off");
    for (const c of clubs) {
      assert.equal(c.playoff?.kind, "promotion");
      assert.equal(c.playoff?.name, "Premier League");
      // Every route, never two in one season.
      near(c.playoff!.promoted!, (c.distribution[0] ?? 0) + (c.distribution[1] ?? 0) + c.playoff!.win, c.team.name);
      // The headline's promotion is every route.
      assert.equal(c.headline.find((h) => h.kind === "promotion")?.chance, c.playoff!.promoted);
      assert.ok(c.playoff!.win <= c.playoff!.final + 1e-12);
    }
    near(sum(clubs, (c) => c.playoff!.win), 1, "one play-off winner a season");
    near(sum(clubs, (c) => c.playoff!.final), 2, "two finalists");
    near(sum(clubs, (c) => c.playoff!.promoted!), 3, "three promoted");
  });

  it("Série B: four up in all, the play-off winner one of them", async () => {
    const { league, clubs } = await outlookOf("BSB");
    const direct = league.playoff!.directPromotion!.length;
    for (const c of clubs) assert.equal(c.playoff?.kind, "promotion");
    near(sum(clubs, (c) => c.playoff!.win), 1, "one winner a season");
    near(sum(clubs, (c) => c.playoff!.promoted!), direct + 1, "promoted");
  });

  it("MLS: the MLS Cup from both conferences' play-offs, in the headline by its name", async () => {
    const { setup, clubs } = await outlookOf("MLS");
    assert.ok(setup.input.playoff?.config.groupStage && setup.input.groups?.length, "conferences, then the MLS Cup");
    for (const c of clubs) {
      assert.equal(c.playoff?.kind, "title");
      assert.equal(c.playoff?.name, "MLS Cup");
      assert.equal(c.playoff?.promoted, undefined);
      const cup = c.headline.find((h) => h.kind === "playoffWin");
      assert.equal(cup?.name, "MLS Cup");
      assert.equal(cup?.chance, c.playoff!.win);
    }
    near(sum(clubs, (c) => c.playoff!.win), 1, "one champion a season");
    near(sum(clubs, (c) => c.playoff!.final), 2, "two finalists");
    // Only a club in the play-off places can win it.
    for (const c of clubs) assert.ok(c.playoff!.win <= (c.zones.find((z) => z.kind === "playoffs")?.chance ?? 0) + (c.zones.find((z) => z.kind === "playoffWildCard")?.chance ?? 0) + 1e-9);
  });

  it("Serie B: when 3rd is far enough clear the play-off isn't held and 3rd goes up: three up in all every season", async () => {
    const { clubs } = await outlookOf("SB");
    near(sum(clubs, (c) => c.playoff!.promoted!), 3, "promoted");
    assert.ok(sum(clubs, (c) => c.playoff!.win) <= 1 + 1e-9);
  });

  it("playing the play-off leaves every table chance as it was (its draws are its own), and each result's variant is still a run of its own", async () => {
    for (const code of ["ELC", "MLS"]) {
      const { setup } = await outlookOf(code);
      const { playoff: _, ...table } = setup.input;
      const withPlayoff = runMonteCarlo({ ...setup.input, iterations: ITERATIONS, seed: 2026 });
      const without = runMonteCarlo({ ...table, iterations: ITERATIONS, seed: 2026 });
      assert.deepEqual(withPlayoff.positionCounts, without.positionCounts, code);
      assert.deepEqual(withPlayoff.averagePoints, without.averagePoints, code);
      const game = setup.input.fixtures.find((f) => !setup.input.fixed[f.id])!;
      const override = { [game.id]: { home: 2, away: 0 } };
      assert.deepEqual(runMonteCarloVariants({ ...setup.input, iterations: 500, seed: 2026 }, [override])[0], runMonteCarlo({ ...setup.input, iterations: 500, seed: 2026, override }), code);
    }
  });
});
