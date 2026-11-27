/*
 * Which match pages search engines are pointed at (indexable, in the sitemap,
 * linked from club pages), and which load but say `noindex, follow`.
 *
 * A match page is a templated prediction or result. Thousands of them far from
 * today read as scaled, auto-generated content, so only the games around now
 * are indexable: the site is judged on its hubs, club, Chances and odds pages.
 * The cut is made with robots meta and the sitemap, never robots.txt: a search
 * engine has to crawl a page to see its noindex, and `follow` keeps its links
 * counting.
 *
 * One window, used by the match page's metadata, the club pages' fixture links
 * and (a day tighter on the past side: SITEMAP_PAST_DAYS) the sitemap.
 */

const DAY = 86_400_000;

/**
 * Days after kick-off a match page stays indexable. 7: last weekend's results
 * stay findable through the following week, and it matches SETTLED_MATCH_DAYS
 * (src/lib/costChoices.ts), so a game leaves the index as its page becomes a
 * frozen record. Shorter (e.g. 3) would noindex last weekend's games by Friday;
 * the old 30 kept a month of stale results in the index.
 */
export const INDEX_PAST_DAYS = 7;

/**
 * Days before kick-off a match page is indexable. 7: covers a typical matchweek
 * (Monday searches for Saturday). 3 would drop mid-week searches for the
 * weekend; 14 (the old value) leaves a second week of thin previews in the index.
 */
export const INDEX_NEXT_DAYS = 7;

/**
 * Is a game (by its kick-off, not its address's local date) inside the window
 * search engines are pointed at? Inclusive at both ends: exactly
 * INDEX_PAST_DAYS after kick-off, or exactly INDEX_NEXT_DAYS before, is inside.
 */
export const inIndexWindow = (utcDate: string, now = Date.now()) => {
  const time = Date.parse(utcDate);
  return time >= now - INDEX_PAST_DAYS * DAY && time <= now + INDEX_NEXT_DAYS * DAY;
};
