import type { CompetitionCode, FlagCode, SiteLocale } from "./leagues.ts";

// Knockout cups. Unlike a league, a cup has no table: each round's pairings are
// drawn, and clubs from several divisions (and outside the league system) meet.

export type CupCode = "FAC" | "CDB" | "CDR";

export type CupRoundKey =
  | "qualifyingRound"
  | "firstRound"
  | "secondRound"
  | "thirdRound"
  | "fourthRound"
  | "fifthRound"
  | "roundOf32"
  | "roundOf16"
  | "quarterFinals"
  | "semiFinals"
  | "final";

export interface CupRoundConfig {
  key: CupRoundKey;
  /** ESPN's `season.slug` for the round's games. */
  espnSlug: string;
  /** Ties in the round. */
  ties: number;
  /** Leagues whose clubs enter the competition in this round. */
  entrantsFrom?: readonly CompetitionCode[];
  /**
   * Only the clubs of `entrantsFrom` not already in the cup's real draw enter
   * here (Copa del Rey: the four Supercopa clubs skip the early rounds).
   */
  entrantsNotYetIn?: boolean;
  /** Single games are played at the lower-division club's ground (Copa del Rey). */
  lowerHosts?: boolean;
  /** Two legs (home and away, aggregate, then penalties); one game by default. */
  legs?: 1 | 2;
  /** Played at a neutral ground (implied by `venue`). */
  neutral?: boolean;
  /** The neutral ground's name, e.g. "Wembley". */
  venue?: string;
}

export interface CupConfig {
  kind: "cup";
  code: CupCode;
  slug: string;
  name: string;
  country: string;
  flag: FlagCode;
  simulatorName: Record<SiteLocale, string>;
  aka: Record<SiteLocale, string>;
  /** "split" seasons run August–May (2026/27); "calendar" seasons within one year. */
  espn: { slug: string; seasons: "split" | "calendar" };
  rounds: readonly CupRoundConfig[];
  /**
   * Leagues whose clubs take part, strongest first. Each club's rating comes
   * from its own league's results, scaled by the league's tier; clubs in none
   * of them are treated as non-league sides. Also used for the division tags.
   */
  feederLeagues: readonly CompetitionCode[];
  /** Rating tier of clubs in none of the feeder leagues (feeder tiers are 0, 1, 2…). */
  outsiderTier: number;
  /** Tag those clubs as "NL" (non-league); without it they get no tag. */
  tagOutsiders: boolean;
  /** What the winner is champion of, for the champion box. */
  title: string;
}

export const CUPS: readonly CupConfig[] = [
  {
    kind: "cup",
    code: "FAC",
    slug: "fa-cup",
    name: "FA Cup",
    country: "England",
    flag: "gb-eng",
    simulatorName: { en: "FA Cup Simulator", pt: "Simulador da FA Cup", es: "Simulador de la FA Cup" },
    aka: { en: "Emirates FA Cup", pt: "Copa da Inglaterra", es: "Copa de Inglaterra" },
    espn: { slug: "eng.fa", seasons: "split" },
    // From the First Round proper (80 clubs: League One, League Two and the
    // qualifiers). The 44 Premier League and Championship clubs enter in the
    // Third Round. No replays: level games go to extra time and penalties.
    rounds: [
      { key: "firstRound", espnSlug: "first-round", ties: 40 },
      { key: "secondRound", espnSlug: "second-round", ties: 20 },
      { key: "thirdRound", espnSlug: "third-round", ties: 32, entrantsFrom: ["PL", "ELC"] },
      { key: "fourthRound", espnSlug: "fourth-round", ties: 16 },
      { key: "fifthRound", espnSlug: "fifth-round", ties: 8 },
      { key: "quarterFinals", espnSlug: "quarterfinals", ties: 4 },
      { key: "semiFinals", espnSlug: "semifinals", ties: 2, venue: "Wembley" },
      { key: "final", espnSlug: "final", ties: 1, venue: "Wembley" },
    ],
    feederLeagues: ["PL", "ELC", "EL1", "EL2"],
    outsiderTier: 4.5,
    tagOutsiders: true,
    title: "FA Cup",
  },
  {
    kind: "cup",
    code: "CDB",
    slug: "copa-do-brasil",
    name: "Copa do Brasil",
    country: "Brazil",
    flag: "br",
    simulatorName: { en: "Copa do Brasil Simulator", pt: "Simulador da Copa do Brasil", es: "Simulador de la Copa de Brasil" },
    aka: { en: "Brazilian Cup", pt: "Copa do Brasil", es: "Copa de Brasil" },
    espn: { slug: "bra.copa_do_brazil", seasons: "calendar" },
    // 2026 format (126 clubs): four single-game rounds, the 20 Série A clubs
    // enter in the fifth round, two legs from there to the semi-finals (level
    // on aggregate: straight to penalties), and a single final at a neutral
    // ground. Clubs entering rounds 1–4 come from the real draw only.
    rounds: [
      { key: "firstRound", espnSlug: "first-round", ties: 14 },
      { key: "secondRound", espnSlug: "second-round", ties: 44 },
      { key: "thirdRound", espnSlug: "third-round", ties: 24 },
      { key: "fourthRound", espnSlug: "fourth-round", ties: 12 },
      { key: "fifthRound", espnSlug: "fifth-round", ties: 16, legs: 2, entrantsFrom: ["BSA"] },
      { key: "roundOf16", espnSlug: "round-of-16", ties: 8, legs: 2 },
      { key: "quarterFinals", espnSlug: "quarterfinals", ties: 4, legs: 2 },
      { key: "semiFinals", espnSlug: "semifinals", ties: 2, legs: 2 },
      { key: "final", espnSlug: "final", ties: 1, neutral: true, venue: "Mané Garrincha" },
    ],
    feederLeagues: ["BSA", "BSB"],
    // Série C, Série D and state clubs: below Série B.
    outsiderTier: 2.5,
    tagOutsiders: false,
    title: "Copa do Brasil",
  },
  {
    kind: "cup",
    code: "CDR",
    slug: "copa-del-rey",
    name: "Copa del Rey",
    country: "Spain",
    flag: "es",
    simulatorName: { en: "Copa del Rey Simulator", pt: "Simulador da Copa del Rey", es: "Simulador de la Copa del Rey" },
    aka: { en: "Spanish Cup", pt: "Copa do Rei", es: "Copa del Rey" },
    espn: { slug: "esp.copa_del_rey", seasons: "split" },
    // 2026/27: a two-legged qualifying round, then single games at the
    // lower-division club's ground (level: extra time and penalties); the four
    // Supercopa clubs enter in the round of 32; two-legged semi-finals; final
    // at La Cartuja, Seville. Clubs entering the qualifying and first rounds
    // come from the real draw.
    rounds: [
      { key: "qualifyingRound", espnSlug: "qualifying-round", ties: 10, legs: 2 },
      { key: "firstRound", espnSlug: "first-round", ties: 56, lowerHosts: true },
      { key: "secondRound", espnSlug: "second-round", ties: 28, lowerHosts: true },
      { key: "roundOf32", espnSlug: "round-of-32", ties: 16, lowerHosts: true, entrantsFrom: ["PD"], entrantsNotYetIn: true },
      { key: "roundOf16", espnSlug: "round-of-16", ties: 8, lowerHosts: true },
      { key: "quarterFinals", espnSlug: "quarterfinals", ties: 4, lowerHosts: true },
      { key: "semiFinals", espnSlug: "semifinals", ties: 2, legs: 2 },
      { key: "final", espnSlug: "final", ties: 1, neutral: true, venue: "La Cartuja" },
    ],
    feederLeagues: ["PD", "SD"],
    // Primera Federación and below.
    outsiderTier: 3,
    tagOutsiders: false,
    title: "Copa del Rey",
  },
];

export function getCupBySlug(slug: string): CupConfig | undefined {
  return CUPS.find((c) => c.slug === slug);
}
