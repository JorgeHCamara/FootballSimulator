"use client";

import { useTranslations } from "next-intl";
import { zoneForPosition, type LeagueConfig, type Zone } from "../config/leagues.ts";
import type { FormResult, StandingRow, Team, TeamId } from "../engine/types.ts";
import { TeamBadge } from "./TeamBadge.tsx";
import { ZONE_STYLES } from "./zones.ts";

const FORM_STYLES: Record<FormResult, string> = {
  W: "bg-pitch-500",
  D: "bg-zinc-400",
  L: "bg-red-500",
};

const RELEGATION = new Set(["relegation", "relegationPlayoff"]);

interface Props {
  league: LeagueConfig;
  rows: StandingRow[];
  teams: Map<TeamId, Team>;
  /**
   * Leagues with reserve sides: the position each club's zone is based on
   * (its rank among first teams), or null for a reserve side, which has none.
   */
  zonePositions?: Map<TeamId, number | null>;
  /** Clubs already in the first zone's competition by another route: shown in that zone, their places passed down. */
  qualified?: ReadonlySet<TeamId>;
  /** Note explaining `qualified` (replaces the reserve-side note). */
  qualifiedNote?: string;
  /** Points deducted by the league, by club (already taken off the points). */
  deductions?: Readonly<Record<TeamId, number>>;
  /** A split's group: the points each club carried over (already in the points), shown in their own column. */
  carried?: Readonly<Record<TeamId, number>>;
  /** A line under the table. */
  note?: string;
  /** Each club's zone, in place of its position's (a split's first phase: the group each club went into). */
  zoneByTeam?: ReadonlyMap<TeamId, Zone>;
}

export function StandingsTable({ league, rows, teams, zonePositions, qualified, qualifiedNote, deductions, carried, note, zoneByTeam }: Props) {
  const t = useTranslations("Simulator");
  const tz = useTranslations("Zones");
  const cell = "px-1.5 py-2 text-center tabular-nums";
  const optional = `${cell} hidden sm:table-cell`;

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm" data-testid="standings">
          <thead className="bg-zinc-100 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
            <tr>
              <th className="w-11 py-2 pl-3 text-left">{t("position")}</th>
              <th className="py-2 text-left">{t("team")}</th>
              <th className={cell}>{t("played")}</th>
              <th className={optional}>{t("won")}</th>
              <th className={optional}>{t("drawn")}</th>
              <th className={optional}>{t("lost")}</th>
              <th className={`${optional} md:table-cell`}>{t("goalsFor")}</th>
              <th className={`${optional} md:table-cell`}>{t("goalsAgainst")}</th>
              <th className={cell}>{t("goalDifference")}</th>
              {carried && (
                <th className={optional} title={t("carriedTitle")}>
                  {t("carried")}
                </th>
              )}
              <th className={`${cell} pr-2 font-semibold`}>{t("points")}</th>
              <th className="hidden py-2 pr-3 text-left lg:table-cell">{t("form")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const team = teams.get(row.teamId)!;
              // Relegation follows the real position (reserve sides go down too);
              // promotion places follow the rank among first teams.
              const real = zoneForPosition(league, row.position);
              const zonePosition = zonePositions ? zonePositions.get(row.teamId) : row.position;
              const isQualified = qualified?.has(row.teamId) ?? false;
              const reserve = zonePositions !== undefined && zonePosition === null && !isQualified;
              const zone = zoneByTeam
                ? zoneByTeam.get(row.teamId)
                : real && RELEGATION.has(real.kind)
                  ? real
                  : isQualified
                    ? league.zones[0]
                    : zonePosition != null
                      ? [zoneForPosition(league, zonePosition)].find((z) => z && !RELEGATION.has(z.kind))
                      : undefined;
              return (
                <tr
                  key={row.teamId}
                  data-testid="standings-row"
                  data-zone={zone?.kind ?? ""}
                  title={zone ? tz(zone.kind) : undefined}
                  className={`border-t border-zinc-200/70 dark:border-zinc-800 ${zone ? ZONE_STYLES[zone.kind].row : ""}`}
                >
                  <td className="py-2 pl-3 font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">{row.position}</td>
                  <td className="py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamBadge team={team} />
                      <span className="truncate font-medium sm:hidden">{team.shortName}</span>
                      <span className="hidden truncate font-medium sm:inline">{team.name}</span>
                      {reserve && (
                        <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300" title={t("reserveTeam")} data-testid="reserve-tag">
                          {t("reserveTag")}
                        </span>
                      )}
                      {isQualified && (
                        <span className="shrink-0 text-xs" title={qualifiedNote} aria-label={qualifiedNote} data-testid="qualified-tag">
                          🏆
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={cell}>{row.played}</td>
                  <td className={optional}>{row.won}</td>
                  <td className={optional}>{row.drawn}</td>
                  <td className={optional}>{row.lost}</td>
                  <td className={`${optional} md:table-cell`}>{row.goalsFor}</td>
                  <td className={`${optional} md:table-cell`}>{row.goalsAgainst}</td>
                  <td className={cell}>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                  {carried && (
                    <td className={`${optional} text-zinc-500`} data-testid="carried">
                      {carried[row.teamId] ?? 0}
                    </td>
                  )}
                  <td className={`${cell} pr-2 font-bold`} data-testid="points">
                    {row.points}
                    {deductions?.[row.teamId] ? (
                      <span className="ml-1 text-[10px] font-semibold text-red-600 dark:text-red-400" title={t("pointsDeducted", { points: deductions[row.teamId]! })} data-testid="deduction">
                        −{deductions[row.teamId]}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden py-2 pr-3 lg:table-cell">
                    <span className="flex gap-1">
                      {row.form.map((f, i) => (
                        <span key={i} title={f} className={`h-2.5 w-2.5 rounded-full ${FORM_STYLES[f]}`} />
                      ))}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul data-testid="zone-legend" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {league.zones.map((z) => (
          <li key={z.kind} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded-sm ring-1 ring-zinc-300 dark:ring-zinc-600 ${ZONE_STYLES[z.kind].row}`} />
            {tz(z.kind)}
          </li>
        ))}
      </ul>
      {note && (
        <p className="mt-1 text-xs text-zinc-500" data-testid="table-note">
          {note}
        </p>
      )}
      {qualifiedNote ? (
        <p className="mt-1 text-xs text-zinc-500" data-testid="qualified-note">
          {qualifiedNote}
        </p>
      ) : (
        zonePositions && <p className="mt-1 text-xs text-zinc-500">{t("reserveNote")}</p>
      )}
    </div>
  );
}
