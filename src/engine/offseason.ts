import { buildLeagueModel, NO_DATA_PRIOR, type LeagueModel, type TeamStrength } from "./ratings.ts";
import type { Fixture, ResultMap, Team, TeamId } from "./types.ts";

/*
 * Between seasons: how a club's rating carries into the next season. The real
 * site's starting ratings are built this way from last season's results
 * (scripts/build-priors.ts, src/data/priors), and the My World mode carries its
 * simulated seasons the same way (src/lib/myWorld.ts). Changing a value here
 * changes the next priors build too.
 */

/** How much of last season's difference from average a club keeps (in log terms). */
export const CARRY = 0.75;
/** A promoted club: typical rating of a club coming up, and of a club going down. */
export const PROMOTED: TeamStrength = { attack: 0.8, defence: 1.25 };
export const RELEGATED: TeamStrength = { attack: 1.2, defence: 0.82 };
/** Typical ratings of those clubs in the league they leave, to compare with. */
export const UP_FROM: TeamStrength = { attack: 1.3, defence: 0.75 };
export const DOWN_FROM: TeamStrength = { attack: 0.8, defence: 1.25 };
/** How much a club's rating in the other league moves it from the typical value. */
export const MOVE = 0.4;
/** Games a club needs last season for its rating to count. */
export const MIN_GAMES = 8;

/** One league's season: its clubs, games and results (and, where the ratings use it, each game's xG). */
export interface SeasonGames {
  teams: readonly Team[];
  fixtures: readonly Fixture[];
  results: ResultMap;
  xg?: Readonly<Record<number, readonly [number, number]>>;
}

/** A season's ratings and the games each club played. */
export interface SeasonRatings {
  model: LeagueModel;
  games: Map<number, number>;
}

const gamesPlayed = (season: SeasonGames) => {
  const games = new Map<number, number>();
  for (const f of season.fixtures) if (season.results[f.id]) for (const id of [f.homeId, f.awayId]) games.set(id, (games.get(id) ?? 0) + 1);
  return games;
};

/**
 * A season's opponent-adjusted ratings. With `halfLife`, its later games
 * count a bit more, so a club that finished strongly starts a bit higher.
 */
export function seasonRatings(season: SeasonGames, halfLife = Infinity, xgWeight = 0): SeasonRatings {
  const model = buildLeagueModel(season.teams, season.fixtures, season.results, { priorGames: 3, halfLife, minEffectiveGames: 0, ...(season.xg ? { xg: season.xg } : {}), xgWeight });
  return { model, games: gamesPlayed(season) };
}

const pow = (x: number, k: number) => Math.exp(k * Math.log(x));
const moved = (typical: TeamStrength, from: TeamStrength, s: TeamStrength): TeamStrength => ({
  attack: typical.attack * pow(s.attack / from.attack, MOVE),
  defence: typical.defence * pow(s.defence / from.defence, MOVE),
});
export const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Starting ratings of a season's clubs, from last season: returning clubs
 * keep most of their rating, promoted ones get their rating below turned
 * into a below-average one, relegated ones the reverse, others a
 * below-average default; rescaled to average 1 (geometric mean).
 */
export function clubPriors(clubs: readonly Pick<Team, "id">[], last: SeasonRatings | null, lower: SeasonRatings | null, upper: SeasonRatings | null) {
  const known = (r: SeasonRatings | null, id: number) => (r && (r.games.get(id) ?? 0) >= MIN_GAMES ? r.model.strengths.get(id) : undefined);
  const counts = { returning: 0, promoted: 0, relegated: 0, unknown: 0 };
  const raw = clubs.map((club) => {
    const same = known(last, club.id);
    if (same) {
      counts.returning++;
      return [club.id, { attack: pow(same.attack, CARRY), defence: pow(same.defence, CARRY) }] as const;
    }
    const below = known(lower, club.id);
    if (below) {
      counts.promoted++;
      return [club.id, moved(PROMOTED, UP_FROM, below)] as const;
    }
    const above = known(upper, club.id);
    if (above) {
      counts.relegated++;
      return [club.id, moved(RELEGATED, DOWN_FROM, above)] as const;
    }
    counts.unknown++;
    return [club.id, NO_DATA_PRIOR] as const;
  });
  const mean = (k: "attack" | "defence") => Math.exp(raw.reduce((sum, [, s]) => sum + Math.log(s[k]), 0) / raw.length);
  const ma = mean("attack");
  const md = mean("defence");
  const clamp = (x: number) => Math.min(2.5, Math.max(0.4, x));
  const strengths = new Map<TeamId, TeamStrength>(raw.map(([id, s]) => [id, { attack: round3(clamp(s.attack / ma)), defence: round3(clamp(s.defence / md)) }]));
  return { strengths, counts, returning: new Set(raw.filter(([id]) => known(last, id)).map(([id]) => id)) };
}
