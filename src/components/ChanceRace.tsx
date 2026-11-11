import type { SiteLocale } from "../config/leagues.ts";
import type { Team, TeamId } from "../engine/types.ts";
import { IntentLink } from "./IntentLink.tsx";
import { clubChancePath, type Outcome, type RaceRow } from "../lib/chancePages.ts";
import { ordinal, percent } from "../lib/clubText.ts";
import { TeamBadge } from "./TeamBadge.tsx";

/**
 * A race on a chance page: each club's chance of the outcome, likeliest first,
 * with where it stands now and a link to its own chance page. `highlight`: the
 * club the page is about.
 */
export function ChanceRace({
  rows,
  teams,
  outcome,
  color,
  lang,
  standing,
  highlight,
}: {
  rows: readonly RaceRow[];
  teams: ReadonlyMap<TeamId, Team>;
  outcome: Outcome;
  color: string;
  lang: SiteLocale;
  /** "3rd · 24 pts". */
  standing: (position: string, points: number) => string;
  highlight?: TeamId;
}) {
  return (
    <ol className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900" data-testid="chance-race">
      {rows.map((r, i) => {
        const team = teams.get(r.teamId);
        if (!team) return null;
        const own = r.teamId === highlight;
        return (
          <li key={r.teamId} className={`flex items-center gap-3 px-3 py-2.5 sm:px-4 ${own ? "bg-pitch-50 dark:bg-pitch-900/30" : ""}`} data-testid="chance-row" data-team={team.slug} aria-current={own ? "true" : undefined}>
            <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-500">{i + 1}</span>
            <TeamBadge team={team} size={24} />
            <span className="min-w-0 flex-1">
              {team.page && !own ? (
                <IntentLink href={clubChancePath(team.page, outcome)} className="block truncate font-semibold hover:underline">
                  {team.name}
                </IntentLink>
              ) : (
                <span className="block truncate font-semibold">{team.name}</span>
              )}
              <span className="block text-xs text-zinc-500">{standing(ordinal(r.position, lang), r.points)}</span>
            </span>
            <span className="flex w-14 shrink-0 items-center gap-2 sm:w-52">
              <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 sm:block dark:bg-zinc-700">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(r.chance > 0 ? 2 : 0, r.chance * 100)}%`, background: color }} />
              </span>
              <span className="w-full text-right text-base font-extrabold tabular-nums sm:w-14">{percent(r.chance, lang)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
