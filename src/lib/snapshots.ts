import type { CompetitionCode, LeagueConfig, ZoneKind } from "../config/leagues.ts";
import { leagueTimeZone } from "../config/timezones.ts";
import type { Fixture } from "../engine/types.ts";
import { dataAsOf, leagueOutlook } from "./clubOutlook.ts";
import type { LeagueData } from "./leagueData.ts";
import { localDate } from "./matches.ts";

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
  /** Places over the whole table, within each conference (MLS), or in the annual table. */
  scope: "table" | "eachTable" | "annual";
  /** By club id. */
  teams: Record<string, TeamSnapshot>;
}

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

/** Every club's chances just after a round: the league's Monte Carlo from the results up to its last game. */
export function snapshotAfter(league: LeagueConfig, data: LeagueData, round: number, lastKickoff: string, takenAt = new Date(), iterations?: number): OddsSnapshot | null {
  // Just after the last kick-off: that game counts, any later one doesn't.
  const asOf = new Date(Date.parse(lastKickoff) + 60_000).toISOString();
  const then = dataAsOf(data, asOf);
  const outlook = leagueOutlook(league, then, iterations);
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
