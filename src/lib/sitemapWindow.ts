import { INDEX_NEXT_DAYS, INDEX_PAST_DAYS } from "./matches.ts";

const DAY = 86_400_000;

/**
 * Whether a match page's address ("…/match/arsenal-vs-chelsea-2026-11-28")
 * is outside the index window (INDEX_PAST_DAYS ago to INDEX_NEXT_DAYS ahead)
 * at `now`: the sitemap must never list one. The address has the game's day
 * in its league's time zone, so a day either side of the window in UTC is
 * allowed. Not a match address: false.
 */
export function matchOutsideWindow(url: string, now = Date.now()): boolean {
  const day = /\/match\/[a-z0-9-]+-(\d{4}-\d{2}-\d{2})$/.exec(url)?.[1];
  if (!day) return false;
  const at = Date.parse(`${day}T12:00:00Z`);
  return !(at >= now - (INDEX_PAST_DAYS + 1) * DAY && at <= now + (INDEX_NEXT_DAYS + 1) * DAY);
}
