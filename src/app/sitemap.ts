import type { MetadataRoute } from "next";
import { COMPETITIONS } from "../config/competitions.ts";
import { routing } from "../i18n/routing.ts";
import { clubPaths } from "../lib/clubPage.ts";
import { HREFLANG, SITE_PAGES, SITE_URL } from "../lib/site.ts";

/** Regenerated daily: clubs come and go between seasons (promotion, relegation). */
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const clubs = await clubPaths();
  const isClub = new Set(clubs);
  const paths = ["", ...COMPETITIONS.map((c) => `/${c.slug}`), ...SITE_PAGES.map((p) => `/${p}`), ...clubs];
  const isSitePage = (path: string) => SITE_PAGES.some((p) => path === `/${p}`);
  return paths.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      lastModified: now,
      // About, Privacy, Contact: rarely change.
      changeFrequency: isSitePage(path) ? ("monthly" as const) : path ? ("daily" as const) : ("weekly" as const),
      priority: isSitePage(path) ? 0.3 : isClub.has(path) ? 0.7 : path ? 0.9 : 1,
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [HREFLANG[l] ?? l, `${SITE_URL}/${l}${path}`])),
      },
    })),
  );
}
