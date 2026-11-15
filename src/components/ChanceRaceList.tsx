"use client";

import type { Team } from "../engine/types.ts";
import { IntentLink } from "./IntentLink.tsx";
import { TeamBadge } from "./TeamBadge.tsx";

/** A race's club, as its row needs it: [club, its chance page or "" (none, or the page's own club), "3rd · 24 pts", bar width, chance as shown, the page's own club 1 / else 0, its place in the race]. */
export type ChanceRaceRow = readonly [Pick<Team, "id" | "name" | "tla"> & { slug?: string; crest?: string }, string, string, string, string, 0 | 1, number];

/**
 * The rows of a chance page's race (ChanceRace), the same markup it drew as
 * server components, from each row's text alone: a server component's output
 * is sent twice (HTML, and RSC data element by element), a client component's
 * props only once more.
 */
export function ChanceRaceList({ rows, color }: { rows: readonly ChanceRaceRow[]; color: string }) {
  return (
    <ol className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900" data-testid="chance-race">
      {rows.map(([team, href, standing, width, chance, own, place]) => (
        <li key={team.id} className={`flex items-center gap-3 px-3 py-2.5 sm:px-4 ${own ? "bg-pitch-50 dark:bg-pitch-900/30" : ""}`} data-testid="chance-row" data-team={team.slug} aria-current={own ? "true" : undefined}>
          <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-500">{place}</span>
          <TeamBadge team={team as Team} size={24} />
          <span className="min-w-0 flex-1">
            {href ? (
              <IntentLink href={href} className="block truncate font-semibold hover:underline">
                {team.name}
              </IntentLink>
            ) : (
              <span className="block truncate font-semibold">{team.name}</span>
            )}
            <span className="block text-xs text-zinc-500">{standing}</span>
          </span>
          <span className="flex w-14 shrink-0 items-center gap-2 sm:w-52">
            <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 sm:block dark:bg-zinc-700">
              <span className="block h-full rounded-full" style={{ width, background: color }} />
            </span>
            <span className="w-full text-right text-base font-extrabold tabular-nums sm:w-14">{chance}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
