import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { withClubPages } from "./clubs.ts";
import type { LeagueData } from "./leagueData.ts";
import { archivedRound, archiveKey, archiveTag, ODDS_ARCHIVE_VERSION, pastRound } from "./oddsArchive.ts";
import { reportGames } from "./oddsReports.ts";
import { addSnapshots, completedRounds, snapshotAfter } from "./snapshots.ts";

const pl = getLeagueByCode("PL")!;
const snap = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const data: LeagueData = { teams: withClubPages(pl, snap.teams), fixtures: snap.fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live" };
const rounds = completedRounds(data.fixtures, Date.parse("2026-11-05T12:00:00Z"));
const at = (n: number, takenAt = "2026-11-05T12:00:00Z") => snapshotAfter(pl, data, n, rounds.find((r) => r.round === n)!.lastKickoff, new Date(takenAt), 2000)!;
const file = addSnapshots(undefined, "PL", data.seasonKey, data.season, [at(7), at(8), at(9)]);
const prod = { VERCEL_ENV: "production", VERCEL_DEPLOYMENT_ID: "dpl_1" };

describe("past rounds' odds reports (the archive)", () => {
  it("a past round of the latest season goes the archive way; the season's latest round, an unknown round and no snapshots go the live way", () => {
    assert.equal(pastRound(pl, file, 8)?.report.snapshot.round, 8);
    assert.equal(pastRound(pl, file, 7)?.report.snapshot.round, 7);
    assert.equal(pastRound(pl, file, 9), undefined, "the latest round follows the live data");
    assert.equal(pastRound(pl, file, 3), undefined);
    assert.equal(pastRound(pl, undefined, 8), undefined);
  });

  it("an entry holds the round's games (as the live report shows them) and only the clubs it names", () => {
    const { report } = pastRound(pl, file, 8)!;
    const entry = archivedRound(report, data, undefined);
    assert.deepEqual(entry.games, reportGames(report, data));
    assert.ok(entry.games.length > 0 && entry.games.every((g) => g.result));
    assert.deepEqual(new Set(entry.teams.map((t) => t.id)), new Set(report.rows.map((r) => r.teamId)));
    assert.ok(entry.teams.every((t) => t.page), "this season's clubs keep their pages");
    // The league's data didn't load: no games, as the live report then.
    assert.deepEqual(archivedRound(report, undefined, undefined), { games: [], teams: [] });
  });

  it("clubs that have left the league since come from last season's data, without a page", () => {
    const { report } = pastRound(pl, file, 8)!;
    const gone = report.rows[0]!.teamId;
    const now = { ...data, teams: data.teams.filter((t) => t.id !== gone) };
    const past = { ...data, seasonYear: 2025, teams: data.teams };
    const entry = archivedRound(report, now, past);
    const club = entry.teams.find((t) => t.id === gone)!;
    assert.ok(club && club.page === undefined && club.slug === undefined);
  });

  it("an entry's key changes with a retaken snapshot (a correction), the archive version and the environment, not with a deployment", () => {
    const { report } = pastRound(pl, file, 8)!;
    const key = archiveKey(pl, report, prod);
    assert.deepEqual(key, archiveKey(pl, report, { ...prod, VERCEL_DEPLOYMENT_ID: "dpl_2" }), "a redeploy reuses it");
    const retaken = addSnapshots(undefined, "PL", data.seasonKey, data.season, [at(7), at(8, "2026-11-09T08:00:00Z"), at(9)]);
    assert.notDeepEqual(archiveKey(pl, pastRound(pl, retaken, 8)!.report, prod), key, "round 8 retaken");
    const later = addSnapshots(undefined, "PL", data.seasonKey, data.season, [at(7, "2026-11-09T08:00:00Z"), at(8), at(9)]);
    assert.notDeepEqual(archiveKey(pl, pastRound(pl, later, 8)!.report, prod), key, "the round before it retaken");
    assert.notDeepEqual(archiveKey(pl, report, prod, ODDS_ARCHIVE_VERSION + 1), key);
    assert.notDeepEqual(archiveKey(pl, report, { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "x" }), key);
    // Another round's entry is its own; the file stored again (as the daily job does) leaves round 8's as it was.
    assert.notDeepEqual(archiveKey(pl, pastRound(pl, file, 7)!.report, prod), key);
    const more = addSnapshots(file, "PL", data.seasonKey, data.season, [at(9)]);
    assert.deepEqual(archiveKey(pl, pastRound(pl, more, 8)!.report, prod), key);
  });

  it("its tag is the league's archive's own, not its live data's", () => {
    assert.equal(archiveTag("PL"), "odds-archive:PL");
    assert.notEqual(archiveTag("PL"), "league:PL");
  });
});
