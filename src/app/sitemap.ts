import type { MetadataRoute } from "next";
import { COMPETITIONS } from "../config/competitions.ts";
import { routing } from "../i18n/routing.ts";
import { clubAndMatchPaths } from "../lib/clubPage.ts";
import { reportPaths } from "../lib/oddsPage.ts";
import { HREFLANG, SITE_PAGES, SITE_URL } from "../lib/site.ts";

/** Regenerated daily: clubs come and go between seasons, and the window of games moves on. */
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [{ clubs, matches, chances }, reports] = await Promise.all([clubAndMatchPaths(now.getTime()), reportPaths()]);
  const reportDates = new Map(reports.rounds.map((r) => [r.path, r.date]));
  const isClub = new Set(clubs);
  const isMatch = new Set(matches);
  // Chance pages: a league's ("/premier-league/chances/title") and a club's ("…/team/arsenal/chances/title").
  const isClubChance = (path: string) => path.includes("/team/");
  const isChance = new Set(chances);
  const paths = ["", ...COMPETITIONS.map((c) => `/${c.slug}`), ...SITE_PAGES.map((p) => `/${p}`), ...clubs, ...chances, ...matches, "/odds", "/quiz", "/my-world", ...reports.latest, ...reports.rounds.map((r) => r.path)];
  const isSitePage = (path: string) => SITE_PAGES.some((p) => path === `/${p}`);
  return paths.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      // A report is as of its round (it doesn't change after).
      lastModified: reportDates.has(path) ? new Date(`${reportDates.get(path)}T12:00:00Z`) : now,
      // About, Privacy, Contact: rarely change.
      changeFrequency: isSitePage(path) ? ("monthly" as const) : path ? ("daily" as const) : ("weekly" as const),
      priority: isSitePage(path) ? 0.3 : isChance.has(path) ? (isClubChance(path) ? 0.6 : 0.8) : path === "/quiz" || path === "/my-world" ? 0.8 : reportDates.has(path) ? 0.5 : isMatch.has(path) ? 0.6 : isClub.has(path) ? 0.7 : path ? 0.9 : 1,
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [HREFLANG[l] ?? l, `${SITE_URL}/${l}${path}`])),
      },
    })),
  );
}
