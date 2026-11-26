import type { MetadataRoute } from "next";
import { sitemapEntries } from "../../lib/sitemapEntries.ts";
import { sitemapIds } from "../../lib/sitemapIds.ts";

/*
 * The sitemap's pieces, /sitemaps/sitemap/<id>.xml: "site" and one per league
 * with club pages (src/lib/sitemapEntries.ts). /sitemap.xml is their index
 * (src/app/sitemap.xml/route.ts).
 */

/**
 * Each piece is regenerated daily at least (clubs come and go between seasons,
 * the window of games moves on, the quiz's day changes), and when its league's
 * results or reports change (it reads their data, so it carries their tags).
 */
export const revalidate = 86400;

export async function generateSitemaps() {
  return sitemapIds().map((id) => ({ id }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  // Only the ids above reach here (Next answers 404 to any other).
  return (await sitemapEntries(await id)) ?? [];
}
