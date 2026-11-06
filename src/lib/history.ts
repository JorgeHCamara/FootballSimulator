import type { CompetitionCode } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import data from "../data/history.json" with { type: "json" };

/*
 * Past final tables of the leagues whose table decides the champion, for the
 * quiz (src/lib/quiz.ts): from ESPN's official standings, built by
 * scripts/build-history.ts (`npm run history`) into src/data/history.json.
 */

/** The leagues with a history: one table decides the champion (not a play-off, nor several tournaments a year). */
export const HISTORY_LEAGUES = ["PL", "ELC", "PD", "BL1", "SA", "FL1", "PPL", "DED", "BSA"] as const satisfies readonly CompetitionCode[];
export type HistoryLeague = (typeof HISTORY_LEAGUES)[number];

/** One finished season: its final table, in order. */
export interface HistorySeason {
  /** The year it started (2023 = 2023/24). */
  year: number;
  /** "2023/24", or "2024" for a calendar-year season. */
  label: string;
  /** Club id, name and points, from 1st to last. */
  table: [TeamId, string, number][];
  /** The clubs relegated directly (not through a play-off). */
  relegated: TeamId[];
  /** The champion: the table's leader, or none when no title was awarded (the 2019/20 Eredivisie). */
  champion: TeamId | null;
}

export interface HistoryFile {
  leagues: Partial<Record<HistoryLeague, HistorySeason[]>>;
}

/** The checked-in history. */
export const HISTORY = data as unknown as HistoryFile;
