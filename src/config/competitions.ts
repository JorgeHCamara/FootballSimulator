import { CUPS, getCupBySlug, type CupConfig } from "./cups.ts";
import { LEAGUES, getLeagueBySlug, type FlagCode, type LeagueConfig } from "./leagues.ts";

// Everything with a simulator page: leagues and cups.

export type CompetitionConfig = LeagueConfig | CupConfig;

export const COMPETITIONS: readonly CompetitionConfig[] = [...LEAGUES, ...CUPS];

export const isCup = (competition: CompetitionConfig): competition is CupConfig => "kind" in competition && competition.kind === "cup";

export type Competition = { kind: "league"; league: LeagueConfig } | { kind: "cup"; cup: CupConfig };

export function getCompetitionBySlug(slug: string): Competition | undefined {
  const league = getLeagueBySlug(slug);
  if (league) return { kind: "league", league };
  const cup = getCupBySlug(slug);
  return cup ? { kind: "cup", cup } : undefined;
}

export interface CountryGroup {
  /** English country name, also the translation key (Countries.<country>). */
  country: string;
  flag: FlagCode;
  /** Leagues in config order (top division first), then the country's cups. */
  leagues: CompetitionConfig[];
}

/** Competitions grouped by country, for the header menus. */
export function countries(): CountryGroup[] {
  const groups = new Map<string, CountryGroup>();
  for (const competition of COMPETITIONS) {
    const group = groups.get(competition.country) ?? { country: competition.country, flag: competition.flag, leagues: [] };
    group.leagues.push(competition);
    groups.set(competition.country, group);
  }
  return [...groups.values()];
}
