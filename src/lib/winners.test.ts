import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getLeagueBySlug } from "../config/leagues.ts";
import { HISTORY, HISTORY_LEAGUES, type HistoryLeague } from "./history.ts";
import { decades, eras, filterRows, mostTitles, parseLeagueHistory, rowClubs, winnerRows, type HistorySeason, type LeagueHistory } from "./winners.ts";
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

  it("passes every check: seasons once and in order, a champion (or a revoked one) when completed, no club twice", () => {
    for (const slug of slugs) {
      const raw = JSON.parse(readFileSync(join(HISTORY_DIR, `${slug}.json`), "utf8"));
      const history = parseLeagueHistory(raw, slug);
      const keys = history.seasons.map((s) => `${s.season}|${s.tournament ?? ""}`);
      assert.equal(new Set(keys).size, keys.length, `${slug}: no duplicate seasons`);
      for (const s of history.seasons) {
        if (s.status === "completed") {
          assert.ok(s.champion || s.strippedChampion, `${slug} ${s.season}: a champion, or the club whose title was revoked`);
          assert.ok(s.runnerUp || (s.notes.length > 0 && !s.third), `${slug} ${s.season}: a runner-up, or a note on why there is none`);
          const ids = [s.strippedChampion ?? null, s.champion, s.runnerUp, s.third]
            .filter((p) => p !== null)
            .flatMap((p) => [p!, ...(p!.tiedWith ?? [])])
            .map((p) => p.footsimuId ?? p.currentName);
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
        for (const club of rowClubs(row)) {
          if (club.id === null) assert.ok(club.crest === null || club.crest.startsWith("/crests/serie-c/"), `${slug} ${row.season}: ${club.name} has no id, so a shield or its Série C crest`);
          else assert.ok(club.crest && (LOCAL.test(club.crest) || ESPN.test(club.crest)), `${slug} ${row.season}: ${club.name}'s badge`);
        }
      }
    }
    assert.equal(crestFor(null, "Leeds City"), null);
    // No ESPN id, but a club of the site's own Série C: its crest there.
    assert.equal(crestFor(null, "Paysandu"), "/crests/serie-c/20017.png");
    assert.equal(crestFor(null, "Santa Cruz"), "/crests/serie-c/20039.png");
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

describe("Serie A's past winners", () => {
  const rows = leagueWinners("serie-a")!;

  it("runs from 1898 to 2025-26, with 1921-22's two championships as two rows", () => {
    assert.equal(rows.length, 130);
    assert.equal(rows[0]!.season, "2025-26");
    assert.deepEqual([rows[0]!.champion!.name, rows[0]!.runnerUp!.name, rows[0]!.third!.name], ["Internazionale", "Napoli", "Roma"]);
    assert.equal(rows.at(-1)!.season, "1898");
    assert.deepEqual(rows.filter((r) => r.season === "1921-22").map((r) => [r.id, r.champion!.name]), [
      ["1921-22-cci", "Pro Vercelli"],
      ["1921-22-figc", "Novese"],
    ]);
  });

  it("counts the titles the FIGC recognises: no champion for the two revoked titles", () => {
    assert.deepEqual(
      mostTitles(rows, 5).map((c) => [c.name, c.titles]),
      [
        ["Juventus", 36],
        ["Inter", 21],
        ["AC Milan", 19],
        ["Genoa", 9],
        ["Bologna", 7],
      ],
    );
    for (const [season, club] of [
      ["2004-05", "Juventus"],
      ["1926-27", "Torino"],
    ]) {
      const row = rows.find((r) => r.season === season)!;
      assert.equal(row.status, "completed");
      assert.equal(row.champion, null, season);
      assert.equal(row.stripped!.name, club, season);
    }
    // 1914-15: the final round was never finished, so Genoa's title has no runner-up.
    const war = rows.find((r) => r.season === "1914-15")!;
    assert.equal(war.champion!.name, "Genoa");
    assert.equal(war.runnerUp, null);
  });

  it("keeps the clubs level in a place: three second in 1947-48, and none third", () => {
    const row = rows.find((r) => r.season === "1947-48")!;
    assert.deepEqual([row.runnerUp!, ...row.runnerUp!.tiedWith!].map((c) => [c.name, c.points]), [
      ["Milan", 49],
      ["Juventus", 49],
      ["Triestina", 49],
    ]);
    assert.equal(row.third, null);
    assert.ok(filterRows(rows, { query: "triestina" }).some((r) => r.season === "1947-48"));
    assert.equal(rows.filter((r) => r.runnerUp?.tiedWith || r.third?.tiedWith).length, 6);
  });

  it("has its names over time as eras, the two of 1921-22 overlapping", () => {
    assert.deepEqual(eras(rows), [
      { name: "Campionato Italiano di Football", from: 1898, to: 1903 },
      { name: "Prima Categoria", from: 1904, to: 1922 },
      { name: "Prima Divisione", from: 1921, to: 1926 },
      { name: "Divisione Nazionale", from: 1926, to: 1929 },
      { name: "Serie A", from: 1929, to: null },
    ]);
    const [, prima, divisione] = eras(rows);
    assert.ok(filterRows(rows, { era: prima }).some((r) => r.id === "1921-22-figc"));
    assert.ok(filterRows(rows, { era: divisione }).some((r) => r.id === "1921-22-cci"));
  });
});

describe("the Brasileirão's past winners", () => {
  const rows = leagueWinners("brasileirao")!;

  it("runs from 1937 to 2025, calendar years, with the Taça Brasil and the Robertão both in 1967 and 1968", () => {
    assert.equal(rows.length, 71);
    assert.equal(rows[0]!.season, "2025");
    assert.deepEqual([rows[0]!.champion!.name, rows[0]!.runnerUp!.name, rows[0]!.third!.name], ["Flamengo", "Palmeiras", "Cruzeiro"]);
    assert.equal(rows.at(-1)!.season, "1937");
    assert.deepEqual(rows.filter((r) => r.startYear === 1967).map((r) => [r.tournament, r.champion!.name]), [
      ["Torneio Roberto Gomes Pedrosa", "Palmeiras"],
      ["Taça Brasil", "Palmeiras"],
    ]);
  });

  it("counts the titles, both of 1967's and 1968's and both of 1987's among them", () => {
    assert.deepEqual(
      mostTitles(rows, 5).map((c) => [c.name, c.titles]),
      [
        ["Palmeiras", 12],
        ["Flamengo", 9],
        ["Santos", 8],
        ["Corinthians", 7],
        ["São Paulo", 6],
      ],
    );
    // 1987: the CBF's champion and the Copa União's, each without a third place.
    assert.deepEqual(rows.filter((r) => r.season === "1987").map((r) => [r.tournament, r.champion!.name, r.runnerUp!.name, r.third]), [
      ["CBF", "Sport Recife", "Guarani", null],
      ["Copa União", "Flamengo", "Internacional", null],
    ]);
  });

  it("keeps each parallel championship in its own era, and an era of one season", () => {
    const list = eras(rows);
    assert.deepEqual(list.slice(0, 3), [
      { name: "Torneio dos Campeões", from: 1937, to: 1937 },
      { name: "Taça Brasil", from: 1959, to: 1968 },
      { name: "Torneio Roberto Gomes Pedrosa", from: 1967, to: 1970 },
    ]);
    assert.deepEqual(list.at(-1), { name: "Campeonato Brasileiro Série A", from: 2001, to: null });
    assert.equal(filterRows(rows, { era: list[1] }).length, 10, "the Taça Brasil: 1959 to 1968");
    assert.equal(filterRows(rows, { era: list[2] }).length, 4, "the Robertão: 1967 to 1970");
  });
});

describe("Ligue 1's past winners", () => {
  const rows = leagueWinners("ligue-1")!;

  it("runs from 1932-33 to 2025-26, the war years not held, 1992-93's title withdrawn", () => {
    assert.equal(rows.length, 94);
    assert.equal(rows[0]!.season, "2025-26");
    assert.equal(rows.at(-1)!.season, "1932-33");
    assert.equal(rows.filter((r) => r.status === "not_held").length, 6);
    const revoked = rows.find((r) => r.season === "1992-93")!;
    assert.equal(revoked.champion, null);
    assert.equal(revoked.stripped!.name, "Marseille");
    assert.deepEqual(
      mostTitles(rows, 5).map((c) => [c.name, c.titles]),
      [
        ["Paris Saint-Germain", 14],
        ["Saint-Étienne", 10],
        ["Marseille", 9],
        ["Monaco", 8],
        ["Nantes", 8],
      ],
    );
  });

  it("keeps the war years in the era around them, though the file names them differently", () => {
    const list = eras(rows);
    assert.deepEqual(list, [{ name: "French championship", from: 1932, to: null }]);
    assert.equal(filterRows(rows, { era: list[0] }).length, 94);
  });
});

describe("the Segunda División's past winners", () => {
  const rows = leagueWinners("segunda-division")!;

  it("runs from 1929 to 2025-26, the Civil War years not held, North and South from 1949-50 to 1967-68", () => {
    assert.equal(rows.length, 117);
    assert.equal(rows[0]!.season, "2025-26");
    assert.equal(rows[0]!.champion!.name, "Racing Santander");
    assert.equal(rows.at(-1)!.season, "1929");
    assert.equal(rows.filter((r) => r.status === "not_held").length, 3);
    const groups = rows.filter((r) => r.tournament !== null);
    assert.equal(groups.length, 38, "19 seasons of two groups");
    assert.deepEqual(rows.filter((r) => r.season === "1949-50").map((r) => [r.tournament, r.champion!.name]), [
      ["North", "Racing Santander"],
      ["South", "Alcoyano"],
    ]);
    assert.deepEqual(eras(rows), [{ name: "Segunda División", from: 1929, to: null }]);
  });

  it("counts each group's win as a title, as the sources do", () => {
    assert.deepEqual(
      mostTitles(rows, 2).map((c) => [c.name, c.titles]),
      [
        ["Real Murcia", 8],
        ["Real Betis", 7],
      ],
    );
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

  it("accepts a title revoked and not reassigned, a final round never finished and shared places", () => {
    const parsed = parseLeagueHistory(
      file([
        season({ champion: null, strippedChampion: placing(1, "A"), runnerUp: placing(2, "B") }),
        season({ season: "1901-02", startYear: 1901, runnerUp: null, third: null, notes: ["Not finished"] }),
        season({ season: "1902-03", startYear: 1902, third: { ...placing(3, "C"), tiedWith: [placing(4, "D")] } }),
      ]),
    );
    const rows = winnerRows(parsed, () => null);
    const [tied, unfinished, revoked] = rows;
    assert.equal(revoked!.champion, null);
    assert.equal(revoked!.stripped!.name, "A");
    assert.equal(unfinished!.runnerUp, null);
    assert.deepEqual(tied!.third!.tiedWith!.map((c) => c.name), ["D"]);
    assert.equal(mostTitles(rows).find((c) => c.name === "A")!.titles, 2, "a revoked title doesn't count");
    assert.equal(filterRows(rows, { query: "d" }).length, 1, "a search finds a club level in a place");
    assert.deepEqual(rowClubs(revoked!).map((c) => c.name), ["A", "B", "C"]);
  });

  it("names the file and the season when something is wrong", () => {
    const bad = (seasons: HistorySeason[], message: RegExp) => assert.throws(() => parseLeagueHistory(file(seasons), "test.json"), message);
    bad([season(), season()], /test\.json: 1900-01: listed twice/);
    bad([season({ season: "1901-02", startYear: 1901 }), season()], /1900-01: seasons must be oldest first/);
    bad([season({ third: placing(1, "A") })], /the same club in two places/);
    bad([season({ champion: null })], /a completed season needs a champion \(or a revoked one\)/);
    bad([season({ strippedChampion: placing(4, "D") })], /a revoked title \(strippedChampion\) leaves no champion/);
    bad([season({ runnerUp: null })], /a third place needs a runner-up/);
    bad([season({ third: { ...placing(3, "C"), tiedWith: [placing(1, "A")] } })], /the same club in two places/);
    bad([season({ third: { ...placing(3, "C"), tiedWith: [] } })], /tiedWith must be a non-empty list of placings/);
    bad([season({ status: "not_held", champion: null, runnerUp: null, third: null, strippedChampion: placing(4, "D") })], /a season not_held has no placings/);
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
