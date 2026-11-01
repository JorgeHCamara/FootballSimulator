import type { LeagueModel, TeamStrength } from "./ratings.ts";
import type { TeamId } from "./types.ts";

// Ratings for a competition that mixes divisions: each club keeps its own
// league's attack/defence (relative to that league's average), scaled by how
// strong the league is. One tier down multiplies attack by TIER_STEP and
// defence (goals conceded) by 1 / TIER_STEP.

export const TIER_STEP = 0.85;
/** Clubs in none of the feeder leagues (non-league sides). */
export const NON_LEAGUE_TIER = 4.5;

export const CUP_AVG_HOME_GOALS = 1.5;
export const CUP_AVG_AWAY_GOALS = 1.2;

export interface FeederModel {
  /** 0 for the top division, 1 for the second, … */
  tier: number;
  model: LeagueModel;
}

export function tierStrength(tier: number): TeamStrength {
  return { attack: TIER_STEP ** tier, defence: TIER_STEP ** -tier };
}

/** Strengths of every feeder club on one scale; unknown clubs default to non-league. */
export function buildCupStrengths(feeders: readonly FeederModel[]): Map<TeamId, TeamStrength> {
  const strengths = new Map<TeamId, TeamStrength>();
  for (const { tier, model } of feeders) {
    const scale = tierStrength(tier);
    for (const [id, s] of model.strengths) {
      if (!strengths.has(id)) strengths.set(id, { attack: s.attack * scale.attack, defence: s.defence * scale.defence });
    }
  }
  return strengths;
}

export function buildCupModel(feeders: readonly FeederModel[]): LeagueModel {
  return { avgHomeGoals: CUP_AVG_HOME_GOALS, avgAwayGoals: CUP_AVG_AWAY_GOALS, strengths: buildCupStrengths(feeders) };
}

/** A model whose missing clubs are non-league sides rather than average ones. */
export function cupModelFor(strengths: ReadonlyMap<TeamId, TeamStrength>, clubs: Iterable<TeamId>): LeagueModel {
  const all = new Map(strengths);
  const nonLeague = tierStrength(NON_LEAGUE_TIER);
  for (const id of clubs) if (!all.has(id)) all.set(id, nonLeague);
  return { avgHomeGoals: CUP_AVG_HOME_GOALS, avgAwayGoals: CUP_AVG_AWAY_GOALS, strengths: all };
}
