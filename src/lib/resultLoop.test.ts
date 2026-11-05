import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createTranslator } from "next-intl";
import { getLeagueByCode, getLeagueBySlug } from "../config/leagues.ts";
import { probabilityInRange, runMonteCarlo, runMonteCarloVariants, type MonteCarloResult } from "../engine/montecarlo.ts";
import { buildLeagueModel } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import { createRng } from "../engine/rng.ts";
import { computeStandings, standingsBuilder, type StandingsOptions } from "../engine/standings.ts";
import type { Fixture, ResultMap, Team } from "../engine/types.ts";
import { cachedLeagueOutlook, leagueOutlook, outlookSetup, outlookWithResults, resultScenarios } from "./clubOutlook.ts";
import { withClubPages } from "./clubs.ts";
import { getLeagueData, type LeagueData } from "./leagueData.ts";
import { impactView, type ImpactNumbers } from "./matchImpact.ts";
import { sampleLeague } from "./sampleLeague.ts";

const pl = getLeagueByCode("PL")!;
const snap = JSON.parse(readFileSync(new URL("./testdata/pl-2026-27-md9.json", import.meta.url), "utf8")) as { teams: Team[]; fixtures: Fixture[] };
const plData: LeagueData = { teams: withClubPages(pl, snap.teams), fixtures: snap.fixtures, season: "2026/27", seasonKey: "PL:espn:2026", seasonYear: 2026, source: "live" };
const nextGame = (data: LeagueData) => data.fixtures.filter((f) => !f.result).sort((a, b) => a.utcDate.localeCompare(b.utcDate))[0]!;
const results3 = (id: number): ResultMap[] => [{ [id]: { home: 2, away: 1 } }, { [id]: { home: 1, away: 1 } }, { [id]: { home: 0, away: 1 } }];

/** Every club's chance of every place range of the table, from a run. */
function chances(run: MonteCarloResult): number[] {
  const out: number[] = [];
  for (const [id, counts] of Object.entries(run.positionCounts)) for (let p = 1; p <= counts.length; p++) out.push(probabilityInRange(run, Number(id), 1, p));
  return out;
}

/** Two runs of n seasons agree within Monte Carlo noise: every chance within 4.5 standard errors (of the difference of two runs). */
function withinNoise(a: MonteCarloResult, b: MonteCarloResult, label: string) {
  const ca = chances(a);
  const cb = chances(b);
  for (const [i, p] of ca.entries()) {
    const q = cb[i]!;
    const se = Math.sqrt((p * (1 - p) + q * (1 - q)) / a.iterations);
    assert.ok(Math.abs(p - q) <= 4.5 * se + 2 / a.iterations, `${label}: ${p} vs ${q}`);
  }
}

describe("each result of a game in one simulation loop", () => {
  it("one variant is exactly a run with that override", () => {
    const s = outlookSetup(pl, plData)!;
    const game = nextGame(plData);
    const override = { [game.id]: { home: 3, away: 0 } };
    assert.deepEqual(runMonteCarloVariants({ ...s.input, iterations: 500, seed: 2026 }, [override])[0], runMonteCarlo({ ...s.input, iterations: 500, seed: 2026, override }));
    assert.deepEqual(runMonteCarloVariants({ ...s.input, iterations: 500, seed: 2026 }, [{}])[0], runMonteCarlo({ ...s.input, iterations: 500, seed: 2026 }));
  });

  it("the Premier League: the same numbers as three separate runs, every season counted for each result", () => {
    const s = outlookSetup(pl, plData)!;
    const game = nextGame(plData);
    const loop = runMonteCarloVariants({ ...s.input, iterations: 2000, seed: 2026 }, results3(game.id));
    for (const [i, override] of results3(game.id).entries()) {
      assert.equal(loop[i]!.iterations, 2000);
      assert.deepEqual(loop[i], runMonteCarlo({ ...s.input, iterations: 2000, seed: 2026, override }));
    }
    // The home side's points: exactly 3 more after a win than after a loss (only that game differs).
    assert.ok(Math.abs(loop[0]!.averagePoints[game.homeId]! - loop[2]!.averagePoints[game.homeId]! - 3) < 1e-9);
  });

  it("conferences, a split still to come, annual tables, a knockout phase: within Monte Carlo noise of three separate runs", async () => {
    process.env.FOOTSIMU_SAMPLE_DATA = "1";
    const formats: [string, (s: NonNullable<ReturnType<typeof outlookSetup>>) => boolean][] = [
      ["MLS", (s) => Boolean(s.input.groups?.length)],
      ["GSL", (s) => Boolean(s.input.project)],
      ["ABL", (s) => Boolean(s.input.project)],
      ["ARG", (s) => Boolean(s.input.passDown?.length) && s.scope === "annual"],
    ];
    for (const [code, uses] of formats) {
      const league = getLeagueByCode(code)!;
      const data = await getLeagueData(league);
      const s = outlookSetup(league, data)!;
      assert.ok(uses(s), `${code}: the format under test`);
      const game = s.input.fixtures.find((f) => !s.input.fixed[f.id])!;
      const loop = runMonteCarloVariants({ ...s.input, iterations: 3000, seed: 2026 }, results3(game.id));
      for (const [i, override] of results3(game.id).entries()) withinNoise(loop[i]!, runMonteCarlo({ ...s.input, iterations: 3000, seed: 2026, override }), `${code} result ${i}`);
    }
    // A knockout phase after the table (the Champions League): its draws start from the same point for each result.
    const ucl = getLeagueBySlug("champions-league")!;
    const { teams, fixtures } = sampleLeague(ucl);
    const fixed = realResults(fixtures);
    const input = {
      teams,
      fixtures,
      fixed,
      model: buildLeagueModel(teams, fixtures, fixed),
      standings: { tiebreakers: ucl.tiebreakers },
      iterations: 1500,
      seed: 2026,
      playoff: { config: ucl.playoff!, options: { afterMatchday: 8, afterDate: "2027-01-28T20:00:00Z" } },
    };
    const game = fixtures.find((f) => !fixed[f.id])!;
    const loop = runMonteCarloVariants(input, results3(game.id));
    for (const [i, override] of results3(game.id).entries()) {
      const alone = runMonteCarlo({ ...input, override });
      withinNoise(loop[i]!, alone, `UCL result ${i}`);
      assert.equal(Object.values(loop[i]!.playoffWins!).reduce((a, b) => a + b, 0), 1500, "a winner every season, for each result");
    }
  });

  it("the match page's scenarios come from the loop, full 10,000 seasons each", () => {
    const game = nextGame(plData);
    const s = outlookSetup(pl, plData)!;
    const scores = { home: { home: 2, away: 1 }, draw: { home: 1, away: 1 }, away: { home: 1, away: 2 } };
    const scenarios = resultScenarios(pl, plData, game, scores)!;
    const loop = runMonteCarloVariants({ ...s.input, iterations: 10_000, seed: 2026 }, [{ [game.id]: scores.home }, { [game.id]: scores.draw }, { [game.id]: scores.away }]);
    const expected = (run: MonteCarloResult) => run.positionCounts[game.homeId]!.reduce((sum, n, p) => sum + (n / run.iterations) * (p + 1), 0);
    assert.ok(Math.abs(scenarios.after.home.get(game.homeId)!.expectedPosition - expected(loop[0]!)) < 1e-9);
    assert.ok(Math.abs(scenarios.after.away.get(game.homeId)!.expectedPosition - expected(loop[2]!)) < 1e-9);
  });
});

describe("the match endpoint's numbers: the outlook and the results from one loop", () => {
  it("the outlook is exactly the page's, the results exactly resultScenarios's (Premier League)", () => {
    // Another data version than the tests above, so nothing is kept from them.
    const data = { ...plData, seasonKey: "PL:espn:2026:endpoint" };
    const game = nextGame(data);
    const scores = { home: { home: 2, away: 0 }, draw: { home: 0, away: 0 }, away: { home: 0, away: 1 } };
    const both = outlookWithResults(pl, data, game, () => scores)!;
    const plain = leagueOutlook(pl, data)!;
    assert.deepEqual([...both.outlook.clubs.values()].map((c) => [c.team.id, c.distribution, c.likeliest, c.averagePoints]), [...plain.clubs.values()].map((c) => [c.team.id, c.distribution, c.likeliest, c.averagePoints]));
    // Kept: the page's outlook on this server is that one, and the results come back from the cache.
    assert.equal(cachedLeagueOutlook(pl, data), both.outlook);
    assert.equal(resultScenarios(pl, data, game, scores), both.scenarios);
    const fresh = { ...data, seasonKey: "PL:espn:2026:endpoint-2" };
    const separately = resultScenarios(pl, fresh, game, scores)!;
    for (const k of ["home", "draw", "away"] as const) {
      for (const id of [game.homeId, game.awayId]) assert.deepEqual(both.scenarios.after[k].get(id), separately.after[k].get(id));
    }
  });

  it("a split still to come: the outlook still exactly the plain run's", async () => {
    process.env.FOOTSIMU_SAMPLE_DATA = "1";
    const gsl = getLeagueByCode("GSL")!;
    const data = await getLeagueData(gsl);
    const game = data.fixtures.find((f) => !f.result)!;
    const scores = { home: { home: 1, away: 0 }, draw: { home: 1, away: 1 }, away: { home: 0, away: 1 } };
    const both = outlookWithResults(gsl, { ...data, seasonKey: `${data.seasonKey}:endpoint` }, game, () => scores)!;
    const plain = leagueOutlook(gsl, data)!;
    assert.deepEqual([...both.outlook.clubs.values()].map((c) => c.distribution), [...plain.clubs.values()].map((c) => c.distribution));
  });
});

describe("a table built from the games already played once", () => {
  it("the same rows as computeStandings, whatever the tiebreakers, deductions, starting points or clubs in the table", () => {
    const teams = snap.teams;
    const fixed: ResultMap = Object.fromEntries(snap.fixtures.filter((f) => f.result).map((f) => [f.id, f.result!]));
    const open = snap.fixtures.filter((f) => !f.result);
    const changing = new Set(open.map((f) => f.id));
    const ids = teams.map((t) => t.id);
    const configs: StandingsOptions[] = [
      { tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints"], includeForm: false },
      { tiebreakers: ["points", "headToHeadPoints", "headToHeadGoalDifference", "goalDifference", "goalsFor"], includeForm: false },
      { tiebreakers: ["points", "wins", "awayGoalsFor"], includeForm: false, deductions: { [ids[0]!]: 6, [ids[5]!]: 1 } },
      { tiebreakers: ["points", "headToHeadGoalsFor", "headToHeadAwayGoalsFor"], includeForm: false, startPoints: { [ids[2]!]: 4 }, fallbackOrder: [...ids].reverse() },
    ];
    const rng = createRng(11);
    for (const options of configs) {
      for (const subset of [teams, teams.slice(0, 9)]) {
        const build = standingsBuilder(subset, snap.fixtures, fixed, options, changing)!;
        for (let i = 0; i < 60; i++) {
          // Low scores, so clubs end level on points (and the tiebreakers decide) often.
          const results: ResultMap = { ...fixed };
          for (const f of open) if (rng() < 0.9) results[f.id] = { home: Math.floor(rng() * 3), away: Math.floor(rng() * 3) };
          assert.deepEqual(build(results), computeStandings(subset, snap.fixtures, results, options));
        }
      }
    }
    // Tables it can't do: computeStandings then.
    assert.equal(standingsBuilder(teams, snap.fixtures, fixed, { tiebreakers: ["points"] }, changing), undefined, "with the form column");
    assert.equal(standingsBuilder(teams, snap.fixtures, fixed, { tiebreakers: ["points"], includeForm: false, split: { afterRound: 30, groups: [{ size: 6 }] } }, changing), undefined, "a split");
  });
});

describe("the section's words, from numbers worked out once", () => {
  it("one set of numbers, each language its own words", () => {
    const game = nextGame(plData);
    const home = plData.teams.find((t) => t.id === game.homeId)!;
    const away = plData.teams.find((t) => t.id === game.awayId)!;
    const numbers: ImpactNumbers = {
      scores: { home: { home: 2, away: 1 }, draw: { home: 1, away: 1 }, away: { home: 1, away: 2 } },
      rows: [{ teamId: home.id, kind: "title", zone: "title", now: 0.3, home: 0.36, draw: 0.29, away: 0.25 }],
      iterations: 10_000,
    };
    const match = { home, away, fixture: game, slug: "x", path: "/x" } as never;
    const views = (["en", "pt", "es"] as const).map((locale) => {
      const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));
      return impactView(match, numbers, locale, createTranslator({ locale, messages, namespace: "Match" }) as never, createTranslator({ locale, messages, namespace: "Zones" }) as never);
    });
    assert.deepEqual(views.map((v) => v.heads.map((h) => h.score)), [["2–1", "1–1", "1–2"], ["2–1", "1–1", "1–2"], ["2–1", "1–1", "1–2"]]);
    assert.deepEqual(views.map((v) => v.rows[0]!.cells.map((c) => c.change.tone)), [["better", "worse", "worse"], ["better", "worse", "worse"], ["better", "worse", "worse"]]);
    assert.equal(new Set(views.map((v) => v.note)).size, 3, "three languages");
    assert.match(views[0]!.note, /10,000/);
    assert.match(views[1]!.note, /10\.000/);
  });
});
