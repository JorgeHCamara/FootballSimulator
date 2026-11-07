import { getLeagueByCode, type FlagCode, type LeagueConfig } from "../config/leagues.ts";

/*
 * The countries My World can play (src/lib/myWorld.ts): each one's leagues
 * (a pyramid, top first), its cups, and the league below its bottom division
 * where relegated clubs spend a season. A world is set up with one or more of
 * them, and plays every competition of each.
 */

export const WORLD_COUNTRIES = ["ENG", "ESP"] as const;
export type WorldCountry = (typeof WORLD_COUNTRIES)[number];
export const isWorldCountry = (code: string): code is WorldCountry => (WORLD_COUNTRIES as readonly string[]).includes(code);

/** The English pyramid's divisions, top first (league config codes). */
export const ENGLAND = ["PL", "ELC", "EL1", "EL2"] as const;
/** The Spanish pyramid's: La Liga and the Segunda División. */
export const SPAIN = ["PD", "SD"] as const;
/** Every league a world can play, country by country. */
export const WORLD_LEAGUES = [...ENGLAND, ...SPAIN] as const;
export type DivisionCode = (typeof WORLD_LEAGUES)[number];

export const COUNTRY_LEAGUES: Record<WorldCountry, readonly DivisionCode[]> = { ENG: ENGLAND, ESP: SPAIN };
export const isDivision = (code: string): code is DivisionCode => (WORLD_LEAGUES as readonly string[]).includes(code);
export const divisionConfig = (code: DivisionCode): LeagueConfig => getLeagueByCode(code)!;
export const divisionCountry = (code: DivisionCode): WorldCountry => ((ENGLAND as readonly string[]).includes(code) ? "ENG" : "ESP");
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
export const LOWER_LEAGUE = { ENG: "NL", ESP: "PF" } as const;
export type LowerCode = (typeof LOWER_LEAGUE)[WorldCountry];

/** Each country's cups (src/lib/worldCups.ts), in the order shown. */
export const WORLD_CUPS = ["FAC", "EFC", "CDR"] as const;
export type WorldCupCode = (typeof WORLD_CUPS)[number];
export const COUNTRY_CUPS: Record<WorldCountry, readonly WorldCupCode[]> = { ENG: ["FAC", "EFC"], ESP: ["CDR"] };
export const isWorldCup = (code: string): code is WorldCupCode => (WORLD_CUPS as readonly string[]).includes(code);
export const cupCountry = (code: WorldCupCode): WorldCountry => (COUNTRY_CUPS.ENG.includes(code) ? "ENG" : "ESP");
/** The cups a world with these countries plays, in the countries' order. */
export const worldCups = (countries: readonly WorldCountry[]): WorldCupCode[] => countries.flatMap((c) => [...COUNTRY_CUPS[c]]);

export const COUNTRY_FLAG: Record<WorldCountry, FlagCode> = { ENG: "gb-eng", ESP: "es" };
