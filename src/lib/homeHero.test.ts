import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode, type SiteLocale } from "../config/leagues.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { outcomeChance } from "./chancePages.ts";
import { leagueOutlook } from "./clubOutlook.ts";
import { withClubPages } from "./clubs.ts";
import { HISTORY } from "./history.ts";
import { CARD_ROWS, FEATURED_LEAGUE, competitionCount, featuredLeague, heroLinks, titleCard } from "./homeHero.ts";
import type { LeagueData } from "./leagueData.ts";

const load = (code: "PL" | "PD" | "BSA", file: string, season: string): LeagueData => {
  const league = getLeagueByCode(code)!;
  const snap = JSON.parse(readFileSync(new URL(`./testdata/${file}.json`, import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
  return { teams: withClubPages(league, snap.teams), fixtures: snap.fixtures, season, seasonKey: `${code}:${season.slice(0, 4)}`, seasonYear: Number(season.slice(0, 4)), source: "live" };
};
const pl = getLeagueByCode("PL")!;
const plData = load("PL", "pl-2026-27-md9", "2026/27");
const plOutlook = leagueOutlook(pl, plData, 1000)!;

const messages = (locale: SiteLocale) => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")) as { Home: Record<string, string> };

describe("home hero: the featured league", () => {
  it("one per language, each with a history to fall back on", () => {
    assert.deepEqual(FEATURED_LEAGUE, { en: "PL", pt: "BSA", es: "PD" });
    for (const locale of ["en", "pt", "es"] as const) {
      const league = featuredLeague(locale);
      assert.equal(league.code, FEATURED_LEAGUE[locale]);
      assert.ok((HISTORY.leagues[league.code as "PL" | "PD" | "BSA"]?.length ?? 0) > 0, `${league.code} in the history`);
    }
  });

  it("the trust line's count is every competition with a simulator page", () => {
    assert.ok(competitionCount() >= 40, String(competitionCount()));
  });
});

describe("home hero: the title-chances card", () => {
  it("live: the top five of the table now, in order, with the shared outlook's title chances", () => {
    const card = titleCard(pl, plData, plOutlook)!;
    assert.equal(card.kind, "live");
    assert.equal(card.league.code, "PL");
    assert.equal(card.season, "2026/27");
    assert.equal(card.rows.length, CARD_ROWS);
    assert.deepEqual(
      card.rows.map((r) => r.position),
      [1, 2, 3, 4, 5],
    );
    const byPosition = [...plOutlook.clubs.values()].sort((a, b) => a.row.position - b.row.position);
    for (const [i, row] of card.rows.entries()) {
      const club = byPosition[i]!;
      assert.equal(row.team.id, club.team.id, `row ${i + 1} is the table's`);
      assert.ok(plData.teams.some((t) => t.id === row.team.id && t.name === row.team.name), "a real club of the data");
      assert.equal(row.points, club.row.points);
      assert.equal(row.chance, outcomeChance(club, "title")!.chance, "the same number as the league's chance page");
    }
    const total = card.rows.reduce((sum, r) => sum + r.chance!, 0);
    assert.ok(total > 0.5 && total <= 1, `the top five hold most of the title: ${total}`);
  });

  it("the same for the other languages' leagues", () => {
    for (const [code, file, season] of [
      ["PD", "la-liga-2026-27", "2026/27"],
      ["BSA", "brasileirao-2026", "2026"],
    ] as const) {
      const league = getLeagueByCode(code)!;
      const data = load(code, file, season);
      const card = titleCard(league, data, leagueOutlook(league, data, 500))!;
      assert.equal(card.kind, "live");
      assert.equal(card.rows.length, CARD_ROWS);
      assert.ok(card.rows.every((r) => r.chance !== undefined && r.points > 0));
    }
  });

  it("before the first game: the simulation's favourites, likeliest first, numbered 1–5", () => {
    const preseason: LeagueData = { ...plData, fixtures: plData.fixtures.map((f) => ({ ...f, result: null })) };
    const outlook = leagueOutlook(pl, preseason, 500)!;
    const card = titleCard(pl, preseason, outlook)!;
    assert.equal(card.kind, "preseason");
    assert.equal(card.rows.length, CARD_ROWS);
    assert.deepEqual(
      card.rows.map((r) => r.position),
      [1, 2, 3, 4, 5],
    );
    const chances = card.rows.map((r) => r.chance!);
    assert.deepEqual(chances, [...chances].sort((a, b) => b - a), "likeliest first");
    assert.ok(chances[0]! > chances[4]!);
    assert.ok(card.rows.every((r) => r.points === 0));
  });

  it("once the season is over: its final top five", () => {
    const over: LeagueData = { ...plData, fixtures: plData.fixtures.map((f) => ({ ...f, result: f.result ?? { home: 1, away: 0 } })) };
    const outlook = leagueOutlook(pl, over, 200)!;
    assert.equal(outlook.complete, true);
    const card = titleCard(pl, over, outlook)!;
    assert.equal(card.kind, "final");
    assert.deepEqual(
      card.rows.map((r) => r.position),
      [1, 2, 3, 4, 5],
    );
    assert.equal(card.rows[0]!.chance, 1, "the champion");
    assert.equal(card.rows[1]!.chance, 0);
  });

  it("without an outlook: last season's final top five from the history, never an empty card", () => {
    const card = titleCard(pl, undefined, null)!;
    assert.equal(card.kind, "lastSeason");
    assert.match(card.season, /^\d{4}\/\d{2}$/);
    const last = HISTORY.leagues.PL!.reduce((best, s) => (s.year > best.year ? s : best));
    assert.equal(card.season, last.label);
    assert.equal(card.rows.length, CARD_ROWS);
    assert.deepEqual(
      card.rows.map((r) => [r.position, r.team.id, r.team.name, r.points]),
      last.table.slice(0, CARD_ROWS).map(([id, name, points], i) => [i + 1, id, name, points]),
    );
    assert.ok(card.rows.every((r) => r.chance === undefined && r.team.tla.length > 0));
    // With the data but no outlook: the clubs' own badges, from the data.
    const withData = titleCard(pl, plData, null)!;
    assert.equal(withData.kind, "lastSeason");
    const arsenal = withData.rows.find((r) => r.team.id === 359)!;
    assert.equal(arsenal.team, plData.teams.find((t) => t.id === 359));
    // Brazil's calendar-year season label.
    assert.match(titleCard(getLeagueByCode("BSA")!, undefined, null)!.season, /^\d{4}$/);
    // A league without a history and nothing loaded: no card (the hero then shows the league alone).
    assert.equal(titleCard(getLeagueByCode("MLS")!, undefined, null), undefined);
  });
});

describe("home hero: the buttons and the words", () => {
  it("the featured league's simulator first; My World only while it is listed, as in the menus", () => {
    const listed = heroLinks(pl, true);
    assert.deepEqual(
      listed.map((l) => [l.kind, l.href, l.icon, l.testId]),
      [
        ["primary", "/premier-league", "chevron-right", "hero-simulate"],
        ["secondary", "/my-world", "globe", "hero-my-world"],
      ],
    );
    const unlisted = heroLinks(pl, false);
    assert.deepEqual(
      unlisted.map((l) => l.href),
      ["/premier-league"],
    );
    assert.ok(!unlisted.some((l) => l.href === "/my-world" || l.testId === "hero-my-world"), "no My World button when unlisted");
    assert.equal(heroLinks(getLeagueByCode("BSA")!, false)[0]!.href, "/brasileirao");
  });

  it("one headline per language, with the badge, the buttons and the trust line", () => {
    const expected: Record<SiteLocale, Record<string, string>> = {
      en: { badge: "Free football simulator", headline: "The football simulator for every season", simulateFeatured: "Simulate the Premier League", startMyWorld: "Start My World", trustFree: "Free", trustNoSignup: "No sign-up", titleChances: "Title chances", simulating: "Simulating…" },
      pt: { badge: "Simulador de futebol grátis", headline: "O simulador de futebol para todas as temporadas", simulateFeatured: "Simular o Brasileirão", startMyWorld: "Começar Meu Mundo", trustFree: "Grátis", trustNoSignup: "Sem cadastro", titleChances: "Chances de título", simulating: "Simulando…" },
      es: { badge: "Simulador de fútbol gratis", headline: "El simulador de fútbol para todas las temporadas", simulateFeatured: "Simular LaLiga", startMyWorld: "Empezar Mi Mundo", trustFree: "Gratis", trustNoSignup: "Sin registro", titleChances: "Probabilidades de título", simulating: "Simulando…" },
    };
    for (const locale of ["en", "pt", "es"] as const) {
      const home = messages(locale).Home;
      for (const [key, value] of Object.entries(expected[locale])) assert.equal(home[key], value, `${locale}.Home.${key}`);
      assert.match(home.trustCompetitions!, /^\{count\} /);
      assert.match(home.finalTable!, /\{season\}/);
      assert.equal(home.points, "{count} pts");
      assert.ok(home.subheading!.length > 40, "the subtitle stays");
    }
  });
});
