import { getLeagueBySlug, LEAGUES, type LeagueConfig, type SiteLocale, type ZoneKind } from "../config/leagues.ts";
import type { Team } from "../engine/types.ts";
import { clubChancePath, leagueChancePath, snapshotOpen, snapshotOutcomes } from "./chancePages.ts";
import { featuredChances, type ClubOutlook, type HeadlineChance, type LeagueOutlook } from "./clubOutlook.ts";
import { hasClubPages } from "./clubs.ts";
import { listOf, ordinal, percent } from "./clubText.ts";
import { getLeagueData, type LeagueData } from "./leagueData.ts";
import { INDEX_NEXT_DAYS, INDEX_PAST_DAYS, matchesBetween } from "./matches.ts";
import { readSnapshots, seasonReports } from "./oddsReports.ts";
import { sharedLeagueOutlook } from "./sharedOutlook.ts";
import { allGames } from "./leagueRefresh.ts";
import { lastResultAt } from "./sitemapDates.ts";

/** A domestic league's outlook: the shared one, as its league, club and chance pages read it. */
export interface LoadedLeague {
  league: LeagueConfig;
  data: LeagueData;
  outlook: LeagueOutlook;
  /** The season the pages cover: "2026/27", or a season of several tournaments by its year ("2026", not "Clausura 2026"). */
  season: string;
}

export interface LoadedClub extends LoadedLeague {
  club: ClubOutlook;
  team: Team;
}

/** A league with club pages and its shared outlook, or undefined (an unknown league, or none worked out: a 404). */
export async function loadLeague(leagueSlug: string): Promise<LoadedLeague | undefined> {
  const league = getLeagueBySlug(leagueSlug);
  if (!league || !hasClubPages(league)) return undefined;
  const data = await getLeagueData(league);
  const outlook = await sharedLeagueOutlook(league, data);
  if (!outlook) return undefined;
  const season = data.tournaments ? (data.season.split(" ").at(-1) ?? data.season) : data.season;
  return { league, data, outlook, season };
}

/**
 * A club's page data: its league, the league's outlook (the shared one: every
 * club page of the league, and the league page, read the same simulated
 * seasons) and its own. Undefined for an unknown league or club (a 404).
 */
export async function loadClub(leagueSlug: string, teamSlug: string): Promise<LoadedClub | undefined> {
  const league = getLeagueBySlug(leagueSlug);
  if (!league || !hasClubPages(league)) return undefined;
  const data = await getLeagueData(league);
  const team = data.teams.find((t) => t.slug === teamSlug);
  if (!team) return undefined;
  const loaded = await loadLeague(leagueSlug);
  const club = loaded?.outlook.clubs.get(team.id);
  if (!loaded || !club) return undefined;
  return { ...loaded, club, team };
}

/** Where a club stands: "Arsenal are 3rd in the Premier League table with 24 points from 9 games." (or before its first game, or once the season is over). */
export function clubStanding(loaded: LoadedClub, locale: SiteLocale, t: Translate): string {
  const { outlook, club, team, league } = loaded;
  const { row } = club;
  const table =
    outlook.scope === "eachTable" && club.group
      ? t("tableGroup", { group: club.group[locale] })
      : outlook.scope === "annual"
        ? t("tableAnnual", { league: league.name })
        : t("tableLeague", { league: league.name });
  const position = ordinal(row.position, locale);
  if (row.played === 0) return t("summaryStart", { club: team.name });
  if (outlook.complete) return t("summaryFinal", { club: team.name, position, table, points: row.points });
  return t("summaryPosition", { club: team.name, position, table, points: row.points, played: row.played });
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A headline chance's name: "title", "Champions League", "relegation"… */
export const topicName = (h: HeadlineChance, t: Translate, tz: Translate) =>
  h.kind === "continental" ? tz(h.zone) : h.kind === "playoffWin" ? (h.name ?? t("topic.playoffs")) : t(`topic.${h.kind}`);

/** The page heading (and title): "Arsenal 2026/27: title, Champions League and relegation chances". */
export function clubHeading(loaded: LoadedClub, locale: SiteLocale, t: Translate, tz: Translate): string {
  const topics = loaded.club.headline.map((h) => topicName(h, t, tz));
  const values = { club: loaded.team.name, season: loaded.season };
  return topics.length ? t("h1", { ...values, topics: listOf(topics, locale) }) : t("h1Plain", values);
}

/** The line under the club's name: "2026/27 · Title, Champions League and relegation chances". */
export function clubSubtitle(loaded: LoadedClub, locale: SiteLocale, t: Translate, tz: Translate): string {
  const topics = loaded.club.headline.map((h) => topicName(h, t, tz));
  if (!topics.length) return t("subtitlePlain", { season: loaded.season });
  const list = listOf(topics, locale);
  // English starts with the topics ("Title, …"); Portuguese and Spanish with "Chances de" / "Probabilidades de".
  return t("subtitle", { season: loaded.season, topics: locale === "en" ? list.charAt(0).toUpperCase() + list.slice(1) : list });
}

/** The chances a club's card and link preview show (see featuredChances), named as the card names them. */
export function clubCardChances(loaded: Pick<LoadedClub, "club">, locale: SiteLocale, t: Translate, tz: Translate): { label: string; value: string; chance: number; zone: ZoneKind }[] {
  return featuredChances(loaded.club).map((c) => ({
    label: c.kind === "continental" || c.kind === "zone" ? tz(c.zone) : c.kind === "playoffWin" ? (c.name ?? t("card.chance.playoffs")) : t(`card.chance.${c.kind}`),
    value: percent(c.chance, locale),
    chance: c.chance,
    zone: c.zone,
  }));
}

/** The meta description: the card's chances, then what's on the page. */
export function clubDescription(loaded: LoadedClub, locale: SiteLocale, t: Translate, tz: Translate): string {
  const stats = clubCardChances(loaded, locale, t, tz)
    .map((c) => `${c.label} ${c.value}`)
    .join(", ");
  const values = { club: loaded.team.name, league: loaded.league.name, season: loaded.season, count: new Intl.NumberFormat(locale).format(loaded.outlook.iterations) };
  return stats ? t("metaDescription", { ...values, stats }) : t("metaDescriptionPlain", values);
}

/**
 * The chance pages search engines are given (src/lib/chancePages.ts), from
 * the league's latest snapshot (none worked out here): its league pages while
 * the season is on, and each club's while the outcome is still open for it.
 * Before the season's first snapshot, every club's (from the last season's
 * outcomes).
 */
async function chancePaths(league: LeagueConfig, data: LeagueData): Promise<string[]> {
  if (data.fixtures.every((f) => f.result)) return [];
  const season = seasonReports(await readSnapshots(league.code), data.seasonKey);
  const latest = season?.snapshots.at(-1);
  if (!latest) return [];
  const current = season!.seasonKey === data.seasonKey;
  const outcomes = snapshotOutcomes(league, latest);
  return [
    ...outcomes.map((o) => leagueChancePath(league, o)),
    ...data.teams.flatMap((team) => {
      if (!team.page) return [];
      const chances = current ? latest.teams[String(team.id)]?.chances : undefined;
      return outcomes.filter((o) => !chances || snapshotOpen(o, chances)).map((o) => clubChancePath(team.page!, o));
    }),
  ];
}

/**
 * Every club page's path (without the locale), every match page's for games
 * inside the index window (INDEX_PAST_DAYS ago to INDEX_NEXT_DAYS ahead), and
 * the chance pages (chancePaths), league by league; a league whose data
 * can't load is left out. `results`: when each league's results last changed,
 * by its slug (lastResultAt; undefined before its first result), for the
 * sitemap's dates.
 */
export async function clubAndMatchPaths(now = Date.now()): Promise<{ clubs: string[]; matches: string[]; chances: string[]; results: Map<string, Date | undefined> }> {
  const leagues = LEAGUES.filter(hasClubPages);
  const day = 86_400_000;
  const pages = await Promise.all(
    leagues.map((league) =>
      getLeagueData(league).then(
        async (data) => ({
          clubs: data.teams.flatMap((team) => (team.page ? [team.page] : [])),
          matches: matchesBetween(league, data, now - INDEX_PAST_DAYS * day, now + INDEX_NEXT_DAYS * day).map((m) => m.path),
          chances: await chancePaths(league, data).catch(() => []),
          result: [league.slug, lastResultAt(allGames(data), now)] as const,
        }),
        (error: unknown) => {
          console.warn(`sitemap: no club or match pages for ${league.code}:`, error);
          return { clubs: [], matches: [], chances: [], result: undefined };
        },
      ),
    ),
  );
  return {
    clubs: pages.flatMap((p) => p.clubs),
    matches: pages.flatMap((p) => p.matches),
    chances: pages.flatMap((p) => p.chances),
    results: new Map(pages.flatMap((p) => (p.result ? [p.result] : []))),
  };
}
