import type { SiteLocale } from "../config/leagues.ts";
import type { Team, TeamId } from "../engine/types.ts";
import { ChanceRaceList, type ChanceRaceRow } from "./ChanceRaceList.tsx";
import { clubChancePath, type Outcome, type RaceRow } from "../lib/chancePages.ts";
import { ordinal, percent } from "../lib/clubText.ts";

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
  // Each row's text, drawn by ChanceRaceList (the same markup, a far smaller RSC payload).
  const list = rows.flatMap((r, i): ChanceRaceRow[] => {
    const team = teams.get(r.teamId);
    if (!team) return [];
    const own = r.teamId === highlight;
    const club = { id: team.id, name: team.name, tla: team.tla, ...(team.slug ? { slug: team.slug } : {}), ...(team.crest ? { crest: team.crest } : {}) };
    return [[club, team.page && !own ? clubChancePath(team.page, outcome) : "", standing(ordinal(r.position, lang), r.points), `${Math.max(r.chance > 0 ? 2 : 0, r.chance * 100)}%`, percent(r.chance, lang), own ? 1 : 0, i + 1]];
  });
  return <ChanceRaceList rows={list} color={color} />;
}
