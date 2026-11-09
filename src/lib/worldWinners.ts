/**
 * My World's Past Winners: a league's real history (src/lib/winners.ts) with
 * the world's own finished seasons on top, newest first. The world records each
 * finished season's top three (World.winners, written when a season is ended by
 * playSeason); the current season joins once it's ended.
 */

import { divisionConfig, divisionCountry, type DivisionCode, type World, type WorldPodium } from "./myWorld.ts";
import { CUPS } from "../config/cups.ts";
import type { WinnerClub, WinnerRow } from "./winners.ts";
import { CALENDAR_YEAR, cupCountry, type WorldCupCode } from "./worldCountries.ts";

/** A world season's label in the history files' style: 2026 → "2026-27", or "2026" for a calendar-year country (Brazil). */
export const historySeason = (year: number, calendar = false) => (calendar ? String(year) : `${year}-${String((year + 1) % 100).padStart(2, "0")}`);

/** The world's finished seasons of one league as Past Winners rows, newest first, under the competition's current name. */
export function worldRows(world: World, code: DivisionCode, competition: string): WinnerRow[] {
  // A final's clubs (Argentina's leagues) show no points: the title wasn't won on them.
  const club = ([id, name, points]: WorldPodium, final = false): WinnerClub => {
    const c = world.clubs[id];
    return {
      // A real club's world titles add to its real ones; a fictional club's are its own.
      key: c?.realId !== undefined ? `espn:${c.realId}` : `world:${id}`,
      id,
      name,
      currentName: c?.name ?? name,
      crest: c?.crest ?? null,
      tla: c?.tla ?? null,
      points: final ? null : points,
    };
  };
  const calendar = CALENDAR_YEAR.includes(divisionCountry(code));
  // A season of two tournaments (the Liga Profesional): the Clausura's row first, as the newest.
  const order = (w: { tournament?: string }) => (w.tournament === "clausura" ? 0 : 1);
  return (world.winners ?? [])
    .filter((w) => w.code === code)
    .sort((a, b) => b.year - a.year || order(a) - order(b))
    .map((w) => ({
      id: `world-${w.year}${w.tournament ? `-${w.tournament}` : ""}`,
      season: historySeason(w.year, calendar),
      startYear: w.year,
      endYear: calendar ? w.year : w.year + 1,
      // The tournament's name (PastWinners.tournaments: "Apertura", "Clausura").
      tournament: w.tournament ? w.tournament.charAt(0).toUpperCase() + w.tournament.slice(1) : null,
      status: "completed",
      competition,
      // Decided by a final (Argentina's leagues): its winner and runner-up.
      format: w.final ? "final" : "league",
      notes: [],
      champion: w.top[0] ? club(w.top[0], w.final) : null,
      runnerUp: w.top[1] ? club(w.top[1], w.final) : null,
      third: w.final ? null : w.top[2] ? club(w.top[2]) : null,
      world: true,
    }));
}

/** A league's Past Winners in a world: the world's seasons, newest first, then the real history (none yet for some leagues). */
export function worldWinners(world: World, code: DivisionCode, real: readonly WinnerRow[] | null): WinnerRow[] {
  const competition = real?.[0]?.competition ?? divisionConfig(code).name;
  return [...worldRows(world, code, competition), ...(real ?? [])];
}

/**
 * A cup's Past Winners in a world: its finished seasons, newest first, each
 * final's winner and runner-up (a cup has no third place). Calendar-year
 * countries' cups (the Copa do Brasil) are labelled by their year. No cup has
 * a real history yet.
 */
export function worldCupWinners(world: World, code: WorldCupCode): WinnerRow[] {
  const calendar = CALENDAR_YEAR.includes(cupCountry(code));
  const competition = CUPS.find((c) => c.code === code)?.name ?? code;
  const club = (id: number): WinnerClub => {
    const c = world.clubs[id];
    return { key: c?.realId !== undefined ? `espn:${c.realId}` : `world:${id}`, id, name: c?.name ?? String(id), currentName: c?.name ?? String(id), crest: c?.crest ?? null, tla: c?.tla ?? null, points: null };
  };
  return world.history
    .flatMap((record) => (record.cups ?? []).filter((cup) => cup.code === code).map((cup) => ({ year: record.year, final: cup.final })))
    .sort((a, b) => b.year - a.year)
    .map(({ year, final }) => ({
      id: `world-${year}`,
      season: historySeason(year, calendar),
      startYear: year,
      endYear: calendar ? year : year + 1,
      tournament: null,
      status: "completed",
      competition,
      format: "final",
      notes: [],
      champion: club(final[0]),
      runnerUp: club(final[1]),
      third: null,
      world: true,
    }));
}
