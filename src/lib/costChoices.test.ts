import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { LONG_SAFETY_NET_SECONDS, LONGER_SAFETY_NET, periodicRuns, SAFETY_NET_SECONDS, safetyNetSeconds, SLOWER_IDLE_TURN } from "./costChoices.ts";
import { KEEP_WITHOUT_ROUTE_SECONDS, leagueDataKeepSeconds } from "./leagueData.ts";
import { PERIODIC_RUNS, periodicTurn, RUN_MS } from "./leagueRefresh.ts";
import { matchDayClock } from "./matchPreview.ts";
import { PUBLISHED_KEEP_SECONDS, publishedKeepSeconds } from "./publishedData.ts";

/*
 * The two cost choices (src/lib/costChoices.ts) are off, and off means
 * today's clocks exactly: six-hour safety net, idle leagues every three hours.
 */

const token = { REVALIDATE_TOKEN: "x" };

describe("the cost choices, as shipped", () => {
  it("both off", () => {
    assert.equal(LONGER_SAFETY_NET, false);
    assert.equal(SLOWER_IDLE_TURN, false);
  });

  it("choice A off: six hours with the job, the data an hour without it, the published files six hours", () => {
    assert.equal(safetyNetSeconds(token), SAFETY_NET_SECONDS);
    assert.equal(SAFETY_NET_SECONDS, 21600);
    assert.equal(leagueDataKeepSeconds(token), 21600);
    assert.equal(leagueDataKeepSeconds({}), KEEP_WITHOUT_ROUTE_SECONDS);
    assert.equal(publishedKeepSeconds(token), PUBLISHED_KEEP_SECONDS);
  });

  it("choice A on: 24 hours, only with the job (without its token nothing changes)", () => {
    assert.equal(safetyNetSeconds(token, true), LONG_SAFETY_NET_SECONDS);
    assert.equal(LONG_SAFETY_NET_SECONDS, 86400);
    assert.equal(safetyNetSeconds({}, true), SAFETY_NET_SECONDS);
  });

  it("choice B off: an idle league every six runs (three hours); on: every twelve (six hours)", () => {
    assert.equal(PERIODIC_RUNS, 6);
    assert.equal(periodicRuns(), 6);
    assert.equal(periodicRuns(true), 12);
    const now = Date.parse("2026-11-09T12:07:00Z");
    const turns = Array.from({ length: 24 }, (_, i) => periodicTurn("PL", now + i * RUN_MS)).filter(Boolean).length;
    assert.equal(turns, 4, "four turns in twelve hours");
  });

  it("the pages the safety net covers carry the longer literal, so the entries they read set their clock (six hours while choice A is off)", () => {
    const pages = ["[locale]/page.tsx", "[locale]/quiz/page.tsx", "[locale]/[league]/page.tsx", "[locale]/[league]/chances/[outcome]/page.tsx", "[locale]/[league]/team/[teamSlug]/chances/[outcome]/page.tsx", "[locale]/[league]/team/[teamSlug]/page.tsx", "[locale]/[league]/match/[matchSlug]/page.tsx"];
    for (const page of pages) {
      const source = readFileSync(new URL(`../app/${page}`, import.meta.url), "utf8");
      assert.match(source, new RegExp(`export const revalidate = ${LONG_SAFETY_NET_SECONDS};`), page);
    }
    // The outlook marker every one of them reads (directly, or through the featured league's card) is the net.
    const outlook = readFileSync(new URL("./sharedOutlook.ts", import.meta.url), "utf8");
    assert.match(outlook, /\["league-pages", code\], \[outlookTag\(code\)\], safetyNetSeconds\(\)\)/);
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
