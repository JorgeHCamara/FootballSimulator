import { LEAGUES, type LeagueConfig } from "../config/leagues.ts";
import { archiveTag } from "./archiveTag.ts";
import { hasClubPages } from "./clubs.ts";
import { ESPN_TIMEOUT_MS, fetchEspnDays, type EspnEvent } from "./espn.ts";
import { freshLeagueData, getLeagueBase, type LeagueData } from "./leagueData.ts";
import { activeSpan, refreshPlan, refreshReason, scoreboardVerdict, type CheckWhy, type RefreshReason } from "./leagueRefresh.ts";
import { parsePublications, publicationState, publishedSource, publishedTag, type PublicationState, type PublishedSource } from "./publishedData.ts";
import { matchSettledTag, settledFactsChanged } from "./settledMatch.ts";
import { dataTag, outlookTag } from "./sharedOutlook.ts";

/*
 * What /api/revalidate/leagues does on a run (src/app/api/revalidate/leagues/route.ts
 * is only its door: the token, the parameters, the answer). Kept here, with
 * what it reads and expires passed in, so the tests can run it: which tags a
 * changed league expires, and that an announced publication expires its own
 * file's tags and nothing else.
 */

/** Expires a tag at once (`revalidateTag(tag, { expire: 0 })` in the route). */
export type Expire = (tag: string) => void;

/** Leagues checked at once (each: the cached copy and one fresh ESPN load). */
const AT_ONCE = 6;

export interface RefreshDeps {
  expire: Expire;
  /** The cached copy the pages are built from (getLeagueData). */
  cached?: (league: LeagueConfig) => Promise<LeagueData | undefined>;
  /** ESPN's data now, past every cache (freshLeagueData). */
  fresh?: (league: LeagueConfig) => Promise<LeagueData | undefined>;
  /** The small feed: the scoreboard's events between two times (fetchEspnDays). */
  scoreboard?: (slug: string, from: number, to: number) => Promise<EspnEvent[]>;
  now?: number;
}

export interface RefreshResult {
  league: string;
  reason: RefreshReason;
  why: CheckWhy;
  via?: "scoreboard" | "season";
  /** A settled game's own facts changed (a correction): its league's settled match pages were expired. */
  settled?: boolean;
}

/**
 * Every domestic league's check (`only`: one league's), a few at a time: only
 * the leagues that need it are compared with ESPN (refreshPlan), a league with
 * a game near through the small feed first (scoreboardVerdict), and a league
 * whose data changed has its data and outlook tags expired at once.
 */
export async function refreshLeagues({ only, full }: { only?: string; full?: boolean }, deps: RefreshDeps) {
  // Both sides without the league's stored xG: it's the same entry on both, so it never decides the comparison
  // (attachXg adds a game's xG only with its result, which differs first), and reading it cost a data-cache read
  // per xG league on every run, two when its season was downloaded. New xG reaches the pages through its own
  // publication (announcePublications), as before.
  const cachedOf = deps.cached ?? ((league: LeagueConfig) => getLeagueBase(league).catch(() => undefined));
  const freshOf = deps.fresh ?? ((league: LeagueConfig) => freshLeagueData(league, { xg: false }));
  const scoreboard = deps.scoreboard ?? ((slug: string, from: number, to: number) => fetchEspnDays(slug, from, to, { cache: "no-store", timeoutMs: ESPN_TIMEOUT_MS, perf: true }));
  const leagues = LEAGUES.filter((l) => hasClubPages(l) && (!only || l.code === only));
  const now = deps.now ?? Date.now();
  const results: RefreshResult[] = [];
  const check = async (league: LeagueConfig) => {
    const cached = await cachedOf(league);
    const plan = refreshPlan(league, cached, now, Boolean(full) || Boolean(only));
    if (!plan.check) {
      results.push({ league: league.code, reason: plan.why === "own-data" ? "unchanged" : "skipped", why: plan.why });
      return;
    }
    // A game near, nothing else due: the small feed first. Only "the same games, times and results" ends the
    // check here; a difference, or a feed that can't be read, goes on to the season's download on this same run.
    if (plan.scoreboardFirst && cached && league.espn) {
      const span = activeSpan(now);
      const events = await scoreboard(league.espn.slug, span.from, span.to).catch((error: unknown) => {
        console.warn(`${league.code}: no ESPN scoreboard, checking the season:`, error);
        return undefined;
      });
      if (events && scoreboardVerdict(cached, events, now, league.espn.resultsStand) === "same") {
        results.push({ league: league.code, reason: "unchanged", why: plan.why, via: "scoreboard" });
        return;
      }
    }
    const fresh = await freshOf(league);
    const reason = refreshReason(cached, fresh);
    if (reason === "changed") {
      // Expired at once, not served stale while it refreshes: a page rebuilt from a stale copy of the league's
      // data would keep the old results for hours (the copy and the pages are kept that long, see keptEspn).
      // The next visit to each page waits for its rebuild instead. Next's advice for an invalidation from
      // outside a Server Action (a webhook, a cron job).
      deps.expire(dataTag(league.code));
      deps.expire(outlookTag(league.code));
    }
    // Settled match pages (src/lib/settledMatch.ts) don't follow the league: only a correction of a settled game
    // itself (its score, date or clubs) expires them, whatever else changed. Compared on every season downloaded:
    // a club corrected on a game isn't something refreshVersion counts.
    const settled = settledFactsChanged(cached, fresh, now);
    if (settled) deps.expire(matchSettledTag(league.code));
    results.push({ league: league.code, reason, why: plan.why, via: "season", ...(settled ? { settled: true } : {}) });
  };
  for (let i = 0; i < leagues.length; i += AT_ONCE) await Promise.all(leagues.slice(i, i + AT_ONCE).map(check));
  const refreshed = results.filter((r) => r.reason === "changed").map((r) => r.league);
  // `fetched`: seasons downloaded; `scoreboards`: leagues the small feed cleared on its own.
  const fetched = results.filter((r) => r.via === "season").length;
  const scoreboards = results.filter((r) => r.via === "scoreboard").length;
  return { checked: results.length, fetched, scoreboards, refreshed, results };
}

/**
 * Files the daily job announces (`publish=snapshots:PL:<sha256>,xg:PL:<sha256>`):
 * each checked at the source by its fingerprint first, then its own tags
 * expired (new snapshots: also the league's archive tag). No league data read,
 * no other league touched.
 */
export async function announcePublications(param: string, deps: { expire: Expire; source?: PublishedSource | undefined; fetcher?: typeof fetch }) {
  const source = "source" in deps ? deps.source : publishedSource();
  const files = await Promise.all(parsePublications(param).map(async (p) => ({ ...p, state: await publicationState(p, source, deps.fetcher) })));
  for (const { kind, code, state } of files) {
    if (state !== "published") continue;
    deps.expire(publishedTag(kind, code));
    if (kind === "snapshots") deps.expire(archiveTag(code));
  }
  const named = (state: PublicationState) => files.filter((f) => f.state === state).map((f) => `${f.kind}:${f.code}`);
  return { published: named("published"), pending: named("pending"), unavailable: named("unavailable"), source: source?.base ?? null };
}

/** `archive=PL` (a list, or `all`): those leagues' past-round reports, worked out again on their next visit. */
export function expireArchives(param: string, expire: Expire): string[] {
  const wanted = param.toUpperCase().split(",").map((c) => c.trim());
  const codes = LEAGUES.filter((l) => hasClubPages(l) && (wanted.includes("ALL") || wanted.includes(l.code))).map((l) => l.code);
  for (const code of codes) expire(archiveTag(code));
  return codes;
}
