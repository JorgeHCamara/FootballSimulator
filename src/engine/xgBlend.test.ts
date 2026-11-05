import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildLeagueModel } from "./ratings.ts";
import { realResults } from "./results.ts";
import type { Fixture, Team } from "./types.ts";

const snap = JSON.parse(readFileSync(new URL("../lib/testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const results = realResults(snap.fixtures);
const played = snap.fixtures.filter((f) => f.result);
const options = { priorGames: 18, rho: -0.12 };
/** Made-up xG for every played game: the reverse of the score (the loser "should have won"). */
const reversed = Object.fromEntries(played.map((f) => [f.id, [f.result!.away, f.result!.home] as const]));

describe("rating on a blend of xG and goals", () => {
  it("weight 0 (the default) is today's ratings exactly, xG or not", () => {
    const plain = buildLeagueModel(snap.teams, snap.fixtures, results, options);
    assert.deepEqual(buildLeagueModel(snap.teams, snap.fixtures, results, { ...options, xg: reversed }), plain);
    assert.deepEqual(buildLeagueModel(snap.teams, snap.fixtures, results, { ...options, xg: reversed, xgWeight: 0 }), plain);
  });

  it("a game without xG counts its goals, whatever the weight", () => {
    const plain = buildLeagueModel(snap.teams, snap.fixtures, results, options);
    assert.deepEqual(buildLeagueModel(snap.teams, snap.fixtures, results, { ...options, xg: {}, xgWeight: 0.7 }), plain);
    // xG for one game: only the clubs connected to it move.
    const one = played[0]!;
    const model = buildLeagueModel(snap.teams, snap.fixtures, results, { ...options, xg: { [one.id]: [one.result!.home, one.result!.away] }, xgWeight: 1 });
    assert.deepEqual(model, plain, "xG equal to the goals: nothing changes");
  });

  it("each game's goals become w × xG + (1 − w) × goals", () => {
    // Two clubs, one game 3–0 with xG 1.0–1.0: at w = 0.5 the ratings see 2.0–0.5.
    const teams: Team[] = [1, 2].map((id) => ({ id, name: `T${id}`, shortName: `T${id}`, tla: `T${id}` }));
    const game: Fixture = { id: 7, matchday: 1, utcDate: "2026-08-01T15:00Z", homeId: 1, awayId: 2, result: { home: 3, away: 0 } };
    const blended: Fixture = { ...game, result: { home: 2, away: 0.5 } };
    const opts = { priorGames: 0, priorMatches: 1e9, iterations: 1 };
    const viaXg = buildLeagueModel(teams, [game], realResults([game]), { ...opts, xg: { 7: [1, 1] }, xgWeight: 0.5 });
    const direct = buildLeagueModel(teams, [blended], realResults([blended]), opts);
    for (const id of [1, 2]) {
      assert.ok(Math.abs(viaXg.strengths.get(id)!.attack - direct.strengths.get(id)!.attack) < 1e-6);
      assert.ok(Math.abs(viaXg.strengths.get(id)!.defence - direct.strengths.get(id)!.defence) < 1e-6);
    }
    // League goal averages stay on the goals.
    assert.equal(viaXg.avgHomeGoals, buildLeagueModel(teams, [game], realResults([game]), opts).avgHomeGoals);
  });

  it("more weight on xG moves the ratings toward what xG says", () => {
    const ratings = (w: number) => buildLeagueModel(snap.teams, snap.fixtures, results, { ...options, xg: reversed, xgWeight: w });
    const leader = [...ratings(0).strengths].sort((a, b) => b[1].attack - a[1].attack)[0]![0];
    const attack = [0, 0.3, 0.7, 1].map((w) => ratings(w).strengths.get(leader)!.attack);
    for (let i = 1; i < attack.length; i++) assert.ok(attack[i]! < attack[i - 1]!, attack.join(" > "));
  });
});
