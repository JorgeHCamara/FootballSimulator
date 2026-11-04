import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import { runMonteCarlo } from "../engine/montecarlo.ts";
import { buildLeagueModel, DOMESTIC_PRIOR_GAMES } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import { computeStandings } from "../engine/standings.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { domesticModelOptions, domesticPriors, type PriorSeason } from "./priors.ts";

// The real 2026/27 Premier League after matchday 9 (ESPN): Arsenal 24 points,
// Man City 21, Brighton 19 (+17 goal difference), Chelsea 16…
const snapshot = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const pl = getLeagueByCode("PL")!;
const fixed = realResults(snapshot.fixtures);
const ITERATIONS = 4000;

function premierLeagueChances() {
  const model = buildLeagueModel(snapshot.teams, snapshot.fixtures, fixed, domesticModelOptions(pl, 2026));
  const result = runMonteCarlo({ teams: snapshot.teams, fixtures: snapshot.fixtures, fixed, model, standings: { tiebreakers: pl.tiebreakers }, iterations: ITERATIONS, seed: 2026 });
  const table = computeStandings(snapshot.teams, snapshot.fixtures, fixed, { tiebreakers: pl.tiebreakers });
  const share = (id: number, from: number, to: number) => result.positionCounts[id]!.slice(from - 1, to).reduce((a, b) => a + b, 0) / result.iterations;
  return { result, table, share };
}

describe("Premier League 2026/27 chances after matchday 9", () => {
  const { result, table, share } = premierLeagueChances();
  const leader = table[0]!;

  it("the leader isn't an underdog against any club five or more points behind", () => {
    assert.equal(leader.played, 9);
    for (const row of table.filter((r) => r.points <= leader.points - 5)) {
      assert.ok(share(leader.teamId, 1, 1) > share(row.teamId, 1, 1), `leader ${share(leader.teamId, 1, 1)} vs club ${row.teamId} on ${row.points}: ${share(row.teamId, 1, 1)}`);
    }
  });

  it("no club has more than half the title chances unless it's top or within a point of the top", () => {
    for (const row of table.filter((r) => r.points < leader.points - 1)) {
      assert.ok(share(row.teamId, 1, 1) <= 0.5, `club ${row.teamId} on ${row.points} points: ${share(row.teamId, 1, 1)}`);
    }
  });

  it("every column adds up: one champion, four Champions League places, three relegated", () => {
    const total = (from: number, to: number) => table.reduce((sum, r) => sum + share(r.teamId, from, to), 0);
    assert.ok(Math.abs(total(1, 1) - 1) < 1e-9, `title ${total(1, 1)}`);
    assert.ok(Math.abs(total(1, 4) - 4) < 1e-9, `top four ${total(1, 4)}`);
    assert.ok(Math.abs(total(18, 20) - 3) < 1e-9, `relegation ${total(18, 20)}`);
    // Each club finishes somewhere exactly once a run, and each place has one club.
    for (const row of table) assert.equal(result.positionCounts[row.teamId]!.reduce((a, b) => a + b, 0), ITERATIONS);
    for (let p = 0; p < table.length; p++) assert.equal(table.reduce((sum, r) => sum + result.positionCounts[r.teamId]![p]!, 0), ITERATIONS);
  });
});

describe("domestic starting ratings", () => {
  const seasons: Record<number, PriorSeason> = { 2025: { PL: { "1": [1.3, 0.7] } }, 2026: { PL: { "1": [1.5, 0.6], "2": [0.8, 1.3] } } };

  it("uses the season's own ratings, else the latest earlier season's", () => {
    assert.deepEqual(domesticPriors("PL", 2026, seasons), { 1: { attack: 1.5, defence: 0.6 }, 2: { attack: 0.8, defence: 1.3 } });
    assert.deepEqual(domesticPriors("PL", 2027, seasons), { 1: { attack: 1.5, defence: 0.6 }, 2: { attack: 0.8, defence: 1.3 } });
    assert.equal(domesticPriors("PL", 2024, seasons), undefined);
    assert.equal(domesticPriors("BSA", 2026, seasons), undefined);
    assert.equal(domesticPriors("PL", undefined, seasons), undefined);
  });

  it("every Premier League club of 2026/27 has one, the promoted clubs below average", () => {
    const priors = domesticPriors("PL", 2026)!;
    for (const team of snapshot.teams) assert.ok(priors[team.id], team.name);
    // Hull, Ipswich and Coventry came up from the Championship.
    for (const promoted of ["Hull City", "Ipswich Town", "Coventry City"]) {
      const id = snapshot.teams.find((t) => t.name === promoted)!.id;
      assert.ok(priors[id]!.attack < 1 && priors[id]!.defence > 1, promoted);
    }
  });

  it("domestic leagues weigh the prior as 18 games, unless a league sets its own", () => {
    assert.equal(DOMESTIC_PRIOR_GAMES, 18);
    assert.equal(domesticModelOptions(pl, 2026).priorGames, 18);
    assert.equal(domesticModelOptions({ ...pl, ratingPriorGames: 10 }, 2026).priorGames, 10);
  });
});

describe("ratings adjusted for the opponents", () => {
  // S is strong and W weak (S beats W 4-0 twice). A draws 2-2 with S twice and
  // B 2-2 with W twice: the same goals, but A scored them against a far better defence.
  const teams: Team[] = [1, 2, 3, 4].map((id) => ({ id, name: `T${id}`, shortName: `T${id}`, tla: `T${id}` }));
  const [S, W, A, B] = [1, 2, 3, 4];
  const games: [number, number, number, number][] = [
    [S, W, 4, 0], [W, S, 0, 4], [A, S, 2, 2], [S, A, 2, 2], [B, W, 2, 2], [W, B, 2, 2],
  ];
  const fixtures: Fixture[] = games.map(([homeId, awayId], i) => ({ id: i + 1, matchday: i + 1, utcDate: "2026-08-01T15:00:00Z", homeId, awayId, result: null }));
  const results = Object.fromEntries(games.map(([, , home, away], i) => [i + 1, { home, away }]));

  it("two goals against a strong defence count for more than two against a weak one", () => {
    const raw = buildLeagueModel(teams, fixtures, results, { priorGames: 0.001, iterations: 1 });
    const adjusted = buildLeagueModel(teams, fixtures, results, { priorGames: 0.001 });
    assert.ok(Math.abs(raw.strengths.get(A)!.attack - raw.strengths.get(B)!.attack) < 1e-9, "raw ratios: the same");
    assert.ok(adjusted.strengths.get(A)!.attack > adjusted.strengths.get(B)!.attack * 1.2, `A ${adjusted.strengths.get(A)!.attack} vs B ${adjusted.strengths.get(B)!.attack}`);
  });

  it("the prior counts for priorGames games", () => {
    const priorStrengths = new Map(teams.map((t) => [t.id, { attack: 1, defence: 1 }]));
    const light = buildLeagueModel(teams, fixtures, results, { priorGames: 2, priorStrengths });
    const heavy = buildLeagueModel(teams, fixtures, results, { priorGames: 18, priorStrengths });
    // The strong club's rating stays closer to average with the heavier prior.
    assert.ok(Math.abs(heavy.strengths.get(S)!.attack - 1) < Math.abs(light.strengths.get(S)!.attack - 1));
  });
});
