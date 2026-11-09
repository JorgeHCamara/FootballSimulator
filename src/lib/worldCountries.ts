import { getLeagueByCode, type FlagCode, type LeagueConfig } from "../config/leagues.ts";
import { NATIONAL_LEAGUE_CLUBS } from "../config/nationalLeague.ts";
import { SERIE_C_CLUBS } from "../config/serieC.ts";
import { SERIE_D_CLUBS } from "../config/serieD.ts";

/*
 * The countries My World can play (src/lib/myWorld.ts): each one's leagues
 * (a pyramid, top first), its cups, the league below its bottom division
 * where relegated clubs spend a season, any play-off between two of its
 * divisions and any play-out within one. A world is set up with one or more
 * of them, and plays every competition of each.
 */

export const WORLD_COUNTRIES = ["ENG", "ESP", "GER", "ITA", "BRA", "ARG"] as const;
export type WorldCountry = (typeof WORLD_COUNTRIES)[number];
export const isWorldCountry = (code: string): code is WorldCountry => (WORLD_COUNTRIES as readonly string[]).includes(code);

/** The English pyramid's divisions, top first (league config codes). */
export const ENGLAND = ["PL", "ELC", "EL1", "EL2"] as const;
/** The Spanish pyramid's: La Liga and the Segunda División. */
export const SPAIN = ["PD", "SD"] as const;
/** The German pyramid's: the Bundesliga and the 2. Bundesliga. */
export const GERMANY = ["BL1", "BL2"] as const;
/** The Italian pyramid's: Serie A and Serie B. */
export const ITALY = ["SA", "SB"] as const;
/** The Brazilian pyramid's: Série A, Série B and Série C (src/lib/worldSerieC.ts). */
export const BRAZIL = ["BSA", "BSB", "BSC"] as const;
/** The Argentine pyramid's: the Liga Profesional and the Primera Nacional, both played in zones (src/lib/worldZones.ts). */
export const ARGENTINA = ["ARG", "PN"] as const;
/** Every league a world can play, country by country. */
export const WORLD_LEAGUES = [...ENGLAND, ...SPAIN, ...GERMANY, ...ITALY, ...BRAZIL, ...ARGENTINA] as const;
export type DivisionCode = (typeof WORLD_LEAGUES)[number];

export const COUNTRY_LEAGUES: Record<WorldCountry, readonly DivisionCode[]> = { ENG: ENGLAND, ESP: SPAIN, GER: GERMANY, ITA: ITALY, BRA: BRAZIL, ARG: ARGENTINA };
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
 * National League, Spain's Primera Federación, Germany's 3. Liga, Italy's
 * Serie C, Brazil's Série D, Argentina's third tier (the Primera B
 * Metropolitana and the Torneo Federal A). Codes for the messages
 * (World.leagues.NL, World.leagues.PF…) and a club's seasons list.
 */
export const LOWER_LEAGUE = { ENG: "NL", ESP: "PF", GER: "L3", ITA: "SC", BRA: "BSD", ARG: "AR3" } as const;
export type LowerCode = (typeof LOWER_LEAGUE)[WorldCountry];

/** A real club a world starts with in the league below a country's bottom division (src/config/nationalLeague.ts, src/config/serieC.ts). */
export interface LowerLeagueClub {
  /** Its id in ESPN's data (absent for a club ESPN doesn't have). */
  espnId?: number;
  name: string;
  shortName: string;
  tla: string;
  crest?: string;
}
/**
 * The clubs each country's league below starts with: England's two National
 * League clubs, Italy's four Serie C clubs (as many as Serie B relegates, so
 * its first swap needs no fictional club); none in Spain and Germany, whose
 * first relegated clubs swap with sides from the cup pool (Argentina's too:
 * the Copa Argentina's Primera B, Federal A and Primera C clubs). In a fixed order:
 * a club's world id is its place in the whole list (src/lib/myWorld.ts).
 */
export const LOWER_LEAGUE_CLUBS: Record<WorldCountry, readonly LowerLeagueClub[]> = { ENG: NATIONAL_LEAGUE_CLUBS, ESP: [], GER: [], ITA: SERIE_C_CLUBS, BRA: SERIE_D_CLUBS, ARG: [] };

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

/**
 * A relegation play-out within a division, after its season: its two places
 * over two legs (the better-placed club hosts the second leg and stays up if
 * level on aggregate), the loser relegated with the division's relegation
 * places. Not played when the two finish `gap` or more points apart: the
 * lower-placed club goes straight down. Serie B: 16th v 17th, five points.
 */
export interface Playout {
  code: DivisionCode;
  /** The better-placed club's place, and the other's. */
  places: [number, number];
  gap: number;
}
export const PLAYOUTS: readonly Playout[] = [{ code: "SB", places: [16, 17], gap: 5 }];
export const playoutOf = (code: string): Playout | undefined => PLAYOUTS.find((p) => p.code === code);

/** Each country's cups (src/lib/worldCups.ts), in the order shown. */
export const WORLD_CUPS = ["FAC", "EFC", "CDR", "DFB", "CIT", "CDB", "CAR"] as const;
export type WorldCupCode = (typeof WORLD_CUPS)[number];
export const COUNTRY_CUPS: Record<WorldCountry, readonly WorldCupCode[]> = { ENG: ["FAC", "EFC"], ESP: ["CDR"], GER: ["DFB"], ITA: ["CIT"], BRA: ["CDB"], ARG: ["CAR"] };
export const isWorldCup = (code: string): code is WorldCupCode => (WORLD_CUPS as readonly string[]).includes(code);
export const cupCountry = (code: WorldCupCode): WorldCountry => WORLD_COUNTRIES.find((c) => COUNTRY_CUPS[c].includes(code))!;
/** The cups a world with these countries plays, in the countries' order. */
export const worldCups = (countries: readonly WorldCountry[]): WorldCupCode[] => countries.flatMap((c) => [...COUNTRY_CUPS[c]]);

export const COUNTRY_FLAG: Record<WorldCountry, FlagCode> = { ENG: "gb-eng", ESP: "es", GER: "de", ITA: "it", BRA: "br", ARG: "ar" };

/** Countries whose seasons follow the calendar year (Brazil's and Argentina's 2026 season, not "2026/27"). */
export const CALENDAR_YEAR: readonly WorldCountry[] = ["BRA", "ARG"];
/** A season's label for these countries: "2026" when every one plays the calendar year, else "2026/27". */
export const seasonLabelFor = (countries: readonly WorldCountry[], year: number) =>
  countries.length > 0 && countries.every((c) => CALENDAR_YEAR.includes(c)) ? String(year) : `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
