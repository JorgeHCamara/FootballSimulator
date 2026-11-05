import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { firstCardThatRenders } from "./cardFallback.ts";
import { withClubPages } from "./clubs.ts";
import type { LeagueData } from "./leagueData.ts";
import { buildReport, categoryValue, clubGames, reportCategories, reportGames, reportPath, resultOfRound, roundFromParam, seasonReports, seasonYearLabel } from "./oddsReports.ts";
import { SIM_VERSION } from "./simVersion.ts";
import { addSnapshots, completedRounds, snapshotAfter, snapshotModel, storedRounds, type OddsSnapshot, type TeamSnapshot } from "./snapshots.ts";

const pl = getLeagueByCode("PL")!;
const snap = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const data: LeagueData = { teams: withClubPages(pl, snap.teams), fixtures: snap.fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live" };
const rounds = completedRounds(data.fixtures, Date.parse("2026-11-05T12:00:00Z"));
const at = (n: number) => snapshotAfter(pl, data, n, rounds.find((r) => r.round === n)!.lastKickoff, new Date("2026-11-05T12:00:00Z"), 2000)!;
const file = addSnapshots(undefined, "PL", data.seasonKey, data.season, [at(7), at(8), at(9)]);
const season = seasonReports(file, data.seasonKey)!;

describe("odds reports", () => {
  it("a league's categories: the title, its top continental competition, relegation (and promotion or play-offs where there are)", () => {
    const report = buildReport(pl, season)!;
    assert.deepEqual(report.categories.map((c) => `${c.kind}:${c.zone}`), ["title:title", "continental:championsLeague", "relegation:relegation"]);
    // A second division: promotion; MLS: the play-offs, no title.
    const elc = getLeagueByCode("ELC")!;
    const s = (chances: TeamSnapshot["chances"]) => ({ teams: { "1": { position: 1, points: 0, played: 0, expectedPosition: 1, averagePoints: 0, chances } } }) as unknown as OddsSnapshot;
    assert.deepEqual(reportCategories(elc, s({ title: 0.2, promotion: 0.5, promotionPlayoff: 0.2, relegation: 0 })).map((c) => c.kind), ["title", "promotion", "relegation"]);
    assert.deepEqual(reportCategories(getLeagueByCode("MLS")!, s({ playoffs: 0.9, playoffWildCard: 0.05 })).map((c) => c.kind), ["playoffs"]);
  });

  it("the continental chance: every place of the competition, its qualifying round and a title that leads there", () => {
    const team = (chances: TeamSnapshot["chances"]) => ({ position: 1, points: 0, played: 0, expectedPosition: 1, averagePoints: 0, chances });
    // Premier League: 1st–4th (the title is one of them).
    assert.equal(categoryValue(pl, team({ title: 0.3, championsLeague: 0.8 }), { kind: "continental", zone: "championsLeague" }), 0.8);
    // Eredivisie: 1st (league phase) and 2nd (qualifying).
    assert.equal(categoryValue(getLeagueByCode("DED")!, team({ championsLeague: 0.3, championsLeagueQualifying: 0.25 }), { kind: "continental", zone: "championsLeague" }), 0.55);
    // Greece: the champions, then 2nd (qualifying).
    assert.equal(categoryValue(getLeagueByCode("GSL")!, team({ title: 0.4, championsLeagueQualifying: 0.3 }), { kind: "continental", zone: "championsLeague" }), 0.7);
  });

  it("each club's change since the last report, the top three up and down, and the race so far", () => {
    const report = buildReport(pl, season, 9)!;
    assert.equal(report.snapshot.round, 9);
    assert.equal(report.previous!.round, 8);
    assert.equal(report.rows.length, 20);
    for (const row of report.rows) {
      const c = row.values.title!;
      assert.equal(c.delta, Math.round(c.now * 100) - Math.round(c.before! * 100));
    }
    for (const m of report.movers) {
      assert.ok(m.up.length <= 3 && m.down.length <= 3);
      assert.ok(m.up.every((c) => c.delta! > 0) && m.down.every((c) => c.delta! < 0));
      for (let i = 1; i < m.up.length; i++) assert.ok(m.up[i - 1]!.delta! >= m.up[i]!.delta!);
      for (let i = 1; i < m.down.length; i++) assert.ok(m.down[i - 1]!.delta! <= m.down[i]!.delta!);
    }
    assert.deepEqual(report.race.rounds, [7, 8, 9]);
    assert.equal(report.race.series.length, 5);
    // The top five now, the leader first.
    const titles = report.race.series.map((s) => s.values.at(-1)!);
    assert.deepEqual([...titles].sort((a, b) => b - a), titles);
    // The first report of the season: no changes.
    const first = buildReport(pl, season, 7)!;
    assert.equal(first.previous, undefined);
    assert.ok(first.movers.every((m) => !m.up.length && !m.down.length));
    assert.equal(buildReport(pl, season, 30), undefined);
    assert.equal(buildReport(pl, season)!.snapshot.round, 9, "no round: the latest");
  });

  it("a report across a model change: no changes, movers or result of the round, and the race marks the round", () => {
    assert.equal(at(9).modelVersion, SIM_VERSION, "a snapshot carries today's model");
    // Snapshots from before the field: model "1".
    const older = (s: OddsSnapshot): OddsSnapshot => {
      const { modelVersion: _, ...rest } = s;
      return rest;
    };
    assert.equal(snapshotModel(older(at(8))), "1");
    const mixed = seasonReports(addSnapshots(undefined, "PL", data.seasonKey, data.season, [older(at(7)), older(at(8)), at(9)]), data.seasonKey)!;
    const report = buildReport(pl, mixed, 9)!;
    assert.equal(report.modelChange, true);
    assert.equal(report.previous!.round, 8);
    for (const row of report.rows) for (const c of Object.values(row.values)) assert.ok(c!.before !== undefined && c!.delta === undefined);
    assert.ok(report.movers.every((m) => !m.up.length && !m.down.length));
    assert.equal(resultOfRound(report, reportGames(report, data)), undefined);
    assert.deepEqual(report.race.modelChanges, [9]);
    // The round before: one model on both sides, its changes as usual.
    const before = buildReport(pl, mixed, 8)!;
    assert.equal(before.modelChange, false);
    assert.ok(before.rows.some((r) => r.values.title!.delta !== undefined));
    assert.deepEqual(before.race.modelChanges, []);
    assert.equal(buildReport(pl, season, 9)!.modelChange, false);
  });

  it("a rebuild takes the season's stored rounds again, each as of its own moment", () => {
    const stored = storedRounds(file, data.seasonKey, rounds);
    assert.deepEqual(stored, [7, 8, 9].map((n) => rounds.find((r) => r.round === n)!));
    // A round that no longer counts as completed: as of its stored moment.
    const last = storedRounds(file, data.seasonKey, rounds.filter((r) => r.round !== 9)).at(-1)!;
    assert.equal(last.round, 9);
    assert.equal(Date.parse(last.lastKickoff), Date.parse(at(9).asOf) - 60_000);
    assert.deepEqual(storedRounds(undefined, data.seasonKey, rounds), []);
  });

  it("the round's games, and the one that moved the odds most", () => {
    const report = buildReport(pl, season, 9)!;
    const games = reportGames(report, data);
    assert.equal(games.length, 10);
    assert.ok(games.every((f) => f.result && f.utcDate >= report.previous!.asOf && f.utcDate < report.snapshot.asOf));
    // Another season's data: no games.
    assert.deepEqual(reportGames(report, { ...data, seasonKey: "PL:espn:2025" }), []);
    const per = clubGames(games);
    assert.equal(per.size, 20);
    const key = resultOfRound(report, games)!;
    const swing = (id: number) => Object.values(report.rows.find((r) => r.teamId === id)!.values).reduce((s, c) => s + Math.abs(c!.delta!), 0);
    assert.equal(key.swing, swing(key.fixture.homeId) + swing(key.fixture.awayId));
    for (const f of games) assert.ok(swing(f.homeId) + swing(f.awayId) <= key.swing);
  });

  it("addresses and labels", () => {
    assert.equal(roundFromParam("matchday-11"), 11);
    assert.equal(roundFromParam("matchday-x"), undefined);
    assert.equal(roundFromParam("round-11"), undefined);
    assert.equal(reportPath(pl, 11), "/premier-league/odds/matchday-11");
    assert.equal(seasonYearLabel("Clausura 2026"), "2026");
    assert.equal(seasonYearLabel("2026/27"), "2026/27");
    // The current season when it has reports, else the latest stored.
    const two = addSnapshots(file, "PL", "PL:espn:2027", "2027/28", [{ ...at(9), round: 1, asOf: "2027-08-20T00:00:00.000Z" }]);
    assert.equal(seasonReports(two, "PL:espn:2026")!.seasonKey, "PL:espn:2026");
    assert.equal(seasonReports(two, "PL:espn:2028")!.seasonKey, "PL:espn:2027");
  });

  it("a share card always comes back as an image: a failing attempt (thrown, or while streaming) falls back to the next", async () => {
    const image = (bytes: number[]) => async () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/png" } });
    const throws = async (): Promise<Response> => {
      throw new Error("crest");
    };
    // Fails only once its body is read, as next/og does when it can't draw.
    const failsWhileStreaming = async () => new Response(new ReadableStream({ pull: (c) => c.error(new Error("satori")) }), { headers: { "content-type": "image/png" } });
    const res = await firstCardThatRenders([throws, failsWhileStreaming, image([1, 2, 3])]);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [1, 2, 3]);
  });
});
