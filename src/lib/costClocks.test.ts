import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { espnGameState, fetchEspnDays, fetchEspnGameState, monthsBetween, type EspnEvent } from "./espn.ts";
import { canBeOver, isSettled, MATCH_DAY_REVALIDATE, SETTLED_KEEP_SECONDS, settledGameState, settledKey } from "./matchPreview.ts";
import { QUIZ_KEEP_SECONDS, QUIZ_ROLLOVER_SECONDS, quizDate, quizKeepSeconds } from "./quizPage.ts";
import { ownCrestOrigins } from "./cardCache.ts";

/*
 * How long pages are kept once nothing more can change in them: a match page
 * after full time, the quiz within the UTC day. And the small ESPN feed both
 * the match page and the refresh job read.
 */

const event = (id: number, date: string, name: string, state: string, completed: boolean, score?: [string, string]): EspnEvent => ({
  id: String(id),
  date,
  status: { type: { name, state, completed } },
  competitions: [{ competitors: [{ homeAway: "home", team: { id: "1", displayName: "A" }, ...(score ? { score: score[0] } : {}) }, { homeAway: "away", team: { id: "2", displayName: "B" }, ...(score ? { score: score[1] } : {}) }] }],
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
/** ESPN's scoreboard, answering each request from its URL; the requests made are recorded. */
function scoreboard(answer: (url: string) => { status: number; events?: EspnEvent[] }): { urls: string[]; inits: (RequestInit | undefined)[] } {
  const seen = { urls: [] as string[], inits: [] as (RequestInit | undefined)[] };
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    seen.urls.push(url);
    seen.inits.push(init);
    const { status, events } = answer(url);
    return new Response(JSON.stringify(status === 200 ? { events } : { code: status }), { status });
  }) as typeof fetch;
  return seen;
}

describe("the match page once the game is over", () => {
  const kickoff = "2026-11-08T14:00:00Z";
  const at = (time: string) => Date.parse(time);

  it("a final score is looked for only once the game can be over: a live game is read the ten-minute way alone", () => {
    assert.equal(canBeOver(kickoff, at("2026-11-08T13:00:00Z")), false, "before kick-off");
    assert.equal(canBeOver(kickoff, at("2026-11-08T15:30:00Z")), false, "the second half");
    assert.equal(canBeOver(kickoff, at("2026-11-08T15:40:00Z")), true);
    assert.equal(canBeOver(kickoff, at("2026-11-08T20:00:00Z")), true);
  });

  it("settled: a final, official score. Live, not started, or called off isn't", () => {
    assert.equal(isSettled(espnGameState(event(1, kickoff, "STATUS_FULL_TIME", "post", true, ["2", "1"]))), true);
    assert.equal(isSettled(espnGameState(event(1, kickoff, "STATUS_SECOND_HALF", "in", false, ["2", "1"]))), false, "a live score");
    assert.equal(isSettled(espnGameState(event(1, kickoff, "STATUS_SCHEDULED", "pre", false))), false);
    assert.equal(isSettled(espnGameState(event(1, kickoff, "STATUS_POSTPONED", "post", false))), false);
    assert.equal(isSettled(null), false);
  });

  it("kept for the page's own six hours, far longer than the live state; one entry per game and kick-off", () => {
    assert.equal(SETTLED_KEEP_SECONDS, 21600);
    assert.ok(SETTLED_KEEP_SECONDS >= 36 * MATCH_DAY_REVALIDATE);
    assert.deepEqual(settledKey("PL", 401, kickoff), ["match-settled", "PL", "401", kickoff]);
    assert.notDeepEqual(settledKey("PL", 401, "2026-12-01T20:00:00Z"), settledKey("PL", 401, kickoff), "played again another day");
  });

  it("the final score is read from ESPN itself (not a kept copy), and nothing is returned while there is none", async () => {
    const full = scoreboard(() => ({ status: 200, events: [event(401, kickoff, "STATUS_FULL_TIME", "post", true, ["3", "0"])] }));
    assert.deepEqual(await settledGameState("PL", "eng.1", 401, kickoff), { state: "post", result: { home: 3, away: 0 }, off: false });
    assert.equal(full.inits[0]?.cache, "no-store");
    scoreboard(() => ({ status: 200, events: [event(401, kickoff, "STATUS_SECOND_HALF", "in", false, ["3", "0"])] }));
    assert.equal(await settledGameState("PL", "eng.1", 401, kickoff), undefined, "still being played: the caller reads the live state");
    scoreboard(() => ({ status: 503 }));
    assert.equal(await settledGameState("PL", "eng.1", 401, kickoff), undefined, "ESPN down: as before");
  });

  it("the live state keeps its short lifetime", async () => {
    const seen = scoreboard(() => ({ status: 200, events: [event(401, kickoff, "STATUS_FIRST_HALF", "in", false, ["0", "0"])] }));
    assert.deepEqual(await fetchEspnGameState("eng.1", 401, kickoff, MATCH_DAY_REVALIDATE), { state: "in", result: null, off: false });
    assert.deepEqual((seen.inits[0] as { next?: { revalidate?: number } }).next, { revalidate: 600 });
  });
});

describe("the small ESPN feed", () => {
  const from = Date.parse("2026-11-09T12:00:00Z");

  it("a few days of one league by day range, a day either side", async () => {
    const seen = scoreboard(() => ({ status: 200, events: [event(1, "2026-11-09T20:00Z", "STATUS_SCHEDULED", "pre", false)] }));
    assert.equal((await fetchEspnDays("eng.1", from - 2 * 86_400_000, from + 7_200_000)).length, 1);
    assert.equal(seen.urls.length, 1);
    assert.match(seen.urls[0]!, /\/eng\.1\/scoreboard\?dates=20261106-20261110&limit=300$/);
  });

  it("by calendar month when ESPN refuses the range, each event once", async () => {
    const seen = scoreboard((url) => (/dates=\d{8}-/.test(url) ? { status: 400 } : { status: 200, events: [event(1, "2026-11-30T20:00Z", "STATUS_SCHEDULED", "pre", false), event(url.includes("202612") ? 2 : 1, "2026-12-01T20:00Z", "STATUS_SCHEDULED", "pre", false)] }));
    const events = await fetchEspnDays("eng.1", Date.parse("2026-11-30T12:00:00Z"), Date.parse("2026-11-30T20:00:00Z"));
    assert.deepEqual(seen.urls.slice(1).map((u) => /dates=(\d+)/.exec(u)![1]), ["202611", "202612"]);
    assert.deepEqual(events.map((e) => e.id).sort(), ["1", "2"]);
    assert.deepEqual(monthsBetween(Date.parse("2026-12-30T00:00:00Z"), Date.parse("2027-01-02T00:00:00Z")), ["202612", "202701"]);
    assert.deepEqual(monthsBetween(from, from), ["202611"]);
  });

  it("any other failure is an error: the caller then downloads the season, as before", async () => {
    scoreboard(() => ({ status: 503 }));
    await assert.rejects(fetchEspnDays("eng.1", from, from));
  });
});

describe("the quiz page's clock", () => {
  it("six hours at most, and never past the UTC day by more than a minute", () => {
    assert.equal(quizKeepSeconds(new Date("2026-11-11T08:00:00Z")), QUIZ_KEEP_SECONDS);
    assert.equal(quizKeepSeconds(new Date("2026-11-11T18:00:00Z")), QUIZ_KEEP_SECONDS, "exactly six hours left");
    assert.equal(quizKeepSeconds(new Date("2026-11-11T20:00:00Z")), 4 * 3600 + QUIZ_ROLLOVER_SECONDS);
    assert.equal(quizKeepSeconds(new Date("2026-11-11T23:59:30Z")), 30 + QUIZ_ROLLOVER_SECONDS);
    assert.equal(quizKeepSeconds(new Date("2026-11-12T00:00:00Z")), QUIZ_KEEP_SECONDS, "the new day's page");
    // Whenever it's built, the page is due again within a minute of the next UTC midnight (or earlier).
    for (let hour = 0; hour < 24; hour++) {
      const built = Date.parse("2026-11-11T00:17:00Z") + hour * 3_600_000;
      const due = built + quizKeepSeconds(new Date(built)) * 1000;
      assert.ok(due <= Date.parse("2026-11-12T00:01:00Z") || quizDate(new Date(due)) === "2026-11-11", `built at ${hour}h`);
    }
  });
});

describe("where a card fetches the site's own crests", () => {
  it("production: the site's own address; a preview: its own, then the site's", () => {
    assert.deepEqual(ownCrestOrigins({ VERCEL_ENV: "production", VERCEL_URL: "footsimu-abc.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "footsimu.com" }).slice(0, 1), ["https://footsimu.com"]);
    assert.deepEqual(ownCrestOrigins({ VERCEL_ENV: "preview", VERCEL_URL: "footsimu-git-uat.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "footsimu.com" }).slice(0, 2), ["https://footsimu-git-uat.vercel.app", "https://footsimu.com"]);
    assert.ok(ownCrestOrigins({}).length >= 1, "a local server: the configured site address");
  });
});
