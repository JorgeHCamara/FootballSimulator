import type { Fixture, ResultMap, Score } from "./types.ts";

/**
 * Merges real results with user/simulated results. Overrides win, so users can
 * "rewrite" a played match when they explicitly choose to.
 */
export function effectiveResults(fixtures: readonly Fixture[], overrides: ResultMap = {}): ResultMap {
  const out: ResultMap = {};
  for (const f of fixtures) {
    const score = overrides[f.id] ?? f.result;
    if (score) out[f.id] = score;
  }
  return out;
}

export function realResults(fixtures: readonly Fixture[]): ResultMap {
  return effectiveResults(fixtures);
}

export function isValidScore(score: Score): boolean {
  return (
    Number.isInteger(score.home) &&
    Number.isInteger(score.away) &&
    score.home >= 0 &&
    score.away >= 0 &&
    score.home <= 99 &&
    score.away <= 99
  );
}
