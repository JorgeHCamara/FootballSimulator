"use client";

import { useFormatter, useTranslations } from "next-intl";
import { zoneForPosition, type LeagueConfig } from "../config/leagues.ts";
import { probabilityInRange, type MonteCarloInput } from "../engine/montecarlo.ts";
import type { StandingRow, Team, TeamId } from "../engine/types.ts";
import { TeamBadge } from "./TeamBadge.tsx";
import { ITERATIONS, useMonteCarlo } from "./useMonteCarlo.ts";
import { ZONE_STYLES } from "./zones.ts";
import { Icon } from "./Icon.tsx";

export { ITERATIONS };

interface Props {
  league: LeagueConfig;
  input: MonteCarloInput | null;
  rows: StandingRow[];
  teams: Map<TeamId, Team>;
}

export function ProbabilityGrid({ league, input, rows, teams }: Props) {
  const t = useTranslations("Simulator");
  const tz = useTranslations("Zones");
  const passDown = input?.passDown ? new Set(input.passDown) : undefined;
  const format = useFormatter();
  const result = useMonteCarlo(input);
  const relegation = league.zones.find((z) => z.kind === "relegation");
  // South American leagues: the Copa Libertadores and Sudamericana places
  // (positions among clubs not already qualified, when some pass down).
  const libertadores = league.zones.find((z) => z.kind === "libertadores");
  // Asian leagues: the AFC Champions League Elite places.
  const aclElite = league.zones.find((z) => z.kind === "aclElite");
  // Groups with their own places (Ecuador's split): 1st only matters in the title group.
  const groupZones = league.groups?.some((g) => g.zones) ?? false;
  const titleZone = league.zones.some((z) => z.kind === "title");
  const showFirst = !groupZones || titleZone;
  const sudamericana = league.zones.find((z) => z.kind === "sudamericana");
  // MLS: the chance of any playoff place, wild card included.
  const playoffZones = league.zones.filter((z) => z.kind === "playoffs" || z.kind === "playoffWildCard" || z.kind === "titlePlayoffs");
  const playoffs = playoffZones.length
    ? { from: Math.min(...playoffZones.map((z) => z.from)), to: Math.max(...playoffZones.map((z) => z.to)) }
    : undefined;
  // Continental competitions (UEFA): straight to the round of 16, into the knockout phase at all, and the knockout rounds.
  const top8 = league.zones.find((z) => z.kind === "knockoutRoundOf16");
  const knockout = league.zones.find((z) => z.kind === "knockoutPlayoff");
  const continental = Boolean(league.continental && top8);
  const positions = Array.from({ length: rows.length }, (_, i) => i + 1);
  const pct = (p: number) => (p === 0 ? "–" : p < 0.001 ? "<0.1%" : format.number(p, { style: "percent", maximumFractionDigits: p < 0.1 ? 1 : 0 }));

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="animate-pulse">{t("calculating")}</span>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" data-testid="chances">
      <p className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
        {t("basedOn", { count: format.number(result.iterations) })}
        {/* Domestic leagues rate clubs from this season's form and last season's results. */}
        {!league.continental && (
          <span className="block pt-0.5" data-testid="chances-note">
            {t("chancesEarlyNote")}
          </span>
        )}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-2 pl-3 text-left">{t("team")}</th>
              <th className="px-2 text-right">{t("averagePoints")}</th>
              {/* In a league of separate tables, or with a title play-off, 1st place isn't the title. */}
              {continental ? (
                <>
                  <th className="px-2 text-right">{t("topChance", { count: top8!.to })}</th>
                  {knockout && <th className="px-2 text-right">{t("topChance", { count: knockout.to })}</th>}
                  <th className="px-2 text-right">{t("finalChance")}</th>
                  <th className="px-2 text-right">{t("winChance")}</th>
                </>
              ) : showFirst ? (
                <th className="px-2 text-right">{(league.groups && !titleZone) || result.playoffWins ? t("firstPlaceChance") : t("titleChance")}</th>
              ) : null}
              {playoffs && <th className="px-2 text-right">{t("playoffChance")}</th>}
              {libertadores && <th className="px-2 text-right">{tz("libertadores")}</th>}
              {aclElite && <th className="px-2 text-right">{t("aclEliteChance")}</th>}
              {sudamericana && <th className="px-2 text-right">{tz("sudamericana")}</th>}
              {relegation && <th className="px-2 text-right">{t("relegationChance")}</th>}
              {/* A title play-off simulated with the table (Argentina): the chance of winning it. */}
              {!continental && result.playoffWins && <th className="px-2 text-right">{t("winChance")}</th>}
              <th className="hidden pr-3 pl-4 text-left md:table-cell">{t("positionHeatmap")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const team = teams.get(row.teamId)!;
              const counts = result.positionCounts[row.teamId] ?? [];
              return (
                <tr key={row.teamId} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5 pl-3">
                    <span className="flex items-center gap-2">
                      <TeamBadge team={team} />
                      <span className="truncate font-medium">{team.shortName}</span>
                    </span>
                  </td>
                  <td className="px-2 text-right tabular-nums">{result.averagePoints[row.teamId]!.toFixed(1)}</td>
                  {continental ? (
                    <>
                      <td className="px-2 text-right tabular-nums text-blue-700 dark:text-blue-300" data-testid="top8-chance">
                        {pct(probabilityInRange(result, row.teamId, top8!.from, top8!.to))}
                      </td>
                      {knockout && (
                        <td className="px-2 text-right tabular-nums" data-testid="top24-chance">
                          {pct(probabilityInRange(result, row.teamId, top8!.from, knockout.to))}
                        </td>
                      )}
                      <td className="px-2 text-right tabular-nums" data-testid="final-chance">
                        {pct((result.playoffReached?.[row.teamId]?.at(-1) ?? 0) / result.iterations)}
                      </td>
                      <td className="px-2 text-right font-semibold tabular-nums" data-testid="win-chance">
                        {pct((result.playoffWins?.[row.teamId] ?? 0) / result.iterations)}
                      </td>
                    </>
                  ) : showFirst ? (
                    <td className="px-2 text-right font-semibold tabular-nums" data-testid="title-chance">
                      {pct(probabilityInRange(result, row.teamId, 1, 1))}
                    </td>
                  ) : null}
                  {playoffs && (
                    <td className="px-2 text-right tabular-nums text-blue-700 dark:text-blue-300" data-testid="playoff-chance">
                      {pct(probabilityInRange(result, row.teamId, playoffs.from, playoffs.to))}
                    </td>
                  )}
                  {libertadores && (
                    <td className="px-2 text-right tabular-nums text-blue-700 dark:text-blue-300" data-testid="libertadores-chance">
                      {passDown?.has(row.teamId) ? <Icon name="check" size={14} strokeWidth={3} className="ml-auto" /> : pct(probabilityInRange(result, row.teamId, libertadores.from, libertadores.to, true))}
                    </td>
                  )}
                  {aclElite && (
                    <td className="px-2 text-right tabular-nums text-blue-700 dark:text-blue-300" data-testid="acl-chance">
                      {pct(probabilityInRange(result, row.teamId, aclElite.from, aclElite.to))}
                    </td>
                  )}
                  {sudamericana && (
                    <td className="px-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                      {passDown?.has(row.teamId) ? "–" : pct(probabilityInRange(result, row.teamId, sudamericana.from, sudamericana.to, true))}
                    </td>
                  )}
                  {relegation && (
                    <td className="px-2 text-right tabular-nums text-red-600 dark:text-red-400">
                      {pct(probabilityInRange(result, row.teamId, relegation.from, relegation.to))}
                    </td>
                  )}
                  {!continental && result.playoffWins && (
                    <td className="px-2 text-right font-semibold tabular-nums" data-testid="win-chance">
                      {pct((result.playoffWins[row.teamId] ?? 0) / result.iterations)}
                    </td>
                  )}
                  <td className="hidden py-1.5 pr-3 pl-4 md:table-cell">
                    <span className="flex gap-px">
                      {positions.map((p) => {
                        const share = (counts[p - 1] ?? 0) / result.iterations;
                        const zone = zoneForPosition(league, p);
                        return (
                          <span
                            key={p}
                            title={`${p}: ${pct(share)}`}
                            className={`h-5 ${rows.length > 24 ? "w-2.5" : "w-4"} rounded-[2px] ${zone ? ZONE_STYLES[zone.kind].dot : "bg-zinc-500"}`}
                            style={{ opacity: share === 0 ? 0.06 : 0.15 + 0.85 * Math.sqrt(share) }}
                          />
                        );
                      })}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
