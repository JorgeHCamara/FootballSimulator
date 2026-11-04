import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { zoneHex, ZONE_STYLES } from "../components/zones.ts";
import { getLeagueByCode, LEAGUES, type ZoneKind } from "../config/leagues.ts";
import { realResults } from "../engine/results.ts";
import type { Fixture, ResultMap, Team } from "../engine/types.ts";
import { leagueFacts } from "./leagueFacts.ts";
import { cardRows, legendKinds, scenarioOutcome, SCENARIO_ITERATIONS } from "./scenario.ts";
import { decodeResults, encodeResults, encodeResultsV1 } from "./shareCodec.ts";
import { shareCardSupported, shareFixtureList } from "./splitSetup.ts";

const load = (file: string) => JSON.parse(readFileSync(new URL(`./testdata/${file}.json`, import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const pl = load("pl-2026-27-md9");
const bsa = load("brasileirao-2026");

/** A prediction for every game still to play: home wins by one, some big scores. */
function predictRest(fixtures: readonly Fixture[]): ResultMap {
  return Object.fromEntries(fixtures.filter((f) => !f.result).map((f, i) => [f.id, i % 17 === 0 ? { home: 7, away: 3 } : { home: (i % 3) + 1, away: i % 3 }]));
}

describe("share codes", () => {
  const list = shareFixtureList(getLeagueByCode("PL")!, pl.fixtures, pl.teams, undefined);
  const rest = predictRest(pl.fixtures);

  it("round-trips a whole rest of season, big scores and overridden real results included", () => {
    const played = pl.fixtures.find((f) => f.result)!;
    const predictions = { ...rest, [played.id]: { home: 0, away: 12 } };
    assert.deepEqual(decodeResults(list, encodeResults(list, predictions)), predictions);
    assert.deepEqual(decodeResults(list, encodeResults(list, {})), {});
  });

  it("stays short enough to share: a rest-of-season Premier League prediction in under 400 characters", () => {
    const code = encodeResults(list, rest);
    assert.ok(code.length < 400, `${code.length} characters for ${Object.keys(rest).length} games`);
    assert.match(code, /^[A-Za-z0-9_-]+$/, "URL-safe");
    // The older format took 4 bytes a game.
    assert.ok(encodeResultsV1(list, rest).length > code.length * 3);
  });

  it("still opens older links, and refuses codes for another fixture list or broken ones", () => {
    assert.deepEqual(decodeResults(list, encodeResultsV1(list, rest)), rest);
    assert.equal(decodeResults(list.slice(1), encodeResults(list, rest)), null, "another season's fixtures");
    assert.equal(decodeResults(list, encodeResults(list, rest).slice(0, -6)), null, "truncated");
    assert.equal(decodeResults(list, "AgAA!"), null);
  });
});

describe("the share card's scenario", () => {
  const league = getLeagueByCode("PL")!;
  const outcome = scenarioOutcome(league, { ...pl, seasonYear: 2026 }, predictRest(pl.fixtures), 1000)!;

  it("a full prediction is a final table: every club 38 games, the leader champion", () => {
    assert.equal(outcome.complete, true);
    assert.ok(outcome.rows.every((r) => r.played === 38));
    assert.equal(outcome.headline.teamId, outcome.rows[0]!.teamId);
    assert.ok(["champion", "relegated"].includes(outcome.headline.kind));
  });

  it("zones and legend come from the league's own config", () => {
    const places = leagueFacts(league)!.places;
    for (const row of outcome.rows.slice(1)) {
      const zone = places.find((z) => row.position >= z.from && row.position <= z.to);
      assert.equal(row.zone?.kind, zone?.kind, `place ${row.position}`);
    }
    assert.equal(outcome.rows[0]!.zone?.kind, "title", "the champion is highlighted");
    assert.deepEqual(legendKinds(outcome.places, true), ["title", "championsLeague", "europaLeague", "conferenceLeague", "relegation"]);
    // The Brasileirão: its own continental places.
    const brazil = scenarioOutcome(getLeagueByCode("BSA")!, { ...bsa, seasonYear: 2026 }, {}, 500)!;
    assert.deepEqual(legendKinds(brazil.places, true), ["title", "libertadores", "libertadoresQualifying", "sudamericana", "relegation"]);
  });

  it("an open prediction: chances from the simulations, title chances adding up to 100%", () => {
    const open = scenarioOutcome(league, { ...pl, seasonYear: 2026 }, {}, 2000)!;
    assert.equal(open.complete, false);
    assert.equal(open.iterations, 2000);
    // Arsenal (top on 24 points) are the favourites, with their title chance.
    assert.equal(pl.teams.find((t) => t.id === open.headline.teamId)?.name, "Arsenal");
    assert.ok(open.headline.chance > 0.5 && open.headline.chance < 0.8, String(open.headline.chance));
    const fixed = realResults(pl.fixtures);
    assert.ok(Object.keys(fixed).length === 90);
    for (const row of open.rows) if (row.chance !== undefined) assert.ok(row.chance >= 0 && row.chance <= 1);
    assert.equal(SCENARIO_ITERATIONS, 10_000);
  });

  it("Greece: the play-off groups' places over the whole table", () => {
    const gsl = getLeagueByCode("GSL")!;
    assert.deepEqual(legendKinds(leagueFacts(gsl)!.places, true), ["title", "championsLeagueQualifying", "europaLeague", "conferenceLeague", "relegation"]);
  });

  it("which leagues get a card: one table per season", () => {
    const supported = LEAGUES.filter(shareCardSupported).map((l) => l.code);
    for (const code of ["PL", "BSA", "GSL", "ABL", "SPFL", "MX", "ELC"]) assert.ok(supported.includes(code as never), code);
    for (const code of ["MLS", "ARG", "UCL", "LIB"]) assert.ok(!supported.includes(code as never), code);
  });
});

describe("the share card's table", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ position: i + 1, teamId: i + 1, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: [] }));

  it("top six, a gap and the bottom three; the whole table for 12 clubs or fewer", () => {
    const big = cardRows(rows(20));
    assert.equal(big.length, 10);
    assert.equal(big[6], "gap");
    assert.deepEqual(big.filter((r) => r !== "gap").map((r) => (r as { position: number }).position), [1, 2, 3, 4, 5, 6, 18, 19, 20]);
    assert.equal(cardRows(rows(12)).length, 12);
  });

  it("every zone has a colour, the same as the site's", () => {
    for (const kind of Object.keys(ZONE_STYLES) as ZoneKind[]) assert.match(zoneHex(kind), /^#[0-9a-f]{6}$/, kind);
    assert.equal(zoneHex("relegation"), "#dc2626");
  });
});
