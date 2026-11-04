import { simulateFixtures } from "./match.ts";
import type { LeagueModel } from "./ratings.ts";
import type { Rng } from "./rng.ts";
import type { Fixture, ResultMap, Score, StandingRow, TeamId } from "./types.ts";

// End-of-season knockout play-offs seeded from the final table, e.g.
// - Série B: 3rd v 6th and 4th v 5th over two legs, better-placed club goes
//   through on a level aggregate;
// - Championship 2026/27: single-leg eliminators (5th v 8th, 6th v 7th),
//   two-legged semi-finals with 3rd and 4th, then a single final at Wembley;
//   level ties go to extra time and penalties;
// - MLS Cup: within each conference a wild card (8th v 9th), best-of-three
//   Round One series, then single-game semifinals and final along a fixed
//   bracket; the two conference champions meet in MLS Cup.

export type PlayoffRoundKey =
  | "preliminary"
  | "playOff1"
  | "playOff2"
  | "eliminators"
  | "semiFinals"
  | "final"
  | "wildCard"
  | "roundOne"
  | "conferenceSemiFinals"
  | "conferenceFinal"
  | "mlsCup"
  | "knockoutPlayoff"
  | "roundOf16"
  | "quarterFinals";

export interface PlayoffRoundConfig {
  key: PlayoffRoundKey;
  /** Two legs: the better-placed club hosts the second. One leg: it hosts the match (unless `venue`). */
  legs: 1 | 2;
  /**
   * Best-of-three series (MLS Round One): the better-placed club hosts games 1
   * and 3, the first to win two goes through, and a drawn game goes to penalties.
   */
  bestOf?: 3;
  /** What decides a level tie: the better league position, or a penalty shoot-out. */
  levelTie: "betterPlaced" | "penalties";
  /** A level game goes straight to penalties, without extra time (only changes the rule shown). */
  noExtraTime?: boolean;
  /** Single match at a neutral ground, e.g. "Wembley". */
  venue?: string;
  /** At a neutral ground not yet named (Argentina's final). */
  neutral?: boolean;
  /** Fixed pairings by table position (first round). */
  pairs?: readonly (readonly [number, number])[];
  /** Positions that join in this round, alongside the previous round's winners. */
  entrants?: readonly number[];
  /**
   * Previous winners keep their bracket path (first tie's winner v last tie's
   * winner, and so on) instead of being re-seeded by table position.
   */
  fixedBracket?: boolean;
  /**
   * The real pairings come from a draw (UEFA knockout phase): the seeding pairs
   * above are only a projection, and real games between two of the round's
   * clubs replace them once the feed lists them.
   */
  drawn?: boolean;
  /**
   * Weeks from the previous round's first games (or the end of the league) to
   * this round's, for placeholder dates; by default the next free weeks.
   */
  gapWeeks?: number;
}

export interface PlayoffConfig {
  rounds: readonly PlayoffRoundConfig[];
  /** Positions promoted without the play-off. */
  directPromotion?: readonly number[];
  /** League the winners go up to (promotion play-offs). */
  promotedTo?: string;
  /** Competition the winner is champion of (title play-offs, e.g. "MLS Cup"). */
  title?: string;
  /**
   * The play-off isn't held when `position` finishes more than `points` points
   * clear of `over`: that club goes up directly (Serie B: 3rd more than 14
   * points clear of 4th).
   */
  directIfClear?: { position: number; over: number; points: number };
  /**
   * The winner isn't promoted yet: it plays `position` of `league` over two legs
   * (Ligue 2: v Ligue 1's 16th). Not simulated, the opponent is in another league.
   */
  winnerPlays?: { league: string; position: number };
  /**
   * The first `rounds` rounds are played within each of `count` groups (MLS
   * conferences), seeded by the group's table; later rounds bring the groups'
   * winners together, seeded by the overall table.
   */
  groupStage?: { count: number; rounds: number };
  /**
   * Seeded from a group stage (Copa Libertadores): the top `places` of every
   * group go through, ranked as all group winners first (by points, goal
   * difference, goals scored), then all runners-up, and so on. Positions in
   * `pairs` and `entrants` refer to that ranking (see seedByGroupPlace).
   */
  seedFromGroups?: {
    places: number;
    /**
     * Clubs joining from another competition's group stage, ranked right after
     * this competition's qualifiers (Copa Sudamericana: the Libertadores
     * third-placed clubs, seeds 17–24).
     */
    external?: { league: string; place: number };
    /**
     * Rank by place, then by group order rather than record (A1, B1, A2, B2…),
     * so seeding pairs like 1 v 16 always cross the groups (Argentina: 1A v 8B,
     * 1B v 8A…). Positions then also name the slot: zone = (p − 1) mod groups.
     */
    interleave?: boolean;
  };
}

const byRecord = (a: StandingRow, b: StandingRow) =>
  b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.teamId - b.teamId;

/**
 * One ranking from several group tables: every group's 1st (best record first),
 * then every 2nd, and so on, numbered 1, 2, 3… (see `seedFromGroups`). Clubs
 * joining from another competition (`external`, by record) come right after
 * the first `places` places, before the clubs that went out.
 */
export function seedByGroupPlace(
  groups: readonly (readonly StandingRow[])[],
  external: readonly StandingRow[] = [],
  places = Infinity,
  interleave = false,
): StandingRow[] {
  const deepest = Math.max(0, ...groups.map((g) => g.length));
  const ranked: StandingRow[] = [];
  for (let place = 1; place <= deepest; place++) {
    if (place === places + 1) ranked.push(...[...external].sort(byRecord));
    const atPlace = groups.flatMap((g) => g.filter((row) => row.position === place));
    ranked.push(...(interleave ? atPlace : atPlace.sort(byRecord)));
  }
  if (places >= deepest) ranked.push(...[...external].sort(byRecord));
  return ranked.map((row, i) => ({ ...row, position: i + 1 }));
}

/** Play-off legs get synthetic fixture ids far above any real one. */
export const PLAYOFF_ID_BASE = 2_000_000_000;

const legId = (round: number, tie: number, leg: 1 | 2) => PLAYOFF_ID_BASE + round * 100 + tie * 2 + leg;
const shootoutId = (round: number, tie: number) => PLAYOFF_ID_BASE + round * 100 + 50 + tie;
// Best-of-three series: three games per tie, each with its own shoot-out.
const gameId = (round: number, tie: number, game: number) => PLAYOFF_ID_BASE + round * 100 + tie * 3 + game;
const gameShootoutId = (round: number, tie: number, game: number) => PLAYOFF_ID_BASE + round * 100 + 50 + tie * 3 + game - 1;

function tieCounts(config: PlayoffConfig): number[] {
  const counts: number[] = [];
  const groups = config.groupStage;
  config.rounds.forEach((round, r) => {
    const inGroups = groups !== undefined && r < groups.rounds;
    const sets = inGroups ? groups.count : 1;
    const previous = r === 0 ? 0 : counts[r - 1]!;
    const previousPerSet = inGroups ? previous / groups.count : previous;
    const participants = (round.pairs?.length ?? 0) * 2 + (round.entrants?.length ?? 0) + previousPerSet;
    counts.push(Math.floor(participants / 2) * sets);
  });
  return counts;
}

/** Ids belonging to one tie (its legs or games, and shoot-outs), whether or not its clubs are known yet. */
export function tieIds(round: number, tie: number, config: PlayoffRoundConfig): number[] {
  if (config.bestOf) {
    return [1, 2, 3].flatMap((g) => [gameId(round, tie, g), gameShootoutId(round, tie, g)]);
  }
  return [
    legId(round, tie, 1),
    ...(config.legs === 2 ? [legId(round, tie, 2)] : []),
    ...(config.levelTie === "penalties" ? [shootoutId(round, tie)] : []),
  ];
}

export const isShootoutId = (id: number) => id > PLAYOFF_ID_BASE && (id - PLAYOFF_ID_BASE) % 100 >= 50;

/** Every synthetic id the play-off can use (legs and shoot-outs), for share links and clean-up. */
export function playoffIds(config: PlayoffConfig): number[] {
  return tieCounts(config).flatMap((count, r) => Array.from({ length: count }, (_, t) => tieIds(r, t, config.rounds[r]!)).flat());
}

/** A club in a tie: known once the table (or the previous round) decides it. */
export interface PlayoffSide {
  teamId: TeamId | null;
  /** League position when known, or the position slot before the season ends. */
  position: number | null;
  /** For an undecided winner of an earlier tie: which one. */
  from?: { round: number; tie: number };
  /** Group (conference) the slot or the earlier tie belongs to. */
  group?: number;
}

export interface PlayoffTie {
  round: number;
  index: number;
  config: PlayoffRoundConfig;
  /** Group (conference) the tie is played in, during a group stage. */
  group?: number;
  higher: PlayoffSide;
  lower: PlayoffSide;
  /** Legs, or a series' games; only when both clubs are known. */
  legs: Fixture[];
  /** Penalty shoot-out pseudo-fixture (higher = home); only for `penalties` rounds with known clubs. */
  shootout: Fixture | null;
  /** Best-of-three series: one shoot-out per game (same home side as the game), aligned with `legs`. */
  gameShootouts: Fixture[];
}

export interface TieOutcome {
  /** Goals on aggregate, or games won in a series. */
  higherGoals: number;
  lowerGoals: number;
  winner: TeamId;
  onPenalties: boolean;
}

const scoreOf = (fixture: Fixture, results: ResultMap) => results[fixture.id] ?? fixture.result;

export interface SeriesGame {
  game: Fixture;
  shootout: Fixture;
  /** Still to be played: the series isn't decided before this game. */
  needed: boolean;
  /** Drawn, so its shoot-out decides the game. */
  needsPenalties: boolean;
}

/** The games of a best-of-three series, and which of them are still needed. */
export function seriesGames(tie: PlayoffTie, results: ResultMap): SeriesGame[] {
  const toWin = Math.ceil((tie.config.bestOf ?? 1) / 2);
  let higherWins = 0;
  let lowerWins = 0;
  let unknown = false;
  return tie.legs.map((game, i) => {
    const shootout = tie.gameShootouts[i]!;
    const needed = higherWins < toWin && lowerWins < toWin;
    const score = scoreOf(game, results);
    const drawn = score !== null && score.home === score.away;
    if (needed && !unknown) {
      const winnerIsHome = !score ? null : !drawn ? score.home > score.away : penaltyWinnerIsHome(scoreOf(shootout, results));
      if (winnerIsHome === null) unknown = true;
      else if ((game.homeId === tie.higher.teamId) === winnerIsHome) higherWins++;
      else lowerWins++;
    }
    return { game, shootout, needed, needsPenalties: needed && drawn };
  });
}

const penaltyWinnerIsHome = (pens: Score | null) => (!pens || pens.home === pens.away ? null : pens.home > pens.away);

/**
 * Result of a tie: aggregate, then draw advantage or the shoot-out; for a
 * series, games won. Null while a game is missing, or when level and the
 * shoot-out hasn't been entered.
 */
export function tieOutcome(tie: PlayoffTie, results: ResultMap): TieOutcome | null {
  const { higher, lower } = tie;
  if (higher.teamId === null || lower.teamId === null || tie.legs.length === 0) return null;
  if (tie.config.bestOf) {
    const toWin = Math.ceil(tie.config.bestOf / 2);
    let higherWins = 0;
    let lowerWins = 0;
    for (const { game, shootout, needed } of seriesGames(tie, results)) {
      if (!needed) break;
      const score = scoreOf(game, results);
      if (!score) return null;
      const homeWon = score.home !== score.away ? score.home > score.away : penaltyWinnerIsHome(scoreOf(shootout, results));
      if (homeWon === null) return null;
      if ((game.homeId === higher.teamId) === homeWon) higherWins++;
      else lowerWins++;
    }
    if (higherWins < toWin && lowerWins < toWin) return null;
    return { higherGoals: higherWins, lowerGoals: lowerWins, winner: higherWins > lowerWins ? higher.teamId : lower.teamId, onPenalties: false };
  }
  let higherGoals = 0;
  let lowerGoals = 0;
  for (const leg of tie.legs) {
    const score = scoreOf(leg, results);
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
  const homeWon = tie.shootout ? penaltyWinnerIsHome(scoreOf(tie.shootout, results)) : null;
  if (homeWon === null) return null;
  return { higherGoals, lowerGoals, winner: homeWon ? higher.teamId : lower.teamId, onPenalties: true };
}

/** True when all legs are played and level, so a shoot-out is needed (not for series: see seriesGames). */
export function needsShootout(tie: PlayoffTie, results: ResultMap): boolean {
  if (tie.config.levelTie !== "penalties" || !tie.shootout) return false;
  const legsDone = tie.legs.every((leg) => scoreOf(leg, results));
  // Without its shoot-out, a level tie has no outcome (whatever pens were entered).
  return legsDone && tieOutcome({ ...tie, shootout: null }, results) === null;
}

export interface BracketOptions {
  /** Every league match has a score: clubs can be placed in the bracket. */
  seasonComplete: boolean;
  afterMatchday: number;
  afterDate: string;
  /** Real play-off games from the data feed; a leg takes the result of the same pairing. */
  real?: readonly Fixture[];
  /**
   * With a `groupStage`: each group's table (positions within the group), in
   * group order; `rows` is then the overall table.
   */
  groups?: readonly (readonly StandingRow[])[];
  /** Build only the first `rounds` rounds (simulation needs one round at a time). */
  rounds?: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** ISO date strings, cached: simulations build the same few placeholder dates again and again. */
const isoDates = new Map<number, string>();
function isoDate(time: number): string {
  let iso = isoDates.get(time);
  if (iso === undefined) {
    if (isoDates.size > 1000) isoDates.clear();
    iso = new Date(time).toISOString();
    isoDates.set(time, iso);
  }
  return iso;
}

/** True once the table makes the play-off unnecessary (see `directIfClear`). */
export function playoffCancelled(config: PlayoffConfig, rows: readonly StandingRow[]): boolean {
  const rule = config.directIfClear;
  if (!rule) return false;
  const leader = rows.find((r) => r.position === rule.position);
  const next = rows.find((r) => r.position === rule.over);
  return leader !== undefined && next !== undefined && leader.points - next.points > rule.points;
}

export function buildBracket(
  rows: readonly StandingRow[],
  config: PlayoffConfig,
  results: ResultMap,
  options: BracketOptions,
): PlayoffTie[][] {
  if (options.seasonComplete && playoffCancelled(config, rows)) return [];
  const grouped = config.groupStage !== undefined && (options.groups?.length ?? 0) > 0;
  const groupRounds = grouped ? config.groupStage!.rounds : 0;
  const start = Date.parse(options.afterDate) || Date.now();
  const used = new Set<number>();
  /** Real games between two clubs, oldest first, not yet given to another leg. */
  const realBetween = (a: TeamId, b: TeamId) =>
    (options.real ?? [])
      .filter((f) => !used.has(f.id) && ((f.homeId === a && f.awayId === b) || (f.homeId === b && f.awayId === a)))
      .sort((x, y) => x.utcDate.localeCompare(y.utcDate));

  const rounds: PlayoffTie[][] = [];
  let weekOffset = 0;
  let roundStart = 0;
  config.rounds.slice(0, options.rounds ?? config.rounds.length).forEach((round, r) => {
    // Placeholder dates: the first games a week after `weekOffset` weeks.
    if (round.gapWeeks !== undefined) weekOffset = (r === 0 ? 0 : roundStart) + round.gapWeeks - 1;
    roundStart = weekOffset + 1;
    // During the group stage each group plays its own ties; afterwards one set.
    const sets =
      r < groupRounds
        ? options.groups!.map((table, g) => ({ group: g as number | undefined, table, previous: (rounds[r - 1] ?? []).filter((t) => t.group === g) }))
        : [{ group: undefined, table: rows, previous: rounds[r - 1] ?? [] }];

    const ties: PlayoffTie[] = [];
    for (const { group, table, previous } of sets) {
      const positionOf = new Map(table.map((row) => [row.teamId, row.position]));
      const atPosition = new Map(table.map((row) => [row.position, row.teamId]));
      const teamAt = (position: number) => (options.seasonComplete ? (atPosition.get(position) ?? null) : null);
      const bySlot = (position: number): PlayoffSide => ({ teamId: teamAt(position), position, ...(group !== undefined ? { group } : {}) });

      // Who plays: fixed pairs, or entrants plus the previous round's winners.
      let pairs: [PlayoffSide, PlayoffSide][];
      if (round.pairs) {
        pairs = round.pairs.map(([a, b]) => [bySlot(a), bySlot(b)]);
      } else {
        const winners: PlayoffSide[] = previous.map((tie) => {
          const outcome = tieOutcome(tie, results);
          const tieGroup = tie.group !== undefined ? { group: tie.group } : {};
          return outcome
            ? { teamId: outcome.winner, position: positionOf.get(outcome.winner) ?? null, ...tieGroup }
            : { teamId: null, position: null, from: { round: r - 1, tie: tie.index }, ...tieGroup };
        });
        const all = [...(round.entrants ?? []).map(bySlot), ...winners];
        // Re-seed once everyone is known (best-placed v lowest-placed), unless the bracket is fixed.
        const known = all.every((s) => s.teamId !== null);
        const ordered = known && !round.fixedBracket ? [...all].sort((a, b) => a.position! - b.position!) : all;
        const half = Math.floor(ordered.length / 2);
        pairs = Array.from({ length: half }, (_, i) => [ordered[i]!, ordered[ordered.length - 1 - i]!]);
      }

      // Real draws only matter while the feed has knockout games not yet placed.
      if (round.drawn && (options.real?.length ?? 0) > used.size) pairs = drawnPairs(pairs, realBetween);

      for (const [a, b] of pairs) {
        // Better-placed side is "higher"; unknown winners count as lower-placed.
        const [higher, lower] = (b.position ?? Infinity) < (a.position ?? Infinity) ? [b, a] : [a, b];
        const t = ties.length;
        const tie: PlayoffTie = { round: r, index: t, config: round, ...(group !== undefined ? { group } : {}), higher, lower, legs: [], shootout: null, gameShootouts: [] };
        ties.push(tie);
        if (higher.teamId === null || lower.teamId === null) continue;
        const neutral = Boolean(round.venue || round.neutral);
        const reals = realBetween(higher.teamId, lower.teamId);
        // A leg: the real game between the two clubs when the feed has it (in date
        // order for a series; same home side otherwise, either way at a neutral venue).
        const game = (id: number, n: number, homeId: TeamId, awayId: TeamId, utcDate: string): Fixture => {
          const real = round.bestOf
            ? reals[n - 1]
            : reals.find((f) => f.homeId === homeId || neutral);
          if (real) used.add(real.id);
          const flipped = real !== undefined && real.homeId !== homeId;
          const flip = (s: Score) => (flipped ? { home: s.away, away: s.home } : s);
          return {
            id,
            matchday: options.afterMatchday + weekOffset + (round.bestOf ? 1 : n),
            utcDate: real?.utcDate ?? utcDate,
            homeId,
            awayId,
            result: real?.result ? flip(real.result) : null,
            ...(real?.penalties ? { penalties: flip(real.penalties) } : {}),
            ...(neutral ? { neutral: true } : {}),
          };
        };
        const shootoutFor = (leg: Fixture, id: number): Fixture => {
          const { penalties, ...rest } = leg;
          return { ...rest, id, result: penalties ?? null };
        };
        const date = (days: number) => isoDate(start + (weekOffset * 7 + days) * DAY);
        if (round.bestOf) {
          // Better-placed club hosts games 1 and 3.
          tie.legs = [1, 2, 3].map((n) => {
            const [home, away] = n === 2 ? [lower.teamId!, higher.teamId!] : [higher.teamId!, lower.teamId!];
            return game(gameId(r, t, n), n, home, away, date(7 + (n - 1) * 3));
          });
          tie.gameShootouts = tie.legs.map((leg, i) => shootoutFor(leg, gameShootoutId(r, t, i + 1)));
        } else {
          tie.legs =
            round.legs === 2
              ? [
                  game(legId(r, t, 1), 1, lower.teamId, higher.teamId, date(7)),
                  game(legId(r, t, 2), 2, higher.teamId, lower.teamId, date(14)),
                ]
              : [game(legId(r, t, 1), 1, higher.teamId, lower.teamId, date(7))];
          if (round.levelTie === "penalties") {
            const last = tie.legs.at(-1)!;
            const pens = last.homeId === higher.teamId ? last.penalties : last.penalties && { home: last.penalties.away, away: last.penalties.home };
            tie.shootout = { ...shootoutFor(last, shootoutId(r, t)), homeId: higher.teamId, awayId: lower.teamId, result: pens ?? null };
          }
        }
        // Keep the leg/game fixtures free of the feed-only penalties field.
        tie.legs = tie.legs.map(({ penalties: _p, ...leg }) => leg);
      }
    }
    rounds.push(ties);
    weekOffset += round.bestOf ? 2 : round.legs;
  });
  return rounds;
}

/**
 * A drawn round: the projected seeding pairs, except that two of the round's
 * clubs with a real game between them (the feed's earliest one not used by an
 * earlier round) were drawn together. Each real pair takes the slot of its
 * better-seeded club's projected pair; clubs whose projected partner was drawn
 * elsewhere meet each other, best seed v worst, in the slots left.
 */
export function drawnPairs(
  pairs: readonly [PlayoffSide, PlayoffSide][],
  realBetween: (a: TeamId, b: TeamId) => readonly Fixture[],
): [PlayoffSide, PlayoffSide][] {
  const sides = pairs.flat();
  if (sides.some((s) => s.teamId === null)) return [...pairs];
  const bySeed = [...sides].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  const partner = new Map<TeamId, PlayoffSide>();
  for (const side of bySeed) {
    if (partner.has(side.teamId!)) continue;
    const games = bySeed
      .filter((o) => o !== side && !partner.has(o.teamId!))
      .flatMap((o) => realBetween(side.teamId!, o.teamId!).map((g) => ({ o, date: g.utcDate })))
      .sort((x, y) => x.date.localeCompare(y.date));
    const first = games[0];
    if (!first) continue;
    partner.set(side.teamId!, first.o);
    partner.set(first.o.teamId!, side);
  }
  if (partner.size === 0) return [...pairs];
  const placed = new Set<TeamId>();
  const slots: ([PlayoffSide, PlayoffSide] | null)[] = pairs.map(([a, b]) => {
    const [first, second] = (b.position ?? Infinity) < (a.position ?? Infinity) ? [b, a] : [a, b];
    for (const side of [first, second]) {
      const other = partner.get(side.teamId!);
      if (other && !placed.has(side.teamId!) && !placed.has(other.teamId!)) {
        placed.add(side.teamId!).add(other.teamId!);
        return [side, other];
      }
    }
    if (!partner.has(a.teamId!) && !partner.has(b.teamId!) && !placed.has(a.teamId!) && !placed.has(b.teamId!)) {
      placed.add(a.teamId!).add(b.teamId!);
      return [a, b];
    }
    return null;
  });
  const left = bySeed.filter((s) => !placed.has(s.teamId!));
  return slots.map((slot) => slot ?? [left.shift()!, left.pop()!]);
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
 * A series stops once a club has won it.
 */
export function simulatePlayoff(
  rows: readonly StandingRow[],
  config: PlayoffConfig,
  known: ResultMap,
  model: LeagueModel,
  rng: Rng,
  options: Omit<BracketOptions, "seasonComplete"> & {
    /** Likely rolls for the games (the simulator's buttons), not the full distribution (the chances). */
    likely?: boolean;
  },
  /** Called with each round's ties as they are played (saves rebuilding the bracket afterwards). */
  onRound?: (round: number, ties: readonly PlayoffTie[]) => void,
): ResultMap {
  const added: ResultMap = {};
  // Known and simulated results together, kept up to date rather than copied for every look-up.
  const all: ResultMap = { ...known };
  const now = () => all;
  const add = (more: ResultMap) => {
    Object.assign(added, more);
    Object.assign(all, more);
  };
  for (let r = 0; r < config.rounds.length; r++) {
    const ties = buildBracket(rows, config, now(), { ...options, seasonComplete: true, rounds: r + 1 })[r] ?? [];
    onRound?.(r, ties);
    for (const tie of ties) {
      if (tie.config.bestOf) {
        for (let i = 0; i < tie.legs.length; i++) {
          let state = seriesGames(tie, now())[i]!;
          if (!state.needed) break;
          if (!scoreOf(state.game, now())) add(simulateFixtures([state.game], now(), model, rng, { likely: options.likely ?? false }));
          state = seriesGames(tie, now())[i]!;
          if (state.needsPenalties && !scoreOf(state.shootout, now())) add({ [state.shootout.id]: simulatePenalties(rng) });
        }
        continue;
      }
      const legs = tie.legs.filter((leg) => !leg.result);
      add(simulateFixtures(legs, now(), model, rng, { likely: options.likely ?? false }));
      if (tie.shootout && !now()[tie.shootout.id] && !tie.shootout.result && needsShootout(tie, now())) {
        add({ [tie.shootout.id]: simulatePenalties(rng) });
      }
    }
  }
  return added;
}

/** Winner of a tournament's real final (its last post-season game), once played. */
export function realChampion(postseason: readonly Fixture[] | undefined): TeamId | null {
  const games = [...(postseason ?? [])].sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const last = games.at(-1);
  if (!last?.result) return null;
  // A two-legged final (Colombia): both games between the finalists, on aggregate.
  const pair = (f: Fixture) => [f.homeId, f.awayId].sort((a, b) => a - b).join("-");
  const final = games.filter((f) => pair(f) === pair(last)).slice(-2);
  if (final.some((f) => !f.result)) return null;
  const goals = new Map<TeamId, number>([[last.homeId, 0], [last.awayId, 0]]);
  for (const f of final) {
    goals.set(f.homeId, goals.get(f.homeId)! + f.result!.home);
    goals.set(f.awayId, goals.get(f.awayId)! + f.result!.away);
  }
  const [a, b] = [goals.get(last.homeId)!, goals.get(last.awayId)!];
  if (a !== b) return a > b ? last.homeId : last.awayId;
  if (!last.penalties || last.penalties.home === last.penalties.away) return null;
  return last.penalties.home > last.penalties.away ? last.homeId : last.awayId;
}
