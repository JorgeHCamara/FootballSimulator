import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode, type ZoneKind } from "../config/leagues.ts";
import { runMonteCarlo } from "../engine/montecarlo.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { cachedLeagueOutlook, dataVersion, outlookFromRun, outlookSetup, type LeagueOutlook } from "./clubOutlook.ts";
import { loadClub } from "./clubPage.ts";
import { withClubPages } from "./clubs.ts";
import { getLeagueData, withRetry, type LeagueData } from "./leagueData.ts";
import { authorized, refreshReason, RECENT_KICKOFF_MS } from "./leagueRefresh.ts";
import { SCENARIO_ITERATIONS, SCENARIO_SEED } from "./scenario.ts";
import { dataTag, outlookKey, outlookTag, runTag, sharedLeagueOutlook } from "./sharedOutlook.ts";
import { SIM_VERSION } from "./simVersion.ts";

const pl = getLeagueByCode("PL")!;
const snap = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const plData: LeagueData = { teams: withClubPages(pl, snap.teams), fixtures: snap.fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live" };

/** Every club's chance of a place, added up over the clubs (each club as its own page shows it). */
const total = (chances: { zones: { kind: ZoneKind; chance: number }[] }[], kind: ZoneKind) => chances.reduce((sum, c) => sum + (c.zones.find((z) => z.kind === kind)?.chance ?? 0), 0);
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) <= 0.005, `${label}: ${actual} (expected ${expected} ± 0.5 points)`);

describe("the shared outlook", () => {
  it("keys and tags: the league, its data version and the model; the pages, the data and the runs apart", () => {
    assert.deepEqual(outlookKey("PL", "PL:espn:2026:380:abc"), ["league-outlook", "PL", "PL:espn:2026:380:abc", `sim-${SIM_VERSION}`]);
    assert.equal(outlookTag("MLS"), "league:MLS-outlook");
    assert.equal(dataTag("MLS"), "league:MLS");
    assert.equal(runTag("MLS"), "league:MLS-runs");
  });

  it("every club page's chances add up to the league's places: one champion, three relegated (Premier League)", async () => {
    const outlook = (await sharedLeagueOutlook(pl, plData))!;
    const clubs = [...outlook.clubs.values()];
    assert.equal(clubs.length, 20);
    near(total(clubs, "title"), 1, "title");
    near(total(clubs, "championsLeague"), 4, "Champions League");
    near(total(clubs, "relegation"), 3, "relegation");
  });

  it("each club page on its own, as a visitor's crawl reads them: the Championship, the Bundesliga, MLS", async (t) => {
    process.env.FOOTSIMU_SAMPLE_DATA = "1";
    t.after(() => delete process.env.FOOTSIMU_SAMPLE_DATA);
    const slots: [string, [ZoneKind, number][]][] = [
      ["ELC", [["title", 1], ["promotion", 2], ["promotionPlayoff", 6], ["relegation", 3]]],
      ["BL1", [["title", 1], ["relegationPlayoff", 1], ["relegation", 2]]],
      // Each conference: seven in the play-offs, two in the wild card.
      ["MLS", [["playoffs", 14], ["playoffWildCard", 4]]],
    ];
    for (const [code, expected] of slots) {
      const league = getLeagueByCode(code)!;
      const data = await getLeagueData(league);
      const pages = await Promise.all(data.teams.filter((t) => t.slug).map((t) => loadClub(league.slug, t.slug!)));
      assert.equal(pages.length, league.teams, code);
      const clubs = pages.map((p) => p!.club);
      for (const [kind, slots] of expected) near(total(clubs, kind), slots, `${code} ${kind}`);
      // One run behind them all.
      assert.ok(pages.every((p) => p!.outlook === pages[0]!.outlook), `${code}: one outlook`);
    }
  });

  it("a stored run (the data cache keeps it as JSON) gives the very same outlook, and the server keeps it", async () => {
    const setup = outlookSetup(pl, plData)!;
    const run = runMonteCarlo({ ...setup.input, iterations: SCENARIO_ITERATIONS, seed: SCENARIO_SEED });
    const plain = (o: LeagueOutlook) => JSON.stringify({ ...o, league: o.league.code, clubs: [...o.clubs], model: { ...o.model, strengths: [...o.model.strengths], homeFactor: [...(o.model.homeFactor ?? [])] } });
    const direct = outlookFromRun(pl, plData, setup, run);
    const stored = outlookFromRun(pl, plData, setup, JSON.parse(JSON.stringify(run)));
    assert.equal(plain(stored), plain(direct));
    // The shared outlook is the league's own (every page that works it out on its own gets the same), and this server's copy.
    const shared = (await sharedLeagueOutlook(pl, plData))!;
    assert.equal(plain(shared), plain(direct));
    assert.equal(cachedLeagueOutlook(pl, plData), shared);
  });
});

describe("refreshing a league's pages together", () => {
  const now = Date.parse("2026-11-07T18:00:00Z");
  const upcoming = plData.fixtures.find((f) => !f.result)!;

  it("when ESPN's results differ from the cached copy, or a game kicked off in the last four hours", () => {
    // The same data, nothing just played (the snapshot's games are weeks before `now`).
    const later = Date.parse("2027-08-01T00:00:00Z");
    assert.equal(refreshReason(plData, plData, later), "unchanged");
    // A result in.
    const played: LeagueData = { ...plData, fixtures: plData.fixtures.map((f) => (f.id === upcoming.id ? { ...f, result: { home: 1, away: 0 } } : f)) };
    assert.notEqual(dataVersion(played), dataVersion(plData));
    assert.equal(refreshReason(plData, played, later), "changed");
    // A game an hour old, its result not in yet: refreshed while it comes in.
    const kickedOff: LeagueData = { ...plData, fixtures: plData.fixtures.map((f) => (f.id === upcoming.id ? { ...f, utcDate: new Date(now - 3_600_000).toISOString() } : f)) };
    assert.equal(refreshReason(kickedOff, kickedOff, now), "recent");
    assert.equal(refreshReason(kickedOff, kickedOff, now + RECENT_KICKOFF_MS), "unchanged");
    // ESPN down: nothing to compare with.
    assert.equal(refreshReason(plData, undefined, now), "unavailable");
    assert.equal(refreshReason(undefined, plData, now), "changed");
  });

  it("only with the site's token", () => {
    assert.equal(authorized("Bearer s3cret", "s3cret"), true);
    assert.equal(authorized("Bearer wrong", "s3cret"), false);
    assert.equal(authorized("s3cret", "s3cret"), false);
    assert.equal(authorized(null, "s3cret"), false);
    assert.equal(authorized("Bearer ", undefined), false);
    assert.equal(authorized("Bearer undefined", undefined), false);
  });
});

describe("ESPN's conferences", () => {
  it("are asked for again when ESPN fails, up to three times", async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls < 3) throw new Error("HTTP 429");
      return "groups";
    };
    assert.equal(await withRetry(flaky, [0, 0]), "groups");
    assert.equal(calls, 3);
    calls = -10;
    await assert.rejects(withRetry(flaky, [0, 0]), /HTTP 429/);
    assert.equal(calls, -7, "three tries, then the error");
  });
});
