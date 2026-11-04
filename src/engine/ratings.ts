import { sortFixtures } from "./standings.ts";
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
  /** Dixon–Coles dependence for low scores (negative: more 0–0 and 1–1); 0 = independent Poisson. */
  rho?: number;
  /** Each club's home/away split relative to the league's (1 = the league's home advantage); see match.ts. */
  homeFactor?: ReadonlyMap<TeamId, number>;
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
  /**
   * Starting strength of a club missing from `priorStrengths` (a domestic
   * league: a club with no data, see NO_DATA_PRIOR); defaults to average.
   */
  missingPrior?: TeamStrength;
  /** Passes of the opponent adjustment (0: raw goal ratios). */
  iterations?: number;
  /** Dixon–Coles rho for the model's score distribution (see match.ts). */
  rho?: number;
  /** Clubs' home/away splits (see LeagueModel.homeFactor), also used when fitting the ratings. */
  homeFactor?: ReadonlyMap<TeamId, number>;
  /**
   * Recent form counts more: a game's weight halves every `halfLife` games
   * the club has played since. Infinity (the default) weighs every game the same.
   */
  halfLife?: number;
  /**
   * With decay, the weighted games a rating stands on never count for less
   * than this many (or all the club's games, if fewer), so the prior doesn't
   * swamp a short season and a short streak can't stand in for a season.
   */
  minEffectiveGames?: number;
}

/** Recent-form weight of a game `age` games ago. */
export function decayWeight(age: number, halfLife: number): number {
  return Number.isFinite(halfLife) ? Math.exp((-Math.LN2 * age) / halfLife) : 1;
}

/** Default floor of a decayed rating's weighted games (see ModelOptions.minEffectiveGames). */
export const MIN_EFFECTIVE_GAMES = 5;

/*
 * Match-model switches, set by the backtest (scripts/backtest.ts, last season
 * of the Premier League, La Liga, Serie A and the Brasileirão: README):
 * - Dixon–Coles score distribution, rho per league from the priors: on (a
 *   slightly better log-loss and Brier score, and a draw rate close to the real one);
 * - team-specific home advantage: off (worse in all four leagues);
 * - recency weighting: off (every half-life from 6 to 40 games scored worse).
 */
export const DIXON_COLES = true;
export const TEAM_HOME_ADVANTAGE = false;
/** Games for a rating's weight to halve (Infinity: every game the same); see ModelOptions.halfLife. */
export const RATING_HALF_LIFE = Infinity;

/** A league's match parameters, as plain data (server to browser): rho and clubs' home splits. */
export interface MatchParams {
  rho?: number;
  homeFactor?: Record<number, number>;
}

/** Model options from match parameters. */
export function matchParamOptions(params: MatchParams | undefined): Pick<ModelOptions, "rho" | "homeFactor"> {
  return {
    ...(params?.rho ? { rho: params.rho } : {}),
    ...(params?.homeFactor ? { homeFactor: new Map(Object.entries(params.homeFactor).map(([id, k]) => [Number(id), k])) } : {}),
  };
}

/** A league's recency half-life: its own setting, else the global one. */
export function ratingHalfLife(league: { ratingHalfLife?: number }): number {
  return league.ratingHalfLife ?? RATING_HALF_LIFE;
}

/** Domestic leagues: last season's ratings count for this many games of this season's. */
export const DOMESTIC_PRIOR_GAMES = 18;

/**
 * A domestic club without last season's data (it came up from a league the
 * site doesn't cover): below average. scripts/build-priors.ts uses the same.
 */
export const NO_DATA_PRIOR: TeamStrength = { attack: 0.85, defence: 1.15 };

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

  // Each team's games in order: where it played, the goals, the opponent and
  // (with decay) its weight, by how many games the team has played since.
  const games = new Map<TeamId, { home: boolean; gf: number; ga: number; opponent: TeamId; weight: number }[]>();
  for (const t of teams) games.set(t.id, []);
  for (const f of sortFixtures(fixtures)) {
    const r = results[f.id];
    if (!r) continue;
    const h = games.get(f.homeId);
    const a = games.get(f.awayId);
    if (!h || !a) continue;
    h.push({ home: true, gf: r.home, ga: r.away, opponent: f.awayId, weight: 1 });
    a.push({ home: false, gf: r.away, ga: r.home, opponent: f.homeId, weight: 1 });
  }
  const halfLife = options.halfLife ?? Infinity;
  const minEffective = options.minEffectiveGames ?? MIN_EFFECTIVE_GAMES;
  /** Weighted games each club's rating stands on (the plain count without decay). */
  const effective = new Map<TeamId, number>();
  for (const [id, own] of games) {
    own.forEach((g, i) => (g.weight = decayWeight(own.length - 1 - i, halfLife)));
    const sum = own.reduce((total, g) => total + g.weight, 0);
    effective.set(id, Number.isFinite(halfLife) ? Math.max(sum, Math.min(own.length, minEffective)) : own.length);
  }
  const k4 = (id: TeamId) => Math.pow(options.homeFactor?.get(id) ?? 1, 0.25);

  const neutral = { attack: 1, defence: 1 };
  const priorOf = (id: TeamId) => options.priorStrengths?.get(id) ?? (options.priorStrengths ? (options.missingPrior ?? neutral) : neutral);
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
        // Both clubs' home/away splits, as in expectedGoals.
        const venue = k4(t.id) * k4(g.opponent);
        const v = g.home ? venue : 1 / venue;
        gf += g.weight * g.gf;
        ga += g.weight * g.ga;
        xgf += g.weight * (g.home ? avgHomeGoals : avgAwayGoals) * opp.defence * v;
        xga += (g.weight * (g.home ? avgAwayGoals : avgHomeGoals) * opp.attack) / v;
      }
      const prior = priorOf(t.id);
      const n = effective.get(t.id)!;
      const w = n / (n + priorGames);
      next.set(t.id, {
        attack: w * (xgf > 0 ? gf / xgf : prior.attack) + (1 - w) * prior.attack,
        defence: w * (xga > 0 ? ga / xga : prior.defence) + (1 - w) * prior.defence,
      });
    }
    strengths = normalised(next);
  }

  return {
    avgHomeGoals,
    avgAwayGoals,
    strengths,
    ...(options.rho ? { rho: options.rho } : {}),
    ...(options.homeFactor?.size ? { homeFactor: options.homeFactor } : {}),
  };
}

/**
 * Rescales attack and defence so each averages 1.0 across the league: the
 * league's goal rates carry the overall level, the strengths only who is
 * better than whom, and the passes of the opponent adjustment can't drift.
 */
function normalised(strengths: ReadonlyMap<TeamId, TeamStrength>): Map<TeamId, TeamStrength> {
  if (strengths.size === 0) return new Map(strengths);
  let attack = 0;
  let defence = 0;
  for (const s of strengths.values()) {
    attack += s.attack;
    defence += s.defence;
  }
  const ma = attack / strengths.size;
  const md = defence / strengths.size;
  if (!(ma > 0 && md > 0)) return new Map(strengths);
  return new Map([...strengths].map(([id, s]) => [id, { attack: s.attack / ma, defence: s.defence / md }]));
}
