import { expectedGoals, sampleDixonColes, sampleNormal, sampleScore, scoreSampler, type ScoreSampler } from "./match.ts";
import { seedByGroupPlace, simulatePlayoff, tieOutcome, type BracketOptions, type PlayoffConfig, type PlayoffTie } from "./playoffs.ts";
import type { LeagueModel } from "./ratings.ts";
import { createRng } from "./rng.ts";
import { splitFixtures, splitGroupsFrom, type SplitGroupConfig } from "./split.ts";
import { computeStandings, splitStandings, standingsBuilder, type StandingsOptions } from "./standings.ts";
import type { Fixture, ResultMap, StandingRow, Team, TeamId } from "./types.ts";

export interface MonteCarloInput {
  teams: readonly Team[];
  fixtures: readonly Fixture[];
  /** Results treated as fixed (real results plus the user's own predictions). */
  fixed: ResultMap;
  /**
   * Results set after each run's games are drawn ("what if this game ends
   * 2–1"): every other game gets the same draws as without them (common random
   * numbers), so the difference from a run without `override` is the result's
   * effect alone, not simulation noise.
   */
  override?: ResultMap;
  model: LeagueModel;
  standings: StandingsOptions;
  iterations: number;
  seed: number;
  /**
   * Separate tables within the league (MLS conferences): each run ranks every
   * group on its own, and positions are within the team's group.
   */
  groups?: readonly (readonly TeamId[])[];
  /** With `groups`: each group's own games (a split's groups: their games only), in place of `fixtures`. */
  groupFixtures?: readonly (readonly Fixture[])[];
  /** With `groups`: each group's own table options (a split's carried points), in place of `standings`. */
  groupStandings?: readonly StandingsOptions[];
  /**
   * A split not yet published (Greece before its play-offs): each run plays
   * the first phase (`fixtures`), then the split's games generated from that
   * run's table (predictions for them, by id, stand). Ranks with `standings`,
   * whose `split` keeps the groups apart.
   */
  project?: { afterRound: number; afterDate: string; groups: readonly SplitGroupConfig[] };
  /**
   * Also play the knockout phase after each run's table (UEFA): real knockout
   * results stand, everything else is simulated. With `groups`, only for a
   * knockout seeded from the group places (`seedFromGroups`, Libertadores).
   */
  /**
   * Clubs whose places pass down (qualified by another route): zone chances
   * then use positions among the other clubs (see `zonePositionCounts`).
   */
  passDown?: readonly TeamId[];
  /**
   * Rating uncertainty, off unless given (the season backtest tries it; the
   * site doesn't use it): at the start of each simulated season every club's
   * attack and defence are multiplied by exp(N(0, s)), s = sd × √(k / (k +
   * its games played so far)), so a club's rating is less sure early on. The
   * season's games are then drawn from those ratings.
   */
  ratingNoise?: { sd: number; k: number };
  playoff?: {
    config: PlayoffConfig;
    options: Omit<BracketOptions, "seasonComplete">;
    /** Clubs joining the knockout phase from another competition (see `seedFromGroups.external`). */
    external?: readonly StandingRow[];
  };
}

export interface MonteCarloResult {
  iterations: number;
  /** positionCounts[teamId][p] = number of runs the team finished in position p+1 (within its group, if any). */
  positionCounts: Record<TeamId, number[]>;
  averagePoints: Record<TeamId, number>;
  /** With `passDown`: zonePositionCounts[teamId][p] = runs at position p+1 among clubs not passing down. */
  zonePositionCounts?: Record<TeamId, number[]>;
  /** With `playoff`: playoffReached[teamId][r] = runs the club played in knockout round r. */
  playoffReached?: Record<TeamId, number[]>;
  /** With `playoff`: runs the club won the knockout phase. */
  playoffWins?: Record<TeamId, number>;
}

/** Rating noise's spread for a club with `gamesPlayed` games so far: sd × √(k / (k + games)), shrinking as games come in. */
export const ratingNoiseSd = (sd: number, k: number, gamesPlayed: number) => sd * Math.sqrt(k / (k + gamesPlayed));

/** A run keeps the split's generated games for this many different groupings at most. */
const SPLIT_GAMES_KEPT = 20_000;

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  return runMonteCarloVariants(input, [input.override ?? {}])[0]!;
}

/**
 * The same simulated seasons finished several ways ("what if this game ends
 * 2–1, 1–1 or 1–2"): each season's remaining games are drawn once, then the
 * season is finished once per variant, its results set on top of the draws
 * (as `override` does), into that variant's own counts. Every variant gets the
 * full `iterations` seasons, and the draws after the remaining games (split
 * games, play-offs) start from the same point for each, so the variants differ
 * by their results alone. The first variant is exactly runMonteCarlo with its
 * `override` (with `{}`, the plain run); several cost one season's draws plus
 * a table per variant, instead of a whole run each.
 */
export function runMonteCarloVariants(input: Omit<MonteCarloInput, "override">, variants: readonly ResultMap[]): MonteCarloResult[] {
  const { teams, fixtures, fixed, model, standings, iterations } = input;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const tables = input.groups?.length
    ? input.groups.map((ids) => ids.flatMap((id) => byId.get(id) ?? []))
    : [teams];
  const rng = createRng(input.seed);
  // Each remaining game's score distribution (Dixon–Coles adjusted), built once.
  const rho = model.rho ?? 0;
  const remaining = fixtures
    .filter((f) => !fixed[f.id])
    .map((f) => ({ id: f.id, homeId: f.homeId, awayId: f.awayId, sampler: scoreSampler(expectedGoals(model, f.homeId, f.awayId), rho) }));
  // Rating noise: each club's spread, from its games played so far.
  const noise = input.ratingNoise && input.ratingNoise.sd > 0 ? input.ratingNoise : undefined;
  const noiseSd = new Map<TeamId, number>();
  if (noise) {
    const played = new Map<TeamId, number>();
    for (const f of fixtures) if (fixed[f.id]) for (const id of [f.homeId, f.awayId]) played.set(id, (played.get(id) ?? 0) + 1);
    for (const t of teams) noiseSd.set(t.id, ratingNoiseSd(noise.sd, noise.k, played.get(t.id) ?? 0));
  }
  /** Generated split games: one distribution per pairing. */
  const pairSamplers = new Map<string, ScoreSampler>();
  const pairSampler = (homeId: TeamId, awayId: TeamId) => {
    const key = `${homeId}-${awayId}`;
    let sampler = pairSamplers.get(key);
    if (!sampler) pairSamplers.set(key, (sampler = scoreSampler(expectedGoals(model, homeId, awayId), rho)));
    return sampler;
  };

  const grouped = Boolean(input.groups?.length);
  const playoff = !grouped || input.playoff?.config.seedFromGroups ? input.playoff : undefined;
  const passDown = new Set(input.passDown ?? []);
  // Each variant's counts.
  const counts = variants.map(() => {
    const positionCounts: Record<TeamId, number[]> = {};
    const pointsTotal: Record<TeamId, number> = {};
    const zonePositionCounts: Record<TeamId, number[]> = {};
    for (const t of teams) {
      const size = tables.find((table) => table.includes(t))?.length ?? teams.length;
      positionCounts[t.id] = new Array<number>(size).fill(0);
      pointsTotal[t.id] = 0;
      if (passDown.size) zonePositionCounts[t.id] = new Array<number>(teams.length).fill(0);
    }
    return { positionCounts, pointsTotal, zonePositionCounts, playoffReached: {} as Record<TeamId, number[]>, playoffWins: {} as Record<TeamId, number> };
  });

  const tableOptions: StandingsOptions = { ...standings, includeForm: false };
  const results: ResultMap = { ...fixed };
  // The games a variant sets: put back to their draw before the next variant sets its own.
  const overridden = [...new Set(variants.flatMap((v) => Object.keys(v)))].map(Number);
  // Each table's games already played, added up once: a season adds only the rest (a split's tables: computeStandings).
  const changing = new Set<number>([...remaining.map((r) => r.id), ...overridden]);
  const groupOptions = tables.map((_, g) => (input.groupStandings?.[g] ? { ...input.groupStandings[g], includeForm: false } : tableOptions));
  const builders = tables.map((group, g) => (input.project ? undefined : standingsBuilder(group, input.groupFixtures?.[g] ?? fixtures, fixed, groupOptions[g]!, changing)));
  const splitTable = input.project ? standingsBuilder(teams, fixtures, fixed, { ...tableOptions, split: undefined }, changing) : undefined;
  const splitGames = new Map<string, Fixture[]>();
  // A projected split ranked straight from the table at the split: when the table's own split is this one and every
  // first-phase game is in `fixtures` (so computeStandings's first-phase table is that same table).
  const splitDirect = Boolean(
    input.project &&
      !grouped &&
      tableOptions.split &&
      tableOptions.split.afterRound === input.project.afterRound &&
      fixtures.every((f) => f.matchday <= input.project!.afterRound),
  );
  for (let i = 0; i < iterations; i++) {
    // This season's ratings: the model's, or with rating noise each club's drawn around them.
    let season = model;
    if (noise) {
      const strengths = new Map(model.strengths);
      for (const t of teams) {
        const s = model.strengths.get(t.id) ?? { attack: 1, defence: 1 };
        const sd = noiseSd.get(t.id)!;
        strengths.set(t.id, { attack: s.attack * Math.exp(sd * sampleNormal(rng)), defence: s.defence * Math.exp(sd * sampleNormal(rng)) });
      }
      season = { ...model, strengths };
      for (const r of remaining) results[r.id] = sampleDixonColes(expectedGoals(season, r.homeId, r.awayId), rho, rng);
    } else for (const r of remaining) results[r.id] = sampleScore(r.sampler, rng);
    const drawn = overridden.map((id) => results[id]);
    const at = rng.state;
    // Where the first variant's season left the draws: the next season goes on from there, so the first variant
    // is exactly a run of its own (runMonteCarlo with its override), whatever the others draw.
    let after = at;
    for (const [v, variant] of variants.entries()) {
      const count = counts[v]!;
      if (v > 0) {
        after = v === 1 ? rng.state : after;
        rng.state = at;
        overridden.forEach((id, j) => {
          const score = drawn[j];
          if (score) results[id] = score;
          else delete results[id];
        });
      }
      Object.assign(results, variant);
      let played: readonly Fixture[] = fixtures;
      let splitRows: StandingRow[] | undefined;
      if (input.project) {
        const { afterRound, afterDate, groups } = input.project;
        const atSplit = splitTable ? splitTable(results) : computeStandings(teams, fixtures, results, { ...tableOptions, split: undefined });
        // Each group's games depend only on its clubs, in order: the same ones come round again and again.
        const extra = splitGroupsFrom(atSplit, groups).flatMap((members, g) => {
          const key = `${g}:${members.join(",")}`;
          let games = splitGames.get(key);
          if (!games) {
            games = splitFixtures([members], [groups[g]!], afterRound, afterDate);
            if (splitGames.size < SPLIT_GAMES_KEPT) splitGames.set(key, games);
          }
          return games;
        });
        for (const f of extra)
          results[f.id] = fixed[f.id] ?? (noise ? sampleDixonColes(expectedGoals(season, f.homeId, f.awayId), rho, rng) : sampleScore(pairSampler(f.homeId, f.awayId), rng));
        played = [...fixtures, ...extra];
        // The table after the split, from the table at it (computeStandings would work that out again).
        if (splitDirect && extra.length) splitRows = splitStandings(teams, played, results, tableOptions, atSplit);
      }
      const groupRows: ReturnType<typeof computeStandings>[] = [];
      for (const [g, group] of tables.entries()) {
        const build = builders[g];
        const rows = splitRows ?? (build ? build(results) : computeStandings(group, input.groupFixtures?.[g] ?? played, results, groupOptions[g]!));
        let zonePosition = 0;
        for (const row of rows) {
          count.positionCounts[row.teamId]![row.position - 1]!++;
          count.pointsTotal[row.teamId]! += row.points;
          if (passDown.size && !passDown.has(row.teamId)) count.zonePositionCounts[row.teamId]![zonePosition++]!++;
        }
        groupRows.push(rows);
      }
      if (playoff) {
        const seeding = playoff.config.seedFromGroups;
        const rows = grouped ? seedByGroupPlace(groupRows, playoff.external, seeding?.places, seeding?.interleave) : groupRows[0]!;
        // The bracket only needs the table and knockout results (real ones come with the options).
        const roundCount = playoff.config.rounds.length;
        let final: PlayoffTie | undefined;
        const played = simulatePlayoff(rows, playoff.config, {}, season, rng, playoff.options, (r, ties) => {
          for (const tie of ties) {
            for (const id of [tie.higher.teamId, tie.lower.teamId]) {
              if (id !== null) (count.playoffReached[id] ??= new Array<number>(roundCount).fill(0))[r]!++;
            }
          }
          if (r === roundCount - 1) final = ties[0];
        });
        const winner = final ? tieOutcome(final, played)?.winner : undefined;
        if (winner !== undefined) count.playoffWins[winner] = (count.playoffWins[winner] ?? 0) + 1;
      }
    }
    if (variants.length > 1) rng.state = after;
  }

  return counts.map(({ positionCounts, pointsTotal, zonePositionCounts, playoffReached, playoffWins }) => {
    const averagePoints: Record<TeamId, number> = {};
    for (const t of teams) averagePoints[t.id] = iterations > 0 ? pointsTotal[t.id]! / iterations : 0;
    return {
      iterations,
      positionCounts,
      averagePoints,
      ...(passDown.size ? { zonePositionCounts } : {}),
      ...(playoff ? { playoffReached, playoffWins } : {}),
    };
  });
}

/**
 * Probability that a team finishes within positions [from, to] (1-based,
 * inclusive); with `zone`, positions among the clubs not passing down.
 */
export function probabilityInRange(result: MonteCarloResult, teamId: TeamId, from: number, to: number, zone = false): number {
  const counts = (zone && result.zonePositionCounts ? result.zonePositionCounts : result.positionCounts)[teamId];
  if (!counts || result.iterations === 0) return 0;
  let n = 0;
  for (let p = from; p <= to; p++) n += counts[p - 1] ?? 0;
  return n / result.iterations;
}
