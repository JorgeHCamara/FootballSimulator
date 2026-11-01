import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAGUES, getLeagueBySlug, zoneForPosition } from "../config/leagues.ts";
import { TEAM_OVERRIDES, applyTeamOverrides } from "../config/teamOverrides.ts";
import { doubleRoundRobin } from "../engine/schedule.ts";
import type { ResultMap } from "../engine/types.ts";
import { mapMatches, mapTeam, request, seasonOf, teamsFromMatches, type ApiMatch } from "./footballData.ts";
import { decodeResults, encodeResults } from "./shareCodec.ts";
import { espnFixtures, espnSplitSeason, espnTeams, fetchEspnSeason, type EspnEvent } from "./espn.ts";

describe("shareCodec", () => {
  const fixtures = doubleRoundRobin(Array.from({ length: 20 }, (_, i) => i + 1)).map((f) => ({
    ...f,
    id: 500_000 + f.id * 7, // realistic, non-contiguous API ids
  }));

  it("round-trips predictions", () => {
    const results: ResultMap = {};
    fixtures.forEach((f, i) => {
      if (i % 3 === 0) results[f.id] = { home: i % 5, away: (i * 7) % 4 };
    });
    results[fixtures[1]!.id] = { home: 99, away: 0 };
    const code = encodeResults(fixtures, results);
    assert.match(code, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeResults(fixtures, code), results);
  });

  it("encodes an empty prediction set", () => {
    assert.deepEqual(decodeResults(fixtures, encodeResults(fixtures, {})), {});
  });

  it("rejects malformed codes", () => {
    assert.equal(decodeResults(fixtures, "!!!"), null);
    assert.equal(decodeResults(fixtures, "AgAAAAA"), null); // wrong version
    assert.equal(decodeResults(fixtures, "AQAA"), null); // truncated entry
    assert.equal(decodeResults(fixtures, "Af__AAA"), null); // index out of range
  });
});

describe("football-data mapping", () => {
  const match = (over: Partial<ApiMatch>): ApiMatch => ({
    id: 1,
    utcDate: "2025-08-16T14:00:00Z",
    status: "FINISHED",
    matchday: 1,
    homeTeam: { id: 10 },
    awayTeam: { id: 20 },
    score: { fullTime: { home: 2, away: 1 } },
    ...over,
  });

  it("keeps finished scores and ignores live ones", () => {
    const [finished, live, scheduled] = mapMatches([
      match({ id: 1 }),
      match({ id: 2, status: "IN_PLAY" }),
      match({ id: 3, status: "TIMED", score: { fullTime: { home: null, away: null } } }),
    ]);
    assert.deepEqual(finished!.result, { home: 2, away: 1 });
    assert.equal(live!.result, null);
    assert.equal(scheduled!.result, null);
  });

  it("drops cancelled matches and ones without teams", () => {
    const out = mapMatches([match({ status: "CANCELLED" }), match({ homeTeam: { id: null } }), match({ matchday: null })]);
    assert.equal(out.length, 0);
  });

  it("fills in missing team short names", () => {
    assert.deepEqual(mapTeam({ id: 1, name: "Example FC", shortName: null, tla: null, crest: null }), {
      id: 1,
      name: "Example FC",
      shortName: "Example FC",
      tla: "EXA",
    });
  });
});

describe("league config", () => {
  it("has unique slugs and codes", () => {
    assert.equal(new Set(LEAGUES.map((l) => l.slug)).size, LEAGUES.length);
    assert.equal(new Set(LEAGUES.map((l) => l.code)).size, LEAGUES.length);
  });

  it("defines non-overlapping zones inside the table", () => {
    for (const league of LEAGUES) {
      const covered = new Set<number>();
      for (const z of league.zones) {
        assert.ok(z.from >= 1 && z.to <= league.teams && z.from <= z.to, `${league.code} ${z.kind}`);
        for (let p = z.from; p <= z.to; p++) {
          assert.ok(!covered.has(p), `${league.code} overlap at ${p}`);
          covered.add(p);
        }
      }
      assert.equal(league.tiebreakers[0], "points");
    }
  });

  it("looks up zones by position", () => {
    const bundesliga = getLeagueBySlug("bundesliga")!;
    assert.equal(zoneForPosition(bundesliga, 16)?.kind, "relegationPlayoff");
    assert.equal(zoneForPosition(bundesliga, 10), undefined);
  });

  it("uses the current Brasileirão qualification zones", () => {
    const brasileirao = getLeagueBySlug("brasileirao")!;
    const kind = (p: number) => zoneForPosition(brasileirao, p)?.kind;
    assert.equal(kind(4), "libertadores");
    assert.equal(kind(5), "libertadoresQualifying");
    assert.equal(kind(6), "sudamericana");
    assert.equal(kind(11), "sudamericana");
    assert.equal(kind(12), undefined);
    assert.equal(kind(17), "relegation");
  });
});

describe("team name overrides", () => {
  const paranaense = { id: 1776, name: "CA Paranaense", shortName: "Paranaense", tla: "CAP", crest: "https://example.com/cap.png" };
  const flamengo = { id: 1783, name: "CR Flamengo", shortName: "Flamengo", tla: "FLA" };

  it("renames Athletico Paranaense with the default list", () => {
    const unknown = { id: 9999, name: "Example FC", shortName: "Example", tla: "EXA" };
    const [renamed, untouched] = applyTeamOverrides([paranaense, unknown]);
    assert.equal(renamed!.name, "Athletico Paranaense");
    assert.equal(renamed!.shortName, "Athletico-PR");
    assert.equal(renamed!.id, 1776);
    assert.equal(renamed!.crest, paranaense.crest);
    assert.equal(untouched, unknown);
    assert.ok(TEAM_OVERRIDES.length > 0);
  });

  it("has no duplicate matches in the default list", () => {
    const keys = TEAM_OVERRIDES.map((o) => String(o.match).toLowerCase());
    assert.equal(new Set(keys).size, keys.length);
  });

  it("matches by id, by name case-insensitively, and by short name", () => {
    assert.equal(applyTeamOverrides([flamengo], { overrides: [{ match: 1783, name: "Flamengo" }] })[0]!.name, "Flamengo");
    assert.equal(applyTeamOverrides([flamengo], { overrides: [{ match: " cr FLAMENGO ", name: "Mengão" }] })[0]!.name, "Mengão");
    assert.equal(applyTeamOverrides([paranaense], { overrides: [{ match: "paranaense", shortName: "Furacão" }] })[0]!.shortName, "Furacão");
  });

  it("replaces only the fields given", () => {
    const [team] = applyTeamOverrides([flamengo], { overrides: [{ match: 1783, tla: "CRF" }] });
    assert.deepEqual(team, { ...flamengo, tla: "CRF" });
  });
});

describe("football-data single-request loading", () => {
  const team = (id: number, name: string, extra = {}) => ({ id, name, shortName: name.split(" ").at(-1), tla: name.slice(0, 3).toUpperCase(), crest: `https://crests/${id}.png`, ...extra });
  const season = { id: 2400, startDate: "2026-08-21", endDate: "2027-05-22" };
  const matches: ApiMatch[] = [
    { id: 1, utcDate: "2026-08-21T18:30:00Z", status: "FINISHED", matchday: 1, season, homeTeam: team(5, "FC Bayern München"), awayTeam: team(4, "Borussia Dortmund"), score: { fullTime: { home: 2, away: 1 } } },
    { id: 2, utcDate: "2026-08-28T18:30:00Z", status: "TIMED", matchday: 2, season, homeTeam: team(4, "Borussia Dortmund"), awayTeam: team(3, "Bayer 04 Leverkusen", { shortName: null }), score: { fullTime: { home: null, away: null } } },
    { id: 3, utcDate: "2027-05-22T13:30:00Z", status: "TIMED", matchday: 3, season, homeTeam: { id: null }, awayTeam: { id: null }, score: { fullTime: { home: null, away: null } } },
  ];

  it("builds the team list from the matches", () => {
    const teams = teamsFromMatches(matches);
    assert.deepEqual(teams.map((t) => t.id).sort(), [3, 4, 5]);
    const leverkusen = teams.find((t) => t.id === 3)!;
    assert.equal(leverkusen.shortName, "Bayer 04 Leverkusen");
    assert.equal(teams.find((t) => t.id === 5)!.crest, "https://crests/5.png");
  });

  it("reads the season and still maps fixtures", () => {
    assert.deepEqual(seasonOf(matches), season);
    assert.equal(mapMatches(matches).length, 2);
  });

  it("retries after HTTP 429 using X-RequestCounter-Reset", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      return calls.length === 1
        ? new Response("{}", { status: 429, headers: { "X-RequestCounter-Reset": "0" } })
        : Response.json({ matches: [] });
    }) as unknown as typeof fetch;
    const result = await request<{ matches: unknown[] }>("/competitions/BL1/matches", "key", {}, fakeFetch);
    assert.deepEqual(result, { matches: [] });
    assert.equal(calls.length, 2);
  });

  it("gives up with the status code after repeated errors", async () => {
    const fakeFetch = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    await assert.rejects(request("/competitions/BSA/matches", "key", {}, fakeFetch), /HTTP 403/);
  });
});

describe("ESPN feed mapping", () => {
  const side = (homeAway: "home" | "away", id: string, name: string, score?: string) => ({
    homeAway,
    ...(score === undefined ? {} : { score }),
    team: { id, displayName: name, shortDisplayName: name, abbreviation: name.slice(0, 3).toUpperCase(), logo: `https://logos/${id}.png` },
  });
  const done = { type: { name: "STATUS_FULL_TIME", state: "post", completed: true } };
  const later = { type: { name: "STATUS_SCHEDULED", state: "pre", completed: false } };
  const game = (id: string, date: string, h: [string, string], a: [string, string], status = done, score?: [string, string]): EspnEvent => ({
    id,
    date,
    status,
    competitions: [{ competitors: [side("home", h[0], h[1], score?.[0]), side("away", a[0], a[1], score?.[1])] }],
  });
  const A: [string, string] = ["1", "Ceará"];
  const B: [string, string] = ["2", "Sport"];
  const C: [string, string] = ["3", "Goiás"];
  const D: [string, string] = ["4", "Avaí"];
  const events: EspnEvent[] = [
    game("10", "2026-04-04T19:00Z", A, B, done, ["2", "1"]),
    // C v D was postponed from round 1 and played after round 2.
    game("13", "2026-04-20T19:00Z", C, D, done, ["0", "0"]),
    game("11", "2026-04-11T19:00Z", A, C, done, ["1", "1"]),
    game("12", "2026-04-11T19:00Z", B, D, done, ["3", "0"]),
    game("14", "2026-04-25T19:00Z", A, D, later),
    game("15", "2026-11-21T20:00Z", ["131556", "TBD Home"], ["131554", "TBD Away"], later),
    game("16", "2026-04-25T19:00Z", B, C, { type: { name: "STATUS_CANCELED", state: "post", completed: false } }),
  ];

  it("skips undecided play-off slots and cancelled games", () => {
    const ids = espnFixtures(events).map((f) => f.id).sort();
    assert.deepEqual(ids, [10, 11, 12, 13, 14]);
    assert.deepEqual(espnTeams(events).map((t) => t.name).sort(), ["Avaí", "Ceará", "Goiás", "Sport"]);
  });

  it("rebuilds rounds, putting postponed games back in their original round", () => {
    const round = Object.fromEntries(espnFixtures(events).map((f) => [f.id, f.matchday]));
    assert.deepEqual(round, { 10: 1, 13: 1, 11: 2, 12: 2, 14: 3 });
  });

  it("keeps scores only for finished games", () => {
    const byId = Object.fromEntries(espnFixtures(events).map((f) => [f.id, f.result]));
    assert.deepEqual(byId[10], { home: 2, away: 1 });
    assert.deepEqual(byId[13], { home: 0, away: 0 });
    assert.equal(byId[14], null);
  });

  it("keeps play-off games out of the league once teams have played their league games", () => {
    // Each club plays 2 league games here; the third game (A v B) is a play-off.
    const season = [
      game("1", "2026-04-01T19:00Z", A, B, done, ["1", "0"]),
      game("2", "2026-04-01T19:00Z", C, D, done, ["0", "0"]),
      game("3", "2026-04-08T19:00Z", A, C, done, ["2", "2"]),
      game("4", "2026-04-08T19:00Z", B, D, done, ["1", "1"]),
      game("5", "2026-11-21T20:00Z", B, A, later),
    ];
    const { league, postseason } = espnSplitSeason(season, 2);
    assert.deepEqual(league.map((e) => e.id), ["1", "2", "3", "4"]);
    assert.deepEqual(postseason.map((e) => e.id), ["5"]);
  });

  it("fetches a split season from both calendar years, keeping only its own games", async () => {
    const tagged = (id: string, date: string, year: number) => ({ ...game(id, date, A, B, later), season: { year } });
    const byYear: Record<string, EspnEvent[]> = {
      "2026": [tagged("1", "2026-05-20T15:00Z", 2025), tagged("2", "2026-08-22T15:00Z", 2026)],
      "2027": [tagged("3", "2027-05-23T15:00Z", 2026)],
    };
    const urls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ events: byYear[/dates=(\d+)/.exec(url)![1]!] }));
    }) as typeof fetch;
    try {
      const events = await fetchEspnSeason("eng.1", 2026, "split");
      assert.deepEqual(events.map((e) => e.id).sort(), ["2", "3"]);
      assert.equal(urls.length, 2);
      assert.ok(urls.every((u) => u.includes("/eng.1/scoreboard")));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("every league has an ESPN feed as fallback", () => {
    for (const league of LEAGUES) assert.match(league.espn.slug, /^[a-z]{3}\.\d$/, league.code);
  });

  it("gives ESPN club names the same display names as football-data.org", () => {
    const cologne = { id: 1, name: "FC Cologne", shortName: "Cologne", tla: "KOE" };
    const athletico = { id: 2, name: "Athletico-PR", shortName: "Athletico-PR", tla: "CAP" };
    assert.equal(applyTeamOverrides([cologne], { league: "BL1" })[0]!.name, "FC Köln");
    assert.equal(applyTeamOverrides([athletico], { league: "BSA" })[0]!.name, "Athletico Paranaense");
  });

  it("applies league-scoped renames only in that league", () => {
    const athletic = { id: 20851, name: "Athletic", shortName: "Athletic", tla: "ACMG" };
    assert.equal(applyTeamOverrides([athletic], { league: "BSB" })[0]!.name, "Athletic-MG");
    assert.equal(applyTeamOverrides([athletic], { league: "PD" })[0]!.name, "Athletic");
  });
});
