/**
 * How long a share card may be kept by the CDN and by browsers. Every card is
 * drawn by a function (fonts, crests, the league's data), so a card that's
 * kept is one that isn't drawn again for every crawler and link preview.
 * Vercel's CDN starts afresh with each deployment, so "final" lasts at most
 * until the next one.
 * - final: a card that can't change (a played game, a past round's report,
 *   a scenario in a link, the site's and leagues' own cards).
 * - live: a card of numbers that move with new results (a club's chances, an
 *   upcoming game's odds, the latest report): an hour, as their pages.
 * - brief: a stand-in (the clubs' initials for a crest that didn't load, the
 *   branded card when the data didn't): soon drawn again, properly.
 */
export type CardCache = "final" | "live" | "brief";

/** Every crest a card asked for was drawn (a club without one has nothing to miss): `[url, drawn]` pairs. */
export const crestsDrawn = (crests: readonly (readonly [url: string | undefined, drawn: string | undefined])[]) => crests.every(([url, drawn]) => !url || drawn !== undefined);

export const CARD_CACHE_HEADERS: Record<CardCache, { "Cache-Control": string }> = {
  final: { "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=86400" },
  live: { "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" },
  brief: { "Cache-Control": "public, max-age=300, s-maxage=300" },
};
