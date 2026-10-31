import type { Tiebreaker } from "../engine/types.ts";

export type ZoneKind =
  | "championsLeague"
  | "championsLeagueQualifying"
  | "europaLeague"
  | "conferenceLeague"
  | "libertadores"
  | "libertadoresQualifying"
  | "sudamericana"
  | "promotion"
  | "promotionPlayoff"
  | "relegationPlayoff"
  | "relegation";

export interface Zone {
  kind: ZoneKind;
  /** 1-based, inclusive. */
  from: number;
  to: number;
}

/** Competition codes (football-data.org codes, plus BSB for Brasileirão Série B). */
export type CompetitionCode = "PL" | "PD" | "BL1" | "SA" | "FL1" | "BSA" | "BSB";

/** Where a league's real data comes from. */
export type DataSource = { provider: "football-data" } | { provider: "espn"; slug: string };

export type FlagCode = "gb-eng" | "es" | "de" | "it" | "fr" | "br";

export type SiteLocale = "en" | "pt" | "es";

export interface LeagueConfig {
  code: CompetitionCode;
  slug: string;
  name: string;
  country: string;
  flag: FlagCode;
  /** Localized page heading / SEO name, e.g. "Simulador do Brasileirão". */
  simulatorName: Record<SiteLocale, string>;
  /** How people also search for the league, e.g. "Campeonato Brasileiro". */
  aka: Record<SiteLocale, string>;
  teams: number;
  /** Defaults to football-data.org with `code` as the competition code. */
  source?: DataSource;
  /**
   * End-of-season two-legged promotion play-off: table positions paired
   * better-placed first; that club hosts the second leg and goes through on a
   * level aggregate. `directPromotion` are the positions promoted without it.
   */
  playoff?: {
    ties: readonly (readonly [number, number])[];
    directPromotion: readonly number[];
    promotedTo: string;
  };
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
    flag: "gb-eng",
    simulatorName: { en: "Premier League Simulator", pt: "Simulador da Premier League", es: "Simulador de la Premier League" },
    aka: { en: "Premier League", pt: "Campeonato Inglês", es: "Liga inglesa" },
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
    flag: "es",
    simulatorName: { en: "La Liga Simulator", pt: "Simulador da La Liga", es: "Simulador de LaLiga" },
    aka: { en: "Spanish La Liga", pt: "Campeonato Espanhol", es: "Liga española" },
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
    flag: "de",
    simulatorName: { en: "Bundesliga Simulator", pt: "Simulador da Bundesliga", es: "Simulador de la Bundesliga" },
    aka: { en: "German Bundesliga", pt: "Campeonato Alemão", es: "Liga alemana" },
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
    flag: "it",
    simulatorName: { en: "Serie A Simulator", pt: "Simulador da Serie A", es: "Simulador de la Serie A" },
    aka: { en: "Italian Serie A", pt: "Campeonato Italiano", es: "Liga italiana" },
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
    flag: "fr",
    simulatorName: { en: "Ligue 1 Simulator", pt: "Simulador da Ligue 1", es: "Simulador de la Ligue 1" },
    aka: { en: "French Ligue 1", pt: "Campeonato Francês", es: "Liga francesa" },
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
    flag: "br",
    simulatorName: { en: "Brasileirão Simulator", pt: "Simulador do Brasileirão", es: "Simulador del Brasileirão" },
    aka: { en: "Brazilian Série A", pt: "Campeonato Brasileiro", es: "Liga brasileña" },
    teams: 20,
    tiebreakers: ["points", "wins", "goalDifference", "goalsFor", "headToHeadPoints"],
    zones: [
      { kind: "libertadores", from: 1, to: 4 },
      { kind: "libertadoresQualifying", from: 5, to: 5 },
      { kind: "sudamericana", from: 6, to: 11 },
      { kind: "relegation", from: 17, to: 20 },
    ],
  },
  {
    code: "BSB",
    slug: "brasileirao-serie-b",
    name: "Brasileirão Série B",
    country: "Brazil",
    flag: "br",
    simulatorName: { en: "Série B Simulator", pt: "Simulador da Série B", es: "Simulador de la Série B" },
    aka: { en: "Brasileirão Série B", pt: "Campeonato Brasileiro Série B", es: "Serie B de Brasil" },
    teams: 20,
    // football-data.org's free tier doesn't include Série B.
    source: { provider: "espn", slug: "bra.2" },
    // Série B 2026: 3rd v 6th and 4th v 5th; the winners join 1st and 2nd in Série A.
    playoff: { ties: [[3, 6], [4, 5]], directPromotion: [1, 2], promotedTo: "Série A" },
    tiebreakers: ["points", "wins", "goalDifference", "goalsFor", "headToHeadPoints"],
    zones: [
      { kind: "promotion", from: 1, to: 2 },
      { kind: "promotionPlayoff", from: 3, to: 6 },
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
