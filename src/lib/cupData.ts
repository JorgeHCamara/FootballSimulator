import type { CupConfig, CupRoundKey } from "../config/cups.ts";
import { LEAGUES, type CompetitionCode } from "../config/leagues.ts";
import { applyTeamOverrides } from "../config/teamOverrides.ts";
import type { RealCupTie } from "../engine/cup.ts";
import { buildCupStrengths, type FeederModel } from "../engine/cupModel.ts";
import { buildLeagueModel, type TeamStrength } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import type { Fixture, Team, TeamId } from "../engine/types.ts";
import { EspnError, espnFixtures, espnTeams, fetchEspnYear, type EspnEvent } from "./espn.ts";
import { getLeagueData } from "./leagueData.ts";
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
const currentSeasonYear = (cup: CupConfig, now = new Date()) =>
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
        feeders.push({ tier, model: buildLeagueModel(data.teams, data.fixtures, realResults(data.fixtures)) });
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

async function loadEspnCup(cup: CupConfig): Promise<CupData> {
  const init = { next: { revalidate: REVALIDATE_SECONDS, tags: [`cup:${cup.code}`] } };
  const current = currentSeasonYear(cup);
  for (const year of [current, current - 1]) {
    const years = cup.espn.seasons === "split" ? [year, year + 1] : [year];
    const boards = await Promise.all(years.map((y) => fetchEspnYear(cup.espn.slug, y, init)));
    const events = new Map<string, EspnEvent>();
    for (const e of boards.flatMap((b) => b.events ?? [])) if (e.season?.year === year) events.set(e.id, e);
    const all = [...events.values()];
    const byRound = cup.rounds.map((round) => all.filter((e) => e.season?.slug === round.espnSlug));
    // A new season counts once its first round is (at least half) drawn.
    if (byRound[0]!.length < cup.rounds[0]!.ties / 2) continue;

    const real: RealCupTie[] = cup.rounds.flatMap((round, r) =>
      groupLegs(espnFixtures(byRound[r]!)).map((legs) => ({ round: round.key, homeId: legs[0]!.homeId, awayId: legs[0]!.awayId, legs })),
    );
    // The season's own board carries the round calendar.
    const calendar = boards.find((b) => b.leagues?.[0]?.season?.year === year)?.leagues?.[0]?.calendar?.[0]?.entries ?? [];
    const roundDates: Partial<Record<CupRoundKey, string>> = {};
    for (const round of cup.rounds) {
      const slug = (label: string) => label.toLowerCase().replace(/^rd of/, "round of").replace(/\s+/g, "-");
      const entry = calendar.find((c) => slug(c.label) === round.espnSlug);
      if (entry) roundDates[round.key] = new Date(Date.parse(entry.startDate) + 5 * 86_400_000).toISOString();
    }

    const feeders = await loadFeeders(cup);
    const entrants: Partial<Record<CupRoundKey, TeamId[]>> = {};
    for (const round of cup.rounds) {
      if (round.entrantsFrom) entrants[round.key] = round.entrantsFrom.flatMap((code) => feeders.members[code] ?? []);
    }
    const teams = new Map(feeders.teams);
    for (const team of applyTeamOverrides(espnTeams(all))) if (!teams.has(team.id)) teams.set(team.id, team);

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
  throw new Error(`No ${cup.code} first round on ESPN for ${current} or ${current - 1}`);
}
