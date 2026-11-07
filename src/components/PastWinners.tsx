"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { decadeOf, decades, eras, filterRows, mostTitles, type Era, type WinnerClub, type WinnerRow } from "../lib/winners.ts";
import { Icon } from "./Icon.tsx";
import { TeamBadge } from "./TeamBadge.tsx";

type BadgeClub = Pick<WinnerClub, "id" | "crest" | "tla"> & { name: string };

/** A club's badge: its crest; the site's disc for a My World club without one; a shield for a historic club that has none. */
function Badge({ club, size = 20 }: { club: BadgeClub; size?: number }) {
  if (club.crest) return <img src={club.crest} alt="" width={size} height={size} loading="lazy" className="shrink-0 object-contain" style={{ width: size, height: size }} />;
  if (club.tla && club.id !== null) return <TeamBadge team={{ id: club.id, name: club.name, shortName: club.name, tla: club.tla }} size={size} textless />;
  return (
    <span className="inline-flex shrink-0 text-zinc-400" data-testid="shield-badge">
      <Icon name="shield" size={size} />
    </span>
  );
}

type Place = "champion" | "runnerUp" | "third";

/** One placing: the badge and the name used that season (with "now …" when the club is called something else today), and the points. */
function Placing({ club, place }: { club: WinnerClub | null; place: Place }) {
  const t = useTranslations("PastWinners");
  const champion = place === "champion";
  const box = `flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 sm:min-h-9 ${champion ? "bg-pitch-50 dark:bg-pitch-900/30" : ""}`;
  if (!club) {
    return (
      <div className={box} data-place={place}>
        <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 sm:hidden">{t(place)}</span>
        <span className="text-zinc-400">–</span>
      </div>
    );
  }
  const renamed = club.name !== club.currentName;
  const now = renamed ? t("now", { club: club.currentName }) : undefined;
  return (
    <div className={box} data-place={place}>
      <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 sm:hidden">{t(place)}</span>
      <Badge club={{ id: club.id, crest: club.crest, tla: club.tla, name: club.currentName }} />
      <span
        className={`min-w-0 truncate text-sm ${champion ? "font-semibold text-pitch-900 dark:text-pitch-100" : ""}`}
        {...(now ? { title: now, "aria-label": `${club.name} (${now})` } : {})}
      >
        {club.name}
      </span>
      {club.points !== null && <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-500">{t("points", { points: club.points })}</span>}
    </div>
  );
}

/** A season: on phones a card (the season, then the three placings); from tablets up one row of four columns. */
function Row({ row }: { row: WinnerRow }) {
  const t = useTranslations("PastWinners");
  const notes = row.notes.join(" ");
  const season = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold tabular-nums">
      <span>{row.season}</span>
      {row.tournament && <span className="font-medium text-zinc-500">{row.tournament}</span>}
      {row.status === "completed" && row.format !== "league" && (
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t(row.format === "final" ? "final" : "playoff")}</span>
      )}
      {row.world && (
        <span className="rounded bg-pitch-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pitch-800 dark:bg-pitch-900/50 dark:text-pitch-100" data-testid="past-winners-world">
          {t("world")}
        </span>
      )}
      {row.status === "completed" && notes && (
        <span className="inline-flex text-zinc-400" title={notes} aria-label={notes} tabIndex={0}>
          <Icon name="info" size={14} />
        </span>
      )}
    </div>
  );
  const card = "rounded-xl border border-zinc-200 bg-white px-3 py-2 sm:rounded-none sm:border-0 sm:bg-transparent dark:border-zinc-800 dark:bg-zinc-900 sm:dark:bg-transparent";
  if (row.status !== "completed") {
    return (
      <li className={`${card} grid gap-1 text-sm text-zinc-500 sm:grid-cols-[6.5rem_1fr] sm:items-center sm:gap-3`} data-testid="past-winners-row" data-status={row.status}>
        {season}
        <p className="min-h-11 content-center sm:min-h-9">
          {t(row.status === "not_held" ? "notHeld" : "abandoned")}
          {notes ? `: ${notes}` : ""}
        </p>
      </li>
    );
  }
  return (
    <li
      className={`${card} grid gap-1 sm:grid-cols-[6.5rem_repeat(3,minmax(0,1fr))] sm:items-center sm:gap-3`}
      data-testid="past-winners-row"
      data-status="completed"
      {...(row.world ? { "data-world": "true" } : {})}
    >
      {season}
      <Placing club={row.champion} place="champion" />
      <Placing club={row.runnerUp} place="runnerUp" />
      <Placing club={row.third} place="third" />
    </li>
  );
}

/**
 * A league's past winners, newest first: each season's champion, runner-up and
 * third place, in eras (the competition's names over time), with the clubs that
 * won it most, era or decade chips and a club search. Real seasons from the
 * league's history file; in My World, the world's own seasons on top.
 */
export function PastWinners({ rows, comingSoon = false, testId = "past-winners" }: { rows: WinnerRow[]; /** No real history for this league yet: say so (My World shows its own seasons). */ comingSoon?: boolean; testId?: string }) {
  const t = useTranslations("PastWinners");
  const [era, setEra] = useState<Era | null>(null);
  const [decade, setDecade] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const summary = useMemo(() => mostTitles(rows, 5), [rows]);
  const eraList = useMemo(() => eras(rows), [rows]);
  // Chips: the competition's eras when it had more than one name, else the decades.
  const byEra = eraList.length > 1;
  const decadeList = useMemo(() => (byEra ? [] : decades(rows)), [byEra, rows]);
  const shown = useMemo(() => filterRows(rows, { era, decade, query }), [rows, era, decade, query]);
  const eraLabel = (e: Era) => (e.to === null ? t("eraOpen", { name: e.name, from: String(e.from) }) : t("era", { name: e.name, from: String(e.from), to: String(e.to) }));
  const eraOf = (row: WinnerRow) => eraList.find((e) => row.competition === e.name && row.startYear >= e.from && (e.to === null || row.endYear <= e.to));
  // The rows in their eras, newest first.
  const groups: { label: string; rows: WinnerRow[] }[] = [];
  for (const row of shown) {
    const label = eraOf(row)?.name ?? row.competition;
    const last = groups.at(-1);
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  const chip = (active: boolean) =>
    `min-h-11 rounded-full border px-3 text-sm font-semibold sm:min-h-8 ${active ? "border-pitch-600 bg-pitch-600 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"}`;
  const chips: { key: string; label: string; active: boolean; pick: () => void }[] = [
    { key: "all", label: t("all"), active: era === null && decade === null, pick: () => (setEra(null), setDecade(null)) },
    ...(byEra
      ? [...eraList].reverse().map((e) => ({ key: `${e.name}-${e.from}`, label: eraLabel(e), active: era === e, pick: () => (setEra(e), setDecade(null)) }))
      : decadeList.map((d) => ({ key: String(d), label: t("decade", { decade: String(d) }), active: decade === d, pick: () => (setDecade(d), setEra(null)) }))),
  ];
  const header = "hidden px-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 sm:grid sm:grid-cols-[6.5rem_repeat(3,minmax(0,1fr))] sm:gap-3";

  return (
    <div className="space-y-4" data-testid={testId}>
      {comingSoon && (
        <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700" data-testid="past-winners-coming-soon">
          {t("comingSoon")}
        </p>
      )}

      {summary.length > 0 && (
        <section aria-label={t("mostTitles")} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900" data-testid="past-winners-titles">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-zinc-500">
            <Icon name="trophy" size={14} className="text-amber-500" />
            {t("mostTitles")}
          </h3>
          <ol className="flex flex-wrap gap-x-5 gap-y-2">
            {summary.map((c, i) => (
              <li key={c.key} className="flex min-w-0 items-center gap-2 text-sm" data-testid="past-winners-title" data-titles={c.titles}>
                <span className="w-3 text-xs font-semibold text-zinc-400">{i + 1}</span>
                <Badge club={c} />
                <span className="truncate font-semibold">{c.name}</span>
                <span className="shrink-0 text-zinc-500">{t("titles", { count: c.titles })}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          {chips.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filter")}>
              {chips.map((c) => (
                <button key={c.key} type="button" aria-pressed={c.active} className={chip(c.active)} onClick={c.pick} data-testid="past-winners-chip">
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <label className="relative block shrink-0 sm:w-60">
            <span className="sr-only">{t("search")}</span>
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              className="h-11 w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 text-sm sm:h-9 dark:border-zinc-700 dark:bg-zinc-900"
              data-testid="past-winners-search"
            />
          </label>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500" data-testid="past-winners-empty">
          {rows.length === 0 ? t("none") : t("noMatches")}
        </p>
      ) : (
        <div className="space-y-5">
          <div className={header} aria-hidden>
            <span>{t("season")}</span>
            <span className="px-2">{t("champion")}</span>
            <span className="px-2">{t("runnerUp")}</span>
            <span className="px-2">{t("third")}</span>
          </div>
          {groups.map((g, i) => (
            <section key={`${g.label}-${i}`} className="space-y-2">
              <h3 className="text-sm font-bold text-zinc-700 dark:text-zinc-200" data-testid="past-winners-era">
                {(() => {
                  const e = eraOf(g.rows[0]!);
                  return e ? eraLabel(e) : g.label;
                })()}
              </h3>
              <ol className="space-y-2 sm:space-y-0 sm:divide-y sm:divide-zinc-100 sm:overflow-hidden sm:rounded-xl sm:border sm:border-zinc-200 sm:bg-white sm:dark:divide-zinc-800 sm:dark:border-zinc-800 sm:dark:bg-zinc-900">
                {g.rows.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
