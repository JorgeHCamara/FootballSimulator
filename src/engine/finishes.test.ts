import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assign, likelyFinishRange, mostLikelyPlaces } from "./finishes.ts";
import { createRng } from "./rng.ts";

/** Every way of giving each row a different column: the cheapest total, by brute force. */
function cheapest(cost: number[][]): number {
  const m = cost[0]!.length;
  const go = (i: number, used: Set<number>): number => {
    if (i === cost.length) return 0;
    let best = Infinity;
    for (let j = 0; j < m; j++) if (!used.has(j)) best = Math.min(best, cost[i]![j]! + go(i + 1, new Set([...used, j])));
    return best;
  };
  return go(0, new Set());
}

describe("the most likely final table", () => {
  it("three clubs whose likeliest place is the same each get their own", () => {
    // Série B: three clubs all likeliest 6th, the better one keeps it.
    const places = mostLikelyPlaces(
      [
        [0, 0, 0, 0, 0.2, 0.3, 0.25, 0.25],
        [0, 0, 0, 0, 0.1, 0.28, 0.27, 0.35],
        [0, 0, 0, 0, 0.3, 0.32, 0.2, 0.18],
        [0.4, 0.3, 0.2, 0.1, 0, 0, 0, 0],
        [0.3, 0.3, 0.3, 0.1, 0, 0, 0, 0],
        [0.2, 0.3, 0.3, 0.2, 0, 0, 0, 0],
        [0.1, 0.1, 0.2, 0.6, 0, 0, 0, 0],
        [0, 0, 0, 0, 0.4, 0.1, 0.28, 0.22],
      ],
      [5, 6, 7, 0, 1, 2, 3, 4],
    );
    assert.equal(new Set(places).size, 8);
    assert.deepEqual(places.slice(0, 3).map((p) => p + 1), [7, 8, 6]);
  });

  it("the cheapest assignment, checked against every possible one", () => {
    const rng = createRng(42);
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(rng() * 6);
      const m = n + Math.floor(rng() * 2);
      const cost = Array.from({ length: n }, () => Array.from({ length: m }, () => Math.round(rng() * 20)));
      const out = assign(cost);
      assert.equal(new Set(out).size, n);
      assert.ok(out.every((j) => j >= 0 && j < m));
      assert.equal(out.reduce((sum, j, i) => sum + cost[i]![j]!, 0), cheapest(cost));
    }
  });

  it("a settled table keeps its order, and equal chances keep the current one", () => {
    assert.deepEqual(mostLikelyPlaces([[0, 1, 0], [1, 0, 0], [0, 0, 1]], [1, 0, 2]), [1, 0, 2]);
    const even = [1 / 3, 1 / 3, 1 / 3];
    assert.deepEqual(mostLikelyPlaces([even, even, even], [2, 0, 1]), [2, 0, 1]);
    assert.deepEqual(mostLikelyPlaces([], []), []);
  });
});

describe("a club's likely finish range", () => {
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-12;

  it("the shortest run of places covering at least 75% of the club's chances", () => {
    // Peaks at 3rd: 3rd–4th has 80%, and no single place has 75%.
    const r = likelyFinishRange([0, 0.1, 0.5, 0.3, 0.1]);
    assert.deepEqual([r.from, r.to], [3, 4]);
    assert.ok(close(r.chance, 0.8));
    // One place can be enough.
    assert.deepEqual(likelyFinishRange([0.9, 0.1]), { from: 1, to: 1, chance: 0.9 });
    // Spread out: a longer run.
    const wide = likelyFinishRange([0.1, 0.15, 0.2, 0.2, 0.15, 0.1, 0.1]);
    assert.deepEqual([wide.from, wide.to], [2, 6]);
    assert.ok(wide.chance >= 0.75);
  });

  it("runs of the same length: the likelier; then the one nearest the expected place", () => {
    // 2nd–3rd 75%, 3rd–4th 76%: the likelier wins, though 2nd–3rd is nearer the expected place (2.83).
    const r = likelyFinishRange([0.09, 0.15, 0.6, 0.16]);
    assert.deepEqual([r.from, r.to], [3, 4]);
    // 2nd–3rd and 3rd–4th both 75%; the expected place (3.15) is nearer 3rd–4th.
    const tie = likelyFinishRange([0, 0.2, 0.55, 0.2, 0, 0.05]);
    assert.deepEqual([tie.from, tie.to], [3, 4]);
    assert.ok(close(tie.chance, 0.75));
  });

  it("no run reaching 75% (chances adding up to less): every place; nothing at all: 1st", () => {
    assert.deepEqual(likelyFinishRange([0.1, 0.1, 0.1]), { from: 1, to: 3, chance: 0.1 + 0.1 + 0.1 });
    assert.deepEqual(likelyFinishRange([]), { from: 1, to: 1, chance: 0 });
    // Another coverage.
    assert.deepEqual([likelyFinishRange([0, 0.1, 0.5, 0.3, 0.1], 0.5).from, likelyFinishRange([0, 0.1, 0.5, 0.3, 0.1], 0.5).to], [3, 3]);
  });
});

