import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getLeagueBySlug } from "../config/leagues.ts";
import { HISTORY, HISTORY_LEAGUES, type HistoryLeague } from "./history.ts";
import { decades, eras, filterRows, mostTitles, parseLeagueHistory, winnerRows, type HistorySeason, type LeagueHistory } from "./winners.ts";
import { HISTORY_DIR, crestFor, historySlugs, leagueHistory, leagueWinners } from "./winnersData.ts";

const ESPN = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/soccer\/500\/\d+\.png$/;
const LOCAL = /^\/crests\/\d+\.png$/;

describe("the Past Winners files", () => {
  const slugs = historySlugs();

  it("has one file per league, named by the league's slug, with its code", () => {
    assert.ok(slugs.length >= 1, "at least the Premier League");
    const onDisk = readdirSync(HISTORY_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    assert.deepEqual([...slugs].sort(), onDisk);
    for (const slug of slugs) {
      const league = getLeagueBySlug(slug);
      assert.ok(league, `${slug} is a league`);
      const history = leagueHistory(slug)!;
      assert.equal(history.footsimuSlug, slug);
      assert.equal(history.footsimuCode, league.code, `${slug}: its code`);
    }
  });

  it("passes every check: seasons once and in order, a champion and a runner-up when completed, no club twice", () => {
    for (const slug of slugs) {
      const raw = JSON.parse(readFileSync(join(HISTORY_DIR, `${slug}.json`), "utf8"));
      const history = parseLeagueHistory(raw, slug);
      const keys = history.seasons.map((s) => `${s.season}|${s.tournament ?? ""}`);
      assert.equal(new Set(keys).size, keys.length, `${slug}: no duplicate seasons`);
      for (const s of history.seasons) {
        if (s.status === "completed") {
          assert.ok(s.champion && s.runnerUp, `${slug} ${s.season}: champion and runner-up`);
          const ids = [s.champion, s.runnerUp, s.third].filter((p) => p !== null).map((p) => p!.footsimuId ?? p!.currentName);
          assert.equal(new Set(ids).size, ids.length, `${slug} ${s.season}: champion, runner-up and third are different clubs`);
        } else {
          assert.equal(s.champion, null);
          assert.equal(s.runnerUp, null);
          assert.equal(s.third, null);
          assert.ok(s.notes.length > 0, `${slug} ${s.season}: why it wasn't played`);
        }
      }
    }
  });

  it("gives every club a badge: the site's own file or ESPN's crest for a club with an id, none (the shield) without", () => {
    for (const slug of slugs) {
      for (const row of leagueWinners(slug)!) {
        for (const club of [row.champion, row.runnerUp, row.third]) {
          if (!club) continue;
          if (club.id === null) assert.equal(club.crest, null, `${slug} ${row.season}: ${club.name} has no id, so a shield`);
          else assert.ok(club.crest && (LOCAL.test(club.crest) || ESPN.test(club.crest)), `${slug} ${row.season}: ${club.name}'s badge`);
        }
      }
    }
    assert.equal(crestFor(null, "Leeds City"), null);
    assert.match(crestFor(364, "Liverpool")!, ESPN);
    assert.equal(crestFor(319, "Kidderminster Harriers"), "/crests/319.png");
  });

  it("agrees with the quiz's history on the seasons both have (the top three, by club id)", () => {
    for (const slug of slugs) {
      const league = getLeagueBySlug(slug)!;
      if (!HISTORY_LEAGUES.includes(league.code as HistoryLeague)) continue;
      const rows = leagueWinners(slug)!;
      let compared = 0;
      for (const season of HISTORY.leagues[league.code as HistoryLeague] ?? []) {
        const row = rows.find((r) => r.startYear === season.year && r.tournament === null);
        if (!row || row.status !== "completed") continue;
        compared++;
        assert.deepEqual(
          [row.champion, row.runnerUp, row.third].map((c) => c?.id ?? null),
          season.table.slice(0, 3).map((r) => r[0]),
          `${slug} ${row.season}`,
        );
      }
      assert.ok(compared >= 10, `${slug}: ${compared} seasons compared`);
    }
  });
});

describe("the Premier League's past winners", () => {
  const rows = leagueWinners("premier-league")!;

  it("runs from 1888-89 to 2025-26, newest first, one row a season", () => {
    assert.equal(rows.length, 138);
    assert.equal(rows[0]!.season, "2025-26");
    assert.equal(rows.at(-1)!.season, "1888-89");
    assert.deepEqual([rows[0]!.champion!.name, rows[0]!.runnerUp!.name, rows[0]!.third!.name], ["Arsenal", "Manchester City", "Manchester United"]);
    assert.equal(rows[0]!.champion!.points, 85);
    assert.ok(rows.every((r) => !r.world && r.tournament === null));
  });

  it("counts the titles under the club as it is today", () => {
    assert.deepEqual(
      mostTitles(rows, 5).map((c) => [c.name, c.titles]),
      [
        ["Liverpool", 20],
        ["Manchester United", 20],
        ["Arsenal", 14],
        ["Manchester City", 10],
        ["Everton", 9],
      ],
    );
    const wednesday = mostTitles(rows, 100).find((c) => c.key === "espn:399")!;
    assert.equal(wednesday.name, "Sheffield Wednesday");
    assert.equal(wednesday.titles, 4, "The Wednesday's two titles count as Sheffield Wednesday's");
  });

  it("has three eras, the current one open-ended", () => {
    assert.deepEqual(eras(rows), [
      { name: "Football League", from: 1888, to: 1892 },
      { name: "Football League First Division", from: 1892, to: 1992 },
      { name: "Premier League", from: 1992, to: null },
    ]);
  });

  it("keeps the war seasons as rows with no placings and a note", () => {
    const notHeld = rows.filter((r) => r.status === "not_held");
    const abandoned = rows.filter((r) => r.status === "abandoned");
    assert.equal(notHeld.length, 10);
    assert.equal(abandoned.length, 1);
    assert.equal(abandoned[0]!.season, "1939-40");
    for (const r of [...notHeld, ...abandoned]) {
      assert.equal(r.champion, null);
      assert.ok(r.notes[0]!.length > 0);
    }
  });

  it("shows the name used that season and the club it is today", () => {
    const row = rows.find((r) => r.season === "1902-03")!;
    assert.equal(row.champion!.name, "The Wednesday");
    assert.equal(row.champion!.currentName, "Sheffield Wednesday");
    assert.equal(row.champion!.key, "espn:399");
  });

  it("filters by era, decade and club", () => {
    const [football, first, premier] = eras(rows);
    assert.equal(filterRows(rows, { era: premier }).length, 34);
    assert.equal(filterRows(rows, { era: football }).length, 4);
    assert.equal(filterRows(rows, { era: first }).length, 100);
    assert.equal(filterRows(rows, { decade: 1880 }).length, 2);
    assert.deepEqual(decades(rows).slice(0, 2), [2020, 2010]);
    assert.equal(decades(rows).at(-1), 1880);
    const wednesday = filterRows(rows, { query: "wednesday" });
    assert.ok(wednesday.length >= 5);
    assert.ok(wednesday.every((r) => [r.champion, r.runnerUp, r.third].some((c) => c?.currentName === "Sheffield Wednesday")));
    assert.equal(filterRows(rows, { query: "Wédnesday " }).length, wednesday.length, "accents and case don't matter");
    assert.equal(filterRows(rows, { query: "nobody" }).length, 0);
    assert.equal(filterRows(rows, { query: "war" }).length, 0, "a search leaves out the seasons not played");
  });
});

describe("parseLeagueHistory", () => {
  const placing = (id: number, name: string) => ({ name, currentName: name, footsimuId: id, footsimuSlug: name.toLowerCase(), footsimuPath: `/x/team/${name.toLowerCase()}`, points: 40 });
  const season = (over: Partial<HistorySeason> = {}): HistorySeason => ({
    season: "1900-01",
    startYear: 1900,
    tournament: null,
    status: "completed",
    competition: "First Division",
    format: "league",
    notes: [],
    champion: placing(1, "A"),
    runnerUp: placing(2, "B"),
    third: placing(3, "C"),
    ...over,
  });
  const file = (seasons: HistorySeason[]): LeagueHistory => ({ league: "Test", footsimuSlug: "test", footsimuCode: "TST", country: "Nowhere", seasons });

  it("two seasons starting the same year: the one ending later is newer (La Liga's 1929, then 1929-30)", () => {
    const rows = winnerRows(file([season({ season: "1929", startYear: 1929 }), season({ season: "1929-30", startYear: 1929 }), season({ season: "1930-31", startYear: 1930 })]), () => null);
    assert.deepEqual(rows.map((r) => r.season), ["1930-31", "1929-30", "1929"]);
  });

  it("accepts a sound file, a missing third place, a tournament and a season not held", () => {
    const parsed = parseLeagueHistory(
      file([
        season({ season: "1899-00", startYear: 1899, status: "not_held", champion: null, runnerUp: null, third: null, notes: ["War"] }),
        season({ third: null }),
        season({ season: "1901-02", startYear: 1901, tournament: "North" }),
        season({ season: "1901-02", startYear: 1901, tournament: "South", champion: placing(4, "D") }),
        season({ season: "1902", startYear: 1902, format: "final", champion: { ...placing(1, "A"), points: null } }),
      ]),
    );
    assert.equal(parsed.seasons.length, 5);
    const rows = winnerRows(parsed, () => null);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["1902", "1901-02-north", "1901-02-south", "1900-01", "1899-00"],
    );
    assert.equal(rows[3]!.third, null);
    assert.equal(rows[0]!.champion!.points, null);
    assert.equal(rows[4]!.status, "not_held");
    assert.equal(eras(rows).length, 1);
    assert.deepEqual(decades(rows), [1900, 1890]);
    assert.equal(mostTitles(rows)[0]!.titles, 3, "a tournament's title counts");
  });

  it("names the file and the season when something is wrong", () => {
    const bad = (seasons: HistorySeason[], message: RegExp) => assert.throws(() => parseLeagueHistory(file(seasons), "test.json"), message);
    bad([season(), season()], /test\.json: 1900-01: listed twice/);
    bad([season({ season: "1901-02", startYear: 1901 }), season()], /1900-01: seasons must be oldest first/);
    bad([season({ third: placing(1, "A") })], /the same club in two places/);
    bad([season({ runnerUp: null })], /needs a champion and a runner-up/);
    bad([season({ status: "not_held" })], /a season not_held has no placings/);
    bad([season({ status: "cancelled" as never })], /status must be/);
    bad([season({ format: "cup" as never })], /format must be/);
    bad([season({ season: "1900/01" })], /must be labelled like/);
    bad([season({ startYear: 1901 })], /startYear must be the season's first year/);
    bad([season({ champion: { ...placing(1, "A"), points: 3.5 } })], /points must be a whole number or null/);
    bad([season({ champion: { ...placing(1, "A"), footsimuId: -1 } })], /footsimuId must be a positive integer or null/);
    bad([season({ notes: ["ok", 3 as never] })], /notes must be a list of text/);
    assert.throws(() => parseLeagueHistory({ league: "X" }, "test.json"), /footsimuSlug must be text/);
    assert.throws(() => parseLeagueHistory(file([]), "test.json"), /seasons must be a non-empty list/);
  });
});
