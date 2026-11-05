import type { LeagueModel } from "./ratings.ts";
import type { Rng } from "./rng.ts";
import type { Fixture, ResultMap, Score, TeamId } from "./types.ts";

const MIN_RATE = 0.1;
const MAX_RATE = 6;
/** Goals per side the score matrix covers (0..10); the rest is folded in by renormalising. */
export const MAX_SCORE = 10;

export const clampRate = (x: number) => Math.min(MAX_RATE, Math.max(MIN_RATE, x));

export interface ExpectedGoals {
  home: number;
  away: number;
}

/**
 * A club's home/away split relative to the league's (1 = the league's home
 * advantage), applied half to each venue in log terms: k^¼ on both sides of
 * its home games, k^-¼ on its away games, so its average strength is unchanged.
 */
export const venueFactor = (model: LeagueModel, id: TeamId) => Math.pow(model.homeFactor?.get(id) ?? 1, 0.25);

export function expectedGoals(model: LeagueModel, homeId: TeamId, awayId: TeamId): ExpectedGoals {
  const h = model.strengths.get(homeId) ?? { attack: 1, defence: 1 };
  const a = model.strengths.get(awayId) ?? { attack: 1, defence: 1 };
  const venue = venueFactor(model, homeId) * venueFactor(model, awayId);
  return {
    home: clampRate(model.avgHomeGoals * h.attack * a.defence * venue),
    away: clampRate((model.avgAwayGoals * a.attack * h.defence) / venue),
  };
}

/** Neutral ground: both sides get the league's average scoring rate, no home advantage. */
export function expectedGoalsNeutral(model: LeagueModel, aId: TeamId, bId: TeamId): ExpectedGoals {
  const base = (model.avgHomeGoals + model.avgAwayGoals) / 2;
  const a = model.strengths.get(aId) ?? { attack: 1, defence: 1 };
  const b = model.strengths.get(bId) ?? { attack: 1, defence: 1 };
  return { home: clampRate(base * a.attack * b.defence), away: clampRate(base * b.attack * a.defence) };
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

function poissonPmf(lambda: number, maxGoals: number): number[] {
  const pmf: number[] = [Math.exp(-lambda)];
  for (let k = 1; k <= maxGoals; k++) pmf.push(pmf[k - 1]! * (lambda / k));
  return pmf;
}

/**
 * Dixon–Coles correction for the low scores, where goals aren't independent:
 * with rho < 0, 0–0 and 1–1 are more likely and 1–0 and 0–1 less, than two
 * independent Poisson counts say. 1 elsewhere.
 */
export function dixonColesTau(home: number, away: number, xg: ExpectedGoals, rho: number): number {
  const { home: l, away: m } = xg;
  if (home === 0 && away === 0) return 1 - l * m * rho;
  if (home === 0 && away === 1) return 1 + l * rho;
  if (home === 1 && away === 0) return 1 + m * rho;
  if (home === 1 && away === 1) return 1 - rho;
  return 1;
}

/**
 * The score distribution: P(home = i, away = j) for 0..max goals each, as a
 * row-major matrix (index i × (max + 1) + j), Poisson with the Dixon–Coles
 * correction, renormalised to sum to 1.
 */
export function scoreMatrix(xg: ExpectedGoals, rho = 0, max = MAX_SCORE): Float64Array {
  const ph = poissonPmf(xg.home, max);
  const pa = poissonPmf(xg.away, max);
  const size = max + 1;
  const out = new Float64Array(size * size);
  let total = 0;
  for (let i = 0; i <= max; i++) {
    for (let j = 0; j <= max; j++) {
      const p = ph[i]! * pa[j]! * Math.max(0, dixonColesTau(i, j, xg, rho));
      out[i * size + j] = p;
      total += p;
    }
  }
  for (let k = 0; k < out.length; k++) out[k]! /= total;
  return out;
}

/** A sampler for one fixture's score: its matrix as a cumulative distribution. */
export interface ScoreSampler {
  cdf: Float64Array;
  size: number;
}

export function scoreSampler(xg: ExpectedGoals, rho = 0, max = MAX_SCORE): ScoreSampler {
  const matrix = scoreMatrix(xg, rho, max);
  const cdf = new Float64Array(matrix.length);
  let sum = 0;
  for (let k = 0; k < matrix.length; k++) {
    sum += matrix[k]!;
    cdf[k] = sum;
  }
  return { cdf, size: max + 1 };
}

export function sampleScore(sampler: ScoreSampler, rng: Rng): Score {
  const u = rng() * sampler.cdf[sampler.cdf.length - 1]!;
  // Binary search: the first cell whose cumulative probability exceeds u.
  let lo = 0;
  let hi = sampler.cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sampler.cdf[mid]! > u) hi = mid;
    else lo = mid + 1;
  }
  return { home: Math.floor(lo / sampler.size), away: lo % sampler.size };
}

/**
 * One score from the Dixon–Coles distribution without building its matrix:
 * independent Poisson draws, kept with probability tau / max tau, up to `max`
 * goals a side (the distribution sampleScore(scoreSampler(xg, rho)) draws
 * from, by other draws). For rates that change from one simulated season to
 * the next (the season backtest's rating noise), where a matrix per game and
 * season would cost too much.
 */
export function sampleDixonColes(xg: ExpectedGoals, rho: number, rng: Rng, max = MAX_SCORE): Score {
  // dixonColesTau and samplePoisson written out (the same draws and the same answers): it runs for every
  // remaining game of every simulated season when the season outlook has rating noise.
  const { home: l, away: m } = xg;
  const t00 = 1 - l * m * rho;
  const t01 = 1 + l * rho;
  const t10 = 1 + m * rho;
  const t11 = 1 - rho;
  const tauMax = Math.max(1, t00, t01, t10, t11);
  const limitHome = Math.exp(-l);
  const limitAway = Math.exp(-m);
  for (;;) {
    let home = 0;
    let p = rng();
    while (p > limitHome) {
      home++;
      p *= rng();
    }
    let away = 0;
    p = rng();
    while (p > limitAway) {
      away++;
      p *= rng();
    }
    if (home > max || away > max) continue;
    const tau = home > 1 || away > 1 ? 1 : home === 0 ? (away === 0 ? t00 : t01) : away === 0 ? t10 : t11;
    if (rng() * tauMax < Math.max(0, tau)) return { home, away };
  }
}

/** A standard normal draw (Box–Muller). */
export function sampleNormal(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

/** One score drawn from the (Dixon–Coles adjusted) score distribution. */
export function simulateScore(xg: ExpectedGoals, rng: Rng, rho = 0): Score {
  return sampleScore(scoreSampler(xg, rho), rng);
}

export interface OutcomeProbabilities {
  home: number;
  draw: number;
  away: number;
}

/** Home/draw/away probabilities from the score distribution (adding up to 1). */
export function outcomeProbabilities(xg: ExpectedGoals, rho = 0, max = MAX_SCORE): OutcomeProbabilities {
  const matrix = scoreMatrix(xg, rho, max);
  const size = max + 1;
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const p = matrix[i * size + j]!;
      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  }
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

/** The `count` most likely scores, most likely first. */
export function likelyScores(xg: ExpectedGoals, rho = 0, count = 3): (Score & { p: number })[] {
  const matrix = scoreMatrix(xg, rho);
  const size = MAX_SCORE + 1;
  return [...matrix]
    .map((p, k) => ({ home: Math.floor(k / size), away: k % size, p }))
    .sort((a, b) => b.p - a.p || a.home + a.away - (b.home + b.away))
    .slice(0, count);
}

/*
 * "Likely roll": how the simulator's buttons fill in a score (the dice, and
 * simulating a matchday or the rest of the season). Only the likeliest scores
 * can come out, so a click never gives a long shot like 4–1 or 3–3. The
 * chances (season Monte Carlo) keep drawing from the full distribution.
 */
/** Share of the probability the likely scores cover, taken likeliest first. */
export const LIKELY_COVERAGE = 0.7;
/** At most this many likely scores, and at least this many. */
export const LIKELY_MAX_SCORES = 6;
export const LIKELY_MIN_SCORES = 3;
/** Their chances raised to this power (then renormalised): the likeliest comes up most, the others still do. */
export const LIKELY_SHARPEN = 1.5;
/** A result (home win, draw, away win) at least this likely always has a score in the set. */
export const LIKELY_RESULT_MIN = 0.2;

export interface LikelyScore extends Score {
  /** Its chance of being rolled (they add up to 1). */
  p: number;
}

const resultOf = (s: Score) => Math.sign(s.home - s.away);

/**
 * The scores a likely roll can give: the likeliest ones until they cover
 * LIKELY_COVERAGE (LIKELY_MIN_SCORES to LIKELY_MAX_SCORES of them), plus the
 * likeliest score of any result at least LIKELY_RESULT_MIN likely that none
 * of them has (in place of the least likely one whose result another covers,
 * when the set is full); their chances sharpened with LIKELY_SHARPEN.
 */
export function likelyScoreSet(xg: ExpectedGoals, rho = 0): LikelyScore[] {
  const matrix = scoreMatrix(xg, rho);
  const size = MAX_SCORE + 1;
  const cells = [...matrix]
    .map((p, k) => ({ home: Math.floor(k / size), away: k % size, p }))
    .sort((a, b) => b.p - a.p || a.home + a.away - (b.home + b.away));
  const set: (Score & { p: number })[] = [];
  let covered = 0;
  for (const cell of cells) {
    if (set.length >= LIKELY_MIN_SCORES && (covered >= LIKELY_COVERAGE || set.length >= LIKELY_MAX_SCORES)) break;
    set.push(cell);
    covered += cell.p;
  }
  // Every likely enough result (a 30% draw) can come out.
  const results = outcomeProbabilities(xg, rho);
  for (const [result, p] of [[1, results.home], [0, results.draw], [-1, results.away]] as const) {
    if (p < LIKELY_RESULT_MIN || set.some((s) => resultOf(s) === result)) continue;
    const best = cells.find((c) => resultOf(c) === result)!;
    if (set.length < LIKELY_MAX_SCORES) {
      set.push(best);
      continue;
    }
    // Full: drop the least likely score whose result another score still covers.
    for (let i = set.length - 1; i >= 0; i--) {
      const r = resultOf(set[i]!);
      if (set.filter((s) => resultOf(s) === r).length > 1) {
        set.splice(i, 1, best);
        break;
      }
    }
  }
  set.sort((a, b) => b.p - a.p);
  const weights = set.map((s) => Math.pow(s.p, LIKELY_SHARPEN));
  const total = weights.reduce((a, b) => a + b, 0);
  return set.map((s, i) => ({ home: s.home, away: s.away, p: weights[i]! / total }));
}

/**
 * A likely roll: one score from likelyScoreSet. With `avoid` (the score
 * already there), a re-roll gives another score from the set.
 */
export function sampleLikelyScore(xg: ExpectedGoals, rng: Rng, rho = 0, avoid?: Score): Score {
  const all = likelyScoreSet(xg, rho);
  const others = avoid ? all.filter((s) => s.home !== avoid.home || s.away !== avoid.away) : all;
  const set = others.length ? others : all;
  const total = set.reduce((sum, s) => sum + s.p, 0);
  let u = rng() * total;
  for (const s of set) {
    u -= s.p;
    if (u < 0) return { home: s.home, away: s.away };
  }
  const last = set.at(-1)!;
  return { home: last.home, away: last.away };
}

/**
 * Simulates every fixture that has no entry in `known`; returns only the new
 * results. Draws from the full score distribution, or with `likely`, makes
 * likely rolls (the simulator's buttons; never for the chances).
 */
export function simulateFixtures(
  fixtures: readonly Fixture[],
  known: ResultMap,
  model: LeagueModel,
  rng: Rng,
  { likely = false }: { likely?: boolean } = {},
): ResultMap {
  const out: ResultMap = {};
  for (const f of fixtures) {
    if (known[f.id]) continue;
    const xg = f.neutral ? expectedGoalsNeutral(model, f.homeId, f.awayId) : expectedGoals(model, f.homeId, f.awayId);
    out[f.id] = likely ? sampleLikelyScore(xg, rng, model.rho ?? 0) : simulateScore(xg, rng, model.rho ?? 0);
  }
  return out;
}
