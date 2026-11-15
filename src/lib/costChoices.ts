/*
 * Ways to spend less on Vercel that cost freshness, each a constant here.
 * Choices A and B were turned on by Jorge on 2026-11-15; turning one off again
 * needs nothing else (the tests that pin the clocks read these constants).
 *
 * CHOICE A, LONGER_SAFETY_NET: the safety net under the refresh job, from
 * six hours to 24, when REVALIDATE_TOKEN is set (the job is what brings new
 * results in; without the token nothing changes: the data and its pages
 * refresh hourly as before). What changes when it's on:
 * - the league, club, match and chance pages, the home page and the quiz are
 *   rebuilt on their own every 24 hours at most instead of six (a page is
 *   rebuilt at once when the job expires its league's tags, as before: a
 *   result, a moved game, a correction it sees);
 * - a league's kept ESPN data (keptEspn) and the published snapshots and xG
 *   (readPublished) are kept 24 hours instead of six.
 * Saves the rebuilds of pages whose league didn't change all day, and their
 * ISR writes. Costs: if the GitHub job stops running, pages can be up to 24
 * hours stale instead of six; a publication the job doesn't announce (a run
 * that fails before its last step) shows up to 24 hours later; and what the
 * job doesn't check, the continental competitions' data, refreshes daily
 * (the cups' pages keep their hourly draws). The quiz still turns at midnight
 * UTC, and a game due within a day keeps its match page on six hours.
 * The pages' own `revalidate` exports are 86400 for this: Next only takes a
 * literal there, and a page follows the shortest-lived entry it reads, so with
 * the choice off every one of them reads an entry kept six hours on every
 * render (the outlook marker, or pageClock for a page that shows no outlook or
 * may load no league: src/lib/sharedOutlook.ts) and stays at six, as before.
 *
 * CHOICE B, SLOWER_IDLE_TURN: a league with no game near is checked against
 * ESPN on one run in 12 (every six hours) instead of one in six (three
 * hours). Saves half of the idle leagues' season downloads and their
 * data-cache reads. Costs: what only the periodic check sees (a fixture added
 * or moved outside the active window, a points deduction, a correction later
 * than six hours after kick-off, new groups, the season's rollover) takes up
 * to six hours to show, twelve if a run is missed, instead of three and six.
 * Results, live scores and anything around a game's kick-off are unchanged.
 */

/** Choice A: a 24-hour safety net under the refresh job instead of six hours (see above). On: Jorge's decision of 2026-11-15. */
export const LONGER_SAFETY_NET = true;

/** Choice B: idle leagues checked every six hours instead of three (see above). On: Jorge's decision of 2026-11-15. */
export const SLOWER_IDLE_TURN = true;

/** The safety net under the refresh job, without choice A. */
export const SAFETY_NET_SECONDS = 21600;
/** …and with it. */
export const LONG_SAFETY_NET_SECONDS = 86400;

/**
 * How long a page that the refresh job keeps fresh may go without being
 * rebuilt (seconds), and how long the entries it reads are kept: six hours,
 * or 24 with choice A and the job on (REVALIDATE_TOKEN set).
 */
export function safetyNetSeconds(env: Record<string, string | undefined> = process.env, longer: boolean = LONGER_SAFETY_NET): number {
  return longer && env.REVALIDATE_TOKEN ? LONG_SAFETY_NET_SECONDS : SAFETY_NET_SECONDS;
}

/** An idle league's periodic check: one run in this many (runs are 30 minutes apart). */
export const periodicRuns = (slower: boolean = SLOWER_IDLE_TURN) => (slower ? 12 : 6);

/*
 * DECISION C, settled match pages (Jorge, 2026-11-15): a match page whose game
 * has its final score and kicked off more than SETTLED_MATCH_DAYS days ago is
 * built from a frozen record of that game (src/lib/settledMatch.ts): the
 * result, the pre-match odds, xG and likely scores, and both clubs' table rows
 * as they stood just after it. It no longer follows its league's results, so a
 * new result elsewhere in the league doesn't rebuild it; only a correction of
 * the game itself (its score, date or clubs, which the refresh job watches)
 * does, or its 30-day revalidate. The tradeoff: its two club cards stop
 * showing the clubs' current position, points and form (they say "after this
 * match" and link to the club pages, which keep the live numbers). Shorter
 * keeps more pages following the league (more rebuilds); longer freezes later.
 */
export const SETTLED_MATCH_DAYS = 7;
