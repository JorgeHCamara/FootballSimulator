import type { PlayoffConfig } from "../engine/playoffs.ts";
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
export type CompetitionCode = "PL" | "ELC" | "PD" | "BL1" | "SA" | "FL1" | "PPL" | "DED" | "BSA" | "BSB";

/** A league on ESPN's public feed. */
export interface EspnFeed {
  /** ESPN's league slug, e.g. "eng.1". */
  slug: string;
  /** "split" seasons run August–May (2026/27); "calendar" seasons run within one year. */
  seasons: "split" | "calendar";
}

export type FlagCode = "gb-eng" | "es" | "de" | "it" | "fr" | "pt" | "nl" | "br";

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
  /**
   * Real data comes from ESPN and falls back to football-data.org (with `code`
   * as the competition code); leagues outside football-data.org's free tier set
   * `espnOnly`.
   */
  espn: EspnFeed;
  espnOnly?: boolean;
  /** End-of-season promotion play-off (see src/engine/playoffs.ts). */
  playoff?: PlayoffConfig;
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
    espn: { slug: "eng.1", seasons: "split" },
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints", "headToHeadAwayGoalsFor"],
    zones: [
      { kind: "championsLeague", from: 1, to: 4 },
      { kind: "europaLeague", from: 5, to: 5 },
      { kind: "conferenceLeague", from: 6, to: 6 },
      { kind: "relegation", from: 18, to: 20 },
    ],
  },
  {
    code: "ELC",
    slug: "championship",
    name: "Championship",
    country: "England",
    flag: "gb-eng",
    simulatorName: { en: "Championship Simulator", pt: "Simulador da Championship", es: "Simulador de la Championship" },
    aka: { en: "EFL Championship", pt: "Segunda divisão inglesa", es: "Segunda división inglesa" },
    teams: 24,
    espn: { slug: "eng.2", seasons: "split" },
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints", "headToHeadAwayGoalsFor"],
    zones: [
      { kind: "promotion", from: 1, to: 2 },
      { kind: "promotionPlayoff", from: 3, to: 8 },
      { kind: "relegation", from: 22, to: 24 },
    ],
    // 2026/27 format: 3rd–8th in the play-offs. Single-leg eliminators (5th v 8th,
    // 6th v 7th) at the better-placed club; two-legged semi-finals with 3rd and 4th
    // (3rd v the lowest-placed winner, 3rd/4th host the second leg); final at
    // Wembley. Level ties: extra time and penalties.
    playoff: {
      rounds: [
        { key: "eliminators", legs: 1, levelTie: "penalties", pairs: [[5, 8], [6, 7]] },
        { key: "semiFinals", legs: 2, levelTie: "penalties", entrants: [3, 4] },
        { key: "final", legs: 1, levelTie: "penalties", venue: "Wembley" },
      ],
      directPromotion: [1, 2],
      promotedTo: "Premier League",
    },
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
    espn: { slug: "esp.1", seasons: "split" },
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
    espn: { slug: "ger.1", seasons: "split" },
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
    espn: { slug: "ita.1", seasons: "split" },
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
    espn: { slug: "fra.1", seasons: "split" },
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
    code: "PPL",
    slug: "primeira-liga",
    name: "Primeira Liga",
    country: "Portugal",
    flag: "pt",
    simulatorName: { en: "Primeira Liga Simulator", pt: "Simulador da Primeira Liga", es: "Simulador de la Primeira Liga" },
    aka: { en: "Liga Portugal", pt: "Campeonato Português", es: "Liga portuguesa" },
    teams: 18,
    espn: { slug: "por.1", seasons: "split" },
    tiebreakers: ["points", "headToHeadPoints", "headToHeadGoalDifference", "goalDifference", "goalsFor"],
    zones: [
      { kind: "championsLeague", from: 1, to: 1 },
      { kind: "championsLeagueQualifying", from: 2, to: 2 },
      { kind: "europaLeague", from: 3, to: 3 },
      { kind: "conferenceLeague", from: 4, to: 4 },
      { kind: "relegationPlayoff", from: 16, to: 16 },
      { kind: "relegation", from: 17, to: 18 },
    ],
  },
  {
    code: "DED",
    slug: "eredivisie",
    name: "Eredivisie",
    country: "Netherlands",
    flag: "nl",
    simulatorName: { en: "Eredivisie Simulator", pt: "Simulador da Eredivisie", es: "Simulador de la Eredivisie" },
    aka: { en: "Dutch Eredivisie", pt: "Campeonato Holandês", es: "Liga neerlandesa" },
    teams: 18,
    espn: { slug: "ned.1", seasons: "split" },
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints", "headToHeadGoalDifference"],
    zones: [
      { kind: "championsLeague", from: 1, to: 1 },
      { kind: "championsLeagueQualifying", from: 2, to: 2 },
      { kind: "europaLeague", from: 3, to: 3 },
      { kind: "conferenceLeague", from: 4, to: 4 },
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
    espn: { slug: "bra.1", seasons: "calendar" },
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
    aka: { en: "Brasileirão Série B", pt: "Brasileiro Série B", es: "Serie B de Brasil" },
    teams: 20,
    // football-data.org's free tier doesn't include Série B.
    espn: { slug: "bra.2", seasons: "calendar" },
    espnOnly: true,
    // Série B 2026: 3rd v 6th and 4th v 5th; the winners join 1st and 2nd in Série A.
    playoff: {
      rounds: [{ key: "semiFinals", legs: 2, levelTie: "betterPlaced", pairs: [[3, 6], [4, 5]] }],
      directPromotion: [1, 2],
      promotedTo: "Série A",
    },
    tiebreakers: ["points", "wins", "goalDifference", "goalsFor", "headToHeadPoints"],
    zones: [
      { kind: "promotion", from: 1, to: 2 },
      { kind: "promotionPlayoff", from: 3, to: 6 },
      { kind: "relegation", from: 17, to: 20 },
    ],
  },
];

export interface CountryGroup {
  /** English country name, also the translation key (Countries.<country>). */
  country: string;
  flag: FlagCode;
  /** In config order, which is top division first. */
  leagues: LeagueConfig[];
}

/** Leagues grouped by country, for the header menu. */
export function countries(): CountryGroup[] {
  const groups = new Map<string, CountryGroup>();
  for (const league of LEAGUES) {
    const group = groups.get(league.country) ?? { country: league.country, flag: league.flag, leagues: [] };
    group.leagues.push(league);
    groups.set(league.country, group);
  }
  return [...groups.values()];
}

export function getLeagueBySlug(slug: string): LeagueConfig | undefined {
  return LEAGUES.find((l) => l.slug === slug);
}

export function getLeagueByCode(code: string): LeagueConfig | undefined {
  return LEAGUES.find((l) => l.code === code);
}

export function zoneForPosition(league: LeagueConfig, position: number): Zone | undefined {
  return league.zones.find((z) => position >= z.from && position <= z.to);
}
