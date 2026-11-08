import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAGUES, getLeagueBySlug, zoneForPosition } from "../config/leagues.ts";
import { TEAM_OVERRIDES, applyTeamOverrides } from "../config/teamOverrides.ts";
import { doubleRoundRobin } from "../engine/schedule.ts";
import type { ResultMap } from "../engine/types.ts";
import { mapMatches, mapTeam, request, seasonOf, teamsFromMatches, type ApiMatch } from "./footballData.ts";
import { decodeResults, encodeResults } from "./shareCodec.ts";
import { existsSync } from "node:fs";
import { CREST_FALLBACKS, withFallbackCrests } from "../config/crests.ts";
import { assignRounds, espnFixtures, espnSplitSeason, espnTeams, fetchEspnGroups, fetchEspnSeason, type EspnEvent } from "./espn.ts";

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
    // B v C was postponed; ESPN lists the rescheduled game as a new event.
    game("16", "2026-04-25T19:00Z", B, C, { type: { name: "STATUS_POSTPONED", state: "pre", completed: false } }),
    game("17", "2026-04-29T19:00Z", B, C, later),
  ];

  it("skips undecided play-off slots and postponed games that were rescheduled", () => {
    const ids = espnFixtures(events).map((f) => f.id).sort();
    assert.deepEqual(ids, [10, 11, 12, 13, 14, 17]);
    assert.deepEqual(espnTeams(events).map((t) => t.name).sort(), ["Avaí", "Ceará", "Goiás", "Sport"]);
  });

  it("rebuilds rounds, putting postponed games back in their original round", () => {
    const round = Object.fromEntries(espnFixtures(events).map((f) => [f.id, f.matchday]));
    assert.deepEqual(round, { 10: 1, 13: 1, 11: 2, 12: 2, 14: 3, 17: 3 });
  });

  it("keeps an abandoned game that wasn't rescheduled, without a result", () => {
    const abandoned = game("18", "2026-04-25T19:00Z", B, C, { type: { name: "STATUS_ABANDONED", state: "post", completed: false } }, ["1", "0"]);
    const fixture = espnFixtures([abandoned]).find((f) => f.id === 18);
    assert.equal(fixture?.result, null);
  });

  it("keeps a full schedule to its real number of rounds when games are moved", () => {
    // A 20-team season, one round a week; then 12 games are moved weeks earlier
    // or later (cup ties, TV), which used to push games into rounds 39, 40, …
    const teams = Array.from({ length: 20 }, (_, i) => i + 1);
    const schedule = doubleRoundRobin(teams);
    const week = 7 * 86_400_000;
    const start = Date.parse("2026-01-31T19:00Z");
    const moved = new Map<number, number>();
    schedule.forEach((f, i) => {
      if (i % 31 === 7) moved.set(f.id, (i % 2 ? 3 : -4) * week + 86_400_000);
    });
    const games = schedule.map((f) => ({ home: f.homeId, away: f.awayId, time: start + (f.matchday - 1) * week + (moved.get(f.id) ?? 0) }));
    const rounds = assignRounds(games, 38);
    assert.ok(Math.max(...rounds) <= 37, "no round after 38");
    for (let r = 0; r < 38; r++) {
      const inRound = games.filter((_, i) => rounds[i] === r).flatMap((g) => [g.home, g.away]);
      assert.equal(new Set(inRound).size, inRound.length, `no club twice in round ${r + 1}`);
      assert.equal(inRound.length, 20, `round ${r + 1} is complete`);
    }
    const unmoved = schedule.filter((f) => !moved.has(f.id));
    const kept = unmoved.filter((f) => rounds[schedule.indexOf(f)] === f.matchday - 1).length;
    assert.ok(kept / unmoved.length > 0.95, `most games keep their round (${kept}/${unmoved.length})`);
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

  it("groups a league without fixed rounds by calendar week, skipping empty weeks", () => {
    const weekly = [
      game("1", "2026-02-21T19:00Z", A, B, later), // Saturday, week 1
      game("2", "2026-02-25T23:00Z", C, D, later), // Wednesday, week 2
      game("3", "2026-03-01T19:00Z", A, C, later), // Sunday, still week 2
      game("4", "2026-03-30T19:00Z", B, D, later), // Monday five weeks on: week 3
    ];
    const round = Object.fromEntries(espnFixtures(weekly, { weekly: true }).map((f) => [f.id, f.matchday]));
    assert.deepEqual(round, { 1: 1, 2: 2, 3: 2, 4: 3 });
  });

  it("reads conferences from ESPN's standings feed", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          children: [
            { name: "Eastern Conference", standings: { entries: [{ team: { id: "182" } }, { team: { id: "183" } }] } },
            { name: "Western Conference", standings: { entries: [{ team: { id: "184" } }] } },
          ],
        }),
      )) as typeof fetch;
    try {
      assert.deepEqual(await fetchEspnGroups("usa.1", 2026), [
        { name: "Eastern Conference", teamIds: [182, 183] },
        { name: "Western Conference", teamIds: [184] },
      ]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("keeps a shoot-out after a second leg that wasn't itself a draw (level on aggregate)", () => {
    // Copa do Brasil 2026: Atlético-MG 2–1 Ceará, then Ceará 2–1 Atlético-MG, 2–4 on penalties.
    const leg2: EspnEvent = {
      id: "77",
      date: "2026-05-14T22:00Z",
      status: { type: { name: "STATUS_FINAL_PEN", state: "post", completed: true } },
      competitions: [{ competitors: [{ ...side("home", "9", "Ceará", "2"), shootoutScore: 2 }, { ...side("away", "8", "Atlético-MG", "1"), shootoutScore: 4 }] }],
    };
    assert.deepEqual(espnFixtures([leg2])[0]!.penalties, { home: 2, away: 4 });
  });

  it("every league has an ESPN feed as fallback, or is first-party", () => {
    // Domestic leagues ("eng.1"), or UEFA competitions ("uefa.champions"); a first-party league (Série C) has none.
    for (const league of LEAGUES) {
      if (league.firstParty) {
        assert.equal(league.espn, undefined, league.code);
        continue;
      }
      assert.match(league.espn!.slug, league.continental ? /^(uefa|conmebol)\.[a-z.]+$/ : /^[a-z]{3}\.\d$/, league.code);
    }
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

describe("fallback crests", () => {
  it("fills a missing crest from the saved map and keeps ESPN's own", () => {
    const [id, path] = Object.entries(CREST_FALLBACKS)[0] ?? ["0", "/crests/0.png"];
    const map = { [Number(id)]: path };
    const teams = [
      { id: Number(id), name: "A", shortName: "A", tla: "A" },
      { id: Number(id), name: "B", shortName: "B", tla: "B", crest: "https://espn/1.png" },
    ];
    const filled = withFallbackCrests(teams);
    if (Object.keys(CREST_FALLBACKS).length) assert.equal(filled[0]!.crest, map[Number(id)]);
    assert.equal(filled[1]!.crest, "https://espn/1.png");
  });

  it("has a saved image for every entry", () => {
    for (const [id, path] of Object.entries(CREST_FALLBACKS)) {
      assert.ok(existsSync(new URL(`../../public${path}`, import.meta.url)), `crest ${id} missing: ${path}`);
    }
  });
});

describe("continental competitions (UEFA, CONMEBOL)", async () => {
  const { continentalPriors } = await import("./continental.ts");
  const { runMonteCarlo } = await import("../engine/montecarlo.ts");
  const { buildLeagueModel } = await import("../engine/ratings.ts");
  const { realResults } = await import("../engine/results.ts");
  const { sampleLeague } = await import("./sampleLeague.ts");
  const { continents } = await import("../config/competitions.ts");

  it("rates clubs from their domestic league, scaled by its strength, averaging 1", () => {
    const pl = new Map([[1, { attack: 1.5, defence: 0.7 }]]);
    const ned = new Map([[2, { attack: 1.5, defence: 0.7 }]]);
    const priors = continentalPriors([1, 2, 3], [{ tier: 0, strengths: pl }, { tier: 1, strengths: ned }], 2);
    assert.ok(priors[1]!.attack > priors[2]!.attack && priors[2]!.attack > priors[3]!.attack, "PL > Eredivisie > outsider");
    assert.ok(priors[1]!.defence < priors[2]!.defence);
    const geo = Math.cbrt(priors[1]!.attack * priors[2]!.attack * priors[3]!.attack);
    assert.ok(Math.abs(geo - 1) < 1e-9);
  });

  it("plays a sample league phase of 8 rounds and the knockout phase to one winner per run", () => {
    const ucl = getLeagueBySlug("champions-league")!;
    const { teams, fixtures } = sampleLeague(ucl);
    assert.equal(teams.length, 36);
    for (const team of teams) assert.equal(fixtures.filter((f) => f.homeId === team.id || f.awayId === team.id).length, 8);
    const fixed = realResults(fixtures);
    const result = runMonteCarlo({
      teams,
      fixtures,
      fixed,
      model: buildLeagueModel(teams, fixtures, fixed),
      standings: { tiebreakers: ucl.tiebreakers },
      iterations: 200,
      seed: 1,
      playoff: { config: ucl.playoff!, options: { afterMatchday: 8, afterDate: "2027-01-28T20:00:00Z" } },
    });
    assert.equal(Object.values(result.playoffWins!).reduce((a, b) => a + b, 0), 200);
    // 24 clubs in the knockout phase every run, 2 in every final.
    const reached = Object.values(result.playoffReached!);
    assert.equal(reached.reduce((sum, r) => sum + r[0]!, 0), 200 * 16);
    assert.equal(reached.reduce((sum, r) => sum + r[1]!, 0), 200 * 16);
    assert.equal(reached.reduce((sum, r) => sum + r[4]!, 0), 200 * 2);
  });

  it("plays a sample Libertadores: groups of 4 within themselves, knockout seeded from group places", () => {
    const lib = getLeagueBySlug("copa-libertadores")!;
    const { teams, fixtures } = sampleLeague(lib);
    assert.equal(teams.length, 32);
    // Teams 1–4 are group A: they only meet each other, home and away.
    const groupA = fixtures.filter((f) => f.homeId <= 4 || f.awayId <= 4);
    assert.equal(groupA.length, 12);
    assert.ok(groupA.every((f) => f.homeId <= 4 && f.awayId <= 4));
    const fixed = realResults(fixtures);
    const groups = Array.from({ length: 8 }, (_, g) => teams.slice(g * 4, g * 4 + 4).map((t) => t.id));
    const result = runMonteCarlo({
      teams,
      fixtures,
      fixed,
      model: buildLeagueModel(teams, fixtures, fixed),
      standings: { tiebreakers: lib.tiebreakers },
      iterations: 200,
      seed: 2,
      groups,
      playoff: { config: lib.playoff!, options: { afterMatchday: 6, afterDate: "2027-05-28T20:00:00Z" } },
    });
    assert.equal(Object.values(result.playoffWins!).reduce((a, b) => a + b, 0), 200);
    // Exactly two clubs per group in the round of 16 every run.
    for (const ids of groups) assert.equal(ids.reduce((n, id) => n + (result.playoffReached![id]?.[0] ?? 0), 0), 400);
  });

  it("plays a sample Primera Nacional: the zone winners' final for the title, the Reducido for the second promotion", () => {
    const pn = getLeagueBySlug("argentina-primera-nacional")!;
    const { teams, fixtures } = sampleLeague(pn);
    assert.equal(teams.length, 36);
    for (const team of teams) assert.equal(fixtures.filter((f) => f.homeId === team.id || f.awayId === team.id).length, 36);
    const fixed = realResults(fixtures);
    const groups = [teams.slice(0, 18).map((t) => t.id), teams.slice(18).map((t) => t.id)];
    const result = runMonteCarlo({
      teams,
      fixtures,
      fixed,
      model: buildLeagueModel(teams, fixtures, fixed),
      standings: { tiebreakers: pn.tiebreakers },
      iterations: 200,
      seed: 3,
      groups,
      playoff: { config: pn.playoff!, options: { afterMatchday: 36, afterDate: "2026-11-02T20:00:00Z" } },
    });
    const sum = (counts: Record<number, number>) => Object.values(counts).reduce((a, b) => a + b, 0);
    assert.equal(sum(result.playoffTitles!), 200, "a champion every run");
    assert.equal(sum(result.playoffWins!), 200, "a Reducido winner every run");
    const reached = Object.values(result.playoffReached!);
    // 2 in the final, 14 in the Reducido's first round, 8 (the final's loser too) in its second.
    assert.deepEqual([0, 1, 2, 3, 4].map((r) => reached.reduce((n, x) => n + x[r]!, 0)), [400, 2800, 1600, 800, 400]);
    // One club from each zone in the final.
    for (const ids of groups) assert.equal(ids.reduce((n, id) => n + (result.playoffReached![id]?.[0] ?? 0), 0), 200);
  });

  it("groups the menu by continent, UEFA under Europe and CONMEBOL under South America", () => {
    const groups = continents();
    assert.deepEqual(groups.map((g) => g.continent), ["Europe", "South America", "North America", "Asia"]);
    assert.deepEqual(groups[3]!.countries.map((c) => [c.country, c.leagues.map((l) => l.name)]), [["Japan", ["J1 League"]], ["Saudi Arabia", ["Saudi Pro League"]]]);
    const uefa = groups[0]!.countries.find((c) => c.country === "UEFA")!;
    assert.ok(groups[0]!.countries.some((c) => c.country === "Turkey" && c.leagues.some((l) => l.name === "Süper Lig")));
    assert.ok(groups[0]!.countries.some((c) => c.country === "Belgium" && c.leagues.some((l) => l.name === "Pro League")));
    assert.ok(groups[0]!.countries.some((c) => c.country === "Greece" && c.leagues.some((l) => l.name === "Super League Greece")));
    assert.ok(groups[0]!.countries.some((c) => c.country === "Austria" && c.leagues.some((l) => l.name === "Austrian Bundesliga")));
    assert.deepEqual(uefa.leagues.map((l) => l.name), ["Champions League", "Europa League", "Conference League"]);
    assert.deepEqual(groups[1]!.countries.map((c) => c.country), ["Brazil", "Argentina", "Chile", "Colombia", "Uruguay", "Paraguay", "Ecuador", "Peru", "CONMEBOL"]);
    const conmebol = groups[1]!.countries.find((c) => c.country === "CONMEBOL")!;
    assert.deepEqual(conmebol.leagues.map((l) => l.name), ["Copa Libertadores", "Copa Sudamericana"]);
  });
});

describe("Argentina's annual table", async () => {
  const { runMonteCarlo, probabilityInRange } = await import("../engine/montecarlo.ts");
  const { buildLeagueModel } = await import("../engine/ratings.ts");
  const { realResults } = await import("../engine/results.ts");

  it("passes a qualified club's place down in the zone chances", () => {
    const teams = [1, 2, 3].map((id) => ({ id, name: `T${id}`, shortName: `T${id}`, tla: `T${id}` }));
    // Every game played: club 1 first, 2 second, 3 third.
    const fixtures = [
      { id: 1, matchday: 1, utcDate: "2026-01-01", homeId: 1, awayId: 2, result: { home: 2, away: 0 } },
      { id: 2, matchday: 2, utcDate: "2026-01-08", homeId: 2, awayId: 3, result: { home: 2, away: 0 } },
      { id: 3, matchday: 3, utcDate: "2026-01-15", homeId: 1, awayId: 3, result: { home: 2, away: 0 } },
    ];
    const fixed = realResults(fixtures);
    const result = runMonteCarlo({
      teams,
      fixtures,
      fixed,
      model: buildLeagueModel(teams, fixtures, fixed),
      standings: { tiebreakers: ["points"] },
      iterations: 10,
      seed: 1,
      passDown: [1],
    });
    // Club 1 already qualified: club 2 takes the first place in the zone.
    assert.equal(probabilityInRange(result, 2, 1, 1, true), 1);
    assert.equal(probabilityInRange(result, 2, 1, 1), 0, "its real position is still 2nd");
  });

  it("is configured with Libertadores 1–3, Sudamericana 4–9 and relegation for the last", () => {
    const arg = getLeagueBySlug("argentina-primera-division")!;
    assert.deepEqual(arg.annual!.zones.map((z) => [z.kind, z.from, z.to]), [["libertadores", 1, 3], ["sudamericana", 4, 9], ["relegation", 30, 30]]);
  });
});

describe("several tournaments a season (Colombia, Uruguay, Paraguay)", async () => {
  const { inferGroups } = await import("./leagueData.ts");
  const { isStage } = await import("../config/leagues.ts");

  it("recognises groups from who plays whom", () => {
    const f = (homeId: number, awayId: number, id: number) => ({ id, matchday: 1, utcDate: "", homeId, awayId, result: null });
    const groups = inferGroups([f(1, 2, 1), f(3, 4, 2), f(2, 5, 3), f(4, 6, 4)], ["A", "B"]);
    assert.deepEqual(groups, [{ id: "A", teamIds: [1, 2, 5] }, { id: "B", teamIds: [3, 4, 6] }]);
  });

  it("matches ESPN stage tags with or without a year", () => {
    assert.ok(isStage("torneo-apertura-2026", "torneo-apertura"));
    assert.ok(isStage("apertura", "apertura"));
    assert.ok(!isStage("apertura---finals", "apertura"));
  });

  it("gives Uruguay's Intermedio its own format", () => {
    const uru = getLeagueBySlug("uruguay-primera-division")!;
    const stages = uru.espn!.stages as readonly { table: string; gamesPerTeam?: number; playoff?: unknown }[];
    const intermedio = stages.find((s) => s.table === "torneo-intermedio")!;
    assert.equal(intermedio.gamesPerTeam, 7);
    assert.ok(intermedio.playoff);
    assert.equal(uru.playoff, undefined);
  });
});

describe("points deductions from ESPN's standings (Peru)", async () => {
  const { espnDeductions } = await import("./espn.ts");
  const { computeStandings } = await import("../engine/standings.ts");

  it("reads the deductions stat, ignoring clubs without one", () => {
    const standings = {
      children: [
        {
          name: "2026 Clausura",
          standings: {
            entries: [
              { team: { id: "10122" }, stats: [{ name: "points", value: 0 }, { name: "deductions", value: 5 }] },
              { team: { id: "131655" }, stats: [{ name: "points", value: 11 }, { name: "deductions", value: 0 }] },
            ],
          },
        },
      ],
    };
    assert.deepEqual(espnDeductions(standings), { 10122: 5 });
  });

  it("drops a docked club below a rival it would otherwise top", () => {
    const teams = [1, 2].map((id) => ({ id, name: `T${id}`, shortName: `T${id}`, tla: `T${id}` }));
    const fixtures = [{ id: 1, matchday: 1, utcDate: "2026-01-01", homeId: 1, awayId: 2, result: { home: 1, away: 0 } }];
    const results = { 1: { home: 1, away: 0 } };
    assert.equal(computeStandings(teams, fixtures, results, { tiebreakers: ["points"] })[0]!.teamId, 1);
    const docked = computeStandings(teams, fixtures, results, { tiebreakers: ["points"], deductions: { 1: 5 } });
    assert.deepEqual(docked.map((r) => [r.teamId, r.points]), [[2, 0], [1, -2]]);
  });
});

describe("abandoned games whose score stood (Primera Nacional)", async () => {
  const { standingResults } = await import("./leagueData.ts");
  const { espnFixtures } = await import("./espn.ts");

  it("counts the listed game with its score, and leaves other abandoned games without a result", () => {
    const event = (id: string) => ({
      id,
      date: "2026-08-03T19:00Z",
      name: "Tristán Suárez at Güemes",
      status: { type: { name: "STATUS_ABANDONED", state: "post", completed: false } },
      competitions: [
        {
          competitors: [
            { homeAway: "home", score: "1", team: { id: "18284", displayName: "Güemes" } },
            { homeAway: "away", score: "3", team: { id: "10163", displayName: "Tristán Suárez" } },
          ],
        },
      ],
    });
    const events = standingResults([event("401844023"), event("401844024")] as never, ["401844023"]);
    const fixtures = espnFixtures(events);
    assert.deepEqual(fixtures.find((f) => f.id === 401844023)?.result, { home: 1, away: 3 });
    assert.equal(fixtures.find((f) => f.id === 401844024)?.result, null);
    assert.equal(standingResults(events, undefined), events);
  });
});
