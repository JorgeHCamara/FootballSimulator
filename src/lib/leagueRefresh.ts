import { timingSafeEqual } from "node:crypto";
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

export type RefreshReason = "changed" | "unchanged" | "unavailable";

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
