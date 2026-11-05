import type { CompetitionCode } from "../config/leagues.ts";

/*
 * Expected goals (xG) per game, from ESPN's core API: each club's
 * "expectedGoals" in a game's team statistics. Stored per league in
 * src/data/xg/<CODE>.json (scripts/fetch-xg.ts), by ESPN game id: the home
 * and away xG, or null when ESPN has none for the game (a missing value is
 * never a 0). Only some competitions have it, and only from the 2026 seasons
 * (see XG_LEAGUES).
 */

/** Competitions whose games ESPN gives xG for (checked game by game: the others return nothing, or 0–0 placeholders). */
export const XG_LEAGUES: readonly CompetitionCode[] = ["PL", "ELC", "PD", "BL1", "SA", "FL1", "BSA", "MLS", "ARG", "MX", "UCL", "UEL", "UECL", "LIB"];

/** A game's xG, home first. */
export type GameXg = readonly [number, number];

export interface XgFile {
  league: CompetitionCode;
  /** By ESPN game id: the xG, or null when ESPN has none. */
  matches: Record<string, GameXg | null>;
}

/** A game's xG from its home side's statistics (its xG, and the xG it conceded: the away side's), or null when there's none. */
export function xgFromStats(stats: { splits?: { categories?: { name: string; stats?: { name: string; value?: number }[] }[] } }): GameXg | null {
  const get = (category: string, name: string) => stats.splits?.categories?.find((c) => c.name === category)?.stats?.find((s) => s.name === name)?.value;
  const home = get("offensive", "expectedGoals");
  const away = get("goalKeeping", "expectedGoalsConceded");
  if (typeof home !== "number" || typeof away !== "number" || !Number.isFinite(home) || !Number.isFinite(away)) return null;
  // Some leagues list the stat as 0 for both sides when they don't track it: no data, not a goalless game.
  if (home === 0 && away === 0) return null;
  return [Math.round(home * 1000) / 1000, Math.round(away * 1000) / 1000];
}

/** The games' xG by fixture id (ESPN ids), leaving out games without it. */
export function xgByFixture(file: XgFile | undefined): Record<number, GameXg> {
  const out: Record<number, GameXg> = {};
  for (const [id, xg] of Object.entries(file?.matches ?? {})) if (xg) out[Number(id)] = xg;
  return out;
}

/** One game per line, so each run's additions are short diffs. */
export function formatXgFile(file: XgFile): string {
  const ids = Object.keys(file.matches).sort((a, b) => Number(a) - Number(b));
  const lines = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(file.matches[id])}`);
  return `{\n  "league": ${JSON.stringify(file.league)},\n  "matches": {\n${lines.join(",\n")}\n  }\n}\n`;
}
