import type { MetadataRoute } from "next";
import { COMPETITIONS } from "../config/competitions.ts";
import { HOME_LEAGUES, LEAGUES } from "../config/leagues.ts";
import { routing } from "../i18n/routing.ts";
import { clubAndMatchPaths } from "../lib/clubPage.ts";
import { reportPaths } from "../lib/oddsPage.ts";
import { HREFLANG, MY_WORLD_LISTED, SITE_PAGES, SITE_URL } from "../lib/site.ts";
import { lastModifiedOf, type SitemapDates } from "../lib/sitemapDates.ts";
import { historySlugs } from "../lib/winnersData.ts";

/**
 * Regenerated daily at least (clubs come and go between seasons, the window of
 * games moves on, the quiz's day changes), and when a league's results or
 * reports change (it reads their data, so it carries their tags).
 */
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = Date.now();
  const [{ clubs, matches, chances, results }, reports] = await Promise.all([clubAndMatchPaths(now), reportPaths()]);
  const reportDates = new Map(reports.rounds.map((r) => [r.path, r.date]));
  // When each address last really changed (src/lib/sitemapDates.ts): none is stamped with the moment the sitemap was built.
  const dates: SitemapDates = {
    leagues: results,
    rounds: reportDates,
    latestReports: new Map(reports.latest.map((r) => [r.path, r.date])),
    home: HOME_LEAGUES.flatMap((code) => LEAGUES.filter((l) => l.code === code).map((l) => l.slug)),
    now,
  };
  const isClub = new Set(clubs);
  const isMatch = new Set(matches);
  // Chance pages: a league's ("/premier-league/chances/title") and a club's ("…/team/arsenal/chances/title").
  const isClubChance = (path: string) => path.includes("/team/");
  const isChance = new Set(chances);
  // Past winners: a page per league with a history file (src/data/history); it changes once a season.
  const pastWinners = historySlugs().map((slug) => `/${slug}/past-winners`);
  const paths = ["", ...COMPETITIONS.map((c) => `/${c.slug}`), ...SITE_PAGES.map((p) => `/${p}`), ...pastWinners, ...clubs, ...chances, ...matches, "/odds", "/quiz", ...(MY_WORLD_LISTED ? ["/my-world"] : []), ...reports.latest.map((r) => r.path), ...reports.rounds.map((r) => r.path)];
  const isSitePage = (path: string) => SITE_PAGES.some((p) => path === `/${p}`);
  const isPastWinners = (path: string) => pastWinners.includes(path);
  return paths.flatMap((path) => {
    const lastModified = lastModifiedOf(path, dates);
    return routing.locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      // Only when it's known (a league's latest result, a report's round): no date says more than a made-up one.
      ...(lastModified ? { lastModified } : {}),
      // About, Privacy, Contact: rarely change.
      changeFrequency: isSitePage(path) || isPastWinners(path) ? ("monthly" as const) : path ? ("daily" as const) : ("weekly" as const),
      priority: isSitePage(path) ? 0.3 : isPastWinners(path) ? 0.6 : isChance.has(path) ? (isClubChance(path) ? 0.6 : 0.8) : path === "/quiz" || path === "/my-world" ? 0.8 : reportDates.has(path) ? 0.5 : isMatch.has(path) ? 0.6 : isClub.has(path) ? 0.7 : path ? 0.9 : 1,
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [HREFLANG[l] ?? l, `${SITE_URL}/${l}${path}`])),
      },
    }));
  });
}
