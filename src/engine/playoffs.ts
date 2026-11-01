import { simulateFixtures } from "./match.ts";
import type { LeagueModel } from "./ratings.ts";
import type { Rng } from "./rng.ts";
import type { Fixture, ResultMap, Score, StandingRow, TeamId } from "./types.ts";

// End-of-season knockout play-offs seeded from the final table, e.g.
// - Série B: 3rd v 6th and 4th v 5th over two legs, better-placed club goes
//   through on a level aggregate;
// - Championship 2026/27: single-leg eliminators (5th v 8th, 6th v 7th),
//   two-legged semi-finals with 3rd and 4th, then a single final at Wembley;
//   level ties go to extra time and penalties.

export interface PlayoffRoundConfig {
  key: "eliminators" | "semiFinals" | "final";
  /** Two legs: the better-placed club hosts the second. One leg: it hosts the match (unless `venue`). */
  legs: 1 | 2;
  /** What decides a level tie: the better league position, or a penalty shoot-out. */
  levelTie: "betterPlaced" | "penalties";
  /** Single match at a neutral ground, e.g. "Wembley". */
  venue?: string;
  /** Fixed pairings by table position (first round). */
  pairs?: readonly (readonly [number, number])[];
  /** Positions that join in this round, alongside the previous round's winners. */
  entrants?: readonly number[];
}

export interface PlayoffConfig {
  rounds: readonly PlayoffRoundConfig[];
  /** Positions promoted without the play-off. */
  directPromotion: readonly number[];
  promotedTo: string;
}

/** Play-off legs get synthetic fixture ids far above any real one. */
export const PLAYOFF_ID_BASE = 2_000_000_000;

const legId = (round: number, tie: number, leg: 1 | 2) => PLAYOFF_ID_BASE + round * 100 + tie * 2 + leg;
const shootoutId = (round: number, tie: number) => PLAYOFF_ID_BASE + round * 100 + 50 + tie;

function tieCounts(config: PlayoffConfig): number[] {
  const counts: number[] = [];
  config.rounds.forEach((round, r) => {
    const fromPrevious = r === 0 ? 0 : counts[r - 1]!;
    const participants = (round.pairs?.length ?? 0) * 2 + (round.entrants?.length ?? 0) + fromPrevious;
    counts.push(Math.floor(participants / 2));
  });
  return counts;
}

/** Ids belonging to one tie (its legs and shoot-out), whether or not its clubs are known yet. */
export function tieIds(round: number, tie: number, config: PlayoffRoundConfig): number[] {
  return [
    legId(round, tie, 1),
    ...(config.legs === 2 ? [legId(round, tie, 2)] : []),
    ...(config.levelTie === "penalties" ? [shootoutId(round, tie)] : []),
  ];
}

export const isShootoutId = (id: number) => id > PLAYOFF_ID_BASE && (id - PLAYOFF_ID_BASE) % 100 >= 50;

/** Every synthetic id the play-off can use (legs and shoot-outs), for share links and clean-up. */
export function playoffIds(config: PlayoffConfig): number[] {
  const ids: number[] = [];
  tieCounts(config).forEach((count, r) => {
    const round = config.rounds[r]!;
    for (let t = 0; t < count; t++) {
      ids.push(legId(r, t, 1));
      if (round.legs === 2) ids.push(legId(r, t, 2));
      if (round.levelTie === "penalties") ids.push(shootoutId(r, t));
    }
  });
  return ids;
}

/** A club in a tie: known once the table (or the previous round) decides it. */
export interface PlayoffSide {
  teamId: TeamId | null;
  /** League position when known, or the position slot before the season ends. */
  position: number | null;
  /** For an undecided winner of an earlier tie: which one. */
  from?: { round: number; tie: number };
}

export interface PlayoffTie {
  round: number;
  index: number;
  config: PlayoffRoundConfig;
  higher: PlayoffSide;
  lower: PlayoffSide;
  /** Only when both clubs are known. */
  legs: Fixture[];
  /** Penalty shoot-out pseudo-fixture (higher = home); only for `penalties` rounds with known clubs. */
  shootout: Fixture | null;
}

export interface TieOutcome {
  higherGoals: number;
  lowerGoals: number;
  winner: TeamId;
  onPenalties: boolean;
}

/**
 * Result of a tie: aggregate, then draw advantage or the shoot-out. Null while a
 * leg is missing, or when level and the shoot-out hasn't been entered.
 */
export function tieOutcome(tie: PlayoffTie, results: ResultMap): TieOutcome | null {
  const { higher, lower } = tie;
  if (higher.teamId === null || lower.teamId === null || tie.legs.length === 0) return null;
  let higherGoals = 0;
  let lowerGoals = 0;
  for (const leg of tie.legs) {
    const score = results[leg.id] ?? leg.result;
    if (!score) return null;
    const higherHome = leg.homeId === higher.teamId;
    higherGoals += higherHome ? score.home : score.away;
    lowerGoals += higherHome ? score.away : score.home;
  }
  if (higherGoals !== lowerGoals) {
    return { higherGoals, lowerGoals, winner: higherGoals > lowerGoals ? higher.teamId : lower.teamId, onPenalties: false };
  }
  if (tie.config.levelTie === "betterPlaced") {
    return { higherGoals, lowerGoals, winner: higher.teamId, onPenalties: false };
  }
  const pens = tie.shootout ? (results[tie.shootout.id] ?? tie.shootout.result) : null;
  if (!pens || pens.home === pens.away) return null;
  return { higherGoals, lowerGoals, winner: pens.home > pens.away ? higher.teamId : lower.teamId, onPenalties: true };
}

/** True when all legs are played and level, so a shoot-out is needed. */
export function needsShootout(tie: PlayoffTie, results: ResultMap): boolean {
  if (tie.config.levelTie !== "penalties" || !tie.shootout) return false;
  const withoutPens = { ...results };
  delete withoutPens[tie.shootout.id];
  const legsDone = tie.legs.every((leg) => results[leg.id] ?? leg.result);
  return legsDone && tieOutcome({ ...tie, shootout: null }, withoutPens) === null;
}

export interface BracketOptions {
  /** Every league match has a score: clubs can be placed in the bracket. */
  seasonComplete: boolean;
  afterMatchday: number;
  afterDate: string;
  /** Real play-off games from the data feed; a leg takes the result of the same pairing. */
  real?: readonly Fixture[];
}

export function buildBracket(
  rows: readonly StandingRow[],
  config: PlayoffConfig,
  results: ResultMap,
  options: BracketOptions,
): PlayoffTie[][] {
  const positionOf = new Map(rows.map((r) => [r.teamId, r.position]));
  const teamAt = (position: number) => (options.seasonComplete ? (rows.find((r) => r.position === position)?.teamId ?? null) : null);
  const bySlot = (position: number): PlayoffSide => ({ teamId: teamAt(position), position });
  const week = 7 * 24 * 60 * 60 * 1000;
  const start = Date.parse(options.afterDate) || Date.now();
  const findReal = (homeId: TeamId, awayId: TeamId, neutral: boolean) =>
    options.real?.find(
      (f) => (f.homeId === homeId && f.awayId === awayId) || (neutral && f.homeId === awayId && f.awayId === homeId),
    );

  const rounds: PlayoffTie[][] = [];
  let weekOffset = 0;
  config.rounds.forEach((round, r) => {
    // Who plays: fixed pairs, or entrants plus the previous round's winners.
    let pairs: [PlayoffSide, PlayoffSide][];
    if (round.pairs) {
      pairs = round.pairs.map(([a, b]) => [bySlot(a), bySlot(b)]);
    } else {
      const winners: PlayoffSide[] = (rounds[r - 1] ?? []).map((tie, t) => {
        const outcome = tieOutcome(tie, results);
        return outcome
          ? { teamId: outcome.winner, position: positionOf.get(outcome.winner) ?? null }
          : { teamId: null, position: null, from: { round: r - 1, tie: t } };
      });
      const entrants = (round.entrants ?? []).map(bySlot);
      const all = [...entrants, ...winners];
      // Re-seed once everyone is known: best-placed v lowest-placed, and so on.
      const known = all.every((s) => s.teamId !== null);
      const ordered = known ? [...all].sort((a, b) => a.position! - b.position!) : all;
      const half = Math.floor(ordered.length / 2);
      pairs = Array.from({ length: half }, (_, i) => [ordered[i]!, ordered[ordered.length - 1 - i]!]);
    }

    rounds.push(
      pairs.map(([a, b], t) => {
        // Better-placed side is "higher"; unknown winners count as lower-placed.
        const [higher, lower] = (b.position ?? Infinity) < (a.position ?? Infinity) ? [b, a] : [a, b];
        const tie: PlayoffTie = { round: r, index: t, config: round, higher, lower, legs: [], shootout: null };
        if (higher.teamId === null || lower.teamId === null) return tie;
        const neutral = Boolean(round.venue);
        const leg = (n: 1 | 2, homeId: TeamId, awayId: TeamId): Fixture => {
          const real = findReal(homeId, awayId, neutral);
          const flipped = real && real.homeId !== homeId;
          return {
            id: legId(r, t, n),
            matchday: options.afterMatchday + weekOffset + n,
            utcDate: real?.utcDate ?? new Date(start + (weekOffset + n) * week).toISOString(),
            homeId,
            awayId,
            result: real?.result ? (flipped ? { home: real.result.away, away: real.result.home } : real.result) : null,
            ...(neutral ? { neutral: true } : {}),
          };
        };
        tie.legs =
          round.legs === 2
            ? [leg(1, lower.teamId, higher.teamId), leg(2, higher.teamId, lower.teamId)]
            : [leg(1, higher.teamId, lower.teamId)];
        if (round.levelTie === "penalties") {
          const last = tie.legs.at(-1)!;
          tie.shootout = { ...last, id: shootoutId(r, t), homeId: higher.teamId, awayId: lower.teamId, result: null };
        }
        return tie;
      }),
    );
    weekOffset += round.legs;
  });
  return rounds;
}

/** Winners of the last round, once decided. */
export function playoffWinners(bracket: PlayoffTie[][], results: ResultMap): (TeamId | null)[] {
  return (bracket.at(-1) ?? []).map((tie) => tieOutcome(tie, results)?.winner ?? null);
}

/** A plausible shoot-out score with a winner, e.g. 4–2 or 6–5 after sudden death. */
export function simulatePenalties(rng: Rng): Score {
  const loser = Math.floor(rng() * 5); // 0–4
  const winner = loser === 4 && rng() < 0.4 ? 5 + Math.floor(rng() * 3) : Math.max(loser + 1, 3 + Math.floor(rng() * 3));
  const finalLoser = winner > 5 ? winner - 1 : Math.min(loser, winner - 1);
  return rng() < 0.5 ? { home: winner, away: finalLoser } : { home: finalLoser, away: winner };
}

/**
 * Simulates the play-off round by round (each round's winners make the next
 * round's ties), filling only legs and shoot-outs without a result in `known`.
 */
export function simulatePlayoff(
  rows: readonly StandingRow[],
  config: PlayoffConfig,
  known: ResultMap,
  model: LeagueModel,
  rng: Rng,
  options: Omit<BracketOptions, "seasonComplete">,
): ResultMap {
  const added: ResultMap = {};
  for (let r = 0; r < config.rounds.length; r++) {
    const results = { ...known, ...added };
    const ties = buildBracket(rows, config, results, { ...options, seasonComplete: true })[r] ?? [];
    for (const tie of ties) {
      const legs = tie.legs.filter((leg) => !leg.result);
      Object.assign(added, simulateFixtures(legs, { ...known, ...added }, model, rng));
      const now = { ...known, ...added };
      if (tie.shootout && !now[tie.shootout.id] && needsShootout(tie, now)) added[tie.shootout.id] = simulatePenalties(rng);
    }
  }
  return added;
}
