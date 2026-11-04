import type { SplitGroupConfig } from "../engine/split.ts";
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
  | "relegation"
  | "playoffs"
  | "playoffWildCard"
  | "title"
  | "aclElite"
  | "aclEliteQualifying"
  | "aclTwo"
  | "gulfClub"
  | "splitTitle"
  | "splitMiddle"
  | "splitRelegation"
  | "championshipPlayoffs"
  | "europePlayoffs"
  | "relegationPlayouts"
  | "titlePlayoffs"
  | "knockoutRoundOf16"
  | "knockoutPlayoff"
  | "eliminated";

export interface Zone {
  kind: ZoneKind;
  /** 1-based, inclusive. */
  from: number;
  to: number;
}

/** Competition codes (football-data.org codes, plus BSB for Brasileirão Série B and MLS). */
export type CompetitionCode = "PL" | "ELC" | "EL1" | "EL2" | "PD" | "SD" | "BL1" | "BL2" | "SA" | "SB" | "FL1" | "FL2" | "DJL" | "PPL" | "DED" | "BSA" | "BSB" | "MLS" | "UCL" | "UEL" | "UECL" | "LIB" | "SUD" | "ARG" | "CHI" | "COL" | "URU" | "PAR" | "MX" | "ECU" | "PER" | "SPL" | "J1" | "SPFL" | "TSL" | "BPL" | "GSL";

/** A league on ESPN's public feed. */
export interface EspnFeed {
  /** ESPN's league slug, e.g. "eng.1". */
  slug: string;
  /** "split" seasons run August–May (2026/27); "calendar" seasons run within one year. */
  seasons: "split" | "calendar";
  /**
   * Leagues without fixed rounds (MLS: unbalanced schedule, midweek games) list
   * fixtures by calendar week instead of rebuilt rounds.
   */
  weeklyRounds?: boolean;
  /**
   * Split the season by ESPN's stage tags (`season.slug`) instead of by game
   * counts: the table's stage, and the knockout stages after it. Other stages
   * (qualifying rounds before a group stage) are left out.
   */
  stages?: EspnStages | readonly EspnStages[];
  /** Apply the points deductions in ESPN's standings (current table only; Peru). */
  deductions?: boolean;
}

/**
 * One tournament within an ESPN season: its table stage and the knockout
 * stages after it. A season with several (Argentina: Apertura, then
 * Clausura) lists them latest first; the latest one under way is shown.
 */
export interface EspnStages {
  /** ESPN's stage tag of the table; also matches it with a year ("torneo-apertura-2026"). */
  table: string;
  knockout: readonly string[];
  /** Tournament name for the season label, e.g. "Clausura" ("Clausura 2026"). */
  name?: string;
  /**
   * Year shown with the name, from the season's starting year (a split season:
   * Liga MX's "Apertura 2026" is +0, its "Clausura 2027" +1); the season label otherwise.
   */
  yearOffset?: number;
  /** This tournament's own format, when it differs from the league's (Uruguay's Intermedio). */
  gamesPerTeam?: number;
  zones?: readonly Zone[];
  /** Its own play-off, or null for none. */
  playoff?: PlayoffConfig | null;
  /** Separate tables, recognised from who plays whom (not in ESPN's standings for past tournaments). */
  groups?: readonly LeagueGroup[];
}

/** True when an ESPN stage tag is this table's, with or without a year. */
export const isStage = (slug: string | undefined, table: string) => slug === table || (slug !== undefined && new RegExp(`^${table}-\\d{4}$`).test(slug));

/** A separate table within a league, e.g. an MLS conference. */
export interface LeagueGroup {
  id: string;
  /** Short name for play-off slots, e.g. "1st in the East". */
  shortName: Record<SiteLocale, string>;
  /** Matched against the group names in ESPN's standings feed. */
  espnName: string;
  name: Record<SiteLocale, string>;
  /** This table's own zones (Ecuador's final-stage groups), instead of the league's. */
  zones?: readonly Zone[];
}

export type FlagCode = "gb-eng" | "es" | "de" | "it" | "fr" | "pt" | "nl" | "br" | "us" | "eu" | "conmebol" | "ar" | "cl" | "co" | "uy" | "py" | "mx" | "ec" | "pe" | "sa" | "jp" | "gb-sct" | "tr" | "be" | "gr";

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
  /** League games per club; defaults to a double round robin, (teams − 1) × 2. */
  gamesPerTeam?: number;
  /** Separate tables (MLS conferences); zones then apply within each group. */
  groups?: readonly LeagueGroup[];
  /**
   * The groups only exist for part of the season (Ecuador: after the first
   * stage splits the table); until ESPN's standings show them, one table.
   */
  groupsOptional?: boolean;
  /**
   * A split league (Scotland, Greece, Ecuador): after round `afterRound` (by
   * default the last round published, for leagues whose groups come from
   * ESPN) the table cuts into `groups`, which stay apart (see
   * StandingsOptions.split). Until the split's real fixtures are published,
   * they are generated from the table once the first phase is complete.
   */
  split?: {
    afterRound?: number;
    groups: readonly SplitGroupConfig[];
    /** Places over the whole season, for the chances before the split (each group's own zones after it). */
    finalZones?: Zone[];
    /** ESPN's stage tag of the first phase's games (postponed ones can be played during the split). */
    espnStage?: string;
    /** The first phase's tab once split ("Regular season" by default), and on phones. */
    firstPhaseName?: Record<SiteLocale, string>;
    firstPhaseShortName?: Record<SiteLocale, string>;
  };
  /**
   * Real data comes from ESPN and falls back to football-data.org (with `code`
   * as the competition code); leagues outside football-data.org's free tier set
   * `espnOnly`.
   */
  espn: EspnFeed;
  espnOnly?: boolean;
  /**
   * Reserve sides, which can't be promoted or play the play-off, by the start of
   * their name (Eerste Divisie: "Jong "; Segunda División: "Real Sociedad II").
   * Promotion places and play-off seeds then count first teams only.
   */
  reserveTeams?: readonly string[];
  /** End-of-season promotion play-off (see src/engine/playoffs.ts). */
  playoff?: PlayoffConfig;
  tiebreakers: readonly Tiebreaker[];
  /**
   * Default qualification/relegation zones. Real allocations shift with domestic
   * cup winners and UEFA/CONMEBOL coefficients, so treat these as the base case.
   */
  zones: readonly Zone[];
  /**
   * A continental competition (UEFA): clubs from many leagues, so each club's
   * rating starts from its domestic league (see src/lib/continental.ts).
   */
  continental?: ContinentalConfig;
  /**
   * A season of several tournaments (Argentina) also has an annual table of
   * every club over all of them, which decides the continental places and
   * relegation.
   */
  annual?: {
    name: Record<SiteLocale, string>;
    zones: readonly Zone[];
    /** Tournament champions qualify for the first zone's competition anyway: their places pass down (Argentina, Colombia, Paraguay). */
    championsQualify?: boolean;
    /** The real play-off games count in the annual table too (Colombia's reclasificación). */
    includePostseason?: boolean;
  };
}

export interface ContinentalConfig {
  /**
   * Rating tier (as in a cup: 0 = Premier League level, see cupModel.ts) of
   * clubs from leagues the site doesn't cover; they are mostly their league's
   * best, so the stronger the competition, the higher they start.
   */
  outsiderTier: number;
}

/**
 * UEFA knockout phase (2024– format), seeded from the league-phase table:
 * 1st–8th go to the round of 16; 9th–24th play a two-legged knockout play-off,
 * seeded 9th–16th v unseeded 17th–24th (drawn: 9/10 v 23/24, 11/12 v 21/22,
 * 13/14 v 19/20, 15/16 v 17/18). The draw then fixes the bracket: 1/2 meet the
 * 15–18 winners, 3/4 the 13/14–19/20 winners and so on, and the paths cross as
 * 1/2 v 7/8 and 3/4 v 5/6 in the quarter-finals. The better-placed club hosts
 * the second leg; level on aggregate: extra time and penalties. The projected
 * pairings below are one possible draw, replaced by the real one when known.
 */
const UEFA_KNOCKOUT = (venue: string, title: string): PlayoffConfig => ({
  rounds: [
    {
      key: "knockoutPlayoff",
      legs: 2,
      levelTie: "penalties",
      drawn: true,
      gapWeeks: 3,
      pairs: [[9, 24], [10, 23], [11, 22], [12, 21], [13, 20], [14, 19], [15, 18], [16, 17]],
    },
    { key: "roundOf16", legs: 2, levelTie: "penalties", drawn: true, fixedBracket: true, gapWeeks: 3, entrants: [1, 2, 3, 4, 5, 6, 7, 8] },
    { key: "quarterFinals", legs: 2, levelTie: "penalties", drawn: true, fixedBracket: true, gapWeeks: 4 },
    { key: "semiFinals", legs: 2, levelTie: "penalties", drawn: true, fixedBracket: true, gapWeeks: 3 },
    // Placeholder dates: about three weeks between rounds, the final at the end of May.
    { key: "final", legs: 1, levelTie: "penalties", venue, gapWeeks: 4 },
  ],
  title,
});

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
    code: "EL1",
    slug: "league-one",
    name: "League One",
    country: "England",
    flag: "gb-eng",
    simulatorName: { en: "League One Simulator", pt: "Simulador da League One", es: "Simulador de la League One" },
    aka: { en: "EFL League One", pt: "Terceira divisão inglesa", es: "Tercera división inglesa" },
    teams: 24,
    // football-data.org's free tier doesn't include League One.
    espn: { slug: "eng.3", seasons: "split" },
    espnOnly: true,
    // 2026/27: 1st and 2nd go up; 3rd–6th play two-legged semi-finals (3v6, 4v5) and a Wembley final.
    playoff: {
      rounds: [
        { key: "semiFinals", legs: 2, levelTie: "penalties", pairs: [[3, 6], [4, 5]] },
        { key: "final", legs: 1, levelTie: "penalties", venue: "Wembley" },
      ],
      directPromotion: [1, 2],
      promotedTo: "Championship",
    },
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints", "headToHeadAwayGoalsFor"],
    zones: [
      { kind: "promotion", from: 1, to: 2 },
      { kind: "promotionPlayoff", from: 3, to: 6 },
      { kind: "relegation", from: 21, to: 24 },
    ],
  },
  {
    code: "EL2",
    slug: "league-two",
    name: "League Two",
    country: "England",
    flag: "gb-eng",
    simulatorName: { en: "League Two Simulator", pt: "Simulador da League Two", es: "Simulador de la League Two" },
    aka: { en: "EFL League Two", pt: "Quarta divisão inglesa", es: "Cuarta división inglesa" },
    teams: 24,
    // football-data.org's free tier doesn't include League Two.
    espn: { slug: "eng.4", seasons: "split" },
    espnOnly: true,
    // 2026/27: 1st–3rd go up; 4th–7th play two-legged semi-finals (4v7, 5v6) and a Wembley final; 23rd and 24th drop to the National League.
    playoff: {
      rounds: [
        { key: "semiFinals", legs: 2, levelTie: "penalties", pairs: [[4, 7], [5, 6]] },
        { key: "final", legs: 1, levelTie: "penalties", venue: "Wembley" },
      ],
      directPromotion: [1, 2, 3],
      promotedTo: "League One",
    },
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints", "headToHeadAwayGoalsFor"],
    zones: [
      { kind: "promotion", from: 1, to: 3 },
      { kind: "promotionPlayoff", from: 4, to: 7 },
      { kind: "relegation", from: 23, to: 24 },
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
    code: "SD",
    slug: "segunda-division",
    name: "Segunda División",
    country: "Spain",
    flag: "es",
    simulatorName: { en: "Segunda División Simulator", pt: "Simulador da Segunda División", es: "Simulador de Segunda División" },
    aka: { en: "LaLiga Hypermotion", pt: "Segunda divisão espanhola", es: "LaLiga Hypermotion" },
    teams: 22,
    // football-data.org's free tier doesn't include the Segunda División.
    espn: { slug: "esp.2", seasons: "split" },
    espnOnly: true,
    // B teams can't go up to their first team's division (or play the play-off).
    reserveTeams: ["Real Sociedad II", "RC Celta Fortuna"],
    // 1st and 2nd go up; 3rd–6th play two-legged semi-finals (3v6, 4v5) and a
    // two-legged final, the better-placed club hosting the second leg and going
    // through on a level aggregate. 19th–22nd drop to Primera Federación.
    playoff: {
      rounds: [
        { key: "semiFinals", legs: 2, levelTie: "betterPlaced", pairs: [[3, 6], [4, 5]] },
        { key: "final", legs: 2, levelTie: "betterPlaced" },
      ],
      directPromotion: [1, 2],
      promotedTo: "La Liga",
    },
    tiebreakers: ["points", "headToHeadPoints", "headToHeadGoalDifference", "goalDifference", "goalsFor"],
    zones: [
      { kind: "promotion", from: 1, to: 2 },
      { kind: "promotionPlayoff", from: 3, to: 6 },
      { kind: "relegation", from: 19, to: 22 },
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
    code: "BL2",
    slug: "2-bundesliga",
    name: "2. Bundesliga",
    country: "Germany",
    flag: "de",
    simulatorName: { en: "2. Bundesliga Simulator", pt: "Simulador da 2. Bundesliga", es: "Simulador de la 2. Bundesliga" },
    aka: { en: "German 2. Bundesliga", pt: "Segunda divisão alemã", es: "Segunda división alemana" },
    teams: 18,
    // football-data.org's free tier doesn't include the 2. Bundesliga.
    espn: { slug: "ger.2", seasons: "split" },
    espnOnly: true,
    tiebreakers: [
      "points",
      "goalDifference",
      "goalsFor",
      "headToHeadPoints",
      "headToHeadAwayGoalsFor",
      "awayGoalsFor",
    ],
    // 1st and 2nd go up; 3rd plays the Bundesliga's 16th and 16th plays the
    // 3. Liga's 3rd, both over two legs (opponents from other leagues, so no bracket).
    zones: [
      { kind: "promotion", from: 1, to: 2 },
      { kind: "promotionPlayoff", from: 3, to: 3 },
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
    code: "SB",
    slug: "serie-b",
    name: "Serie B",
    country: "Italy",
    flag: "it",
    simulatorName: { en: "Italian Serie B Simulator", pt: "Simulador da Serie B Italiana", es: "Simulador de la Serie B italiana" },
    aka: { en: "Italian Serie B", pt: "Segunda divisão italiana", es: "Segunda división italiana" },
    teams: 20,
    // football-data.org's free tier doesn't include Serie B.
    espn: { slug: "ita.2", seasons: "split" },
    espnOnly: true,
    // 1st and 2nd go up. 3rd–8th play off: single-game preliminaries 5v8 and 6v7
    // at the better-placed club (level after extra time: it goes through), then
    // two-legged semi-finals 3rd v the 6/7 winner and 4th v the 5/8 winner and a
    // two-legged final; a level aggregate sends the better-placed club through.
    // No play-off when 3rd finishes more than 14 points clear of 4th.
    playoff: {
      rounds: [
        { key: "preliminary", legs: 1, levelTie: "betterPlaced", pairs: [[5, 8], [6, 7]] },
        { key: "semiFinals", legs: 2, levelTie: "betterPlaced", entrants: [3, 4], fixedBracket: true },
        { key: "final", legs: 2, levelTie: "betterPlaced" },
      ],
      directPromotion: [1, 2],
      promotedTo: "Serie A",
      directIfClear: { position: 3, over: 4, points: 14 },
    },
    tiebreakers: ["points", "headToHeadPoints", "headToHeadGoalDifference", "goalDifference", "goalsFor"],
    // 16th v 17th play out over two legs (not simulated); 18th–20th go down.
    zones: [
      { kind: "promotion", from: 1, to: 2 },
      { kind: "promotionPlayoff", from: 3, to: 8 },
      { kind: "relegationPlayoff", from: 16, to: 17 },
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
    code: "FL2",
    slug: "ligue-2",
    name: "Ligue 2",
    country: "France",
    flag: "fr",
    simulatorName: { en: "Ligue 2 Simulator", pt: "Simulador da Ligue 2", es: "Simulador de la Ligue 2" },
    aka: { en: "French Ligue 2", pt: "Segunda divisão francesa", es: "Segunda división francesa" },
    teams: 18,
    // football-data.org's free tier doesn't include Ligue 2.
    espn: { slug: "fra.2", seasons: "split" },
    espnOnly: true,
    // 1st and 2nd go up. Play-off 1: 4th v 5th; play-off 2: the winner at 3rd;
    // single games, level goes straight to penalties. The winner then plays
    // Ligue 1's 16th over two legs. 16th plays National's play-off winner; 17th
    // and 18th go down.
    playoff: {
      rounds: [
        { key: "playOff1", legs: 1, levelTie: "penalties", noExtraTime: true, pairs: [[4, 5]] },
        { key: "playOff2", legs: 1, levelTie: "penalties", noExtraTime: true, entrants: [3] },
      ],
      directPromotion: [1, 2],
      promotedTo: "Ligue 1",
      winnerPlays: { league: "Ligue 1", position: 16 },
    },
    tiebreakers: [
      "points",
      "goalDifference",
      "headToHeadPoints",
      "headToHeadGoalDifference",
      "headToHeadGoalsFor",
      "goalsFor",
    ],
    zones: [
      { kind: "promotion", from: 1, to: 2 },
      { kind: "promotionPlayoff", from: 3, to: 5 },
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
    code: "DJL",
    slug: "eerste-divisie",
    name: "Eerste Divisie",
    country: "Netherlands",
    flag: "nl",
    simulatorName: { en: "Eerste Divisie Simulator", pt: "Simulador da Eerste Divisie", es: "Simulador de la Eerste Divisie" },
    aka: { en: "Keuken Kampioen Divisie", pt: "Segunda divisão holandesa", es: "Segunda división neerlandesa" },
    teams: 20,
    // football-data.org's free tier doesn't include the Eerste Divisie.
    espn: { slug: "ned.2", seasons: "split" },
    espnOnly: true,
    // Jong Ajax, Jong AZ, Jong PSV and Jong FC Utrecht can't go up.
    reserveTeams: ["Jong "],
    // 2026/27: the two best first teams go up. Six more play off over two legs
    // (5v8 and 6v7, then 3rd and 4th join; level: extra time and penalties); the
    // winner meets the Eredivisie's 16th in a two-legged final. Officially the
    // four period champions take play-off places first; seeds here follow the
    // final table. No relegation.
    playoff: {
      rounds: [
        { key: "roundOne", legs: 2, levelTie: "penalties", pairs: [[5, 8], [6, 7]] },
        { key: "semiFinals", legs: 2, levelTie: "penalties", entrants: [3, 4] },
      ],
      directPromotion: [1, 2],
      promotedTo: "Eredivisie",
      winnerPlays: { league: "Eredivisie", position: 16 },
    },
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints", "headToHeadGoalDifference"],
    zones: [
      { kind: "promotion", from: 1, to: 2 },
      { kind: "promotionPlayoff", from: 3, to: 8 },
    ],
  },
  {
    code: "SPFL",
    slug: "scottish-premiership",
    name: "Scottish Premiership",
    country: "Scotland",
    flag: "gb-sct",
    simulatorName: { en: "Scottish Premiership Simulator", pt: "Simulador da Scottish Premiership", es: "Simulador de la Scottish Premiership" },
    aka: { en: "William Hill Premiership", pt: "Campeonato Escocês", es: "Liga escocesa" },
    teams: 12,
    // 33 games (three rounds of each other), then the split: the top six and
    // bottom six play each other once more (38 games), keeping their halves.
    gamesPerTeam: 38,
    split: { afterRound: 33, groups: [{ size: 6, legs: 1 }, { size: 6, legs: 1 }] },
    espn: { slug: "sco.1", seasons: "split" },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints"],
    // Base case (the European places shift with the cup winner and UEFA's
    // coefficients): champion to the Champions League, 2nd to its qualifying
    // rounds, 3rd to the Europa League and 4th to the Conference League
    // qualifying; 11th plays the Championship play-off winner, 12th goes down.
    zones: [
      { kind: "championsLeague", from: 1, to: 1 },
      { kind: "championsLeagueQualifying", from: 2, to: 2 },
      { kind: "europaLeague", from: 3, to: 3 },
      { kind: "conferenceLeague", from: 4, to: 4 },
      { kind: "relegationPlayoff", from: 11, to: 11 },
      { kind: "relegation", from: 12, to: 12 },
    ],
  },
  {
    code: "TSL",
    slug: "super-lig",
    name: "Süper Lig",
    country: "Turkey",
    flag: "tr",
    simulatorName: { en: "Süper Lig Simulator", pt: "Simulador da Süper Lig", es: "Simulador de la Süper Lig" },
    aka: { en: "Trendyol Süper Lig", pt: "Campeonato Turco", es: "Liga turca" },
    teams: 18,
    espn: { slug: "tur.1", seasons: "split" },
    espnOnly: true,
    tiebreakers: ["points", "headToHeadPoints", "headToHeadGoalDifference", "goalDifference", "goalsFor"],
    // Base case (the European places shift with the Turkish Cup winner and
    // UEFA's coefficients): champion to the Champions League, 2nd to its
    // qualifying rounds, 3rd to the Europa League, 4th to the Conference
    // League qualifying; the bottom three go down.
    zones: [
      { kind: "championsLeague", from: 1, to: 1 },
      { kind: "championsLeagueQualifying", from: 2, to: 2 },
      { kind: "europaLeague", from: 3, to: 3 },
      { kind: "conferenceLeague", from: 4, to: 4 },
      { kind: "relegation", from: 16, to: 18 },
    ],
  },
  {
    code: "BPL",
    slug: "belgian-pro-league",
    name: "Pro League",
    country: "Belgium",
    flag: "be",
    simulatorName: { en: "Belgian Pro League Simulator", pt: "Simulador da Pro League belga", es: "Simulador de la Pro League belga" },
    aka: { en: "Jupiler Pro League", pt: "Campeonato Belga", es: "Liga belga" },
    teams: 18,
    // 2026/27: back to 18 clubs and a plain 34-game league, no play-offs.
    espn: { slug: "bel.1", seasons: "split" },
    espnOnly: true,
    tiebreakers: ["points", "wins", "goalDifference", "goalsFor", "headToHeadPoints"],
    // Base case (the European places shift with the Belgian Cup winner and
    // UEFA's coefficients): champion to the Champions League, 2nd to its
    // qualifying rounds, 3rd to the Europa League, 4th to the Conference
    // League qualifying; the bottom two go down.
    zones: [
      { kind: "championsLeague", from: 1, to: 1 },
      { kind: "championsLeagueQualifying", from: 2, to: 2 },
      { kind: "europaLeague", from: 3, to: 3 },
      { kind: "conferenceLeague", from: 4, to: 4 },
      { kind: "relegation", from: 17, to: 18 },
    ],
  },
  {
    code: "GSL",
    slug: "greek-super-league",
    name: "Super League Greece",
    country: "Greece",
    flag: "gr",
    simulatorName: { en: "Greek Super League Simulator", pt: "Simulador da Super League grega", es: "Simulador de la Super League griega" },
    aka: { en: "Stoiximan Super League", pt: "Campeonato Grego", es: "Liga griega" },
    teams: 14,
    // 2026/27: 26 games (home and away), then the table splits, points carried
    // over, into the championship play-offs (1st–4th, home and away: 32
    // games), the Europe play-offs (5th–8th, 32 games) and the relegation
    // play-outs (9th–14th, 36 games). The split's fixtures appear once ESPN
    // publishes them (from April 2027).
    espn: { slug: "gre.1", seasons: "split", deductions: true },
    espnOnly: true,
    tiebreakers: ["points", "headToHeadPoints", "headToHeadGoalDifference", "goalDifference", "goalsFor"],
    // The play-offs and play-outs are double round robins; the Europe play-offs
    // start from half the regular season's points (rounded up), the others
    // from all of them.
    split: {
      afterRound: 26,
      espnStage: "regular-season",
      groups: [
        { size: 4, legs: 2 },
        { size: 4, legs: 2, carryOver: 0.5 },
        { size: 6, legs: 2 },
      ],
      finalZones: [
        { kind: "title", from: 1, to: 1 },
        { kind: "championsLeagueQualifying", from: 2, to: 2 },
        { kind: "europaLeague", from: 3, to: 3 },
        { kind: "conferenceLeague", from: 4, to: 5 },
        { kind: "relegation", from: 13, to: 14 },
      ],
    },
    // Before the split: where each place leads.
    zones: [
      { kind: "championshipPlayoffs", from: 1, to: 4 },
      { kind: "europePlayoffs", from: 5, to: 8 },
      { kind: "relegationPlayouts", from: 9, to: 14 },
    ],
    // After it (ESPN's standings groups), base case (the European places shift
    // with the Greek Cup winner and UEFA's coefficients): the champion and the
    // runner-up to the Champions League qualifying, 3rd to the Europa League, 4th and the Europe
    // play-offs winner to the Conference League qualifying; the play-outs'
    // bottom two go down.
    groupsOptional: true,
    groups: [
      {
        id: "1",
        espnName: "Championship",
        name: { en: "Championship play-offs", pt: "Play-offs do título", es: "Play-offs por el título" },
        shortName: { en: "Title", pt: "Título", es: "Título" },
        zones: [
          { kind: "title", from: 1, to: 1 },
          { kind: "championsLeagueQualifying", from: 2, to: 2 },
          { kind: "europaLeague", from: 3, to: 3 },
          { kind: "conferenceLeague", from: 4, to: 4 },
        ],
      },
      {
        id: "2",
        espnName: "Europe",
        name: { en: "Europe play-offs", pt: "Play-offs europeus", es: "Play-offs europeos" },
        shortName: { en: "Europe", pt: "Europa", es: "Europa" },
        zones: [{ kind: "conferenceLeague", from: 1, to: 1 }],
      },
      {
        id: "3",
        espnName: "Relegation",
        name: { en: "Relegation play-outs", pt: "Play-outs do rebaixamento", es: "Play-outs del descenso" },
        shortName: { en: "Relegation", pt: "Rebaixamento", es: "Descenso" },
        zones: [{ kind: "relegation", from: 5, to: 6 }],
      },
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
  {
    code: "MLS",
    slug: "mls",
    name: "MLS",
    country: "USA",
    flag: "us",
    simulatorName: { en: "MLS Simulator", pt: "Simulador da MLS", es: "Simulador de la MLS" },
    aka: { en: "Major League Soccer", pt: "Major League Soccer", es: "Major League Soccer" },
    teams: 30,
    // Unbalanced schedule: 34 games each, more of them against the own conference.
    gamesPerTeam: 34,
    groups: [
      {
        id: "east",
        espnName: "Eastern",
        name: { en: "Eastern Conference", pt: "Conferência Leste", es: "Conferencia Este" },
        shortName: { en: "East", pt: "Leste", es: "Este" },
      },
      {
        id: "west",
        espnName: "Western",
        name: { en: "Western Conference", pt: "Conferência Oeste", es: "Conferencia Oeste" },
        shortName: { en: "West", pt: "Oeste", es: "Oeste" },
      },
    ],
    // football-data.org's free tier doesn't include MLS.
    espn: { slug: "usa.1", seasons: "calendar", weeklyRounds: true },
    espnOnly: true,
    // Official order continues with disciplinary points, which the feed doesn't have.
    tiebreakers: ["points", "wins", "goalDifference", "goalsFor", "awayGoalsFor"],
    // MLS Cup playoffs (2023– format), within each conference: wild card 8th v
    // 9th (level: straight to penalties); Round One best of three, 1st v the
    // wild-card winner, 2v7, 3v6, 4v5 (higher seed hosts games 1 and 3, a drawn
    // game goes to penalties); then single games along a fixed bracket (1/8/9 v
    // 4/5, 2/7 v 3/6) at the higher seed. MLS Cup: the conference champions, at
    // the club with the better regular-season record.
    playoff: {
      groupStage: { count: 2, rounds: 4 },
      rounds: [
        { key: "wildCard", legs: 1, levelTie: "penalties", noExtraTime: true, pairs: [[8, 9]] },
        { key: "roundOne", legs: 1, bestOf: 3, levelTie: "penalties", noExtraTime: true, entrants: [1, 2, 3, 4, 5, 6, 7] },
        { key: "conferenceSemiFinals", legs: 1, levelTie: "penalties", fixedBracket: true },
        { key: "conferenceFinal", legs: 1, levelTie: "penalties", fixedBracket: true },
        { key: "mlsCup", legs: 1, levelTie: "penalties" },
      ],
      title: "MLS Cup",
    },
    // Per conference: 1st–7th go straight to the MLS Cup playoffs, 8th v 9th play a wild-card match.
    zones: [
      { kind: "playoffs", from: 1, to: 7 },
      { kind: "playoffWildCard", from: 8, to: 9 },
    ],
  },
  {
    code: "ARG",
    slug: "argentina-primera-division",
    name: "Liga Profesional",
    country: "Argentina",
    flag: "ar",
    simulatorName: {
      en: "Argentine Primera División Simulator",
      pt: "Simulador do Campeonato Argentino",
      es: "Simulador de la Liga Profesional Argentina",
    },
    aka: { en: "Liga Profesional de Fútbol", pt: "Liga Profesional de Fútbol", es: "Liga Profesional de Fútbol" },
    teams: 30,
    // Two tournaments a year (Apertura, Clausura), each its own table: two
    // zones of 15, 16 games (the zone plus the derby round), then play-offs.
    gamesPerTeam: 16,
    groups: [
      { id: "A", espnName: "Group A", name: { en: "Zone A", pt: "Zona A", es: "Zona A" }, shortName: { en: "Zone A", pt: "Zona A", es: "Zona A" } },
      { id: "B", espnName: "Group B", name: { en: "Zone B", pt: "Zona B", es: "Zona B" }, shortName: { en: "Zone B", pt: "Zona B", es: "Zona B" } },
    ],
    espn: {
      slug: "arg.1",
      seasons: "calendar",
      stages: [
        {
          table: "torneo-clausura",
          knockout: ["clausura---round-of-16", "clausura---quarterfinals", "clausura---semifinals", "clausura---final"],
          name: "Clausura",
        },
        {
          table: "torneo-apertura",
          knockout: ["apertura---round-of-16", "apertura---quarterfinals", "apertura---semifinals", "apertura---final"],
          name: "Apertura",
        },
      ],
    },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints", "headToHeadGoalDifference"],
    // Per zone: the top 8 go to the play-offs.
    zones: [{ kind: "titlePlayoffs", from: 1, to: 8 }],
    // Annual table (both tournaments' regular phases, 2026 rules for the 2027
    // cups): the Apertura and Clausura champions and the Copa Argentina winner
    // go to the Libertadores, with the top 3 not already in; the next 6 to the
    // Sudamericana; the last is relegated (as is the last in the three-season
    // averages, not modelled).
    annual: {
      name: { en: "Annual table", pt: "Tabela anual", es: "Tabla anual" },
      championsQualify: true,
      zones: [
        { kind: "libertadores", from: 1, to: 3 },
        { kind: "sudamericana", from: 4, to: 9 },
        { kind: "relegation", from: 30, to: 30 },
      ],
    },
    // Play-offs: single games at the better-placed club, level straight to
    // penalties; round of 16 across the zones (1A v 8B, 1B v 8A, 2A v 7B…),
    // then a fixed bracket (1A/8B v 4B/5A…); the final at a neutral ground.
    playoff: {
      seedFromGroups: { places: 8, interleave: true },
      rounds: [
        {
          key: "roundOf16",
          legs: 1,
          levelTie: "penalties",
          noExtraTime: true,
          pairs: [[1, 16], [2, 15], [3, 14], [4, 13], [5, 12], [6, 11], [7, 10], [8, 9]],
        },
        { key: "quarterFinals", legs: 1, levelTie: "penalties", noExtraTime: true, fixedBracket: true },
        { key: "semiFinals", legs: 1, levelTie: "penalties", noExtraTime: true, fixedBracket: true },
        { key: "final", legs: 1, levelTie: "penalties", neutral: true },
      ],
      title: "Liga Profesional",
    },
  },
  {
    code: "CHI",
    slug: "chile-primera-division",
    name: "Liga de Primera",
    country: "Chile",
    flag: "cl",
    simulatorName: { en: "Chilean Primera División Simulator", pt: "Simulador do Campeonato Chileno", es: "Simulador de la Liga de Primera de Chile" },
    aka: { en: "Chilean Primera División", pt: "Campeonato Chileno", es: "Campeonato Nacional" },
    teams: 16,
    espn: { slug: "chi.1", seasons: "calendar" },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "awayGoalsFor", "headToHeadPoints"],
    // 2026: champion and runner-up to the Libertadores group stage; 3rd plays
    // the Copa Chile winner for a Libertadores qualifying place; 4th–6th to the
    // Sudamericana; the bottom two go down.
    zones: [
      { kind: "libertadores", from: 1, to: 2 },
      { kind: "libertadoresQualifying", from: 3, to: 3 },
      { kind: "sudamericana", from: 4, to: 6 },
      { kind: "relegation", from: 15, to: 16 },
    ],
  },
  {
    code: "COL",
    slug: "colombia-primera-a",
    name: "Liga BetPlay",
    country: "Colombia",
    flag: "co",
    simulatorName: { en: "Colombian Primera A Simulator", pt: "Simulador do Campeonato Colombiano", es: "Simulador de la Liga BetPlay" },
    aka: { en: "Categoría Primera A", pt: "Liga BetPlay Dimayor", es: "Liga BetPlay Dimayor" },
    teams: 20,
    // Two tournaments a year (Apertura, Finalización): 19 games each (one round
    // robin), the top 8 to the play-offs.
    gamesPerTeam: 19,
    espn: {
      slug: "col.1",
      seasons: "calendar",
      stages: [
        { table: "clausura", knockout: ["clausura---quarterfinals", "clausura---semifinals", "clausura---finals"], name: "Finalización" },
        { table: "apertura", knockout: ["apertura---quarterfinals", "apertura---semifinals", "apertura---finals"], name: "Apertura" },
      ],
    },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "awayGoalsFor", "headToHeadPoints"],
    zones: [{ kind: "titlePlayoffs", from: 1, to: 8 }],
    // 2026 play-offs: two legs throughout, the better-placed club at home second,
    // level on aggregate straight to penalties; a fixed bracket: 1v8 and 3v6 meet
    // in one semi-final, 2v5 and 4v7 in the other; a two-legged final.
    playoff: {
      rounds: [
        { key: "quarterFinals", legs: 2, levelTie: "penalties", noExtraTime: true, pairs: [[1, 8], [2, 5], [4, 7], [3, 6]] },
        { key: "semiFinals", legs: 2, levelTie: "penalties", noExtraTime: true, fixedBracket: true },
        { key: "final", legs: 2, levelTie: "penalties", noExtraTime: true, fixedBracket: true },
      ],
      title: "Liga BetPlay",
    },
    // Annual reclassification (all games of both tournaments, play-offs
    // included): the two tournament champions go to the Libertadores with the
    // best 2 others; the next 3 to the Sudamericana (with the Copa BetPlay
    // winner). Relegation is by the three-season averages (not modelled).
    annual: {
      name: { en: "Reclassification", pt: "Reclassificação", es: "Reclasificación" },
      championsQualify: true,
      includePostseason: true,
      zones: [
        { kind: "libertadores", from: 1, to: 2 },
        { kind: "sudamericana", from: 3, to: 5 },
      ],
    },
  },
  {
    code: "URU",
    slug: "uruguay-primera-division",
    name: "Liga AUF",
    country: "Uruguay",
    flag: "uy",
    simulatorName: { en: "Uruguayan Primera División Simulator", pt: "Simulador do Campeonato Uruguaio", es: "Simulador del Campeonato Uruguayo" },
    aka: { en: "Liga AUF Uruguaya", pt: "Campeonato Uruguaio", es: "Liga AUF Uruguaya" },
    teams: 16,
    // Three tournaments a year: Apertura and Clausura (one round robin, 15
    // games, the leader wins), and the Intermedio in between (two groups of 8,
    // the group winners play a final).
    gamesPerTeam: 15,
    espn: {
      slug: "uru.1",
      seasons: "calendar",
      stages: [
        { table: "torneo-clausura", knockout: [], name: "Clausura" },
        {
          table: "torneo-intermedio",
          knockout: ["intermedio-final"],
          name: "Intermedio",
          gamesPerTeam: 7,
          groups: [
            { id: "A", espnName: "Serie A", name: { en: "Group A", pt: "Grupo A", es: "Serie A" }, shortName: { en: "Group A", pt: "Grupo A", es: "Serie A" } },
            { id: "B", espnName: "Serie B", name: { en: "Group B", pt: "Grupo B", es: "Serie B" }, shortName: { en: "Group B", pt: "Grupo B", es: "Serie B" } },
          ],
          zones: [{ kind: "titlePlayoffs", from: 1, to: 1 }],
          playoff: {
            seedFromGroups: { places: 1, interleave: true },
            rounds: [{ key: "final", legs: 1, levelTie: "penalties", neutral: true, pairs: [[1, 2]] }],
            // "Torneo Intermedio 2026": the season label already names the tournament.
            title: "Torneo",
          },
        },
        { table: "torneo-apertura", knockout: [], name: "Apertura" },
      ],
    },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints"],
    zones: [{ kind: "title", from: 1, to: 1 }],
    // Annual table (all three tournaments): the continental places, roughly
    // (the Uruguayan champion and runner-up, decided by the tournament winners'
    // play-off, also go to the Libertadores). Relegation is by averages (not
    // modelled).
    annual: {
      name: { en: "Annual table", pt: "Tabela anual", es: "Tabla anual" },
      zones: [
        { kind: "libertadores", from: 1, to: 4 },
        { kind: "sudamericana", from: 5, to: 8 },
      ],
    },
  },
  {
    code: "PAR",
    slug: "paraguay-primera-division",
    name: "Primera División",
    country: "Paraguay",
    flag: "py",
    simulatorName: { en: "Paraguayan Primera División Simulator", pt: "Simulador do Campeonato Paraguaio", es: "Simulador de la Primera División de Paraguay" },
    aka: { en: "División de Honor", pt: "Campeonato Paraguaio", es: "División de Honor" },
    teams: 12,
    // Two tournaments a year (Apertura, Clausura), home and away (22 games); the leader wins.
    gamesPerTeam: 22,
    espn: {
      slug: "par.1",
      seasons: "calendar",
      stages: [
        { table: "torneo-clausura", knockout: [], name: "Clausura" },
        { table: "torneo-apertura", knockout: [], name: "Apertura" },
      ],
    },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints"],
    zones: [{ kind: "title", from: 1, to: 1 }],
    // Cumulative table: the two tournament champions go to the Libertadores with
    // the best 2 others; the next 4 to the Sudamericana (usual allocation, not
    // confirmed for 2026). Relegation is by the three-season averages (not modelled).
    annual: {
      name: { en: "Cumulative table", pt: "Tabela acumulada", es: "Tabla acumulada" },
      championsQualify: true,
      zones: [
        { kind: "libertadores", from: 1, to: 2 },
        { kind: "sudamericana", from: 3, to: 6 },
      ],
    },
  },
  {
    code: "MX",
    slug: "liga-mx",
    name: "Liga MX",
    country: "Mexico",
    flag: "mx",
    simulatorName: { en: "Liga MX Simulator", pt: "Simulador da Liga MX", es: "Simulador de la Liga MX" },
    aka: { en: "Mexican Liga MX", pt: "Campeonato Mexicano", es: "Liga BBVA MX" },
    teams: 18,
    // Two tournaments a season (Apertura from July, Clausura from January), one
    // round robin of 17 games each; the top 8 go to the Liguilla. No relegation.
    gamesPerTeam: 17,
    espn: {
      slug: "mex.1",
      seasons: "split",
      stages: [
        { table: "torneo-clausura", knockout: ["clausura---quarterfinals", "clausura---semifinals", "clausura---finals"], name: "Clausura", yearOffset: 1 },
        { table: "torneo-apertura", knockout: ["apertura---quarterfinals", "apertura---semifinals", "apertura---finals"], name: "Apertura", yearOffset: 0 },
      ],
    },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "awayGoalsFor", "headToHeadPoints"],
    zones: [{ kind: "titlePlayoffs", from: 1, to: 8 }],
    // Liguilla: two legs, the better-placed club at home second. Quarter-finals
    // 1v8, 2v7, 3v6, 4v5, then re-seeded semi-finals; level on aggregate, the
    // better-placed club goes through, except in the final (extra time and penalties).
    playoff: {
      rounds: [
        { key: "quarterFinals", legs: 2, levelTie: "betterPlaced", pairs: [[1, 8], [2, 7], [3, 6], [4, 5]] },
        { key: "semiFinals", legs: 2, levelTie: "betterPlaced" },
        { key: "final", legs: 2, levelTie: "penalties" },
      ],
      title: "Liga MX",
    },
  },
  {
    code: "ECU",
    slug: "ecuador-ligapro",
    name: "LigaPro",
    country: "Ecuador",
    flag: "ec",
    simulatorName: { en: "Ecuadorian LigaPro Simulator", pt: "Simulador do Campeonato Equatoriano", es: "Simulador de la LigaPro Ecuador" },
    aka: { en: "LigaPro Serie A", pt: "LigaPro Ecuador", es: "LigaPro Serie A" },
    teams: 16,
    // 2026: a first stage of 30 games (home and away, plus a few extra
    // fixtures), then the table splits, points carried over, into a title
    // hexagonal (1st–6th), a quadrangular (7th–10th) and a relegation hexagonal
    // (11th–16th), each home and away within itself. Rounds by calendar week.
    gamesPerTeam: 42,
    espn: { slug: "ecu.1", seasons: "calendar", weeklyRounds: true },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints"],
    // The first stage ends with the last round published until ESPN shows the groups.
    split: {
      firstPhaseName: { en: "First stage", pt: "Primeira fase", es: "Primera etapa" },
      firstPhaseShortName: { en: "1st stage", pt: "1ª fase", es: "1ª etapa" },
      espnStage: "first-stage",
      groups: [
        { size: 6, legs: 2 },
        { size: 4, legs: 2 },
        { size: 6, legs: 2 },
      ],
      finalZones: [
        { kind: "title", from: 1, to: 1 },
        { kind: "libertadores", from: 2, to: 2 },
        { kind: "libertadoresQualifying", from: 3, to: 3 },
        { kind: "sudamericana", from: 4, to: 7 },
        { kind: "relegation", from: 15, to: 16 },
      ],
    },
    // Before the split: where each place leads.
    zones: [
      { kind: "splitTitle", from: 1, to: 6 },
      { kind: "splitMiddle", from: 7, to: 10 },
      { kind: "splitRelegation", from: 11, to: 16 },
    ],
    // After it (ESPN's standings groups): each group's own places. Title
    // hexagonal: the champion and runner-up to the Libertadores group stage,
    // 3rd to its qualifying rounds, 4th–6th to the Sudamericana; the
    // quadrangular winner to the Sudamericana; the relegation hexagonal's
    // bottom two go down.
    groupsOptional: true,
    groups: [
      {
        id: "1",
        espnName: "Group 1",
        name: { en: "Title hexagonal", pt: "Hexagonal do título", es: "Hexagonal por el título" },
        shortName: { en: "Title", pt: "Título", es: "Título" },
        zones: [
          { kind: "title", from: 1, to: 1 },
          { kind: "libertadores", from: 2, to: 2 },
          { kind: "libertadoresQualifying", from: 3, to: 3 },
          { kind: "sudamericana", from: 4, to: 6 },
        ],
      },
      {
        id: "2",
        espnName: "Group 2",
        name: { en: "Quadrangular", pt: "Quadrangular", es: "Cuadrangular" },
        shortName: { en: "Quadrangular", pt: "Quadrangular", es: "Cuadrangular" },
        zones: [{ kind: "sudamericana", from: 1, to: 1 }],
      },
      {
        id: "3",
        espnName: "Group 3",
        name: { en: "Relegation hexagonal", pt: "Hexagonal do rebaixamento", es: "Hexagonal del descenso" },
        shortName: { en: "Relegation", pt: "Rebaixamento", es: "Descenso" },
        zones: [{ kind: "relegation", from: 5, to: 6 }],
      },
    ],
  },
  {
    code: "PER",
    slug: "peru-liga-1",
    name: "Liga 1",
    country: "Peru",
    flag: "pe",
    simulatorName: { en: "Peruvian Liga 1 Simulator", pt: "Simulador do Campeonato Peruano", es: "Simulador de la Liga 1 de Perú" },
    aka: { en: "Liga 1 Perú", pt: "Liga 1 Perú", es: "Liga 1 Te Apuesto" },
    teams: 18,
    // Two tournaments a year (Apertura, Clausura), one round robin of 17 games
    // each; the leader wins.
    gamesPerTeam: 17,
    espn: {
      slug: "per.1",
      seasons: "calendar",
      stages: [
        { table: "clausura", knockout: [], name: "Clausura" },
        { table: "apertura", knockout: [], name: "Apertura" },
      ],
      // Clubs docked points (2026: UTC).
      deductions: true,
    },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints"],
    zones: [{ kind: "title", from: 1, to: 1 }],
    // Cumulative table: the Sudamericana places and relegation (the last club,
    // 2026). The Libertadores places come from a play-off between the
    // tournament champions and the best-placed clubs, so they are approximate.
    annual: {
      name: { en: "Cumulative table", pt: "Tabela acumulada", es: "Tabla acumulada" },
      championsQualify: true,
      zones: [
        { kind: "libertadores", from: 1, to: 2 },
        { kind: "sudamericana", from: 3, to: 6 },
        { kind: "relegation", from: 18, to: 18 },
      ],
    },
  },
  {
    code: "J1",
    slug: "j1-league",
    name: "J1 League",
    country: "Japan",
    flag: "jp",
    simulatorName: { en: "J1 League Simulator", pt: "Simulador da J1 League", es: "Simulador de la J1 League" },
    aka: { en: "Meiji Yasuda J1 League", pt: "Campeonato Japonês", es: "Liga japonesa" },
    teams: 20,
    // From 2026/27 an August–May season, 38 games (the special half-season
    // tournament of early 2026 is left out).
    espn: { slug: "jpn.1", seasons: "split", stages: { table: "regular-season", knockout: [] } },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints"],
    // Champion and runner-up to the AFC Champions League Elite, 3rd to its
    // preliminary stage; the bottom three go down.
    zones: [
      { kind: "aclElite", from: 1, to: 2 },
      { kind: "aclEliteQualifying", from: 3, to: 3 },
      { kind: "relegation", from: 18, to: 20 },
    ],
  },
  {
    code: "SPL",
    slug: "saudi-pro-league",
    name: "Saudi Pro League",
    country: "Saudi Arabia",
    flag: "sa",
    simulatorName: { en: "Saudi Pro League Simulator", pt: "Simulador da Saudi Pro League", es: "Simulador de la Saudi Pro League" },
    aka: { en: "Roshn Saudi League", pt: "Campeonato Saudita", es: "Liga Saudí" },
    teams: 18,
    espn: { slug: "ksa.1", seasons: "split" },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "headToHeadPoints"],
    // 2026/27: the top 4 to the AFC Champions League Elite league stage, 5th to
    // its preliminary stage, 6th to the AFC Champions League Two, 7th–8th to
    // the Gulf Club Champions League; the bottom three go down.
    zones: [
      { kind: "aclElite", from: 1, to: 4 },
      { kind: "aclEliteQualifying", from: 5, to: 5 },
      { kind: "aclTwo", from: 6, to: 6 },
      { kind: "gulfClub", from: 7, to: 8 },
      { kind: "relegation", from: 16, to: 18 },
    ],
  },
  {
    code: "UCL",
    slug: "champions-league",
    name: "Champions League",
    country: "UEFA",
    flag: "eu",
    simulatorName: { en: "Champions League Simulator", pt: "Simulador da Champions League", es: "Simulador de la Champions League" },
    aka: { en: "UEFA Champions League", pt: "Liga dos Campeões", es: "Liga de Campeones" },
    teams: 36,
    gamesPerTeam: 8,
    espn: { slug: "uefa.champions", seasons: "split" },
    espnOnly: true,
    // League phase: 36 clubs, 8 games each against 8 different opponents, one table.
    tiebreakers: ["points", "goalDifference", "goalsFor", "awayGoalsFor", "wins"],
    zones: [
      { kind: "knockoutRoundOf16", from: 1, to: 8 },
      { kind: "knockoutPlayoff", from: 9, to: 24 },
      { kind: "eliminated", from: 25, to: 36 },
    ],
    playoff: UEFA_KNOCKOUT("Metropolitano", "Champions League"),
    continental: { outsiderTier: 0.8 },
  },
  {
    code: "UEL",
    slug: "europa-league",
    name: "Europa League",
    country: "UEFA",
    flag: "eu",
    simulatorName: { en: "Europa League Simulator", pt: "Simulador da Europa League", es: "Simulador de la Europa League" },
    aka: { en: "UEFA Europa League", pt: "Liga Europa", es: "Liga Europa" },
    teams: 36,
    gamesPerTeam: 8,
    espn: { slug: "uefa.europa", seasons: "split" },
    espnOnly: true,
    // League phase: 36 clubs, 8 games each against 8 different opponents, one table.
    tiebreakers: ["points", "goalDifference", "goalsFor", "awayGoalsFor", "wins"],
    zones: [
      { kind: "knockoutRoundOf16", from: 1, to: 8 },
      { kind: "knockoutPlayoff", from: 9, to: 24 },
      { kind: "eliminated", from: 25, to: 36 },
    ],
    playoff: UEFA_KNOCKOUT("Deutsche Bank Park", "Europa League"),
    continental: { outsiderTier: 1.2 },
  },
  {
    code: "UECL",
    slug: "conference-league",
    name: "Conference League",
    country: "UEFA",
    flag: "eu",
    simulatorName: { en: "Conference League Simulator", pt: "Simulador da Conference League", es: "Simulador de la Conference League" },
    aka: { en: "UEFA Conference League", pt: "Liga Conferência", es: "Liga Conferencia" },
    teams: 36,
    gamesPerTeam: 6,
    espn: { slug: "uefa.europa.conf", seasons: "split" },
    espnOnly: true,
    // League phase: 36 clubs, 6 games each against 6 different opponents, one table.
    tiebreakers: ["points", "goalDifference", "goalsFor", "awayGoalsFor", "wins"],
    zones: [
      { kind: "knockoutRoundOf16", from: 1, to: 8 },
      { kind: "knockoutPlayoff", from: 9, to: 24 },
      { kind: "eliminated", from: 25, to: 36 },
    ],
    playoff: UEFA_KNOCKOUT("Beşiktaş Park", "Conference League"),
    continental: { outsiderTier: 1.7 },
  },
  {
    code: "LIB",
    slug: "copa-libertadores",
    name: "Copa Libertadores",
    country: "CONMEBOL",
    flag: "conmebol",
    simulatorName: { en: "Copa Libertadores Simulator", pt: "Simulador da Libertadores", es: "Simulador de la Copa Libertadores" },
    aka: { en: "CONMEBOL Libertadores", pt: "Copa Libertadores da América", es: "CONMEBOL Libertadores" },
    teams: 32,
    gamesPerTeam: 6,
    // Group stage: 8 groups of 4, home and away (the qualifying stages before it
    // are left out). The top 2 go to the round of 16, 3rd drops into the Copa
    // Sudamericana.
    groups: [
      { id: "A", espnName: "Group A", name: { en: "Group A", pt: "Grupo A", es: "Grupo A" }, shortName: { en: "Group A", pt: "Grupo A", es: "Grupo A" } },
      { id: "B", espnName: "Group B", name: { en: "Group B", pt: "Grupo B", es: "Grupo B" }, shortName: { en: "Group B", pt: "Grupo B", es: "Grupo B" } },
      { id: "C", espnName: "Group C", name: { en: "Group C", pt: "Grupo C", es: "Grupo C" }, shortName: { en: "Group C", pt: "Grupo C", es: "Grupo C" } },
      { id: "D", espnName: "Group D", name: { en: "Group D", pt: "Grupo D", es: "Grupo D" }, shortName: { en: "Group D", pt: "Grupo D", es: "Grupo D" } },
      { id: "E", espnName: "Group E", name: { en: "Group E", pt: "Grupo E", es: "Grupo E" }, shortName: { en: "Group E", pt: "Grupo E", es: "Grupo E" } },
      { id: "F", espnName: "Group F", name: { en: "Group F", pt: "Grupo F", es: "Grupo F" }, shortName: { en: "Group F", pt: "Grupo F", es: "Grupo F" } },
      { id: "G", espnName: "Group G", name: { en: "Group G", pt: "Grupo G", es: "Grupo G" }, shortName: { en: "Group G", pt: "Grupo G", es: "Grupo G" } },
      { id: "H", espnName: "Group H", name: { en: "Group H", pt: "Grupo H", es: "Grupo H" }, shortName: { en: "Group H", pt: "Grupo H", es: "Grupo H" } },
    ],
    espn: {
      slug: "conmebol.libertadores",
      seasons: "calendar",
      stages: { table: "group-stage", knockout: ["round-of-16", "quarterfinals", "semifinals", "final"] },
    },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "awayGoalsFor", "headToHeadPoints"],
    zones: [
      { kind: "knockoutRoundOf16", from: 1, to: 2 },
      { kind: "sudamericana", from: 3, to: 3 },
      { kind: "eliminated", from: 4, to: 4 },
    ],
    // Knockout phase: group winners (ranked 1–8 by their group record) v
    // runners-up (9–16), two legs, the better-ranked club hosting the second;
    // level on aggregate: straight to penalties. The round of 16 is drawn (the
    // projection pairs 1st v 16th…) and the draw fixes the bracket. Single final
    // at a neutral venue (2026: Estadio Centenario, Montevideo).
    playoff: {
      seedFromGroups: { places: 2 },
      rounds: [
        {
          key: "roundOf16",
          legs: 2,
          levelTie: "penalties",
          noExtraTime: true,
          drawn: true,
          gapWeeks: 10,
          pairs: [[1, 16], [2, 15], [3, 14], [4, 13], [5, 12], [6, 11], [7, 10], [8, 9]],
        },
        { key: "quarterFinals", legs: 2, levelTie: "penalties", noExtraTime: true, drawn: true, fixedBracket: true, gapWeeks: 4 },
        { key: "semiFinals", legs: 2, levelTie: "penalties", noExtraTime: true, drawn: true, fixedBracket: true, gapWeeks: 5 },
        { key: "final", legs: 1, levelTie: "penalties", venue: "Estadio Centenario", gapWeeks: 6 },
      ],
      title: "Copa Libertadores",
    },
    continental: { outsiderTier: 1.4 },
  },
  {
    code: "SUD",
    slug: "copa-sudamericana",
    name: "Copa Sudamericana",
    country: "CONMEBOL",
    flag: "conmebol",
    simulatorName: { en: "Copa Sudamericana Simulator", pt: "Simulador da Sul-Americana", es: "Simulador de la Copa Sudamericana" },
    aka: { en: "CONMEBOL Sudamericana", pt: "Copa Sul-Americana", es: "CONMEBOL Sudamericana" },
    teams: 32,
    gamesPerTeam: 6,
    // Group stage: 8 groups of 4, home and away (the first stage before it is
    // left out). Group winners go straight to the round of 16; runners-up play
    // the knockout play-off against the Libertadores third-placed clubs.
    groups: [
      { id: "A", espnName: "Group A", name: { en: "Group A", pt: "Grupo A", es: "Grupo A" }, shortName: { en: "Group A", pt: "Grupo A", es: "Grupo A" } },
      { id: "B", espnName: "Group B", name: { en: "Group B", pt: "Grupo B", es: "Grupo B" }, shortName: { en: "Group B", pt: "Grupo B", es: "Grupo B" } },
      { id: "C", espnName: "Group C", name: { en: "Group C", pt: "Grupo C", es: "Grupo C" }, shortName: { en: "Group C", pt: "Grupo C", es: "Grupo C" } },
      { id: "D", espnName: "Group D", name: { en: "Group D", pt: "Grupo D", es: "Grupo D" }, shortName: { en: "Group D", pt: "Grupo D", es: "Grupo D" } },
      { id: "E", espnName: "Group E", name: { en: "Group E", pt: "Grupo E", es: "Grupo E" }, shortName: { en: "Group E", pt: "Grupo E", es: "Grupo E" } },
      { id: "F", espnName: "Group F", name: { en: "Group F", pt: "Grupo F", es: "Grupo F" }, shortName: { en: "Group F", pt: "Grupo F", es: "Grupo F" } },
      { id: "G", espnName: "Group G", name: { en: "Group G", pt: "Grupo G", es: "Grupo G" }, shortName: { en: "Group G", pt: "Grupo G", es: "Grupo G" } },
      { id: "H", espnName: "Group H", name: { en: "Group H", pt: "Grupo H", es: "Grupo H" }, shortName: { en: "Group H", pt: "Grupo H", es: "Grupo H" } },
    ],
    espn: {
      slug: "conmebol.sudamericana",
      seasons: "calendar",
      stages: { table: "group-stage", knockout: ["knockout-round-playoffs", "round-of-16", "quarterfinals", "semifinals", "final"] },
    },
    espnOnly: true,
    tiebreakers: ["points", "goalDifference", "goalsFor", "awayGoalsFor", "headToHeadPoints"],
    zones: [
      { kind: "knockoutRoundOf16", from: 1, to: 1 },
      { kind: "knockoutPlayoff", from: 2, to: 2 },
      { kind: "eliminated", from: 3, to: 4 },
    ],
    // Knockout phase, ranked group winners 1–8, runners-up 9–16, then the eight
    // Libertadores third-placed clubs 17–24 (each by record). Play-off:
    // runners-up v Libertadores thirds; round of 16: group winners v play-off
    // winners. Two legs throughout, the better-ranked club at home second,
    // level on aggregate straight to penalties. Drawn: the projection pairs
    // 9th v 24th… and the draw replaces it. Single final at a neutral venue
    // (2026: Estadio Metropolitano Roberto Meléndez, Barranquilla).
    playoff: {
      seedFromGroups: { places: 2, external: { league: "LIB", place: 3 } },
      rounds: [
        {
          key: "knockoutPlayoff",
          legs: 2,
          levelTie: "penalties",
          noExtraTime: true,
          drawn: true,
          gapWeeks: 8,
          pairs: [[9, 24], [10, 23], [11, 22], [12, 21], [13, 20], [14, 19], [15, 18], [16, 17]],
        },
        {
          key: "roundOf16",
          legs: 2,
          levelTie: "penalties",
          noExtraTime: true,
          drawn: true,
          fixedBracket: true,
          gapWeeks: 3,
          entrants: [1, 2, 3, 4, 5, 6, 7, 8],
        },
        { key: "quarterFinals", legs: 2, levelTie: "penalties", noExtraTime: true, drawn: true, fixedBracket: true, gapWeeks: 4 },
        { key: "semiFinals", legs: 2, levelTie: "penalties", noExtraTime: true, drawn: true, fixedBracket: true, gapWeeks: 5 },
        { key: "final", legs: 1, levelTie: "penalties", venue: "Estadio Metropolitano Roberto Meléndez", gapWeeks: 5 },
      ],
      title: "Copa Sudamericana",
    },
    continental: { outsiderTier: 1.6 },
  },
];

/** League games each club plays in a season. */
export function gamesPerTeam(league: LeagueConfig): number {
  return league.gamesPerTeam ?? (league.teams - 1) * 2;
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
