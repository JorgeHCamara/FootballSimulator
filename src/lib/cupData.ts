// The file itself (".js"): these modules also run outside Next (scripts, tests), whose Node needs the extension.
import { unstable_cache } from "next/cache.js";
import { domesticModelOptions } from "./priors.ts";
import type { CupConfig, CupRoundKey } from "../config/cups.ts";
import { LEAGUES, type CompetitionCode } from "../config/leagues.ts";
import { withFallbackCrests } from "../config/crests.ts";
import { applyTeamOverrides } from "../config/teamOverrides.ts";
import type { RealCupTie } from "../engine/cup.ts";
import { buildCupStrengths, type FeederModel } from "../engine/cupModel.ts";
import { buildLeagueModel, type TeamStrength } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import type { Fixture, Team, TeamId } from "../engine/types.ts";
import { EspnError, espnFixtures, espnTeams, fetchEspnYear, type EspnCalendarEntry, type EspnEvent } from "./espn.ts";
import { getLeagueData, noDataCache } from "./leagueData.ts";
import { espnDataKey } from "./dataCacheKey.ts";
import { sampleCup } from "./sampleLeague.ts";

export interface CupData {
  /** Every club in the competition so far, plus the clubs still to enter. */
  teams: Team[];
  /** Ties the real draw has made, with results where played. */
  real: RealCupTie[];
  /** Clubs entering in later rounds (and the first round, for sample data). */
  entrants: Partial<Record<CupRoundKey, TeamId[]>>;
  /** Placeholder kick-off per round for simulated draws. */
  roundDates: Partial<Record<CupRoundKey, string>>;
  /** Each club's league, for division tags; absent = non-league. */
  divisions: Record<TeamId, CompetitionCode>;
  /** Attack/defence of every league club on one scale (see cupModel.ts). */
  strengths: Record<TeamId, TeamStrength>;
  season: string;
  seasonKey: string;
  source: "live" | "sample";
}

const REVALIDATE_SECONDS = 3600;
const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";
const inflight = new Map<string, Promise<CupData>>();

/** The season being played, by its starting year (split seasons run August–May). */
export const currentSeasonYear = (cup: CupConfig, now = new Date()) =>
  cup.espn.seasons === "split" && now.getUTCMonth() < 5 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();

/** Groups a round's games into ties: one game, or the two legs between the same clubs (in date order). */
export function groupLegs(fixtures: readonly Fixture[]): Fixture[][] {
  const ties = new Map<string, Fixture[]>();
  for (const f of [...fixtures].sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id - b.id)) {
    const key = [f.homeId, f.awayId].sort((a, b) => a - b).join("-");
    ties.set(key, [...(ties.get(key) ?? []), f]);
  }
  return [...ties.values()];
}

/** ESPN's calendar label as a round slug: "Rd of 16" → "round-of-16", "Quarterfinals" → "quarterfinals". */
export const calendarSlug = (label: string) => label.toLowerCase().replace(/^rd of/, "round of").replace(/\s+/g, "-");

/**
 * The round an event belongs to: the one whose ESPN slug is the event's season
 * slug, or, when the feed gives no slug, the one whose calendar window holds
 * the kick-off (the EFL Cup's board names the rounds in its calendar).
 * Undefined for an event of no configured round.
 */
export function eventRound<R extends { key: CupRoundKey; espnSlug: string }>(
  event: Pick<EspnEvent, "date" | "season">,
  rounds: readonly R[],
  calendar: readonly EspnCalendarEntry[] = [],
): R | undefined {
  const slug = event.season?.slug;
  if (slug) return rounds.find((round) => round.espnSlug === slug);
  const time = Date.parse(event.date);
  if (Number.isNaN(time)) return undefined;
  const entry = calendar.find((c) => Date.parse(c.startDate) <= time && time < Date.parse(c.endDate));
  return entry ? rounds.find((round) => round.espnSlug === calendarSlug(entry.label)) : undefined;
}

/** Same request sharing as getLeagueData. */
export function getCupData(cup: CupConfig): Promise<CupData> {
  const pending = inflight.get(cup.code);
  if (pending) return pending;
  const promise = loadCupData(cup);
  inflight.set(cup.code, promise);
  const forget = () => {
    if (!isBuildPhase()) inflight.delete(cup.code);
  };
  promise.then(forget, () => inflight.delete(cup.code));
  return promise;
}

async function loadCupData(cup: CupConfig): Promise<CupData> {
  if (process.env.FOOTSIMU_SAMPLE_DATA === "1") return sampleCup(cup);
  try {
    return await loadEspnCup(cup);
  } catch (error) {
    const reason = error instanceof EspnError ? `HTTP ${error.status}` : String(error);
    if (process.env.NODE_ENV === "production" && (!isBuildPhase() || process.env.VERCEL)) {
      throw new Error(`No real data for ${cup.code}: ESPN failed (${reason})`);
    }
    console.error(`Falling back to sample data for ${cup.code} (${reason})`);
    return sampleCup(cup);
  }
}

/** The clubs of each feeder league, their divisions and their ratings. */
async function loadFeeders(cup: CupConfig) {
  const feeders: FeederModel[] = [];
  const teams = new Map<TeamId, Team>();
  const divisions: Record<TeamId, CompetitionCode> = {};
  const members: Partial<Record<CompetitionCode, TeamId[]>> = {};
  const required = new Set(cup.rounds.flatMap((r) => r.entrantsFrom ?? []));
  await Promise.all(
    cup.feederLeagues.map(async (code, tier) => {
      const league = LEAGUES.find((l) => l.code === code)!;
      try {
        const data = await getLeagueData(league);
        feeders.push({ tier, model: buildLeagueModel(data.teams, data.fixtures, realResults(data.fixtures), domesticModelOptions(league, data.seasonYear, data.xg)) });
        members[code] = data.teams.map((t) => t.id);
        for (const team of data.teams) {
          teams.set(team.id, team);
          divisions[team.id] = code;
        }
      } catch (error) {
        // Without a feeder its clubs rate as non-league sides; clubs that enter
        // the cup from it can't be placed at all, so that one is required.
        if (required.has(code)) throw error;
        console.warn(`${cup.code}: ${code} unavailable, its clubs rate as non-league:`, error);
      }
    }),
  );
  return { strengths: Object.fromEntries(buildCupStrengths(feeders)), teams, divisions, members };
}

/** A cup's own data as ESPN gives it (its draw so far, round dates and clubs), before the feeder leagues are added. */
interface CupDraw {
  year: number;
  real: RealCupTie[];
  roundDates: Partial<Record<CupRoundKey, string>>;
  /** The clubs in ESPN's draw, as read (overrides and saved crests applied). */
  teams: Team[];
}

/**
 * A cup's draw, kept in the data cache as read (an hour at a time, as
 * before), not as ESPN sends it: a cup's season scoreboard is up to 1.5 MB
 * and growing, and Next's data cache keeps no fetch over 2 MB (see keptEspn
 * in leagueData.ts). Inside the cached function ESPN's requests skip the data
 * cache. A load that fails isn't kept. Keyed by how it's read, not by
 * deployment (see src/lib/dataCacheKey.ts), so a deployment reuses it.
 *
 * Only the cup's own draw: the feeder leagues (the clubs' ratings, divisions
 * and later entrants) are added outside it, from their own kept data. Read
 * inside this function, each would have been downloaded again (a cached
 * function skips the data cache within it), every hour, for every cup.
 */
async function keptEspnCupDraw(cup: CupConfig): Promise<CupDraw> {
  const load = () => loadEspnCupDraw(cup);
  try {
    return await unstable_cache(load, espnDataKey("cup-draw", cup.code, `current-${currentSeasonYear(cup)}`, cup), {
      tags: [`cup:${cup.code}`],
      revalidate: REVALIDATE_SECONDS,
    })();
  } catch (error) {
    if (noDataCache(error)) return load();
    throw error;
  }
}

/** A cup's data: its kept draw, with its feeder leagues' clubs, divisions, ratings and later entrants. */
async function loadEspnCup(cup: CupConfig): Promise<CupData> {
  const { year, real, roundDates, teams: drawn } = await keptEspnCupDraw(cup);
  const feeders = await loadFeeders(cup);
  const entrants: Partial<Record<CupRoundKey, TeamId[]>> = {};
  for (const round of cup.rounds) {
    if (!round.entrantsFrom) continue;
    // A round the real draw has filled takes no one else (and a past season's
    // cup mustn't take this season's league clubs).
    if (real.filter((t) => t.round === round.key).length >= round.ties) {
      entrants[round.key] = [];
      continue;
    }
    const members = round.entrantsFrom.flatMap((code) => feeders.members[code] ?? []);
    // Clubs already in the real draw (earlier rounds) don't enter again.
    const inCup = new Set(real.flatMap((t) => [t.homeId, t.awayId]));
    entrants[round.key] = round.entrantsNotYetIn ? members.filter((id) => !inCup.has(id)) : members;
  }
  const teams = new Map(feeders.teams);
  for (const team of drawn) if (!teams.has(team.id)) teams.set(team.id, team);

  return {
    teams: [...teams.values()],
    real,
    entrants,
    roundDates,
    divisions: feeders.divisions,
    strengths: feeders.strengths,
    season: cup.espn.seasons === "split" ? `${year}/${String(year + 1).slice(2)}` : String(year),
    seasonKey: `${cup.code}:${year}`,
    source: "live",
  };
}

async function loadEspnCupDraw(cup: CupConfig): Promise<CupDraw> {
  const init = { next: { revalidate: REVALIDATE_SECONDS, tags: [`cup:${cup.code}`] } };
  const current = currentSeasonYear(cup);
  for (const year of [current, current - 1]) {
    const years = cup.espn.seasons === "split" ? [year, year + 1] : [year];
    const boards = await Promise.all(years.map((y) => fetchEspnYear(cup.espn.slug, y, init)));
    const events = new Map<string, EspnEvent>();
    for (const e of boards.flatMap((b) => b.events ?? [])) if (e.season?.year === year) events.set(e.id, e);
    const all = [...events.values()];
    // The season's own board carries the round calendar.
    const calendar = boards.find((b) => b.leagues?.[0]?.season?.year === year)?.leagues?.[0]?.calendar?.[0]?.entries ?? [];
    const byRound = cup.rounds.map((round) => all.filter((e) => eventRound(e, cup.rounds, calendar)?.key === round.key));
    // A new season counts once a round is (at least half) drawn: the first,
    // or a later one when a season skips its opening round (the EFL Cup's
    // preliminary round is only held when the numbers need it).
    if (!cup.rounds.some((round, r) => byRound[r]!.length >= round.ties / 2)) continue;

    const real: RealCupTie[] = cup.rounds.flatMap((round, r) =>
      groupLegs(espnFixtures(byRound[r]!)).map((legs) => ({ round: round.key, homeId: legs[0]!.homeId, awayId: legs[0]!.awayId, legs })),
    );
    const roundDates: Partial<Record<CupRoundKey, string>> = {};
    cup.rounds.forEach((round, r) => {
      // Scheduled games (even with clubs still "TBD") carry the real kick-off;
      // otherwise near the end of the round's calendar window (a window opens
      // as soon as the previous round ends, so its start is too early).
      const kickoffs = byRound[r]!.map((e) => e.date).filter((d) => !Number.isNaN(Date.parse(d))).sort();
      if (kickoffs[0]) {
        roundDates[round.key] = new Date(kickoffs[0]).toISOString();
        return;
      }
      const entry = calendar.find((c) => calendarSlug(c.label) === round.espnSlug);
      if (entry) {
        const start = Date.parse(entry.startDate);
        const end = Date.parse(entry.endDate);
        const date = new Date(Number.isNaN(end) ? start + 5 * 86_400_000 : Math.max(start, end - 2 * 86_400_000));
        date.setUTCHours(19, 0, 0, 0); // an evening kick-off, not the window's boundary time
        roundDates[round.key] = date.toISOString();
      }
    });
    return { year, real, roundDates, teams: withFallbackCrests(applyTeamOverrides(espnTeams(all))) };
  }
  throw new Error(`No ${cup.code} first round on ESPN for ${current} or ${current - 1}`);
}
