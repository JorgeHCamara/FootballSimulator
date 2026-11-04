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

export type Continent = "Europe" | "South America" | "North America" | "Asia";

/** Continent order in the menus. */
export const CONTINENTS: readonly Continent[] = ["Europe", "South America", "North America", "Asia"];

/** Continent of each country (by English name, as in the configs); "UEFA" holds the continental competitions. */
const CONTINENT_OF: Record<string, Continent> = {
  UEFA: "Europe",
  England: "Europe",
  Spain: "Europe",
  Germany: "Europe",
  Italy: "Europe",
  France: "Europe",
  Portugal: "Europe",
  Netherlands: "Europe",
  Scotland: "Europe",
  Turkey: "Europe",
  Belgium: "Europe",
  Greece: "Europe",
  Austria: "Europe",
  CONMEBOL: "South America",
  Brazil: "South America",
  Argentina: "South America",
  Chile: "South America",
  Colombia: "South America",
  Uruguay: "South America",
  Paraguay: "South America",
  Ecuador: "South America",
  Peru: "South America",
  USA: "North America",
  Mexico: "North America",
  "Saudi Arabia": "Asia",
  Japan: "Asia",
};

export function continentOf(country: string): Continent {
  const continent = CONTINENT_OF[country];
  if (!continent) throw new Error(`No continent for ${country}`);
  return continent;
}

export interface ContinentGroup {
  /** English continent name, also the translation key (Continents.<continent>). */
  continent: Continent;
  /** The continent's countries; a continental federation ("UEFA") is one of them. */
  countries: CountryGroup[];
}

/** Countries grouped by continent, in menu order (countries in config order). */
export function continents(): ContinentGroup[] {
  const groups = countries();
  return CONTINENTS.map((continent) => ({ continent, countries: groups.filter((g) => continentOf(g.country) === continent) })).filter(
    (g) => g.countries.length > 0,
  );
}
