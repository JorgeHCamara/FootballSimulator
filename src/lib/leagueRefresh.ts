import { timingSafeEqual } from "node:crypto";
import { dataVersion } from "./clubOutlook.ts";
import type { LeagueData } from "./leagueData.ts";

/*
 * When to refresh a league's pages together (src/app/api/revalidate/leagues):
 * the league page and every club page are rebuilt on their own, so after new
 * results some would show the new table and others the old one until each is
 * rebuilt. The route compares ESPN's data now with the cached copy the pages
 * are built from and, when they differ, revalidates the league's tags, so
 * every page is rebuilt from the new data on its next visit.
 */

/** A game that kicked off this recently may have just finished: its league's pages are refreshed while its result comes in. */
export const RECENT_KICKOFF_MS = 4 * 3_600_000;

export type RefreshReason = "changed" | "recent" | "unchanged" | "unavailable";

/**
 * Why a league's pages should be refreshed now, or not: ESPN's data differs
 * from the cached copy ("changed"), or a game kicked off in the last four
 * hours ("recent": a page rebuilt on its own may already have taken a new
 * result that the cached copy the route sees has too, while the others still
 * show the old one). "unavailable": ESPN couldn't be read, nothing to compare.
 */
export function refreshReason(cached: LeagueData | undefined, fresh: LeagueData | undefined, now = Date.now()): RefreshReason {
  if (!fresh) return "unavailable";
  if (!cached || dataVersion(cached) !== dataVersion(fresh)) return "changed";
  const games = [...fresh.fixtures, ...(fresh.postseason ?? []), ...(fresh.tournaments ?? []).flatMap((t) => [...t.fixtures, ...(t.postseason ?? [])])];
  const recent = games.some((f) => {
    const kickoff = Date.parse(f.utcDate);
    return kickoff <= now && kickoff > now - RECENT_KICKOFF_MS;
  });
  return recent ? "recent" : "unchanged";
}

/** The route's caller: only with the token the site is configured with (`Authorization: Bearer <token>`). */
export function authorized(header: string | null, token: string | undefined): boolean {
  if (!token || !header) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
