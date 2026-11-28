import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inIndexWindow, leagueMatches } from "./matches.ts";
import { getLeagueData } from "./leagueData.ts";
import { allSitemapEntries as sitemap, SITEMAP_MAX_AGE_DAYS, SITEMAP_PAST_DAYS, sitemapEntries } from "./sitemapEntries.ts";
import { SITE_SITEMAP, sitemapIds } from "./sitemapIds.ts";
import { matchOutsideWindow } from "./sitemapWindow.ts";
import { LEAGUES } from "../config/leagues.ts";
import { hasClubPages } from "./clubs.ts";
import { getLeagueByCode } from "../config/leagues.ts";
import { leagueFacts } from "./leagueFacts.ts";
import { adsTxt, adsenseClient, SITE_PAGES } from "./site.ts";

const league = (code: string) => getLeagueByCode(code as Parameters<typeof getLeagueByCode>[0])!;

describe("a league's format facts", () => {
  it("a plain league: clubs, a double round robin and its places in order", () => {
    const facts = leagueFacts(league("PL"))!;
    assert.deepEqual(facts.facts, [
      { kind: "clubs", clubs: 20 },
      { kind: "roundRobin", times: 2, games: 38, perTournament: false },
    ]);
    assert.deepEqual(facts.places.map((z) => [z.kind, z.from, z.to]), [
      ["championsLeague", 1, 4],
      ["europaLeague", 5, 5],
      ["conferenceLeague", 6, 6],
      ["relegation", 18, 20],
    ]);
    assert.equal(facts.placesScope, "table");
    assert.equal(facts.continentalPlaces, true);
  });

  it("Greece: the regular season, then its groups with their own places over the whole table", () => {
    const facts = leagueFacts(league("GSL"))!;
    assert.deepEqual(facts.facts[1], { kind: "roundRobin", times: 2, games: 26, perTournament: false, firstPhase: {} });
    const split = facts.facts.find((f) => f.kind === "split");
    assert.ok(split && split.kind === "split");
    assert.equal(split.afterRound, 26);
    assert.deepEqual(split.groups.map((g) => [g.from, g.to, g.name.en, g.carryOver]), [
      [1, 4, "Championship play-offs", 1],
      [5, 8, "Europe play-offs", 0.5],
      [9, 14, "Relegation play-outs", 1],
    ]);
    // The Europe play-offs' winner is 5th overall; the play-outs' last two are 13th and 14th.
    assert.deepEqual(facts.places.map((z) => [z.kind, z.from, z.to]), [
      ["title", 1, 1],
      ["championsLeagueQualifying", 2, 2],
      ["europaLeague", 3, 3],
      ["conferenceLeague", 4, 4],
      ["conferenceLeague", 5, 5],
      ["relegation", 13, 14],
    ]);
  });

  it("Scotland: three rounds of each other, then halves that play once more", () => {
    const facts = leagueFacts(league("SPFL"))!;
    assert.deepEqual(facts.facts.slice(1), [
      { kind: "roundRobin", times: 3, games: 33, perTournament: false },
      { kind: "splitHalves", afterRound: 33, top: 6, bottom: 6 },
    ]);
  });

  it("Liga MX: two tournaments of one round each, decided by a play-off", () => {
    const facts = leagueFacts(league("MX"))!;
    assert.deepEqual(facts.facts.map((f) => f.kind), ["clubs", "roundRobin", "tournaments", "titlePlayoff"]);
    assert.deepEqual(facts.facts[3], { kind: "titlePlayoff", perTournament: true });
    assert.deepEqual(facts.facts[1], { kind: "roundRobin", times: 1, games: 17, perTournament: true });
  });

  it("Argentina: tournaments in two zones, with places from the annual table", () => {
    const facts = leagueFacts(league("ARG"))!;
    assert.ok(facts.facts.some((f) => f.kind === "tables"));
    assert.ok(facts.facts.some((f) => f.kind === "annual"));
    assert.equal(facts.placesScope, "annual");
    assert.deepEqual(facts.places, [...league("ARG").annual!.zones].sort((a, b) => a.from - b.from));
  });

  it("MLS: games without a whole round robin, places within each conference", () => {
    const facts = leagueFacts(league("MLS"))!;
    assert.deepEqual(facts.facts[1], { kind: "games", games: 34, perTournament: false });
    assert.equal(facts.continentalPlaces, false, "no note about continental places");
    assert.equal(facts.placesScope, "eachTable");
  });

  it("nothing for continental competitions", () => {
    assert.equal(leagueFacts(league("UCL")), null);
  });
});

describe("AdSense settings", () => {
  it("accepts only a real publisher id", () => {
    assert.equal(adsenseClient(undefined), undefined);
    assert.equal(adsenseClient(""), undefined);
    assert.equal(adsenseClient("pub-123"), undefined);
    assert.equal(adsenseClient(" ca-pub-1234567890123456 "), "ca-pub-1234567890123456");
  });

  it("ads.txt names Google with the publisher id", () => {
    assert.equal(adsTxt("ca-pub-1234567890123456"), "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
  });
});

describe("the sitemap", () => {
  // The club pages come from each league's data: the generated sample leagues here (no network).
  process.env.FOOTSIMU_SAMPLE_DATA = "1";
  it("lists About, Privacy and Contact in every language", async () => {
    const urls = (await sitemap()).map((e) => e.url);
    for (const locale of ["en", "pt", "es"]) for (const page of ["about", "privacy", "contact"]) assert.ok(urls.some((u) => u.endsWith(`/${locale}/${page}`)), `${locale}/${page}`);
  });

  it("lists How FootSimu works in every language, in the site's piece, with its alternates and no made-up date", async () => {
    assert.ok(SITE_PAGES.includes("how-it-works"));
    const site = (await sitemapEntries(SITE_SITEMAP))!;
    for (const locale of ["en", "pt", "es"]) {
      const entry = site.find((e) => e.url === `https://footsimu.com/${locale}/how-it-works`);
      assert.ok(entry, `${locale}/how-it-works`);
      assert.equal(entry.lastModified, undefined);
      assert.equal(entry.changeFrequency, "monthly");
      assert.deepEqual(entry.alternates!.languages, {
        en: "https://footsimu.com/en/how-it-works",
        "pt-BR": "https://footsimu.com/pt/how-it-works",
        es: "https://footsimu.com/es/how-it-works",
      });
    }
  });

  it("lists each league's past winners page in every language, as a page that changes once a season", async () => {
    const entries = await sitemap();
    for (const locale of ["en", "pt", "es"]) {
      const entry = entries.find((e) => e.url.endsWith(`/${locale}/premier-league/past-winners`));
      assert.ok(entry, `${locale}/premier-league/past-winners`);
      assert.equal(entry.changeFrequency, "monthly");
      assert.equal(entry.priority, 0.6);
    }
    assert.ok(entries.some((e) => e.url.endsWith("/en/bundesliga/past-winners")), "the Bundesliga's, from its history file");
    assert.ok(!entries.some((e) => e.url.endsWith("/en/primeira-liga/past-winners")), "no page for a league without a history file");
  });

  it("lists the daily quiz in every language", async () => {
    const entries = await sitemap();
    for (const locale of ["en", "pt", "es"]) {
      const quiz = entries.find((e) => e.url.endsWith(`/${locale}/quiz`));
      assert.ok(quiz, `${locale}/quiz`);
      assert.equal(quiz.changeFrequency, "daily");
    }
  });

  it("lists every club page of every domestic league, in every language, with its alternates", async () => {
    const entries = await sitemap();
    const clubs = entries.filter((e) => e.url.includes("/team/") && !e.url.includes("/chances/"));
    for (const code of ["PL", "BSA", "MLS", "ARG", "GSL"]) {
      const l = league(code);
      const own = clubs.filter((e) => e.url.includes(`/en/${l.slug}/team/`));
      assert.equal(own.length, l.teams, code);
    }
    assert.ok(!clubs.some((e) => e.url.includes("/champions-league/")), "no club pages for continental competitions");
    for (const locale of ["pt", "es"]) assert.equal(clubs.filter((e) => e.url.includes(`/${locale}/`)).length, clubs.length / 3);
    const first = clubs[0]!;
    assert.deepEqual(Object.keys(first.alternates!.languages!).sort(), ["en", "es", "pt-BR"]);
    assert.equal(new Set(clubs.map((e) => e.url)).size, clubs.length, "no duplicates");
  });

  it("lists the chance pages: each league's outcomes, and each club's only while still open for it", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    for (const locale of ["en", "pt", "es"]) {
      assert.ok(urls.includes(`https://footsimu.com/${locale}/premier-league/chances/title`), locale);
      assert.ok(urls.includes(`https://footsimu.com/${locale}/premier-league/chances/relegation`), locale);
      assert.ok(urls.includes(`https://footsimu.com/${locale}/championship/chances/promotion`), locale);
    }
    assert.ok(!urls.some((u) => /\/premier-league\/chances\/(promotion|playoffs)$/.test(u)), "only the outcomes a league has");
    assert.ok(!urls.some((u) => /\/champions-league\/.*chances/.test(u)), "domestic leagues only");
    const clubChances = urls.filter((u) => /\/en\/premier-league\/team\/[a-z0-9-]+\/chances\/(title|relegation)$/.test(u));
    assert.ok(clubChances.length > 0, "club chance pages");
    // Not every club's every outcome: only those still open for it in the latest snapshot.
    assert.ok(clubChances.length < 2 * league("PL").teams, `${clubChances.length} of ${2 * league("PL").teams}`);
    const entry = entries.find((e) => e.url.endsWith("/en/premier-league/chances/title"))!;
    assert.equal(entry.changeFrequency, "daily");
    assert.deepEqual(Object.keys(entry.alternates!.languages!).sort(), ["en", "es", "pt-BR"]);
    assert.equal(new Set(urls).size, urls.length, "no duplicates");
  });

  it("lists every league game from the past 6 days to the next 7, in every language", async () => {
    const entries = await sitemap();
    const games = entries.filter((e) => e.url.includes("/match/"));
    assert.ok(games.length > 0);
    const day = 86_400_000;
    for (const e of games) {
      const date = Date.parse(`${e.url.slice(-10)}T12:00:00Z`);
      // The address has the local day: up to a day either side of the window in UTC.
      assert.ok(date >= Date.now() - 7 * day && date <= Date.now() + 8 * day, e.url);
      assert.match(e.url, /\/(en|pt|es)\/[a-z0-9-]+\/match\/[a-z0-9-]+-vs-[a-z0-9-]+-\d{4}-\d{2}-\d{2}$/);
    }
    for (const locale of ["pt", "es"]) assert.equal(games.filter((e) => e.url.includes(`/${locale}/`)).length, games.length / 3);
    assert.ok(!games.some((e) => e.url.includes("/champions-league/")));
    assert.deepEqual(games.filter((e) => matchOutsideWindow(e.url)).map((e) => e.url), []);
  });

  it("works the window out from the moment it's made, not the build's: a sitemap made days later moves with it", async () => {
    const day = 86_400_000;
    for (const shift of [-12, 9, 20]) {
      const now = Date.now() + shift * day;
      const games = (await sitemap(now)).filter((e) => e.url.includes("/match/"));
      assert.ok(games.length > 0, `games ${shift} days on`);
      assert.deepEqual(games.filter((e) => matchOutsideWindow(e.url, now)).map((e) => e.url), [], `${shift} days on`);
    }
  });

  it("leaves a game out a day before its page turns noindex, so a piece served a day old lists none", async () => {
    const day = 86_400_000;
    const now = Date.now();
    assert.equal(SITEMAP_PAST_DAYS, 6);
    const games = (await sitemap(now)).filter((e) => e.url.includes("/match/"));
    const oldest = games.map((e) => Date.parse(`${e.url.slice(-10)}T12:00:00Z`)).sort((a, b) => a - b)[0]!;
    // The address has the local day: a day's leeway.
    assert.ok(oldest >= now - (SITEMAP_PAST_DAYS + 1) * day, new Date(oldest).toISOString());
    for (const e of games) assert.ok(!matchOutsideWindow(e.url, now + day), `${e.url}, a day later`);
  });

  it("lists only indexable match pages: none would say noindex now, or when the piece is SITEMAP_MAX_AGE_DAYS old", async () => {
    const day = 86_400_000;
    // Each match page's kick-off, by its address in every language.
    const kickoffs = new Map<string, string>();
    for (const l of LEAGUES.filter(hasClubPages)) {
      for (const m of leagueMatches(l, await getLeagueData(l))) for (const locale of ["en", "pt", "es"]) kickoffs.set(`https://footsimu.com/${locale}${m.path}`, m.fixture.utcDate);
    }
    for (const shift of [0, -5, 4]) {
      const now = Date.now() + shift * day;
      const entries = await sitemap(now);
      const games = entries.filter((e) => e.url.includes("/match/"));
      assert.ok(games.length > 0, `games ${shift} days on`);
      for (const locale of ["en", "pt", "es"]) assert.ok(games.some((e) => e.url.includes(`/${locale}/`)), `${locale}, ${shift} days on`);
      for (const e of games) {
        const kickoff = kickoffs.get(e.url);
        assert.ok(kickoff, `${e.url} is a league game`);
        assert.ok(inIndexWindow(kickoff, now), `${e.url} (${kickoff}) indexable when listed, ${shift} days on`);
        assert.ok(inIndexWindow(kickoff, now + SITEMAP_MAX_AGE_DAYS * day), `${e.url} (${kickoff}) still indexable when the piece is ${SITEMAP_MAX_AGE_DAYS} day old`);
      }
      // The other kinds are listed as before: clubs, chances, the hubs, the site's pages.
      for (const kind of ["/team/", "/chances/", "/odds"]) assert.ok(entries.some((e) => e.url.includes(kind)), `${kind}, ${shift} days on`);
    }
  });

  it("comes in pieces: the site's and one per league with club pages, each address in exactly one", async () => {
    const ids = sitemapIds();
    assert.deepEqual(ids, [SITE_SITEMAP, ...LEAGUES.filter(hasClubPages).map((l) => l.slug)]);
    assert.equal(await sitemapEntries("champions-league"), undefined, "no piece for a competition without club pages");
    const now = Date.now();
    const seen = new Map<string, string>();
    for (const id of ids) {
      const entries = (await sitemapEntries(id, now))!;
      assert.ok(entries.length > 0, id);
      for (const e of entries) {
        assert.ok(!seen.has(e.url), `${e.url} in ${seen.get(e.url)} and ${id}`);
        seen.set(e.url, id);
        // A league's piece holds only that league's pages.
        if (id !== SITE_SITEMAP) assert.match(e.url, new RegExp(`^https://footsimu\\.com/(en|pt|es)/${id}/`));
      }
    }
    assert.equal(seen.size, (await sitemap(now)).length);
    // The site's: the home page, the competitions, the site's own pages, the hub and the quiz.
    const site = (await sitemapEntries(SITE_SITEMAP, now))!.map((e) => e.url);
    for (const path of ["", "/premier-league", "/fa-cup", "/about", "/how-it-works", "/odds", "/quiz", "/premier-league/past-winners"]) assert.ok(site.includes(`https://footsimu.com/en${path}`), path || "/");
  });
});

describe("matchOutsideWindow", () => {
  const now = Date.parse("2026-11-25T18:00:00Z");
  it("allows the past 7 days and the next 7, with a day either side for the league's time zone", () => {
    for (const day of ["2026-11-18", "2026-11-19", "2026-11-25", "2026-12-02", "2026-12-03"]) assert.equal(matchOutsideWindow(`https://footsimu.com/en/premier-league/match/arsenal-vs-chelsea-${day}`, now), false, day);
  });
  it("flags games older or further ahead, such as a sitemap stuck at its build's window", () => {
    for (const day of ["2026-10-26", "2026-11-17", "2026-12-04", "2026-12-10"]) assert.equal(matchOutsideWindow(`https://footsimu.com/en/premier-league/match/arsenal-vs-chelsea-${day}`, now), true, day);
  });
  it("leaves other addresses alone", () => {
    assert.equal(matchOutsideWindow("https://footsimu.com/en/premier-league/team/arsenal", now), false);
  });
});
