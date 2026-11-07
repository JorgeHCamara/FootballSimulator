import { COMPETITIONS } from "../config/competitions.ts";
import { getLeagueByCode, type CompetitionCode, type LeagueConfig, type SiteLocale } from "../config/leagues.ts";
import type { Team } from "../engine/types.ts";
import { outcomeChance } from "./chancePages.ts";
import type { LeagueOutlook } from "./clubOutlook.ts";
import { HISTORY, type HistoryFile, type HistoryLeague } from "./history.ts";
import { getLeagueData, type LeagueData } from "./leagueData.ts";
import { sharedLeagueOutlook } from "./sharedOutlook.ts";
import { MY_WORLD_LISTED } from "./site.ts";

/*
 * The home page's hero: its two buttons, its trust line and its live
 * title-chances card. The card shows the featured league's top five from the
 * same data and the same shared outlook its league and club pages read
 * (src/lib/sharedOutlook.ts), so it refreshes with them and never adds a
 * request of its own; before the first game, the simulation's favourites;
 * when nothing loads, last season's final table from the history.
 */

/** The league each language's visitors follow most: the hero simulates it and its card shows it. */
export const FEATURED_LEAGUE: Record<SiteLocale, CompetitionCode> = { en: "PL", pt: "BSA", es: "PD" };

export function featuredLeague(locale: SiteLocale): LeagueConfig {
  const league = getLeagueByCode(FEATURED_LEAGUE[locale]);
  if (!league) throw new Error(`No featured league for ${locale}`);
  return league;
}

/** Rows in the card. */
export const CARD_ROWS = 5;

export interface TitleCardRow {
  team: Team;
  position: number;
  points: number;
  /** Its chance of the title in the shared outlook; none in last season's table. */
  chance?: number;
}

export interface TitleCard {
  league: LeagueConfig;
  /** The season the rows are from: "2026/27" (last season's for "lastSeason"). */
  season: string;
  /**
   * "live": the top five of the table now, with their title chances;
   * "preseason": no game played yet, so the simulation's five favourites;
   * "final": the season is over, its final top five; "lastSeason": no
   * outlook (the data didn't load), so last season's final top five from
   * src/data/history.json, without chances.
   */
  kind: "live" | "preseason" | "final" | "lastSeason";
  rows: TitleCardRow[];
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

/** A club of the history without the live data: its initials make its badge. */
const tlaOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();

/**
 * The card's rows from the league's data and its outlook (see TitleCard.kind):
 * the data and the outlook can each be missing, the card never is while the
 * league has a history. `history` is the checked-in one.
 */
export function titleCard(league: LeagueConfig, data: LeagueData | undefined, outlook: LeagueOutlook | null, history: HistoryFile = HISTORY): TitleCard | undefined {
  if (data && outlook) {
    const clubs = [...outlook.clubs.values()];
    const rowOf = (c: (typeof clubs)[number]): TitleCardRow => {
      const chance = outcomeChance(c, "title")?.chance;
      return { team: c.team, position: c.row.position, points: c.row.points, ...(chance === undefined ? {} : { chance }) };
    };
    const started = data.fixtures.some((f) => f.result);
    if (outlook.complete) return { league, season: data.season, kind: "final", rows: clubs.map(rowOf).sort(byPosition).slice(0, CARD_ROWS) };
    if (!started) {
      // Before the first game the table says nothing: the favourites, likeliest first (a tie: the table's order).
      const favourites = clubs
        .map(rowOf)
        .filter((r) => r.chance !== undefined)
        .sort((a, b) => b.chance! - a.chance! || a.position - b.position)
        .slice(0, CARD_ROWS)
        .map((r, i) => ({ ...r, position: i + 1 }));
      if (favourites.length) return { league, season: data.season, kind: "preseason", rows: favourites };
    } else {
      return { league, season: data.season, kind: "live", rows: clubs.map(rowOf).sort(byPosition).slice(0, CARD_ROWS) };
    }
  }
  const seasons = history.leagues[league.code as HistoryLeague];
  const last = seasons?.reduce((best, s) => (s.year > best.year ? s : best));
  if (!last) return undefined;
  const teams = new Map((data?.teams ?? []).map((t) => [t.id, t]));
  const rows = last.table.slice(0, CARD_ROWS).map(([id, name, points], i): TitleCardRow => ({ team: teams.get(id) ?? { id, name, shortName: name, tla: tlaOf(name) }, position: i + 1, points }));
  return { league, season: last.label, kind: "lastSeason", rows };
}

/**
 * The featured league's card for the page: its data and shared outlook as its
 * league page reads them (a failure of either leaves the history's table).
 */
export async function loadTitleCard(locale: SiteLocale): Promise<TitleCard | undefined> {
  const league = featuredLeague(locale);
  const data = await getLeagueData(league).catch((error: unknown) => {
    console.warn(`${league.code}: no data for the home page card:`, error);
    return undefined;
  });
  const outlook = data
    ? await sharedLeagueOutlook(league, data).catch((error: unknown) => {
        console.warn(`${league.code}: no outlook for the home page card:`, error);
        return null;
      })
    : null;
  return titleCard(league, data, outlook);
}

export interface HeroLink {
  kind: "primary" | "secondary";
  /** Without the locale ("/premier-league"). */
  href: string;
  icon: "chevron-right" | "globe";
  testId: string;
}

/** The hero's buttons: the featured league's simulator, and My World while it is listed (as the menus list it). */
export function heroLinks(league: LeagueConfig, myWorldListed = MY_WORLD_LISTED): HeroLink[] {
  return [
    { kind: "primary", href: `/${league.slug}`, icon: "chevron-right", testId: "hero-simulate" },
    ...(myWorldListed ? [{ kind: "secondary" as const, href: "/my-world", icon: "globe" as const, testId: "hero-my-world" }] : []),
  ];
}

/** Competitions with a simulator page (leagues and cups), for the trust line. */
export const competitionCount = () => COMPETITIONS.length;
