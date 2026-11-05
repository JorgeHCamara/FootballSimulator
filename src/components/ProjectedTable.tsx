"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ZoneKind } from "../config/leagues.ts";
import type { Team } from "../engine/types.ts";
import { Link } from "../i18n/navigation.ts";
import type { ProjectedHistory } from "../lib/projected.ts";
import { Icon } from "./Icon.tsx";
import { TeamBadge } from "./TeamBadge.tsx";
import { ZONE_STYLES } from "./zones.ts";

export interface ProjectedLabels {
  previous: string;
  next: string;
  /** The round picker's name. */
  pick: string;
  place: string;
  club: string;
  table: string;
  tableTitle: string;
  points: string;
  pointsTitle: string;
  chance: string;
  chanceTitle: string;
  change: string;
  changeTitle: string;
  /** "Up {n}", "Down {n}". */
  up: string;
  down: string;
  same: string;
  historyTitle: string;
  historyNote: string;
  /** A round worked out with a new model: under the picker, and in the round-by-round grid's note. */
  modelChange: string;
  modelChangeNote: string;
  /** Each table's name (conferences), by table id. */
  tableNames: Record<string, string>;
  zones: Partial<Record<ZoneKind, string>>;
}

interface Props {
  history: ProjectedHistory;
  teams: Team[];
  /** Each entry's name in full ("Round 11 · 2 Nov") and in the round-by-round grid's header ("11", "Now"). */
  entryNames: { full: string; short: string }[];
  labels: ProjectedLabels;
  locale: string;
}

/**
 * The projected final table after a chosen round (the latest first), each
 * club's move since the round before, and every club's projected place round
 * by round (tap a round to see its table).
 */
export function ProjectedTable({ history, teams, entryNames, labels, locale }: Props) {
  const { entries, tables, zones } = history;
  const [index, setIndex] = useState(entries.length - 1);
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const pct = useMemo(() => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }), [locale]);
  const grids = useRef<(HTMLDivElement | null)[]>([]);
  // The grids open on the latest rounds (phones scroll them sideways).
  useEffect(() => {
    for (const el of grids.current) if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const entry = entries[index]!;
  const before = index > 0 ? entries[index - 1] : undefined;
  const zoneOf = (place: number) => zones.find((z) => place >= z.from && place <= z.to)?.kind;
  const legend = [...new Set(zones.map((z) => z.kind))];
  const order = (teamIds: readonly number[], e = entry) =>
    [...teamIds].sort((a, b) => (e.teams[a]?.place ?? Infinity) - (e.teams[b]?.place ?? Infinity) || a - b);
  const name = (id: number, short = false) => {
    const team = byId.get(id);
    const text = (short ? team?.shortName : team?.name) ?? "";
    return team?.page ? (
      <Link href={team.page} className="hover:underline">
        {text}
      </Link>
    ) : (
      text
    );
  };
  const move = (id: number) => {
    const now = entry.teams[id]?.place;
    const then = before?.teams[id]?.place;
    // A new model since the round before: its moves aren't the results'.
    if (now === undefined || then === undefined || entry.modelChange) return <span className="text-zinc-400">–</span>;
    const d = then - now;
    if (!d)
      return (
        <span className="inline-flex text-zinc-400" title={labels.same}>
          <Icon name="minus" size={14} title={labels.same} />
        </span>
      );
    const text = (d > 0 ? labels.up : labels.down).replace("{n}", String(Math.abs(d)));
    return (
      <span className={`inline-flex items-center gap-0.5 font-semibold ${d > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`} title={text}>
        <Icon name={d > 0 ? "arrow-up" : "arrow-down"} size={13} />
        <span aria-hidden>{Math.abs(d)}</span>
        <span className="sr-only">{text}</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* The round shown: back, the picker, forward. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label={labels.previous}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-300 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          data-testid="projected-previous"
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <select
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label={labels.pick}
          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold sm:flex-none dark:border-zinc-700 dark:bg-zinc-900"
          data-testid="projected-round"
        >
          {entries.map((_, i) => (
            <option key={i} value={i}>
              {entryNames[i]!.full}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(entries.length - 1, i + 1))}
          disabled={index === entries.length - 1}
          aria-label={labels.next}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-300 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          data-testid="projected-next"
        >
          <Icon name="chevron-right" size={18} />
        </button>
      </div>

      {entry.modelChange && before && (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400" data-testid="projected-model-change">
          <Icon name="info" size={16} className="mt-px shrink-0 text-pitch-700 dark:text-pitch-300" />
          {labels.modelChange}
        </p>
      )}

      <div className={`grid gap-4 ${tables.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {tables.map((table) => (
          <div key={table.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {labels.tableNames[table.id] && <h3 className="border-b border-zinc-200 px-3 py-2 text-sm font-bold dark:border-zinc-800">{labels.tableNames[table.id]}</h3>}
            <table className="w-full table-fixed text-sm tabular-nums" data-testid="projected-table">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="w-10 py-2 pl-3 font-semibold">{labels.place}</th>
                  <th className="py-2 pr-2 font-semibold">{labels.club}</th>
                  <th className="w-14 py-2 pr-2 text-right font-semibold" title={labels.tableTitle}>
                    {labels.table}
                  </th>
                  <th className="w-11 py-2 pr-2 text-right font-semibold" title={labels.pointsTitle}>
                    {labels.points}
                  </th>
                  <th className="hidden w-16 py-2 pr-2 text-right font-semibold sm:table-cell" title={labels.chanceTitle}>
                    {labels.chance}
                  </th>
                  <th className="w-14 py-2 pr-3 text-right font-semibold" title={labels.changeTitle}>
                    {labels.change}
                  </th>
                </tr>
              </thead>
              <tbody>
                {order(table.teamIds).map((id) => {
                  const club = entry.teams[id];
                  const team = byId.get(id);
                  if (!club || !team) return null;
                  const zone = zoneOf(club.place);
                  return (
                    <tr key={id} className={`border-t border-zinc-200/70 dark:border-zinc-800 ${zone ? ZONE_STYLES[zone].row : ""}`} data-testid="projected-row">
                      <td className="py-2 pl-3 font-bold">{club.place}</td>
                      <td className="overflow-hidden py-2 pr-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <TeamBadge team={team} size={18} />
                          <span className="min-w-0 truncate font-medium">{name(id)}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-right text-zinc-600 dark:text-zinc-400">{club.position}</td>
                      <td className="py-2 pr-2 text-right font-semibold">{Math.round(club.averagePoints)}</td>
                      <td className="hidden py-2 pr-2 text-right text-zinc-600 sm:table-cell dark:text-zinc-400">{club.chance !== undefined ? pct.format(club.chance) : "–"}</td>
                      <td className="py-2 pr-3 text-right text-xs">{move(id)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {legend.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          {legend.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-sm ring-1 ring-zinc-300 dark:ring-zinc-600 ${ZONE_STYLES[kind].row}`} />
              {labels.zones[kind] ?? kind}
            </li>
          ))}
        </ul>
      )}

      {entries.length > 1 && (
        <div className="space-y-2" data-testid="projected-history">
          <h3 className="text-base font-bold">{labels.historyTitle}</h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {labels.historyNote}
            {entries.some((e) => e.modelChange) ? ` ${labels.modelChangeNote}` : ""}
          </p>
          {tables.map((table, t) => (
            <div key={table.id} className="space-y-1">
              {tables.length > 1 && labels.tableNames[table.id] && <p className="text-xs font-semibold text-zinc-500">{labels.tableNames[table.id]}</p>}
              <div
                ref={(el) => {
                  grids.current[t] = el;
                }}
                className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                <table className="border-separate border-spacing-0 text-xs tabular-nums" data-testid="projected-grid">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 min-w-32 border-r border-zinc-200 bg-white px-2 py-1.5 text-left font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">{labels.club}</th>
                      {entries.map((e, i) => (
                        <th key={i} className={`p-0.5 font-semibold ${e.modelChange ? "border-l-2 border-l-zinc-400 dark:border-l-zinc-500" : ""}`}>
                          <button
                            type="button"
                            onClick={() => setIndex(i)}
                            aria-pressed={i === index}
                            aria-label={entryNames[i]!.full}
                            className={`h-8 min-w-8 rounded-md px-1 ${i === index ? "bg-pitch-600 text-white" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                          >
                            {entryNames[i]!.short}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {order(table.teamIds).map((id) => {
                      const team = byId.get(id);
                      if (!team) return null;
                      return (
                        <tr key={id}>
                          <th scope="row" className="sticky left-0 z-10 max-w-36 border-r border-t border-r-zinc-200 border-t-zinc-200/70 bg-white px-2 py-1 text-left font-medium dark:border-r-zinc-800 dark:border-t-zinc-800 dark:bg-zinc-900">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <TeamBadge team={team} size={16} />
                              <span className="truncate">{name(id, true)}</span>
                            </span>
                          </th>
                          {entries.map((e, i) => {
                            const place = e.teams[id]?.place;
                            const zone = place === undefined ? undefined : zoneOf(place);
                            return (
                              <td
                                key={i}
                                className={`border-t border-zinc-200/70 px-1 py-1 text-center dark:border-zinc-800 ${e.modelChange ? "border-l-2 border-l-zinc-400 dark:border-l-zinc-500" : ""} ${zone ? ZONE_STYLES[zone].row : ""} ${i === index ? "font-extrabold outline outline-1 -outline-offset-1 outline-pitch-600" : ""}`}
                              >
                                {place ?? "–"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
