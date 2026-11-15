"use client";

import type { Team } from "../engine/types.ts";
import { IntentLink } from "./IntentLink.tsx";
import { TeamBadge } from "./TeamBadge.tsx";

/**
 * A club page's fixtures, a row each: [game id, short date, date, the game's
 * page or "", home 1 / away 0, opponent's index in `opponents`, win, draw and
 * loss (as shown), their bars' widths, the odds' spoken label].
 */
export type ClubFixtureRow = readonly [number, string, string, string, 0 | 1, number, string, string, string, string, string, string, string];

/** The clubs a page's fixtures name, as their badges and links need them. */
export type FixtureOpponent = Pick<Team, "id" | "shortName" | "tla"> & { crest?: string; page?: string };

/**
 * The rows of a club page's fixtures (src/app/[locale]/[league]/team/[teamSlug]/page.tsx),
 * the same markup the page drew as server components. Those were sent twice:
 * as HTML and again, element by element, as RSC data, over 30 KB of it for a
 * season's games. Here the RSC data carries only each row's text and numbers.
 */
export function ClubFixtureRows({ rows, opponents, labels }: { rows: readonly ClubFixtureRow[]; opponents: readonly FixtureOpponent[]; labels: { home: string; away: string; homeShort: string; awayShort: string } }) {
  return rows.map(([id, short, long, href, home, opponentIndex, win, draw, loss, winWidth, drawWidth, lossWidth, oddsLabel]) => {
    const other = opponents[opponentIndex];
    const date = (
      <>
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{long}</span>
      </>
    );
    const className = "w-9 shrink-0 text-xs tabular-nums text-zinc-500 sm:w-16";
    const name = other && (
      <>
        <TeamBadge team={other as Team} size={20} />
        <span className="truncate font-medium">{other.shortName}</span>
      </>
    );
    return (
      <li key={id} className="flex items-center gap-2 px-3 py-2 text-sm sm:gap-3" data-testid="club-fixture">
        {href ? (
          <IntentLink href={href} className={`hover:underline ${className}`} data-testid="club-match-link">
            {date}
          </IntentLink>
        ) : (
          <span className={className}>{date}</span>
        )}
        <span className={home ? "venue-home" : "venue-away"} title={home ? labels.home : labels.away}>
          <span aria-hidden>{home ? labels.homeShort : labels.awayShort}</span>
          <span className="sr-only">{home ? labels.home : labels.away}</span>
        </span>
        <div className="min-w-0 flex-1">
          {other ? (
            other.page ? (
              <IntentLink href={other.page} className="flex min-w-0 items-center gap-2 hover:underline">
                {name}
              </IntentLink>
            ) : (
              <span className="flex min-w-0 items-center gap-2">{name}</span>
            )
          ) : null}
        </div>
        <div className="w-28 shrink-0 sm:w-40" aria-label={oddsLabel} role="img">
          <div className="flex justify-between text-xs tabular-nums">
            <span className="font-bold text-pitch-700 dark:text-pitch-300">{win}</span>
            <span className="text-zinc-500">{draw}</span>
            <span className="text-red-600 dark:text-red-400">{loss}</span>
          </div>
          <div className="odds-track">
            <span className="bg-pitch-600" style={{ width: winWidth }} />
            <span className="bg-zinc-400" style={{ width: drawWidth }} />
            <span className="bg-red-500" style={{ width: lossWidth }} />
          </div>
        </div>
      </li>
    );
  });
}
