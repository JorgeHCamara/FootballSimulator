import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAGUES } from "../config/leagues.ts";
import type { Fixture } from "../engine/types.ts";
import type { LeagueData } from "./leagueData.ts";
import type { EspnEvent } from "./espn.ts";
import { ACTIVE_AFTER_MS, ACTIVE_BEFORE_MS, activeGame, activeSpan, OVERDUE_MS, PERIODIC_RUNS, periodicTurn, refreshPlan, refreshReason, RUN_MS, scoreboardVerdict } from "./leagueRefresh.ts";

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
    assert.deepEqual(refreshPlan(PL, data([game(1, idleRun + HOUR)]), idleRun), { check: true, why: "active", scoreboardFirst: true });
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

  it("the plan for a league with a game near: the small feed first, except on its periodic turn (the season, as every three hours)", () => {
    let turn = idleRun;
    while (!periodicTurn("PL", turn)) turn += RUN_MS;
    assert.deepEqual(refreshPlan(PL, data([game(1, turn + HOUR)]), turn), { check: true, why: "active", scoreboardFirst: false });
    assert.equal(refreshPlan(PL, data([game(1, idleRun - HOUR)]), idleRun).scoreboardFirst, true, "under way");
    // Never for a check that needs the season: a copy that's missing or not ESPN's, a league asked for by name.
    for (const plan of [refreshPlan(PL, undefined, idleRun), refreshPlan(PL, { ...data([game(1, idleRun + HOUR)]), provider: "football-data" }, idleRun), refreshPlan(PL, data([game(1, idleRun + HOUR)]), idleRun, true)]) {
      assert.equal(plan.check, true);
      assert.ok(!plan.scoreboardFirst);
    }
  });
});

describe("the small feed against the cached copy", () => {
  const iso = (time: number) => new Date(time).toISOString();
  /** A scoreboard event as ESPN sends it. */
  const event = (id: number, kickoff: number, { score, status = score ? "STATUS_FULL_TIME" : "STATUS_SCHEDULED", teams = ["1", "2"] }: { score?: [number, number]; status?: string; teams?: [string, string] } = {}): EspnEvent => ({
    id: String(id),
    date: iso(kickoff),
    status: { type: { name: status, state: score ? "post" : status === "STATUS_FIRST_HALF" ? "in" : "pre", completed: Boolean(score) } },
    competitions: [
      {
        competitors: [
          { homeAway: "home", team: { id: teams[0], displayName: "Home" }, ...(score ? { score: String(score[0]) } : {}) },
          { homeAway: "away", team: { id: teams[1], displayName: "Away" }, ...(score ? { score: String(score[1]) } : {}) },
        ],
      },
    ],
  });
  // Yesterday's game with its result, one under way, one tonight; and one far off, outside the feed's days.
  const yesterday = now - 26 * HOUR;
  const underWay = now - HOUR;
  const tonight = now + HOUR;
  const cached = data([game(1, yesterday, { home: 2, away: 1 }), game(2, underWay), game(3, tonight), game(4, now + 20 * 24 * HOUR)]);
  const feed = [event(1, yesterday, { score: [2, 1] }), event(2, underWay, { status: "STATUS_FIRST_HALF" }), event(3, tonight)];

  it("the same games, times and results: nothing to download", () => {
    assert.equal(scoreboardVerdict(cached, feed, now), "same");
    // A live score isn't a result yet: the pages show none.
    const live = { ...event(2, underWay, { status: "STATUS_FIRST_HALF" }) };
    live.competitions[0]!.competitors[0]!.score = "1";
    live.competitions[0]!.competitors[1]!.score = "0";
    assert.equal(scoreboardVerdict(cached, [feed[0]!, live, feed[2]!], now), "same");
    // The span asked for is the one that makes a league active.
    assert.deepEqual(activeSpan(now), { from: now - OVERDUE_MS, to: now + ACTIVE_BEFORE_MS });
  });

  it("a final score, a corrected one, a shoot-out: the season is downloaded on the same run", () => {
    assert.equal(scoreboardVerdict(cached, [feed[0]!, event(2, underWay, { score: [1, 0] }), feed[2]!], now), "differs", "full time");
    assert.equal(scoreboardVerdict(cached, [event(1, yesterday, { score: [2, 2] }), feed[1]!, feed[2]!], now), "differs", "a correction");
    const shootout = event(1, yesterday, { score: [2, 1] });
    shootout.competitions[0]!.competitors[0]!.shootoutScore = 4;
    shootout.competitions[0]!.competitors[1]!.shootoutScore = 3;
    assert.equal(scoreboardVerdict(cached, [shootout, feed[1]!, feed[2]!], now), "differs", "penalties the copy lacks");
  });

  it("a kick-off moved, a game added, a game gone from those days", () => {
    assert.equal(scoreboardVerdict(cached, [feed[0]!, feed[1]!, event(3, tonight + HOUR)], now), "differs", "moved by an hour");
    assert.equal(scoreboardVerdict(cached, [...feed, event(9, tonight, { teams: ["5", "6"] })], now), "differs", "a new fixture");
    assert.equal(scoreboardVerdict(cached, [feed[0]!, feed[1]!], now), "differs", "tonight's game no longer listed");
    // A game whose sides aren't known yet is never in the copy: not a difference.
    assert.equal(scoreboardVerdict(cached, [...feed, event(9, tonight, { teams: ["TBD-1", "TBD-2"] })], now), "same");
    // Nor is the feed's game from outside the copy's own days a problem when the copy has it at the same time.
    assert.equal(scoreboardVerdict(cached, [...feed, event(4, now + 20 * 24 * HOUR)], now), "same");
  });

  it("a postponement around kick-off needs the season (its new date is only there); days later it no longer does", () => {
    assert.equal(scoreboardVerdict(cached, [feed[0]!, feed[1]!, event(3, tonight, { status: "STATUS_POSTPONED" })], now), "differs");
    assert.equal(scoreboardVerdict(cached, [feed[0]!, event(2, underWay, { status: "STATUS_ABANDONED" }), feed[2]!], now), "differs");
    // The same postponed game a day later, still in the copy without a result: nothing new to find every 30 minutes
    // (the periodic turn downloads the season every three hours).
    const later = now + 30 * HOUR;
    const then = data([game(3, tonight)]);
    assert.equal(scoreboardVerdict(then, [event(3, tonight, { status: "STATUS_POSTPONED" })], later), "same");
    // A called-off game listed again under another date, which the copy doesn't hold: not a new fixture.
    assert.equal(scoreboardVerdict(cached, [...feed, event(8, tonight, { status: "STATUS_POSTPONED", teams: ["5", "6"] })], now), "same");
  });

  it("an abandoned game whose score stood counts as played, as in the copy", () => {
    const stood = data([game(1, yesterday, { home: 1, away: 0 })]);
    const abandoned = event(1, yesterday, { status: "STATUS_ABANDONED" });
    abandoned.competitions[0]!.competitors[0]!.score = "1";
    abandoned.competitions[0]!.competitors[1]!.score = "0";
    assert.equal(scoreboardVerdict(stood, [abandoned], now), "differs", "without the league's list");
    assert.equal(scoreboardVerdict(stood, [abandoned], now, ["1"]), "same");
  });
});

