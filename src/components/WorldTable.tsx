"use client";

import { useTranslations } from "next-intl";
import type { Zone } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import { divisionConfig, divisionCountry, LOWER_LEAGUE, neighbours, type DivisionCode, type RowNote, type TableRow, type WorldClub } from "../lib/myWorld.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { TeamBadge } from "./TeamBadge.tsx";
import { ZONE_STYLES } from "./zones.ts";

/** A saved row's note as an icon (its meaning in a label and the legend under the table). */
const NOTE_ICONS: Record<Exclude<RowNote, "">, { icon: IconName; className: string }> = {
  C: { icon: "trophy", className: "text-amber-500" },
  P: { icon: "arrow-up", className: "text-pitch-600" },
  W: { icon: "arrow-up", className: "text-pitch-600" },
  O: { icon: "target", className: "text-sky-600" },
  R: { icon: "arrow-down", className: "text-red-600" },
};

const RELEGATION = new Set(["relegation", "relegationPlayoff"]);

/**
 * A My World table: the season in progress (`final` false) or a saved final
 * table, with each club's outcome. Places are coloured as on the league's
 * own page (the whole row, with the legend under the table); the visitor's
 * club is in bold with a bar on its left; new clubs are labelled.
 */
export function WorldTable({
  rows,
  code,
  clubs,
  highlight,
  final,
  testId,
  zones: ownZones,
  title,
  qualified,
  qualifiedNote,
}: {
  rows: TableRow[];
  code: DivisionCode;
  clubs: Record<number, WorldClub>;
  highlight: TeamId;
  final: boolean;
  testId: string;
  /** The places' colours, when they aren't the league's (Série C's phases and final classification). */
  zones?: readonly Zone[];
  /** A heading above the table (Série C's "First stage", its groups). */
  title?: string;
  /** Clubs already in the first place's competition by another route (Argentina's tournament champions): shown there, their places passed down. */
  qualified?: ReadonlySet<TeamId>;
  /** The note under the table explaining `qualified`. */
  qualifiedNote?: string;
}) {
  const t = useTranslations("World");
  const tz = useTranslations("Zones");
  const zones = ownZones ?? divisionConfig(code).zones;
  // The country's bottom division: relegation is out of the pyramid, into the league below.
  const bottom = !neighbours(code).below;
  const zoneAt = (position: number) => zones.find((z) => position >= z.from && position <= z.to)?.kind;
  // Clubs qualified by another route take the first place's colour; the others' places pass down past them (relegation keeps the real place).
  const passed = qualified?.size ? new Map(rows.filter((r) => !qualified.has(r.clubId)).map((r, i) => [r.clubId, i + 1])) : undefined;
  const zoneOf = (row: TableRow) => {
    const real = zoneAt(row.position);
    if (!passed || (real && RELEGATION.has(real))) return real;
    if (qualified!.has(row.clubId)) return zones[0]?.kind;
    return [zoneAt(passed.get(row.clubId)!)].find((z) => z && !RELEGATION.has(z));
  };
  const legend = [...new Set(zones.map((z) => z.kind))];
  const noteLabel = (note: RowNote) => (note === "R" && bottom ? t("notes.out", { league: t(`leagues.${LOWER_LEAGUE[divisionCountry(code)]}.the`) }) : note ? t(`notes.${note}`) : "");
  const used = final ? [...new Set(rows.map((r) => r.note).filter(Boolean))] : [];
  const cell = "px-1.5 py-2 text-right tabular-nums";
  return (
    <div className="space-y-2">
      {title && (
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200" data-testid="world-table-title">
          {title}
        </h3>
      )}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full table-fixed text-sm" data-testid={testId} data-league={code}>
          <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/60">
            <tr>
              <th scope="col" className="w-9 py-2 pl-3 text-left font-semibold">
                {t("columns.position")}
              </th>
              <th scope="col" className="py-2 pl-1 text-left font-semibold">
                {t("columns.club")}
              </th>
              <th scope="col" className={`${cell} w-9 font-semibold sm:w-11`}>
                {t("columns.played")}
              </th>
              <th scope="col" className={`${cell} hidden w-11 font-semibold sm:table-cell`}>
                {t("columns.won")}
              </th>
              <th scope="col" className={`${cell} hidden w-11 font-semibold sm:table-cell`}>
                {t("columns.drawn")}
              </th>
              <th scope="col" className={`${cell} hidden w-11 font-semibold sm:table-cell`}>
                {t("columns.lost")}
              </th>
              <th scope="col" className={`${cell} w-11 font-semibold sm:w-14`}>
                {t("columns.goalDifference")}
              </th>
              <th scope="col" className={`${cell} w-12 pr-3 font-semibold sm:w-14`}>
                {t("columns.points")}
              </th>
              {final && <th scope="col" className="w-8 pr-3" aria-label={t("columns.note")} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const club = clubs[row.clubId]!;
              const zone = zoneOf(row);
              const isQualified = qualified?.has(row.clubId) ?? false;
              const own = row.clubId === highlight;
              const note = final ? row.note : "";
              const icon = note ? NOTE_ICONS[note] : undefined;
              return (
                <tr
                  key={row.clubId}
                  className={`border-t border-zinc-200/70 dark:border-zinc-800 ${zone ? ZONE_STYLES[zone].row : own ? "bg-pitch-50 dark:bg-pitch-900/30" : ""} ${own ? "font-semibold" : ""}`}
                  data-testid="world-row"
                  data-club={row.clubId}
                  data-zone={zone ?? ""}
                  {...(zone ? { title: tz(zone) } : {})}
                  {...(own ? { "aria-current": "true" as const } : {})}
                  {...(note ? { "data-note": note } : {})}
                >
                  <td className="py-2 pl-3 text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300" style={own ? { boxShadow: "inset 3px 0 0 var(--color-pitch-600)" } : undefined}>
                    {row.position}
                  </td>
                  <td className="py-2 pl-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamBadge team={club} size={20} textless />
                      <span className="truncate">{club.name}</span>
                      {isQualified && (
                        <span className="shrink-0 text-yellow-500" title={qualifiedNote} aria-label={qualifiedNote} data-testid="world-qualified-tag">
                          <Icon name="trophy" size={14} />
                        </span>
                      )}
                      {club.origin === "new" && (
                        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={t("newClubHint")}>
                          {t("newClub")}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={cell}>{row.played}</td>
                  <td className={`${cell} hidden sm:table-cell`}>{row.won}</td>
                  <td className={`${cell} hidden sm:table-cell`}>{row.drawn}</td>
                  <td className={`${cell} hidden sm:table-cell`}>{row.lost}</td>
                  <td className={cell}>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                  <td className={`${cell} pr-3 font-bold`}>{row.points}</td>
                  {final && (
                    <td className="pr-3 text-right">
                      {icon && (
                        <span title={noteLabel(note)} className={`inline-flex ${icon.className}`}>
                          <Icon name={icon.icon} size={16} strokeWidth={2.5} />
                          <span className="sr-only">{noteLabel(note)}</span>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {legend.length > 0 && (
        <ul data-testid="world-zone-legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          {legend.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-sm ring-1 ring-zinc-300 dark:ring-zinc-600 ${ZONE_STYLES[kind].row}`} />
              {tz(kind)}
            </li>
          ))}
        </ul>
      )}
      {qualifiedNote && (
        <p className="text-xs text-zinc-500" data-testid="world-qualified-note">
          {qualifiedNote}
        </p>
      )}
      {final && used.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500" aria-hidden>
          {(["C", "P", "W", "O", "R"] as const)
            .filter((n) => used.includes(n))
            .map((n) => (
              <li key={n} className="flex items-center gap-1">
                <span className={NOTE_ICONS[n].className}>
                  <Icon name={NOTE_ICONS[n].icon} size={14} strokeWidth={2.5} />
                </span>
                {noteLabel(n)}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
