import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode, type ZoneKind } from "../config/leagues.ts";
import { runMonteCarlo } from "../engine/montecarlo.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { cachedLeagueOutlook, dataVersion, outlookFromRun, outlookSetup, type LeagueOutlook } from "./clubOutlook.ts";
import { loadClub } from "./clubPage.ts";
import { withClubPages } from "./clubs.ts";
import { getLeagueData, KEEP_WITH_ROUTE_SECONDS, leagueDataKeepSeconds, withRetry, type LeagueData } from "./leagueData.ts";
import { authorized, refreshReason } from "./leagueRefresh.ts";
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
    // A run that plays the play-off too is stored apart from one that doesn't.
    assert.deepEqual(outlookKey("ELC", "ELC:espn:2026:552:abc", "playoff"), ["league-outlook", "ELC", "ELC:espn:2026:552:abc", `sim-${SIM_VERSION}`, "playoff"]);
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

  it("only when ESPN's data differs from the cached copy: not while a game is on with nothing new", () => {
    assert.equal(refreshReason(plData, plData), "unchanged");
    // A result in.
    const played: LeagueData = { ...plData, fixtures: plData.fixtures.map((f) => (f.id === upcoming.id ? { ...f, result: { home: 1, away: 0 } } : f)) };
    assert.notEqual(dataVersion(played), dataVersion(plData));
    assert.equal(refreshReason(plData, played), "changed");
    // A game moved to another day.
    const moved: LeagueData = { ...plData, fixtures: plData.fixtures.map((f) => (f.id === upcoming.id ? { ...f, utcDate: new Date(Date.parse(f.utcDate) + 86_400_000).toISOString() } : f)) };
    assert.equal(refreshReason(plData, moved), "changed");
    // A game that kicked off an hour ago, its result not in yet: nothing new to show, so nothing rebuilt.
    const kickedOff: LeagueData = { ...plData, fixtures: plData.fixtures.map((f) => (f.id === upcoming.id ? { ...f, utcDate: new Date(now - 3_600_000).toISOString() } : f)) };
    assert.equal(refreshReason(kickedOff, kickedOff), "unchanged");
    // ESPN down: nothing to compare with.
    assert.equal(refreshReason(plData, undefined), "unavailable");
    assert.equal(refreshReason(undefined, plData), "changed");
  });

  it("also when a play-off game, a points deduction or the order of level clubs changes", () => {
    const leg = { ...upcoming, id: 990001, utcDate: "2027-05-20T19:00:00Z", result: null };
    const withPlayoff: LeagueData = { ...plData, postseason: [leg] };
    assert.equal(refreshReason(plData, withPlayoff), "changed");
    assert.equal(refreshReason(withPlayoff, { ...plData, postseason: [{ ...leg, result: { home: 2, away: 1 } }] }), "changed");
    assert.equal(refreshReason(withPlayoff, { ...plData, postseason: [{ ...leg }] }), "unchanged");
    const club = plData.teams[0]!.id;
    assert.equal(refreshReason(plData, { ...plData, deductions: { [club]: 6 } }), "changed");
    assert.equal(refreshReason({ ...plData, deductions: { [club]: 6 } }, { ...plData, deductions: { [club]: 6 } }), "unchanged");
    assert.equal(refreshReason(plData, { ...plData, fallbackOrder: [club] }), "changed");
  });

  it("keeps a league's cached data for hours while the route brings new results in, an hour without it", () => {
    assert.equal(leagueDataKeepSeconds({}), 3600);
    assert.equal(leagueDataKeepSeconds({ REVALIDATE_TOKEN: "s3cret" }), KEEP_WITH_ROUTE_SECONDS);
    assert.ok(KEEP_WITH_ROUTE_SECONDS >= 6 * 3600);
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
