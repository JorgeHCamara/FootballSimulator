"use client";

import { useTranslations } from "next-intl";
import { zoneForPosition, type LeagueConfig } from "../config/leagues.ts";
import type { FormResult, StandingRow, Team, TeamId } from "../engine/types.ts";
import { TeamBadge } from "./TeamBadge.tsx";
import { ZONE_STYLES } from "./zones.ts";

const FORM_STYLES: Record<FormResult, string> = {
  W: "bg-pitch-500",
  D: "bg-zinc-400",
  L: "bg-red-500",
};

interface Props {
  league: LeagueConfig;
  rows: StandingRow[];
  teams: Map<TeamId, Team>;
  /** Points each team had before the user's predictions, to highlight changes. */
  basePoints: Map<TeamId, number>;
}

export function StandingsTable({ league, rows, teams, basePoints }: Props) {
  const t = useTranslations("Simulator");
  const tz = useTranslations("Zones");
  const cell = "px-1.5 py-2 text-center tabular-nums";
  const optional = `${cell} hidden sm:table-cell`;

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm" data-testid="standings">
          <thead className="bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
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
              <th className={`${cell} pr-2 font-semibold`}>{t("points")}</th>
              <th className="hidden py-2 pr-3 text-left lg:table-cell">{t("form")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const team = teams.get(row.teamId)!;
              const zone = zoneForPosition(league, row.position);
              const delta = row.points - (basePoints.get(row.teamId) ?? row.points);
              return (
                <tr
                  key={row.teamId}
                  data-testid="standings-row"
                  data-zone={zone?.kind ?? ""}
                  className="border-t border-zinc-100 dark:border-zinc-800"
                >
                  <td
                    className="py-1.5 pl-2"
                    style={zone ? { boxShadow: `inset 4px 0 0 ${ZONE_STYLES[zone.kind].color}` } : undefined}
                  >
                    <span
                      title={zone ? tz(zone.kind) : undefined}
                      aria-label={zone ? `${row.position} · ${tz(zone.kind)}` : undefined}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold tabular-nums ${
                        zone ? ZONE_STYLES[zone.kind].dot : "text-zinc-500"
                      }`}
                    >
                      {row.position}
                    </span>
                  </td>
                  <td className="py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamBadge team={team} />
                      <span className="truncate font-medium sm:hidden">{team.shortName}</span>
                      <span className="hidden truncate font-medium sm:inline">{team.name}</span>
                    </span>
                  </td>
                  <td className={cell}>{row.played}</td>
                  <td className={optional}>{row.won}</td>
                  <td className={optional}>{row.drawn}</td>
                  <td className={optional}>{row.lost}</td>
                  <td className={`${optional} md:table-cell`}>{row.goalsFor}</td>
                  <td className={`${optional} md:table-cell`}>{row.goalsAgainst}</td>
                  <td className={cell}>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                  <td className={`${cell} pr-2 font-bold`} data-testid="points">
                    {row.points}
                    {delta > 0 && <span className="ml-1 text-[10px] font-semibold text-pitch-600">+{delta}</span>}
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
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {league.zones.map((z) => (
          <li key={z.kind} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${ZONE_STYLES[z.kind].dot}`} />
            {tz(z.kind)}
          </li>
        ))}
      </ul>
    </div>
  );
}
