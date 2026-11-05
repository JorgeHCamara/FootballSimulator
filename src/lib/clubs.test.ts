import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createTranslator } from "next-intl";
import { getLeagueByCode } from "../config/leagues.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { cachedLeagueOutlook, featuredChances, headlineChances, leagueOutlook, mustWinGames, toughestGames, type ClubOutlook, type ZoneChance } from "./clubOutlook.ts";
import { clubCardChances, clubDescription, clubHeading, type LoadedClub } from "./clubPage.ts";
import { slugify, withClubPages } from "./clubs.ts";
import { ordinal, percent, placeRange } from "./clubText.ts";
import type { LeagueData } from "./leagueData.ts";
import { scenarioOutcome } from "./scenario.ts";

const pl = getLeagueByCode("PL")!;
const snap = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const data: LeagueData = { teams: withClubPages(pl, snap.teams), fixtures: snap.fixtures, season: "2026/27", seasonKey: "PL:2026", seasonYear: 2026, source: "live" };
const outlook = leagueOutlook(pl, data, 2000)!;

describe("club slugs", () => {
  it("lowercase, accent-free, hyphenated, without a trailing FC", () => {
    const cases: [string, string][] = [
      ["São Paulo", "sao-paulo"],
      ["Atlético Madrid", "atletico-madrid"],
      ["Arsenal FC", "arsenal"],
      ["Arsenal", "arsenal"],
      ["Bayern München", "bayern-munchen"],
      ["1. FC Köln", "1-fc-koln"],
      ["Brighton & Hove Albion", "brighton-and-hove-albion"],
      ["Athletico-PR", "athletico-pr"],
      ["Bodø/Glimt", "bodo-glimt"],
      ["Grêmio", "gremio"],
      ["Deportivo Alavés", "deportivo-alaves"],
    ];
    for (const [name, slug] of cases) assert.equal(slugify(name), slug, name);
  });

  it("unique within a league, the same whatever order the feed lists the clubs, and none for continental competitions", () => {
    const teams: Team[] = [
      { id: 5, name: "Nacional", shortName: "Nacional", tla: "NAC" },
      { id: 2, name: "Nacional", shortName: "Nacional", tla: "NAC" },
      { id: 9, name: "Peñarol", shortName: "Peñarol", tla: "PEN" },
    ];
    const a = withClubPages(pl, teams);
    const b = withClubPages(pl, [...teams].reverse());
    assert.deepEqual(a.map((t) => [t.id, t.slug]).sort(), b.map((t) => [t.id, t.slug]).sort());
    assert.deepEqual(a.map((t) => t.slug), ["nacional-5", "nacional-2", "penarol"]);
    assert.equal(a[2]!.page, "/premier-league/team/penarol");
    assert.equal(withClubPages(getLeagueByCode("UCL")!, teams)[0]!.page, undefined);
    assert.equal(new Set(data.teams.map((t) => t.slug)).size, data.teams.length);
  });
});

describe("a club's outlook", () => {
  it("every club: places adding up to 1, zones from the league's config, the title first", () => {
    assert.equal(outlook.clubs.size, 20);
    for (const club of outlook.clubs.values()) {
      assert.equal(club.distribution.length, 20);
      assert.ok(Math.abs(club.distribution.reduce((a, b) => a + b, 0) - 1) < 1e-9, club.team.name);
      assert.deepEqual(club.zones.map((z) => z.kind), ["title", "championsLeague", "europaLeague", "conferenceLeague", "relegation"]);
      assert.deepEqual(club.headline.map((h) => `${h.kind}:${h.zone}`), ["title:title", "continental:championsLeague", "relegation:relegation"]);
      assert.equal(club.likeliest.chance, Math.max(...club.distribution));
      assert.equal(club.distribution[club.likeliest.position - 1], club.likeliest.chance);
    }
    // All clubs' title chances add up to 1, and so do 20 places of each kind.
    const sum = (kind: string) => [...outlook.clubs.values()].reduce((s, c) => s + c.zones.find((z) => z.kind === kind)!.chance, 0);
    assert.ok(Math.abs(sum("title") - 1) < 1e-9);
    assert.ok(Math.abs(sum("championsLeague") - 4) < 1e-9);
    assert.ok(Math.abs(sum("relegation") - 3) < 1e-9);
  });

  it("the same chances as the share card's (same Monte Carlo, same seed)", () => {
    const full = leagueOutlook(pl, data)!;
    const scenario = scenarioOutcome(pl, data, {})!;
    const favourite = full.clubs.get(scenario.headline.teamId)!;
    assert.equal(favourite.headline[0]!.chance, scenario.headline.chance);
  });

  it("remaining games: the club's own, soonest first, chances adding up to 1", () => {
    for (const club of outlook.clubs.values()) {
      const own = snap.fixtures.filter((f) => !f.result && (f.homeId === club.team.id || f.awayId === club.team.id));
      assert.equal(club.fixtures.length, own.length);
      for (let i = 1; i < club.fixtures.length; i++) assert.ok(club.fixtures[i - 1]!.fixture.utcDate <= club.fixtures[i]!.fixture.utcDate);
      for (const f of club.fixtures) {
        assert.ok(Math.abs(f.win + f.draw + f.loss - 1) < 1e-9);
        assert.equal(f.home, f.fixture.homeId === club.team.id);
      }
    }
  });

  it("toughest: the three lowest win chances; must-win: rivals within three places, not already the toughest", () => {
    const club = outlook.clubs.get(outlook.order[9]!)!;
    const toughest = toughestGames(club.fixtures);
    assert.equal(toughest.length, 3);
    const lowest = [...club.fixtures].map((f) => f.win).sort((a, b) => a - b).slice(0, 3);
    assert.deepEqual(toughest.map((f) => f.win), lowest);
    const mustWin = mustWinGames(club.fixtures, club.row.position, toughest);
    assert.ok(mustWin.length > 0 && mustWin.length <= 3);
    for (const f of mustWin) {
      assert.ok(Math.abs(f.opponentPosition - club.row.position) <= 3);
      assert.ok(!toughest.includes(f));
    }
  });

  it("a continental place with its qualifying round counts as one, from the top when only the title is above it", () => {
    const zones = [
      { kind: "title" as const, ranges: [[1, 1]] as [number, number][], chance: 0.5 },
      { kind: "championsLeagueQualifying" as const, ranges: [[2, 2]] as [number, number][], chance: 0.2 },
      { kind: "europaLeague" as const, ranges: [[3, 3]] as [number, number][], chance: 0.1 },
    ];
    const asked: [number, number][] = [];
    const headline = headlineChances(zones, (from, to) => (asked.push([from, to]), 0.7));
    assert.deepEqual(headline.map((h) => `${h.kind}:${h.zone}:${h.chance}`), ["title:title:0.5", "continental:championsLeague:0.7"]);
    assert.deepEqual(asked, [[1, 2]]);
  });

  describe("the chances a club's card shows", () => {
    const zone = (kind: ZoneChance["kind"], from: number, to: number, chance: number): ZoneChance => ({ kind, ranges: [[from, to]], chance });
    /** A club with these places, and its headline from them (its place ranges' chances as given). */
    const clubWith = (zones: ZoneChance[]): Pick<ClubOutlook, "headline" | "zones"> => ({
      zones,
      headline: headlineChances(zones, (from, to) => zones.filter((z) => z.ranges.some(([a, b]) => a >= from && b <= to)).reduce((sum, z) => sum + z.chance, 0)),
    });
    const shown = (club: Pick<ClubOutlook, "headline" | "zones">) => featuredChances(club).map((c) => `${c.zone} ${Math.round(c.chance * 100)}`);
    const serieB = (title: number, promotion: number, playoff: number, relegation: number) =>
      clubWith([zone("title", 1, 1, title), zone("promotion", 1, 2, promotion), zone("promotionPlayoff", 3, 6, playoff), zone("relegation", 17, 20, relegation)]);

    it("a 0% gives way to a place the club has a chance of (Série B: no promotion, but the play-off)", () => {
      // Sport: title, promotion and relegation all 0%, the promotion play-off 23%: the title goes, the play-off shows.
      assert.deepEqual(shown(serieB(0, 0, 0.23, 0)), ["promotion 0", "promotionPlayoff 23", "relegation 0"]);
      // Two 0%s: both other places show, in table order.
      assert.deepEqual(shown(serieB(0, 0.05, 0.4, 0)), ["promotion 5", "promotionPlayoff 40", "relegation 0"]);
    });

    it("headline chances above 0% keep their places; at most three, in table order", () => {
      assert.deepEqual(shown(serieB(0.02, 0.1, 0.5, 0.01)), ["title 2", "promotion 10", "relegation 1"]);
      assert.equal(featuredChances(serieB(0.1, 0.2, 0.3, 0.4), 3).length, 3);
      // A top-flight leader: no chance of going down, a real one of the Europa League instead.
      const leader = clubWith([zone("title", 1, 1, 0.3), zone("championsLeague", 1, 4, 0.6), zone("europaLeague", 5, 5, 0.2), zone("conferenceLeague", 6, 6, 0.1), zone("relegation", 18, 20, 0)]);
      assert.deepEqual(shown(leader), ["title 30", "championsLeague 90", "europaLeague 20"]);
    });

    it("only a real chance (1% or more) replaces a 0%, and a continental place isn't shown twice", () => {
      const safe = clubWith([zone("title", 1, 1, 0.5), zone("championsLeague", 1, 4, 0.45), zone("championsLeagueQualifying", 5, 5, 0.03), zone("europaLeague", 6, 6, 0.004), zone("relegation", 18, 20, 0)]);
      assert.deepEqual(shown(safe), ["title 50", "championsLeague 98", "relegation 0"]);
      // Every headline chance at 0% and nothing else: the 0%s, as before.
      assert.deepEqual(shown(serieB(0, 0, 0, 0)), ["title 0", "promotion 0", "relegation 0"]);
    });

    it("named as on the card, in the link preview too", () => {
      const messages = JSON.parse(readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8"));
      const t = createTranslator({ locale: "en", messages, namespace: "Club" }) as never;
      const tz = createTranslator({ locale: "en", messages, namespace: "Zones" }) as never;
      const club = serieB(0, 0, 0.23, 0) as ClubOutlook;
      assert.deepEqual(
        clubCardChances({ club }, "en", t, tz).map((c) => `${c.label} ${c.value}`),
        ["Promotion 0%", "Promotion play-off 23%", "Relegation 0%"],
      );
    });
  });

  it("one Monte Carlo per league and data version", () => {
    const a = cachedLeagueOutlook(pl, data);
    assert.equal(cachedLeagueOutlook(pl, { ...data }), a);
    const played = snap.fixtures.find((f) => !f.result)!;
    const next = { ...data, fixtures: data.fixtures.map((f) => (f.id === played.id ? { ...f, result: { home: 1, away: 0 } } : f)) };
    assert.notEqual(cachedLeagueOutlook(pl, next), a);
  });
});

describe("a club page's text", () => {
  it("ordinals, place ranges and percentages", () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map((n) => ordinal(n, "en")), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
    assert.equal(ordinal(3, "pt"), "3º");
    assert.equal(ordinal(3, "es"), "3.º");
    assert.equal(placeRange(1, 4, "en"), "1st–4th");
    assert.equal(placeRange(5, 5, "en"), "5th");
    assert.equal(percent(0.001, "en"), "<1%");
    assert.equal(percent(0, "en"), "0%");
    assert.equal(percent(0.999, "en"), ">99%");
    assert.equal(percent(1, "en"), "100%");
    assert.equal(percent(0.64, "pt"), "64%");
  });

  it("a heading and description per language, naming the league's own places", () => {
    const team = data.teams.find((t) => t.id === outlook.order[0])!;
    const loaded: LoadedClub = { league: pl, data, outlook, club: outlook.clubs.get(team.id)!, team, season: data.season };
    const seen = new Set<string>();
    for (const locale of ["en", "pt", "es"] as const) {
      const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));
      const t = createTranslator({ locale, messages, namespace: "Club" }) as never;
      const tz = createTranslator({ locale, messages, namespace: "Zones" }) as never;
      const heading = clubHeading(loaded, locale, t, tz);
      const description = clubDescription(loaded, locale, t, tz);
      assert.ok(heading.startsWith(`${team.name} 2026/27: `), heading);
      assert.ok(heading.includes("Champions League"), heading);
      assert.ok(description.includes(team.name) && description.includes("%"), description);
      seen.add(heading);
    }
    assert.equal(seen.size, 3);
    const messages = JSON.parse(readFileSync(new URL("../../messages/en.json", import.meta.url), "utf8"));
    assert.equal(
      clubHeading(loaded, "en", createTranslator({ locale: "en", messages, namespace: "Club" }) as never, createTranslator({ locale: "en", messages, namespace: "Zones" }) as never),
      `${team.name} 2026/27: title, Champions League and relegation chances`,
    );
  });
});
