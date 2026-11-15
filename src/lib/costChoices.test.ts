import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LONG_SAFETY_NET_SECONDS, LONGER_SAFETY_NET, periodicRuns, SAFETY_NET_SECONDS, safetyNetSeconds, SLOWER_IDLE_TURN } from "./costChoices.ts";
import { KEEP_WITHOUT_ROUTE_SECONDS, leagueDataKeepSeconds } from "./leagueData.ts";
import { PERIODIC_RUNS, periodicTurn, RUN_MS } from "./leagueRefresh.ts";
import { matchDayClock } from "./matchPreview.ts";
import { PUBLISHED_KEEP_SECONDS, publishedKeepSeconds } from "./publishedData.ts";

/*
 * The two cost choices (src/lib/costChoices.ts), both on since Jorge's
 * decision of 2026-11-15: a 24-hour safety net under the refresh job (only
 * with its token: without it nothing changes, the data and its pages refresh
 * hourly) and idle leagues checked every six hours. Off, each gives back the
 * clocks before it exactly.
 */

const token = { REVALIDATE_TOKEN: "x" };

describe("the cost choices, as shipped", () => {
  it("both on (Jorge's decisions A and B, 2026-11-15)", () => {
    assert.equal(LONGER_SAFETY_NET, true);
    assert.equal(SLOWER_IDLE_TURN, true);
  });

  it("choice A on: 24 hours with the job, for the pages, the league's data and the published files", () => {
    assert.equal(safetyNetSeconds(token), LONG_SAFETY_NET_SECONDS);
    assert.equal(LONG_SAFETY_NET_SECONDS, 86400);
    assert.equal(leagueDataKeepSeconds(token), 86400);
    assert.equal(publishedKeepSeconds(token), 86400);
  });

  it("choice A without the job's token: nothing changes (the data an hour, so its pages hourly; the net six hours)", () => {
    assert.equal(leagueDataKeepSeconds({}), KEEP_WITHOUT_ROUTE_SECONDS);
    assert.equal(KEEP_WITHOUT_ROUTE_SECONDS, 3600);
    assert.equal(safetyNetSeconds({}), SAFETY_NET_SECONDS);
    assert.equal(publishedKeepSeconds({}), PUBLISHED_KEEP_SECONDS);
  });

  it("choice A off would give back six hours exactly", () => {
    assert.equal(safetyNetSeconds(token, false), SAFETY_NET_SECONDS);
    assert.equal(SAFETY_NET_SECONDS, 21600);
  });

  it("choice B on: an idle league every twelve runs (six hours); off would be every six (three hours)", () => {
    assert.equal(PERIODIC_RUNS, 12);
    assert.equal(periodicRuns(), 12);
    assert.equal(periodicRuns(false), 6);
    const now = Date.parse("2026-11-09T12:07:00Z");
    const turns = Array.from({ length: 48 }, (_, i) => periodicTurn("PL", now + i * RUN_MS)).filter(Boolean).length;
    assert.equal(turns, 4, "four turns in a day");
  });

  it("the pages the safety net covers carry the longer literal, so the entries they read set their clock (the outlook marker or pageClock)", () => {
    const pages = ["[locale]/page.tsx", "[locale]/quiz/page.tsx", "[locale]/[league]/page.tsx", "[locale]/[league]/chances/[outcome]/page.tsx", "[locale]/[league]/team/[teamSlug]/chances/[outcome]/page.tsx", "[locale]/[league]/team/[teamSlug]/page.tsx"];
    // The match page's literal is a settled game's 30 days (decision C, src/lib/settledMatch.ts); its live way reads
    // the same outlook marker as the others.
    assert.match(readFileSync(new URL("../app/[locale]/[league]/match/[matchSlug]/page.tsx", import.meta.url), "utf8"), /export const revalidate = 2592000;/);
    for (const page of pages) {
      const source = readFileSync(new URL(`../app/${page}`, import.meta.url), "utf8");
      assert.match(source, new RegExp(`export const revalidate = ${LONG_SAFETY_NET_SECONDS};`), page);
    }
    // The outlook marker the league, club, chance and match pages read on every render is the net, and pageClock
    // for the pages that may read none (a cup's or continental competition's page, the home page, the quiz).
    const outlook = readFileSync(new URL("./sharedOutlook.ts", import.meta.url), "utf8");
    assert.match(outlook, /\["league-pages", code\], \[outlookTag\(code\)\], safetyNetSeconds\(\)\)/);
    assert.match(outlook, /\["page-clock", code\], \[\], safetyNetSeconds\(\)\)/);
    const read = (page: string) => readFileSync(new URL(`../app/${page}`, import.meta.url), "utf8");
    assert.match(read("[locale]/page.tsx"), /await pageClock\("home"\)/);
    assert.match(read("[locale]/quiz/page.tsx"), /await pageClock\("quiz"\)/);
    assert.match(read("[locale]/[league]/page.tsx"), /if \(loaded\.kind === "cup" \|\| !hasClubPages\(loaded\.config\)\) await pageClock\(loaded\.config\.code\)/);
  });
});

describe("match pages with choice A", () => {
  const kickoff = "2026-11-15T15:00:00Z";
  const at = (time: string) => Date.parse(time);

  it("off: nothing read, the page already follows six hours", async () => {
    assert.equal(await matchDayClock("PL", kickoff, at("2026-11-15T01:00:00Z"), SAFETY_NET_SECONDS), false);
  });

  it("on: a game due within a day, or under way, keeps six hours; one further off, or long over, follows 24", async () => {
    assert.equal(await matchDayClock("PL", kickoff, at("2026-11-14T20:00:00Z"), LONG_SAFETY_NET_SECONDS), true, "kick-off tomorrow");
    assert.equal(await matchDayClock("PL", kickoff, at("2026-11-15T16:00:00Z"), LONG_SAFETY_NET_SECONDS), true, "under way");
    assert.equal(await matchDayClock("PL", kickoff, at("2026-11-13T12:00:00Z"), LONG_SAFETY_NET_SECONDS), false, "two days ahead: its next rebuild is still before match day");
    assert.equal(await matchDayClock("PL", kickoff, at("2026-11-16T12:00:00Z"), LONG_SAFETY_NET_SECONDS), false, "long over");
  });
});
