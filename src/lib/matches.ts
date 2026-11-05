import { leagueTimeZone } from "../config/timezones.ts";
import type { LeagueConfig } from "../config/leagues.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { dataVersion } from "./clubOutlook.ts";
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

/** A day as "2026-11-08" in a time zone. */
export const localDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** A game's page address, or undefined when a club has no page (a play-off slot). */
export function matchSlug(league: Pick<LeagueConfig, "code">, fixture: Fixture, home: Team | undefined, away: Team | undefined): string | undefined {
  if (!home?.slug || !away?.slug) return undefined;
  return `${home.slug}-vs-${away.slug}-${localDate(fixture.utcDate, leagueTimeZone(league.code))}`;
}

export const matchPath = (league: Pick<LeagueConfig, "slug">, slug: string) => `/${league.slug}/match/${slug}`;

const DATE_SUFFIX = /^(.+)-(\d{4}-\d{2}-\d{2})$/;

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
 * address working: the same clubs' game nearest that day is returned as
 * `moved`, for a permanent redirect.
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
  const nearest = candidates.sort((a, b) => Math.abs(Date.parse(a.fixture.utcDate) - day) - Math.abs(Date.parse(b.fixture.utcDate) - day))[0]!;
  return { moved: nearest };
}

/** The date an address names, at noon UTC ("…-2026-11-08"), or NaN. */
export const slugDate = (slug: string) => {
  const parts = DATE_SUFFIX.exec(slug);
  return parts ? Date.parse(`${parts[2]}T12:00:00Z`) : NaN;
};

/** Games kicking off between two times (the sitemap's window: the past 30 days and the next 14). */
export function matchesBetween(league: LeagueConfig, data: LeagueData, from: number, to: number): MatchRef[] {
  return leagueMatches(league, data).filter((m) => {
    const time = Date.parse(m.fixture.utcDate);
    return time >= from && time <= to;
  });
}
