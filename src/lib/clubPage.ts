import { getLeagueBySlug, LEAGUES, type LeagueConfig, type SiteLocale } from "../config/leagues.ts";
import type { Team } from "../engine/types.ts";
import { cachedLeagueOutlook, type ClubOutlook, type HeadlineChance, type LeagueOutlook } from "./clubOutlook.ts";
import { hasClubPages } from "./clubs.ts";
import { listOf, percent } from "./clubText.ts";
import { getLeagueData, type LeagueData } from "./leagueData.ts";
import { matchesBetween } from "./matches.ts";

export interface LoadedClub {
  league: LeagueConfig;
  data: LeagueData;
  outlook: LeagueOutlook;
  club: ClubOutlook;
  team: Team;
  /** The season the page covers: "2026/27", or a season of several tournaments by its year ("2026", not "Clausura 2026"). */
  season: string;
}

/**
 * A club's page data: its league, the league's outlook and its own. Undefined
 * for an unknown league or club (a 404).
 */
export async function loadClub(leagueSlug: string, teamSlug: string): Promise<LoadedClub | undefined> {
  const league = getLeagueBySlug(leagueSlug);
  if (!league || !hasClubPages(league)) return undefined;
  const data = await getLeagueData(league);
  const team = data.teams.find((t) => t.slug === teamSlug);
  if (!team) return undefined;
  const outlook = cachedLeagueOutlook(league, data);
  const club = outlook?.clubs.get(team.id);
  if (!outlook || !club) return undefined;
  const season = data.tournaments ? (data.season.split(" ").at(-1) ?? data.season) : data.season;
  return { league, data, outlook, club, team, season };
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A headline chance's name: "title", "Champions League", "relegation"… */
export const topicName = (h: HeadlineChance, t: Translate, tz: Translate) => (h.kind === "continental" ? tz(h.zone) : t(`topic.${h.kind}`));

/** The page heading (and title): "Arsenal 2026/27: title, Champions League and relegation chances". */
export function clubHeading(loaded: LoadedClub, locale: SiteLocale, t: Translate, tz: Translate): string {
  const topics = loaded.club.headline.map((h) => topicName(h, t, tz));
  const values = { club: loaded.team.name, season: loaded.season };
  return topics.length ? t("h1", { ...values, topics: listOf(topics, locale) }) : t("h1Plain", values);
}

/** The meta description: the headline chances, then what's on the page. */
export function clubDescription(loaded: LoadedClub, locale: SiteLocale, t: Translate, tz: Translate): string {
  const stats = loaded.club.headline.map((h) => `${topicName(h, t, tz)} ${percent(h.chance, locale)}`).join(", ");
  const values = { club: loaded.team.name, league: loaded.league.name, season: loaded.season, count: new Intl.NumberFormat(locale).format(loaded.outlook.iterations) };
  return stats ? t("metaDescription", { ...values, stats }) : t("metaDescriptionPlain", values);
}

/** Days of games the sitemap lists: the past 30 and the next 14. */
export const SITEMAP_PAST_DAYS = 30;
export const SITEMAP_NEXT_DAYS = 14;

/**
 * Every club page's path (without the locale), and every match page's for
 * games from SITEMAP_PAST_DAYS ago to SITEMAP_NEXT_DAYS ahead, league by
 * league; a league whose data can't load is left out.
 */
export async function clubAndMatchPaths(now = Date.now()): Promise<{ clubs: string[]; matches: string[] }> {
  const leagues = LEAGUES.filter(hasClubPages);
  const day = 86_400_000;
  const pages = await Promise.all(
    leagues.map((league) =>
      getLeagueData(league).then(
        (data) => ({
          clubs: data.teams.flatMap((team) => (team.page ? [team.page] : [])),
          matches: matchesBetween(league, data, now - SITEMAP_PAST_DAYS * day, now + SITEMAP_NEXT_DAYS * day).map((m) => m.path),
        }),
        (error: unknown) => {
          console.warn(`sitemap: no club or match pages for ${league.code}:`, error);
          return { clubs: [], matches: [] };
        },
      ),
    ),
  );
  return { clubs: pages.flatMap((p) => p.clubs), matches: pages.flatMap((p) => p.matches) };
}

