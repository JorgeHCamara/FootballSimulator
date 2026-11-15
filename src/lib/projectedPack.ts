import type { ProjectedClub, ProjectedEntry, ProjectedHistory } from "./projected.ts";

/*
 * The league page's projected table history as ProjectedTable (a client
 * component) gets it: every round's every club as an object with five named
 * keys was most of the section's RSC data. Packed, each club is a row of
 * numbers; unpacked once, in the browser and on the server alike, the entries
 * are exactly the objects they were (src/lib/projectedPack.test.ts).
 */

/** [club, place, chance (null: none), position, points, average points]. */
type ClubRow = readonly [number, number, number | null, number, number, number];

export interface PackedEntry {
  round?: number;
  date?: string;
  played: number;
  rows: ClubRow[];
  modelChange?: true;
}

export type PackedHistory = Omit<ProjectedHistory, "entries"> & { packed: 1; entries: PackedEntry[] };

export function packHistory(history: ProjectedHistory): PackedHistory {
  return {
    ...history,
    packed: 1,
    entries: history.entries.map(({ teams, ...entry }) => ({
      ...entry,
      rows: Object.entries(teams).map(([id, c]): ClubRow => [Number(id), c.place, c.chance ?? null, c.position, c.points, c.averagePoints]),
    })),
  };
}

const isPacked = (history: ProjectedHistory | PackedHistory): history is PackedHistory => (history as PackedHistory).packed === 1;

/** The history as objects (as it is when it wasn't packed). */
export function unpackHistory(history: ProjectedHistory | PackedHistory): ProjectedHistory {
  if (!isPacked(history)) return history;
  const { packed: _, entries, ...rest } = history;
  return {
    ...rest,
    entries: entries.map(({ rows, modelChange, ...entry }): ProjectedEntry => ({
      ...entry,
      teams: Object.fromEntries(
        rows.map(([id, place, chance, position, points, averagePoints]): [string, ProjectedClub] => [String(id), { place, ...(chance !== null ? { chance } : {}), position, points, averagePoints }]),
      ),
      ...(modelChange ? { modelChange } : {}),
    })),
  };
}
