import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { getLeagueByCode, LEAGUES } from "../config/leagues.ts";
import { runMonteCarlo } from "../engine/montecarlo.ts";
import { buildLeagueModel, DOMESTIC_PRIOR_GAMES, NO_DATA_PRIOR } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import { computeStandings } from "../engine/standings.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { currentSeasonYear } from "./leagueData.ts";
import { domesticModelOptions, domesticPriors, latestPriorYear, type PriorSeason } from "./priors.ts";

interface Snapshot {
  teams: Team[];
  fixtures: Fixture[];
}
const load = (file: string) => JSON.parse(readFileSync(new URL(`./testdata/${file}.json`, import.meta.url), "utf8")) as Snapshot;
// Real tables from ESPN (captured 2026-11-04):
// - Premier League 2026/27 after matchday 9: Arsenal 24, Man City 21, Brighton 19 (+17 goal difference)…
// - La Liga 2026/27 after matchday 11: Barcelona 30, Atlético 28, Real Madrid 27…
// - Serie A 2026/27 after matchday 10: Lazio 28, Inter 25, Roma 24, Como 23…
// - Brasileirão 2026 after matchday 34: Flamengo 73, Palmeiras 70, Cruzeiro 57…
const snapshot = load("pl-2026-27-md9");
const pl = getLeagueByCode("PL")!;
const ITERATIONS = 4000;

function chances(code: string, data: Snapshot) {
  const league = getLeagueByCode(code)!;
  const fixed = realResults(data.fixtures);
  const model = buildLeagueModel(data.teams, data.fixtures, fixed, domesticModelOptions(league, 2026));
  const result = runMonteCarlo({ teams: data.teams, fixtures: data.fixtures, fixed, model, standings: { tiebreakers: league.tiebreakers }, iterations: ITERATIONS, seed: 2026 });
  const table = computeStandings(data.teams, data.fixtures, fixed, { tiebreakers: league.tiebreakers });
  const share = (id: number, from: number, to: number) => result.positionCounts[id]!.slice(from - 1, to).reduce((a, b) => a + b, 0) / result.iterations;
  return { result, table, share, league };
}

for (const [code, file, title] of [
  ["PL", "pl-2026-27-md9", "Premier League 2026/27 after matchday 9"],
  ["PD", "la-liga-2026-27", "La Liga 2026/27 after matchday 11"],
  ["SA", "serie-a-2026-27", "Serie A 2026/27 after matchday 10"],
  ["BSA", "brasileirao-2026", "Brasileirão 2026 after matchday 34"],
] as const) {
  describe(`${title}: chances that make sense`, () => {
    const { result, table, share } = chances(code, load(file));
    const leader = table[0]!;

    it("title chances add up to 100%, and every club finishes somewhere once a run", () => {
      const total = table.reduce((sum, r) => sum + share(r.teamId, 1, 1), 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `title ${total}`);
      for (const row of table) assert.equal(result.positionCounts[row.teamId]!.reduce((a, b) => a + b, 0), ITERATIONS);
    });

    it("the leader isn't a heavy underdog (under 10%) against a club 3+ points behind", () => {
      const lead = share(leader.teamId, 1, 1);
      for (const row of table.filter((r) => r.points <= leader.points - 3)) {
        assert.ok(!(share(row.teamId, 1, 1) > lead && lead < 0.1), `leader ${leader.teamId} ${lead} vs club ${row.teamId} (${row.points} points) ${share(row.teamId, 1, 1)}`);
      }
    });

    it("after 10+ matchdays, no club more than 6 points off the top has over 50%", () => {
      if (leader.played < 10) return;
      for (const row of table.filter((r) => r.points < leader.points - 6)) {
        assert.ok(share(row.teamId, 1, 1) <= 0.5, `club ${row.teamId} (${row.points} points): ${share(row.teamId, 1, 1)}`);
      }
    });
  });
}

describe("Premier League 2026/27 chances after matchday 9", () => {
  const { result, table, share } = chances("PL", snapshot);
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
    for (let p = 0; p < table.length; p++) assert.equal(table.reduce((sum, r) => sum + result.positionCounts[r.teamId]![p]!, 0), ITERATIONS);
  });
});

describe("priors are up to date", () => {
  it("the newest priors file is at most one season behind every league's current season", () => {
    const latest = latestPriorYear();
    assert.ok(latest !== undefined, "no priors file");
    for (const league of LEAGUES.filter((l) => !l.continental)) {
      const current = currentSeasonYear(league);
      assert.ok(latest >= current - 1, `${league.code}: current season ${current}, newest priors ${latest}: run \`npm run priors -- ${current}\``);
    }
  });
});

describe("domestic starting ratings", () => {
  const seasons: Record<number, PriorSeason> = {
    2025: { PL: { rho: -0.05, clubs: { "1": [1.3, 0.7] }, home: {} } },
    2026: { PL: { rho: -0.1, clubs: { "1": [1.5, 0.6], "2": [0.8, 1.3] }, home: { "1": 1.2 } } },
  };

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

  it("a club the priors don't list starts below average, not at the average", () => {
    const options = domesticModelOptions(pl, 2026);
    assert.deepEqual(options.missingPrior, NO_DATA_PRIOR);
    assert.deepEqual(NO_DATA_PRIOR, { attack: 0.85, defence: 1.15 });
    const newcomer: Team = { id: 999_999, name: "Newcomer", shortName: "New", tla: "NEW" };
    const model = buildLeagueModel([...snapshot.teams, newcomer], [], {}, options);
    const s = model.strengths.get(newcomer.id)!;
    // Below the rest after normalisation (other clubs average about 1).
    assert.ok(s.attack < 0.9 && s.defence > 1.1, `${s.attack} / ${s.defence}`);
    // Without any priors (sample data), everyone starts average.
    const plain = buildLeagueModel([newcomer], [], {}, { missingPrior: NO_DATA_PRIOR });
    assert.deepEqual(plain.strengths.get(newcomer.id), { attack: 1, defence: 1 });
  });

  it("warns when a season falls back to an earlier season's priors", () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => warnings.push(message);
    try {
      domesticPriors("PL", 2026, seasons);
      assert.equal(warnings.length, 0, "the season's own file: no warning");
      // (Once per league and season: 2030 isn't asked for anywhere else.)
      domesticPriors("PL", 2030, seasons);
      domesticPriors("PL", 2030, seasons);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /PL: no starting ratings for the 2030 season, using 2026's/);
    } finally {
      console.warn = original;
    }
  });

  it("domestic leagues weigh the prior as 18 games, unless a league sets its own", () => {
    assert.equal(DOMESTIC_PRIOR_GAMES, 18);
    assert.equal(domesticModelOptions(pl, 2026).priorGames, 18);
    assert.equal(domesticModelOptions({ ...pl, ratingPriorGames: 10 }, 2026).priorGames, 10);
    assert.equal(domesticModelOptions(getLeagueByCode("SA")!, 2026).priorGames, 12, "Serie A: 12");
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

  it("attack and defence average 1.0 across the league after the passes", () => {
    for (const options of [{}, { priorGames: 0.001 }, { priorStrengths: new Map([[1, { attack: 2, defence: 0.5 }]]), missingPrior: NO_DATA_PRIOR }]) {
      const model = buildLeagueModel(teams, fixtures, results, options);
      const mean = (k: "attack" | "defence") => [...model.strengths.values()].reduce((sum, s) => sum + s[k], 0) / model.strengths.size;
      assert.ok(Math.abs(mean("attack") - 1) < 1e-9 && Math.abs(mean("defence") - 1) < 1e-9, `${mean("attack")} / ${mean("defence")}`);
    }
  });

    it("the prior counts for priorGames games", () => {
    const priorStrengths = new Map(teams.map((t) => [t.id, { attack: 1, defence: 1 }]));
    const light = buildLeagueModel(teams, fixtures, results, { priorGames: 2, priorStrengths });
    const heavy = buildLeagueModel(teams, fixtures, results, { priorGames: 18, priorStrengths });
    // The strong club's rating stays closer to average with the heavier prior.
    assert.ok(Math.abs(heavy.strengths.get(S)!.attack - 1) < Math.abs(light.strengths.get(S)!.attack - 1));
  });
});
