"use client";

import { useEffect, useState } from "react";
import type { ImpactView } from "../lib/matchImpact.ts";
import { TeamBadge } from "./TeamBadge.tsx";
import { zoneHex } from "./zones.ts";

const tone = { same: "text-zinc-400", better: "font-semibold text-pitch-700 dark:text-pitch-300", worse: "font-semibold text-red-600 dark:text-red-400" } as const;

/**
 * "What this result means", fetched after the page has loaded (it takes three
 * season simulations): a placeholder of its size until then, nothing if the
 * game has none or it can't be loaded.
 */
export function MatchImpact({ src, title }: { src: string; title: string }) {
  const [view, setView] = useState<ImpactView | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(src)
      .then((res) => (res.ok ? (res.json() as Promise<ImpactView | null>) : null))
      .then((v) => live && setView(v))
      .catch(() => live && setView(null));
    return () => {
      live = false;
    };
  }, [src]);
  if (view === null) return null;
  if (view === undefined)
    return (
      // As tall as the finished section with its usual two rows (about 292px on phones, 259px from tablets up), so the page doesn't jump when it arrives.
      <section className="flex min-h-[292px] flex-col gap-3 sm:min-h-[259px]" data-testid="match-impact-loading" aria-busy="true">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <div className="flex-1 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800/60" />
        <div className="h-8 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
      </section>
    );
  return (
    <section className="space-y-3" data-testid="match-impact">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid grid-cols-4 gap-1 border-b border-zinc-200 bg-zinc-100 px-3 py-2 text-[11px] font-semibold leading-tight text-zinc-600 sm:text-xs dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300">
          <span>{view.nowLabel}</span>
          {/* Phones: each result as the winner's crest and its score; the full label from tablets up (and for screen readers). */}
          {view.heads.map((h) => (
            <span key={h.key} className="flex min-w-0 flex-wrap items-center gap-x-1" data-testid="match-impact-head">
              {h.team ? (
                <>
                  <span className="sm:hidden" aria-hidden>
                    <TeamBadge team={h.team} size={16} />
                  </span>
                  <span className="sr-only sm:not-sr-only">{h.label}</span>
                </>
              ) : (
                <span>{h.label}</span>
              )}
              <span className="font-normal tabular-nums">{h.score}</span>
            </span>
          ))}
        </div>
        <ul className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
          {view.rows.map((row) => (
            <li key={row.key} className="px-3 py-2.5" data-testid="match-impact-row" data-kind={row.kind}>
              <p className="flex items-center gap-2 text-xs font-semibold">
                {row.zone && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: zoneHex(row.zone) }} />}
                <span className="min-w-0 truncate">{row.label}</span>
              </p>
              <div className="mt-1 grid grid-cols-4 gap-1">
                <span className="text-base font-bold tabular-nums">{row.now}</span>
                {row.cells.map((cell, i) => (
                  <span key={i} className="flex flex-col leading-tight">
                    <span className="text-base font-bold tabular-nums">{cell.value}</span>
                    <span className={`text-[11px] tabular-nums ${tone[cell.change.tone]}`}>{cell.change.text}</span>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-zinc-500">{view.note}</p>
      {view.positionNote && <p className="text-xs text-zinc-500">{view.positionNote}</p>}
    </section>
  );
}
