// The file itself (".js"): these modules also run outside Next (scripts, tests), whose Node needs the extension.
import { unstable_cache } from "next/cache.js";
import { cache } from "react";
import { getLeagueBySlug, type LeagueConfig } from "../config/leagues.ts";
import type { ExpectedGoals, OutcomeProbabilities } from "../engine/match.ts";
import type { Score, TeamId } from "../engine/types.ts";
import type { LeagueOutlook } from "./clubOutlook.ts";
import { hasClubPages } from "./clubs.ts";
import { noDataCache } from "./leagueData.ts";
import { hasImpact } from "./matchImpact.ts";
import { loadMatch, type LoadedMatch, type MatchState } from "./matchPreview.ts";
import { INDEX_PAST_DAYS, type MatchRef } from "./matches.ts";
import { readSettledMatch, settleTime, type ClubCard, type SettledMatchRecord } from "./settledMatch.ts";

/**
 * What a match page shows, whichever way it was loaded: live (loadMatch: the
 * league's data and outlook now) or settled (a frozen record of a game played
 * more than SETTLED_MATCH_DAYS days ago, src/lib/settledMatch.ts).
 */
export interface MatchView {
  league: LeagueConfig;
  match: MatchRef;
  season: string;
  state: MatchState;
  result: Score | null;
  odds: OutcomeProbabilities;
  xg: ExpectedGoals;
  scores: (Score & { p: number })[];
  /** The model's rho (the dice of a game still to play). */
  rho: number;
  venue?: string;
  timeZone: string;
  /** How the league's tables are named on the clubs' cards. */
  scope: LeagueOutlook["scope"] | undefined;
  homeClub?: ClubCard;
  awayClub?: ClubCard;
  /** The clubs' pages this season, by club. */
  pages: Record<TeamId, string>;
  /** Does the page show "What this result means"? */
  impact: boolean;
  /** Built from a frozen record: the clubs' cards are as they stood after the game. */
  settled: boolean;
}

/** The live page's view of a game (as the page read it before settled pages). */
export function liveView(loaded: LoadedMatch): MatchView {
  const { league, match, season, state, result, odds, xg, scores, venue, timeZone, outlook, homeClub, awayClub } = loaded;
  const pages: Record<TeamId, string> = {};
  for (const team of [match.home, match.away]) {
    const page = loaded.current.teams.find((x) => x.slug === team.slug)?.page;
    if (page) pages[team.id] = page;
  }
  return {
    league,
    match,
    season,
    state,
    result,
    odds,
    xg,
    scores,
    rho: loaded.model.rho ?? 0,
    ...(venue ? { venue } : {}),
    timeZone,
    scope: outlook?.scope,
    ...(homeClub ? { homeClub } : {}),
    ...(awayClub ? { awayClub } : {}),
    pages,
    impact: hasImpact(loaded),
    settled: false,
  };
}

/** A settled game's view from its record. */
export function settledView(league: LeagueConfig, record: SettledMatchRecord): MatchView {
  const { match } = record;
  const homeClub = record.clubs[match.fixture.homeId];
  const awayClub = record.clubs[match.fixture.awayId];
  return {
    league,
    match,
    season: record.season,
    state: "played",
    result: match.fixture.result,
    odds: record.odds,
    xg: record.xg,
    scores: record.scores,
    rho: 0,
    ...(record.venue ? { venue: record.venue } : {}),
    timeZone: record.timeZone,
    scope: record.scope ?? undefined,
    ...(homeClub ? { homeClub } : {}),
    ...(awayClub ? { awayClub } : {}),
    pages: record.pages,
    impact: false,
    settled: true,
  };
}

const DAY = 86_400_000;

/**
 * A settled page inside the window search engines are pointed at (games up to
 * INDEX_PAST_DAYS days old: the page is indexable, later it says noindex):
 * kept no longer than until it leaves the window, so it says noindex on time,
 * as the live page did. A tiny entry, read only then.
 */
async function indexWindowClock(kickoff: string, now: number): Promise<void> {
  const end = Date.parse(kickoff) + INDEX_PAST_DAYS * DAY;
  if (!(end > now)) return;
  try {
    await unstable_cache(async () => end, ["index-window-clock", String(end)], { revalidate: Math.max(60, Math.ceil((end - now) / 1000)) })();
  } catch (error) {
    if (!noDataCache(error)) throw error;
  }
}

/**
 * A match page's view by its address: settled (from its record, no live data
 * read) when its game is, else live (loadMatch). `moved` for a game moved to
 * another day (a redirect), undefined for no such game (a 404). Shared by the
 * page and its metadata within a request.
 */
export const loadMatchView = cache(async (leagueSlug: string, slug: string): Promise<MatchView | { moved: string } | undefined> => {
  const league = getLeagueBySlug(leagueSlug);
  if (!league || !hasClubPages(league)) return undefined;
  const now = Date.now();
  if (now >= settleTime(slug)) {
    const record = await readSettledMatch(league, slug, now);
    if (record) {
      await indexWindowClock(record.match.fixture.utcDate, now);
      return settledView(league, record);
    }
  }
  const loaded = await loadMatch(leagueSlug, slug);
  if (!loaded || "moved" in loaded) return loaded;
  return liveView(loaded);
});
