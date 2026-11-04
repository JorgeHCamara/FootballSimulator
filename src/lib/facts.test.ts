import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sitemap from "../app/sitemap.ts";
import { getLeagueByCode } from "../config/leagues.ts";
import { leagueFacts } from "./leagueFacts.ts";
import { adsTxt, adsenseClient } from "./site.ts";

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

  it("lists every club page of every domestic league, in every language, with its alternates", async () => {
    const entries = await sitemap();
    const clubs = entries.filter((e) => e.url.includes("/team/"));
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
});
