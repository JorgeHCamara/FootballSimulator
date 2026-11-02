"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import type { CupConfig } from "../config/cups.ts";
import type { CompetitionCode } from "../config/leagues.ts";
import type { CupMonteCarloInput, CupMonteCarloResult } from "../engine/cupMontecarlo.ts";
import type { Team, TeamId } from "../engine/types.ts";
import { useDivisionTag } from "./CupRounds.tsx";
import { TeamBadge } from "./TeamBadge.tsx";
import { useMonteCarlo } from "./useMonteCarlo.ts";

const SHOWN = 24;

interface Props {
  cup: CupConfig;
  input: CupMonteCarloInput | null;
  teams: Map<TeamId, Team>;
  divisions: Record<TeamId, CompetitionCode>;
  /** Clubs not yet knocked out. */
  alive: readonly TeamId[];
  /** First round still to be decided: columns start after it. */
  fromRound: number;
}

/** Each club's chance of reaching every remaining round and of winning the cup. */
export function CupChances({ cup, input, teams, divisions, alive, fromRound }: Props) {
  const t = useTranslations("Cup");
  const ts = useTranslations("Simulator");
  const format = useFormatter();
  const tag = useDivisionTag(divisions, cup);
  const result: CupMonteCarloResult | null = useMonteCarlo(input, "cup");
  const [showAll, setShowAll] = useState(false);
  const pct = (p: number) => (p === 0 ? "–" : p < 0.001 ? "<0.1%" : format.number(p, { style: "percent", maximumFractionDigits: p < 0.1 ? 1 : 0 }));

  if (!result) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="animate-pulse">{ts("calculating")}</span>
      </div>
    );
  }

  const columns = cup.rounds.map((round, r) => ({ r, round })).filter(({ r }) => r > fromRound);
  const win = (id: TeamId) => (result.won[id] ?? 0) / result.iterations;
  const reach = (id: TeamId, r: number) => (result.reached[id]?.[r] ?? 0) / result.iterations;
  const rows = [...alive].sort((a, b) => win(b) - win(a) || reach(b, cup.rounds.length - 1) - reach(a, cup.rounds.length - 1));
  const shown = showAll ? rows : rows.slice(0, SHOWN);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" data-testid="cup-chances">
      <p className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
        {t("basedOn", { count: format.number(result.iterations) })} {t("chancesNote")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-2 pl-3 text-left">{ts("team")}</th>
              {columns.map(({ r, round }) => (
                <th key={round.key} className="px-2 text-right" title={t("reach", { round: t(`round.${round.key}`) })}>
                  {r === cup.rounds.length - 1 ? t("roundShort.final") : t(`roundShort.${round.key}`)}
                </th>
              ))}
              <th className="px-2 pr-3 text-right">{t("win")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((id) => {
              const team = teams.get(id);
              if (!team) return null;
              return (
                <tr key={id} className="border-t border-zinc-100 dark:border-zinc-800" data-testid="cup-chance-row">
                  <td className="py-1.5 pl-3">
                    <span className="flex items-center gap-2">
                      <TeamBadge team={team} />
                      <span className="truncate font-medium">{team.shortName}</span>
                      {tag(id) && <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">{tag(id)}</span>}
                    </span>
                  </td>
                  {columns.map(({ r, round }) => {
                    const p = reach(id, r);
                    return (
                      <td key={round.key} className="px-2 text-right tabular-nums">
                        <span className="inline-block min-w-[3.5rem] rounded px-1" style={{ background: `rgb(37 99 235 / ${(0.05 + 0.5 * p).toFixed(2)})` }}>
                          {pct(p)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-2 pr-3 text-right font-semibold tabular-nums" data-testid="cup-win-chance">
                    {pct(win(id))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN && (
        <button type="button" className="w-full border-t border-zinc-100 py-2 text-xs font-semibold text-pitch-700 hover:bg-pitch-50 dark:border-zinc-800 dark:text-pitch-100 dark:hover:bg-pitch-900/30" onClick={() => setShowAll(!showAll)}>
          {showAll ? t("showFewer") : t("showAll", { count: rows.length })}
        </button>
      )}
    </section>
  );
}
