import type { LeagueConfig } from "../config/leagues.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { dataVersion } from "./clubOutlook.ts";
import { localDate, matchPath, matchSlug } from "./matchSlug.ts";
import type { LeagueData } from "./leagueData.ts";

/** A league game with a page: both clubs have one. */
export interface MatchRef {
  fixture: Fixture;
  home: Team;
  away: Team;
  /** "arsenal-vs-chelsea-2026-11-08" (the date in the league's own time zone). */
  slug: string;
  /** Without the locale: "/premier-league/match/arsenal-vs-chelsea-2026-11-08". */
  path: string;
}

export { localDate, matchPath, matchSlug };

const DATE_SUFFIX = /^(.+)-(\d{4}-\d{2}-\d{2})$/;

const DAY = 86_400_000;
/**
 * The games search engines are pointed at: kicking off from this many days
 * ago to this many ahead. They're in the sitemap, indexable, and linked from
 * the club and league pages; other games' pages load but ask not to be indexed.
 */
export const INDEX_PAST_DAYS = 30;
export const INDEX_NEXT_DAYS = 14;

/** Is a game (by its kick-off) inside the window search engines are pointed at? */
export const inIndexWindow = (utcDate: string, now = Date.now()) => {
  const time = Date.parse(utcDate);
  return time >= now - INDEX_PAST_DAYS * DAY && time <= now + INDEX_NEXT_DAYS * DAY;
};

/** An old address redirects to the same clubs' game only when that game is at most this many days from the address's date. */
export const MOVED_WITHIN_DAYS = 21;

const indexes = new Map<string, { version: string; matches: MatchRef[]; bySlug: Map<string, MatchRef> }>();

/**
 * Every league game of the season with a page: the table's games (and earlier
 * tournaments' of a split year), not play-off games. Cached per data version.
 */
export function leagueMatches(league: LeagueConfig, data: LeagueData): MatchRef[] {
  return index(league, data).matches;
}

function index(league: LeagueConfig, data: LeagueData) {
  const key = `${league.code}:${data.seasonKey}`;
  const version = dataVersion(data);
  const hit = indexes.get(key);
  if (hit && hit.version === version) return hit;
  const teams = new Map(data.teams.map((t) => [t.id, t]));
  const seen = new Set<number>();
  const matches: MatchRef[] = [];
  for (const fixture of [...data.fixtures, ...(data.tournaments ?? []).flatMap((t) => t.fixtures)]) {
    if (seen.has(fixture.id)) continue;
    seen.add(fixture.id);
    const home = teams.get(fixture.homeId);
    const away = teams.get(fixture.awayId);
    const slug = matchSlug(league, fixture, home, away);
    if (slug) matches.push({ fixture, home: home!, away: away!, slug, path: matchPath(league, slug) });
  }
  matches.sort((a, b) => a.fixture.utcDate.localeCompare(b.fixture.utcDate) || a.fixture.id - b.fixture.id);
  const entry = { version, matches, bySlug: new Map(matches.map((m) => [m.slug, m])) };
  indexes.set(key, entry);
  return entry;
}

/**
 * The game a page address names. A game moved to another day keeps its old
 * address working: the same clubs' game nearest that day, if it's within
 * MOVED_WITHIN_DAYS, is returned as `moved`, for a permanent redirect. Any
 * other date is no game (a 404), not the clubs' other meeting months away.
 */
export function findMatch(league: LeagueConfig, data: LeagueData, slug: string): { match: MatchRef } | { moved: MatchRef } | undefined {
  const { matches, bySlug } = index(league, data);
  const exact = bySlug.get(slug);
  if (exact) return { match: exact };
  const parts = DATE_SUFFIX.exec(slug);
  if (!parts) return undefined;
  const [, pairing, date] = parts;
  const day = Date.parse(`${date}T12:00:00Z`);
  const candidates = matches.filter((m) => m.slug.startsWith(`${pairing}-`) && DATE_SUFFIX.exec(m.slug)?.[1] === pairing);
  if (!candidates.length || !Number.isFinite(day)) return undefined;
  const distance = (m: MatchRef) => Math.abs(Date.parse(m.fixture.utcDate) - day);
  const nearest = candidates.sort((a, b) => distance(a) - distance(b))[0]!;
  // Within the limit by calendar day: the address's date against the game's own (local) one.
  const days = Math.abs(Date.parse(`${DATE_SUFFIX.exec(nearest.slug)![2]}T12:00:00Z`) - day) / DAY;
  return days <= MOVED_WITHIN_DAYS ? { moved: nearest } : undefined;
}

/** The date an address names, at noon UTC ("…-2026-11-08"), or NaN. */
export const slugDate = (slug: string) => {
  const parts = DATE_SUFFIX.exec(slug);
  return parts ? Date.parse(`${parts[2]}T12:00:00Z`) : NaN;
};

/** Games kicking off between two times (the sitemap's: see inIndexWindow). */
export function matchesBetween(league: LeagueConfig, data: LeagueData, from: number, to: number): MatchRef[] {
  return leagueMatches(league, data).filter((m) => {
    const time = Date.parse(m.fixture.utcDate);
    return time >= from && time <= to;
  });
}

