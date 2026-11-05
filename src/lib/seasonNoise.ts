import type { LeagueConfig } from "../config/leagues.ts";
import type { MonteCarloInput } from "../engine/montecarlo.ts";

/**
 * Rating noise for the season outlook: every simulated season starts with
 * each club's attack and defence multiplied by exp(N(0, s)), s = sd × √(k /
 * (k + its games played)), so the chances allow for the ratings being only
 * estimates (most of all early in the season). See `ratingNoise` in
 * runMonteCarlo.
 *
 * sd 0.15, k 5: chosen by the season backtest's grid (roadmap item 3), sd in
 * {0.15, 0.2, 0.25, 0.3} × k in {5, 10, 20, 40} on the 2022–2025 seasons of
 * the ten leagues it loads (backtest-results/season-2022.json …
 * season-2025.json, pooled by `npm run backtest:season:tune -- 2022 2023 2024
 * 2025`). It is the only pair meeting the selection rule: pooled RPS 0.0926
 * against 0.0940 without noise, calibration error 0.0104 against 0.0174
 * (better at every checkpoint), title Brier +0.8% (the rule allows 1%), and a
 * better RPS than no noise in each of the four seasons.
 *
 * It feeds the season's chances only (the league page's Chances tab, club
 * pages, match impact, share cards, odds snapshots and the reports built on
 * them), never a single game's score probabilities (match previews) or the
 * dice. Changing it changes the outlook: bump SIM_VERSION (src/lib/simVersion.ts).
 */
export const SEASON_RATING_NOISE: NonNullable<MonteCarloInput["ratingNoise"]> = { sd: 0.15, k: 5 };

/**
 * A league's season-outlook rating noise: domestic leagues only. Continental
 * competitions (ratings from each club's domestic form, a handful of games
 * each) weren't part of the backtest, so they keep none.
 */
export function seasonRatingNoise(league: Pick<LeagueConfig, "continental">): MonteCarloInput["ratingNoise"] {
  return league.continental ? undefined : SEASON_RATING_NOISE;
}
