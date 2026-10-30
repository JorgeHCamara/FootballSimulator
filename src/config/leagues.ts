import type { Tiebreaker } from "../engine/types.ts";

export type ZoneKind =
  | "championsLeague"
  | "championsLeagueQualifying"
  | "europaLeague"
  | "conferenceLeague"
  | "libertadores"
  | "libertadoresQualifying"
  | "sudamericana"
  | "relegationPlayoff"
  | "relegation";

export interface Zone {
  kind: ZoneKind;
  /** 1-based, inclusive. */
  from: number;
  to: number;
}

/** football-data.org competition codes for the launch leagues. */
export type CompetitionCode = "PL" | "PD" | "BL1" | "SA" | "FL1" | "BSA";

export interface LeagueConfig {
  code: CompetitionCode;
  slug: string;
  name: string;
  country: string;
  teams: number;
  tiebreakers: readonly Tiebreaker[];
  /**
   * Default qualification/relegation zones. Real allocations shift with domestic
   * cup winners and UEFA/CONMEBOL coefficients, so treat these as the base case.
   */
  zones: readonly Zone[];
}

export const LEAGUES: readonly LeagueConfig[] = [
  {
    code: "PL",
    slug: "premier-league",
    name: "Premier League",
    country: "England",
    teams: 20,
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints", "headToHeadAwayGoalsFor"],
    zones: [
      { kind: "championsLeague", from: 1, to: 4 },
      { kind: "europaLeague", from: 5, to: 5 },
      { kind: "conferenceLeague", from: 6, to: 6 },
      { kind: "relegation", from: 18, to: 20 },
    ],
  },
  {
    code: "PD",
    slug: "la-liga",
    name: "La Liga",
    country: "Spain",
    teams: 20,
    tiebreakers: ["points", "headToHeadPoints", "headToHeadGoalDifference", "goalDifference", "goalsFor"],
    zones: [
      { kind: "championsLeague", from: 1, to: 4 },
      { kind: "europaLeague", from: 5, to: 6 },
      { kind: "conferenceLeague", from: 7, to: 7 },
      { kind: "relegation", from: 18, to: 20 },
    ],
  },
  {
    code: "BL1",
    slug: "bundesliga",
    name: "Bundesliga",
    country: "Germany",
    teams: 18,
    tiebreakers: [
      "points",
      "goalDifference",
      "goalsFor",
      "headToHeadPoints",
      "headToHeadAwayGoalsFor",
      "awayGoalsFor",
    ],
    zones: [
      { kind: "championsLeague", from: 1, to: 4 },
      { kind: "europaLeague", from: 5, to: 5 },
      { kind: "conferenceLeague", from: 6, to: 6 },
      { kind: "relegationPlayoff", from: 16, to: 16 },
      { kind: "relegation", from: 17, to: 18 },
    ],
  },
  {
    code: "SA",
    slug: "serie-a",
    name: "Serie A",
    country: "Italy",
    teams: 20,
    tiebreakers: ["points", "headToHeadPoints", "headToHeadGoalDifference", "goalDifference", "goalsFor"],
    zones: [
      { kind: "championsLeague", from: 1, to: 4 },
      { kind: "europaLeague", from: 5, to: 5 },
      { kind: "conferenceLeague", from: 6, to: 6 },
      { kind: "relegation", from: 18, to: 20 },
    ],
  },
  {
    code: "FL1",
    slug: "ligue-1",
    name: "Ligue 1",
    country: "France",
    teams: 18,
    tiebreakers: [
      "points",
      "goalDifference",
      "headToHeadPoints",
      "headToHeadGoalDifference",
      "headToHeadGoalsFor",
      "goalsFor",
    ],
    zones: [
      { kind: "championsLeague", from: 1, to: 3 },
      { kind: "championsLeagueQualifying", from: 4, to: 4 },
      { kind: "europaLeague", from: 5, to: 5 },
      { kind: "conferenceLeague", from: 6, to: 6 },
      { kind: "relegationPlayoff", from: 16, to: 16 },
      { kind: "relegation", from: 17, to: 18 },
    ],
  },
  {
    code: "BSA",
    slug: "brasileirao",
    name: "Brasileirão Série A",
    country: "Brazil",
    teams: 20,
    tiebreakers: ["points", "wins", "goalDifference", "goalsFor", "headToHeadPoints"],
    zones: [
      { kind: "libertadores", from: 1, to: 4 },
      { kind: "libertadoresQualifying", from: 5, to: 6 },
      { kind: "sudamericana", from: 7, to: 12 },
      { kind: "relegation", from: 17, to: 20 },
    ],
  },
];

export function getLeagueBySlug(slug: string): LeagueConfig | undefined {
  return LEAGUES.find((l) => l.slug === slug);
}

export function getLeagueByCode(code: string): LeagueConfig | undefined {
  return LEAGUES.find((l) => l.code === code);
}

export function zoneForPosition(league: LeagueConfig, position: number): Zone | undefined {
  return league.zones.find((z) => position >= z.from && position <= z.to);
}
