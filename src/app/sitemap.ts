import type { MetadataRoute } from "next";
import { LEAGUES } from "../config/leagues.ts";
import { routing } from "../i18n/routing.ts";
import { HREFLANG, SITE_URL } from "../lib/site.ts";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const paths = ["", ...LEAGUES.map((l) => `/${l.slug}`)];
  return paths.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      lastModified: now,
      changeFrequency: path ? ("daily" as const) : ("weekly" as const),
      priority: path ? 0.9 : 1,
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [HREFLANG[l] ?? l, `${SITE_URL}/${l}${path}`])),
      },
    })),
  );
}
