/*
 * The files each server function reads from disk at run time, for
 * next.config.ts's outputFileTracingIncludes. Next's own tracing can't see
 * them all (some paths are built at run time), so they're listed here, entry
 * by entry: until this file, the crests, the history and the snapshots went
 * into every function (a key such as "/*\/*" matches every route, robots.txt
 * included: keys are matched anywhere in the entry's name). Turbopack's own
 * tracing finds most of them besides; these keep them there if it stops.
 *
 * Who reads what (src/lib/fileTracing.test.ts follows every route's imports
 * to these readers and fails when a route reads a group it isn't given):
 * - history: src/lib/winnersData.ts (Past Winners);
 * - snapshots: src/lib/oddsReports.ts (odds reports, the projected table's
 *   history, chance pages, the sitemap);
 * - xg: src/lib/xgStore.ts and src/lib/impactCache.ts (every league model
 *   with xG in its ratings);
 * - cards: src/lib/shareCard.tsx (the card images' fonts and the site's own
 *   crests, read from public/).
 */

export const TRACED_FILES = {
  history: ["./src/data/history/**/*"],
  snapshots: ["./src/data/snapshots/**/*"],
  xg: ["./src/data/xg/**/*"],
  cards: ["./src/assets/fonts/**/*", "./public/crests/**/*"],
} as const;

export type TracedGroup = keyof typeof TRACED_FILES;

/**
 * Each server entry, as Turbopack names it (its route under src/app, then
 * "/page" for a page or "/route" for a route handler, a card image or the
 * sitemap), and the groups of files it reads. Entries not listed read none.
 */
export const ROUTE_FILES: Record<string, readonly TracedGroup[]> = {
  "/[locale]/page": ["xg"],
  "/[locale]/quiz/page": ["xg"],
  "/[locale]/my-world/page": ["history", "xg"],
  "/[locale]/odds/page": ["snapshots", "xg"],
  "/[locale]/[league]/page": ["history", "snapshots", "xg"],
  "/[locale]/[league]/past-winners/page": ["history"],
  "/[locale]/[league]/chances/[outcome]/page": ["snapshots", "xg"],
  "/[locale]/[league]/odds/page": ["snapshots", "xg"],
  "/[locale]/[league]/odds/opengraph-image/route": ["cards", "snapshots", "xg"],
  "/[locale]/[league]/odds/twitter-image/route": ["cards", "snapshots", "xg"],
  "/[locale]/[league]/odds/[round]/page": ["snapshots", "xg"],
  "/[locale]/[league]/odds/[round]/opengraph-image/route": ["cards", "snapshots", "xg"],
  "/[locale]/[league]/odds/[round]/twitter-image/route": ["cards", "snapshots", "xg"],
  "/[locale]/[league]/odds/[round]/movers-image/route": ["cards", "snapshots", "xg"],
  "/[locale]/[league]/team/[teamSlug]/page": ["snapshots", "xg"],
  "/[locale]/[league]/team/[teamSlug]/chances/[outcome]/page": ["snapshots", "xg"],
  "/[locale]/[league]/team/[teamSlug]/opengraph-image/route": ["cards", "snapshots", "xg"],
  "/[locale]/[league]/team/[teamSlug]/twitter-image/route": ["cards", "snapshots", "xg"],
  "/[locale]/[league]/match/[matchSlug]/page": ["xg"],
  "/[locale]/[league]/match/[matchSlug]/impact/route": ["xg"],
  "/[locale]/[league]/match/[matchSlug]/opengraph-image/route": ["cards", "xg"],
  "/[locale]/[league]/match/[matchSlug]/twitter-image/route": ["cards", "xg"],
  "/[locale]/[league]/share/[code]/page": ["xg"],
  "/[locale]/[league]/share/[code]/opengraph-image/route": ["cards", "xg"],
  "/[locale]/[league]/share/[code]/twitter-image/route": ["cards", "xg"],
  "/api/revalidate/leagues/route": ["xg"],
  "/sitemap.xml/route": ["history", "snapshots", "xg"],
};

/**
 * An entry's key. Turbopack matches a key anywhere in the entry's name, so
 * the full name (brackets escaped), ending in "/page" or "/route", matches
 * that entry alone: "/[locale]/[league]/page" isn't part of any other name.
 */
export const routeGlob = (entry: string) => entry.replace(/[[\]]/g, "\\$&");

/** outputFileTracingIncludes: every listed entry's key with its files. */
export function tracingIncludes(): Record<string, string[]> {
  return Object.fromEntries(Object.entries(ROUTE_FILES).map(([entry, groups]) => [routeGlob(entry), groups.flatMap((g) => [...TRACED_FILES[g]])]));
}

/**
 * outputFileTracingExcludes: the card files (fonts, crests) out of every
 * listed entry that doesn't draw a card. A page imports its own card's module
 * for the card's size and alt text in its metadata, so Turbopack's tracing
 * finds the card's file reads in the page too; the page never draws it.
 */
export function tracingExcludes(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(ROUTE_FILES)
      .filter(([, groups]) => !groups.includes("cards"))
      .map(([entry]) => [routeGlob(entry), [...TRACED_FILES.cards]]),
  );
}
