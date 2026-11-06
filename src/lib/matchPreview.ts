import { cache } from "react";
import { getLeagueBySlug, type LeagueConfig, type ZoneKind } from "../config/leagues.ts";
import { leagueTimeZone } from "../config/timezones.ts";
import { expectedGoals, expectedGoalsNeutral, likelyScores, outcomeProbabilities, scoreMatrix, MAX_SCORE, type ExpectedGoals, type OutcomeProbabilities } from "../engine/match.ts";
import type { LeagueModel } from "../engine/ratings.ts";
import type { Fixture, Score, TeamId } from "../engine/types.ts";
import { dataAsOf, outlookSetup, type ClubChances, type ClubOutlook, type HeadlineKind, type LeagueOutlook, type ResultScenarios } from "./clubOutlook.ts";
import { sharedLeagueOutlook } from "./sharedOutlook.ts";
import { hasClubPages } from "./clubs.ts";
import { fetchEspnGameState } from "./espn.ts";
import { getLeagueData, getPastSeasonData, type LeagueData } from "./leagueData.ts";
import { findMatch, slugDate, type MatchRef } from "./matches.ts";

/** Where a game stands when its page is rendered. */
export type MatchState = "upcoming" | "live" | "played" | "off";

export interface LoadedMatch {
  league: LeagueConfig;
  /** The season the game belongs to (last season's, for an old address after the new one has started). */
  data: LeagueData;
  /** The current season: club pages exist only for its clubs. */
  current: LeagueData;
  match: MatchRef;
  /** "2026/27", or a season of several tournaments by its year. */
  season: string;
  state: MatchState;
  /** The final score, once the game is over. */
  result: Score | null;
  /** The model as it stood at kick-off (no later results): the pre-match prediction. */
  model: LeagueModel;
  xg: ExpectedGoals;
  odds: OutcomeProbabilities;
  /** The five likeliest scores, likeliest first. */
  scores: (Score & { p: number })[];
  /** The season's outlook (positions, form) and each club's in it. */
  outlook: LeagueOutlook | null;
  homeClub?: ClubOutlook;
  awayClub?: ClubOutlook;
  venue?: string;
  timeZone: string;
}

const HOUR = 3_600_000;
/** Match day: from this long before kick-off… */
const MATCH_DAY_BEFORE = 6 * HOUR;
/** …to this long after it, the game itself is checked every few minutes (see MATCH_DAY_REVALIDATE). */
const MATCH_DAY_AFTER = 12 * HOUR;
/** On match day, the game's state is refreshed this often (seconds), and so is its page. */
export const MATCH_DAY_REVALIDATE = 600;

/** Is it match day for a game (by its kick-off)? */
export const isMatchDay = (kickoff: string, now = Date.now()) => {
  const time = Date.parse(kickoff);
  return now >= time - MATCH_DAY_BEFORE && now <= time + MATCH_DAY_AFTER;
};

const seasonLabel = (data: LeagueData) => (data.tournaments ? (data.season.split(" ").at(-1) ?? data.season) : data.season);

const preMatchModels = new Map<string, LeagueModel>();

/**
 * The model at kick-off: built only from games played before it, so a played
 * game keeps the prediction it had. `current`: the league's model now (the
 * outlook's), which it is when no game has been played since.
 */
export function preMatchModel(league: LeagueConfig, data: LeagueData, fixture: Fixture, current: LeagueModel | null): LeagueModel | null {
  const later = [...data.fixtures, ...(data.tournaments ?? []).flatMap((t) => t.fixtures)].some((f) => f.result && f.utcDate >= fixture.utcDate);
  if (!later && current) return current;
  const key = `${league.code}:${data.seasonKey}:${fixture.id}:${fixture.utcDate}`;
  const hit = preMatchModels.get(key);
  if (hit) return hit;
  const model = outlookSetup(league, dataAsOf(data, fixture.utcDate))?.model ?? null;
  if (model) {
    if (preMatchModels.size > 2000) preMatchModels.delete(preMatchModels.keys().next().value!);
    preMatchModels.set(key, model);
  }
  return model;
}

/** A game found by its address, and where it stands: the cheap part of loadMatch (no simulation). */
export type FoundMatch = Pick<LoadedMatch, "league" | "data" | "current" | "match" | "state" | "result">;

/**
 * The game an address names, with its state (on match day, from ESPN):
 * `moved` for a game since moved to another day (a redirect), undefined for
 * no such game (a 404). Shared within a request.
 */
export const locateMatch = cache(async (leagueSlug: string, slug: string): Promise<FoundMatch | { moved: string } | undefined> => {
  const league = getLeagueBySlug(leagueSlug);
  if (!league || !hasClubPages(league)) return undefined;
  const current = await getLeagueData(league);
  let data = current;
  let found = findMatch(league, current, slug);
  // Last season's game, after the new season has replaced it.
  if (!found) {
    const first = Math.min(...current.fixtures.map((f) => Date.parse(f.utcDate)));
    if (slugDate(slug) < first && current.seasonYear !== undefined) {
      const past = await getPastSeasonData(league, current.seasonYear - 1);
      const inPast = past && findMatch(league, past, slug);
      if (inPast) {
        data = past;
        found = inPast;
      }
    }
  }
  if (!found) return undefined;
  if ("moved" in found) return { moved: found.moved.path };
  const { match } = found;
  const { fixture } = match;

  // Match day: the game's own state, fresher than the league's hourly data.
  let result = fixture.result;
  let state: MatchState = result ? "played" : "upcoming";
  if (!result && data.provider === "espn" && league.espn && isMatchDay(fixture.utcDate)) {
    const live = await fetchEspnGameState(league.espn.slug, fixture.id, fixture.utcDate, MATCH_DAY_REVALIDATE).catch((error: unknown) => {
      console.warn(`${league.code} ${fixture.id}: no match-day state:`, error);
      return null;
    });
    if (live?.result) {
      result = live.result;
      state = "played";
    } else if (live?.off) state = "off";
    else if (live?.state === "in") state = "live";
  }
  return { league, data, current, match, state, result };
});

/**
 * A game's page data. `moved` when the address names a game since moved to
 * another day (a redirect), undefined for no such game (a 404). Shared by the
 * page and its metadata within a request.
 */
export const loadMatch = cache(async (leagueSlug: string, slug: string): Promise<LoadedMatch | { moved: string } | undefined> => {
  const found = await locateMatch(leagueSlug, slug);
  if (!found || "moved" in found) return found;
  const { league, data, current, match, state, result } = found;
  const { fixture } = match;
  const outlook = await sharedLeagueOutlook(league, data);
  const model = preMatchModel(league, data, fixture, outlook?.model ?? null);
  if (!model) return undefined;
  const xg = gameXg(model, fixture);
  const rho = model.rho ?? 0;
  const homeClub = outlook?.clubs.get(fixture.homeId);
  const awayClub = outlook?.clubs.get(fixture.awayId);
  const venue = data.venues?.[fixture.id];
  return {
    league,
    data,
    current,
    match,
    season: seasonLabel(data),
    state,
    result,
    model,
    xg,
    odds: outcomeProbabilities(xg, rho),
    scores: likelyScores(xg, rho, 5),
    outlook,
    ...(homeClub ? { homeClub } : {}),
    ...(awayClub ? { awayClub } : {}),
    ...(venue ? { venue } : {}),
    timeZone: leagueTimeZone(league.code),
  };
});

/** A game's expected goals from a model (a neutral ground has no home advantage). */
export const gameXg = (model: LeagueModel, fixture: Fixture): ExpectedGoals =>
  fixture.neutral ? expectedGoalsNeutral(model, fixture.homeId, fixture.awayId) : expectedGoals(model, fixture.homeId, fixture.awayId);

/** The likeliest score of each result: what "if the home side wins" is played out with. */
export function resultScores(xg: ExpectedGoals, rho: number): ResultScenarios["scores"] {
  const matrix = scoreMatrix(xg, rho);
  const size = MAX_SCORE + 1;
  const best = (keep: (home: number, away: number) => boolean): Score => {
    let top = { home: 0, away: 0, p: -1 };
    for (let home = 0; home < size; home++) {
      for (let away = 0; away < size; away++) {
        const p = matrix[home * size + away]!;
        if (keep(home, away) && p > top.p) top = { home, away, p };
      }
    }
    return { home: top.home, away: top.away };
  };
  return { home: best((h, a) => h > a), draw: best((h, a) => h === a), away: best((h, a) => h < a) };
}


/** One line of "What this result means": a club's chance (or average place) now and after each result. */
export interface ImpactRow {
  teamId: TeamId;
  /** A season chance, or the average final place when none of them moves. */
  kind: HeadlineKind | "position";
  zone?: ZoneKind;
  /** "playoffWin": what winning the play-off is ("MLS Cup"). */
  name?: string;
  now: number;
  home: number;
  draw: number;
  away: number;
}

/** A change smaller than this (a point) doesn't count as moving a chance. */
const MOVES = 0.01;
/** Nor a change in average place smaller than this. */
const PLACE_MOVES = 0.1;

/**
 * Which of a club's chances a result moves, most moved first (at most
 * `count`): the title, the top European place, relegation… whichever are
 * still open. A club with none open (safe mid-table) gets its average place,
 * or nothing when even that doesn't move (a season already settled).
 */
export function impactRows(teamId: TeamId, now: ClubChances, after: { home?: ClubChances; draw?: ClubChances; away?: ClubChances }, count = 2): ImpactRow[] {
  const value = (c: ClubChances | undefined, kind: HeadlineKind) => c?.headline.find((h) => h.kind === kind)?.chance;
  const rows: (ImpactRow & { swing: number })[] = [];
  for (const h of now.headline) {
    const home = value(after.home, h.kind) ?? h.chance;
    const draw = value(after.draw, h.kind) ?? h.chance;
    const away = value(after.away, h.kind) ?? h.chance;
    const all = [h.chance, home, draw, away];
    const swing = Math.max(...all) - Math.min(...all);
    const settled = all.every((x) => x < MOVES) || all.every((x) => x > 1 - MOVES);
    if (swing >= MOVES && !settled) rows.push({ teamId, kind: h.kind, zone: h.zone, ...(h.name ? { name: h.name } : {}), now: h.chance, home, draw, away, swing });
  }
  rows.sort((a, b) => b.swing - a.swing);
  if (rows.length) return rows.slice(0, count).map(({ swing: _, ...row }) => row);
  const position = {
    teamId,
    kind: "position" as const,
    now: now.expectedPosition,
    home: after.home?.expectedPosition ?? now.expectedPosition,
    draw: after.draw?.expectedPosition ?? now.expectedPosition,
    away: after.away?.expectedPosition ?? now.expectedPosition,
  };
  // Nothing moves at all (a season already settled): nothing to show.
  const places = [position.now, position.home, position.draw, position.away];
  return Math.max(...places) - Math.min(...places) < PLACE_MOVES ? [] : [position];
}
