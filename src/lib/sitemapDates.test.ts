import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastModifiedOf, lastResultAt, latestOf, utcDayStart, type SitemapDates } from "./sitemapDates.ts";

const now = Date.parse("2026-11-11T19:00:00Z");
const game = (utcDate: string, played = true) => ({ utcDate, result: played ? { home: 1, away: 0 } : null });

describe("when a league's results last changed", () => {
  const season = [game("2026-11-07T15:00:00Z"), game("2026-11-08T16:30:00Z"), game("2026-11-21T15:00:00Z", false)];

  it("the end of its latest played game: the same moment on every build until another game is played", () => {
    const at = lastResultAt(season, now)!;
    assert.equal(at.toISOString(), "2026-11-08T19:30:00.000Z");
    assert.equal(lastResultAt(season, now + 5 * 86_400_000)!.getTime(), at.getTime(), "days later, nothing played: no new date");
    assert.equal(lastResultAt([...season].reverse(), now)!.getTime(), at.getTime());
  });

  it("a new result moves it", () => {
    const later = Date.parse("2026-11-21T18:30:00Z");
    const after = [...season.slice(0, 2), game("2026-11-21T15:00:00Z")];
    assert.equal(lastResultAt(after, later)!.toISOString(), "2026-11-21T18:00:00.000Z");
    // A result in while its game's three hours aren't up: now, not a moment still to come.
    assert.equal(lastResultAt(after, Date.parse("2026-11-21T17:00:00Z"))!.toISOString(), "2026-11-21T17:00:00.000Z");
  });

  it("nothing before the season's first result", () => {
    assert.equal(lastResultAt([game("2026-11-21T15:00:00Z", false)], now), undefined);
    assert.equal(lastResultAt([], now), undefined);
  });
});

describe("each sitemap address's date", () => {
  const pl = new Date("2026-11-08T19:30:00Z");
  const bsa = new Date("2026-11-10T02:00:00Z");
  const dates: SitemapDates = {
    leagues: new Map<string, Date | undefined>([["premier-league", pl], ["brasileirao", bsa], ["ligue-1", undefined]]),
    rounds: new Map([["/premier-league/odds/matchday-10", "2026-11-02"]]),
    latestReports: new Map([["/premier-league/odds", "2026-11-08"], ["/brasileirao/odds", "2026-11-09"]]),
    home: ["premier-league", "ligue-1"],
    now,
  };

  it("a league's own page and its club, match and chance pages: the league's latest result", () => {
    for (const path of ["/premier-league", "/premier-league/team/arsenal", "/premier-league/match/arsenal-vs-chelsea-2026-11-08", "/premier-league/chances/title", "/premier-league/team/arsenal/chances/title"]) {
      assert.equal(lastModifiedOf(path, dates), pl, path);
    }
    assert.equal(lastModifiedOf("/brasileirao/team/flamengo", dates), bsa, "another league's result doesn't touch it");
  });

  it("a result bumps that league's addresses and no other's", () => {
    const after = { ...dates, leagues: new Map(dates.leagues).set("premier-league", new Date("2026-11-21T18:00:00Z")) };
    assert.ok(lastModifiedOf("/premier-league/team/arsenal", after)! > lastModifiedOf("/premier-league/team/arsenal", dates)!);
    assert.equal(lastModifiedOf("/brasileirao/team/flamengo", after), lastModifiedOf("/brasileirao/team/flamengo", dates));
    // And the same data a day later gives the same dates: nothing is stamped with the build's time.
    const tomorrow = { ...dates, now: now + 86_400_000 };
    for (const path of ["", "/premier-league", "/premier-league/team/arsenal", "/premier-league/odds", "/premier-league/odds/matchday-10", "/odds"]) {
      assert.deepEqual(lastModifiedOf(path, tomorrow), lastModifiedOf(path, dates), path);
    }
  });

  it("reports by their round's day; the hub by the latest of them", () => {
    assert.equal(lastModifiedOf("/premier-league/odds/matchday-10", dates)!.toISOString(), "2026-11-02T12:00:00.000Z");
    assert.equal(lastModifiedOf("/premier-league/odds", dates)!.toISOString(), "2026-11-08T12:00:00.000Z");
    assert.equal(lastModifiedOf("/odds", dates)!.toISOString(), "2026-11-09T12:00:00.000Z");
  });

  it("the home page by its featured leagues, the quiz by the UTC day", () => {
    assert.equal(lastModifiedOf("", dates), pl);
    assert.equal(lastModifiedOf("/quiz", dates)!.toISOString(), "2026-11-11T00:00:00.000Z");
    assert.equal(utcDayStart(now + 5 * 3_600_000).toISOString(), "2026-11-12T00:00:00.000Z");
  });

  it("no date where none is known: nothing made up", () => {
    for (const path of ["/about", "/privacy", "/contact", "/my-world", "/fa-cup", "/premier-league/past-winners", "/ligue-1", "/ligue-1/team/psg"]) {
      assert.equal(lastModifiedOf(path, dates), undefined, path);
    }
    assert.equal(latestOf([undefined, undefined]), undefined);
    assert.equal(lastModifiedOf("", { ...dates, home: ["ligue-1"] }), undefined);
  });
});
