import type { CupConfig } from "../config/cups.ts";
import { bracketBase, bracketLines, bracketPairs, cupGameId, cupSecondLegId, cupShootoutId, drawRoundRandom, hostFirst, iterationRng, type CupBuildOptions, type RealCupTie } from "./cup.ts";
import { cupModelFor } from "./cupModel.ts";
import { expectedGoals, expectedGoalsNeutral, simulateScore } from "./match.ts";
import { simulatePenalties } from "./playoffs.ts";
import type { LeagueModel, TeamStrength } from "./ratings.ts";
import type { Rng } from "./rng.ts";
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
  options: Pick<CupBuildOptions, "entrants" | "tiers">;
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

interface TieSpec {
  /** Home club of the first (or only) game. */
  first: TeamId;
  second: TeamId;
  /** Known scores per leg (home of that leg first), null to simulate. */
  legs: (Score | null)[];
  /** Home club per leg. */
  hosts: TeamId[];
  /** Known shoot-out score, home = the last leg's home club. */
  pens: Score | null;
}

/** Plays a tie: known legs kept, the rest simulated; level aggregate goes to penalties. */
function playTie(spec: TieSpec, model: LeagueModel, neutral: boolean, rng: Rng): TeamId {
  let first = 0;
  let second = 0;
  spec.legs.forEach((known, i) => {
    const host = spec.hosts[i]!;
    const guest = host === spec.first ? spec.second : spec.first;
    const score = known ?? simulateScore(neutral ? expectedGoalsNeutral(model, host, guest) : expectedGoals(model, host, guest), rng);
    const firstAtHome = host === spec.first;
    first += firstAtHome ? score.home : score.away;
    second += firstAtHome ? score.away : score.home;
  });
  if (first !== second) return first > second ? spec.first : spec.second;
  const pens = spec.pens && spec.pens.home !== spec.pens.away ? spec.pens : simulatePenalties(rng);
  const lastHost = spec.hosts.at(-1)!;
  const hostWins = pens.home > pens.away;
  return hostWins ? lastHost : lastHost === spec.first ? spec.second : spec.first;
}

/**
 * Plays the rest of the cup many times. Undrawn rounds get a fresh random draw
 * every run, so the chances include the luck of the draw. A round whose
 * entrants aren't known (only the real draw names them) ends the run.
 */
export function runCupMonteCarlo(input: CupMonteCarloInput): CupMonteCarloResult {
  const { config, fixed, options, iterations } = input;
  const roundCount = config.rounds.length;
  const strengths = new Map(Object.entries(input.strengths).map(([id, s]) => [Number(id), s]));
  const entrants = config.rounds.map((round) => options.entrants[round.key] ?? []);
  const realByRound = config.rounds.map((round) =>
    input.real.filter((t) => t.round === round.key).sort((a, b) => a.legs[0]!.id - b.legs[0]!.id).slice(0, round.ties),
  );
  const allClubs = [...realByRound.flat().flatMap((t) => [t.homeId, t.awayId]), ...entrants.flat()];
  const model = cupModelFor(strengths, allClubs, config.outsiderTier);

  const reached: Record<TeamId, number[]> = {};
  const won: Record<TeamId, number> = {};
  const count = (id: TeamId, r: number) => {
    (reached[id] ??= new Array<number>(roundCount).fill(0))[r]!++;
  };

  const base = bracketBase(config);
  for (let i = 0; i < iterations; i++) {
    const rng = iterationRng(input.seed, i);
    let lines: Map<TeamId, number> | null = null;
    let previous: TeamId[] = [];
    for (let r = 0; r < roundCount; r++) {
      const round = config.rounds[r]!;
      const twoLegs = round.legs === 2;
      const neutral = Boolean(round.neutral ?? round.venue);
      const reals = realByRound[r]!;
      const placed = new Set(reals.flatMap((t) => [t.homeId, t.awayId]));
      const participants = [...new Set([...previous, ...entrants[r]!, ...placed])];
      if (reals.length < round.ties && participants.length < round.ties * 2) break;
      for (const id of participants) count(id, r);

      const specs: TieSpec[] = reals.map((t, slot) => {
        const ids = twoLegs ? [cupGameId(r, slot), cupSecondLegId(r, slot)] : [cupGameId(r, slot)];
        const hosts = ids.map((_, n) => t.legs[n]?.homeId ?? (n === 0 ? t.homeId : t.awayId));
        return {
          first: t.homeId,
          second: t.awayId,
          legs: ids.map((id, n) => fixed[id] ?? t.legs[n]?.result ?? null),
          hosts,
          pens: fixed[cupShootoutId(r, slot)] ?? t.legs[ids.length - 1]?.penalties ?? null,
        };
      });
      const remaining = participants.filter((id) => !placed.has(id));
      let pairs: [TeamId, TeamId][];
      if (round.bracket && lines) {
        const fixed = bracketPairs(remaining, lines, r - base);
        pairs = [...fixed.pairs, ...drawRoundRandom(fixed.rest, rng)];
      } else {
        pairs = drawRoundRandom(remaining, rng);
      }
      for (const pair of pairs) {
        if (specs.length >= round.ties) break;
        const [home, away] = hostFirst(round, pair[0], pair[1], options.tiers);
        specs.push({ first: home, second: away, legs: twoLegs ? [null, null] : [null], hosts: twoLegs ? [home, away] : [home], pens: null });
      }
      if (specs.length < round.ties) break;
      if (r === base) lines = bracketLines(config, specs.map((spec) => ({ homeId: spec.first, awayId: spec.second })));
      previous = specs.map((spec) => playTie(spec, model, neutral, rng));
      if (r === roundCount - 1) won[previous[0]!] = (won[previous[0]!] ?? 0) + 1;
    }
  }
  return { iterations, reached, won };
}
