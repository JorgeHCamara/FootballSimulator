import type { CompetitionCode, FlagCode, SiteLocale } from "./leagues.ts";

// Knockout cups. Unlike a league, a cup has no table: each round's pairings are
// drawn, and clubs from several divisions (and outside the league system) meet.

export type CupCode = "FAC" | "CDB" | "CDR" | "CIT" | "DFB" | "EFC" | "CDF" | "CAR";

export type CupRoundKey =
  | "preliminaryRound"
  | "qualifyingRound"
  | "firstRound"
  | "secondRound"
  | "thirdRound"
  | "fourthRound"
  | "fifthRound"
  | "seventhRound"
  | "eighthRound"
  | "roundOf64"
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
  /**
   * Fixed bracket instead of a draw (Coppa Italia): the round's ties pair the
   * clubs from neighbouring slots of the bracket (see `CupConfig.bracketOrder`).
   */
  bracket?: boolean;
  /**
   * A level tie goes straight to penalties, without extra time (the EFL Cup
   * before the final); false: extra time, then penalties. Only the rule shown
   * changes (a level game is decided on penalties either way, as the engine
   * plays no extra time); unset, no rule is shown (the cups so far).
   */
  noExtraTime?: boolean;
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
  /**
   * With `lowerHosts`: only clubs at or below this tier get the home game, and
   * only against a club above it (DFB-Pokal: amateur clubs host professional
   * ones; otherwise the draw order stands). Without it, the lower club hosts.
   */
  hostTier?: number;
  /**
   * With `lowerHosts`: a club hosts only when it is at least this many tiers
   * below its opponent (Coupe de France: two divisions); else the draw order.
   */
  hostGap?: number;
  /** What the winner is champion of, for the champion box. */
  title: string;
  /**
   * My World (src/lib/worldCups.ts): how many clubs of each feeder league enter,
   * the strongest of each by last season's table (the Copa Argentina: every
   * Liga Profesional club, the Primera Nacional's best 15), the other places
   * going to clubs from below. Without it, every league club enters.
   */
  worldEntrants?: readonly number[];
  /** No Past Winners page on the site (the Copa Argentina: its Past Winners are My World's only, for now). */
  noPastWinnersPage?: true;
  /**
   * Fixed bracket order of the round before the first `bracket` round: the
   * home club (feed team id) of each of its ties, top to bottom. Without it,
   * or when the clubs don't match (another season), the slot order is used.
   */
  bracketOrder?: readonly number[];
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
  {
    kind: "cup",
    code: "CIT",
    slug: "coppa-italia",
    name: "Coppa Italia",
    country: "Italy",
    flag: "it",
    simulatorName: { en: "Coppa Italia Simulator", pt: "Simulador da Coppa Italia", es: "Simulador de la Coppa Italia" },
    aka: { en: "Italian Cup", pt: "Copa da Itália", es: "Copa de Italia" },
    espn: { slug: "ita.coppa_italia", seasons: "split" },
    // 2026/27: 44 clubs (Serie A, Serie B and four Serie C clubs) in a fixed,
    // seeded bracket with no draws. Single games (the seeded club at home;
    // level: extra time and penalties), the top eight Serie A clubs enter in
    // the round of 16, two-legged semi-finals, final at the Stadio Olimpico.
    rounds: [
      { key: "preliminaryRound", espnSlug: "preliminary-round", ties: 4 },
      { key: "firstRound", espnSlug: "first-round", ties: 16 },
      { key: "secondRound", espnSlug: "second-round", ties: 8 },
      { key: "roundOf16", espnSlug: "round-of-16", ties: 8, entrantsFrom: ["SA"], entrantsNotYetIn: true },
      { key: "quarterFinals", espnSlug: "quarterfinals", ties: 4, bracket: true },
      { key: "semiFinals", espnSlug: "semifinals", ties: 2, legs: 2, bracket: true },
      { key: "final", espnSlug: "final", ties: 1, neutral: true, venue: "Stadio Olimpico", bracket: true },
    ],
    // 2026/27 bracket, round of 16 top to bottom: Inter, Bologna | Milan, Como
    // (semi-final 1); Roma, Juventus | Napoli, Atalanta (semi-final 2).
    bracketOrder: [110, 107, 103, 2572, 104, 111, 114, 105],
    feederLeagues: ["SA", "SB"],
    // Serie C clubs.
    outsiderTier: 2.5,
    tagOutsiders: false,
    title: "Coppa Italia",
  },
  {
    kind: "cup",
    code: "DFB",
    slug: "dfb-pokal",
    name: "DFB-Pokal",
    country: "Germany",
    flag: "de",
    simulatorName: { en: "DFB-Pokal Simulator", pt: "Simulador da DFB-Pokal", es: "Simulador de la DFB-Pokal" },
    aka: { en: "German Cup", pt: "Copa da Alemanha", es: "Copa de Alemania" },
    espn: { slug: "ger.dfb_pokal", seasons: "split" },
    // 64 clubs from the first round: the 36 Bundesliga and 2. Bundesliga clubs,
    // the top 3. Liga clubs and the regional cup winners. Single games (level:
    // extra time and penalties), a fresh draw every round, and an amateur club
    // (3. Liga and below) drawn against a professional one plays at home up to
    // the semi-finals. Final at the Olympiastadion in Berlin.
    rounds: [
      { key: "firstRound", espnSlug: "first-round", ties: 32 },
      { key: "secondRound", espnSlug: "second-round", ties: 16, lowerHosts: true },
      { key: "roundOf16", espnSlug: "round-of-16", ties: 8, lowerHosts: true },
      { key: "quarterFinals", espnSlug: "quarterfinals", ties: 4, lowerHosts: true },
      { key: "semiFinals", espnSlug: "semifinals", ties: 2, lowerHosts: true },
      { key: "final", espnSlug: "final", ties: 1, neutral: true, venue: "Olympiastadion Berlin" },
    ],
    feederLeagues: ["BL1", "BL2"],
    // 3. Liga and the regional leagues.
    outsiderTier: 2.5,
    hostTier: 2,
    tagOutsiders: false,
    title: "DFB-Pokal",
  },
  {
    kind: "cup",
    code: "EFC",
    slug: "efl-cup",
    name: "EFL Cup",
    country: "England",
    flag: "gb-eng",
    simulatorName: { en: "EFL Cup Simulator", pt: "Simulador da Copa da Liga Inglesa", es: "Simulador de la Copa de la Liga de Inglaterra" },
    aka: { en: "Carabao Cup", pt: "Copa da Liga Inglesa, Carabao Cup", es: "Copa de la Liga de Inglaterra, Carabao Cup" },
    espn: { slug: "eng.league_cup", seasons: "split" },
    // 2026/27: a preliminary round of two ties, then the 70 EFL clubs in the
    // first round. Eleven Premier League clubs enter in the second round (the
    // real draw names them) and the nine in Europe in the third round. Single
    // games with no extra time (level after 90 minutes: straight to
    // penalties), two-legged semi-finals decided on aggregate then penalties,
    // and a final at Wembley with extra time before penalties.
    rounds: [
      { key: "preliminaryRound", espnSlug: "preliminary-round", ties: 2, noExtraTime: true },
      { key: "firstRound", espnSlug: "first-round", ties: 35, noExtraTime: true },
      { key: "secondRound", espnSlug: "second-round", ties: 23, noExtraTime: true },
      { key: "thirdRound", espnSlug: "third-round", ties: 16, entrantsFrom: ["PL"], entrantsNotYetIn: true, noExtraTime: true },
      { key: "fourthRound", espnSlug: "fourth-round", ties: 8, noExtraTime: true },
      { key: "quarterFinals", espnSlug: "quarterfinals", ties: 4, noExtraTime: true },
      { key: "semiFinals", espnSlug: "semifinals", ties: 2, legs: 2, noExtraTime: true },
      { key: "final", espnSlug: "final", ties: 1, neutral: true, venue: "Wembley", noExtraTime: false },
    ],
    feederLeagues: ["PL", "ELC", "EL1", "EL2"],
    // Every club is one of the 92; a club outside them would rate as non-league.
    outsiderTier: 4.5,
    tagOutsiders: false,
    title: "EFL Cup",
  },
  {
    kind: "cup",
    code: "CDF",
    slug: "coupe-de-france",
    name: "Coupe de France",
    country: "France",
    flag: "fr",
    simulatorName: { en: "Coupe de France Simulator", pt: "Simulador da Coupe de France", es: "Simulador de la Coupe de France" },
    aka: { en: "French Cup", pt: "Copa da França", es: "Copa de Francia" },
    espn: { slug: "fra.coupe_de_france", seasons: "split" },
    // 2026/27 from the seventh round, the first one ESPN lists: the 18 Ligue 2
    // clubs, 155 from the regional rounds and 11 from overseas (92 ties). The
    // seventh and eighth rounds were drawn together, so the real eighth round
    // follows the seventh; the 18 Ligue 1 clubs join the 46 left in the round
    // of 64. Single games, a draw every round, a club at least two divisions
    // below its opponent plays at home up to the semi-finals, and a game level
    // after 90 minutes goes straight to penalties, except in the final (extra
    // time first) at the Stade de France.
    rounds: [
      { key: "seventhRound", espnSlug: "seventh-round", ties: 92, lowerHosts: true, noExtraTime: true },
      { key: "eighthRound", espnSlug: "eighth-round", ties: 46, lowerHosts: true, noExtraTime: true },
      { key: "roundOf64", espnSlug: "round-of-64", ties: 32, entrantsFrom: ["FL1"], entrantsNotYetIn: true, lowerHosts: true, noExtraTime: true },
      { key: "roundOf32", espnSlug: "round-of-32", ties: 16, lowerHosts: true, noExtraTime: true },
      { key: "roundOf16", espnSlug: "round-of-16", ties: 8, lowerHosts: true, noExtraTime: true },
      { key: "quarterFinals", espnSlug: "quarterfinals", ties: 4, lowerHosts: true, noExtraTime: true },
      { key: "semiFinals", espnSlug: "semifinals", ties: 2, lowerHosts: true, noExtraTime: true },
      { key: "final", espnSlug: "final", ties: 1, neutral: true, venue: "Stade de France", noExtraTime: false },
    ],
    feederLeagues: ["FL1", "FL2"],
    // National, National 2, National 3 and the regional leagues.
    outsiderTier: 3,
    hostGap: 2,
    tagOutsiders: false,
    title: "Coupe de France",
  },
  {
    kind: "cup",
    code: "CAR",
    slug: "copa-argentina",
    name: "Copa Argentina",
    country: "Argentina",
    flag: "ar",
    simulatorName: { en: "Copa Argentina Simulator", pt: "Simulador da Copa Argentina", es: "Simulador de la Copa Argentina" },
    aka: { en: "Argentine Cup", pt: "Copa da Argentina", es: "Copa Argentina" },
    espn: { slug: "arg.copa", seasons: "calendar" },
    // 2026 (AFA, Boletín 6811): 64 clubs (the 30 of the 2025 Liga
    // Profesional, 15 from the Primera Nacional, 5 from the Primera B, 10
    // from the Torneo Federal A and 4 from the Primera C) on a fixed bracket
    // drawn in December 2025, from the round of 64 to the final. Every game is
    // a single match at a neutral ground; level after 90 minutes: straight to
    // penalties. The winner goes to the 2027 Copa Libertadores.
    rounds: [
      { key: "roundOf64", espnSlug: "round-of-64", ties: 32, neutral: true, noExtraTime: true },
      { key: "roundOf32", espnSlug: "round-of-32", ties: 16, neutral: true, noExtraTime: true, bracket: true },
      { key: "roundOf16", espnSlug: "round-of-16", ties: 8, neutral: true, noExtraTime: true, bracket: true },
      { key: "quarterFinals", espnSlug: "quarterfinals", ties: 4, neutral: true, noExtraTime: true, bracket: true },
      { key: "semiFinals", espnSlug: "semifinals", ties: 2, neutral: true, noExtraTime: true, bracket: true },
      { key: "final", espnSlug: "final", ties: 1, neutral: true, noExtraTime: true, bracket: true },
    ],
    feederLeagues: ["ARG", "PN"],
    // Primera B, Federal A and Primera C clubs: below the Primera Nacional.
    outsiderTier: 2.5,
    tagOutsiders: false,
    title: "Copa Argentina",
    // My World: the Liga Profesional's 30, the Primera Nacional's best 15, 19 clubs from below.
    worldEntrants: [30, 15],
    noPastWinnersPage: true,
    // 2026 bracket, round of 64 top to bottom (ESPN's home club of each tie):
    // San Lorenzo v Deportivo Rincón … Boca Juniors v Gimnasia (Chivilcoy) |
    // River Plate v Ciudad de Bolívar … Huracán v Olimpo.
    bracketOrder: [18, 17702, 14, 9, 235, 19685, 6756, 3, 15, 8950, 11989, 4, 21, 11972, 10158, 5, 16, 9739, 9744, 7767, 19, 9785, 20, 11, 7764, 7845, 2975, 12, 8, 17, 10060, 10],
  },
];

export function getCupBySlug(slug: string): CupConfig | undefined {
  return CUPS.find((c) => c.slug === slug);
}
