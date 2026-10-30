import type { LeagueModel } from "./ratings.ts";
import type { Rng } from "./rng.ts";
import type { Fixture, ResultMap, Score, TeamId } from "./types.ts";

const MIN_RATE = 0.1;
const MAX_RATE = 6;

const clampRate = (x: number) => Math.min(MAX_RATE, Math.max(MIN_RATE, x));

export interface ExpectedGoals {
  home: number;
  away: number;
}

export function expectedGoals(model: LeagueModel, homeId: TeamId, awayId: TeamId): ExpectedGoals {
  const h = model.strengths.get(homeId) ?? { attack: 1, defence: 1 };
  const a = model.strengths.get(awayId) ?? { attack: 1, defence: 1 };
  return {
    home: clampRate(model.avgHomeGoals * h.attack * a.defence),
    away: clampRate(model.avgAwayGoals * a.attack * h.defence),
  };
}

/** Knuth's algorithm; fine for the small rates found in football. */
export function samplePoisson(lambda: number, rng: Rng): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = rng();
  while (p > limit) {
    k++;
    p *= rng();
  }
  return k;
}

export function simulateScore(xg: ExpectedGoals, rng: Rng): Score {
  return { home: samplePoisson(xg.home, rng), away: samplePoisson(xg.away, rng) };
}

function poissonPmf(lambda: number, maxGoals: number): number[] {
  const pmf: number[] = [Math.exp(-lambda)];
  for (let k = 1; k <= maxGoals; k++) pmf.push(pmf[k - 1]! * (lambda / k));
  return pmf;
}

export interface OutcomeProbabilities {
  home: number;
  draw: number;
  away: number;
}

/** Exact home/draw/away probabilities under the independent-Poisson model. */
export function outcomeProbabilities(xg: ExpectedGoals, maxGoals = 12): OutcomeProbabilities {
  const ph = poissonPmf(xg.home, maxGoals);
  const pa = poissonPmf(xg.away, maxGoals);
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const p = ph[i]! * pa[j]!;
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  }
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

/** Simulates every fixture that has no entry in `known`; returns only the new results. */
export function simulateFixtures(
  fixtures: readonly Fixture[],
  known: ResultMap,
  model: LeagueModel,
  rng: Rng,
): ResultMap {
  const out: ResultMap = {};
  for (const f of fixtures) {
    if (known[f.id]) continue;
    out[f.id] = simulateScore(expectedGoals(model, f.homeId, f.awayId), rng);
  }
  return out;
}
