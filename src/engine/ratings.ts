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
  /** Pseudo-games of prior evidence each team's rating is shrunk toward. */
  priorGames?: number;
  /** Pseudo-matches of prior evidence for the league goal averages. */
  priorMatches?: number;
  /** Long-run averages used as the prior for the league goal rates. */
  defaultHomeGoals?: number;
  defaultAwayGoals?: number;
  /** Optional starting strengths (e.g. last season); defaults to 1.0 for all teams. */
  priorStrengths?: ReadonlyMap<TeamId, TeamStrength>;
}

const DEFAULTS = {
  priorGames: 6,
  priorMatches: 30,
  defaultHomeGoals: 1.55,
  defaultAwayGoals: 1.25,
} as const;

/**
 * Estimates attack/defence strengths from played matches. Each team's raw ratio of
 * goals scored (conceded) to what an average team would have scored (conceded) in
 * the same home/away mix is shrunk toward the prior so early-season ratings stay sane.
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

  const acc = new Map<TeamId, { games: number; gf: number; ga: number; xgf: number; xga: number }>();
  for (const t of teams) acc.set(t.id, { games: 0, gf: 0, ga: 0, xgf: 0, xga: 0 });
  for (const f of fixtures) {
    const r = results[f.id];
    if (!r) continue;
    const h = acc.get(f.homeId);
    const a = acc.get(f.awayId);
    if (!h || !a) continue;
    h.games++;
    h.gf += r.home;
    h.ga += r.away;
    h.xgf += avgHomeGoals;
    h.xga += avgAwayGoals;
    a.games++;
    a.gf += r.away;
    a.ga += r.home;
    a.xgf += avgAwayGoals;
    a.xga += avgHomeGoals;
  }

  const strengths = new Map<TeamId, TeamStrength>();
  for (const t of teams) {
    const s = acc.get(t.id)!;
    const prior = options.priorStrengths?.get(t.id) ?? { attack: 1, defence: 1 };
    const rawAttack = s.xgf > 0 ? s.gf / s.xgf : prior.attack;
    const rawDefence = s.xga > 0 ? s.ga / s.xga : prior.defence;
    const w = s.games / (s.games + priorGames);
    strengths.set(t.id, {
      attack: w * rawAttack + (1 - w) * prior.attack,
      defence: w * rawDefence + (1 - w) * prior.defence,
    });
  }

  return { avgHomeGoals, avgAwayGoals, strengths };
}
