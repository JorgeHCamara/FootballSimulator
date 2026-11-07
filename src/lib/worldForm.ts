import { sampleNormal } from "../engine/match.ts";
import { ratingNoiseSd } from "../engine/montecarlo.ts";
import type { LeagueModel, TeamStrength } from "../engine/ratings.ts";
import { createRng, type Rng } from "../engine/rng.ts";
import type { Team, TeamId } from "../engine/types.ts";
import type { DivisionSeason, World } from "./myWorld.ts";
import { SEASON_RATING_NOISE } from "./seasonNoise.ts";

/*
 * A My World season's form: what the leagues (src/lib/myWorld.ts) and the
 * cups (src/lib/worldCups.ts) share. Each club's rating takes the season
 * outlook's rating noise once per season, from the season's own random
 * stream, so a club plays the whole season, league and cups, on the same form.
 */

/** A season's own random stream: the same world and season always play out the same way. */
export const seasonRng = (world: Pick<World, "seed" | "year">, salt: number) =>
  createRng((world.seed ^ Math.imul(world.year + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);

/** A world's club as the engine's team. */
export const teamOf = (world: Pick<World, "clubs">, id: TeamId): Team => {
  const c = world.clubs[id]!;
  return { id, name: c.name, shortName: c.shortName, tla: c.tla, ...(c.crest ? { crest: c.crest } : {}) };
};

export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * A division's form this season: each club's rating with the season outlook's
 * rating noise (less for the games the season started with already played),
 * drawn once from the season's own random stream, so it is the same however
 * the season is played. `rng`: that stream, past the noise (playSeason draws
 * the rest of the season's games from it).
 */
export function divisionForm(world: World, d: DivisionSeason, index: number): { model: LeagueModel; rng: Rng } {
  const rng = seasonRng(world, index);
  const played = new Map<TeamId, number>();
  for (const g of d.games ?? []) if (g[4] !== null && g[5] !== null) for (const id of [g[2], g[3]]) played.set(id, (played.get(id) ?? 0) + 1);
  const strengths = new Map<TeamId, TeamStrength>();
  for (const id of d.clubs) {
    const [attack, defence] = world.ratings[id] ?? [1, 1];
    const sd = ratingNoiseSd(SEASON_RATING_NOISE.sd, SEASON_RATING_NOISE.k, played.get(id) ?? 0);
    strengths.set(id, { attack: attack * Math.exp(sd * sampleNormal(rng)), defence: defence * Math.exp(sd * sampleNormal(rng)) });
  }
  const p = world.params[d.code];
  return { model: { avgHomeGoals: p.avgHomeGoals, avgAwayGoals: p.avgAwayGoals, strengths, ...(p.rho ? { rho: p.rho } : {}) }, rng };
}

/** Every league club's form this season (divisionForm), with its division's tier (0 the top division), for the cups' model. */
export function seasonStrengths(world: World): Map<TeamId, TeamStrength & { tier: number }> {
  const out = new Map<TeamId, TeamStrength & { tier: number }>();
  world.divisions.forEach((d, tier) => {
    for (const [id, s] of divisionForm(world, d, tier).model.strengths) out.set(id, { attack: s.attack, defence: s.defence, tier });
  });
  return out;
}
