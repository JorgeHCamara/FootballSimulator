import { DOWN_FROM, MIN_GAMES, moved, PROMOTED, RELEGATED, round3, UP_FROM, type SeasonRatings } from "../engine/offseason.ts";
import { NO_DATA_PRIOR, type TeamStrength } from "../engine/ratings.ts";
import type { TeamId } from "../engine/types.ts";

/*
 * Between seasons in My World: how a club's rating carries into the next
 * season. Every club has a level, where it stands over the years
 * (World.levels, on its division's scale like its rating): its real rating
 * when the world starts, then settling a little each season towards how it
 * actually did (LEVEL_FOLLOW), so a club that keeps doing better than its
 * level becomes a better club, and one that keeps doing worse a lesser one.
 * A season's rating starts from the club's level, keeping only part of the
 * season just played (FORM_CARRY): a great or a terrible season leaves a mark,
 * but most of it fades, and a club returns to its level rather than drifting
 * away from it season after season. The site's real starting ratings keep
 * their own rule (src/engine/offseason.ts: each club's rating from last
 * season's results, regressed to average), whose promotion and relegation
 * values this one shares: a promoted club becomes a below-average one in its
 * new division, level and rating alike, a relegated club an above-average
 * one, and a club from a league the world doesn't play starts below average.
 *
 * In log terms, with s the season's rating from its results and L the level
 * before it: L' = (1 − LEVEL_FADE) × (L + LEVEL_FOLLOW × (s − L)), and the next
 * season's rating L' + FORM_CARRY × (s − L'). The season rating noise
 * (src/lib/seasonNoise.ts) is drawn fresh each season on top of the rating
 * and never carried.
 *
 * The values come from scripts/my-world-seasons.ts (`npm run world:seasons`),
 * which plays worlds of ten and thirty seasons from the live data: with them
 * the top-rated clubs at the start win about 75% of the next ten Premier
 * League titles and about 90% of La Liga's and the Bundesliga's, Real Madrid,
 * Barcelona and Bayern average a 2nd-place finish over those ten seasons, the
 * English big six finish outside the top six about one season in six and
 * outside the top ten about one in twenty and are never relegated, promoted
 * clubs go straight back down about a third of the time, and the spread of
 * the ratings stays where it starts over thirty seasons (without the fade it
 * widens season after season). With the real starting ratings' own rule
 * (75% of the difference from average kept, no level), the top three won
 * about 40% of the titles and Real Madrid's average finish slid from 2nd to
 * 9th within ten seasons.
 */

/** How much of a season's difference from its level a club's level takes on: the club settling into a new level, up or down. */
export const LEVEL_FOLLOW = 0.15;
/** How much of a season's difference from its (settled) level the next season's rating keeps: the rest of the season's form fades. */
export const FORM_CARRY = 0.5;
/** How much of its difference from the division's average a club's level loses each season: over generations, with nothing to show for it, a big club eases down. */
export const LEVEL_FADE = 0.01;

/** A club's attack and defence relative to its division, as the world saves them. */
export type Strength = [attack: number, defence: number];

const pow = (x: number, k: number) => Math.exp(k * Math.log(x));
/** `from` moved `k` of the way to `to`, in log terms. */
const towards = (from: TeamStrength, to: TeamStrength, k: number): TeamStrength => ({
  attack: from.attack * pow(to.attack / from.attack, k),
  defence: from.defence * pow(to.defence / from.defence, k),
});
const strength = (s: Strength): TeamStrength => ({ attack: s[0], defence: s[1] });
const AVERAGE: TeamStrength = { attack: 1, defence: 1 };

/** The strengths rescaled to average 1 (geometric mean), within [0.4, 2.5] and rounded, as the real starting ratings are. */
function normalised(list: readonly (readonly [TeamId, TeamStrength])[]): Map<TeamId, TeamStrength> {
  const mean = (k: keyof TeamStrength) => Math.exp(list.reduce((sum, [, s]) => sum + Math.log(s[k]), 0) / list.length);
  const ma = mean("attack");
  const md = mean("defence");
  const clamp = (x: number) => Math.min(2.5, Math.max(0.4, x));
  return new Map(list.map(([id, s]) => [id, { attack: round3(clamp(s.attack / ma)), defence: round3(clamp(s.defence / md)) }]));
}

/**
 * A division's clubs' ratings and levels for the next season, from the season
 * just played: `last` this division's ratings from its results, `lower` and
 * `upper` the neighbouring divisions' (for the clubs coming up and down),
 * `levels` every club's level before the season's end, each on the scale of
 * the division it played in. A club with fewer than MIN_GAMES games in a
 * season (a world started late in one, mostly) counts as having no season.
 */
export function nextSeason(
  clubs: readonly TeamId[],
  last: SeasonRatings,
  lower: SeasonRatings | null,
  upper: SeasonRatings | null,
  levels: Readonly<Record<number, Strength>>,
): { ratings: Map<TeamId, TeamStrength>; levels: Map<TeamId, TeamStrength> } {
  const known = (r: SeasonRatings | null, id: TeamId) => (r && (r.games.get(id) ?? 0) >= MIN_GAMES ? r.model.strengths.get(id) : undefined);
  const levelOf = (id: TeamId, fallback: TeamStrength) => (levels[id] ? strength(levels[id]!) : fallback);
  /** The club's level after a season it played at `season`, and its rating for the next one, on that division's scale. */
  const settled = (id: TeamId, season: TeamStrength) => {
    const level = towards(towards(levelOf(id, season), season, LEVEL_FOLLOW), AVERAGE, LEVEL_FADE);
    return { level, rating: towards(level, season, FORM_CARRY) };
  };
  const next = clubs.map((id): [TeamId, TeamStrength, TeamStrength] => {
    const same = known(last, id);
    if (same) {
      const s = settled(id, same);
      return [id, s.rating, s.level];
    }
    const below = known(lower, id);
    if (below) {
      const s = settled(id, below);
      return [id, moved(PROMOTED, UP_FROM, s.rating), moved(PROMOTED, UP_FROM, s.level)];
    }
    const above = known(upper, id);
    if (above) {
      const s = settled(id, above);
      return [id, moved(RELEGATED, DOWN_FROM, s.rating), moved(RELEGATED, DOWN_FROM, s.level)];
    }
    // Up from the league below the world's (or a club without a season): below average, at its old level if it had one here.
    return [id, NO_DATA_PRIOR, levelOf(id, NO_DATA_PRIOR)];
  });
  return { ratings: normalised(next.map(([id, rating]) => [id, rating])), levels: normalised(next.map(([id, , level]) => [id, level])) };
}
