import type { MetadataRoute } from "next";
import { LEAGUES } from "../config/leagues.ts";
import { routing } from "../i18n/routing.ts";
import { SITE_URL } from "../lib/site.ts";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["", ...LEAGUES.map((l) => `/${l.slug}`)];
  return paths.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      changeFrequency: path ? ("daily" as const) : ("weekly" as const),
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [l, `${SITE_URL}/${l}${path}`])),
      },
    })),
  );
}
