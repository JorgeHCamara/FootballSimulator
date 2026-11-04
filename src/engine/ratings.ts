import type { Fixture, ResultMap, Team, TeamId } from "./types.ts";

/**
 * Multiplicative team strengths relative to the league average.
 * attack > 1 scores more than average; defence > 1 concedes more than average.
 */
export interface TeamStrength {
  attack: number;
  defence: number;
}

export interface LeagueModel {
  avgHomeGoals: number;
  avgAwayGoals: number;
  strengths: Map<TeamId, TeamStrength>;
}

export interface ModelOptions {
  /**
   * Pseudo-games of prior evidence each team's rating is shrunk toward: after
   * n games, this season's form weighs n / (n + priorGames).
   */
  priorGames?: number;
  /** Pseudo-matches of prior evidence for the league goal averages. */
  priorMatches?: number;
  /** Long-run averages used as the prior for the league goal rates. */
  defaultHomeGoals?: number;
  defaultAwayGoals?: number;
  /** Optional starting strengths (e.g. last season); defaults to 1.0 for all teams. */
  priorStrengths?: ReadonlyMap<TeamId, TeamStrength>;
  /** Passes of the opponent adjustment (0: raw goal ratios). */
  iterations?: number;
}

/** Domestic leagues: last season's ratings count for this many games of this season's. */
export const DOMESTIC_PRIOR_GAMES = 18;

const DEFAULTS = {
  priorGames: 6,
  iterations: 8,
  priorMatches: 30,
  defaultHomeGoals: 1.55,
  defaultAwayGoals: 1.25,
} as const;

/**
 * Estimates attack/defence strengths from played matches. Each team's ratio of
 * goals scored (conceded) to what it would have scored (conceded) against the
 * same opponents with an average attack and defence, in the same home/away mix,
 * is shrunk toward its prior so early-season ratings stay sane. The opponents'
 * strengths come from the previous pass, so scoring three against a strong
 * defence counts for more than three against a weak one.
 */
export function buildLeagueModel(
  teams: readonly Team[],
  fixtures: readonly Fixture[],
  results: ResultMap,
  options: ModelOptions = {},
): LeagueModel {
  const priorGames = options.priorGames ?? DEFAULTS.priorGames;
  const priorMatches = options.priorMatches ?? DEFAULTS.priorMatches;

  let homeGoals = 0;
  let awayGoals = 0;
  let played = 0;
  for (const f of fixtures) {
    const r = results[f.id];
    if (!r) continue;
    homeGoals += r.home;
    awayGoals += r.away;
    played++;
  }
  const avgHomeGoals =
    (homeGoals + priorMatches * (options.defaultHomeGoals ?? DEFAULTS.defaultHomeGoals)) /
    (played + priorMatches);
  const avgAwayGoals =
    (awayGoals + priorMatches * (options.defaultAwayGoals ?? DEFAULTS.defaultAwayGoals)) /
    (played + priorMatches);

  // Each team's games: where it played, the goals, and the opponent.
  const games = new Map<TeamId, { home: boolean; gf: number; ga: number; opponent: TeamId }[]>();
  for (const t of teams) games.set(t.id, []);
  for (const f of fixtures) {
    const r = results[f.id];
    if (!r) continue;
    const h = games.get(f.homeId);
    const a = games.get(f.awayId);
    if (!h || !a) continue;
    h.push({ home: true, gf: r.home, ga: r.away, opponent: f.awayId });
    a.push({ home: false, gf: r.away, ga: r.home, opponent: f.homeId });
  }

  const neutral = { attack: 1, defence: 1 };
  const priorOf = (id: TeamId) => options.priorStrengths?.get(id) ?? neutral;
  let strengths = new Map<TeamId, TeamStrength>(teams.map((t) => [t.id, priorOf(t.id)]));
  const iterations = Math.max(1, options.iterations ?? DEFAULTS.iterations);
  for (let pass = 0; pass < iterations; pass++) {
    // Pass 0 compares with average opponents (raw ratios); later passes with the opponents' ratings.
    const opponents = pass === 0 ? null : strengths;
    const next = new Map<TeamId, TeamStrength>();
    for (const t of teams) {
      const own = games.get(t.id)!;
      let gf = 0;
      let ga = 0;
      let xgf = 0;
      let xga = 0;
      for (const g of own) {
        const opp = opponents?.get(g.opponent) ?? neutral;
        gf += g.gf;
        ga += g.ga;
        xgf += (g.home ? avgHomeGoals : avgAwayGoals) * opp.defence;
        xga += (g.home ? avgAwayGoals : avgHomeGoals) * opp.attack;
      }
      const prior = priorOf(t.id);
      const w = own.length / (own.length + priorGames);
      next.set(t.id, {
        attack: w * (xgf > 0 ? gf / xgf : prior.attack) + (1 - w) * prior.attack,
        defence: w * (xga > 0 ? ga / xga : prior.defence) + (1 - w) * prior.defence,
      });
    }
    strengths = next;
  }

  return { avgHomeGoals, avgAwayGoals, strengths };
}
