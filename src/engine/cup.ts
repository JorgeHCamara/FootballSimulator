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
  /**
   * The previous round's ties whose winners meet in each of this round's ties
   * (by tie index, in the draw's order), when the draw is the slots' own (no
   * real ties, no clubs entering, no fixed bracket): known before anyone has
   * won, so a bracket can be laid out the same whatever the results.
   */
  feeders?: [number, number][];
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
  /** Each club's tier (0 = top division), for rounds where the lower-division club hosts. */
  tiers?: Readonly<Record<TeamId, number>>;
}

/** Tier of every known club: its feeder league's position, else the cup's outsider tier. */
export function clubTiers(config: CupConfig, divisions: Readonly<Record<TeamId, string>>, clubs: Iterable<TeamId>): Record<TeamId, number> {
  const tiers: Record<TeamId, number> = {};
  for (const id of clubs) {
    const tier = config.feederLeagues.indexOf(divisions[id] as never);
    tiers[id] = tier >= 0 ? tier : config.outsiderTier;
  }
  return tiers;
}

/**
 * Draw order, unless the round is played at the lower-division club: then the
 * lower club hosts. With `hostTier` only clubs at or below that tier get the
 * home game, and only against a club above it (DFB-Pokal: amateurs v pros).
 */
export function hostFirst(
  config: CupRoundConfig,
  home: TeamId,
  away: TeamId,
  tiers: Readonly<Record<TeamId, number>> | undefined,
  hostTier?: number,
): [TeamId, TeamId] {
  if (!config.lowerHosts || !tiers || config.legs === 2) return [home, away];
  const th = tiers[home] ?? Infinity;
  const ta = tiers[away] ?? Infinity;
  const swap = hostTier === undefined ? ta > th : ta >= hostTier && th < hostTier;
  return swap ? [away, home] : [home, away];
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
 * Draws a round: every club gets a key from the seed and its slot, clubs are
 * sorted by key and paired in order, the first of each pair at home. A club's
 * slot is where it comes from (`slotOf`: "the winner of tie 3"), by default
 * the club itself; so with slots the draw pairs the slots, and whoever wins a
 * tie takes its place in the same tie of the next round, the round's ties in
 * the same order.
 */
export function drawRound(clubs: readonly TeamId[], seed: number, slotOf: (id: TeamId) => string | number = (id) => id): [TeamId, TeamId][] {
  const keyed = clubs.map((id) => ({ id, slot: String(slotOf(id)), key: hashSeed(seed, slotOf(id)) }));
  keyed.sort((a, b) => a.key - b.key || a.slot.localeCompare(b.slot) || a.id - b.id);
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

/**
 * What decides a level tie in a round, for the rule shown: "penalties" (no
 * extra time) or "extraTime" (extra time, then penalties); undefined when the
 * round's config says nothing (the engine plays no extra time either way).
 */
export function levelTieRule(config: Pick<CupRoundConfig, "noExtraTime">): "penalties" | "extraTime" | undefined {
  return config.noExtraTime === undefined ? undefined : config.noExtraTime ? "penalties" : "extraTime";
}

/** Index of the round before the first fixed-bracket round, or -1 without a bracket. */
export function bracketBase(config: CupConfig): number {
  const first = config.rounds.findIndex((r) => r.bracket);
  return first > 0 ? first - 1 : -1;
}

/**
 * Each club's line in a fixed bracket: the slot of its tie in the base round,
 * in `config.bracketOrder` when that names every tie, else in slot order.
 */
export function bracketLines(config: CupConfig, base: readonly { homeId: TeamId; awayId: TeamId }[]): Map<TeamId, number> {
  const order = config.bracketOrder ?? [];
  const positions = base.map((tie) => {
    const i = order.indexOf(tie.homeId);
    return i >= 0 ? i : order.indexOf(tie.awayId);
  });
  const useOrder = positions.every((p) => p >= 0) && new Set(positions).size === positions.length;
  const lines = new Map<TeamId, number>();
  base.forEach((tie, i) => {
    const line = useOrder ? positions[i]! : i;
    lines.set(tie.homeId, line);
    lines.set(tie.awayId, line);
  });
  return lines;
}

/**
 * Pairs the clubs of a bracket round `depth` rounds after the base: two clubs
 * meet when their lines fall in the same block of 2^depth. Pairs come in
 * bracket order, the club from the upper line first (at home); clubs without
 * a partner (or a line) are returned in `rest`.
 */
export function bracketPairs(clubs: readonly TeamId[], lines: ReadonlyMap<TeamId, number>, depth: number): { pairs: [TeamId, TeamId][]; rest: TeamId[] } {
  const blocks = new Map<number, TeamId[]>();
  const rest: TeamId[] = [];
  for (const id of clubs) {
    const line = lines.get(id);
    if (line === undefined) rest.push(id);
    else blocks.set(line >> depth, [...(blocks.get(line >> depth) ?? []), id]);
  }
  const pairs: [TeamId, TeamId][] = [];
  for (const block of [...blocks.keys()].sort((a, b) => a - b)) {
    const ids = blocks.get(block)!.sort((a, b) => lines.get(a)! - lines.get(b)!);
    if (ids.length === 2) pairs.push([ids[0]!, ids[1]!]);
    else rest.push(...ids);
  }
  return { pairs, rest };
}

/**
 * For a fixed-bracket round that can't be built yet: the clubs who can reach
 * each side of each of its ties, in bracket order. They come from the latest
 * round with all its ties known (the winner only, where a tie is decided).
 * Null when the round isn't a bracket round.
 */
export function bracketSides(config: CupConfig, rounds: readonly CupRound[], r: number, results: ResultMap): [TeamId[], TeamId[]][] | null {
  const base = bracketBase(config);
  if (base < 0 || r <= base || !config.rounds[r]?.bracket || !rounds[base]) return null;
  let k = r - 1;
  while (k > base && rounds[k]!.ties.length < config.rounds[k]!.ties) k--;
  if (rounds[k]!.ties.length < config.rounds[k]!.ties) return null;
  const lines = bracketLines(config, rounds[base]!.ties);
  const depth = r - base;
  const sides = Array.from({ length: config.rounds[r]!.ties }, (): [TeamId[], TeamId[]] => [[], []]);
  for (const tie of rounds[k]!.ties) {
    const winner = tieWinner(tie, results);
    for (const id of winner === null ? [tie.homeId, tie.awayId] : [winner]) {
      const line = lines.get(id);
      if (line === undefined) continue;
      sides[line >> depth]?.[(line >> (depth - 1)) & 1]?.push(id);
    }
  }
  for (const side of sides.flat()) side.sort((a, b) => lines.get(a)! - lines.get(b)!);
  return sides;
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

    // The slots' draw, whoever wins: which of the previous round's ties feed each of this round's.
    const feeders: [number, number][] | undefined =
      r > 0 && realTies.length === 0 && entrants.length === 0 && !roundConfig.bracket
        ? drawRound(
            Array.from({ length: config.rounds[r - 1]!.ties }, (_, i) => i),
            hashSeed(config.code, r, options.drawSalt),
            (i) => `w${i}`,
          ).slice(0, roundConfig.ties)
        : undefined;
    const withFeeders = feeders ? { feeders } : {};

    const ties: CupTie[] = [];
    realTies.slice(0, roundConfig.ties).forEach((t, i) => ties.push(makeTie(r, i, t.homeId, t.awayId, roundConfig, t.legs, date)));
    const placed = new Set(ties.flatMap((t) => [t.homeId, t.awayId]));
    const complete = ties.length >= roundConfig.ties;

    const participants = fromPrevious === null ? [...placed] : [...new Set([...fromPrevious, ...entrants, ...placed])];
    // Not drawable yet: the previous round is open, or clubs entering this round
    // aren't known from any feed (keep the real ties already published).
    if (!complete && (fromPrevious === null || participants.length < roundConfig.ties * 2)) {
      rounds.push({ index: r, config: roundConfig, drawn: "pending", ties, participants, ...withFeeders });
      return;
    }
    const remaining = participants.filter((id) => !placed.has(id));
    // A simulated draw pairs slots, not clubs: the winner of the previous
    // round's tie i, or a club entering in this round. A result changing who
    // goes through then changes only who fills that slot; the round's
    // pairings and their order, and every later round's, stay as they were.
    const winnerOf = new Map((fromPrevious ?? []).map((id, i) => [id, i] as const));
    const slotOf = (id: TeamId) => (winnerOf.has(id) ? `w${winnerOf.get(id)}` : `e${id}`);
    let pairs: [TeamId, TeamId][];
    if (roundConfig.bracket && bracketBase(config) >= 0) {
      // Fixed bracket: neighbouring slots meet, no draw.
      const base = bracketBase(config);
      const fixed = bracketPairs(remaining, bracketLines(config, rounds[base]!.ties), r - base);
      pairs = [...fixed.pairs, ...drawRound(fixed.rest, hashSeed(config.code, r, options.drawSalt), slotOf)];
    } else {
      pairs = drawRound(remaining, hashSeed(config.code, r, options.drawSalt), slotOf);
    }
    for (const pair of pairs) {
      if (ties.length >= roundConfig.ties) break;
      const [home, away] = hostFirst(roundConfig, pair[0], pair[1], options.tiers, config.hostTier);
      ties.push(makeTie(r, ties.length, home, away, roundConfig, undefined, date));
    }
    rounds.push({
      index: r,
      config: roundConfig,
      drawn: complete ? "real" : roundConfig.ties === 1 || roundConfig.bracket ? "determined" : "simulated",
      ties,
      participants,
      ...withFeeders,
    });
  });
  return rounds;
}

/**
 * Orders each column by the round after it, so the two quarter-finals feeding
 * a semi-final sit beside it. A round drawn by slots (`feeders`: which ties'
 * winners meet) sets the order whatever the results, decided or not, so the
 * bracket stays put as scores change. Otherwise (a real draw, clubs entering,
 * a fixed bracket) a drawn round orders it by its clubs: the tie its home
 * club came through, then its away club's; a column whose next round isn't
 * drawn keeps its draw order.
 */
export function bracketColumns(rounds: readonly CupRound[], results: ResultMap): CupTie[][] {
  // Each column's tie indices, top to bottom; from the last column back.
  const orders = rounds.map((r) => Array.from({ length: Math.max(r.config.ties, r.ties.length) }, (_, i) => i));
  for (let c = rounds.length - 2; c >= 0; c--) {
    const next = rounds[c + 1]!;
    let ordered: number[];
    if (next.feeders) {
      ordered = orders[c + 1]!.flatMap((j) => next.feeders![j] ?? []);
    } else if (next.ties.length) {
      ordered = [];
      for (const j of orders[c + 1]!) {
        const tie = next.ties.find((t) => t.index === j);
        if (!tie) continue;
        for (const club of [tie.homeId, tie.awayId]) {
          const feeder = rounds[c]!.ties.find((t) => !ordered.includes(t.index) && tieWinner(t, results) === club);
          if (feeder) ordered.push(feeder.index);
        }
      }
    } else continue;
    const seen = new Set(ordered);
    orders[c] = [...new Set(ordered), ...orders[c]!.filter((i) => !seen.has(i))];
  }
  return rounds.map((round, c) => {
    const placed = orders[c]!.flatMap((i) => round.ties.filter((t) => t.index === i));
    return [...placed, ...round.ties.filter((t) => !placed.includes(t))];
  });
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
/**
 * Simulates a round's games and shoot-outs. With `likely`, the games get
 * likely rolls (the "Simulate round" and "Simulate all" buttons); without,
 * the full score distribution.
 */
export function simulateCupRound(round: CupRound, known: ResultMap, model: LeagueModel, rng: Rng, { likely = false }: { likely?: boolean } = {}): ResultMap {
  const added: ResultMap = {};
  const now = () => ({ ...known, ...added });
  Object.assign(added, simulateFixtures(round.ties.flatMap((t) => t.legs).filter((g) => !scoreOf(g, known)), now(), model, rng, { likely }));
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
  /** Likely rolls for the games (the "Simulate all" button); see simulateCupRound. */
  { likely = false }: { likely?: boolean } = {},
): ResultMap {
  const added: ResultMap = {};
  for (let r = 0; r < config.rounds.length; r++) {
    const now = { ...known, ...added };
    const round = buildCup(config, real, now, options)[r]!;
    if (round.drawn === "pending") break;
    Object.assign(added, simulateCupRound(round, now, model, rng, { likely }));
  }
  return added;
}

/** Seeded rng for a Monte Carlo iteration. */
export const iterationRng = (seed: number, iteration: number) => createRng(hashSeed(seed, iteration));
