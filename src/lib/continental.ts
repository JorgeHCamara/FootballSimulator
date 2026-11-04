import { domesticModelOptions } from "./priors.ts";
import { continentOf } from "../config/competitions.ts";
import { LEAGUES, getLeagueByCode, type CompetitionCode, type LeagueConfig } from "../config/leagues.ts";
import { tierStrength } from "../engine/cupModel.ts";
import { buildLeagueModel, type TeamStrength } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import { computeStandings } from "../engine/standings.ts";
import type { StandingRow, Team, TeamId } from "../engine/types.ts";
import { getLeagueData } from "./leagueData.ts";

// Starting ratings for a continental competition, whose clubs come from many
// leagues: each club's attack/defence relative to its own league (this
// season's real results), scaled by how strong that league is, on the same
// scale as the domestic cups (one tier = ×0.85 attack, ÷0.85 defence). The
// league-phase results then pull the ratings toward the club's European form
// (see buildLeagueModel's priorStrengths).

/**
 * League strength in tiers below the Premier League, roughly following UEFA's
 * country coefficients (a judgement call, not an official figure).
 */
export const LEAGUE_TIERS: Partial<Record<CompetitionCode, number>> = {
  PL: 0,
  PD: 0.25,
  BL1: 0.35,
  SA: 0.35,
  FL1: 0.6,
  PPL: 0.9,
  DED: 1,
  ELC: 1.4,
  SD: 1.5,
  BL2: 1.5,
  SB: 1.6,
  FL2: 1.8,
  DJL: 2.4,
  // Only meets other leagues in the Libertadores, where scores are relative to
  // the competition: Brazil's clubs start a little above the rest.
  BSA: 0.9,
  BSB: 2.1,
};

/** Combines domestic ratings into priors for the competition's clubs, averaging 1 across them. */
export function continentalPriors(
  clubs: readonly TeamId[],
  domestic: readonly { tier: number; strengths: ReadonlyMap<TeamId, TeamStrength> }[],
  outsiderTier: number,
): Record<TeamId, TeamStrength> {
  const raw = clubs.map((id) => {
    const home = domestic.find((d) => d.strengths.has(id));
    const scale = tierStrength(home ? home.tier : outsiderTier);
    const s = home?.strengths.get(id) ?? { attack: 1, defence: 1 };
    return { id, attack: s.attack * scale.attack, defence: s.defence * scale.defence };
  });
  // Relative to the competition's average club (geometric means of 1), like
  // ratings built from its own results.
  const mean = (values: number[]) => Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / Math.max(values.length, 1));
  const attack = mean(raw.map((r) => r.attack));
  const defence = mean(raw.map((r) => r.defence));
  return Object.fromEntries(raw.map((r) => [r.id, { attack: r.attack / attack, defence: r.defence / defence }]));
}

/** Priors for a continental competition's clubs from the domestic leagues on the site. */
export async function getContinentalPriors(league: LeagueConfig, clubs: readonly TeamId[]): Promise<Record<TeamId, TeamStrength>> {
  if (!league.continental || process.env.FOOTSIMU_SAMPLE_DATA === "1") return {};
  // Domestic leagues of the competition's own continent (Europe for UEFA, South America for CONMEBOL).
  const continent = continentOf(league.country);
  const feeders = LEAGUES.filter((l) => LEAGUE_TIERS[l.code] !== undefined && continentOf(l.country) === continent);
  const domestic = (
    await Promise.all(
      feeders.map(async (feeder) => {
        try {
          const data = await getLeagueData(feeder);
          if (data.source !== "live") return null;
          // The domestic model, with its own starting ratings (last season).
          const model = buildLeagueModel(data.teams, data.fixtures, realResults(data.fixtures), domesticModelOptions(feeder, data.seasonYear));
          return { tier: LEAGUE_TIERS[feeder.code]!, strengths: model.strengths };
        } catch (error) {
          // Its clubs then start like clubs from leagues the site doesn't cover.
          console.warn(`${league.code}: ${feeder.code} unavailable for ratings:`, error);
          return null;
        }
      }),
    )
  ).filter((d) => d !== null);
  // Top divisions first, so a club is rated from the strongest league it's in.
  domestic.sort((a, b) => a.tier - b.tier);
  return continentalPriors(clubs, domestic, league.continental.outsiderTier);
}

/**
 * Clubs that join the knockout phase from another competition's group stage
 * (Copa Sudamericana: the Libertadores third-placed clubs), from that
 * competition's real results: final once its group stage is over, the current
 * places before that.
 */
export async function getExternalSeeds(league: LeagueConfig): Promise<{ rows: StandingRow[]; teams: Team[] } | undefined> {
  const external = league.playoff?.seedFromGroups?.external;
  if (!external || process.env.FOOTSIMU_SAMPLE_DATA === "1") return undefined;
  const other = getLeagueByCode(external.league);
  if (!other) return undefined;
  try {
    const data = await getLeagueData(other);
    if (data.source !== "live" || !data.groups) return undefined;
    const byId = new Map(data.teams.map((t) => [t.id, t]));
    const results = realResults(data.fixtures);
    const rows = data.groups.flatMap((group) => {
      const table = computeStandings(group.teamIds.flatMap((id) => byId.get(id) ?? []), data.fixtures, results, { tiebreakers: other.tiebreakers, includeForm: false });
      return table.filter((row) => row.position === external.place);
    });
    return { rows, teams: rows.flatMap((row) => byId.get(row.teamId) ?? []) };
  } catch (error) {
    // The play-off then shows only this competition's clubs until the feed lists the real games.
    console.warn(`${league.code}: no ${external.league} clubs for the knockout phase:`, error);
    return undefined;
  }
}
