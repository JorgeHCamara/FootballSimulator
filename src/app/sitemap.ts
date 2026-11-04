import type { MetadataRoute } from "next";
import { COMPETITIONS } from "../config/competitions.ts";
import { routing } from "../i18n/routing.ts";
import { HREFLANG, SITE_PAGES, SITE_URL } from "../lib/site.ts";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const paths = ["", ...COMPETITIONS.map((c) => `/${c.slug}`), ...SITE_PAGES.map((p) => `/${p}`)];
  const isSitePage = (path: string) => SITE_PAGES.some((p) => path === `/${p}`);
  return paths.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      lastModified: now,
      // About, Privacy, Contact: rarely change.
      changeFrequency: isSitePage(path) ? ("monthly" as const) : path ? ("daily" as const) : ("weekly" as const),
      priority: isSitePage(path) ? 0.3 : path ? 0.9 : 1,
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [HREFLANG[l] ?? l, `${SITE_URL}/${l}${path}`])),
      },
    })),
  );
}
