import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLeagueByCode, LEAGUES } from "../config/leagues.ts";
import { matchParamOptions, ratingXgWeight } from "../engine/ratings.ts";
import { domesticMatchParams, domesticModelOptions, leagueMatchParams } from "./priors.ts";
import { XG_LEAGUES } from "./xg.ts";
import { readXg } from "./xgStore.ts";

const xg = { 101: [1.4, 0.6], 102: [0.9, 2.1] } as const;

describe("xG in the live models", () => {
  it("only leagues ESPN has xG for lean on it, and only ESPN ones", () => {
    for (const league of LEAGUES.filter((l) => ratingXgWeight(l) > 0)) {
      assert.ok(XG_LEAGUES.includes(league.code), `${league.code} has no xG`);
      assert.ok(league.espn, `${league.code} has no ESPN feed`);
      assert.ok(ratingXgWeight(league) <= 1);
    }
  });

  it("a league whose ratings don't use xG gets exactly the options it had, xG given or not", () => {
    for (const league of LEAGUES.filter((l) => ratingXgWeight(l) === 0 && !l.continental)) {
      assert.deepEqual(leagueMatchParams(league, 2026, xg), domesticMatchParams(league.code, 2026));
      assert.deepEqual(domesticModelOptions(league, 2026, xg), domesticModelOptions(league, 2026));
    }
  });

  it("the Brasileirão and MLS rate on half xG, half goals", () => {
    for (const code of ["BSA", "MLS"] as const) {
      const league = getLeagueByCode(code)!;
      assert.equal(ratingXgWeight(league), 0.5);
      assert.deepEqual(leagueMatchParams(league, 2026, xg), { ...domesticMatchParams(code, 2026), xg, xgWeight: 0.5 });
      const options = domesticModelOptions(league, 2026, xg);
      assert.equal(options.xg, xg);
      assert.equal(options.xgWeight, 0.5);
      // Without stored xG (a game ESPN has none for, sample data): goals only.
      assert.equal(domesticModelOptions(league, 2026).xg, undefined);
      assert.equal(domesticModelOptions(league, 2026, {}).xgWeight, 0.5, "an empty table: every game falls back to its goals");
    }
  });

  it("the client's options carry the same xG and weight as the server's", () => {
    const league = getLeagueByCode("BSA")!;
    const options = matchParamOptions(leagueMatchParams(league, 2026, xg));
    assert.equal(options.xg, xg);
    assert.equal(options.xgWeight, 0.5);
    assert.deepEqual(matchParamOptions({ xg }), {}, "no weight, no xG");
  });

  it("reads the stored files: games without xG are left out, an unknown league has none", async () => {
    const bsa = await readXg("BSA");
    assert.ok(Object.keys(bsa).length > 300);
    for (const [home, away] of Object.values(bsa)) assert.ok(Number.isFinite(home) && Number.isFinite(away) && home + away > 0);
    assert.deepEqual(await readXg("NOPE"), {});
  });
});
