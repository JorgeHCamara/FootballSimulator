import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import { runMonteCarlo } from "../engine/montecarlo.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { cachedLeagueOutlook, dataAsOf, dataVersion, leagueOutlook, outlookSetup, resultScenarios } from "./clubOutlook.ts";
import { withClubPages } from "./clubs.ts";
import type { LeagueData } from "./leagueData.ts";
import { findMatch, inIndexWindow, leagueMatches, localDate, matchesBetween, matchSlug, MOVED_WITHIN_DAYS, slugDate } from "./matches.ts";
import { impactRows, isMatchDay, resultScores } from "./matchPreview.ts";
import { addSnapshots, completedRounds, pendingRounds, snapshotAfter, type OddsSnapshot } from "./snapshots.ts";

const pl = getLeagueByCode("PL")!;
const snap = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const data: LeagueData = { teams: withClubPages(pl, snap.teams), fixtures: snap.fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live" };
const teams = new Map(data.teams.map((t) => [t.id, t]));
const next = data.fixtures.filter((f) => !f.result).sort((a, b) => a.utcDate.localeCompare(b.utcDate))[0]!;

describe("match page addresses", () => {
  it("home-vs-away-date, the date in the league's own time zone", () => {
    const slug = matchSlug(pl, next, teams.get(next.homeId), teams.get(next.awayId))!;
    assert.match(slug, /^[a-z0-9-]+-vs-[a-z0-9-]+-\d{4}-\d{2}-\d{2}$/);
    assert.ok(slug.startsWith(`${teams.get(next.homeId)!.slug}-vs-${teams.get(next.awayId)!.slug}-`));
    // 21:30 in São Paulo is already the next day in UTC: the address keeps the local day.
    assert.equal(localDate("2026-11-09T00:30:00Z", "America/Sao_Paulo"), "2026-11-08");
    assert.equal(localDate("2026-11-09T00:30:00Z", "Europe/London"), "2026-11-09");
    const bsa = getLeagueByCode("BSA")!;
    const a: Team = { id: 1, name: "São Paulo", shortName: "São Paulo", tla: "SAO", slug: "sao-paulo" };
    const b: Team = { id: 2, name: "Grêmio", shortName: "Grêmio", tla: "GRE", slug: "gremio" };
    assert.equal(matchSlug(bsa, { id: 9, matchday: 1, utcDate: "2026-11-09T00:30:00Z", homeId: 1, awayId: 2, result: null }, a, b), "sao-paulo-vs-gremio-2026-11-08");
    // A club without a page (a play-off slot): no match page.
    assert.equal(matchSlug(bsa, { id: 9, matchday: 1, utcDate: "2026-11-09T00:30:00Z", homeId: 1, awayId: 2, result: null }, a, { ...b, slug: undefined }), undefined);
  });

  it("every league game has one, unique; a moved game redirects; an unknown one doesn't exist", () => {
    const matches = leagueMatches(pl, data);
    assert.equal(matches.length, 380);
    assert.equal(new Set(matches.map((m) => m.slug)).size, 380);
    const m = matches.find((x) => x.fixture.id === next.id)!;
    assert.deepEqual(findMatch(pl, data, m.slug), { match: m });
    // The same game, three days off (it was moved): the nearest game of the same clubs.
    const old = m.slug.replace(/\d{4}-\d{2}-\d{2}$/, localDate(new Date(Date.parse(next.utcDate) - 3 * 86_400_000).toISOString(), "Europe/London"));
    assert.equal((findMatch(pl, data, old) as { moved: typeof m }).moved, m);
    // Only a game within three weeks of the address's date: any other date is no game, not the clubs' other meeting.
    const shifted = (days: number) => m.slug.replace(/\d{4}-\d{2}-\d{2}$/, localDate(new Date(Date.parse(next.utcDate) + days * 86_400_000).toISOString(), "Europe/London"));
    assert.equal(MOVED_WITHIN_DAYS, 21);
    assert.equal((findMatch(pl, data, shifted(21)) as { moved: typeof m }).moved, m);
    assert.equal((findMatch(pl, data, shifted(-21)) as { moved: typeof m }).moved, m);
    assert.equal(findMatch(pl, data, shifted(22)), undefined);
    assert.equal(findMatch(pl, data, `${m.slug.slice(0, -10)}2027-05-20`), undefined);
    assert.equal(findMatch(pl, data, "arsenal-vs-nobody-2026-11-08"), undefined);
    assert.equal(findMatch(pl, data, "arsenal-vs-chelsea"), undefined);
    assert.equal(slugDate(m.slug), Date.parse(`${m.slug.slice(-10)}T12:00:00Z`));
  });

  it("the index window: 30 days back, 14 ahead", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    assert.equal(inIndexWindow("2026-10-06T12:00:00Z", now), true);
    assert.equal(inIndexWindow("2026-10-06T11:59:00Z", now), false);
    assert.equal(inIndexWindow("2026-11-19T12:00:00Z", now), true);
    assert.equal(inIndexWindow("2026-11-19T12:01:00Z", now), false);
  });

  it("the sitemap's window: games between two times", () => {
    const from = Date.parse("2026-10-25T00:00:00Z");
    const to = Date.parse("2026-11-09T00:00:00Z");
    const window = matchesBetween(pl, data, from, to);
    assert.ok(window.length > 0);
    assert.ok(window.every((m) => Date.parse(m.fixture.utcDate) >= from && Date.parse(m.fixture.utcDate) <= to));
    assert.equal(window.length, data.fixtures.filter((f) => Date.parse(f.utcDate) >= from && Date.parse(f.utcDate) <= to).length);
  });

  it("a moved game changes the data version (and the cached index with it)", () => {
    const moved = { ...data, fixtures: data.fixtures.map((f) => (f.id === next.id ? { ...f, utcDate: "2026-12-30T15:00Z" } : f)) };
    assert.notEqual(dataVersion(moved), dataVersion(data));
    assert.ok(leagueMatches(pl, moved).some((m) => m.slug.endsWith("2026-12-30") && m.fixture.id === next.id));
  });

  it("match day: from six hours before kick-off to twelve after", () => {
    const k = "2026-11-08T15:00:00Z";
    assert.equal(isMatchDay(k, Date.parse("2026-11-08T08:00:00Z")), false);
    assert.equal(isMatchDay(k, Date.parse("2026-11-08T10:00:00Z")), true);
    assert.equal(isMatchDay(k, Date.parse("2026-11-09T02:00:00Z")), true);
    assert.equal(isMatchDay(k, Date.parse("2026-11-09T04:00:00Z")), false);
  });
});

describe("what a result means", () => {
  it("an override sets a game's result without changing any other game's draws", () => {
    const s = outlookSetup(pl, data)!;
    const base = runMonteCarlo({ ...s.input, iterations: 300, seed: 7 });
    // Overriding with nothing, or with no game, changes nothing at all.
    assert.deepEqual(runMonteCarlo({ ...s.input, iterations: 300, seed: 7, override: {} }), base);
    const win = runMonteCarlo({ ...s.input, iterations: 300, seed: 7, override: { [next.id]: { home: 3, away: 0 } } });
    const loss = runMonteCarlo({ ...s.input, iterations: 300, seed: 7, override: { [next.id]: { home: 0, away: 3 } } });
    const points = (r: typeof base, id: number) => r.averagePoints[id]!;
    // Every other game is drawn the same: the home side gains exactly the 3 points of a win over a loss.
    assert.ok(Math.abs(points(win, next.homeId) - points(loss, next.homeId) - 3) < 1e-9);
    assert.ok(Math.abs(points(loss, next.awayId) - points(win, next.awayId) - 3) < 1e-9);
    // Clubs not in the game: their points don't move.
    const other = data.teams.find((t) => t.id !== next.homeId && t.id !== next.awayId)!.id;
    assert.equal(points(win, other), points(base, other));
  });

  it("each result's likeliest score, and the chances after each", () => {
    const outlook = cachedLeagueOutlook(pl, data)!;
    const scores = resultScores({ home: 1.6, away: 1.0 }, -0.12);
    assert.ok(scores.home.home > scores.home.away && scores.draw.home === scores.draw.away && scores.away.home < scores.away.away);
    const scenarios = resultScenarios(pl, data, next, scores)!;
    assert.equal(resultScenarios(pl, data, next, scores), scenarios, "cached");
    const now = outlook.clubs.get(next.homeId)!;
    const after = (k: "home" | "draw" | "away") => scenarios.after[k].get(next.homeId)!;
    assert.ok(after("home").expectedPosition <= now.expectedPosition && now.expectedPosition <= after("away").expectedPosition);
    // The same as a full rerun with that result.
    const rerun = leagueOutlook(pl, data, undefined, { [next.id]: scores.home })!;
    assert.equal(rerun.clubs.get(next.homeId)!.expectedPosition, after("home").expectedPosition);
  });

  it("shows the chances a result moves, most first; a club with none open gets its average place", () => {
    const chances = (title: number, relegation: number, expectedPosition = 10) => ({
      zones: [],
      headline: [
        { kind: "title" as const, zone: "title" as const, chance: title },
        { kind: "relegation" as const, zone: "relegation" as const, chance: relegation },
      ],
      expectedPosition,
    });
    const rows = impactRows(1, chances(0.3, 0.1), { home: chances(0.4, 0.08), draw: chances(0.3, 0.1), away: chances(0.2, 0.13) });
    assert.deepEqual(rows.map((r) => r.kind), ["title", "relegation"]);
    assert.equal(rows[0]!.home, 0.4);
    // Settled (never, or always) or barely moving: left out; then the average place instead.
    const safe = impactRows(1, chances(0, 0.002, 9.4), { home: chances(0, 0.001, 9.0), draw: chances(0, 0.002, 9.4), away: chances(0, 0.004, 9.9) });
    assert.deepEqual(safe.map((r) => [r.kind, r.now, r.home, r.away]), [["position", 9.4, 9.0, 9.9]]);
    // A season already settled: not even the average place moves.
    assert.deepEqual(impactRows(1, chances(0, 0, 18), { home: chances(0, 0, 18), draw: chances(0, 0, 18), away: chances(0, 0, 18.02) }), []);
  });
});

describe("odds snapshots", () => {
  const game = (id: number, matchday: number, utcDate: string, played = true): Fixture => ({ id, matchday, utcDate, homeId: id * 2, awayId: id * 2 + 1, result: played ? { home: 1, away: 0 } : null });
  const now = Date.parse("2026-11-05T12:00:00Z");

  it("rounds count in the order they're played, once every earlier one is, numbered by how many are complete", () => {
    const fixtures = [
      game(1, 1, "2026-10-17T14:00Z"),
      game(2, 1, "2026-10-18T14:00Z"),
      // Round 1's game moved to December: not waited for.
      game(3, 1, "2026-12-20T14:00Z", false),
      game(4, 2, "2026-10-25T14:00Z"),
      // Played early, a month before its round.
      game(5, 2, "2026-09-25T14:00Z"),
      game(6, 2, "2026-10-26T19:00Z"),
      game(7, 3, "2026-11-01T14:00Z"),
      game(8, 3, "2026-11-02T14:00Z", false),
      // A midweek round played before round 3: it's the third round complete.
      game(9, 4, "2026-10-29T19:00Z"),
      game(10, 4, "2026-10-29T19:00Z"),
    ];
    assert.deepEqual(completedRounds(fixtures, Date.parse("2026-11-03T12:00:00Z")), [
      { round: 1, lastKickoff: "2026-10-18T14:00Z" },
      { round: 2, lastKickoff: "2026-10-26T19:00Z" },
      { round: 3, lastKickoff: "2026-10-29T19:00Z" },
    ]);
    // Two days on, round 3's last game is overdue (postponed): four rounds complete.
    assert.deepEqual(completedRounds(fixtures, now).at(-1), { round: 4, lastKickoff: "2026-11-01T14:00Z" });
    // A round of games scattered over months (rebuilt rounds can be): placed by its median, it doesn't hold the others back.
    const scattered = [
      game(1, 1, "2026-08-15T14:00Z"),
      game(2, 1, "2026-08-15T14:00Z"),
      game(3, 2, "2026-09-26T14:00Z"),
      game(4, 2, "2026-11-04T19:00Z"),
      game(5, 2, "2027-01-12T14:00Z", false),
      game(6, 3, "2026-08-22T14:00Z"),
      game(7, 3, "2026-08-22T14:00Z"),
    ];
    assert.deepEqual(completedRounds(scattered, Date.parse("2026-11-05T12:00:00Z")).map((r) => r.round), [1, 2, 3]);
    // Two rounds completing at the same moment: one snapshot, the higher.
    assert.deepEqual(completedRounds([game(1, 1, "2026-10-29T19:00Z"), game(2, 2, "2026-10-29T19:00Z"), game(3, 2, "2026-10-25T14:00Z")], now), [{ round: 2, lastKickoff: "2026-10-29T19:00Z" }]);
    // A game kicked off an hour ago: its round waits for the result to be in.
    assert.deepEqual(completedRounds([game(1, 1, "2026-11-05T11:00Z")], now), []);
  });

  it("first run: only the latest round; then every new one; a round stored again is replaced", () => {
    const done = [
      { round: 7, lastKickoff: "a" },
      { round: 8, lastKickoff: "b" },
      { round: 9, lastKickoff: "c" },
    ];
    assert.deepEqual(pendingRounds(undefined, "PL:2026", done), [done[2]]);
    const s = (round: number) => ({ round }) as OddsSnapshot;
    const file = addSnapshots(undefined, "PL", "PL:2026", "2026/27", [s(8)]);
    assert.deepEqual(pendingRounds(file, "PL:2026", done), [done[2]]);
    assert.deepEqual(pendingRounds(file, "PL:2025", done), [done[2]], "another season starts its own list");
    const more = addSnapshots(file, "PL", "PL:2026", "2026/27", [s(10), { ...s(8), date: "again" } as OddsSnapshot]);
    assert.deepEqual(more.seasons["PL:2026"]!.snapshots.map((x) => x.round), [8, 10]);
    assert.equal(more.seasons["PL:2026"]!.snapshots[0]!.date, "again");
  });

  it("a snapshot: every club's chances as of just after the round, later results left out", () => {
    const [latest] = completedRounds(data.fixtures, Date.parse("2026-11-05T12:00:00Z")).slice(-1);
    assert.equal(latest!.round, 9);
    // A result from after round 9 (round 10 played early) mustn't count.
    const later = { ...data, fixtures: data.fixtures.map((f) => (f.id === next.id ? { ...f, result: { home: 5, away: 0 } } : f)) };
    const a = snapshotAfter(pl, data, 9, latest!.lastKickoff, new Date("2026-11-05T12:00:00Z"))!;
    const b = snapshotAfter(pl, later, 9, latest!.lastKickoff, new Date("2026-11-05T12:00:00Z"))!;
    assert.deepEqual(a, b);
    assert.equal(a.played, 90);
    assert.equal(a.date, "2026-11-02");
    assert.equal(Object.keys(a.teams).length, 20);
    const titles = Object.values(a.teams).reduce((sum, t) => sum + (t.chances.title ?? 0), 0);
    assert.ok(Math.abs(titles - 1) < 0.001);
    for (const t of Object.values(a.teams)) {
      assert.deepEqual(Object.keys(t.chances), ["title", "championsLeague", "europaLeague", "conferenceLeague", "relegation"]);
      assert.ok(t.expectedPosition >= 1 && t.expectedPosition <= 20);
    }
    // The same numbers as the club pages (same Monte Carlo, same seed), up to rounding.
    const arsenal = cachedLeagueOutlook(pl, dataAsOf(data, a.asOf))!.clubs.get(359)!;
    assert.equal(a.teams["359"]!.chances.title, Math.round(arsenal.zones[0]!.chance * 10_000) / 10_000);
  });
});
