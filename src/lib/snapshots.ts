import type { CompetitionCode, LeagueConfig, ZoneKind } from "../config/leagues.ts";
import { leagueTimeZone } from "../config/timezones.ts";
import type { Fixture } from "../engine/types.ts";
import { dataAsOf, leagueOutlook, outlookSetup, type OutlookSetup } from "./clubOutlook.ts";
import type { LeagueData } from "./leagueData.ts";
import { localDate } from "./matches.ts";
import { SIM_VERSION } from "./simVersion.ts";

/*
 * Odds snapshots: every club's season chances after each completed round,
 * one JSON file per league in src/data/snapshots, added by a scheduled job
 * (scripts/snapshot-odds.ts, .github/workflows/odds-snapshots.yml) and
 * committed, so the history is durable, versioned and readable at build and
 * run time with no database.
 */

/** One club's chances after a round. */
export interface TeamSnapshot {
  /** Its place and points in the table then. */
  position: number;
  points: number;
  played: number;
  /** Mean final place over the simulated seasons. */
  expectedPosition: number;
  averagePoints: number;
  /** Chance of each place the league's config lists, by zone kind ("title" when the table decides it). */
  chances: Partial<Record<ZoneKind, number>>;
  /** Its place in the most likely final table (one club per place, see mostLikelyPlaces), and its chance of that place. */
  projected?: number;
  projectedChance?: number;
}

export interface OddsSnapshot {
  /** The round (matchday) just completed. */
  round: number;
  /** Its last game's day, in the league's time zone ("2026-11-02"). */
  date: string;
  /** The moment the chances are as of: just after that round's last kick-off; later results are left out. */
  asOf: string;
  /** When the snapshot was taken. */
  takenAt: string;
  /** League games played by then. */
  played: number;
  iterations: number;
  /**
   * The model it was taken with (SIM_VERSION then; none before the field
   * existed: model "1", see snapshotModel). Chances from two models differ by
   * more than the results between them, so a report across a change says so.
   */
  modelVersion?: string;
  /** Places over the whole table, within each conference (MLS), or in the annual table. */
  scope: "table" | "eachTable" | "annual";
  /** By club id. */
  teams: Record<string, TeamSnapshot>;
}

/** The model a snapshot was taken with: its modelVersion, or "1" for one taken before snapshots carried it. */
export const snapshotModel = (snapshot: Pick<OddsSnapshot, "modelVersion">) => snapshot.modelVersion ?? "1";

export interface LeagueSnapshots {
  league: CompetitionCode;
  /** By season key (each tournament of a split year apart: "ARG:2026:torneo-clausura"). */
  seasons: Record<string, { season: string; snapshots: OddsSnapshot[] }>;
}

const DAY = 86_400_000;
/** A round's games: those within this many days of its median kick-off (a game moved weeks away isn't waited for). */
const ROUND_WINDOW = 4 * DAY;
/** A game this long past kick-off with no result is postponed or abandoned: its round doesn't wait for it. */
const OVERDUE = 2 * DAY;
/** A game's result is in by this long after kick-off. */
const GAME_LENGTH = 3 * 3_600_000;

/**
 * The rounds completed so far, in order, each numbered by how many rounds are
 * complete then (the "Matchday 13" fans count) with the moment it was.
 * Rounds are rebuilt from dates (ESPN has no round numbers), and a few hold
 * games scattered over months, so they're taken in the order they were
 * played (each by its median kick-off), not by their number: the first ones,
 * up to the first still to finish, with the last kick-off among them. Rounds
 * completed at the same moment count as one, the highest.
 */
export function completedRounds(fixtures: readonly Fixture[], now = Date.now()): { round: number; lastKickoff: string }[] {
  const byRound = new Map<number, Fixture[]>();
  for (const f of fixtures) byRound.set(f.matchday, [...(byRound.get(f.matchday) ?? []), f]);
  const rounds = [...byRound.values()].map((games) => {
    const times = games.map((g) => Date.parse(g.utcDate)).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)]!;
    // Its own games: a game moved far from the others' dates isn't waited for.
    return { median, core: games.filter((g) => Math.abs(Date.parse(g.utcDate) - median) <= ROUND_WINDOW) };
  });
  rounds.sort((a, b) => a.median - b.median);
  const out: { round: number; lastKickoff: string }[] = [];
  let moment = "";
  for (const [i, { core }] of rounds.entries()) {
    const played = core.filter((g) => g.result);
    const done = core.every((g) => g.result || Date.parse(g.utcDate) < now - OVERDUE);
    if (!played.length || !done) break;
    for (const g of played) if (g.utcDate > moment) moment = g.utcDate;
    if (Date.parse(moment) + GAME_LENGTH > now) break;
    if (out.at(-1)?.lastKickoff === moment) out.pop();
    out.push({ round: i + 1, lastKickoff: moment });
  }
  return out;
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

/**
 * The models a snapshot can be taken with today: the current one (SIM_VERSION)
 * and earlier ones today's engine still reproduces, each as a change to the
 * league's setup, so the drift check (scripts/check-snapshots.ts) can retake a
 * snapshot stored with an older model. "1": today's engine without rating noise
 * (model "2", roadmap item 4, changed nothing else). A model missing here can't
 * be retaken: its snapshots are left alone.
 */
export const REPRODUCIBLE_MODELS: Readonly<Record<string, (setup: OutlookSetup) => OutlookSetup>> = {
  [SIM_VERSION]: (setup) => setup,
  "1": (setup) => {
    const { ratingNoise: _, ...input } = setup.input;
    return { ...setup, input };
  },
};

/**
 * Every club's chances just after a round: the league's Monte Carlo from the
 * results up to its last game. `model`: one of REPRODUCIBLE_MODELS (today's by
 * default), recorded as the snapshot's modelVersion.
 */
export function snapshotAfter(
  league: LeagueConfig,
  data: LeagueData,
  round: number,
  lastKickoff: string,
  takenAt = new Date(),
  iterations?: number,
  model: string = SIM_VERSION,
): OddsSnapshot | null {
  const withModel = REPRODUCIBLE_MODELS[model];
  if (!withModel) throw new Error(`model ${model} can't be reproduced (see REPRODUCIBLE_MODELS)`);
  // Just after the last kick-off: that game counts, any later one doesn't.
  const asOf = new Date(Date.parse(lastKickoff) + 60_000).toISOString();
  const then = dataAsOf(data, asOf);
  const setup = outlookSetup(league, then);
  const outlook = setup ? leagueOutlook(league, then, iterations, undefined, withModel(setup)) : null;
  if (!outlook) return null;
  const teams: Record<string, TeamSnapshot> = {};
  for (const club of outlook.clubs.values()) {
    teams[String(club.team.id)] = {
      position: club.row.position,
      points: club.row.points,
      played: club.row.played,
      expectedPosition: round4(club.expectedPosition),
      averagePoints: round4(club.averagePoints),
      chances: Object.fromEntries(club.zones.map((z) => [z.kind, round4(z.chance)])),
      projected: club.likeliest.position,
      projectedChance: round4(club.likeliest.chance),
    };
  }
  return {
    round,
    date: localDate(lastKickoff, leagueTimeZone(league.code)),
    asOf,
    takenAt: takenAt.toISOString(),
    played: then.fixtures.filter((f) => f.result).length,
    iterations: outlook.iterations,
    modelVersion: model,
    scope: outlook.scope,
    teams,
  };
}

/**
 * The rounds still to snapshot: every completed round after the last one
 * stored for the season, or only the latest when none is stored yet (a
 * starting point, not a backfill of the whole season).
 */
export function pendingRounds(file: LeagueSnapshots | undefined, seasonKey: string, completed: readonly { round: number; lastKickoff: string }[]) {
  const stored = file?.seasons[seasonKey]?.snapshots ?? [];
  if (!stored.length) return completed.slice(-1);
  const last = Math.max(...stored.map((s) => s.round));
  return completed.filter((r) => r.round > last);
}

/** How far a retaken snapshot may be from the stored one: none (both are rounded to 4 decimals from the same seeded run). */
export const DRIFT_EPSILON = 0;

/** A club's figure that differs between a stored snapshot and the same snapshot taken again. */
export interface Drift {
  teamId: string;
  /** "chances.title", "projected", "expectedPosition", "points"…, or "club" for a club in one and not the other. */
  field: string;
  stored?: number;
  again?: number;
}

/**
 * The figures that differ between a stored snapshot and the same round taken
 * again (same moment, iterations and model): every club's table row, its
 * chance of each place, its expected place and points, and its projected place,
 * by more than `epsilon`. Empty when the live engine reproduces it.
 */
export function snapshotDrift(stored: OddsSnapshot, again: OddsSnapshot, epsilon = DRIFT_EPSILON): Drift[] {
  const out: Drift[] = [];
  const ids = [...new Set([...Object.keys(stored.teams), ...Object.keys(again.teams)])].sort((a, b) => Number(a) - Number(b));
  for (const teamId of ids) {
    const a = stored.teams[teamId];
    const b = again.teams[teamId];
    if (!a || !b) {
      out.push({ teamId, field: "club" });
      continue;
    }
    const figures = (t: TeamSnapshot): Record<string, number | undefined> => ({
      position: t.position,
      points: t.points,
      played: t.played,
      expectedPosition: t.expectedPosition,
      averagePoints: t.averagePoints,
      projected: t.projected,
      projectedChance: t.projectedChance,
      ...Object.fromEntries(Object.entries(t.chances).map(([kind, chance]) => [`chances.${kind}`, chance])),
    });
    const fa = figures(a);
    const fb = figures(b);
    for (const field of [...new Set([...Object.keys(fa), ...Object.keys(fb)])]) {
      const x = fa[field];
      const y = fb[field];
      if (x === undefined && y === undefined) continue;
      if (x === undefined || y === undefined || Math.abs(x - y) > epsilon + 1e-12) out.push({ teamId, field, ...(x !== undefined ? { stored: x } : {}), ...(y !== undefined ? { again: y } : {}) });
    }
  }
  return out;
}

/**
 * The season's stored rounds, to take again (a rebuild with today's engine):
 * each as of its last kick-off now (as of its stored moment when its round no
 * longer counts as completed).
 */
export function storedRounds(file: LeagueSnapshots | undefined, seasonKey: string, completed: readonly { round: number; lastKickoff: string }[]) {
  return (file?.seasons[seasonKey]?.snapshots ?? []).map(
    (s) => completed.find((r) => r.round === s.round) ?? { round: s.round, lastKickoff: new Date(Date.parse(s.asOf) - 60_000).toISOString() },
  );
}

/**
 * Every completed round not stored yet for the season, earlier ones included
 * (a backfill: each is taken as of its own last kick-off, so it's what the
 * snapshot would have been at the time).
 */
export function missingRounds(file: LeagueSnapshots | undefined, seasonKey: string, completed: readonly { round: number; lastKickoff: string }[]) {
  const stored = new Set((file?.seasons[seasonKey]?.snapshots ?? []).map((s) => s.round));
  return completed.filter((r) => !stored.has(r.round));
}

/**
 * The first moment a backfilled snapshot can be taken as of, or undefined for
 * any. A split league whose groups are already known (Ecuador): before its
 * second phase, the season's simulation would already know who went where.
 */
export function backfillFrom(league: LeagueConfig, data: LeagueData): string | undefined {
  if (!league.split || !data.groups?.length) return undefined;
  const first = new Set(data.firstPhaseIds ?? []);
  const later = data.fixtures.filter((f) => (first.size ? !first.has(f.id) : f.matchday > (league.split!.afterRound ?? Infinity)));
  return later.reduce<string | undefined>((min, f) => (min === undefined || f.utcDate < min ? f.utcDate : min), undefined);
}

/** The file with the new snapshots added (a round already stored is replaced), in round order. */
export function addSnapshots(file: LeagueSnapshots | undefined, league: CompetitionCode, seasonKey: string, season: string, snapshots: readonly OddsSnapshot[]): LeagueSnapshots {
  const out: LeagueSnapshots = file ? { ...file, seasons: { ...file.seasons } } : { league, seasons: {} };
  const existing = out.seasons[seasonKey]?.snapshots ?? [];
  const rounds = new Set(snapshots.map((s) => s.round));
  out.seasons[seasonKey] = { season, snapshots: [...existing.filter((s) => !rounds.has(s.round)), ...snapshots].sort((a, b) => a.round - b.round) };
  return out;
}
