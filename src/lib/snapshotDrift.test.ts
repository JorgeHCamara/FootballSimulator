import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { leagueOutlook, outlookSetup } from "./clubOutlook.ts";
import { withClubPages } from "./clubs.ts";
import type { LeagueData } from "./leagueData.ts";
import { SIM_VERSION } from "./simVersion.ts";
import { completedRounds, DRIFT_EPSILON, REPRODUCIBLE_MODELS, snapshotAfter, snapshotDrift, snapshotModel, type LeagueSnapshots, type OddsSnapshot } from "./snapshots.ts";

const pl = getLeagueByCode("PL")!;
const snap = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const data: LeagueData = { teams: withClubPages(pl, snap.teams), fixtures: snap.fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live" };
const round = completedRounds(data.fixtures, Date.parse("2026-11-05T12:00:00Z")).at(-1)!;
const taken = new Date("2026-11-05T12:00:00Z");
const take = (d: LeagueData, model?: string) => snapshotAfter(pl, d, round.round, round.lastKickoff, taken, 2000, model)!;
const copy = (s: OddsSnapshot): OddsSnapshot => JSON.parse(JSON.stringify(s));

describe("snapshot drift", () => {
  it("a snapshot taken again with the same engine, data and model is the same: no drift (an exact match)", () => {
    assert.equal(DRIFT_EPSILON, 0);
    for (const model of Object.keys(REPRODUCIBLE_MODELS)) {
      const stored = copy(take(data, model));
      assert.equal(snapshotModel(stored), model);
      assert.deepEqual(snapshotDrift(stored, take(data, model)), [], `model ${model}`);
    }
  });

  it("model 1 is today's engine without rating noise; today's model has it", () => {
    const setup = outlookSetup(pl, data)!;
    assert.ok(setup.input.ratingNoise, "today's outlook has rating noise");
    const without = leagueOutlook(pl, data, 2000, undefined, REPRODUCIBLE_MODELS["1"]!(setup))!;
    const { ratingNoise: _, ...plain } = setup.input;
    assert.deepEqual([...without.clubs.values()].map((c) => c.zones), [...leagueOutlook(pl, data, 2000, undefined, { ...setup, input: plain })!.clubs.values()].map((c) => c.zones));
    // The two models' snapshots differ, so a snapshot is compared with its own model only.
    assert.notDeepEqual(snapshotDrift(take(data, "1"), take(data, SIM_VERSION)), []);
    assert.throws(() => take(data, "0"), /can't be reproduced/);
  });

  it("finds a changed chance, a changed table and a club that isn't there", () => {
    const stored = copy(take(data));
    const [first, second] = Object.keys(stored.teams);
    stored.teams[first!]!.chances.title = (stored.teams[first!]!.chances.title ?? 0) + 0.0001;
    const drift = snapshotDrift(stored, take(data));
    assert.deepEqual(drift.map((d) => `${d.teamId}:${d.field}`), [`${first}:chances.title`]);
    assert.ok(Math.abs(drift[0]!.stored! - drift[0]!.again! - 0.0001) < 1e-9);
    // A result before the round's moment changed (ESPN corrected it): the table and the chances move.
    const game = data.fixtures.find((f) => f.result && f.utcDate < round.lastKickoff)!;
    const corrected: LeagueData = { ...data, fixtures: data.fixtures.map((f) => (f.id === game.id ? { ...f, result: { home: f.result!.away, away: f.result!.home } } : f)) };
    const moved = snapshotDrift(copy(take(data)), take(corrected));
    assert.ok(moved.some((d) => d.field === "points"));
    assert.ok(moved.some((d) => d.field.startsWith("chances.")));
    // A club missing from one of them.
    const missing = copy(take(data));
    delete missing.teams[second!];
    assert.deepEqual(snapshotDrift(missing, take(data)).map((d) => `${d.teamId}:${d.field}`), [`${second}:club`]);
  });

  it("every stored snapshot file can be checked: rounds in order, and its latest of a model the engine can take again", () => {
    const dir = new URL("../data/snapshots/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 30);
    for (const name of files) {
      const file = JSON.parse(readFileSync(new URL(name, dir), "utf8")) as LeagueSnapshots;
      assert.ok(getLeagueByCode(file.league), name);
      for (const [key, season] of Object.entries(file.seasons)) {
        const rounds = season.snapshots.map((s) => s.round);
        assert.deepEqual(rounds, [...rounds].sort((a, b) => a - b), `${name} ${key}: rounds in order`);
        const latest = season.snapshots.at(-1);
        if (latest) assert.ok(REPRODUCIBLE_MODELS[snapshotModel(latest)], `${name} ${key}: model ${snapshotModel(latest)}`);
      }
    }
  });
});
