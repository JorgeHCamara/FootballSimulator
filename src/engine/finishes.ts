/*
 * The most likely final table: every club a place of its own. Each club's
 * likeliest place on its own can be the same for several (three clubs whose
 * likeliest finish is 6th); instead the places are shared out one per club
 * so the table as a whole is as likely as it can be (the product of each
 * club's chance of its place, the largest over every way of filling the
 * table), the assignment problem, solved exactly (Hungarian algorithm).
 */

/** A chance this small or none counts as this (so a place a club can't reach costs a lot but stays comparable). */
const FLOOR = 1e-12;
/** Between equally likely tables, the one nearest the current table (far below any real difference in chances). */
const TIE = 1e-9;

/**
 * Each club's place (0-based) in the most likely final table, from its
 * chance of each place (`distributions[i][p]`) and its place now
 * (`current[i]`, for ties). Every club gets a different place; with more
 * clubs than places, each club's own likeliest one.
 */
export function mostLikelyPlaces(distributions: readonly (readonly number[])[], current: readonly number[]): number[] {
  const n = distributions.length;
  if (!n) return [];
  const m = Math.max(...distributions.map((d) => d.length));
  if (n > m) return distributions.map((d) => d.reduce((best, chance, p) => (chance > (d[best] ?? 0) ? p : best), 0));
  const cost = distributions.map((d, i) => Array.from({ length: m }, (_, p) => -Math.log(Math.max(FLOOR, d[p] ?? 0)) + TIE * Math.abs(p - (current[i] ?? p))));
  return assign(cost);
}

/** The cheapest assignment of each row to a different column (rows ≤ columns): each row's column. */
export function assign(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  // Potentials (u rows, v columns), the row in each column (p, 1-based, 0 = free) and the path back (way).
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Infinity);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else minv[j]! -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }
  const out = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]) out[p[j]! - 1] = j - 1;
  return out;
}

/** A run of finishing places, 1-based and inclusive, and the club's chance of ending in it. */
export interface FinishRange {
  from: number;
  to: number;
  chance: number;
}

/** Sums this close to the coverage count as reaching it (the chances are counts over the seasons, summed in floating point). */
const EPSILON = 1e-9;

/**
 * A club's likely finish: the shortest run of consecutive places whose
 * chances add up to at least `minCoverage` of its own distribution (index 0 =
 * 1st). Runs of the same length: the likelier, then the one whose middle is
 * nearest the club's expected place. When no run reaches it (chances adding
 * up to less), every place.
 */
export function likelyFinishRange(distribution: readonly number[], minCoverage = 0.75): FinishRange {
  const n = distribution.length;
  if (!n) return { from: 1, to: 1, chance: 0 };
  const prefix = [0];
  for (const p of distribution) prefix.push(prefix.at(-1)! + p);
  const total = prefix[n]!;
  const expected = total > 0 ? distribution.reduce((sum, p, i) => sum + p * (i + 1), 0) / total : (n + 1) / 2;
  for (let length = 1; length <= n; length++) {
    let best: FinishRange | undefined;
    for (let from = 1; from + length - 1 <= n; from++) {
      const to = from + length - 1;
      const chance = prefix[to]! - prefix[from - 1]!;
      if (chance < minCoverage - EPSILON) continue;
      const distance = Math.abs((from + to) / 2 - expected);
      if (!best || chance > best.chance + EPSILON || (Math.abs(chance - best.chance) <= EPSILON && distance < Math.abs((best.from + best.to) / 2 - expected))) best = { from, to, chance };
    }
    if (best) return best;
  }
  return { from: 1, to: n, chance: total };
}
