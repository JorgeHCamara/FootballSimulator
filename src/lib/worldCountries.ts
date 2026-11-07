import { getLeagueByCode, type FlagCode, type LeagueConfig } from "../config/leagues.ts";

/*
 * The countries My World can play (src/lib/myWorld.ts): each one's leagues
 * (a pyramid, top first), its cups, the league below its bottom division
 * where relegated clubs spend a season, and any play-off between two of its
 * divisions. A world is set up with one or more of them, and plays every
 * competition of each.
 */

export const WORLD_COUNTRIES = ["ENG", "ESP", "GER"] as const;
export type WorldCountry = (typeof WORLD_COUNTRIES)[number];
export const isWorldCountry = (code: string): code is WorldCountry => (WORLD_COUNTRIES as readonly string[]).includes(code);

/** The English pyramid's divisions, top first (league config codes). */
export const ENGLAND = ["PL", "ELC", "EL1", "EL2"] as const;
/** The Spanish pyramid's: La Liga and the Segunda División. */
export const SPAIN = ["PD", "SD"] as const;
/** The German pyramid's: the Bundesliga and the 2. Bundesliga. */
export const GERMANY = ["BL1", "BL2"] as const;
/** Every league a world can play, country by country. */
export const WORLD_LEAGUES = [...ENGLAND, ...SPAIN, ...GERMANY] as const;
export type DivisionCode = (typeof WORLD_LEAGUES)[number];

export const COUNTRY_LEAGUES: Record<WorldCountry, readonly DivisionCode[]> = { ENG: ENGLAND, ESP: SPAIN, GER: GERMANY };
export const isDivision = (code: string): code is DivisionCode => (WORLD_LEAGUES as readonly string[]).includes(code);
export const divisionConfig = (code: DivisionCode): LeagueConfig => getLeagueByCode(code)!;
export const divisionCountry = (code: DivisionCode): WorldCountry => WORLD_COUNTRIES.find((c) => (COUNTRY_LEAGUES[c] as readonly string[]).includes(code))!;
/** The divisions a world with these countries plays, in the countries' order, each top first. */
export const worldDivisions = (countries: readonly WorldCountry[]): DivisionCode[] => countries.flatMap((c) => [...COUNTRY_LEAGUES[c]]);
/** The divisions above and below one, within its country. */
export function neighbours(code: DivisionCode): { above?: DivisionCode; below?: DivisionCode } {
  const leagues = COUNTRY_LEAGUES[divisionCountry(code)];
  const i = leagues.indexOf(code);
  return { ...(i > 0 ? { above: leagues[i - 1] } : {}), ...(i < leagues.length - 1 ? { below: leagues[i + 1] } : {}) };
}

/**
 * The league below each country's bottom division, where its relegated clubs
 * spend a season before coming back up (src/lib/myWorld.ts): England's
 * National League, Spain's Primera Federación. Codes for the messages
 * (World.leagues.NL, World.leagues.PF) and a club's seasons list.
 */
export const LOWER_LEAGUE = { ENG: "NL", ESP: "PF", GER: "L3" } as const;
export type LowerCode = (typeof LOWER_LEAGUE)[WorldCountry];

/**
 * A play-off for one place between a country's two divisions, over two legs
 * after both leagues' seasons (Germany's Relegation: the Bundesliga's 16th,
 * which hosts the first leg, against the 2. Bundesliga's 3rd; level on
 * aggregate, extra time and penalties). The winner plays in the upper division
 * next season. It shows as the lower division's play-off.
 */
export interface PyramidPlayoff {
  upper: DivisionCode;
  lower: DivisionCode;
  upperPlace: number;
  lowerPlace: number;
}
export const PYRAMID_PLAYOFFS: readonly PyramidPlayoff[] = [{ upper: "BL1", lower: "BL2", upperPlace: 16, lowerPlace: 3 }];
/** The pyramid play-off a division takes part in, as its upper or lower side. */
export const pyramidPlayoffOf = (code: string): PyramidPlayoff | undefined => PYRAMID_PLAYOFFS.find((p) => p.upper === code || p.lower === code);

/** Each country's cups (src/lib/worldCups.ts), in the order shown. */
export const WORLD_CUPS = ["FAC", "EFC", "CDR", "DFB"] as const;
export type WorldCupCode = (typeof WORLD_CUPS)[number];
export const COUNTRY_CUPS: Record<WorldCountry, readonly WorldCupCode[]> = { ENG: ["FAC", "EFC"], ESP: ["CDR"], GER: ["DFB"] };
export const isWorldCup = (code: string): code is WorldCupCode => (WORLD_CUPS as readonly string[]).includes(code);
export const cupCountry = (code: WorldCupCode): WorldCountry => WORLD_COUNTRIES.find((c) => COUNTRY_CUPS[c].includes(code))!;
/** The cups a world with these countries plays, in the countries' order. */
export const worldCups = (countries: readonly WorldCountry[]): WorldCupCode[] => countries.flatMap((c) => [...COUNTRY_CUPS[c]]);

export const COUNTRY_FLAG: Record<WorldCountry, FlagCode> = { ENG: "gb-eng", ESP: "es", GER: "de" };
