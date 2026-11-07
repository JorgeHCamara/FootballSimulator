/**
 * The Past Winners files (src/data/history/<league-slug>.json), read on the
 * server: one file per league, named by the league's slug, so adding a league's
 * history is adding its file. Every file is checked as it's read
 * (parseLeagueHistory), so a broken one fails the build and the tests. The rows
 * come with each club's badge as the site shows it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CREST_FALLBACKS } from "../config/crests.ts";
import type { LeagueConfig } from "../config/leagues.ts";
import { applyTeamOverrides } from "../config/teamOverrides.ts";
import { parseLeagueHistory, winnerRows, type LeagueHistory, type WinnerRow } from "./winners.ts";

export const HISTORY_DIR = join(process.cwd(), "src", "data", "history");

let files: Map<string, LeagueHistory> | undefined;
const rows = new Map<string, WinnerRow[]>();

function all(): Map<string, LeagueHistory> {
  if (!files) {
    const loaded = new Map<string, LeagueHistory>();
    for (const name of readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json")).sort()) {
      const history = parseLeagueHistory(JSON.parse(readFileSync(join(HISTORY_DIR, name), "utf8")), name);
      if (history.footsimuSlug !== name.slice(0, -".json".length)) throw new Error(`${name}: footsimuSlug must be the file's name`);
      loaded.set(history.footsimuSlug, history);
    }
    files = loaded;
  }
  return files;
}

/** The leagues with a history, by slug. */
export const historySlugs = (): string[] => [...all().keys()];

export const leagueHistory = (slug: string): LeagueHistory | undefined => all().get(slug);

export const hasPastWinners = (slug: string): boolean => all().has(slug);

export const espnCrest = (id: number) => `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;

/**
 * A club's badge as the site shows it elsewhere: a team override's crest, the
 * site's own file for a club ESPN has none for (CREST_FALLBACKS), else ESPN's
 * crest for the club's id. A club without an id has none (a shield is drawn).
 */
export function crestFor(id: number | null, name: string): string | null {
  if (id === null) return null;
  const [team] = applyTeamOverrides([{ id, name, shortName: name, tla: "" }]);
  return team?.crest ?? CREST_FALLBACKS[id] ?? espnCrest(id);
}

/** A league's Past Winners rows, newest first, with badges; undefined for a league without a history file. */
export function leagueWinners(slug: string): WinnerRow[] | undefined {
  const history = leagueHistory(slug);
  if (!history) return undefined;
  let out = rows.get(slug);
  if (!out) {
    out = winnerRows(history, crestFor);
    rows.set(slug, out);
  }
  return out;
}

export const pastWinnersPath = (league: Pick<LeagueConfig, "slug">) => `/${league.slug}/past-winners`;
