import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SETTLED_MATCH_DAYS } from "./costChoices.ts";
import { INDEX_NEXT_DAYS, INDEX_PAST_DAYS, inIndexWindow } from "./indexPolicy.ts";
import * as matches from "./matches.ts";
import { settleTime } from "./settledMatch.ts";
import { SITEMAP_MAX_AGE_DAYS, SITEMAP_PAST_DAYS } from "./sitemapEntries.ts";
import { matchOutsideWindow } from "./sitemapWindow.ts";

const DAY = 86_400_000;
const SECOND = 1000;
const iso = (time: number) => new Date(time).toISOString();

describe("the match pages' index window: 7 days either side of kick-off", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");

  it("7 days back, 7 ahead, the same window wherever it's read from", () => {
    assert.equal(INDEX_PAST_DAYS, 7);
    assert.equal(INDEX_NEXT_DAYS, 7);
    // The pages that read it from matches.ts get the same one.
    assert.equal(matches.inIndexWindow, inIndexWindow);
    assert.equal(matches.INDEX_PAST_DAYS, INDEX_PAST_DAYS);
    assert.equal(matches.INDEX_NEXT_DAYS, INDEX_NEXT_DAYS);
  });

  it("is inclusive at both ends, by the kick-off's timestamp", () => {
    // Exactly 7 days after kick-off: indexable; a second later: noindex.
    assert.equal(inIndexWindow(iso(now - 7 * DAY), now), true);
    assert.equal(inIndexWindow(iso(now - 7 * DAY - SECOND), now), false);
    // Exactly 7 days before kick-off: indexable; a second further: noindex.
    assert.equal(inIndexWindow(iso(now + 7 * DAY), now), true);
    assert.equal(inIndexWindow(iso(now + 7 * DAY + SECOND), now), false);
    assert.equal(inIndexWindow("2026-10-29T12:00:00Z", now), true);
    assert.equal(inIndexWindow("2026-11-12T12:00:00Z", now), true);
  });

  it("this week's games and last week's results in; older results and next week's previews out", () => {
    for (const at of ["2026-11-05T12:00:00Z", "2026-11-05T20:00:00Z", "2026-11-01T15:00:00Z", "2026-11-08T14:00:00Z", "2026-10-30T19:45:00Z"]) assert.equal(inIndexWindow(at, now), true, at);
    // The old window (30 back, 14 ahead) kept these.
    for (const at of ["2026-10-28T15:00:00Z", "2026-10-10T15:00:00Z", "2026-11-14T15:00:00Z", "2026-11-19T12:00:00Z", "2026-12-20T15:00:00Z"]) assert.equal(inIndexWindow(at, now), false, at);
  });

  it("a played game leaves the index no later than its page settles into a frozen record", () => {
    assert.equal(INDEX_PAST_DAYS, SETTLED_MATCH_DAYS);
    // Kick-offs across the day and the world's time zones: the address carries the local date.
    for (const [kickoff, local] of [
      ["2026-11-01T15:00:00Z", "2026-11-01"],
      ["2026-11-02T04:59:00Z", "2026-11-01"], // 23:59 in UTC-5
      ["2026-10-31T15:00:00Z", "2026-11-01"], // 00:00 in UTC+9
    ] as const) {
      const at = settleTime(`home-vs-away-${local}`);
      assert.equal(inIndexWindow(kickoff, at), false, `${kickoff}: noindex once settled`);
      assert.ok(at - Date.parse(kickoff) > INDEX_PAST_DAYS * DAY, kickoff);
    }
  });
});

describe("the sitemap follows the same window", () => {
  it("a day tighter on the past side, so a piece served a day old lists no noindex game", () => {
    assert.equal(SITEMAP_MAX_AGE_DAYS, 1);
    assert.equal(SITEMAP_PAST_DAYS, INDEX_PAST_DAYS - SITEMAP_MAX_AGE_DAYS);
    assert.equal(SITEMAP_PAST_DAYS, 6);
  });

  it("matchOutsideWindow allows a day either side of the window for the league's time zone", () => {
    const now = Date.parse("2026-11-25T18:00:00Z");
    const url = (day: string) => `https://footsimu.com/en/premier-league/match/arsenal-vs-chelsea-${day}`;
    // The address's day at noon UTC, from INDEX_PAST_DAYS + 1 back (Nov 17, 18:00) to INDEX_NEXT_DAYS + 1 ahead (Dec 3, 18:00).
    for (const day of ["2026-11-18", "2026-11-25", "2026-12-02", "2026-12-03"]) assert.equal(matchOutsideWindow(url(day), now), false, day);
    // Inside the old window (30 back, 14 ahead), outside this one.
    for (const day of ["2026-10-26", "2026-11-16", "2026-11-17", "2026-12-04", "2026-12-09"]) assert.equal(matchOutsideWindow(url(day), now), true, day);
  });
});
