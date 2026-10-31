import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAGUES, getLeagueBySlug, zoneForPosition } from "../config/leagues.ts";
import { TEAM_OVERRIDES, applyTeamOverrides } from "../config/teamOverrides.ts";
import { doubleRoundRobin } from "../engine/schedule.ts";
import type { ResultMap } from "../engine/types.ts";
import { mapMatches, mapTeam, request, seasonOf, teamsFromMatches, type ApiMatch } from "./footballData.ts";
import { decodeResults, encodeResults } from "./shareCodec.ts";

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
});

describe("team name overrides", () => {
  const paranaense = { id: 1776, name: "CA Paranaense", shortName: "Paranaense", tla: "CAP", crest: "https://example.com/cap.png" };
  const flamengo = { id: 1783, name: "CR Flamengo", shortName: "Flamengo", tla: "FLA" };

  it("renames Athletico Paranaense with the default list", () => {
    const [renamed, untouched] = applyTeamOverrides([paranaense, flamengo]);
    assert.equal(renamed!.name, "Athletico Paranaense");
    assert.equal(renamed!.shortName, "Athletico-PR");
    assert.equal(renamed!.id, 1776);
    assert.equal(renamed!.crest, paranaense.crest);
    assert.equal(untouched, flamengo);
    assert.ok(TEAM_OVERRIDES.length > 0);
  });

  it("matches by id, by name case-insensitively, and by short name", () => {
    assert.equal(applyTeamOverrides([flamengo], [{ match: 1783, name: "Flamengo" }])[0]!.name, "Flamengo");
    assert.equal(applyTeamOverrides([flamengo], [{ match: " cr FLAMENGO ", name: "Mengão" }])[0]!.name, "Mengão");
    assert.equal(applyTeamOverrides([paranaense], [{ match: "paranaense", shortName: "Furacão" }])[0]!.shortName, "Furacão");
  });

  it("replaces only the fields given", () => {
    const [team] = applyTeamOverrides([flamengo], [{ match: 1783, tla: "CRF" }]);
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
