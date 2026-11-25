import { LEAGUES } from "../config/leagues.ts";
import { hasClubPages } from "./clubs.ts";
import { SITE_URL } from "./site.ts";

/*
 * The sitemap's pieces (src/lib/sitemapEntries.ts), by id: what the index
 * (src/app/sitemap.xml/route.ts) lists. Kept apart so the index reads no
 * league data and carries none of the files the pieces read.
 */

/** The piece with every page that isn't one league's own. */
export const SITE_SITEMAP = "site";

/** The leagues with a piece of their own: those with club pages. */
export const leaguesWithPieces = () => LEAGUES.filter(hasClubPages);

/** Every piece's id, the site's first. */
export function sitemapIds(): string[] {
  return [SITE_SITEMAP, ...leaguesWithPieces().map((l) => l.slug)];
}

/** A piece's address. */
export const sitemapUrl = (id: string) => `${SITE_URL}/sitemaps/sitemap/${id}.xml`;
