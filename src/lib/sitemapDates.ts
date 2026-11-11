import type { Fixture } from "../engine/types.ts";

/*
 * When a sitemap address last changed (src/app/sitemap.ts). Until this file
 * every address but the past rounds' reports said "now", every time the
 * sitemap was built: a date that says nothing, which crawlers learn to
 * ignore, or follow, fetching every page again for nothing. Now each says
 * when what it shows last really changed, or nothing when that isn't known:
 * - a league's club, match and chance pages: the league's latest result
 *   (every club's chances move with any result of the league);
 * - a report: its round's day; the latest report and the hub: the latest round's;
 * - the quiz: today's set (it changes with the UTC day);
 * - the home page: the latest result among the leagues it features;
 * - the rest (a competition's own simulator page without live results read
 *   here, Past Winners, My World, the legal pages): no date.
 */

/** A game's result is in by this long after kick-off (as the snapshots count it). */
const GAME_LENGTH_MS = 3 * 3_600_000;

/**
 * When a league's results last changed: the end of its latest played game
 * (kick-off plus a game's length, never later than `now`), or undefined
 * before the season's first result. The same moment however often it's
 * asked, until another game is played.
 */
export function lastResultAt(games: readonly Pick<Fixture, "utcDate" | "result">[], now = Date.now()): Date | undefined {
  let latest = -Infinity;
  for (const g of games) {
    if (!g.result) continue;
    const kickoff = Date.parse(g.utcDate);
    if (Number.isFinite(kickoff) && kickoff <= now && kickoff > latest) latest = kickoff;
  }
  return Number.isFinite(latest) ? new Date(Math.min(latest + GAME_LENGTH_MS, now)) : undefined;
}

/** A round's day as a sitemap date: noon UTC of "2026-11-02". */
export const roundDay = (date: string) => new Date(`${date}T12:00:00Z`);

/** The latest of some dates, or undefined for none. */
export function latestOf(dates: readonly (Date | undefined)[]): Date | undefined {
  let latest: Date | undefined;
  for (const d of dates) if (d && (!latest || d > latest)) latest = d;
  return latest;
}

/** The start of the UTC day: when the quiz's set last changed. */
export const utcDayStart = (now = Date.now()) => new Date(Math.floor(now / 86_400_000) * 86_400_000);

export interface SitemapDates {
  /** Each league's latest result, by its slug ("premier-league"). */
  leagues: ReadonlyMap<string, Date | undefined>;
  /** Each past round's report, by path, with its round's day ("2026-11-02"). */
  rounds: ReadonlyMap<string, string>;
  /** Each league's latest report page, by path, with its latest round's day. */
  latestReports: ReadonlyMap<string, string>;
  /** The slugs of the leagues the home page features. */
  home: readonly string[];
  now: number;
}

/** When the page at `path` (without the locale; "" is the home page) last changed, or undefined to say nothing. */
export function lastModifiedOf(path: string, dates: SitemapDates): Date | undefined {
  if (path === "") return latestOf(dates.home.map((slug) => dates.leagues.get(slug)));
  if (path === "/quiz") return utcDayStart(dates.now);
  if (path === "/odds") return latestOf([...dates.latestReports.values()].map(roundDay));
  const round = dates.rounds.get(path) ?? dates.latestReports.get(path);
  if (round) return roundDay(round);
  // "/premier-league", "/premier-league/team/arsenal", "/premier-league/match/…", "/premier-league/chances/title".
  const [, slug, section] = path.split("/");
  if (!slug || !dates.leagues.has(slug)) return undefined;
  // Past Winners changes once a season, not with a result.
  if (section === "past-winners") return undefined;
  return dates.leagues.get(slug);
}
