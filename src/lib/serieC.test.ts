import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getLeagueByCode, getLeagueBySlug } from "../config/leagues.ts";
import { stagedClassification } from "../engine/classification.ts";
import { buildBracket, seedByGroupPlace, tieOutcome } from "../engine/playoffs.ts";
import { effectiveResults, realResults } from "../engine/results.ts";
import { buildSplitPhase, groupOfRound, splitGroupTable } from "../engine/split.ts";
import { computeStandings } from "../engine/standings.ts";
import type { ResultMap } from "../engine/types.ts";
import { leagueOutlook } from "./clubOutlook.ts";
import { firstPartyData, firstPartySeason } from "./firstParty.ts";
import { getLeagueData } from "./leagueData.ts";
import { leagueFacts } from "./leagueFacts.ts";
import { scenarioOutcome } from "./scenario.ts";
import { shareFixtureList } from "./splitSetup.ts";

// Brasileirão Série C 2026: the site's own data (src/data/serie-c/2026.json,
// imported once from the CBF), checked against the CBF's official tables and
// the season's known outcome.

const league = getLeagueByCode("BSC")!;
const season = firstPartySeason(league)!;
const data = firstPartyData(league);
const ROOT = join(import.meta.dirname, "../..");
const id = (name: string) => data.teams.find((t) => t.name === name)!.id;
const names = (ids: readonly number[]) => ids.map((x) => data.teams.find((t) => t.id === x)!.name);
const baseOptions = { tiebreakers: league.tiebreakers, fallbackOrder: data.fallbackOrder! };
const groupOptions = { tiebreakers: league.split!.groupTiebreakers! };
const phaseOf = (results: ResultMap) =>
  buildSplitPhase({ teams: data.teams, fixtures: data.fixtures, results, groups: league.split!.groups, afterRound: 19, options: baseOptions });
const tuple = (r: { position: number; points: number; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number }, club: number) => [
  r.position,
  club,
  r.points,
  r.played,
  r.won,
  r.drawn,
  r.lost,
  r.goalsFor,
  r.goalsAgainst,
];

describe("Série C 2026 (first-party data)", () => {
  it("is registered as a first-party league with no feed", () => {
    assert.equal(getLeagueBySlug("brasileirao-serie-c"), league);
    assert.equal(league.espn, undefined);
    assert.deepEqual(league.firstParty, { season: 2026 });
    assert.equal(data.provider, "first-party");
    assert.equal(data.seasonKey, "BSC:2026");
  });

  it("has every club with its official name and its own local crest", () => {
    assert.equal(data.teams.length, 20);
    assert.deepEqual(
      [...names(data.teams.map((t) => t.id))].sort((a, b) => a.localeCompare(b, "pt")),
      ["Amazonas", "Anápolis", "Barra", "Botafogo-PB", "Brusque", "Caxias", "Confiança", "Ferroviária", "Figueirense", "Floresta", "Guarani", "Inter de Limeira", "Itabaiana", "Ituano", "Maranhão", "Maringá", "Paysandu", "Santa Cruz", "Volta Redonda", "Ypiranga"],
    );
    const hashes = new Set<string>();
    for (const team of data.teams) {
      assert.equal(team.crest, `/crests/serie-c/${team.id}.jpg`, team.name);
      const file = join(ROOT, "public", team.crest!);
      assert.ok(existsSync(file), `${team.name}: ${file}`);
      const bytes = readFileSync(file);
      // A real JPEG of some size, not an empty or placeholder file, and every club's its own.
      assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], team.name);
      assert.ok(bytes.length > 1000, team.name);
      hashes.add(createHash("sha256").update(bytes).digest("hex"));
    }
    assert.equal(hashes.size, 20);
  });

  it("holds the whole season: 190 first-phase games, 24 in the groups and the final's two legs", () => {
    assert.equal(season.games.filter((g) => g.phase === "first").length, 190);
    assert.equal(season.games.filter((g) => g.phase === "second").length, 24);
    assert.equal(data.fixtures.length, 214);
    assert.equal(data.postseason?.length, 2);
    assert.ok(data.fixtures.every((f) => f.result));
    // Single round robin: every pair of clubs meets once in the first phase.
    const pairs = new Set(season.games.filter((g) => g.phase === "first").map((g) => [g.homeId, g.awayId].sort().join("-")));
    assert.equal(pairs.size, 190);
  });

  it("rebuilds the CBF's official first-phase table from the games", () => {
    const first = data.fixtures.filter((f) => f.matchday <= 19);
    const rows = computeStandings(data.teams, first, realResults(first), baseOptions);
    assert.deepEqual(
      rows.map((r) => tuple(r, r.teamId)),
      season.official.firstPhase.map((r) => tuple(r, r.clubId)),
    );
    // Floresta and Inter de Limeira are level on points, wins, goal difference and goals: Floresta's fewer red cards put it 5th.
    assert.deepEqual(names(rows.slice(4, 6).map((r) => r.teamId)), ["Floresta", "Inter de Limeira"]);
    assert.deepEqual(names(rows.slice(18).map((r) => r.teamId)), ["Itabaiana", "Confiança"]);
  });

  it("forms the CBF's groups from the table and rebuilds their official tables", () => {
    const phase = phaseOf(realResults(data.fixtures));
    assert.deepEqual(names(phase.members![0]!), ["Botafogo-PB", "Maringá", "Floresta", "Santa Cruz"]);
    assert.deepEqual(names(phase.members![1]!), ["Brusque", "Ferroviária", "Inter de Limeira", "Paysandu"]);
    assert.equal(phase.generated, false);
    // Zero points carried over; six rounds each, numbered as the group's own.
    assert.ok(phase.startPoints.every((g) => Object.values(g).every((p) => p === 0)));
    assert.deepEqual([...new Set(phase.groupFixtures[0]!.map((f) => f.matchday))].sort(), [1001, 1002, 1003, 1004, 1005, 1006]);
    assert.equal(groupOfRound(2003), 1);
    const effective = effectiveResults([...phase.firstPhase, ...phase.groupFixtures.flat()], {});
    for (const g of [0, 1]) {
      const rows = splitGroupTable(phase, g, data.teams, effective, groupOptions);
      const official = season.official.secondPhase[g]!;
      assert.deepEqual(
        rows.map((r) => tuple(r, r.teamId)),
        official.map((r) => tuple(r, r.clubId)),
      );
    }
  });

  it("plays the final between the group winners, the better campaign at home in the second leg", () => {
    const phase = phaseOf(realResults(data.fixtures));
    const effective = effectiveResults([...phase.firstPhase, ...phase.groupFixtures.flat()], {});
    const groups = [0, 1].map((g) => splitGroupTable(phase, g, data.teams, effective, groupOptions));
    const seeds = seedByGroupPlace(groups, [], 1, false, phase.firstTable);
    // Level on points (41) and wins (11) over both phases: Ferroviária's goal difference (+10 to +6) wins the second leg at home.
    assert.deepEqual(names(seeds.slice(0, 2).map((r) => r.teamId)), ["Ferroviária", "Maringá"]);
    const [tie] = buildBracket(seeds, league.playoff!, {}, { seasonComplete: true, afterMatchday: 2006, afterDate: "2026-10-11T18:20:00.000Z", real: data.postseason! }).at(-1)!;
    assert.deepEqual(
      tie!.legs.map((l) => [names([l.homeId])[0], l.result, l.utcDate.slice(0, 10)]),
      [
        ["Maringá", { home: 1, away: 1 }, "2026-10-17"],
        ["Ferroviária", { home: 1, away: 2 }, "2026-10-24"],
      ],
    );
    const outcome = tieOutcome(tie!, {})!;
    assert.equal(outcome.winner, id("Maringá"));
    assert.equal(outcome.onPenalties, false);
  });

  it("ranks the season as the CBF does: Maringá champions, four up, two down", () => {
    const phase = phaseOf(realResults(data.fixtures));
    const effective = effectiveResults([...phase.firstPhase, ...phase.groupFixtures.flat()], {});
    const groups = [0, 1].map((g) => splitGroupTable(phase, g, data.teams, effective, groupOptions));
    const rows = stagedClassification(phase.firstTable, groups, { winner: id("Maringá"), loser: id("Ferroviária") });
    assert.deepEqual(names(rows.slice(0, 4).map((r) => r.teamId)), ["Maringá", "Ferroviária", "Santa Cruz", "Inter de Limeira"]);
    assert.deepEqual(names(rows.slice(4, 8).map((r) => r.teamId)), ["Brusque", "Botafogo-PB", "Floresta", "Paysandu"]);
    assert.deepEqual(names(rows.slice(18).map((r) => r.teamId)), ["Itabaiana", "Confiança"]);
    assert.equal(rows.length, 20);
  });

  it("gives every club page the final outcome", () => {
    const outlook = leagueOutlook(league, data, 200)!;
    assert.equal(outlook.complete, true);
    assert.deepEqual(names(outlook.order.slice(0, 4)), ["Maringá", "Ferroviária", "Santa Cruz", "Inter de Limeira"]);
    const chance = (name: string, kind: string) => outlook.clubs.get(id(name))!.headline.find((h) => h.kind === kind)?.chance;
    assert.equal(chance("Maringá", "title"), 1);
    assert.equal(chance("Ferroviária", "title"), 0);
    for (const club of ["Maringá", "Ferroviária", "Santa Cruz", "Inter de Limeira"]) assert.equal(chance(club, "promotion"), 1, club);
    assert.equal(chance("Brusque", "promotion"), 0);
    for (const club of ["Itabaiana", "Confiança"]) assert.equal(chance(club, "relegation"), 1, club);
    assert.equal(chance("Anápolis", "relegation"), 0);
    // No second "title" chance from the final: it already decides 1st.
    assert.ok(outlook.clubs.get(id("Maringá"))!.headline.every((h) => h.kind !== "playoffWin"));
  });

  it("lets a changed first-phase result change the groups, and the final follows", () => {
    // Ypiranga (9th, 29 points) beats Santa Cruz (8th) instead of losing: Ypiranga goes into group B, Santa Cruz is out.
    const game = data.fixtures.find((f) => f.matchday <= 19 && [f.homeId, f.awayId].includes(id("Ypiranga")) && [f.homeId, f.awayId].includes(id("Santa Cruz")))!;
    const ypirangaHome = game.homeId === id("Ypiranga");
    const predictions: ResultMap = { [game.id]: ypirangaHome ? { home: 3, away: 0 } : { home: 0, away: 3 } };
    const phase = phaseOf({ ...realResults(data.fixtures), ...predictions });
    assert.ok(phase.members![0]!.includes(id("Ypiranga")) || phase.members![1]!.includes(id("Ypiranga")));
    assert.ok(!phase.members!.flat().includes(id("Santa Cruz")));
    const changed = phase.members!.findIndex((ids) => ids.includes(id("Ypiranga")));
    // That group's games are new (to be played), the other group keeps its real ones.
    assert.equal(phase.generated, true);
    assert.ok(phase.groupFixtures[changed]!.every((f) => f.result === null));
    assert.equal(phase.groupFixtures[changed]!.length, 12);
    assert.ok(phase.groupFixtures[1 - changed]!.every((f) => f.result !== null));
    // The share link can hold the new games' scores.
    const shareIds = new Set(shareFixtureList(league, data.fixtures, data.teams, undefined).map((f) => f.id));
    assert.ok(phase.groupFixtures[changed]!.every((f) => shareIds.has(f.id)));
  });

  it("keeps a changed final in the share card's table", () => {
    // Ferroviária win the second leg 3–0 instead: champions on aggregate.
    const legIds = buildBracket(
      seedByGroupPlace(
        [0, 1].map((g) => splitGroupTable(phaseOf(realResults(data.fixtures)), g, data.teams, effectiveResults(data.fixtures, {}), groupOptions)),
        [],
        1,
        false,
        phaseOf(realResults(data.fixtures)).firstTable,
      ),
      league.playoff!,
      {},
      { seasonComplete: true, afterMatchday: 2006, afterDate: "", real: data.postseason! },
    ).at(-1)![0]!.legs.map((l) => l.id);
    const outcome = scenarioOutcome(league, data, { [legIds[1]!]: { home: 3, away: 0 } }, 200)!;
    assert.equal(outcome.complete, true);
    assert.equal(outcome.rows[0]!.teamId, id("Ferroviária"));
    assert.equal(outcome.rows[0]!.chance, 1);
    assert.equal(outcome.headline.kind, "champion");
  });

  it("describes the format from its config", () => {
    const facts = leagueFacts(league)!;
    assert.deepEqual(
      facts.facts.find((f) => f.kind === "splitPlaced"),
      { kind: "splitPlaced", afterRound: 19, groups: [{ places: [1, 4, 5, 8], name: league.groups![0]!.name }, { places: [2, 3, 6, 7], name: league.groups![1]!.name }] },
    );
    assert.deepEqual(
      facts.places.map((z) => [z.kind, z.from, z.to]),
      [["title", 1, 1], ["promotion", 1, 4], ["relegation", 19, 20]],
    );
  });

  it("never calls a feed: the data loads with the network off, sample data or not", async () => {
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("network off");
    }) as typeof fetch;
    const sample = process.env.FOOTSIMU_SAMPLE_DATA;
    try {
      for (const mode of [undefined, "1"]) {
        if (mode) process.env.FOOTSIMU_SAMPLE_DATA = mode;
        else delete process.env.FOOTSIMU_SAMPLE_DATA;
        const loaded = await getLeagueData(league);
        assert.equal(loaded.provider, "first-party");
        assert.equal(loaded.teams.length, 20);
        assert.ok(loaded.teams.every((t) => t.crest?.startsWith("/crests/serie-c/") && t.page?.startsWith("/brasileirao-serie-c/team/")));
      }
    } finally {
      globalThis.fetch = realFetch;
      if (sample === undefined) delete process.env.FOOTSIMU_SAMPLE_DATA;
      else process.env.FOOTSIMU_SAMPLE_DATA = sample;
    }
    assert.deepEqual(calls, []);
    // Nothing in the data points at another host.
    assert.doesNotMatch(readFileSync(join(ROOT, "src/data/serie-c/2026.json"), "utf8").replace(/"source": "[^"]*"/, ""), /https?:\/\//);
  });
});
