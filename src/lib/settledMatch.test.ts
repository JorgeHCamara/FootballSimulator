import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import type { Fixture } from "../engine/types.ts";
import { outlookSetup } from "./clubOutlook.ts";
import { SETTLED_MATCH_DAYS } from "./costChoices.ts";
import { uncachedLeagueData, type LeagueData } from "./leagueData.ts";
import { gameXg, preMatchModel } from "./matchPreview.ts";
import { matchesBetween, type MatchRef } from "./matches.ts";
import { liveView, settledView } from "./matchView.ts";
import { refreshLeagues } from "./refreshRun.ts";
import { dataAfter, isSettled, matchSettledTag, readSettledMatch, SETTLED_MATCH_KEEP_SECONDS, settledEntry, settledFactsChanged, settledRecord, settleTime } from "./settledMatch.ts";
import { lastModifiedOf, type SitemapDates } from "./sitemapDates.ts";

/*
 * Settled match pages (decision C, src/lib/settledMatch.ts): a game with its
 * final score, played more than SETTLED_MATCH_DAYS days ago, is shown from a
 * frozen record that no league result expires; only a correction of the game
 * itself does. Newer, live and upcoming games follow their league as before.
 */

const DAY = 86_400_000;
const PL = getLeagueByCode("PL")!;
let data: LeagueData;
let matches: MatchRef[];

before(async () => {
  process.env.FOOTSIMU_SAMPLE_DATA = "1";
  data = (await uncachedLeagueData(PL))!;
  matches = matchesBetween(PL, data, -Infinity, Infinity);
});

const now = () => Date.now();
const played = () => matches.filter((m) => m.fixture.result).sort((a, b) => Date.parse(a.fixture.utcDate) - Date.parse(b.fixture.utcDate));

describe("when a game is settled", () => {
  it("its final score in and kicked off more than SETTLED_MATCH_DAYS days ago, by the date in its address alone", () => {
    assert.equal(SETTLED_MATCH_DAYS, 7);
    const game = played()[0]!;
    const kickoff = Date.parse(game.fixture.utcDate);
    const at = settleTime(game.slug);
    assert.ok(at - kickoff > SETTLED_MATCH_DAYS * DAY, "always more than seven days after kick-off");
    assert.ok(at - kickoff <= (SETTLED_MATCH_DAYS + 2) * DAY, "and within a couple of days of it");
    assert.equal(isSettled(game, at - 60_000), false);
    assert.equal(isSettled(game, at), true);
  });

  it("a game played six days ago, a game without a result, a game to come: not settled (they follow the league)", () => {
    const game = played().at(-1)!;
    const sixDaysOn = Date.parse(game.fixture.utcDate) + 6 * DAY;
    assert.equal(isSettled(game, sixDaysOn), false);
    const upcoming = matches.find((m) => !m.fixture.result)!;
    assert.equal(isSettled(upcoming, Date.parse(upcoming.fixture.utcDate) + 30 * DAY), false, "no final score");
  });
});

describe("a settled game's record", () => {
  it("the same result, odds, xG and likely scores the live page works out", () => {
    const game = played()[0]!;
    const record = settledRecord(PL, data, data, game)!;
    const model = preMatchModel(PL, data, game.fixture, outlookSetup(PL, data)!.model)!;
    assert.deepEqual(record.xg, gameXg(model, game.fixture));
    assert.deepEqual(record.match, game);
    assert.equal(record.season, data.season);
    const view = settledView(PL, record);
    assert.equal(view.state, "played");
    assert.deepEqual(view.result, game.fixture.result);
    assert.equal(view.impact, false, "a played game shows no \"What this result means\", live or settled");
    assert.equal(view.settled, true);
    assert.deepEqual(Object.keys(view.pages).map(Number).sort(), [game.home.id, game.away.id].sort(), "both clubs' pages");
  });

  it("each club's table row as it stood just after the game: this game counted, none after it", () => {
    const game = played()[0]!;
    const record = settledRecord(PL, data, data, game)!;
    const after = dataAfter(data, game.fixture);
    const counted = (id: number) => after.fixtures.filter((f: Fixture) => f.result && (f.homeId === id || f.awayId === id)).length;
    for (const id of [game.fixture.homeId, game.fixture.awayId]) {
      const card = record.clubs[id]!;
      assert.equal(card.row.played, counted(id), "played up to and including this game");
      assert.ok(card.row.played < data.fixtures.filter((f) => f.result && (f.homeId === id || f.awayId === id)).length, "not the table now");
      const last = card.row.form.at(-1);
      const r = game.fixture.result!;
      const won = id === game.fixture.homeId ? r.home > r.away : r.away > r.home;
      assert.equal(last, r.home === r.away ? "D" : won ? "W" : "L", "the game itself is the form's latest result");
    }
  });

  it("is kept 30 days, tagged with its league's settled tag only: no league data tag, no outlook marker", () => {
    assert.deepEqual(settledEntry("PL"), { tags: ["match-settled:PL"], revalidate: SETTLED_MATCH_KEEP_SECONDS });
    assert.equal(SETTLED_MATCH_KEEP_SECONDS, 30 * 86_400);
  });

  it("read by its address: a settled game's record; a newer game's address reads nothing", async () => {
    const old = played()[0]!;
    const record = await readSettledMatch(PL, old.slug, settleTime(old.slug));
    assert.ok(record, "a settled game");
    assert.deepEqual(record.match.fixture, old.fixture);
    const recent = played().at(-1)!;
    assert.equal(await readSettledMatch(PL, recent.slug, Date.parse(recent.fixture.utcDate) + 6 * DAY), undefined, "six days old: the live page");
  });

  it("the live view of the same game keeps everything the page showed before (its clubs' table now)", () => {
    const game = played()[0]!;
    const view = liveView({
      league: PL, data, current: data, match: game, season: data.season, state: "played", result: game.fixture.result, model: { rho: -0.1 } as never,
      xg: { home: 1, away: 1 }, odds: { home: 0.4, draw: 0.3, away: 0.3 }, scores: [], outlook: null, timeZone: "Europe/London",
    });
    assert.equal(view.settled, false);
    assert.equal(view.rho, -0.1);
    assert.equal(view.impact, false);
  });
});

describe("what expires a settled game's page", () => {
  const settledAge = 20 * DAY;
  const at = Date.parse("2026-11-09T12:07:00Z");
  const game = (id: number, kickoff: number, result: Fixture["result"] = null, teams: [number, number] = [1, 2]): Fixture => ({ id, matchday: 1, utcDate: new Date(kickoff).toISOString(), homeId: teams[0], awayId: teams[1], result });
  const league = (fixtures: Fixture[]): LeagueData => ({ teams: [], fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live", provider: "espn" });
  const old = game(1, at - settledAge, { home: 2, away: 0 });
  const cached = league([old, game(2, at - 3 * 3_600_000)]);

  it("a new result elsewhere in the league: the league's tags, not the settled one", async () => {
    const fresh = league([old, game(2, at - 3 * 3_600_000, { home: 1, away: 1 })]);
    assert.equal(settledFactsChanged(cached, fresh, at), false);
    const expired: string[] = [];
    await refreshLeagues({ only: "PL" }, { expire: (tag) => expired.push(tag), now: at, cached: async () => cached, fresh: async () => fresh });
    assert.deepEqual(expired, ["league:PL", "league:PL-outlook"], "expired at once, as before; the settled pages stay");
  });

  it("a corrected score, date or clubs of a settled game: its league's settled pages too", async () => {
    for (const corrected of [game(1, at - settledAge, { home: 2, away: 1 }), game(1, at - settledAge - DAY, { home: 2, away: 0 }), game(1, at - settledAge, { home: 2, away: 0 }, [1, 3])]) {
      const fresh = league([corrected, game(2, at - 3 * 3_600_000)]);
      assert.equal(settledFactsChanged(cached, fresh, at), true);
      const expired: string[] = [];
      await refreshLeagues({ only: "PL" }, { expire: (tag) => expired.push(tag), now: at, cached: async () => cached, fresh: async () => fresh });
      assert.ok(expired.includes(matchSettledTag("PL")), JSON.stringify(corrected));
    }
  });

  it("a game six days old corrected: it isn't settled, the league's tags carry it (as before)", async () => {
    const recent = game(1, at - 6 * DAY, { home: 2, away: 0 });
    const fresh = league([{ ...recent, result: { home: 0, away: 0 } }]);
    assert.equal(settledFactsChanged(league([recent]), fresh, at), false);
  });
});

describe("a settled match in the sitemap", () => {
  it("dated when it settled, the same before and after a new league result", () => {
    const path = "/premier-league/match/a-vs-b-2026-10-20";
    const settled = new Map([[path, new Date(settleTime("a-vs-b-2026-10-20"))]]);
    const dates = (latest: string): SitemapDates => ({ leagues: new Map([["premier-league", new Date(latest)]]), rounds: new Map(), latestReports: new Map(), home: [], settled, now: Date.parse(latest) });
    const before = lastModifiedOf(path, dates("2026-11-14T18:00:00Z"));
    const after = lastModifiedOf(path, dates("2026-11-15T18:00:00Z"));
    assert.deepEqual(before, after);
    assert.equal(before!.toISOString(), "2026-10-28T12:00:00.000Z");
    // A newer game's page still follows the league's latest result.
    const recent = "/premier-league/match/a-vs-b-2026-11-12";
    assert.equal(lastModifiedOf(recent, dates("2026-11-15T18:00:00Z"))!.toISOString(), "2026-11-15T18:00:00.000Z");
  });
});
