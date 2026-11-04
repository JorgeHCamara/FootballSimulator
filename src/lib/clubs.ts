import type { LeagueConfig } from "../config/leagues.ts";
import type { Team } from "../engine/types.ts";

/**
 * A club's URL slug: lowercase, accent-free, words joined by hyphens
 * ("São Paulo" → "sao-paulo", "Atlético Madrid" → "atletico-madrid"). A
 * trailing "FC" is dropped, so the slug doesn't change with the data source
 * ("Arsenal" on ESPN, "Arsenal FC" on football-data.org).
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/ß/g, "ss")
    .replace(/ı/g, "i")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bf\.?c\.?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Leagues with a page per club: the domestic ones (a continental competition's clubs have theirs in their own league). */
export const hasClubPages = (league: LeagueConfig) => !league.continental;

/** The path of a club's page, without the locale: "/premier-league/team/arsenal". */
export const clubPath = (league: Pick<LeagueConfig, "slug">, slug: string) => `/${league.slug}/team/${slug}`;

/**
 * Gives every club its slug and page path, unique within the league (a
 * clash, rare, gets the club id: "nacional-2154"). Clubs sorted by id first,
 * so the same club keeps the same slug whatever order the feed lists them in.
 */
export function withClubPages(league: LeagueConfig, teams: readonly Team[]): Team[] {
  if (!hasClubPages(league)) return [...teams];
  const taken = new Set<string>();
  const slugs = new Map<number, string>();
  const bases = new Map<number, string>();
  for (const team of teams) bases.set(team.id, slugify(team.name) || slugify(team.shortName) || String(team.id));
  const counts = new Map<string, number>();
  for (const base of bases.values()) counts.set(base, (counts.get(base) ?? 0) + 1);
  for (const team of [...teams].sort((a, b) => a.id - b.id)) {
    const base = bases.get(team.id)!;
    let slug = counts.get(base)! > 1 ? `${base}-${team.id}` : base;
    while (taken.has(slug)) slug = `${slug}-${team.id}`;
    taken.add(slug);
    slugs.set(team.id, slug);
  }
  return teams.map((team) => ({ ...team, slug: slugs.get(team.id)!, page: clubPath(league, slugs.get(team.id)!) }));
}
