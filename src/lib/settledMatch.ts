// The file itself (".js"): these modules also run outside Next (scripts, tests), whose Node needs the extension.
import { unstable_cache } from "next/cache.js";
import type { LeagueConfig, SiteLocale } from "../config/leagues.ts";
import { leagueTimeZone } from "../config/timezones.ts";
import { likelyScores, outcomeProbabilities, type ExpectedGoals, type OutcomeProbabilities } from "../engine/match.ts";
import { ratingXgWeight } from "../engine/ratings.ts";
import type { Fixture, Score, StandingRow, TeamId } from "../engine/types.ts";
import { outlookSetup, type LeagueOutlook } from "./clubOutlook.ts";
import { SETTLED_MATCH_DAYS } from "./costChoices.ts";
import { espnDataKey } from "./dataCacheKey.ts";
import { attachXg, noDataCache, sourceData, type LeagueData } from "./leagueData.ts";
import { allGames } from "./leagueRefresh.ts";
import { gameXg, preMatchModel, seasonLabel } from "./matchPreview.ts";
import { findMatch, slugDate, type MatchRef } from "./matches.ts";
import { perfLog, since } from "./perfLog.ts";
import { SIM_VERSION } from "./simVersion.ts";
import { readXg } from "./xgStore.ts";

/*
 * Settled match pages (decision C, src/lib/costChoices.ts). A played game's
 * page used to follow its league: every new result anywhere in the league
 * expired it (its clubs' cards showed their table now), so every match page of
 * the season, games played weeks ago included, was rebuilt after every result,
 * by the next crawler to open it. Once a game has its final score and kicked
 * off more than SETTLED_MATCH_DAYS days ago, its page is built from this
 * record instead: one data-cache entry per game, worked out once and kept
 * SETTLED_MATCH_KEEP_SECONDS, tagged matchSettledTag only. It holds what the
 * page shows: the game, its result, the pre-match odds, xG and likely scores
 * (the same model at kick-off as before: preMatchModel), and both clubs' table
 * rows (position, points, record, form) as they stood just after it. "What
 * this result means" isn't shown for a played game (impactPossible), so there
 * is nothing of it to keep.
 *
 * The record is worked out from the league's season read straight from its
 * source (sourceData: inside a cached function the data cache is skipped
 * anyway), so the page reads nothing tagged with the league's live data: a new
 * result elsewhere leaves it alone. The refresh job expires matchSettledTag
 * when a settled game's own facts change (settledFacts: a corrected score,
 * date or clubs). A change to how a record is worked out needs
 * SETTLED_RECORD_VERSION bumped; the league's config, the club tables, the
 * ESPN parser and the model (SIM_VERSION) are in the key already.
 */

/** Bump when a settled game's record would come out differently from the same data. */
export const SETTLED_RECORD_VERSION = 1;

/** How long a settled game's record, and its page, are kept at most (as a past round's report: 30 days). */
export const SETTLED_MATCH_KEEP_SECONDS = 2_592_000;

/** The tag of a league's settled games' records and pages: the refresh job expires it when one's facts change. */
export const matchSettledTag = (code: string) => `match-settled:${code}`;

const DAY = 86_400_000;

/**
 * When the game an address names is settled, by the address alone (no data
 * read): its date is the game's local date, and a kick-off on it is at most a
 * day after that date's noon UTC (slugDate) in any time zone, so from this
 * moment it kicked off more than SETTLED_MATCH_DAYS days ago. A game settles 7
 * to 8 days after kick-off; NaN for an address without a date.
 */
export const settleTime = (slug: string) => slugDate(slug) + DAY + SETTLED_MATCH_DAYS * DAY;

/** Is a game settled at `now`: its final score in, and its address's settle time passed? */
export const isSettled = (match: Pick<MatchRef, "slug" | "fixture">, now = Date.now()) => Boolean(match.fixture.result) && now >= settleTime(match.slug);

/** A club's card on a match page: its table row, and which table (a conference's name). */
export interface ClubCard {
  row: Pick<StandingRow, "position" | "points" | "played" | "won" | "drawn" | "lost" | "form">;
  group?: Record<SiteLocale, string>;
}

/** What a settled game's page shows, frozen. */
export interface SettledMatchRecord {
  version: number;
  match: MatchRef;
  season: string;
  odds: OutcomeProbabilities;
  xg: ExpectedGoals;
  scores: (Score & { p: number })[];
  venue?: string;
  timeZone: string;
  /** The clubs' table rows just after the game, and how the league's tables are named. */
  scope: LeagueOutlook["scope"] | null;
  clubs: Record<TeamId, ClubCard>;
  /** The clubs' pages this season (an old game's club may have gone down since). */
  pages: Record<TeamId, string>;
}

/** The league as it stood just after a game: every game kicking off later has no result yet (games at the same time count). */
export function dataAfter(data: LeagueData, fixture: Pick<Fixture, "utcDate">): LeagueData {
  const kickoff = Date.parse(fixture.utcDate);
  const strip = (fixtures: Fixture[]) => fixtures.map((f) => (f.result && Date.parse(f.utcDate) > kickoff ? { ...f, result: null } : f));
  return {
    ...data,
    fixtures: strip(data.fixtures),
    ...(data.tournaments ? { tournaments: data.tournaments.map((t) => ({ ...t, fixtures: strip(t.fixtures) })) } : {}),
  };
}

const card = (row: StandingRow, group: Record<SiteLocale, string> | undefined): ClubCard => ({
  row: { position: row.position, points: row.points, played: row.played, won: row.won, drawn: row.drawn, lost: row.lost, form: [...row.form] },
  ...(group ? { group } : {}),
});

/**
 * A settled game's record from its season's data (with the xG its ratings use)
 * and the current season's (for the clubs' pages): the odds, xG and scores as
 * the live page works them out, and the clubs' rows after the game.
 */
export function settledRecord(league: LeagueConfig, data: LeagueData, current: LeagueData, match: MatchRef): SettledMatchRecord | undefined {
  const { fixture } = match;
  // The model now, as the live page has it from its outlook (preMatchModel uses it when nothing was played since).
  const model = preMatchModel(league, data, fixture, outlookSetup(league, data)?.model ?? null);
  if (!model) return undefined;
  const xg = gameXg(model, fixture);
  const rho = model.rho ?? 0;
  const after = outlookSetup(league, dataAfter(data, fixture));
  const clubs: Record<TeamId, ClubCard> = {};
  for (const id of [fixture.homeId, fixture.awayId]) {
    const row = after?.rows.find((r) => r.teamId === id);
    if (row && data.teams.some((t) => t.id === id)) clubs[id] = card(row, after?.groupOf?.get(id));
  }
  const pages: Record<TeamId, string> = {};
  for (const team of [match.home, match.away]) {
    const page = current.teams.find((x) => x.slug === team.slug)?.page;
    if (page) pages[team.id] = page;
  }
  const venue = data.venues?.[fixture.id];
  return {
    version: SETTLED_RECORD_VERSION,
    match,
    season: seasonLabel(data),
    odds: outcomeProbabilities(xg, rho),
    xg,
    scores: likelyScores(xg, rho, 5),
    ...(venue ? { venue } : {}),
    timeZone: leagueTimeZone(league.code),
    scope: after?.scope ?? null,
    clubs,
    pages,
  };
}

class NotSettled extends Error {}

/** The league's season with the stored xG its ratings use, as the live page reads it (getLeagueData). */
async function withStoredXg(league: LeagueConfig, data: LeagueData): Promise<LeagueData> {
  if (data.source !== "live" || data.provider !== "espn" || !(ratingXgWeight(league) > 0)) return data;
  return attachXg(data, await readXg(league.code));
}

/** Works out a settled game's record, or throws (nothing is stored) when the game isn't one, or the data can't be read. */
async function workOut(league: LeagueConfig, slug: string, now: number): Promise<SettledMatchRecord> {
  const current = await sourceData(league);
  if (!current) throw new Error(`${league.code}: no data for ${slug}'s record`);
  let data = current;
  let found = findMatch(league, current, slug);
  // Last season's game, after the new season has replaced it (as locateMatch).
  if (!found && current.seasonYear !== undefined && current.fixtures.length) {
    const first = Math.min(...current.fixtures.map((f) => Date.parse(f.utcDate)));
    if (slugDate(slug) < first) {
      const past = await sourceData(league, current.seasonYear - 1);
      const inPast = past && findMatch(league, past, slug);
      if (past && inPast) {
        data = past;
        found = inPast;
      }
    }
  }
  if (!found || "moved" in found || !isSettled(found.match, now)) throw new NotSettled();
  // The current season's games are rated with their xG (getLeagueData); last season's without (getPastSeasonData).
  const record = settledRecord(league, data === current ? await withStoredXg(league, data) : data, current, found.match);
  if (!record) throw new NotSettled();
  return record;
}

/** The record's data-cache key: the game's address, and everything the record is worked out with. */
export function settledKey(league: LeagueConfig, slug: string, env: Record<string, string | undefined> = process.env): string[] {
  return [...espnDataKey("match-settled", league.code, slug, league, env), `sim-${SIM_VERSION}`, `v${SETTLED_RECORD_VERSION}`];
}

/** The record's entry: kept SETTLED_MATCH_KEEP_SECONDS, tagged matchSettledTag only (no league tag). */
export const settledEntry = (code: string) => ({ tags: [matchSettledTag(code)], revalidate: SETTLED_MATCH_KEEP_SECONDS });

/**
 * A settled game's record by its address, from the data cache (worked out once
 * and kept), or undefined: an address not settled yet (nothing is read), a
 * game that isn't settled (no final score, moved), or data that can't be read.
 * The page then goes the live way, as before.
 */
export async function readSettledMatch(league: LeagueConfig, slug: string, now = Date.now()): Promise<SettledMatchRecord | undefined> {
  if (!(now >= settleTime(slug))) return undefined;
  const start = performance.now();
  // For the [perf] line only: set when this call read the league's season from its source (a data cache miss).
  let built: number | undefined;
  const work = async () => {
    const t0 = performance.now();
    try {
      return await workOut(league, slug, now);
    } finally {
      built = since(t0);
    }
  };
  try {
    const record = await unstable_cache(work, settledKey(league, slug), settledEntry(league.code))();
    perfLog({ op: "settled-match", key: `${league.slug}/${slug}`, ms: since(start), cache: built === undefined ? "hit" : "miss", ...(built !== undefined ? { buildMs: built } : {}) });
    return record;
  } catch (error) {
    if (noDataCache(error)) return work().catch(() => undefined);
    if (!(error instanceof NotSettled)) console.warn(`${league.code} ${slug}: no settled record, the live page instead:`, error);
    return undefined;
  }
}

/**
 * The facts a settled game's record is frozen with, for every game that may be
 * settled at `now` (kicked off more than SETTLED_MATCH_DAYS days ago): its
 * date, clubs, score and shoot-out, by game. The refresh job compares them in
 * the cached data and ESPN's (a correction) and expires matchSettledTag when
 * they differ; a new result elsewhere in the league leaves them as they are.
 */
export function settledFacts(data: LeagueData, now: number): Map<number, string> {
  const facts = new Map<number, string>();
  for (const f of allGames(data)) {
    if (!(Date.parse(f.utcDate) < now - SETTLED_MATCH_DAYS * DAY)) continue;
    const score = (s: Score | null | undefined) => (s ? `${s.home}-${s.away}` : "");
    facts.set(f.id, `${f.utcDate}|${f.homeId}-${f.awayId}|${score(f.result)}|${score(f.penalties)}`);
  }
  return facts;
}

/** Did a settled game's facts change between the cached data and ESPN's (a correction, or a game gone)? */
export function settledFactsChanged(cached: LeagueData | undefined, fresh: LeagueData | undefined, now: number): boolean {
  if (!cached || !fresh) return false;
  const before = settledFacts(cached, now);
  const after = settledFacts(fresh, now);
  if (before.size !== after.size) return true;
  for (const [id, fact] of before) if (after.get(id) !== fact) return true;
  return false;
}
