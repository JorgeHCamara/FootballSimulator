import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAGUES } from "../config/leagues.ts";
import type { Fixture } from "../engine/types.ts";
// A plain script, run by Vercel before anything is installed.
import { decide } from "../../scripts/vercel-ignore.mjs";
import { attachXg, type LeagueData } from "./leagueData.ts";
import { publishedSource, publishedTag, sha256 } from "./publishedData.ts";
import { periodicTurn, refreshReason, RUN_MS } from "./leagueRefresh.ts";
import { announcePublications, expireArchives, refreshLeagues } from "./refreshRun.ts";

/*
 * What a run of /api/revalidate/leagues expires (src/lib/refreshRun.ts): a
 * league whose data changed has its pages expired at once, together, and no
 * other league's; an announced publication expires its own file's tags and
 * nothing else, without reading any league's data, and the commit that
 * published it isn't built.
 */

const now = Date.parse("2026-11-09T12:07:00Z");
const HOUR = 3_600_000;
const game = (id: number, kickoff: number, result: Fixture["result"] = null): Fixture => ({ id, matchday: 1, utcDate: new Date(kickoff).toISOString(), homeId: 1, awayId: 2, result });
const data = (fixtures: Fixture[]): LeagueData => ({ teams: [], fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live", provider: "espn" });

describe("a refresh run", () => {
  it("a league whose data changed: its data and outlook tags, expired at once; every other league untouched", async () => {
    const expired: string[] = [];
    const before = data([game(1, now - 3 * HOUR), game(2, now + 48 * HOUR)]);
    const after = data([game(1, now - 3 * HOUR, { home: 2, away: 1 }), game(2, now + 48 * HOUR)]);
    const result = await refreshLeagues(
      { full: true },
      {
        expire: (tag) => expired.push(tag),
        now,
        cached: async (league) => (league.code === "PL" ? before : data([game(9, now - 30 * 24 * HOUR, { home: 0, away: 0 })])),
        fresh: async (league) => (league.code === "PL" ? after : data([game(9, now - 30 * 24 * HOUR, { home: 0, away: 0 })])),
        scoreboard: async () => [],
      },
    );
    assert.deepEqual(expired, ["league:PL", "league:PL-outlook"]);
    assert.deepEqual(result.refreshed, ["PL"]);
    assert.equal(result.results.find((r) => r.league === "PL")?.reason, "changed");
  });

  it("nothing changed, or ESPN can't be read: nothing expired", async () => {
    const expired: string[] = [];
    const same = data([game(1, now - 3 * HOUR, { home: 2, away: 1 })]);
    await refreshLeagues({ only: "PL" }, { expire: (tag) => expired.push(tag), now, cached: async () => same, fresh: async () => same });
    await refreshLeagues({ only: "PL" }, { expire: (tag) => expired.push(tag), now, cached: async () => same, fresh: async () => undefined });
    assert.deepEqual(expired, []);
  });

  it("a league with a game near, whose small feed shows the same games: the season isn't downloaded", async () => {
    // A run off PL's periodic turn, so the small feed goes first.
    let run = now;
    while (periodicTurn("PL", run)) run += RUN_MS;
    const cached = data([game(1, run - HOUR)]);
    let downloads = 0;
    const result = await refreshLeagues(
      { full: false },
      {
        expire: () => assert.fail("nothing to expire"),
        now: run,
        cached: async (league) => (league.code === "PL" ? cached : undefined),
        fresh: async (league) => {
          if (league.code === "PL") downloads++;
          return undefined;
        },
        scoreboard: async () => [
          {
            id: "1",
            date: cached.fixtures[0]!.utcDate,
            status: { type: { name: "STATUS_SECOND_HALF", state: "in", completed: false } },
            competitions: [{ competitors: [{ homeAway: "home", team: { id: "1", displayName: "A" } }, { homeAway: "away", team: { id: "2", displayName: "B" } }] }],
          },
        ],
      },
    );
    assert.deepEqual(result.results.find((r) => r.league === "PL"), { league: "PL", reason: "unchanged", why: "active", via: "scoreboard" });
    assert.equal(downloads, 0);
  });

  it("checks only the leagues with club pages, the first-party ones never against a feed", async () => {
    const result = await refreshLeagues({ full: true }, { expire: () => {}, now, cached: async () => undefined, fresh: async () => undefined });
    const firstParty: string[] = LEAGUES.filter((l) => l.firstParty).map((l) => l.code);
    for (const r of result.results) if (firstParty.includes(r.league)) assert.equal(r.why, "own-data");
    assert.ok(result.results.length > 20);
  });

  it("an archive correction: those leagues' archive tags only", () => {
    const expired: string[] = [];
    assert.deepEqual(expireArchives("pl,bl1", (tag) => expired.push(tag)), ["PL", "BL1"]);
    assert.deepEqual(expired, ["odds-archive:PL", "odds-archive:BL1"]);
  });
});

describe("the daily job's publication, without a deployment", () => {
  const source = publishedSource({ FOOTSIMU_DATA_URL: "https://data.example/repo" })!;
  const snapshots = '{"seasons":{"2026":[{"round":12}]}}';
  const xg = '{"matches":{"401":[1.2,0.8]}}';
  /** The source as GitHub serves it after the job's commit. */
  const served = (files: Record<string, string>): typeof fetch =>
    (async (input: unknown) => {
      const url = String(input);
      const hit = Object.entries(files).find(([path]) => url.endsWith(path));
      return hit ? new Response(hit[1]) : new Response("", { status: 404 });
    }) as typeof fetch;

  it("new snapshots and xG, announced with their fingerprints: that league's file tags (and archive) expire, nothing else, no league data read", async () => {
    const expired: string[] = [];
    const answer = await announcePublications(`snapshots:PL:${sha256(snapshots)},xg:BSA:${sha256(xg)}`, {
      expire: (tag) => expired.push(tag),
      source,
      fetcher: served({ "/src/data/snapshots/PL.json": snapshots, "/src/data/xg/BSA.json": xg }),
    });
    assert.deepEqual(answer.published, ["snapshots:PL", "xg:BSA"]);
    assert.deepEqual(expired, [publishedTag("snapshots", "PL"), "odds-archive:PL", publishedTag("xg", "BSA")]);
    assert.ok(!expired.some((tag) => tag.startsWith("league:")), "no league's data or outlook tag");
    // The job's commit changes only those folders: Vercel doesn't build it.
    const commit = { ref: "main", previous: "abc1234", changed: ["src/data/snapshots/PL.json", "src/data/xg/BSA.json"] };
    assert.equal(decide(commit as never).build, false);
  });

  it("GitHub still serving the last version: pending, nothing expired (the job asks again)", async () => {
    const expired: string[] = [];
    const answer = await announcePublications(`xg:BSA:${sha256(xg)}`, { expire: (tag) => expired.push(tag), source, fetcher: served({ "/src/data/xg/BSA.json": '{"matches":{}}' }) });
    assert.deepEqual(answer.pending, ["xg:BSA"]);
    assert.deepEqual(expired, []);
  });

  it("the source can't be read: unavailable, nothing expired; no source at all: expired without the check", async () => {
    const expired: string[] = [];
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    assert.deepEqual((await announcePublications(`xg:BSA:${sha256(xg)}`, { expire: (tag) => expired.push(tag), source, fetcher: down })).unavailable, ["xg:BSA"]);
    assert.deepEqual(expired, []);
    const unchecked: string[] = [];
    await announcePublications("snapshots:PL", { expire: (tag) => unchecked.push(tag), source: undefined });
    assert.deepEqual(unchecked, [publishedTag("snapshots", "PL"), "odds-archive:PL"]);
  });
});

describe("the refresh job's comparison without xG", () => {
  // The job reads both sides without the league's stored xG (getLeagueBase, freshLeagueData({ xg: false })):
  // both would carry the same entry, which adds a game's xG only with its result, so it never decides.
  const cached = data([game(1, now - 30 * HOUR, { home: 1, away: 0 }), game(2, now - 3 * HOUR), game(3, now + 48 * HOUR)]);
  const results = { 2: { home: 2, away: 2 } } as const;
  const fresh = data(cached.fixtures.map((f) => (f.id in results ? { ...f, result: results[f.id as 2] } : f)));
  const moved = data(cached.fixtures.map((f) => (f.id === 3 ? { ...f, utcDate: new Date(now + 72 * HOUR).toISOString() } : f)));
  const stores: Record<number, readonly [number, number]>[] = [{}, { 1: [1.1, 0.4] as const }, { 1: [1.1, 0.4] as const, 2: [0.8, 1.9] as const }, { 2: [0.8, 1.9] as const, 3: [1, 1] as const }];

  it("decides exactly as with xG on both sides, whatever xG is stored", () => {
    for (const stored of stores) {
      for (const [before, after] of [[cached, cached], [cached, fresh], [cached, moved], [fresh, fresh]] as const) {
        assert.equal(refreshReason(attachXg(before, stored), attachXg(after, stored)), refreshReason(before, after), JSON.stringify(stored));
      }
    }
    assert.equal(refreshReason(cached, fresh), "changed");
    assert.equal(refreshReason(cached, moved), "changed");
    assert.equal(refreshReason(cached, cached), "unchanged");
  });

  it("the pages' data still carries the xG (the chances use it)", () => {
    assert.deepEqual(attachXg(fresh, stores[2]!).xg, { 1: [1.1, 0.4], 2: [0.8, 1.9] });
    assert.equal(attachXg(cached, stores[3]!).xg, undefined, "no xG for a game without its result");
  });
});
