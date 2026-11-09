import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getLeagueByCode, getLeagueBySlug } from "../config/leagues.ts";
import { tieIds } from "../engine/playoffs.ts";
import { promotionPath, tieWinner } from "../engine/promotionPath.ts";
import { buildLeagueModel } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import { buildSplitPhase, splitGroupTable } from "../engine/split.ts";
import { computeStandings } from "../engine/standings.ts";
import type { Fixture, ResultMap, Team } from "../engine/types.ts";
import { leagueOutlook } from "./clubOutlook.ts";
import { firstPartyData, tournamentsSeason } from "./firstParty.ts";
import { leagueFacts } from "./leagueFacts.ts";
import { domesticModelOptions } from "./priors.ts";
import { promotionScenario, simulatePromotion } from "./promotionSeason.ts";
import { annualFixtures, tournamentChampion, tournamentConfig, tournamentStages } from "./tournaments.ts";

// Colombia's Primera B 2026: the site's own data (src/data/primera-b/2026.json,
// imported from the season's Wikipedia article), checked against the
// article's own tables, and the promotion path of Dimayor's 2026 rules.

const league = getLeagueByCode("COLB")!;
const season = tournamentsSeason(league)!;
const data = firstPartyData(league);
const ROOT = join(import.meta.dirname, "../..");
const id = (name: string) => data.teams.find((t) => t.name === name)!.id;
const [torneoII, torneoI] = data.tournaments!;
const options = { tiebreakers: league.tiebreakers, includeForm: false };
const phaseOf = (t: typeof torneoI, results: ResultMap) =>
  buildSplitPhase({
    teams: data.teams,
    fixtures: t!.fixtures,
    results,
    groups: league.split!.groups,
    afterRound: 15,
    realGroups: league.groups!.map((g) => t!.groups!.find((m) => m.id === g.id)!.teamIds),
    options,
  });
const ordered = [...data.tournaments!].reverse();
const allGames = annualFixtures({ ...league, annual: league.annual! }, ordered);
const model = buildLeagueModel(data.teams, allGames, realResults(allGames), domesticModelOptions(league, 2026));

describe("Primera B 2026 (first-party data)", () => {
  it("is registered as a first-party league of two tournaments, with no feed", () => {
    assert.equal(getLeagueBySlug("colombia-primera-b"), league);
    assert.equal(league.espn, undefined);
    assert.deepEqual(tournamentStages(league).map((s) => s.name), ["Torneo II", "Torneo I"]);
    assert.equal(data.provider, "first-party");
    assert.equal(data.seasonKey, "COLB:2026:torneo-ii");
    assert.deepEqual(data.tournaments!.map((t) => t.seasonKey), ["COLB:2026:torneo-ii", "COLB:2026:torneo-i"]);
  });

  it("has all 16 clubs, each with its own local crest", () => {
    assert.equal(data.teams.length, 16);
    for (const team of data.teams) {
      assert.match(team.crest!, /^\/crests\/primera-b\/\d+\.png$/);
      assert.ok(existsSync(join(ROOT, "public", team.crest!)), team.name);
    }
    // The club renamed in July: one club over the season, by its new name.
    assert.equal(data.teams.find((t) => t.tla === "IVC")!.name, "Independiente Valle del Cauca");
  });

  it("has every game of both round robins and groups, and Torneo I's final", () => {
    for (const t of data.tournaments!) {
      assert.equal(t.fixtures.filter((f) => f.matchday <= 15).length, 120, t.name);
      assert.equal(t.fixtures.filter((f) => f.matchday > 15).length, 24, t.name);
      // Each club plays every other once in the round robin.
      const pairs = new Set(t.fixtures.filter((f) => f.matchday <= 15).map((f) => [f.homeId, f.awayId].sort((a, b) => a - b).join("-")));
      assert.equal(pairs.size, 120);
    }
    assert.equal(torneoI!.postseason!.length, 2);
    assert.equal(new Set(data.tournaments!.flatMap((t) => [...t.fixtures, ...(t.postseason ?? [])]).map((f) => f.id)).size, 290);
  });

  it("matches the article's tables: each round robin, each group and the aggregate table, in order", () => {
    for (const [n, t] of [["1", torneoI!], ["2", torneoII!]] as const) {
      const results = realResults(t.fixtures);
      const phase = phaseOf(t, results);
      const article = season.article[n];
      const row = (r: { teamId?: number; clubId?: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number }) => [r.teamId ?? r.clubId, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst];
      assert.deepEqual(phase.firstTable.map(row), article.first!.map(row), `Torneo ${n}`);
      phase.members!.forEach((_, g) => {
        const table = splitGroupTable(phase, g, data.teams, results, { tiebreakers: league.split!.groupTiebreakers! });
        assert.deepEqual(table.map(row), article[g ? "B" : "A"]!.map(row), `Torneo ${n}, group ${g ? "B" : "A"}`);
      });
    }
    const aggregate = computeStandings(data.teams, allGames, realResults(allGames), options);
    assert.deepEqual(
      aggregate.map((r) => [r.teamId, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst]),
      season.article.aggregate.map((r) => [r.clubId, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst]),
    );
    assert.deepEqual(aggregate.slice(0, 3).map((r) => [r.teamId, r.points]), [[id("Deportes Quindío"), 70], [id("Envigado"), 68], [id("Real Cartagena"), 65]]);
  });

  it("orders level clubs by away goals (Orsomarso over Patriotas in Torneo I) and heads each group with the round robin's top two", () => {
    const phase = phaseOf(torneoI!, realResults(torneoI!.fixtures));
    const place = (name: string) => phase.firstTable.find((r) => r.teamId === id(name))!;
    assert.equal(place("Orsomarso").points, place("Patriotas").points);
    assert.equal(place("Orsomarso").goalDifference, place("Patriotas").goalDifference);
    assert.ok(place("Orsomarso").position < place("Patriotas").position);
    // The groups as drawn, each head first: Torneo I's 1st and 2nd, Torneo II's.
    assert.deepEqual(torneoI!.groups!.map((g) => g.teamIds[0]), [id("Inter de Palmira"), id("Unión Magdalena")]);
    assert.deepEqual(torneoII!.groups!.map((g) => g.teamIds[0]), [id("Independiente Valle del Cauca"), id("Real Cundinamarca")]);
  });

  it("gives Torneo I to Envigado, 4–3 on aggregate against Real Cartagena", () => {
    const config = tournamentConfig(league, tournamentStages(league).find((s) => s.table === "torneo-i"));
    assert.equal(tournamentChampion(config, data.teams, torneoI!), id("Envigado"));
    const scenario = promotionScenario({ league, teams: data.teams, tournaments: data.tournaments!, model });
    assert.deepEqual(scenario.champions.map((c) => c.champion), [id("Envigado"), null]);
    assert.equal(scenario.path, null);
  });

  it("describes the format: drawn groups, a final, the aggregate table and the promotion path", () => {
    const facts = leagueFacts(league)!;
    assert.deepEqual(
      facts.facts.map((f) => f.kind),
      ["clubs", "roundRobin", "tournaments", "splitDrawn", "promotionPath", "annual"],
    );
    assert.equal(facts.placesScope, "annual");
  });
});

describe("Primera B group head on level points", () => {
  it("puts the head first when level on points, whatever the goal difference", () => {
    const teams: Team[] = [1, 2].map((x) => ({ id: x, name: `C${x}`, shortName: `C${x}`, tla: `C${x}` }));
    const fixtures: Fixture[] = [
      { id: 1, matchday: 1, utcDate: "2026-01-01", homeId: 1, awayId: 2, result: { home: 0, away: 3 } },
      { id: 2, matchday: 2, utcDate: "2026-01-08", homeId: 2, awayId: 1, result: { home: 0, away: 1 } },
    ];
    const tiebreakers = league.split!.groupTiebreakers!;
    assert.deepEqual(computeStandings(teams, fixtures, realResults(fixtures), { tiebreakers }).map((r) => r.teamId), [2, 1]);
    assert.deepEqual(computeStandings(teams, fixtures, realResults(fixtures), { tiebreakers, seeded: [1] }).map((r) => r.teamId), [1, 2]);
  });

  it("ranks fewer away goals conceded higher", () => {
    const teams: Team[] = [1, 2, 3].map((x) => ({ id: x, name: `C${x}`, shortName: `C${x}`, tla: `C${x}` }));
    // 1 and 2: 4 points, 2–1 in goals, one away goal each; 1 concedes its goal away, 2 at home.
    const fixtures: Fixture[] = [
      { id: 1, matchday: 1, utcDate: "2026-01-01", homeId: 1, awayId: 3, result: { home: 1, away: 0 } },
      { id: 2, matchday: 1, utcDate: "2026-01-01", homeId: 2, awayId: 3, result: { home: 1, away: 1 } },
      { id: 3, matchday: 2, utcDate: "2026-01-08", homeId: 3, awayId: 1, result: { home: 1, away: 1 } },
      { id: 4, matchday: 2, utcDate: "2026-01-08", homeId: 3, awayId: 2, result: { home: 0, away: 1 } },
    ];
    const rank = (tiebreakers: typeof league.tiebreakers) => computeStandings(teams, fixtures, realResults(fixtures), { tiebreakers, fallbackOrder: [1, 2, 3] }).map((r) => r.teamId);
    assert.deepEqual(rank(["points", "goalDifference", "goalsFor", "awayGoalsFor"]), [1, 2, 3]);
    assert.deepEqual(rank(league.tiebreakers), [2, 1, 3]);
  });
});

describe("Primera B promotion path (Reglamento 2026, Arts. 19–25)", () => {
  // The aggregate table: club 1 top, then 2, 3…
  const order = [1, 2, 3, 4, 5, 6];

  it("one club winning both tournaments goes up; the next two play off, the better placed at home second", () => {
    const path = promotionPath([3, 3], order);
    assert.equal(path.rule, "doubleChampion");
    assert.deepEqual(path.direct, [3]);
    assert.deepEqual(path.playoff, { kind: "playoff", higher: 1, lower: 2 });
  });

  it("two champions in the top two both go up, with no grand final or play-off", () => {
    const path = promotionPath([2, 1], order);
    assert.equal(path.rule, "bothTop");
    assert.deepEqual(path.direct, [2, 1]);
    assert.equal(path.playoff, undefined);
    assert.equal(path.grandFinal, undefined);
  });

  it("one champion in the top two goes up; the other plays off against the best-placed other club", () => {
    const path = promotionPath([2, 5], order);
    assert.equal(path.rule, "oneTop");
    assert.deepEqual(path.direct, [2]);
    assert.deepEqual(path.playoff, { kind: "playoff", higher: 1, lower: 5 });
    // The champion in the top two is 1st: the best other club is 2nd.
    assert.deepEqual(promotionPath([1, 5], order).playoff, { kind: "playoff", higher: 2, lower: 5 });
  });

  it("neither champion in the top two: a grand final, its loser against the aggregate table's leader", () => {
    const path = promotionPath([5, 3], order);
    assert.equal(path.rule, "neitherTop");
    assert.deepEqual(path.direct, []);
    assert.deepEqual(path.grandFinal, { kind: "grandFinal", higher: 3, lower: 5 });
    assert.deepEqual(path.playoff, { kind: "playoff", fromGrandFinal: true, against: 1 });
  });

  it("decides a tie on aggregate, then on penalties", () => {
    const tie = { kind: "playoff" as const, higher: 1, lower: 2 };
    // First leg at the lower side's ground, second at the higher's.
    assert.equal(tieWinner(tie, [{ home: 2, away: 0 }, { home: 1, away: 0 }]), 2);
    assert.equal(tieWinner(tie, [{ home: 1, away: 0 }, { home: 1, away: 0 }]), null);
    assert.equal(tieWinner(tie, [{ home: 1, away: 0 }, { home: 1, away: 0 }], { home: 4, away: 5 }), 2);
    assert.equal(tieWinner(tie, [{ home: 1, away: 0 }, { home: 1, away: 0 }], { home: 5, away: 4 }), 1);
  });
});

describe("Primera B promotion chances", () => {
  const input = { league, teams: data.teams, tournaments: data.tournaments!, model };

  it("sends exactly two clubs up in every simulated season; Envigado (Torneo I's champion) most often", () => {
    const chances = simulatePromotion(input, 400, 3);
    assert.equal(chances.iterations, 400);
    const total = [...chances.promoted.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 2) < 1e-9, String(total));
    const best = [...chances.promoted].sort((a, b) => b[1] - a[1])[0]!;
    assert.equal(best[0], id("Envigado"));
    // Torneo I is settled: Envigado's in every season.
    assert.equal(chances.champion.get("torneo-i")!.get(id("Envigado")), 1);
    // A club outside Torneo II's groups and far down the aggregate table can't go up.
    assert.equal(chances.promoted.get(id("Real Santander")) ?? 0, 0);
  });

  it("follows the user's predictions: with Torneo II settled, the path is the rules' own", () => {
    // Every group game left: a home win; the final: the lower seed wins both legs.
    const predictions: ResultMap = {};
    for (const f of torneoII!.fixtures) if (!f.result) predictions[f.id] = { home: 2, away: 0 };
    const [leg1, leg2] = tieIds(0, 0, league.playoff!.rounds[0]!);
    predictions[leg1!] = { home: 3, away: 0 };
    predictions[leg2!] = { home: 0, away: 1 };
    const scenario = promotionScenario({ ...input, predictions: { [torneoII!.seasonKey]: predictions } });
    const [first, second] = scenario.champions.map((c) => c.champion);
    assert.equal(first, id("Envigado"));
    assert.notEqual(second, null);
    assert.deepEqual(scenario.path, promotionPath([first!, second!], scenario.table.map((r) => r.teamId)));
    // And in every simulated season.
    const chances = simulatePromotion({ ...input, predictions: { [torneoII!.seasonKey]: predictions } }, 100, 5);
    assert.equal(chances.champion.get("torneo-ii")!.get(second!), 1);
    for (const clubId of scenario.path!.direct) assert.equal(chances.promoted.get(clubId), 1);
  });

  it("shows on the club pages as each club's promotion chance", () => {
    const outlook = leagueOutlook(league, data, 400)!;
    assert.equal(outlook.scope, "annual");
    const envigado = outlook.clubs.get(id("Envigado"))!;
    const promotion = envigado.headline.find((h) => h.kind === "promotion")!;
    assert.ok(promotion.chance > 0.5, String(promotion.chance));
    const total = [...outlook.clubs.values()].reduce((sum, c) => sum + (c.zones.find((z) => z.kind === "promotion")?.chance ?? 0), 0);
    assert.ok(Math.abs(total - 2) < 1e-9, String(total));
  });
});
