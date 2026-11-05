import type { LeagueConfig, SiteLocale, ZoneKind } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import type { LeagueOutlook } from "./clubOutlook.ts";
import type { LeagueData } from "./leagueData.ts";
import { readSnapshots, seasonReports } from "./oddsReports.ts";
import { sharedLeagueOutlook } from "./sharedOutlook.ts";
import { SIM_VERSION } from "./simVersion.ts";
import { snapshotModel, type OddsSnapshot } from "./snapshots.ts";

/*
 * The projected final table: the most likely final table (each club its own
 * place, see mostLikelyPlaces) now, and after each completed round of the
 * season from the odds snapshots, so the page can show how it has changed.
 */

/** A club in one projected table. */
export interface ProjectedClub {
  /** Its place in the most likely final table, and its chance of that place. */
  place: number;
  chance?: number;
  /** Its place and points in the table then. */
  position: number;
  points: number;
  /** Its average final points over the simulated seasons. */
  averagePoints: number;
}

/** The projection after a round (or now, with a round under way). */
export interface ProjectedEntry {
  /** The round just completed (none: the latest, after games since the last completed round). */
  round?: number;
  /** That round's last day ("2026-11-02"), when it's a completed round. */
  date?: string;
  played: number;
  teams: Record<string, ProjectedClub>;
  /** Worked out with another model than the entry before: places moved with the model as well as the results. */
  modelChange?: true;
}

export interface ProjectedHistory {
  /** Places over the whole table, within each conference, or in the annual table. */
  scope: OddsSnapshot["scope"];
  /** The separate tables: one, or one per conference (MLS), each with its clubs. */
  tables: { id: string; name?: Record<SiteLocale, string>; teamIds: TeamId[] }[];
  /** Oldest first; the last one is the latest. */
  entries: ProjectedEntry[];
  /** The places the league's config lists (colours), title aside. */
  zones: { kind: ZoneKind; from: number; to: number }[];
  iterations: number;
}

/**
 * The history from the season's snapshots (those with projected places) and
 * the outlook now, which is added when games have been played since the last
 * completed round (or there's no snapshot yet). Undefined without either.
 */
export function buildProjectedHistory(
  snapshots: readonly OddsSnapshot[],
  now: { played: number; scope: OddsSnapshot["scope"]; iterations: number; teams: Record<string, ProjectedClub> } | undefined,
  groups: ProjectedHistory["tables"] | undefined,
  zones: ProjectedHistory["zones"],
): ProjectedHistory | undefined {
  const kept = snapshots.filter((s) => Object.values(s.teams).every((t) => t.projected !== undefined));
  // Each entry's model: its snapshot's, and today's for the outlook now.
  const models = kept.map(snapshotModel);
  const entries: ProjectedEntry[] = kept
    .map((s) => ({
      round: s.round,
      date: s.date,
      played: s.played,
      teams: Object.fromEntries(
        Object.entries(s.teams).map(([id, t]) => [
          id,
          { place: t.projected!, ...(t.projectedChance !== undefined ? { chance: t.projectedChance } : {}), position: t.position, points: t.points, averagePoints: t.averagePoints },
        ]),
      ),
    }));
  if (now && (!entries.length || now.played > entries.at(-1)!.played)) {
    entries.push({ played: now.played, teams: now.teams });
    models.push(SIM_VERSION);
  }
  if (!entries.length) return undefined;
  entries.forEach((e, i) => {
    if (i > 0 && models[i] !== models[i - 1]) e.modelChange = true;
  });
  const ids = [...new Set(entries.flatMap((e) => Object.keys(e.teams)))].map(Number);
  const tables = groups?.length
    ? groups.map((g) => ({ ...g, teamIds: g.teamIds.filter((id) => ids.includes(id)) })).filter((g) => g.teamIds.length)
    : [{ id: "table", teamIds: ids }];
  return {
    scope: now?.scope ?? snapshots.at(-1)?.scope ?? "table",
    tables,
    entries,
    zones,
    iterations: now?.iterations ?? snapshots.at(-1)?.iterations ?? 0,
  };
}

/** The outlook's clubs as a projection. */
function fromOutlook(outlook: LeagueOutlook): Record<string, ProjectedClub> {
  return Object.fromEntries(
    [...outlook.clubs.values()].map((c) => [
      String(c.team.id),
      { place: c.likeliest.position, chance: c.likeliest.chance, position: c.row.position, points: c.row.points, averagePoints: c.averagePoints },
    ]),
  );
}

/** A domestic league's projected table now and after each round of its current season (undefined: none to show). */
export async function projectedHistory(league: LeagueConfig, data: LeagueData): Promise<ProjectedHistory | undefined> {
  const [file, outlook] = await Promise.all([readSnapshots(league.code), sharedLeagueOutlook(league, data)]);
  const season = seasonReports(file, data.seasonKey);
  const snapshots = season?.seasonKey === data.seasonKey ? season.snapshots : [];
  const first = outlook?.clubs.values().next().value;
  const zones = (first?.zones ?? []).filter((z) => z.kind !== "title").flatMap((z) => z.ranges.map(([from, to]) => ({ kind: z.kind, from, to })));
  const groups =
    (outlook?.scope ?? snapshots.at(-1)?.scope) === "eachTable" && data.groups?.length
      ? data.groups.flatMap((g) => {
          const name = league.groups?.find((x) => x.id === g.id)?.name;
          return [{ id: g.id, ...(name ? { name } : {}), teamIds: g.teamIds }];
        })
      : undefined;
  const now = outlook
    ? { played: data.fixtures.filter((f) => f.result).length, scope: outlook.scope, iterations: outlook.iterations, teams: fromOutlook(outlook) }
    : undefined;
  return buildProjectedHistory(snapshots, now, groups, zones);
}
