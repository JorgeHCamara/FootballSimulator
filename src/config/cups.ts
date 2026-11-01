import type { CompetitionCode, FlagCode, SiteLocale } from "./leagues.ts";

// Knockout cups. Unlike a league, a cup has no table: each round's pairings are
// drawn, and clubs from several divisions (and outside the league system) meet.

export type CupCode = "FAC";

export type CupRoundKey =
  | "firstRound"
  | "secondRound"
  | "thirdRound"
  | "fourthRound"
  | "fifthRound"
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
  /** Single match at a neutral ground, e.g. "Wembley". */
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
  espn: { slug: string };
  rounds: readonly CupRoundConfig[];
  /**
   * Leagues whose clubs take part, strongest first. Each club's rating comes
   * from its own league's results, scaled by the league's tier; clubs in none
   * of them are treated as non-league sides. Also used for the division tags.
   */
  feederLeagues: readonly CompetitionCode[];
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
    espn: { slug: "eng.fa" },
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
    title: "FA Cup",
  },
];

export function getCupBySlug(slug: string): CupConfig | undefined {
  return CUPS.find((c) => c.slug === slug);
}
