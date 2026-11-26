import type { MetadataRoute } from "next";
import { COMPETITIONS } from "../config/competitions.ts";
import { HOME_LEAGUES, LEAGUES, type LeagueConfig } from "../config/leagues.ts";
import { routing } from "../i18n/routing.ts";
import { clubAndMatchPaths, latestResults } from "./clubPage.ts";
import { INDEX_PAST_DAYS } from "./matches.ts";
import { reportPaths } from "./oddsPage.ts";
import { HREFLANG, MY_WORLD_LISTED, SITE_PAGES, SITE_URL } from "./site.ts";
import { lastModifiedOf, type SitemapDates } from "./sitemapDates.ts";
import { leaguesWithPieces, SITE_SITEMAP, sitemapIds } from "./sitemapIds.ts";
import { historySlugs } from "./winnersData.ts";

/*
 * The sitemap, in pieces (src/lib/sitemapIds.ts; src/app/sitemap.xml/route.ts is their index,
 * src/app/sitemaps/sitemap.ts serves each one):
 * - "site": the home page, every competition's page, the site's own pages,
 *   Past Winners, the odds hub, the quiz and My World;
 * - one per league with club pages, by its slug: its club, chance and match
 *   pages and its odds reports.
 *
 * Once in one piece it came to 6.5 MB: built with each deployment, but by
 * every sign never again at run time, where a function's response can't pass
 * 4.5 MB on Vercel. Snapshots no longer deploy (#112), so its window of games
 * stayed where the last deployment left it. Each piece is a few hundred KB, regenerated on its
 * own (daily, and when its league's tags expire), and reads only its league.
 */

/**
 * How long a piece may be served after it was made (its revalidate, a day),
 * in days: games leave it this much before they leave the index window
 * (INDEX_PAST_DAYS), so a piece a day old lists no game whose page has
 * turned noindex.
 */
export const SITEMAP_MAX_AGE_DAYS = 1;

/** The games a piece lists: kicked off this many days ago at most (to INDEX_NEXT_DAYS ahead). */
export const SITEMAP_PAST_DAYS = INDEX_PAST_DAYS - SITEMAP_MAX_AGE_DAYS;

/** One piece's entries, or undefined for an id that names none. */
export async function sitemapEntries(id: string, now = Date.now()): Promise<MetadataRoute.Sitemap | undefined> {
  if (id === SITE_SITEMAP) return siteEntries(now);
  const league = leaguesWithPieces().find((l) => l.slug === id);
  return league ? leagueEntries(league, now) : undefined;
}

/** Every piece's entries, in the index's order (tests and checks). */
export async function allSitemapEntries(now = Date.now()): Promise<MetadataRoute.Sitemap> {
  const pieces = await Promise.all(sitemapIds().map((id) => sitemapEntries(id, now)));
  return pieces.flatMap((p) => p ?? []);
}

async function siteEntries(now: number): Promise<MetadataRoute.Sitemap> {
  const [results, reports] = await Promise.all([latestResults(now), reportPaths()]);
  const dates: SitemapDates = {
    leagues: results,
    rounds: new Map(),
    latestReports: new Map(reports.latest.map((r) => [r.path, r.date])),
    home: HOME_LEAGUES.flatMap((code) => LEAGUES.filter((l) => l.code === code).map((l) => l.slug)),
    now,
  };
  // Past winners: a page per league with a history file (src/data/history); it changes once a season.
  const pastWinners = new Set(historySlugs().map((slug) => `/${slug}/past-winners`));
  const sitePages = new Set(SITE_PAGES.map((p) => `/${p}`));
  const paths = ["", ...COMPETITIONS.map((c) => `/${c.slug}`), ...sitePages, ...pastWinners, "/odds", "/quiz", ...(MY_WORLD_LISTED ? ["/my-world"] : [])];
  return paths.flatMap((path) =>
    entries(path, dates, {
      // About, Privacy, Contact: rarely change.
      changeFrequency: sitePages.has(path) || pastWinners.has(path) ? "monthly" : path ? "daily" : "weekly",
      priority: sitePages.has(path) ? 0.3 : pastWinners.has(path) ? 0.6 : path === "/quiz" || path === "/my-world" ? 0.8 : path ? 0.9 : 1,
    }),
  );
}

async function leagueEntries(league: LeagueConfig, now: number): Promise<MetadataRoute.Sitemap> {
  const [{ clubs, matches, chances, results, settled }, reports] = await Promise.all([
    clubAndMatchPaths(now, { leagues: [league], pastDays: SITEMAP_PAST_DAYS }),
    reportPaths([league]),
  ]);
  // When each address last really changed (src/lib/sitemapDates.ts): none is stamped with the moment the sitemap was built.
  const dates: SitemapDates = {
    leagues: results,
    rounds: new Map(reports.rounds.map((r) => [r.path, r.date])),
    latestReports: new Map(reports.latest.map((r) => [r.path, r.date])),
    home: [],
    settled,
    now,
  };
  return [
    ...clubs.flatMap((path) => entries(path, dates, { changeFrequency: "daily", priority: 0.7 })),
    // Chance pages: a league's ("/premier-league/chances/title") and a club's ("…/team/arsenal/chances/title").
    ...chances.flatMap((path) => entries(path, dates, { changeFrequency: "daily", priority: path.includes("/team/") ? 0.6 : 0.8 })),
    ...matches.flatMap((path) => entries(path, dates, { changeFrequency: "daily", priority: 0.6 })),
    ...reports.latest.map((r) => r.path).flatMap((path) => entries(path, dates, { changeFrequency: "daily", priority: 0.9 })),
    ...reports.rounds.map((r) => r.path).flatMap((path) => entries(path, dates, { changeFrequency: "daily", priority: 0.5 })),
  ];
}

/** A page's entry in every language, with its alternates and, when it's known, when it last changed. */
function entries(path: string, dates: SitemapDates, { changeFrequency, priority }: { changeFrequency: "daily" | "weekly" | "monthly"; priority: number }): MetadataRoute.Sitemap {
  const lastModified = lastModifiedOf(path, dates);
  return routing.locales.map((locale) => ({
    url: `${SITE_URL}/${locale}${path}`,
    // Only when it's known (a league's latest result, a report's round): no date says more than a made-up one.
    ...(lastModified ? { lastModified } : {}),
    changeFrequency,
    priority,
    alternates: {
      languages: Object.fromEntries(routing.locales.map((l) => [HREFLANG[l] ?? l, `${SITE_URL}/${l}${path}`])),
    },
  }));
}
