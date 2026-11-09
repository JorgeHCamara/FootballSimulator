import { expectedGoals } from "./match.ts";
import { sampleDixonColes } from "./match.ts";
import { simulatePenalties } from "./playoffs.ts";
import type { LeagueModel } from "./ratings.ts";
import type { Rng } from "./rng.ts";
import type { Fixture, ResultMap, Score, TeamId } from "./types.ts";

// Colombia's Primera B 2026 (Dimayor's Reglamento Torneo BetPlay 2026, Arts.
// 19–25): two places in the 2027 Primera A, from the champions of its two
// tournaments and the aggregate table (reclasificación) of every game of both:
// - one club wins both: it goes up, and the aggregate table's two best other
//   clubs play off (repechaje) for the second place;
// - two champions, both in the aggregate table's top two: both go up;
// - one of them in the top two: it goes up, and the other plays off against
//   the best-placed other club;
// - neither: they meet in a grand final; its winner goes up and its loser
//   plays off against the aggregate table's leader.
// The grand final and the play-off are two legs; the better-placed club in
// the aggregate table plays the first away; more points, then goal difference
// (the aggregate), then penalties.

export type PromotionTieKind = "grandFinal" | "playoff";

/** A two-legged tie of the promotion path: `higher` is better placed in the aggregate table (away first, at home second). */
export interface PromotionTie {
  kind: PromotionTieKind;
  higher: TeamId;
  lower: TeamId;
}

/**
 * Who goes up and who plays for it, once both champions and the aggregate
 * table are known. `direct`: up without a tie. The play-off's lower side is
 * the grand final's loser when there is one (`fromGrandFinal`).
 */
export interface PromotionPath {
  direct: TeamId[];
  grandFinal?: PromotionTie;
  /** The play-off: both clubs, or (after a grand final) its loser against `against`. */
  playoff?: PromotionTie | { kind: "playoff"; fromGrandFinal: true; against: TeamId };
  /** Which rule applies (Arts. 20–21): one double champion; both champions in the top two; one; neither. */
  rule: "doubleChampion" | "bothTop" | "oneTop" | "neitherTop";
}

/** The two clubs of a tie, the better placed in the aggregate table (`order`) as `higher`. */
export function promotionTie(kind: PromotionTieKind, a: TeamId, b: TeamId, order: readonly TeamId[]): PromotionTie {
  const [higher, lower] = order.indexOf(a) <= order.indexOf(b) ? [a, b] : [b, a];
  return { kind, higher, lower };
}

/** The promotion path from the tournaments' champions (oldest first) and the aggregate table's order. */
export function promotionPath(champions: readonly [TeamId, TeamId], order: readonly TeamId[]): PromotionPath {
  const [first, second] = champions;
  if (first === second) {
    const [a, b] = order.filter((id) => id !== first);
    return { rule: "doubleChampion", direct: [first], ...(a !== undefined && b !== undefined ? { playoff: promotionTie("playoff", a, b, order) } : {}) };
  }
  const top = new Set(order.slice(0, 2));
  const inTop = [first, second].filter((id) => top.has(id));
  if (inTop.length === 2) return { rule: "bothTop", direct: [first, second] };
  if (inTop.length === 1) {
    const up = inTop[0]!;
    const other = up === first ? second : first;
    const best = order.find((id) => id !== first && id !== second)!;
    return { rule: "oneTop", direct: [up], playoff: promotionTie("playoff", other, best, order) };
  }
  const leader = order.find((id) => id !== first && id !== second)!;
  return { rule: "neitherTop", direct: [], grandFinal: promotionTie("grandFinal", first, second, order), playoff: { kind: "playoff", fromGrandFinal: true, against: leader } };
}

/** A tie's legs: the lower side at home first, the higher second. */
export function tieLegs(t: PromotionTie, ids: readonly [number, number], afterDate: string): Fixture[] {
  const week = 7 * 24 * 3600 * 1000;
  const start = Date.parse(afterDate) || Date.now();
  return [
    { id: ids[0], matchday: 0, utcDate: new Date(start + week).toISOString(), homeId: t.lower, awayId: t.higher, result: null },
    { id: ids[1], matchday: 0, utcDate: new Date(start + week + 4 * 24 * 3600 * 1000).toISOString(), homeId: t.higher, awayId: t.lower, result: null },
  ];
}

/** A two-legged tie's winner from its legs' scores (and the shoot-out, home side = `higher`, when level): null while one is missing. */
export function tieWinner(t: PromotionTie, legs: readonly (Score | null | undefined)[], shootout?: Score | null): TeamId | null {
  const [first, second] = legs;
  if (!first || !second) return null;
  // First leg: lower at home; second: higher at home.
  const higher = first.away + second.home;
  const lower = first.home + second.away;
  if (higher !== lower) return higher > lower ? t.higher : t.lower;
  if (!shootout || shootout.home === shootout.away) return null;
  return shootout.home > shootout.away ? t.higher : t.lower;
}

/** Plays a tie: its known legs (and shoot-out) as they are, the rest drawn from the model. */
export function playTie(t: PromotionTie, model: LeagueModel, rng: Rng, known: { legs?: readonly (Score | null | undefined)[]; shootout?: Score | null } = {}): TeamId {
  const legs = [0, 1].map((i) => known.legs?.[i] ?? sampleDixonColes(i === 0 ? expectedGoals(model, t.lower, t.higher) : expectedGoals(model, t.higher, t.lower), model.rho ?? 0, rng));
  return tieWinner(t, legs, known.shootout) ?? tieWinner(t, legs, simulatePenalties(rng))!;
}

/** The real promotion games (a tie's legs, by its two clubs) as known scores for playTie. */
export function knownLegs(t: PromotionTie, games: readonly Fixture[] | undefined, results: ResultMap = {}): { legs: (Score | null)[]; shootout: Score | null } {
  const legs = [
    games?.find((f) => f.homeId === t.lower && f.awayId === t.higher),
    games?.find((f) => f.homeId === t.higher && f.awayId === t.lower),
  ];
  const score = (f: Fixture | undefined) => (f ? (results[f.id] ?? f.result) : null);
  const second = legs[1];
  // The shoot-out after the second leg (the higher side at home).
  const shootout = second?.penalties ?? null;
  return { legs: legs.map(score), shootout };
}
