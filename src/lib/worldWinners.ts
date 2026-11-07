/**
 * My World's Past Winners: a league's real history (src/lib/winners.ts) with
 * the world's own finished seasons on top, newest first. The world records each
 * finished season's top three (World.winners, written when a season is ended by
 * playSeason); the current season joins once it's ended.
 */

import { divisionConfig, type DivisionCode, type World, type WorldPodium } from "./myWorld.ts";
import type { WinnerClub, WinnerRow } from "./winners.ts";

/** A world season's label in the history files' style: 2026 → "2026-27". */
export const historySeason = (year: number) => `${year}-${String((year + 1) % 100).padStart(2, "0")}`;

/** The world's finished seasons of one league as Past Winners rows, newest first, under the competition's current name. */
export function worldRows(world: World, code: DivisionCode, competition: string): WinnerRow[] {
  const club = ([id, name, points]: WorldPodium): WinnerClub => {
    const c = world.clubs[id];
    return {
      // A real club's world titles add to its real ones; a fictional club's are its own.
      key: c?.realId !== undefined ? `espn:${c.realId}` : `world:${id}`,
      id,
      name,
      currentName: c?.name ?? name,
      crest: c?.crest ?? null,
      tla: c?.tla ?? null,
      points,
    };
  };
  return (world.winners ?? [])
    .filter((w) => w.code === code)
    .sort((a, b) => b.year - a.year)
    .map((w) => ({
      id: `world-${w.year}`,
      season: historySeason(w.year),
      startYear: w.year,
      endYear: w.year + 1,
      tournament: null,
      status: "completed",
      competition,
      format: "league",
      notes: [],
      champion: w.top[0] ? club(w.top[0]) : null,
      runnerUp: w.top[1] ? club(w.top[1]) : null,
      third: w.top[2] ? club(w.top[2]) : null,
      world: true,
    }));
}

/** A league's Past Winners in a world: the world's seasons, newest first, then the real history (none yet for some leagues). */
export function worldWinners(world: World, code: DivisionCode, real: readonly WinnerRow[] | null): WinnerRow[] {
  const competition = real?.[0]?.competition ?? divisionConfig(code).name;
  return [...worldRows(world, code, competition), ...(real ?? [])];
}
