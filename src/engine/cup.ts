import type { CupConfig, CupRoundConfig, CupRoundKey } from "../config/cups.ts";
import { simulateFixtures } from "./match.ts";
import { simulatePenalties } from "./playoffs.ts";
import type { LeagueModel } from "./ratings.ts";
import { createRng, type Rng } from "./rng.ts";
import type { Fixture, ResultMap, Score, TeamId } from "./types.ts";

// Knockout cup: each round's pairings are drawn (randomly), a tie is one game
// or two legs, a level tie goes to penalties, and the winners meet in the next
// round. Rounds the real draw hasn't reached yet are drawn here,
// deterministically, so a page reload or a share link shows the same pairings.

/** Cup ties get synthetic fixture ids above the play-off range. */
export const CUP_ID_BASE = 3_000_000_000;

/** A tie's slot: round r, tie t. Every slot exists whether or not it's drawn yet. */
export const cupGameId = (round: number, tie: number) => CUP_ID_BASE + round * 1000 + tie * 2;
export const cupShootoutId = (round: number, tie: number) => cupGameId(round, tie) + 1;
/** Second leg of a two-legged tie (offsets 500+ within the round). */
export const cupSecondLegId = (round: number, tie: number) => CUP_ID_BASE + round * 1000 + 500 + tie;
export const isCupShootoutId = (id: number) => {
  if (id < CUP_ID_BASE) return false;
  const offset = (id - CUP_ID_BASE) % 1000;
  return offset < 500 && offset % 2 === 1;
};

/** Every slot id of the competition (games, second legs and shoot-outs), for share links. */
export function cupIds(config: CupConfig): number[] {
  return config.rounds.flatMap((round, r) =>
    Array.from({ length: round.ties }, (_, t) => [cupGameId(r, t), cupShootoutId(r, t), ...(round.legs === 2 ? [cupSecondLegId(r, t)] : [])]).flat(),
  );
}

export interface CupTie {
  round: number;
  index: number;
  /** The club at home in the (first) game. */
  homeId: TeamId;
  awayId: TeamId;
  /** The first (or only) game; the same fixture as legs[0]. */
  game: Fixture;
  /** One game, or both legs (the second at the other club). */
  legs: Fixture[];
  /** Penalty shoot-out pseudo-fixture: same home side as the last game. */
  shootout: Fixture;
  /** The pairing comes from the real draw. */
  real: boolean;
}

export interface CupRound {
  index: number;
  config: CupRoundConfig;
  /**
   * "real": every tie from the feed; "simulated": drawn here (partly or fully);
   * "determined": a single tie between the only two clubs left (the final);
   * "pending": waiting for the previous round, or for a draw whose entrants
   * aren't known from any feed.
   */
  drawn: "real" | "simulated" | "determined" | "pending";
  ties: CupTie[];
  /** Clubs in the round, once known. */
  participants: TeamId[];
}

/** A real tie from the data feed: one game, or both legs in date order. */
export interface RealCupTie {
  round: CupRoundKey;
  homeId: TeamId;
  awayId: TeamId;
  legs: Fixture[];
}

export interface CupBuildOptions {
  /** Clubs entering in later rounds, by round key. */
  entrants: Partial<Record<CupRoundKey, readonly TeamId[]>>;
  /** Changes every simulated draw ("New draw"); 0 by default. */
  drawSalt: number;
  /** Placeholder kick-off per round (ISO date), for simulated draws. */
  roundDates: Partial<Record<CupRoundKey, string>>;
}

/** 32-bit string/number hash (FNV-1a), for deterministic draws. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    for (const ch of `${part}|`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/**
 * Draws a round: every club gets a key from the seed and its id, clubs are
 * sorted by key and paired in order, the first of each pair at home. Changing
 * one club (an earlier upset) moves only that club, so the rest of the draw
 * mostly stays as it was.
 */
export function drawRound(clubs: readonly TeamId[], seed: number): [TeamId, TeamId][] {
  const keyed = clubs.map((id) => ({ id, key: hashSeed(seed, id) }));
  keyed.sort((a, b) => a.key - b.key || a.id - b.id);
  const pairs: [TeamId, TeamId][] = [];
  for (let i = 0; i + 1 < keyed.length; i += 2) pairs.push([keyed[i]!.id, keyed[i + 1]!.id]);
  return pairs;
}

/** Shuffles with an rng (Monte Carlo draws). */
export function drawRoundRandom(clubs: readonly TeamId[], rng: Rng): [TeamId, TeamId][] {
  const order = [...clubs];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const pairs: [TeamId, TeamId][] = [];
  for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i]!, order[i + 1]!]);
  return pairs;
}

const scoreOf = (fixture: Fixture, results: ResultMap): Score | null => results[fixture.id] ?? fixture.result;

/** Goals per club over every leg, or null while a leg has no score. */
export function tieAggregate(tie: CupTie, results: ResultMap): { home: number; away: number } | null {
  let home = 0;
  let away = 0;
  for (const leg of tie.legs) {
    const score = scoreOf(leg, results);
    if (!score) return null;
    const homeAtHome = leg.homeId === tie.homeId;
    home += homeAtHome ? score.home : score.away;
    away += homeAtHome ? score.away : score.home;
  }
  return { home, away };
}

/** The club going through, or null while a game (or a needed shoot-out) isn't decided. */
export function tieWinner(tie: CupTie, results: ResultMap): TeamId | null {
  const total = tieAggregate(tie, results);
  if (!total) return null;
  if (total.home !== total.away) return total.home > total.away ? tie.homeId : tie.awayId;
  const pens = scoreOf(tie.shootout, results);
  if (!pens || pens.home === pens.away) return null;
  const shootoutHomeWins = pens.home > pens.away;
  return shootoutHomeWins === (tie.shootout.homeId === tie.homeId) ? tie.homeId : tie.awayId;
}

/** True when every game is played and the tie is level, so the shoot-out decides it. */
export function needsShootout(tie: CupTie, results: ResultMap): boolean {
  const total = tieAggregate(tie, results);
  return total !== null && total.home === total.away;
}

function makeTie(
  round: number,
  index: number,
  homeId: TeamId,
  awayId: TeamId,
  config: CupRoundConfig,
  real: readonly Fixture[] | undefined,
  date: string,
): CupTie {
  const neutral = Boolean(config.neutral ?? config.venue);
  const twoLegs = config.legs === 2;
  const legFor = (n: 0 | 1): Fixture => {
    const source = real?.[n];
    const [h, a] = source ? [source.homeId, source.awayId] : n === 0 ? [homeId, awayId] : [awayId, homeId];
    const { penalties: _p, ...rest } = source ?? ({} as Partial<Fixture>);
    return {
      id: n === 0 ? cupGameId(round, index) : cupSecondLegId(round, index),
      matchday: round + 1,
      utcDate: rest.utcDate ?? (n === 0 ? date : new Date(Date.parse(date) + 7 * 86_400_000).toISOString()),
      homeId: h,
      awayId: a,
      result: rest.result ?? null,
      ...(neutral ? { neutral: true } : {}),
    };
  };
  const legs = twoLegs ? [legFor(0), legFor(1)] : [legFor(0)];
  const last = legs.at(-1)!;
  const penalties = real?.[legs.length - 1]?.penalties;
  const shootout: Fixture = { ...last, id: cupShootoutId(round, index), result: penalties ?? null };
  return { round, index, homeId: legs[0]!.homeId, awayId: legs[0]!.awayId, game: legs[0]!, legs, shootout, real: real !== undefined };
}

/**
 * Builds every round: real ties from the feed fill their slots (in feed order),
 * the remaining clubs are drawn among themselves, and a round whose previous
 * round isn't decided (or whose entrants aren't known) is pending.
 */
export function buildCup(config: CupConfig, real: readonly RealCupTie[], results: ResultMap, options: CupBuildOptions): CupRound[] {
  const rounds: CupRound[] = [];
  config.rounds.forEach((roundConfig, r) => {
    const previous = rounds[r - 1];
    const entrants = options.entrants[roundConfig.key] ?? [];
    const date = options.roundDates[roundConfig.key] ?? new Date(Date.now() + (r + 1) * 28 * 86_400_000).toISOString();
    const realTies = real.filter((t) => t.round === roundConfig.key).sort((a, b) => a.legs[0]!.id - b.legs[0]!.id);

    // Winners of the previous round (none before the first round).
    let fromPrevious: TeamId[] | null;
    if (r === 0) {
      fromPrevious = [];
    } else if (previous!.drawn === "pending") {
      fromPrevious = null;
    } else {
      const winners = previous!.ties.map((t) => tieWinner(t, results));
      fromPrevious = winners.every((w): w is TeamId => w !== null) ? winners : null;
    }

    const ties: CupTie[] = [];
    realTies.slice(0, roundConfig.ties).forEach((t, i) => ties.push(makeTie(r, i, t.homeId, t.awayId, roundConfig, t.legs, date)));
    const placed = new Set(ties.flatMap((t) => [t.homeId, t.awayId]));
    const complete = ties.length >= roundConfig.ties;

    const participants = fromPrevious === null ? [...placed] : [...new Set([...fromPrevious, ...entrants, ...placed])];
    // Not drawable yet: the previous round is open, or clubs entering this round
    // aren't known from any feed (keep the real ties already published).
    if (!complete && (fromPrevious === null || participants.length < roundConfig.ties * 2)) {
      rounds.push({ index: r, config: roundConfig, drawn: "pending", ties, participants });
      return;
    }
    const remaining = participants.filter((id) => !placed.has(id));
    const pairs = drawRound(remaining, hashSeed(config.code, r, options.drawSalt));
    for (const [home, away] of pairs) {
      if (ties.length >= roundConfig.ties) break;
      ties.push(makeTie(r, ties.length, home, away, roundConfig, undefined, date));
    }
    rounds.push({
      index: r,
      config: roundConfig,
      drawn: complete ? "real" : roundConfig.ties === 1 ? "determined" : "simulated",
      ties,
      participants,
    });
  });
  return rounds;
}

/** The cup winner, once the final is decided. */
export function cupWinner(rounds: readonly CupRound[], results: ResultMap): TeamId | null {
  const final = rounds.at(-1)?.ties[0];
  return final ? tieWinner(final, results) : null;
}

/** Clubs still in the competition: everyone not yet beaten (entrants to come included). */
export function clubsAlive(rounds: readonly CupRound[], results: ResultMap, allEntrants: readonly TeamId[]): Set<TeamId> {
  const alive = new Set<TeamId>(allEntrants);
  for (const round of rounds) {
    for (const tie of round.ties) {
      const winner = tieWinner(tie, results);
      if (winner !== null) alive.delete(winner === tie.homeId ? tie.awayId : tie.homeId);
    }
  }
  return alive;
}

/** Simulates a round's unplayed games and needed shoot-outs; returns the new results only. */
export function simulateCupRound(round: CupRound, known: ResultMap, model: LeagueModel, rng: Rng): ResultMap {
  const added: ResultMap = {};
  const now = () => ({ ...known, ...added });
  Object.assign(added, simulateFixtures(round.ties.flatMap((t) => t.legs).filter((g) => !scoreOf(g, known)), now(), model, rng));
  for (const tie of round.ties) {
    if (needsShootout(tie, now()) && !scoreOf(tie.shootout, now())) added[tie.shootout.id] = simulatePenalties(rng);
  }
  return added;
}

/**
 * Simulates the rest of the competition: each round's games and shoot-outs,
 * then the next round is drawn from the winners, down to the final.
 */
export function simulateCup(
  config: CupConfig,
  real: readonly RealCupTie[],
  known: ResultMap,
  model: LeagueModel,
  rng: Rng,
  options: CupBuildOptions,
): ResultMap {
  const added: ResultMap = {};
  for (let r = 0; r < config.rounds.length; r++) {
    const now = { ...known, ...added };
    const round = buildCup(config, real, now, options)[r]!;
    if (round.drawn === "pending") break;
    Object.assign(added, simulateCupRound(round, now, model, rng));
  }
  return added;
}

/** Seeded rng for a Monte Carlo iteration. */
export const iterationRng = (seed: number, iteration: number) => createRng(hashSeed(seed, iteration));
