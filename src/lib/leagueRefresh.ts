import { timingSafeEqual } from "node:crypto";
import type { LeagueConfig } from "../config/leagues.ts";
import type { Fixture } from "../engine/types.ts";
import { dataVersion } from "./clubOutlook.ts";
import type { LeagueData } from "./leagueData.ts";

/*
 * When to refresh a league's pages together (src/app/api/revalidate/leagues):
 * the route compares ESPN's data now with the cached copy the pages are built
 * from and, only when they differ, expires the league's tags, so every page
 * is rebuilt from the new data on its next visit, and none before.
 *
 * With the route on, it is how new results come in: the cached copy (keptEspn
 * in src/lib/leagueData.ts, the data as read) is kept for hours
 * (leagueDataKeepSeconds) and expired at once with the pages when the route
 * sees new results. So a page rebuilt on its own reads the same copy as the
 * others and can't run ahead of them, and pages aren't rebuilt for nothing:
 * every rebuild costs (a function, the cache reads of the league's data and
 * outlook, the page written again), so it waits for new results.
 */

export type RefreshReason = "changed" | "unchanged" | "unavailable" | "skipped";

/*
 * Which leagues to check on a run (refreshPlan). A check downloads the
 * league's whole season from ESPN (4–6 MB) to compare it with the cached
 * copy; most leagues, most of the time, have nothing that can change. So a
 * league is checked on every run (every 30 minutes) only while one of its
 * games is near, under way or just over, judging by the cached copy's
 * fixtures; otherwise on its turn, every PERIODIC_RUNS runs (three hours),
 * spread over the runs by its code. Nothing is stored between runs: the turn
 * comes from the clock, the rest from the cached copy the run reads anyway.
 *
 * The longest a change can wait to reach the pages (plus however late
 * GitHub starts the run; a run that doesn't start at all moves a periodic
 * check to the league's next turn, three hours later):
 * - a result, a live game's final score, a kick-off moved within two hours
 *   of the game, a postponement announced then, a correction within six hours
 *   of kick-off, a game still without a result up to two days after kick-off:
 *   one run (30 minutes) after ESPN has it;
 * - anything else (a fixture added or rescheduled, a postponement announced
 *   earlier, a later correction, a points deduction, new groups, the season's
 *   rollover): three hours, six if the league's turn is missed;
 * - a cached copy that's missing, failed or not ESPN's (football-data.org's
 *   when ESPN failed): checked on every run until it is.
 * The pages' own six-hour revalidate and the cached copy's six-hour lifetime
 * (leagueDataKeepSeconds) stay as a safety net beneath all this.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A league is checked on every run from this long before one of its kick-offs… */
export const ACTIVE_BEFORE_MS = 2 * HOUR;
/** …until this long after it (the result, its confirmation, a quick correction). */
export const ACTIVE_AFTER_MS = 6 * HOUR;
/** A game without a result keeps its league checked on every run this long after kick-off (abandoned, suspended, a late result); after that it's taken as postponed. */
export const OVERDUE_MS = 48 * HOUR;
/** The job's runs: every 30 minutes, at :07 and :37 (.github/workflows/revalidate-leagues.yml). */
export const RUN_MS = 30 * MINUTE;
const RUN_OFFSET_MS = 7 * MINUTE;
/** An idle league is checked on one run in this many: every three hours. */
export const PERIODIC_RUNS = 6;

/** Every game in a league's data: the season's, its play-offs', each tournament's. */
export function allGames(data: LeagueData): Fixture[] {
  return [...data.fixtures, ...(data.postseason ?? []), ...(data.tournaments ?? []).flatMap((t) => [...t.fixtures, ...(t.postseason ?? [])])];
}

/** Is one of the league's games near, under way, just over, or over without a result yet? */
export function activeGame(data: LeagueData, now: number): boolean {
  return allGames(data).some((f) => {
    const kickoff = Date.parse(f.utcDate);
    if (Number.isNaN(kickoff)) return false;
    if (kickoff - ACTIVE_BEFORE_MS > now) return false;
    return now <= kickoff + ACTIVE_AFTER_MS || (!f.result && now <= kickoff + OVERDUE_MS);
  });
}

/** The league's turn for a periodic check: one run in PERIODIC_RUNS, the same one for the same code. */
export function periodicTurn(code: string, now: number): boolean {
  let phase = 0;
  for (const ch of code) phase = (phase * 31 + ch.charCodeAt(0)) % PERIODIC_RUNS;
  const run = Math.floor((now - RUN_OFFSET_MS) / RUN_MS);
  return ((run % PERIODIC_RUNS) + PERIODIC_RUNS) % PERIODIC_RUNS === phase;
}

export type CheckWhy = "forced" | "cold" | "untrusted" | "active" | "periodic" | "idle" | "own-data";

/**
 * Should the run check the league against ESPN now, and why: asked for by
 * name or with full=1 ("forced"); no cached copy ("cold"); a copy that isn't
 * ESPN's live data ("untrusted"); a game near, under way or just over
 * ("active"); its periodic turn ("periodic"); else not ("idle"). A
 * first-party league (Série C) has no feed to ask ("own-data").
 */
export function refreshPlan(league: Pick<LeagueConfig, "code" | "firstParty">, cached: LeagueData | undefined, now: number, forced = false): { check: boolean; why: CheckWhy } {
  if (league.firstParty) return { check: false, why: "own-data" };
  if (forced) return { check: true, why: "forced" };
  if (!cached || cached.fixtures.length === 0) return { check: true, why: "cold" };
  if (cached.source !== "live" || cached.provider !== "espn") return { check: true, why: "untrusted" };
  if (activeGame(cached, now)) return { check: true, why: "active" };
  if (periodicTurn(league.code, now)) return { check: true, why: "periodic" };
  return { check: false, why: "idle" };
}

/**
 * What the league's pages show from its data, as one string: the games and
 * groups (dataVersion), and the play-off games, points deductions and the
 * order of clubs level on everything, which dataVersion leaves out.
 */
export function refreshVersion(data: LeagueData): string {
  const games = (fixtures: readonly Fixture[] | undefined) => (fixtures ?? []).map((f) => `${f.id}@${f.utcDate}=${f.result ? `${f.result.home}-${f.result.away}` : ""}`).join(";");
  const postseason = [games(data.postseason), ...(data.tournaments ?? []).map((t) => games(t.postseason))].join("|");
  const deductions = Object.entries(data.deductions ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([id, points]) => `${id}:${points}`).join(",");
  return [dataVersion(data), postseason, deductions, (data.fallbackOrder ?? []).join(",")].join("/");
}

/**
 * Why a league's pages should be refreshed now, or not: ESPN's data differs
 * from the cached copy ("changed"). "unavailable": ESPN couldn't be read,
 * nothing to compare.
 */
export function refreshReason(cached: LeagueData | undefined, fresh: LeagueData | undefined): RefreshReason {
  if (!fresh) return "unavailable";
  return !cached || refreshVersion(cached) !== refreshVersion(fresh) ? "changed" : "unchanged";
}

/** The route's caller: only with the token the site is configured with (`Authorization: Bearer <token>`). */
export function authorized(header: string | null, token: string | undefined): boolean {
  if (!token || !header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
