import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAGUES } from "../config/leagues.ts";
import type { Fixture } from "../engine/types.ts";
import type { LeagueData } from "./leagueData.ts";
import { ACTIVE_AFTER_MS, ACTIVE_BEFORE_MS, activeGame, OVERDUE_MS, PERIODIC_RUNS, periodicTurn, refreshPlan, refreshReason, RUN_MS } from "./leagueRefresh.ts";

const HOUR = 3_600_000;
// A run of the job: Monday 9 November 2026, 12:07 UTC.
const now = Date.parse("2026-11-09T12:07:00Z");
const game = (id: number, kickoff: number, result: Fixture["result"] = null): Fixture => ({ id, matchday: 1, utcDate: new Date(kickoff).toISOString(), homeId: 1, awayId: 2, result });
const data = (fixtures: Fixture[], extra: Partial<LeagueData> = {}): LeagueData => ({ teams: [], fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live", provider: "espn", ...extra });
const PL = LEAGUES.find((l) => l.code === "PL")!;
// The run just before PL's periodic turn: an idle league isn't checked on it.
const idleRun = (() => {
  let t = now;
  while (periodicTurn("PL", t)) t += RUN_MS;
  return t;
})();

describe("which leagues a refresh run checks", () => {
  it("a game near, under way or just over: every run", () => {
    assert.equal(activeGame(data([game(1, now + ACTIVE_BEFORE_MS - 60_000)]), now), true, "kick-off within two hours");
    assert.equal(activeGame(data([game(1, now - HOUR)]), now), true, "under way");
    assert.equal(activeGame(data([game(1, now - 3 * HOUR, { home: 1, away: 0 })]), now), true, "over, its result and a quick correction still coming in");
    assert.equal(activeGame(data([game(1, now + ACTIVE_BEFORE_MS + 60_000)]), now), false, "kick-off later than that");
    assert.equal(activeGame(data([game(1, now - ACTIVE_AFTER_MS - 60_000, { home: 1, away: 0 })]), now), false, "played and done");
  });

  it("a game without a result keeps its league checked for two days (abandoned, suspended, late); then it's taken as postponed", () => {
    assert.equal(activeGame(data([game(1, now - 20 * HOUR)]), now), true);
    assert.equal(activeGame(data([game(1, now - OVERDUE_MS - 60_000)]), now), false);
    // A postponed game left at its old date months ago doesn't keep the league checked.
    assert.equal(refreshPlan(PL, data([game(1, now - 60 * 24 * HOUR), game(2, now + 5 * 24 * HOUR)]), idleRun).why, "idle");
  });

  it("play-off and tournament games count too", () => {
    assert.equal(activeGame(data([game(1, now - 30 * 24 * HOUR, { home: 0, away: 0 })], { postseason: [game(2, now + HOUR)] }), now), true);
    const tournaments = [{ id: "clausura", name: "Clausura", season: "Clausura 2026", seasonKey: "ARG:clausura", fixtures: [game(3, now - HOUR)] }];
    assert.equal(activeGame(data([], { tournaments }), now), true);
  });

  it("an idle league on its turn, every PERIODIC_RUNS runs (three hours): each league once in every six runs, the leagues spread over them", () => {
    for (const league of LEAGUES) {
      const turns = Array.from({ length: PERIODIC_RUNS * 4 }, (_, i) => periodicTurn(league.code, now + i * RUN_MS));
      assert.equal(turns.filter(Boolean).length, 4, league.code);
      const first = turns.indexOf(true);
      assert.deepEqual(turns.flatMap((t, i) => (t ? [i - first] : [])), [0, 6, 12, 18], `${league.code}: every three hours`);
    }
    // A run started a few minutes late is still the same run.
    assert.equal(periodicTurn("PL", now + 20 * 60_000), periodicTurn("PL", now));
    const perRun = Array.from({ length: PERIODIC_RUNS }, (_, i) => LEAGUES.filter((l) => periodicTurn(l.code, now + i * RUN_MS)).length);
    assert.ok(Math.max(...perRun) <= Math.ceil(LEAGUES.length / 2), `spread over the runs: ${perRun.join(", ")}`);
  });

  it("the plan: idle leagues are skipped; a missing, failed or untrusted copy is checked; a league asked for by name or with full=1 always", () => {
    const quiet = data([game(1, now - 5 * 24 * HOUR, { home: 2, away: 1 }), game(2, now + 4 * 24 * HOUR)]);
    assert.deepEqual(refreshPlan(PL, quiet, idleRun), { check: false, why: "idle" });
    assert.deepEqual(refreshPlan(PL, quiet, idleRun, true), { check: true, why: "forced" });
    assert.deepEqual(refreshPlan(PL, undefined, idleRun), { check: true, why: "cold" });
    assert.deepEqual(refreshPlan(PL, data([]), idleRun), { check: true, why: "cold" });
    assert.deepEqual(refreshPlan(PL, { ...quiet, provider: "football-data" }, idleRun), { check: true, why: "untrusted" });
    assert.deepEqual(refreshPlan(PL, { ...quiet, source: "sample" }, idleRun), { check: true, why: "untrusted" });
    assert.deepEqual(refreshPlan(PL, data([game(1, idleRun + HOUR)]), idleRun), { check: true, why: "active" });
    let turn = idleRun;
    while (!periodicTurn("PL", turn)) turn += RUN_MS;
    assert.deepEqual(refreshPlan(PL, quiet, turn), { check: true, why: "periodic" });
    // A first-party league (Série C) has no feed: never fetched.
    assert.deepEqual(refreshPlan(LEAGUES.find((l) => l.firstParty)!, quiet, turn, true), { check: false, why: "own-data" });
  });

  it("a league's pages are refreshed only when what they show changed; a failed upstream request changes nothing", () => {
    const before = data([game(1, now - HOUR), game(2, now + 24 * HOUR)]);
    assert.equal(refreshReason(before, before), "unchanged");
    assert.equal(refreshReason(before, data([game(1, now - HOUR, { home: 1, away: 0 }), game(2, now + 24 * HOUR)])), "changed", "a result");
    assert.equal(refreshReason(before, data([game(1, now - HOUR), game(2, now + 48 * HOUR)])), "changed", "a game rescheduled");
    assert.equal(refreshReason(before, data([game(1, now - HOUR), game(2, now + 24 * HOUR)], { deductions: { 1: 3 } })), "changed", "a deduction");
    assert.equal(refreshReason(before, undefined), "unavailable", "ESPN failed");
    assert.equal(refreshReason(undefined, before), "changed", "no cached copy");
  });
});
