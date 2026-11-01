"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { zoneForPosition, type LeagueConfig } from "../config/leagues.ts";
import { probabilityInRange, type MonteCarloInput, type MonteCarloResult } from "../engine/montecarlo.ts";
import type { StandingRow, Team, TeamId } from "../engine/types.ts";
import type { MonteCarloRequest, MonteCarloResponse } from "../workers/montecarlo.worker.ts";
import { TeamBadge } from "./TeamBadge.tsx";
import { ZONE_STYLES } from "./zones.ts";

export const ITERATIONS = 10_000;

/** Runs the Monte Carlo in a Web Worker, debounced, keeping only the latest answer. */
function useMonteCarlo(input: MonteCarloInput | null): MonteCarloResult | null {
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL("../workers/montecarlo.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<MonteCarloResponse>) => {
      if (e.data.id === latest.current) setResult(e.data.result);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    if (!input) return;
    const id = ++latest.current;
    setResult(null);
    const timer = setTimeout(() => {
      const request: MonteCarloRequest = { id, input };
      worker.current?.postMessage(request);
    }, 300);
    return () => clearTimeout(timer);
  }, [input]);

  return result;
}

interface Props {
  league: LeagueConfig;
  input: MonteCarloInput | null;
  rows: StandingRow[];
  teams: Map<TeamId, Team>;
}

export function ProbabilityGrid({ league, input, rows, teams }: Props) {
  const t = useTranslations("Simulator");
  const format = useFormatter();
  const result = useMonteCarlo(input);
  const relegation = league.zones.find((z) => z.kind === "relegation");
  // MLS: the chance of any playoff place, wild card included.
  const playoffZones = league.zones.filter((z) => z.kind === "playoffs" || z.kind === "playoffWildCard");
  const playoffs = playoffZones.length
    ? { from: Math.min(...playoffZones.map((z) => z.from)), to: Math.max(...playoffZones.map((z) => z.to)) }
    : undefined;
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
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-2 pl-3 text-left">{t("team")}</th>
              <th className="px-2 text-right">{t("averagePoints")}</th>
              {/* In a league of separate tables, 1st in a conference isn't the title. */}
              <th className="px-2 text-right">{league.groups ? t("firstPlaceChance") : t("titleChance")}</th>
              {playoffs && <th className="px-2 text-right">{t("playoffChance")}</th>}
              {relegation && <th className="px-2 text-right">{t("relegationChance")}</th>}
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
                  <td className="px-2 text-right font-semibold tabular-nums" data-testid="title-chance">
                    {pct(probabilityInRange(result, row.teamId, 1, 1))}
                  </td>
                  {playoffs && (
                    <td className="px-2 text-right tabular-nums text-blue-700 dark:text-blue-300" data-testid="playoff-chance">
                      {pct(probabilityInRange(result, row.teamId, playoffs.from, playoffs.to))}
                    </td>
                  )}
                  {relegation && (
                    <td className="px-2 text-right tabular-nums text-red-600 dark:text-red-400">
                      {pct(probabilityInRange(result, row.teamId, relegation.from, relegation.to))}
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
                            className={`h-5 w-4 rounded-[2px] ${zone ? ZONE_STYLES[zone.kind].dot : "bg-zinc-500"}`}
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
