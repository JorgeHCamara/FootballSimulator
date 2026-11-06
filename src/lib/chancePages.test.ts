import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createTranslator } from "next-intl";
import { getLeagueByCode, type SiteLocale } from "../config/leagues.ts";
import type { Fixture, Team } from "../engine/types.ts";
import {
  OPEN_MAX,
  OPEN_MIN,
  clubChancePath,
  isOpen,
  isOutcome,
  leagueChancePath,
  leagueOutcomes,
  outcomeChance,
  outcomeRace,
  raceAround,
  snapshotOpen,
  snapshotOutcomeKey,
  snapshotOutcomes,
} from "./chancePages.ts";
import { clubChanceText, leagueChanceText, outcomeKey, type ChanceTranslators } from "./chanceText.ts";
import { leagueOutlook, type ClubOutlook } from "./clubOutlook.ts";
import type { LoadedClub, LoadedLeague } from "./clubPage.ts";
import { withClubPages } from "./clubs.ts";
import { percent } from "./clubText.ts";
import type { LeagueData } from "./leagueData.ts";
import { snapshotAfter } from "./snapshots.ts";

const pl = getLeagueByCode("PL")!;
const snap = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const data: LeagueData = { teams: withClubPages(pl, snap.teams), fixtures: snap.fixtures, season: "2026/27", seasonKey: "PL:2026", seasonYear: 2026, source: "live" };
const outlook = leagueOutlook(pl, data, 2000)!;
const loaded: LoadedLeague = { league: pl, data, outlook, season: "2026/27" };
const clubOf = (id: number): LoadedClub => ({ ...loaded, club: outlook.clubs.get(id)!, team: data.teams.find((t) => t.id === id)! });
const names = (id: number) => data.teams.find((t) => t.id === id)?.shortName ?? "";

const messages = (locale: SiteLocale) => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));
const translators = (locale: SiteLocale): ChanceTranslators => {
  const m = messages(locale);
  return {
    t: createTranslator({ locale, messages: m, namespace: "Chances" }) as never,
    tc: createTranslator({ locale, messages: m, namespace: "Club" }) as never,
    tz: createTranslator({ locale, messages: m, namespace: "Zones" }) as never,
  };
};

describe("chance page routes", () => {
  it("one address per league and outcome, and per club and outcome", () => {
    assert.equal(leagueChancePath(pl, "title"), "/premier-league/chances/title");
    assert.equal(clubChancePath("/premier-league/team/arsenal", "relegation"), "/premier-league/team/arsenal/chances/relegation");
    for (const o of ["title", "promotion", "playoffs", "relegation"]) assert.ok(isOutcome(o));
    for (const o of ["europe", "Title", "", "champions-league"]) assert.ok(!isOutcome(o), o);
  });

  it("only the outcomes a league has: the Premier League's title and relegation", () => {
    assert.deepEqual(leagueOutcomes(outlook), ["title", "relegation"]);
  });

  it("a club's chance of an outcome is its headline chance; the title as a play-off is winning it", () => {
    const club = [...outlook.clubs.values()][0]!;
    assert.equal(outcomeChance(club, "title"), club.headline.find((h) => h.kind === "title"));
    assert.equal(outcomeChance(club, "promotion"), undefined);
    const mls = { headline: [{ kind: "playoffs", zone: "playoffs", chance: 0.8 }, { kind: "playoffWin", zone: "playoffs", chance: 0.12, name: "MLS Cup" }] } as Pick<ClubOutlook, "headline">;
    assert.equal(outcomeChance(mls, "title")!.chance, 0.12);
    assert.deepEqual(outcomeKey("title", outcomeChance(mls, "title")), { key: "titlePlayoff", name: "MLS Cup" });
    assert.equal(outcomeChance(mls, "playoffs")!.chance, 0.8);
    assert.deepEqual(outcomeKey("relegation", undefined), { key: "relegation", name: "" });
  });

  it("the race: likeliest first, ties to the higher place; a club's page shows the top eight and the club", () => {
    for (const o of ["title", "relegation"] as const) {
      const race = outcomeRace(outlook, o);
      assert.equal(race.length, 20);
      for (let i = 1; i < race.length; i++) assert.ok(race[i - 1]!.chance > race[i]!.chance || (race[i - 1]!.chance === race[i]!.chance && race[i - 1]!.position < race[i]!.position));
    }
    const race = outcomeRace(outlook, "title");
    const last = race.at(-1)!;
    assert.deepEqual(raceAround(race, last.teamId).map((r) => r.teamId), [...race.slice(0, 8), last].map((r) => r.teamId));
    assert.deepEqual(raceAround(race, race[2]!.teamId), race.slice(0, 8), "already in the top eight");
  });

  it("open: shown as 1% to 99%", () => {
    assert.equal(OPEN_MIN, 0.01);
    assert.equal(OPEN_MAX, 0.99);
    for (const c of [0.01, 0.5, 0.99]) assert.ok(isOpen(c), String(c));
    for (const c of [0, 0.004, 0.995, 1]) assert.ok(!isOpen(c), String(c));
  });

  it("the snapshot has the same outcomes as the live outlook, and tells which are open for each club", () => {
    const round = 9;
    const kickoff = data.fixtures.filter((f) => f.result).map((f) => f.utcDate).sort().at(-1)!;
    const snapshot = snapshotAfter(pl, data, round, kickoff, new Date("2026-11-05T12:00:00Z"), 2000)!;
    assert.deepEqual(snapshotOutcomes(pl, snapshot), leagueOutcomes(outlook));
    assert.deepEqual(snapshotOutcomeKey(pl, snapshot, "title"), { key: "title", name: "" });
    for (const [id, team] of Object.entries(snapshot.teams)) for (const o of ["title", "relegation"] as const) assert.equal(snapshotOpen(o, team.chances), isOpen(team.chances[o] ?? 0), `${id} ${o}`);
    // A second division: promotion is open while the automatic places or the play-off are in reach.
    assert.equal(snapshotOpen("promotion", { promotion: 0, promotionPlayoff: 0.2 }), true);
    assert.equal(snapshotOpen("promotion", { promotion: 0.995, promotionPlayoff: 0.005 }), false);
    assert.equal(snapshotOpen("promotion", { promotion: 0.002, promotionPlayoff: 0.004 }), false);
    // MLS: no title in the table; the MLS Cup is open while the play-offs are in reach.
    const mls = getLeagueByCode("MLS")!;
    const mlsSnapshot = { teams: { "1": { position: 1, points: 0, played: 0, expectedPosition: 1, averagePoints: 0, chances: { playoffs: 0.9, playoffWildCard: 0.05 } } } } as never;
    assert.deepEqual(snapshotOutcomes(mls, mlsSnapshot), ["title", "playoffs"]);
    assert.deepEqual(snapshotOutcomeKey(mls, mlsSnapshot, "title"), { key: "titlePlayoff", name: mls.playoff!.title });
    assert.equal(snapshotOpen("title", { playoffs: 0.3 }), true);
    assert.equal(snapshotOpen("title", { playoffs: 0 }), false);
  });
});

describe("chance page text", () => {
  it("a league's page: the heading for the search, the leader and the next two, every club with a chance", () => {
    const text = leagueChanceText(loaded, "title", "en", names, translators("en"));
    assert.equal(text.h1, "Premier League 2026/27 title odds");
    assert.equal(text.title, "Premier League 2026/27 title odds: every club's chances");
    const [leader, second, third] = outcomeRace(outlook, "title");
    assert.equal(text.lead, `${names(leader!.teamId)} win the title in ${percent(leader!.chance, "en")} of 2,000 simulated seasons. Next: ${names(second!.teamId)} (${percent(second!.chance, "en")}) and ${names(third!.teamId)} (${percent(third!.chance, "en")}).`);
    assert.ok(text.rows.every((r) => r.chance > 0));
    assert.equal(text.rows.length + text.rest, 20);
    assert.equal(text.tableTitle, "Every club's title chances");
    assert.match(text.description, /^Who will win the Premier League 2026\/27\? .+ Every club's title chances, updated after the results\.$/);
    // The FAQ: the question itself, how, how often, not betting odds.
    assert.deepEqual(
      text.faq.map((f) => f.q),
      ["Who will win the Premier League 2026/27?", "How are these chances worked out?", "How often are they updated?", "Are these bookmakers' odds?"],
    );
    assert.equal(text.faq[0]!.a, text.lead);
    assert.match(text.faq[1]!.a, /plays out the rest of the Premier League season 2,000 times.+in which it wins the title\.$/);
    for (const f of text.faq) assert.doesNotMatch(`${f.q} ${f.a}`, /\{|\}/, "every placeholder filled");
  });

  it("relegation, and Portuguese and Spanish", () => {
    const en = leagueChanceText(loaded, "relegation", "en", names, translators("en"));
    assert.equal(en.h1, "Premier League 2026/27 relegation odds");
    assert.match(en.lead, / go down in \d+% of 2,000 simulated seasons\./);
    assert.equal(en.faq[0]!.q, "Who will be relegated from the Premier League 2026/27?");
    const pt = leagueChanceText(loaded, "title", "pt", names, translators("pt"));
    assert.equal(pt.h1, "Premier League 2026/27: chances de título");
    assert.match(pt.lead, /^Em 2\.000 temporadas simuladas, .+ é campeão em \d+%\./);
    assert.equal(pt.faq[0]!.q, "Premier League 2026/27: quem vai ser campeão?");
    const es = leagueChanceText(loaded, "relegation", "es", names, translators("es"));
    assert.equal(es.h1, "Premier League 2026/27: probabilidades de descenso");
    assert.equal(es.faq[0]!.q, "Premier League 2026/27: ¿quién descenderá?");
    for (const text of [en, pt, es]) for (const f of text.faq) assert.doesNotMatch(`${f.q} ${f.a}`, /\{|\}/);
  });

  it("a club's page: its chance, where it stands, its likely finish; for search engines only while the question is open", () => {
    const bottom = outcomeRace(outlook, "relegation")[0]!;
    const club = clubOf(bottom.teamId);
    const text = clubChanceText(club, "relegation", "en", translators("en"))!;
    const name = club.team.name;
    assert.equal(text.h1, `${name}'s relegation chances: Premier League 2026/27`);
    assert.equal(text.label, "Relegation chance");
    assert.equal(text.pct, percent(bottom.chance, "en"));
    assert.equal(text.lead.length, 3);
    assert.match(text.lead[0]!, new RegExp(`^${name} are \\d+(st|nd|rd|th) in the Premier League table with \\d+ points from \\d+ games\\.$`));
    assert.equal(text.indexable, isOpen(bottom.chance));
    assert.deepEqual(text.faq.map((f) => f.q), [`Will ${name} be relegated?`, `Where will ${name} finish?`, "How are these chances worked out?", "How often are they updated?", "Are these bookmakers' odds?"]);
    assert.match(text.description, new RegExp(`^Relegation chance: ${text.pct}\\. ${name} in the Premier League 2026/27, from 2,000 simulated seasons`));
    // The leader's relegation: 0%, settled, kept out of search results.
    const top = outcomeRace(outlook, "title")[0]!;
    const safe = clubChanceText(clubOf(top.teamId), "relegation", "en", translators("en"))!;
    assert.equal(safe.pct, "0%");
    assert.equal(safe.indexable, false);
    // An outcome the league doesn't have: no page.
    assert.equal(clubChanceText(clubOf(top.teamId), "promotion", "en", translators("en")), undefined);
    // In Portuguese and Spanish.
    assert.equal(clubChanceText(clubOf(top.teamId), "title", "pt", translators("pt"))!.h1, `${clubOf(top.teamId).team.name}: chances de título em Premier League 2026/27`);
    assert.equal(clubChanceText(clubOf(top.teamId), "title", "es", translators("es"))!.faq[0]!.q, `¿Qué probabilidades de título tiene ${clubOf(top.teamId).team.name}?`);
  });
});
