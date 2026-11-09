import { getLeagueByCode } from "../config/leagues.ts";
import { buildBracket, PLAYOFF_ID_BASE, seedByGroupPlace, tieOutcome, type BracketOptions, type PlayoffConfig, type PlayoffTie } from "../engine/playoffs.ts";
import { balancedDoubleRoundRobin } from "../engine/schedule.ts";
import { computeStandings, sortFixtures, type StandingsOptions } from "../engine/standings.ts";
import type { Fixture, ResultMap, StandingRow, Team, TeamId } from "../engine/types.ts";

/*
 * Argentina's leagues in My World (src/lib/myWorld.ts): leagues of two zones,
 * each zone its own table, decided by play-offs across them, as the AFA plays
 * them in 2026 (the league pages' configs: src/config/leagues.ts).
 *
 * - The Liga Profesional (30 clubs): two tournaments a season, the Apertura
 *   and the Clausura, in the same two zones of 15. Each zone plays a round
 *   robin (one club free each round, who meets the other zone's free club),
 *   plus a round of interzonal derbies: 16 games. The Clausura is the
 *   Apertura's games the other way round. Each tournament's top 8 per zone
 *   play its play-offs (round of 16 across the zones, a fixed bracket, a
 *   final at a neutral ground): two champions a season. The annual table,
 *   both tournaments' games, sends its bottom two down (the real second one
 *   comes from the three-season averages, not kept here).
 * - The Primera Nacional (36 clubs): two zones of 18, home and away within
 *   the zone plus two interzonal games: 36 games. The zone winners' final
 *   (title and promotion), then the Reducido (the second promotion), as the
 *   league page plays them; the bottom two of each zone go down.
 *
 * A world's first season is the real one (its games, zones and play-off games
 * so far); later ones draw their zones in turn by rating, the stronger clubs
 * spread across both (the real zones are drawn too).
 */

export const ZONE_DIVISIONS = ["ARG", "PN"] as const;
export type ZoneDivision = (typeof ZONE_DIVISIONS)[number];
export const isZoneDivision = (code: string): code is ZoneDivision => (ZONE_DIVISIONS as readonly string[]).includes(code);

/** The Liga Profesional's rounds per tournament: the Clausura's are numbered after the Apertura's. */
export const TOURNAMENT_ROUNDS = 16;
/** A generated Clausura's game ids, after the Apertura's. */
const CLAUSURA_ID_OFFSET = 10_000;
/** The Clausura's play-off games' ids, apart from the Apertura's (and from Serie B's play-out ids). */
const CLAUSURA_PLAYOFF_BASE = PLAYOFF_ID_BASE + 2_000_000;

export type ZoneStageKey = "apertura" | "clausura" | null;

/** A division's tournaments in a season: the Liga Profesional's Apertura and Clausura, or the Primera Nacional's one. */
export const zoneStageKeys = (code: ZoneDivision): ZoneStageKey[] => (code === "ARG" ? ["apertura", "clausura"] : [null]);

/** Which tournament a game belongs to, by its matchday. */
export const stageOfMatchday = (code: ZoneDivision, matchday: number) => (code === "ARG" && matchday > TOURNAMENT_ROUNDS ? 1 : 0);

/** A tournament's play-off: the league's own, its games numbered apart for the Clausura. */
export function zonePlayoffConfig(code: ZoneDivision, stage: number): PlayoffConfig {
  const config = getLeagueByCode(code)!.playoff!;
  return stage === 1 ? { ...config, idBase: CLAUSURA_PLAYOFF_BASE } : config;
}

/** Two zones drawn in turn from the clubs, strongest first: A, B, B, A, A, B… */
export function drawZones(byStrength: readonly TeamId[]): TeamId[][] {
  const zones: TeamId[][] = [[], []];
  byStrength.forEach((id, i) => zones[[0, 1, 1, 0][i % 4]!]!.push(id));
  return zones;
}

/**
 * A generated season's games. The Liga Profesional: each zone's round robin
 * (one club free each round, meeting the other zone's), a round of
 * interzonal derbies, then the Clausura the other way round. The Primera
 * Nacional: each zone home and away, an interzonal round after each half.
 */
export function zoneFixtures(code: ZoneDivision, zones: readonly (readonly TeamId[])[], startDate: string): Fixture[] {
  const start = Date.parse(startDate);
  const week = 7 * 24 * 60 * 60 * 1000;
  const games: { matchday: number; homeId: TeamId; awayId: TeamId; id?: number }[] = [];
  const [a, b] = [zones[0] ?? [], zones[1] ?? []];
  if (code === "ARG") {
    // One round robin per zone (the first half of a balanced double one): with an odd zone, one club free each round.
    const halves = [a, b].map((ids) => balancedDoubleRoundRobin(ids, startDate).filter((f) => f.matchday <= ids.length - (ids.length % 2 === 1 ? 0 : 1)));
    const rounds = Math.max(...halves.map((h) => h.reduce((m, f) => Math.max(m, f.matchday), 0)));
    const freeIn = (ids: readonly TeamId[], half: readonly Fixture[], round: number) => ids.find((id) => !half.some((f) => f.matchday === round && (f.homeId === id || f.awayId === id)));
    const apertura: typeof games = halves.flat().map((f) => ({ matchday: f.matchday, homeId: f.homeId, awayId: f.awayId }));
    const freeA: TeamId[] = [];
    const freeB: TeamId[] = [];
    for (let round = 1; round <= rounds; round++) {
      const x = freeIn(a, halves[0]!, round);
      const y = freeIn(b, halves[1]!, round);
      if (x === undefined || y === undefined) continue;
      freeA.push(x);
      freeB.push(y);
      apertura.push(round % 2 === 1 ? { matchday: round, homeId: x, awayId: y } : { matchday: round, homeId: y, awayId: x });
    }
    // The derby round: each club against another of the other zone than the one it met when free.
    freeA.forEach((x, i) => {
      const y = freeB[(i + 1) % freeB.length]!;
      apertura.push(i % 2 === 0 ? { matchday: rounds + 1, homeId: x, awayId: y } : { matchday: rounds + 1, homeId: y, awayId: x });
    });
    const clausura = apertura.map((g) => ({ matchday: g.matchday + TOURNAMENT_ROUNDS, homeId: g.awayId, awayId: g.homeId }));
    let n = 0;
    games.push(...apertura.map((g) => ({ ...g, id: ++n })));
    n = CLAUSURA_ID_OFFSET;
    games.push(...clausura.map((g) => ({ ...g, id: ++n })));
  } else {
    // Each zone home and away; an interzonal round after each half (zone A's i-th club v zone B's, home then away).
    const half = Math.max(a.length, b.length) - 1;
    for (const ids of [a, b]) {
      for (const f of balancedDoubleRoundRobin(ids, startDate)) games.push({ matchday: f.matchday <= half ? f.matchday : f.matchday + 1, homeId: f.homeId, awayId: f.awayId });
    }
    const pairs = a.map((x, i) => [x, b[i]] as const).filter((p): p is readonly [TeamId, TeamId] => p[1] !== undefined);
    pairs.forEach(([x, y], i) => {
      games.push(i % 2 === 0 ? { matchday: half + 1, homeId: x, awayId: y } : { matchday: half + 1, homeId: y, awayId: x });
      games.push(i % 2 === 0 ? { matchday: 2 * half + 2, homeId: y, awayId: x } : { matchday: 2 * half + 2, homeId: x, awayId: y });
    });
    games.sort((g, h) => g.matchday - h.matchday);
    games.forEach((g, i) => (g.id = i + 1));
  }
  return games.map((g) => ({ id: g.id!, matchday: g.matchday, utcDate: new Date(start + (g.matchday - 1) * week).toISOString(), homeId: g.homeId, awayId: g.awayId, result: null }));
}

/** One tournament of a zone league: its games, each zone's table and its play-off. */
export interface ZoneStage {
  key: ZoneStageKey;
  index: number;
  fixtures: Fixture[];
  /** Each zone's table (its games against the other zone count in it). */
  tables: StandingRow[][];
  /** Every game has a score: the play-off's clubs are known. */
  complete: boolean;
  config: PlayoffConfig;
  /** The play-off's seeding, from the zone tables. */
  seeds: StandingRow[];
  bracket: PlayoffTie[][];
  options: Omit<BracketOptions, "seasonComplete">;
  /** Its play-off is decided. */
  decided: boolean;
  /** The champion (the play-off's title round), once decided. */
  champion: TeamId | null;
  /** The final's runner-up, once decided. */
  runnerUp: TeamId | null;
  /** The Primera Nacional's Reducido winner (its last round), once decided. */
  promoted: TeamId | null;
}

/** A zone league's season: its zones, its tournaments and (the Liga Profesional) its annual table. */
export interface ZoneSeason {
  code: ZoneDivision;
  zones: TeamId[][];
  stages: ZoneStage[];
  /** The Liga Profesional's annual table: every club over both tournaments. */
  annual: StandingRow[] | null;
  /** The season's table as saved: the annual table, or the Primera Nacional's classification (the champion first). */
  rows: StandingRow[];
  complete: boolean;
  decided: boolean;
}

const decidedRounds = (bracket: readonly (readonly PlayoffTie[])[], results: ResultMap) => bracket.length > 0 && bracket.every((round) => round.every((tie) => tieOutcome(tie, results) !== null));

/**
 * A zone league's season from its games and scores. `results`: every game's
 * score so far (the regular games'); `picks`: the play-off scores (and any
 * others); `real`: each tournament's real play-off games (a world's first
 * season); `date`: a game date for the play-offs' placeholder kick-offs.
 */
export function zoneSeason(input: {
  code: ZoneDivision;
  teams: readonly Team[];
  zones: readonly (readonly TeamId[])[];
  fixtures: readonly Fixture[];
  results: ResultMap;
  picks: ResultMap;
  real?: readonly (readonly Fixture[])[];
  options: StandingsOptions;
  date: (matchday: number) => string;
}): ZoneSeason {
  const { code, teams, results, picks, options } = input;
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  const zones = input.zones.map((ids) => [...ids]);
  const all = sortFixtures(input.fixtures);
  const scores = { ...picks, ...results };
  const stages = zoneStageKeys(code).map((key, index): ZoneStage => {
    const fixtures = all.filter((f) => stageOfMatchday(code, f.matchday) === index);
    const tables = zones.map((ids) => computeStandings(ids.flatMap((id) => teamMap.get(id) ?? []), fixtures, results, { ...options, includeForm: false }));
    const complete = fixtures.length > 0 && fixtures.every((f) => results[f.id]);
    const config = zonePlayoffConfig(code, index);
    const seeding = config.seedFromGroups!;
    const seeds = seedByGroupPlace(tables, [], seeding.places, seeding.interleave);
    const last = fixtures.reduce((m, f) => Math.max(m, f.matchday), 0);
    const real = input.real?.[index] ?? [];
    const stageOptions = { afterMatchday: last, afterDate: input.date(last), groups: tables, ...(real.length ? { real } : {}) };
    const bracket = buildBracket(seeds, config, scores, { ...stageOptions, seasonComplete: complete });
    const decided = complete && decidedRounds(bracket, scores);
    const outcome = (round: number | undefined) => (round === undefined ? null : bracket[round]?.[0] ? tieOutcome(bracket[round]![0]!, scores) : null);
    const titleRound = config.titleRound ?? config.rounds.length - 1;
    const title = complete ? outcome(titleRound) : null;
    const titleTie = bracket[titleRound]?.[0];
    const runnerUp = title && titleTie ? (title.winner === titleTie.higher.teamId ? titleTie.lower.teamId : titleTie.higher.teamId) : null;
    const promoted = complete && config.titleRound !== undefined ? (outcome(config.rounds.length - 1)?.winner ?? null) : null;
    return { key, index, fixtures, tables, complete, config, seeds, bracket, options: stageOptions, decided, champion: title?.winner ?? null, runnerUp, promoted };
  });
  const annual = code === "ARG" ? computeStandings(zones.flat().flatMap((id) => teamMap.get(id) ?? []), all, results, { ...options, includeForm: false }) : null;
  let rows: StandingRow[];
  if (annual) rows = annual;
  else {
    // The Primera Nacional: by zone place then record, the final's winner and runner-up first once decided.
    const stage = stages[0]!;
    const ranked = seedByGroupPlace(stage.tables, [], Infinity).map((r) => r.teamId);
    const top = [stage.champion, stage.runnerUp].filter((id): id is TeamId => id !== null);
    const order = [...top, ...ranked.filter((id) => !top.includes(id))];
    const totals = new Map(stage.tables.flat().map((r) => [r.teamId, r]));
    rows = order.map((id, i) => ({ ...totals.get(id)!, position: i + 1 }));
  }
  return { code, zones, stages, annual, rows, complete: stages.every((s) => s.complete), decided: stages.every((s) => s.decided) };
}

/** The Liga Profesional's relegated: the annual table's bottom two (once both tournaments are played); the Primera Nacional's: each zone's bottom two. */
export function zoneRelegated(season: ZoneSeason): TeamId[] {
  if (!season.complete) return [];
  if (season.annual) return season.annual.slice(-2).map((r) => r.teamId);
  return season.stages[0]!.tables.flatMap((table) => table.slice(-2).map((r) => r.teamId));
}

/** Clubs each zone league sends up and down a season: the Liga Profesional two down; the Primera Nacional two up (the final's and the Reducido's winners) and four down. */
export const zoneMovement = (code: ZoneDivision): { up: number; down: number } => (code === "ARG" ? { up: 0, down: 2 } : { up: 2, down: 4 });
