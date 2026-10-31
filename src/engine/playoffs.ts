import type { Fixture, ResultMap, StandingRow, TeamId } from "./types.ts";

// Two-legged knockout ties seeded from the final table (e.g. Série B's promotion
// play-off: 3rd v 6th and 4th v 5th). The better-placed club plays the second leg
// at home and goes through if the aggregate is level ("draw advantage").

/** Play-off legs get synthetic fixture ids far above any real one. */
export const PLAYOFF_ID_BASE = 2_000_000_000;

export interface TwoLeggedTie {
  /** Positions in the table, better-placed first, e.g. [3, 6]. */
  seeds: readonly [number, number];
  higher: TeamId;
  lower: TeamId;
  /** Lower seed at home. */
  leg1: Fixture;
  /** Higher seed at home. */
  leg2: Fixture;
}

export function playoffLegIds(tieCount: number): number[] {
  return Array.from({ length: tieCount * 2 }, (_, i) => PLAYOFF_ID_BASE + i + 1);
}

/**
 * Builds the ties from the table. `real` holds already-played play-off games
 * (from the data feed); a leg takes its real result when the same home and away
 * clubs are found there.
 */
export function buildTwoLeggedTies(
  rows: readonly StandingRow[],
  pairs: readonly (readonly [number, number])[],
  options: { afterMatchday: number; afterDate: string; real?: readonly Fixture[] },
): TwoLeggedTie[] {
  const at = (position: number) => rows.find((r) => r.position === position)?.teamId;
  const week = 7 * 24 * 60 * 60 * 1000;
  const start = Date.parse(options.afterDate) || Date.now();

  const findReal = (homeId: TeamId, awayId: TeamId) =>
    options.real?.find((f) => f.homeId === homeId && f.awayId === awayId);

  const ties: TwoLeggedTie[] = [];
  pairs.forEach(([better, worse], i) => {
    const higher = at(better);
    const lower = at(worse);
    if (higher === undefined || lower === undefined) return;
    const leg = (n: 1 | 2): Fixture => {
      const homeId = n === 1 ? lower : higher;
      const awayId = n === 1 ? higher : lower;
      const real = findReal(homeId, awayId);
      return {
        id: PLAYOFF_ID_BASE + i * 2 + n,
        matchday: options.afterMatchday + n,
        utcDate: real?.utcDate ?? new Date(start + n * week).toISOString(),
        homeId,
        awayId,
        result: real?.result ?? null,
      };
    };
    ties.push({ seeds: [better, worse], higher, lower, leg1: leg(1), leg2: leg(2) });
  });
  return ties;
}

export interface TieOutcome {
  /** Goals over both legs. */
  higherGoals: number;
  lowerGoals: number;
  winner: TeamId;
}

/** Null until both legs have a score. */
export function tieOutcome(tie: TwoLeggedTie, results: ResultMap): TieOutcome | null {
  const first = results[tie.leg1.id] ?? tie.leg1.result;
  const second = results[tie.leg2.id] ?? tie.leg2.result;
  if (!first || !second) return null;
  const higherGoals = first.away + second.home;
  const lowerGoals = first.home + second.away;
  return { higherGoals, lowerGoals, winner: lowerGoals > higherGoals ? tie.lower : tie.higher };
}
