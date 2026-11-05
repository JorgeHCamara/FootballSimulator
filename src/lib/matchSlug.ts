import type { LeagueConfig } from "../config/leagues.ts";
import { leagueTimeZone } from "../config/timezones.ts";
import type { Fixture, Team } from "../engine/types.ts";

// A game's page address, on its own so the league page's fixture list (in the
// browser) can build it without the server-side match code.

/** A day as "2026-11-08" in a time zone. */
export const localDate = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** A game's page address ("arsenal-vs-chelsea-2026-11-08", the date in the league's time zone), or undefined when a club has no page (a play-off slot). */
export function matchSlug(league: Pick<LeagueConfig, "code">, fixture: Fixture, home: Team | undefined, away: Team | undefined): string | undefined {
  if (!home?.slug || !away?.slug) return undefined;
  return `${home.slug}-vs-${away.slug}-${localDate(fixture.utcDate, leagueTimeZone(league.code))}`;
}

/** Without the locale: "/premier-league/match/arsenal-vs-chelsea-2026-11-08". */
export const matchPath = (league: Pick<LeagueConfig, "slug">, slug: string) => `/${league.slug}/match/${slug}`;
