import type { CupConfig } from "../config/cups.ts";
import { cupGameId, cupShootoutId, drawRoundRandom, iterationRng, type CupBuildOptions, type RealCupTie } from "./cup.ts";
import { cupModelFor } from "./cupModel.ts";
import { expectedGoals, expectedGoalsNeutral, simulateScore } from "./match.ts";
import { simulatePenalties } from "./playoffs.ts";
import type { TeamStrength } from "./ratings.ts";
import type { ResultMap, Score, TeamId } from "./types.ts";

export interface CupMonteCarloInput {
  config: CupConfig;
  real: readonly RealCupTie[];
  /**
   * Results treated as fixed: real results plus the user's predictions. They
   * apply to ties the real draw has made; rounds not drawn yet are redrawn in
   * every run, so predictions on simulated pairings don't carry over.
   */
  fixed: ResultMap;
  strengths: Record<TeamId, TeamStrength>;
  options: Pick<CupBuildOptions, "entrants">;
  iterations: number;
  seed: number;
}

export interface CupMonteCarloResult {
  iterations: number;
  /** reached[teamId][r] = runs in which the club was in round r's draw. */
  reached: Record<TeamId, number[]>;
  /** won[teamId] = runs the club won the cup. */
  won: Record<TeamId, number>;
}

/**
 * Plays the rest of the cup many times. Undrawn rounds get a fresh random draw
 * every run, so the chances include the luck of the draw.
 */
export function runCupMonteCarlo(input: CupMonteCarloInput): CupMonteCarloResult {
  const { config, fixed, options, iterations } = input;
  const roundCount = config.rounds.length;
  const strengths = new Map(Object.entries(input.strengths).map(([id, s]) => [Number(id), s]));
  const entrants = config.rounds.map((round) => options.entrants[round.key] ?? []);
  const realByRound = config.rounds.map((round) =>
    input.real.filter((t) => t.round === round.key).sort((a, b) => a.fixture.id - b.fixture.id).slice(0, round.ties),
  );
  const allClubs = [...realByRound.flat().flatMap((t) => [t.homeId, t.awayId]), ...entrants.flat()];
  const model = cupModelFor(strengths, allClubs);

  const reached: Record<TeamId, number[]> = {};
  const won: Record<TeamId, number> = {};
  const count = (id: TeamId, r: number) => {
    (reached[id] ??= new Array<number>(roundCount).fill(0))[r]!++;
  };

  for (let i = 0; i < iterations; i++) {
    const rng = iterationRng(input.seed, i);
    let previous: TeamId[] = [];
    for (let r = 0; r < roundCount; r++) {
      const round = config.rounds[r]!;
      const reals = realByRound[r]!;
      const placed = new Set(reals.flatMap((t) => [t.homeId, t.awayId]));
      const participants = [...new Set([...previous, ...entrants[r]!, ...placed])];
      for (const id of participants) count(id, r);
      const pairs: { home: TeamId; away: TeamId; real?: RealCupTie; slot: number }[] = reals.map((t, slot) => ({ home: t.homeId, away: t.awayId, real: t, slot }));
      for (const [home, away] of drawRoundRandom(participants.filter((id) => !placed.has(id)), rng)) {
        if (pairs.length >= round.ties) break;
        pairs.push({ home, away, slot: pairs.length });
      }
      const neutral = Boolean(round.venue);
      const winners: TeamId[] = [];
      for (const { home, away, real, slot } of pairs) {
        let score: Score | null = real ? (fixed[cupGameId(r, slot)] ?? real.fixture.result) : null;
        if (!score) score = simulateScore(neutral ? expectedGoalsNeutral(model, home, away) : expectedGoals(model, home, away), rng);
        let winner: TeamId;
        if (score.home !== score.away) {
          winner = score.home > score.away ? home : away;
        } else {
          let pens: Score | null = real ? (fixed[cupShootoutId(r, slot)] ?? real.fixture.penalties ?? null) : null;
          if (!pens || pens.home === pens.away) pens = simulatePenalties(rng);
          winner = pens.home > pens.away ? home : away;
        }
        winners.push(winner);
      }
      if (winners.length < round.ties) break;
      previous = winners;
      if (r === roundCount - 1) won[winners[0]!] = (won[winners[0]!] ?? 0) + 1;
    }
  }
  return { iterations, reached, won };
}
