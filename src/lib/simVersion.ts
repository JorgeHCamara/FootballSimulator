/**
 * The season simulation's version: part of the cache keys of its results that
 * outlive a deployment (the match page's "What this result means", kept in
 * Next's data cache). Bump it whenever the same data would give other numbers:
 * the Monte Carlo (src/engine/montecarlo.ts and what it calls: the score
 * model, the standings), the impact maths (src/lib/matchImpact.ts,
 * resultScenarios / outlookWithResults in src/lib/clubOutlook.ts), the rating
 * defaults (src/engine/ratings.ts, the per-league rating options in
 * src/config/leagues.ts) or the starting ratings (a rebuilt src/data/priors).
 * New results and xG need no bump: the league's data version and its xG
 * file's fingerprint are in the keys too.
 */
export const SIM_VERSION = "1";
