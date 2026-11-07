import type { CupRoundKey } from "../config/cups.ts";
import type { LeagueConfig } from "../config/leagues.ts";
import { NATIONAL_LEAGUE_CLUBS } from "../config/nationalLeague.ts";
import { expectedGoals, expectedGoalsNeutral, sampleDixonColes, sampleLikelyScore, simulateFixtures } from "../engine/match.ts";
import { tierStrength } from "../engine/cupModel.ts";
import { seasonRatings, type SeasonRatings } from "../engine/offseason.ts";
import {
  buildBracket,
  isShootoutId,
  needsShootout,
  playoffIds,
  seriesGames,
  simulatePenalties,
  simulatePlayoff,
  tieIds,
  tieOutcome,
  type BracketOptions,
  type PlayoffConfig,
  type PlayoffTie,
} from "../engine/playoffs.ts";
import type { LeagueModel } from "../engine/ratings.ts";
import { effectiveResults, isValidScore } from "../engine/results.ts";
import { createRng, randomSeed, type Rng } from "../engine/rng.ts";
import { balancedDoubleRoundRobin, doubleRoundRobin } from "../engine/schedule.ts";
import { computeStandings, sortFixtures } from "../engine/standings.ts";
import type { Fixture, ResultMap, Score, StandingRow, Team, TeamId } from "../engine/types.ts";
import {
  COUNTRY_CUPS,
  COUNTRY_LEAGUES,
  cupCountry,
  divisionConfig,
  divisionCountry,
  LOWER_LEAGUE,
  neighbours,
  pyramidPlayoffOf,
  WORLD_COUNTRIES,
  WORLD_CUPS,
  WORLD_LEAGUES,
  worldCups,
  worldDivisions,
  type DivisionCode,
  type LowerCode,
  type PyramidPlayoff,
  type WorldCountry,
  type WorldCupCode,
} from "./worldCountries.ts";
import { cupConfig, cupPlayable, finishCups, generateCup, outsidersNeeded, type SavedCup, type WorldCupSeason, type WorldCupTie } from "./worldCups.ts";
import { divisionForm, seasonRng, shuffled, teamOf } from "./worldForm.ts";
import { nextSeason } from "./worldLevels.ts";

export {
  COUNTRY_CUPS,
  COUNTRY_FLAG,
  COUNTRY_LEAGUES,
  cupCountry,
  divisionConfig,
  divisionCountry,
  ENGLAND,
  GERMANY,
  isDivision,
  isWorldCountry,
  LOWER_LEAGUE,
  neighbours,
  PYRAMID_PLAYOFFS,
  pyramidPlayoffOf,
  SPAIN,
  WORLD_COUNTRIES,
  WORLD_LEAGUES,
  worldCups,
  worldDivisions,
  type DivisionCode,
  type LowerCode,
  type PyramidPlayoff,
  type WorldCountry,
} from "./worldCountries.ts";

/*
 * My World: a fictional timeline of one or more countries' football pyramids
 * (England's, Premier League to League Two; Spain's, La Liga and the Segunda
 * División; Germany's, the Bundesliga and the 2. Bundesliga;
 * src/lib/worldCountries.ts), started from the site's live data and
 * played on season by season in the visitor's browser (saved by
 * src/lib/myWorldStorage.ts). A world is set up with its countries
 * (World.countries) and plays every league and cup of each.
 *
 * A season plays every league with the site's own engine: each game's score
 * from the club ratings (Dixon–Coles, as the season outlook draws them, with
 * its season rating noise), the table with the league's tiebreakers, and the
 * league's own play-off. Promotion and relegation come from the league configs
 * (their promotion and relegation places, and the play-off winner), applied to
 * a country's leagues at once; a reserve side (the Segunda División's B teams)
 * is never promoted, its place passing down; a play-off between two divisions
 * (the Bundesliga's 16th v the 2. Bundesliga's 3rd) decides one more place
 * either way. The bottom division's relegated
 * clubs drop into the league below (England's National League, Spain's
 * Primera Federación) for a season, and its clubs come up in their place
 * (Boreham Wood and Harrogate Town the first time in England; in Spain, clubs
 * of the real Copa del Rey's lower rounds). The cups are part of every season
 * too (src/lib/worldCups.ts): the first season takes the real cups where they
 * stand, every later one is drawn among the world's clubs, with the real cups'
 * non-league sides (World.cupPool) in the FA Cup and the Copa del Rey.
 *
 * Between seasons each club's rating carries over through the world's own
 * rule (src/lib/worldLevels.ts): every club has a level, where it stands over
 * the years (its real rating when the world starts, then settling a little
 * each season towards how it did), and a season's rating starts from that
 * level keeping only part of the season just played; a promoted club becomes
 * a below-average one in its new league, a relegated club the reverse, and a
 * new club starts below average (the real starting ratings' values,
 * src/engine/offseason.ts). Nothing here touches the live outlook, snapshots
 * or SIM_VERSION.
 *
 * A season is played league by league as on the league pages: any score typed
 * in, a dice roll for one game, a matchday or the rest of a league simulated
 * (setScore, rollScore, simulateMatchday, simulateRest). The dice make a likely
 * roll, as there; the matchday and the rest of the season are drawn from the
 * full score distribution, from the season's form, as a whole season is, so
 * the tables look like real ones (likely rolls never let a club win a game it
 * has under a one-in-five chance of winning: over a season, a 106-point
 * champion and a 9-point bottom club). The cups are played round by round the
 * same way. Every score is kept in the save (DivisionSeason.scores,
 * WorldCupSeason.scores); once every game of the four leagues and the two
 * cups is decided, playSeason finishes the season (it would draw any game
 * left from the season's form) and the next one starts. Each finished season
 * keeps its final tables and every result (SavedDivision.games and .playoff,
 * SavedCup.ties), to look back at.
 */

/** The save's format: a save of another version is set aside, not read (see myWorldStorage.ts). */
export const WORLD_VERSION = 1;


/** "2026/27" for the season starting in 2026. */
export const seasonLabel = (year: number) => `${year}/${String((year + 1) % 100).padStart(2, "0")}`;

/** A club of the world: a real one from the site's data, or a new one that came up from below. */
export interface WorldClub {
  id: TeamId;
  name: string;
  shortName: string;
  tla: string;
  crest?: string;
  origin: "real" | "new";
  /** Its country (England for clubs from before Spain came). */
  country?: WorldCountry;
  /** A real club's id in the site's data. */
  realId?: number;
  /** A new club: the season it joined the pyramid. */
  joined?: number;
  /** The season it dropped out of the bottom division (it stays in the save, for a lower league later). */
  left?: number;
}

/** A division's goal rates and Dixon–Coles rho, from the live model; the same every season. */
export interface DivisionParams {
  avgHomeGoals: number;
  avgAwayGoals: number;
  rho: number;
}

/** A game: [id, matchday, home club, away club, home goals, away goals] (goals null until played). */
export type WorldGame = [number, number, TeamId, TeamId, number | null, number | null];
/** A real play-off game: [id, home, away, date, home goals, away goals, neutral (1), penalties home, penalties away]. */
export type WorldPlayoffGame = [number, TeamId, TeamId, string, number | null, number | null, 0 | 1, number | null, number | null];

/** A division's season in progress. */
export interface DivisionSeason {
  code: DivisionCode;
  clubs: TeamId[];
  /**
   * Its games, for the world's first season only: the real calendar with the
   * results so far. Later seasons play a new double round robin.
   */
  games?: WorldGame[];
  /** Points deducted (the first season's real ones), by club. */
  deductions?: Record<number, number>;
  /** Real play-off games already played (a world started during the play-offs). */
  playoffGames?: WorldPlayoffGame[];
  /**
   * The season's scores so far beyond the ones it started with: typed in,
   * rolled or simulated, by game id (league games, then play-off legs and
   * shoot-outs). Over a game the world started with a result for, the score
   * here replaces it.
   */
  scores?: Record<number, [number, number]>;
  /**
   * A generated season's calendar: 2, a real league's home-and-away rhythm
   * (balancedDoubleRoundRobin: never three home or three away games in a row).
   * Without it, the first calendar (doubleRoundRobin), kept only for a season
   * that was already being played when calendar 2 came (its scores belong to
   * those games; see upgradeWorld).
   */
  calendar?: 2;
}

/**
 * What a club's season ended with: "C" champions (and promoted below the top),
 * "P" promoted, "W" won the play-off (promoted), "O" lost in the play-offs,
 * "R" relegated (from the bottom division: out of the pyramid), "" none.
 */
export type RowNote = "" | "C" | "P" | "W" | "O" | "R";
/** A saved table row: [club, played, won, drawn, lost, goals for, goals against, points, note]. */
export type SavedRow = [TeamId, number, number, number, number, number, number, number, RowNote];

export interface SavedDivision {
  code: DivisionCode;
  /** The final table, in order. */
  rows: SavedRow[];
  /** The play-off final: [winner, runner-up, winner's goals, runner-up's goals, decided on penalties]. */
  final?: [TeamId, TeamId, number, number, boolean];
  /**
   * Every league game with its score, packed five characters a game (see
   * packGames): its matchday, its clubs (by their place in `rows`) and the
   * goals. Kept for the last FIXTURE_SEASONS seasons (and absent from seasons
   * finished before results were kept).
   */
  games?: string;
  /** The play-off's scores, by game id (legs and shoot-outs, as the bracket numbers them). */
  playoff?: Record<number, [number, number]>;
}

/** Finished seasons whose every result is kept (older ones keep their final tables only). */
export const FIXTURE_SEASONS = 50;

const packChar = (n: number) => String.fromCharCode(48 + n);

/** A season's league games and scores in five characters a game: matchday, home and away club (place in `rows`), home and away goals. */
export function packGames(fixtures: readonly Fixture[], results: ResultMap, rows: readonly { teamId: TeamId }[]): string {
  const place = new Map(rows.map((r, i) => [r.teamId, i]));
  return sortFixtures(fixtures)
    .map((f) => {
      const score = results[f.id]!;
      return packChar(f.matchday) + packChar(place.get(f.homeId)!) + packChar(place.get(f.awayId)!) + packChar(score.home) + packChar(score.away);
    })
    .join("");
}

/** The games packGames packed, with their clubs' ids. */
export function unpackGames(packed: string, rows: readonly SavedRow[]): { matchday: number; homeId: TeamId; awayId: TeamId; home: number; away: number }[] {
  const at = (i: number) => packed.charCodeAt(i) - 48;
  return Array.from({ length: Math.floor(packed.length / 5) }, (_, g) => ({
    matchday: at(g * 5),
    homeId: rows[at(g * 5 + 1)]![0],
    awayId: rows[at(g * 5 + 2)]![0],
    home: at(g * 5 + 3),
    away: at(g * 5 + 4),
  }));
}

/** A finished season, as saved: every division's final table, who left the pyramid and who joined it, and the cups. */
export interface SeasonRecord {
  year: number;
  divisions: SavedDivision[];
  /** Clubs relegated out of the bottom division (into the National League). */
  out: TeamId[];
  /** Clubs that came up into it for the next season: the National League's (they spent this season there). */
  in: TeamId[];
  /** The FA Cup and the EFL Cup: their finals and every tie (absent from seasons finished before the cups). */
  cups?: SavedCup[];
}

/** A place in a finished season's top three: [club, its name that season, its points]. */
export type WorldPodium = [TeamId, string, number];

/** A finished season's top three in one division, for Past Winners (src/lib/worldWinners.ts). */
export interface WorldWinners {
  year: number;
  code: DivisionCode;
  /** 1st, 2nd, 3rd. */
  top: WorldPodium[];
}

export interface World {
  version: typeof WORLD_VERSION;
  /** Which pyramid (only England so far). */
  pyramid: "ENG";
  /** The countries the world plays, as chosen at setup (every league and cup of each), in the fixed order. */
  countries: WorldCountry[];
  id: string;
  createdAt: string;
  seed: number;
  /** The visitor's club. */
  userClub: TeamId;
  /** The season in progress, by the year it starts (2026 = 2026/27). */
  year: number;
  /** Every club the world has had, including those that left. */
  clubs: Record<number, WorldClub>;
  /** Each club's rating for the season in progress: [attack, defence] relative to its division (attack above 1 scores more, defence above 1 concedes more). */
  ratings: Record<number, [number, number]>;
  /**
   * Each club's level, where it stands over the years, on the same scale as
   * its rating: its real rating when the world started, then settling a little
   * each season towards how it did (src/lib/worldLevels.ts). Kept for clubs
   * that left too (a club back from the league below returns at its old level).
   */
  levels: Record<number, [number, number]>;
  params: Record<DivisionCode, DivisionParams>;
  /** The season in progress: each country's divisions, top first (worldDivisions). */
  divisions: DivisionSeason[];
  /** Finished seasons, oldest first. */
  history: SeasonRecord[];
  /** The last season has just ended: its review shows, and the next season's tables and fixtures wait until it's started. */
  review: boolean;
  /**
   * The clubs below each country's bottom division this season (each with its
   * country: England's National League, Spain's Primera Federación): at the
   * season's end they come up in place of the clubs relegated from it, who
   * take their place. Boreham Wood and Harrogate Town to begin with in England;
   * none in Spain, whose first relegated clubs swap with Copa del Rey sides
   * from the pool.
   */
  nationalLeague: TeamId[];
  /** How many fictional new clubs have come up so far (worlds from before the National League; else only when a country is short of clubs). */
  newClubs: number;
  /** Every finished season's top three in each division, oldest first: the world's own Past Winners. */
  winners: WorldWinners[];
  /** The season's cups, each country's in order (src/lib/worldCups.ts). */
  cups: WorldCupSeason[];
  /**
   * The non-league sides that play the cups (the real cups', when the world
   * started; each with its country): with the clubs below the bottom division
   * they fill the FA Cup's and the Copa del Rey's opening rounds every season,
   * in a new order each time. They play no league, unless a country short of
   * clubs below its bottom division takes some up (Spain, the first time).
   */
  cupPool: TeamId[];
}

/** The National League clubs' world ids: clear of the real clubs' (numbered from 1) and the fictional ones'. */
export const NATIONAL_LEAGUE_ID_BASE = 90_000;

/** The cups' non-league sides' world ids (World.cupPool). */
export const CUP_POOL_ID_BASE = 80_000;

/** The National League's clubs a world starts with (src/config/nationalLeague.ts), as world clubs. */
export const nationalLeagueClubs = (): WorldClub[] =>
  NATIONAL_LEAGUE_CLUBS.map((c, i) => ({ id: NATIONAL_LEAGUE_ID_BASE + i + 1, name: c.name, shortName: c.shortName, tla: c.tla, crest: c.crest, origin: "real", country: "ENG", realId: c.espnId }));

/** A club's country (England for clubs from before Spain came). */
export const clubCountry = (club: Pick<WorldClub, "country">): WorldCountry => club.country ?? "ENG";

/** One league as the live data has it (src/lib/myWorldStart.ts builds these on the server). */
export interface StartLeague {
  code: DivisionCode;
  year: number;
  teams: Pick<Team, "id" | "name" | "shortName" | "tla" | "crest">[];
  games: WorldGame[];
  deductions?: Record<number, number>;
  playoffGames?: WorldPlayoffGame[];
  /** The live model: goal rates, rho, and each club's [attack, defence]. */
  model: DivisionParams & { strengths: Record<number, [number, number]> };
}

/** One cup as the live data has it (src/lib/myWorldStart.ts): the world's first season takes it over where it stands. */
export interface StartCup {
  code: WorldCupCode;
  /** The cup season's starting year (2026 for 2026/27). */
  year: number;
  /** Every club in the competition: the league clubs and the non-league sides. */
  teams: Pick<Team, "id" | "name" | "shortName" | "tla" | "crest">[];
  /** Each league club's division; the others are non-league sides. */
  divisions: Record<number, DivisionCode>;
  /** The real draw so far, with its results (the live data's ids). */
  real: WorldCupTie[];
  /** Clubs entering in later rounds (the live data's ids). */
  entrants: Partial<Record<CupRoundKey, number[]>>;
}

/** Everything a new world starts from (every country's leagues and cups); `missing`: those whose live data didn't load (their country can't be played then). */
export interface StartPack {
  leagues: StartLeague[];
  cups: StartCup[];
  missing: (DivisionCode | WorldCupCode)[];
}

/**
 * A saved world brought up to date when it loads: a generated season not yet
 * being played (no scores) takes calendar 2, the realistic home-and-away
 * rhythm; one already being played keeps the calendar its scores belong to.
 * `pack`: the live data (for the FA Cup's non-league sides, when a world from
 * before the cups gets them).
 */
export function upgradeWorld(world: World, pack?: StartPack): World {
  let upgraded = world;
  if (world.divisions.some((d) => !d.games && d.calendar !== 2 && !d.scores)) {
    upgraded = { ...upgraded, divisions: upgraded.divisions.map((d) => (!d.games && d.calendar !== 2 && !d.scores ? { ...d, calendar: 2 as const } : d)) };
  }
  // A world from before the National League: the clubs relegated from League Two last season are in it now (they come
  // back up after this season); in a first season, Boreham Wood and Harrogate Town.
  if (!Array.isArray((upgraded as Partial<World>).nationalLeague)) {
    const clubs = { ...upgraded.clubs };
    const last = upgraded.history.at(-1)?.out ?? [];
    const playing = new Set(upgraded.divisions.flatMap((d) => d.clubs));
    let nationalLeague = last.filter((id) => clubs[id] && !playing.has(id));
    if (!nationalLeague.length) {
      for (const club of nationalLeagueClubs()) clubs[club.id] = club;
      nationalLeague = nationalLeagueClubs().map((c) => c.id);
    }
    upgraded = { ...upgraded, clubs, nationalLeague };
  }
  // A world from before the countries were chosen: England's.
  if (!Array.isArray((upgraded as Partial<World>).countries)) upgraded = { ...upgraded, countries: ["ENG"] };
  // A world from before the club levels: each club's level is its rating as it stands.
  if (typeof (upgraded as Partial<World>).levels !== "object" || (upgraded as Partial<World>).levels === null) {
    upgraded = { ...upgraded, levels: Object.fromEntries(Object.entries(upgraded.ratings).map(([id, r]) => [id, [r[0], r[1]]])) };
  }
  // A world from before Past Winners: its finished seasons' top three, from their saved tables.
  if (!Array.isArray((upgraded as Partial<World>).winners)) {
    const { clubs, history } = upgraded;
    upgraded = {
      ...upgraded,
      winners: history.flatMap((s) => s.divisions.map((d) => ({ year: s.year, code: d.code, top: d.rows.slice(0, 3).map((r): WorldPodium => [r[0], clubs[r[0]]?.name ?? "", r[7]]) }))),
    };
  }
  // A world from before the cups: the FA Cup's non-league sides from the live data (fictional ones without it), and this
  // season's cups drawn among the world's clubs. A cup whose season no longer fits its rounds (a changed format) is redrawn.
  const partial = upgraded as Partial<World>;
  if (!Array.isArray(partial.cups) || !Array.isArray(partial.cupPool)) {
    const { clubs, cupPool } = worldPool(upgraded.clubs, (pack?.cups ?? []).filter((c) => upgraded.countries.includes(cupCountry(c.code))));
    upgraded = withCups({ ...upgraded, clubs, cupPool, cups: [] }, WORLD_CUPS);
  } else {
    const redraw = upgraded.cups.filter((c) => !cupPlayable(c)).map((c) => c.code);
    if (redraw.length) upgraded = withCups(upgraded, redraw);
  }
  return upgraded;
}

/** Can a world with these countries start from this pack: each one's leagues, with full clubs lists, in the same season, and its cups. */
export function packReady(pack: StartPack, countries: readonly WorldCountry[] = ["ENG"]): boolean {
  if (!countries.length) return false;
  const divisions = worldDivisions(countries);
  const cups = worldCups(countries);
  if (pack.missing.some((code) => (divisions as readonly string[]).includes(code) || (cups as readonly string[]).includes(code))) return false;
  const leagues = divisions.map((code) => pack.leagues.find((l) => l.code === code));
  const years = new Set(leagues.map((l) => l?.year));
  return leagues.every((league, i) => league !== undefined && league.teams.length === divisionConfig(divisions[i]!).teams) && years.size === 1 && cups.every((code) => pack.cups.some((c) => c.code === code));
}

/** A club's quality from its rating: more goals scored and fewer conceded. */
const quality = (world: Pick<World, "ratings">, id: TeamId) => (world.ratings[id]?.[0] ?? 1) / (world.ratings[id]?.[1] ?? 1);

/**
 * Each division's clubs this season from the weakest up, for the cups' entry
 * rounds (src/lib/worldCups.ts): the clubs up from below, then last season's
 * table from the bottom, then the clubs down from above; by rating when there
 * is no last season (a world's first season).
 */
export function divisionRanking(world: World): TeamId[][] {
  const last = world.history.at(-1);
  return world.divisions.map((d) => {
    if (!last) return [...d.clubs].sort((a, b) => quality(world, a) - quality(world, b) || a - b);
    const placeIn = (code: DivisionCode | undefined) => new Map(last.divisions.find((x) => x.code === code)?.rows.map((r, p) => [r[0], p]) ?? []);
    const next = neighbours(d.code);
    const here = placeIn(d.code);
    const above = next.above ? placeIn(next.above) : new Map<TeamId, number>();
    const below = next.below ? placeIn(next.below) : new Map(last.in.map((id, p) => [id, p]));
    // Up from below (the weakest), stayed, down from above (the strongest); within each, the lowest-placed first.
    const group = (id: TeamId) => (here.has(id) ? 1 : above.has(id) ? 2 : 0);
    const place = (id: TeamId) => here.get(id) ?? above.get(id) ?? below.get(id) ?? -1;
    return [...d.clubs].sort((a, b) => group(a) - group(b) || place(b) - place(a) || a - b);
  });
}

/**
 * The cups' non-league sides (World.cupPool) from the live cups': every club
 * of each in no league, as world clubs of the cup's country (a club the world
 * has already, such as a National League club, is the world's own). Without
 * the live data, no pool: fillPool makes it up.
 */
function worldPool(clubs: Readonly<Record<number, WorldClub>>, starts: readonly StartCup[]): { clubs: Record<number, WorldClub>; cupPool: TeamId[] } {
  const out = { ...clubs };
  const cupPool: TeamId[] = [];
  const known = new Set(Object.values(clubs).flatMap((c) => (c.realId !== undefined ? [`${clubCountry(c)}:${c.realId}`] : [])));
  NATIONAL_LEAGUE_CLUBS.forEach((c, i) => {
    if (clubs[NATIONAL_LEAGUE_ID_BASE + i + 1]) known.add(`ENG:${c.espnId}`);
  });
  let next = CUP_POOL_ID_BASE + 1;
  while (out[next]) next++;
  for (const start of starts) {
    const country = cupCountry(start.code);
    // Only a cup with sides from outside the leagues (the FA Cup, the Copa del Rey) brings any in.
    if (outsidersNeeded(cupConfig(start.code), COUNTRY_LEAGUES[country].reduce((n, code) => n + divisionConfig(code).teams, 0)) === 0) continue;
    for (const team of start.teams) {
      if (start.divisions[team.id] || known.has(`${country}:${team.id}`)) continue;
      const id = next++;
      out[id] = { id, name: team.name, shortName: team.shortName, tla: team.tla, ...(team.crest ? { crest: team.crest } : {}), origin: "real", country, realId: team.id };
      known.add(`${country}:${team.id}`);
      cupPool.push(id);
    }
  }
  return { clubs: out, cupPool };
}

/** The clubs of `ids` from one country. */
const ofCountry = (world: Pick<World, "clubs">, ids: readonly TeamId[], country: WorldCountry) => ids.filter((id) => clubCountry(world.clubs[id]!) === country);

/** A country's pool made up to what its cups need (the clubs below its bottom division count), with fictional new clubs. */
function fillPool(world: World): World {
  let out = world;
  for (const country of world.countries) {
    const leagueClubs = world.divisions.filter((d) => divisionCountry(d.code) === country).reduce((n, d) => n + d.clubs.length, 0);
    const needed = Math.max(0, ...COUNTRY_CUPS[country].map((code) => outsidersNeeded(cupConfig(code), leagueClubs)));
    const have = () => ofCountry(out, out.nationalLeague, country).length + ofCountry(out, out.cupPool, country).length;
    if (have() >= needed) continue;
    const clubs = { ...out.clubs };
    const cupPool = [...out.cupPool];
    let newClubs = out.newClubs;
    while (ofCountry({ clubs }, out.nationalLeague, country).length + ofCountry({ clubs }, cupPool, country).length < needed) {
      const club = newClub({ ...out, clubs }, newClubs, country, out.year);
      clubs[club.id] = club;
      cupPool.push(club.id);
      newClubs++;
    }
    out = { ...out, clubs, cupPool, newClubs };
  }
  return out;
}

/**
 * The world with the given cups drawn for its season in progress (the others
 * kept): each cup among its country's clubs, its non-league entrants the clubs
 * below the country's bottom division and then its pool, in the season's own
 * order.
 */
function withCups(world: World, codes: readonly WorldCupCode[]): World {
  const filled = fillPool(world);
  const ranking = divisionRanking(filled);
  const cups = filled.countries.flatMap((country, c) => {
    const own = ranking.filter((_, i) => divisionCountry(filled.divisions[i]!.code) === country);
    const outsiders = [...ofCountry(filled, filled.nationalLeague, country), ...shuffled(ofCountry(filled, filled.cupPool, country), seasonRng(filled, 300 + c))];
    return COUNTRY_CUPS[country].map((code) => (codes.includes(code) ? generateCup(code, own, outsiders) : filled.cups.find((x) => x.code === code) ?? generateCup(code, own, outsiders)));
  });
  return { ...filled, cups };
}

/**
 * The real cup where it stands, for the world's first season: its draw so far
 * and its results, with every club as a world club (by its league and id in
 * the live data: a league's clubs, or the FA Cup's non-league sides). Nothing
 * when the data isn't this season's, a club is unknown, or the cup couldn't
 * be played to its final from there (a draw the data only had part of).
 */
function inheritedCup(start: StartCup, year: number, idOf: (division: DivisionCode | undefined, realId: number) => TeamId | undefined): WorldCupSeason | undefined {
  if (start.year !== year) return undefined;
  const map = (id: number) => idOf(start.divisions[id], id);
  const real: WorldCupTie[] = [];
  for (const t of start.real) {
    const homeId = map(t.homeId);
    const awayId = map(t.awayId);
    if (homeId === undefined || awayId === undefined) return undefined;
    real.push({ ...t, homeId, awayId });
  }
  const entrants: Partial<Record<CupRoundKey, TeamId[]>> = {};
  for (const [key, ids] of Object.entries(start.entrants)) {
    const mapped = ids.map(map);
    if (mapped.some((id) => id === undefined)) return undefined;
    entrants[key as CupRoundKey] = mapped as TeamId[];
  }
  const season: WorldCupSeason = { code: start.code, entrants, real };
  return cupPlayable(season, year) ? season : undefined;
}

/**
 * A new world from the live data: every club gets a world id of its own (the
 * site's sample leagues reuse ids across leagues), the first season is the
 * real one, with its results, deductions and ratings. `user`: the visitor's
 * club, by its league and id in the live data.
 */
export function createWorld(pack: StartPack, user: { league: DivisionCode; club: number; countries?: readonly WorldCountry[] }, seed = randomSeed(), now = new Date()): World {
  // The world's countries in the fixed order: the chosen ones, and the chosen club's.
  const countries = WORLD_COUNTRIES.filter((c) => (user.countries ?? [divisionCountry(user.league)]).includes(c) || c === divisionCountry(user.league));
  if (!packReady(pack, countries)) throw new Error("The live data for the leagues isn't complete");
  const clubs: Record<number, WorldClub> = {};
  const ratings: Record<number, [number, number]> = {};
  const params = {} as Record<DivisionCode, DivisionParams>;
  const divisions: DivisionSeason[] = [];
  let next = 1;
  let userClub: TeamId | undefined;
  for (const code of worldDivisions(countries)) {
    const league = pack.leagues.find((l) => l.code === code)!;
    const ids = new Map<number, TeamId>();
    for (const team of league.teams) {
      const id = next++;
      ids.set(team.id, id);
      clubs[id] = { id, name: team.name, shortName: team.shortName, tla: team.tla, ...(team.crest ? { crest: team.crest } : {}), origin: "real", country: divisionCountry(code), realId: team.id };
      const s = league.model.strengths[team.id];
      ratings[id] = s ? [s[0], s[1]] : [1, 1];
      if (code === user.league && team.id === user.club) userClub = id;
    }
    params[code] = { avgHomeGoals: league.model.avgHomeGoals, avgAwayGoals: league.model.avgAwayGoals, rho: league.model.rho };
    const map = (id: number) => ids.get(id)!;
    const games = league.games.filter((g) => ids.has(g[2]) && ids.has(g[3])).map((g): WorldGame => [g[0], g[1], map(g[2]), map(g[3]), g[4], g[5]]);
    const deductions = league.deductions && Object.fromEntries(Object.entries(league.deductions).flatMap(([id, n]) => (ids.has(Number(id)) && n ? [[map(Number(id)), n]] : [])));
    const playoffGames = league.playoffGames?.filter((g) => ids.has(g[1]) && ids.has(g[2])).map((g): WorldPlayoffGame => [g[0], map(g[1]), map(g[2]), g[3], g[4], g[5], g[6], g[7], g[8]]);
    divisions.push({
      code,
      clubs: league.teams.map((t) => map(t.id)),
      games,
      ...(deductions && Object.keys(deductions).length ? { deductions } : {}),
      ...(playoffGames?.length ? { playoffGames } : {}),
    });
  }
  if (userClub === undefined) throw new Error("The chosen club isn't in that league");
  // The National League, below League Two: its clubs come up after the first season (Spain's Primera Federación starts empty).
  const nationalLeague = countries.includes("ENG") ? nationalLeagueClubs() : [];
  for (const club of nationalLeague) clubs[club.id] = club;
  const year = pack.leagues.find((l) => l.code === worldDivisions(countries)[0])!.year;
  // The cups' non-league sides, from the real cups.
  const pool = worldPool(clubs, pack.cups.filter((c) => countries.includes(cupCountry(c.code))));
  const world: World = {
    version: WORLD_VERSION,
    pyramid: "ENG",
    countries,
    id: `${now.getTime().toString(36)}-${(seed >>> 0).toString(36)}`,
    createdAt: now.toISOString(),
    seed: seed >>> 0,
    userClub,
    year,
    clubs: pool.clubs,
    ratings,
    levels: Object.fromEntries(Object.entries(ratings).map(([id, r]) => [id, [r[0], r[1]]])),
    params,
    divisions,
    history: [],
    review: false,
    nationalLeague: nationalLeague.map((c) => c.id),
    newClubs: 0,
    winners: [],
    cups: [],
    cupPool: pool.cupPool,
  };
  // The cups where the real ones stand (their draws and results so far); a cup that can't be taken over is drawn among the world's clubs.
  const byReal = new Map<string, TeamId>();
  for (const club of Object.values(world.clubs)) if (club.realId !== undefined) byReal.set(`${clubDivision(world, club.id) ?? ""}:${club.realId}`, club.id);
  const idOf = (division: DivisionCode | undefined, realId: number) => byReal.get(`${division ?? ""}:${realId}`);
  const inherited = worldCups(countries).flatMap((code) => {
    const start = pack.cups.find((c) => c.code === code);
    const season = start && inheritedCup(start, year, idOf);
    return season ? [season] : [];
  });
  return withCups(
    { ...world, cups: inherited },
    worldCups(countries).filter((code) => !inherited.some((c) => c.code === code)),
  );
}

const DAY = 86_400_000;
/** Placeholder kick-off dates (only their order matters): a game a week from early August. */
const gameDate = (year: number, matchday: number) => new Date(Date.UTC(year, 7, 8, 14) + (matchday - 1) * 7 * DAY).toISOString();

/**
 * A division's games this season: the first season's real calendar (each game
 * the world started with a result for carries it), or a new double round
 * robin (in a new order every season). `results`: those results.
 */
export function divisionFixtures(world: World, d: DivisionSeason): { fixtures: Fixture[]; results: ResultMap } {
  if (d.games) {
    const fixtures = d.games.map((g): Fixture => ({
      id: g[0],
      matchday: g[1],
      utcDate: gameDate(world.year, g[1]),
      homeId: g[2],
      awayId: g[3],
      result: g[4] !== null && g[5] !== null ? { home: g[4], away: g[5] } : null,
    }));
    return { fixtures, results: effectiveResults(fixtures) };
  }
  const order = shuffled(d.clubs, seasonRng(world, 100 + WORLD_LEAGUES.indexOf(d.code)));
  const schedule = d.calendar === 2 ? balancedDoubleRoundRobin : doubleRoundRobin;
  return { fixtures: schedule(order, gameDate(world.year, 1)), results: {} };
}

/** Places of a league's table: its promotion and relegation places, and whether a play-off sends one more club up. */
export function movementPlaces(league: LeagueConfig): { promotion: number[]; relegation: number[]; playoff: number[]; playoffPromotes: boolean } {
  const places = (kind: string) => league.zones.filter((z) => z.kind === kind).flatMap((z) => Array.from({ length: z.to - z.from + 1 }, (_, i) => z.from + i));
  const rounds = league.playoff?.rounds ?? [];
  const own = [...new Set(rounds.flatMap((r) => [...(r.pairs ?? []).flat(), ...(r.entrants ?? [])]))].sort((a, b) => a - b);
  // The lower division of a pyramid play-off (the 2. Bundesliga): its club in the tie is in a play-off, and goes up by winning it.
  const tie = pyramidPlayoffOf(league.code);
  const lower = tie !== undefined && tie.lower === league.code;
  return { promotion: places("promotion"), relegation: places("relegation"), playoff: lower ? [tie.lowerPlace] : own, playoffPromotes: Boolean(league.playoff?.promotedTo) || lower };
}

/**
 * A division's play-off as the world plays it: the league's own (the English
 * play-offs, the Segunda División's), or, for the lower division of a pyramid
 * play-off, that tie as a bracket of one two-legged tie pairing the two
 * divisions' places (the better place hosts the second leg: the 2. Bundesliga's
 * 3rd, after the Bundesliga's 16th hosts the first).
 */
export function playoffConfigOf(code: DivisionCode): PlayoffConfig | undefined {
  const own = divisionConfig(code).playoff;
  if (own) return own;
  const tie = pyramidPlayoffOf(code);
  if (!tie || tie.lower !== code) return undefined;
  return {
    rounds: [{ key: "final", legs: 2, levelTie: "penalties", pairs: [[tie.upperPlace, tie.lowerPlace]] }],
    directPromotion: movementPlaces(divisionConfig(code)).promotion,
    promotedTo: divisionConfig(tie.upper).name,
  };
}

/** The two-row table a pyramid play-off's bracket is built from: the upper division's club at its place, the lower's at its (clubs only once both leagues are complete). */
function pyramidRows(tie: PyramidPlayoff, upperRows: readonly StandingRow[], lowerRows: readonly StandingRow[]): StandingRow[] {
  return [upperRows.find((r) => r.position === tie.upperPlace), lowerRows.find((r) => r.position === tie.lowerPlace)].filter((r): r is StandingRow => r !== undefined);
}

/** The lower division's form with the upper division's club in the tie on its scale: a club from the division above rates one tier stronger (as the cups rate clubs). */
function tieModel(lower: LeagueModel, upper: LeagueModel, upperClub: TeamId | undefined): LeagueModel {
  const strength = upperClub !== undefined ? upper.strengths.get(upperClub) : undefined;
  if (upperClub === undefined || !strength) return lower;
  const scale = tierStrength(-1);
  return { ...lower, strengths: new Map(lower.strengths).set(upperClub, { attack: strength.attack * scale.attack, defence: strength.defence * scale.defence }) };
}

/** Clubs each division of a country sends up and down: the counts its leagues must agree on (3, 3 and 4 between the four English leagues; 3 between Spain's two; 2 between Germany's, the pyramid play-off adding one to both or neither). */
export function movementCounts(country: WorldCountry = "ENG"): { up: number; down: number }[] {
  return COUNTRY_LEAGUES[country].map((code) => {
    const m = movementPlaces(divisionConfig(code));
    return { up: m.promotion.length + (m.playoffPromotes ? 1 : 0), down: m.relegation.length };
  });
}

/** Fictional towns for the new clubs that come up from below (none is a real club's), and how their names are made. */
const NEW_TOWNS: Record<WorldCountry, { towns: readonly string[]; suffixes: readonly string[]; prefix: boolean }> = {
  ENG: {
    towns: [
      "Larkmoor", "Fennick", "Brackenford", "Wyncombe", "Holtwick", "Saltmere", "Corrowby", "Dunsley",
      "Mirefield", "Penbury", "Rookhaven", "Thistlewood", "Ambridge Vale", "Coldwater", "Hartsdale", "Quarrybank",
    ],
    suffixes: ["Town", "United", "Rovers", "Athletic", "City", "Albion"],
    prefix: false,
  },
  ESP: {
    towns: [
      "Montalbán", "Riosa", "Alcorca", "Peñaflor", "Torrelago", "Valdelira", "Benalcázar", "Almenara",
      "Puente Viejo", "Castellar del Monte", "Villarroya", "Sotoluna", "Arroyo Claro", "Monteverde", "Fuentebrava", "Olivares del Mar",
    ],
    suffixes: ["CD", "UD", "CF", "Atlético", "Racing", "Deportivo"],
    prefix: true,
  },
  GER: {
    towns: [
      "Lindenbach", "Oberwald", "Falkenau", "Wiesenthal", "Rotenberg", "Hohenfeld", "Birkenhagen", "Steinbach am See",
      "Neuwiesen", "Tannenhof", "Adlerstein", "Grünhausen", "Mühlbach", "Eichenrode", "Sonnenfeld", "Kirchhofen",
    ],
    suffixes: ["SV", "FC", "1. FC", "TSV", "SpVgg", "VfL"],
    prefix: true,
  },
};

/** A new club's name: a fictional town and suffix (or prefix, Spanish-style) not yet used in the world. */
function newClubName(world: Pick<World, "clubs">, n: number, country: WorldCountry): { name: string; shortName: string } {
  const { towns, suffixes, prefix } = NEW_TOWNS[country];
  const used = new Set(Object.values(world.clubs).map((c) => c.name));
  for (let i = 0; i < towns.length * suffixes.length; i++) {
    const k = n + i;
    const town = towns[k % towns.length]!;
    const suffix = suffixes[(Math.floor(k / towns.length) + k) % suffixes.length]!;
    const name = prefix ? `${suffix} ${town}` : `${town} ${suffix}`;
    if (!used.has(name)) return { name, shortName: town };
  }
  return { name: `New Club ${n + 1}`, shortName: `New Club ${n + 1}` };
}

/** A fictional new club of a country, the n-th so far, joining in `joined`. */
function newClub(world: Pick<World, "clubs">, n: number, country: WorldCountry, joined: number): WorldClub {
  const { name, shortName } = newClubName(world, n, country);
  return { id: NEW_CLUB_ID_BASE + n + 1, name, shortName, tla: shortName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(), origin: "new", country, joined };
}

/** A reserve side (the Segunda División's B teams) can't go up: promotion and play-off places pass to the clubs below it, as on the league pages. */
const isReserve = (league: LeagueConfig, name: string) => league.reserveTeams?.some((start) => name.startsWith(start)) ?? false;

/** The table as promotion and the play-off see it: without the reserve sides, the places renumbered (the table itself where a league has none). */
export function promotionRows(league: LeagueConfig, rows: readonly StandingRow[], nameOf: (id: TeamId) => string): StandingRow[] {
  if (!league.reserveTeams?.length) return [...rows];
  return rows.filter((r) => !isReserve(league, nameOf(r.teamId))).map((r, i) => ({ ...r, position: i + 1 }));
}

/** New clubs' ids: well clear of the first season's (numbered from 1). */
export const NEW_CLUB_ID_BASE = 100_000;

/** The season's scores beyond the ones it started with (DivisionSeason.scores), as results. */
export function seasonScores(d: DivisionSeason): ResultMap {
  const out: ResultMap = {};
  for (const [id, [home, away]] of Object.entries(d.scores ?? {})) out[Number(id)] = { home, away };
  return out;
}

const lastMatchday = (fixtures: readonly Fixture[]) => fixtures.reduce((m, f) => Math.max(m, f.matchday), 0);

const standingsOf = (league: LeagueConfig, d: DivisionSeason, teams: readonly Team[], fixtures: readonly Fixture[], results: ResultMap) =>
  computeStandings(teams, fixtures, results, { tiebreakers: league.tiebreakers, includeForm: false, ...(d.deductions ? { deductions: d.deductions } : {}) });

/** The play-off after the league's last matchday, with the real games of a world started during the play-offs. */
function playoffOptions(world: World, d: DivisionSeason, last: number): Omit<BracketOptions, "seasonComplete"> {
  const real: Fixture[] = (d.playoffGames ?? []).map((g) => ({
    id: g[0],
    matchday: last + 1,
    utcDate: g[3],
    homeId: g[1],
    awayId: g[2],
    result: g[4] !== null && g[5] !== null ? { home: g[4], away: g[5] } : null,
    ...(g[6] ? { neutral: true } : {}),
    ...(g[7] !== null && g[8] !== null ? { penalties: { home: g[7], away: g[8] } } : {}),
  }));
  return { afterMatchday: last, afterDate: gameDate(world.year, last), ...(real.length ? { real } : {}) };
}

/**
 * The real season's current matchday when the world began: the one after the
 * last matchday whose games were mostly played (1 for a new season). A game
 * left from an earlier matchday (postponed in the real season) doesn't make
 * the fixtures open back there.
 */
function startRound(d: DivisionSeason): number {
  const counts = new Map<number, [number, number]>();
  for (const g of d.games ?? []) {
    const c = counts.get(g[1]) ?? [0, 0];
    if (g[4] !== null && g[5] !== null) c[0]++;
    c[1]++;
    counts.set(g[1], c);
  }
  let last = 0;
  for (const [matchday, [played, all]] of counts) if (played * 2 > all) last = Math.max(last, matchday);
  return last + 1;
}

/** A division's season in progress, as the page shows it and plays it. */
export interface DivisionState {
  code: DivisionCode;
  index: number;
  league: LeagueConfig;
  teams: Team[];
  /** Its games, in order; a game the season started with a result for carries it (`result`). */
  fixtures: Fixture[];
  /** The scores beyond those (DivisionSeason.scores): league games, and the play-off's legs and shoot-outs. */
  picks: ResultMap;
  /** Every league game's score so far. */
  results: ResultMap;
  rows: StandingRow[];
  /** The table as promotion sees it (promotionRows): without the reserve sides, where the league has them. */
  eligibleRows: StandingRow[];
  /** The table the play-off bracket is built from: `eligibleRows`, or a pyramid play-off's two clubs at their places (pyramidRows). */
  playoffRows: StandingRow[];
  /** Its play-off (playoffConfigOf): the league's own, or the pyramid play-off it is the lower division of; none in the Premier League. */
  playoff?: PlayoffConfig;
  /** Every league game has a score. */
  leagueComplete: boolean;
  /** The play-off's clubs are known: the league complete, and the division above too for a pyramid play-off. */
  playoffKnown: boolean;
  /** The play-off's ties: clubs placed once known. */
  bracket: PlayoffTie[][];
  playoffOptions: Omit<BracketOptions, "seasonComplete">;
  /** The league and its play-off are decided. */
  done: boolean;
  /**
   * The next round, where the fixtures open: the earliest matchday from the
   * season's current one (see startRound) with a game to play; once the league
   * is complete, the play-off's next legs (a matchday after the league's last),
   * or a level tie's shoot-out. Null once done.
   */
  nextRound: number | null;
  /** The season's form (divisionForm). */
  model: LeagueModel;
}

/** A division's table from its games and the scores so far, and whether every game has one. */
function tableOf(world: World, index: number, picks: ResultMap = seasonScores(world.divisions[index]!)) {
  const d = world.divisions[index]!;
  const league = divisionConfig(d.code);
  const teams = d.clubs.map((id) => teamOf(world, id));
  const fixtures = sortFixtures(divisionFixtures(world, d).fixtures);
  const results = effectiveResults(fixtures, picks);
  const rows = standingsOf(league, d, teams, fixtures, results);
  return { d, league, teams, fixtures, results, rows, complete: fixtures.every((f) => results[f.id]) };
}

function stateOf(world: World, index: number, picks: ResultMap = seasonScores(world.divisions[index]!)): DivisionState {
  const { d, league, teams, fixtures, results, rows, complete: leagueComplete } = tableOf(world, index, picks);
  const eligibleRows = promotionRows(league, rows, (id) => world.clubs[id]!.name);
  const playoff = playoffConfigOf(d.code);
  let model = divisionForm(world, d, index).model;
  // A pyramid play-off (the 2. Bundesliga's 3rd v the Bundesliga's 16th): its clubs are known once both leagues are complete.
  const tie = pyramidPlayoffOf(d.code);
  const upperIndex = tie?.lower === d.code ? world.divisions.findIndex((x) => x.code === tie.upper) : -1;
  let playoffRows = eligibleRows;
  let playoffKnown = leagueComplete;
  if (tie && upperIndex >= 0) {
    const upper = tableOf(world, upperIndex);
    playoffKnown = leagueComplete && upper.complete;
    playoffRows = pyramidRows(tie, upper.rows, eligibleRows);
    if (playoffKnown) model = tieModel(model, divisionForm(world, upper.d, upperIndex).model, playoffRows.find((r) => r.position === tie.upperPlace)?.teamId);
  }
  const options = playoffOptions(world, d, lastMatchday(fixtures));
  const bracket = playoff ? buildBracket(playoffRows, playoff, picks, { ...options, seasonComplete: playoffKnown }) : [];
  const done = leagueComplete && playoffKnown && bracket.every((round) => round.every((tie) => tieOutcome(tie, picks) !== null));
  let nextRound: number | null = null;
  if (!leagueComplete) {
    const open = fixtures.filter((f) => !results[f.id]);
    const from = startRound(d);
    nextRound = open.find((f) => f.matchday >= from)?.matchday ?? open.at(-1)!.matchday;
  } else if (!done) {
    // English play-offs are one- and two-legged ties (no series).
    const ties = bracket.flat();
    const legs = ties.flatMap((tie) => tie.legs.filter((leg) => !leg.result && !picks[leg.id]));
    const level = ties.filter((tie) => tie.shootout && !tie.shootout.result && !picks[tie.shootout.id] && needsShootout(tie, picks));
    nextRound = legs.length ? Math.min(...legs.map((leg) => leg.matchday)) : level.length ? Math.max(...level.map((tie) => tie.legs.at(-1)!.matchday)) : null;
  }
  return { code: d.code, index, league, teams, fixtures, picks, results, rows, eligibleRows, playoffRows, ...(playoff ? { playoff } : {}), leagueComplete, playoffKnown, bracket, playoffOptions: options, done, nextRound, model };
}

const indexOf = (world: World, code: DivisionCode) => {
  const index = world.divisions.findIndex((d) => d.code === code);
  if (index < 0) throw new Error(`No ${code} in this world`);
  return index;
};

/** A division's season in progress: its games, scores, table and play-off. */
export const divisionState = (world: World, code: DivisionCode): DivisionState => stateOf(world, indexOf(world, code));

/** All four divisions' seasons in progress, top first. */
export const seasonStates = (world: World): DivisionState[] => world.divisions.map((_, i) => stateOf(world, i));

/** Every game of the season in progress is decided, the play-offs too: it can be finished (playSeason draws nothing more). */
export const seasonDone = (world: World) => seasonStates(world).every((s) => s.done);

/**
 * Play-off scores belong to one pairing, as on the league pages: once a
 * league score or an earlier round's changes who meets whom, the scores that
 * tie had go; they all go while the play-off's clubs aren't known (the league
 * not complete, or the division above in a pyramid play-off); and a shoot-out's
 * score goes once its tie isn't level. Scores just added stay. `before` and
 * `after`: the world and the division's picks before and after the change
 * (the change may be in another division's scores).
 */
function tidyPlayoff(before: { world: World; picks: ResultMap }, after: { world: World; picks: ResultMap }, index: number): ResultMap {
  const config = playoffConfigOf(after.world.divisions[index]!.code);
  if (!config) return after.picks;
  const out = { ...after.picks };
  const bracketWith = (world: World, picks: ResultMap) => {
    const state = stateOf(world, index, picks);
    return state.playoffKnown ? state.bracket : null;
  };
  if (!bracketWith(after.world, out)) {
    for (const id of playoffIds(config)) delete out[id];
    return out;
  }
  const pairing = (tie: PlayoffTie) => `${tie.higher.teamId}-${tie.lower.teamId}`;
  const was = bracketWith(before.world, before.picks);
  if (was) {
    const pairings = new Map(was.flat().map((tie) => [`${tie.round}-${tie.index}`, pairing(tie)]));
    const unchanged = (id: number) => before.picks[id] !== undefined && out[id] !== undefined && before.picks[id]!.home === out[id]!.home && before.picks[id]!.away === out[id]!.away;
    for (let pass = 0; pass <= config.rounds.length; pass++) {
      const stale = bracketWith(after.world, out)!
        .flat()
        .filter((tie) => pairings.get(`${tie.round}-${tie.index}`) !== pairing(tie))
        .flatMap((tie) => tieIds(tie.round, tie.index, tie.config))
        .filter(unchanged);
      if (!stale.length) break;
      for (const id of stale) delete out[id];
    }
  }
  for (const tie of bracketWith(after.world, out)!.flat()) {
    if (tie.config.bestOf) {
      for (const game of seriesGames(tie, out)) if (out[game.shootout.id] && !game.needsPenalties) delete out[game.shootout.id];
    } else if (tie.shootout && out[tie.shootout.id] && !needsShootout(tie, out)) delete out[tie.shootout.id];
  }
  return out;
}

/** The world with a division's picks replaced. */
function withPicks(world: World, index: number, picks: ResultMap): World {
  const scores = Object.fromEntries(Object.entries(picks).map(([id, s]) => [id, [s.home, s.away] as [number, number]]));
  return {
    ...world,
    divisions: world.divisions.map((d, i) => {
      if (i !== index) return d;
      const { scores: _old, ...rest } = d;
      return Object.keys(scores).length ? { ...rest, scores } : rest;
    }),
  };
}

/**
 * The world with a division's new scores (`after`, from `before`), less the
 * play-off scores they leave stale: the division's own, and those of a lower
 * division whose pyramid play-off this division's table decides (a Bundesliga
 * score moves its 16th place, and so the 2. Bundesliga's tie).
 */
function withScores(world: World, index: number, before: ResultMap, after: ResultMap): World {
  let next = withPicks(world, index, after);
  const code = world.divisions[index]!.code;
  const dependants = world.divisions.flatMap((d, k) => (k !== index && pyramidPlayoffOf(d.code)?.lower === d.code && pyramidPlayoffOf(d.code)?.upper === code ? [k] : []));
  for (const k of [index, ...dependants]) {
    const picksBefore = k === index ? before : seasonScores(world.divisions[k]!);
    const picksAfter = k === index ? after : picksBefore;
    next = withPicks(next, k, tidyPlayoff({ world, picks: picksBefore }, { world: next, picks: picksAfter }, k));
  }
  return next;
}

function putScore(world: World, index: number, id: number, score: Score | null): World {
  const before = seasonScores(world.divisions[index]!);
  const after = { ...before };
  if (score) after[id] = score;
  else delete after[id];
  return withScores(world, index, before, after);
}

/**
 * A score typed in for a game (a league game, a play-off leg or its
 * shoot-out), or cleared (null). Typing in the score a game started with is
 * the same as leaving it.
 */
export function setScore(world: World, code: DivisionCode, fixture: Fixture, score: Score | null): World {
  if (score && !isValidScore(score)) return world;
  const same = score && fixture.result && score.home === fixture.result.home && score.away === fixture.result.away;
  return putScore(world, indexOf(world, code), fixture.id, same ? null : score);
}

/** The dice: a likely roll for one game, another score than the one it has (a shoot-out: a shoot-out score). */
export function rollScore(world: World, code: DivisionCode, fixture: Fixture, rng: Rng = createRng(randomSeed())): World {
  const index = indexOf(world, code);
  const d = world.divisions[index]!;
  const { model } = divisionForm(world, d, index);
  const xg = () => (fixture.neutral ? expectedGoalsNeutral(model, fixture.homeId, fixture.awayId) : expectedGoals(model, fixture.homeId, fixture.awayId));
  const score = isShootoutId(fixture.id) ? simulatePenalties(rng) : sampleLikelyScore(xg(), rng, model.rho ?? 0, seasonScores(d)[fixture.id]);
  return putScore(world, index, fixture.id, score);
}

/** A matchday's games without a score ("Simulate matchday"), each drawn from the season's form, the full distribution (upsets included). */
export function simulateMatchday(world: World, code: DivisionCode, matchday: number, rng: Rng = createRng(randomSeed())): World {
  const state = divisionState(world, code);
  const added = simulateFixtures(state.fixtures.filter((f) => f.matchday === matchday), state.results, state.model, rng, { fast: true });
  return withScores(world, state.index, state.picks, { ...state.picks, ...added });
}

/** The play-off's games without a score, once its clubs are known ("Simulate matchday" on the play-off), from the season's form. */
export function simulatePlayoffs(world: World, code: DivisionCode, rng: Rng = createRng(randomSeed())): World {
  const state = divisionState(world, code);
  if (!state.playoff || !state.playoffKnown) return world;
  const added = simulatePlayoff(state.playoffRows, state.playoff, state.picks, state.model, rng, state.playoffOptions);
  return withScores(world, state.index, state.picks, { ...state.picks, ...added });
}

/**
 * The rest of one league's season, its play-off included ("Simulate rest of
 * season"): every game drawn from the season's form, as a whole season is. A
 * pyramid play-off waits for the division above to finish (its tie is then
 * played from the play-off's fixtures, or when the season ends).
 */
export function simulateRest(world: World, code: DivisionCode, rng: Rng = createRng(randomSeed())): World {
  const state = divisionState(world, code);
  const league = simulateFixtures(state.fixtures, state.results, state.model, rng, { fast: true });
  return simulatePlayoffs(withScores(world, state.index, state.picks, { ...state.picks, ...league }), code, rng);
}

/** One division's season back to how it started: every score typed in, rolled or simulated goes. */
export function resetDivision(world: World, code: DivisionCode): World {
  const index = indexOf(world, code);
  return withScores(world, index, seasonScores(world.divisions[index]!), {});
}

/** Games still to play in a division's season: league games, play-off games, and a level tie's shoot-out. */
export function gamesLeft(state: DivisionState): number {
  const league = state.fixtures.filter((f) => !state.results[f.id]).length;
  const config = state.playoff;
  if (!config) return league;
  // English play-offs are one- and two-legged ties (no series): every leg is played.
  const legs = playoffIds(config).filter((id) => !isShootoutId(id)).length;
  const ties = state.bracket.flat();
  const played = ties.flatMap((tie) => tie.legs).filter((leg) => leg.result || state.picks[leg.id]).length;
  const shootouts = ties.filter((tie) => tie.shootout && !tie.shootout.result && !state.picks[tie.shootout.id] && needsShootout(tie, state.picks)).length;
  return league + legs - played + shootouts;
}

interface PlayedDivision {
  code: DivisionCode;
  league: LeagueConfig;
  teams: Team[];
  fixtures: Fixture[];
  results: ResultMap;
  rows: StandingRow[];
  /** The table as promotion sees it (promotionRows). */
  eligible: StandingRow[];
  model: LeagueModel;
  notes: Map<TeamId, RowNote>;
  final?: SavedDivision["final"];
  /** The play-off's scores, by game id. */
  playoff: ResultMap;
  ratings: SeasonRatings;
}

/** Plays the rest of one division's league season: every game without a score (from the season's form, on its own random stream), the table and the places' notes. The play-off comes after (playPlayoff). */
function playLeague(world: World, d: DivisionSeason, index: number): PlayedDivision {
  const league = divisionConfig(d.code);
  const teams = d.clubs.map((id) => teamOf(world, id));
  const { fixtures } = divisionFixtures(world, d);
  const picks = seasonScores(d);
  const { model, rng } = divisionForm(world, d, index);
  const all = effectiveResults(fixtures, picks);
  for (const f of fixtures) if (!all[f.id]) all[f.id] = sampleDixonColes(expectedGoals(model, f.homeId, f.awayId), model.rho ?? 0, rng);
  const rows = standingsOf(league, d, teams, fixtures, all);
  // Promotion and the play-off pass over the reserve sides (none can go up); relegation is the table's.
  const eligible = promotionRows(league, rows, (id) => world.clubs[id]!.name);

  const places = movementPlaces(league);
  const notes = new Map<TeamId, RowNote>(rows.map((r) => [r.teamId, ""]));
  for (const r of rows) if (places.relegation.includes(r.position)) notes.set(r.teamId, "R");
  for (const r of eligible) {
    if (places.playoff.includes(r.position)) notes.set(r.teamId, "O");
    if (places.promotion.includes(r.position)) notes.set(r.teamId, "P");
    if (r.position === 1) notes.set(r.teamId, "C");
  }
  return { code: d.code, league, teams, fixtures, results: all, rows, eligible, model, notes, playoff: {}, ratings: seasonRatings({ teams, fixtures, results: all }) };
}

/**
 * Plays a division's play-off from the played leagues (its scores so far
 * stand; the rest drawn on the season's own random stream): the league's own
 * bracket, or the pyramid play-off it is the lower division of, whose winner
 * goes up ("W") or stays up, the upper division's club relegated ("R") when it
 * loses. Sets the division's final, play-off scores and notes.
 */
function playPlayoff(world: World, index: number, played: PlayedDivision[]): void {
  const p = played[index]!;
  const d = world.divisions[index]!;
  const config = playoffConfigOf(d.code);
  if (!config) return;
  const tie = pyramidPlayoffOf(d.code);
  const upperIndex = tie?.lower === d.code ? world.divisions.findIndex((x) => x.code === tie.upper) : -1;
  const upper = upperIndex >= 0 ? played[upperIndex] : undefined;
  const rows = tie && upper ? pyramidRows(tie, upper.rows, p.eligible) : p.eligible;
  const model = tie && upper ? tieModel(p.model, upper.model, rows.find((r) => r.position === tie.upperPlace)?.teamId) : p.model;
  const picks = seasonScores(d);
  let finalTie: PlayoffTie | undefined;
  const rounds = config.rounds.length;
  const knockout = seasonRng(world, 50 + index);
  const options = playoffOptions(world, d, lastMatchday(p.fixtures));
  const added = simulatePlayoff(rows, config, picks, model, knockout, options, (r, ties) => {
    if (r === rounds - 1) finalTie = ties[0];
  });
  const scores = { ...picks, ...added };
  // Every play-off score, real ones included, by game id: the season's saved play-off.
  for (const t of buildBracket(rows, config, scores, { ...options, seasonComplete: true }).flat()) {
    for (const game of [...t.legs, ...(t.shootout ? [t.shootout] : []), ...t.gameShootouts]) {
      const score = scores[game.id] ?? game.result;
      if (score) p.playoff[game.id] = score;
    }
  }
  const outcome = finalTie ? tieOutcome(finalTie, scores) : null;
  if (!finalTie || !outcome) return;
  const loser = outcome.winner === finalTie.higher.teamId ? finalTie.lower.teamId! : finalTie.higher.teamId!;
  const winnerGoals = outcome.winner === finalTie.higher.teamId ? outcome.higherGoals : outcome.lowerGoals;
  const loserGoals = outcome.winner === finalTie.higher.teamId ? outcome.lowerGoals : outcome.higherGoals;
  p.final = [outcome.winner, loser, winnerGoals, loserGoals, outcome.onPenalties];
  if (!movementPlaces(p.league).playoffPromotes) return;
  if (tie && upper) {
    const lowerClub = rows.find((r) => r.position === tie.lowerPlace)?.teamId;
    if (outcome.winner === lowerClub) {
      p.notes.set(lowerClub, "W");
      upper.notes.set(loser, "R");
    }
  } else {
    p.notes.set(outcome.winner, "W");
  }
}

/**
 * Plays the season in progress in all four leagues, saves every final table,
 * moves clubs up and down together (League Two's relegated clubs out, new clubs
 * in) and sets up the next season: new calendars, ratings carried over. The
 * world after it, with the season's review showing.
 */
export function playSeason(world: World): World {
  const played = world.divisions.map((d, i) => playLeague(world, d, i));
  world.divisions.forEach((_, i) => playPlayoff(world, i, played));
  const clubs = { ...world.clubs };
  let nationalLeague = [...world.nationalLeague];
  let cupPool = [...world.cupPool];
  let newClubs = world.newClubs;
  const out: TeamId[] = [];
  const arrivals: TeamId[] = [];
  const nextClubs: TeamId[][] = played.map(() => []);
  const ratings: Record<number, [number, number]> = {};
  const levels: Record<number, [number, number]> = { ...world.levels };

  // Each country's pyramid moves on its own: promotion and relegation between its divisions, and the swap at the bottom.
  for (const country of world.countries) {
    const at = world.divisions.flatMap((d, i) => (divisionCountry(d.code) === country ? [i] : []));
    const own = at.map((i) => played[i]!);
    const up = own.map((p, k) => (k === 0 ? [] : p.rows.filter((r) => ["C", "P", "W"].includes(p.notes.get(r.teamId)!)).map((r) => r.teamId)));
    const down = own.map((p) => p.rows.filter((r) => p.notes.get(r.teamId) === "R").map((r) => r.teamId));
    // The pyramid must stay the same size: as many come up as go down at each step.
    for (let k = 1; k < own.length; k++) {
      if (up[k]!.length !== down[k - 1]!.length) throw new Error(`${own[k]!.code}: ${up[k]!.length} up but ${down[k - 1]!.length} down`);
    }

    // The bottom division's relegated clubs swap places with the league below's: they come up, the relegated go down there.
    const relegated = down.at(-1)!;
    for (const id of relegated) clubs[id] = { ...clubs[id]!, left: world.year };
    const below = ofCountry({ clubs }, nationalLeague, country);
    const coming: TeamId[] = below.slice(0, relegated.length);
    // A league below short of clubs (Spain's Primera Federación to begin with): real clubs from the country's cup pool, then fictional new ones.
    while (coming.length < relegated.length) {
      const fromPool = ofCountry({ clubs }, cupPool, country)[0];
      if (fromPool !== undefined) {
        cupPool = cupPool.filter((id) => id !== fromPool);
        coming.push(fromPool);
      } else {
        const club = newClub({ clubs }, newClubs, country, world.year + 1);
        clubs[club.id] = club;
        coming.push(club.id);
        newClubs++;
      }
    }
    const taken = new Set(coming);
    nationalLeague = [...nationalLeague.filter((id) => !taken.has(id)), ...relegated];
    out.push(...relegated);
    arrivals.push(...coming);

    own.forEach((p, k) => {
      const leaving = new Set([...up[k]!, ...down[k]!]);
      const stay = p.rows.map((r) => r.teamId).filter((id) => !leaving.has(id));
      const fromAbove = k > 0 ? down[k - 1]! : [];
      const fromBelow = k < own.length - 1 ? up[k + 1]! : coming;
      nextClubs[at[k]!] = [...stay, ...fromAbove, ...fromBelow];
      if (nextClubs[at[k]!]!.length !== divisionConfig(p.code).teams) throw new Error(`${p.code}: ${nextClubs[at[k]!]!.length} clubs next season`);
    });

    // Next season's ratings and levels: each division's from this season's results, through the world's between-season rule.
    own.forEach((p, k) => {
      const next = nextSeason(nextClubs[at[k]!]!, p.ratings, own[k + 1]?.ratings ?? null, own[k - 1]?.ratings ?? null, world.levels);
      for (const [id, st] of next.ratings) ratings[id] = [st.attack, st.defence];
      for (const [id, st] of next.levels) levels[id] = [st.attack, st.defence];
    });
  }

  // The cups played to their finals (what's left of them drawn from the season's form), for the season's record.
  const cups = finishCups(world);
  const record: SeasonRecord = {
    year: world.year,
    divisions: played.map((p) => ({
      code: p.code,
      rows: p.rows.map((r): SavedRow => [r.teamId, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points, p.notes.get(r.teamId) ?? ""]),
      ...(p.final ? { final: p.final } : {}),
      games: packGames(p.fixtures, p.results, p.rows),
      ...(Object.keys(p.playoff).length ? { playoff: Object.fromEntries(Object.entries(p.playoff).map(([id, sc]) => [id, [sc.home, sc.away] as [number, number]])) } : {}),
    })),
    out,
    in: arrivals,
    cups,
  };
  const next: World = {
    ...world,
    year: world.year + 1,
    clubs,
    ratings,
    levels,
    divisions: nextClubs.map((ids, i) => ({ code: world.divisions[i]!.code, clubs: ids, calendar: 2 as const })),
    // Every result of the last FIXTURE_SEASONS seasons; older ones keep their final tables.
    history: [...world.history, record].map((season, i, all) =>
      i < all.length - FIXTURE_SEASONS
        ? {
            ...season,
            divisions: season.divisions.map(({ games: _g, playoff: _p, ...rest }) => rest),
            ...(season.cups ? { cups: season.cups.map(({ rounds: _r, clubs: _c, ties: _t, ...rest }) => rest) } : {}),
          }
        : season,
    ),
    review: true,
    nationalLeague,
    cupPool,
    newClubs,
    // The season's top three in each division, for Past Winners.
    winners: [...(world.winners ?? []), ...record.divisions.map((d) => ({ year: record.year, code: d.code, top: d.rows.slice(0, 3).map((r): WorldPodium => [r[0], clubs[r[0]]!.name, r[7]]) }))],
    cups: [],
  };
  // Next season's cups, drawn among its clubs.
  return withCups(next, WORLD_CUPS);
}

/** The next season starts, from the last season's review: its tables and fixtures show. */
export const startNextSeason = (world: World): World => ({ ...world, review: false });

/** A row of a table as the page shows it. */
export interface TableRow {
  position: number;
  clubId: TeamId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  note: RowNote;
}

/** A table's rows as the page shows them (no notes until the season is over). */
export const tableRows = (rows: readonly StandingRow[]): TableRow[] =>
  rows.map((r) => ({ position: r.position, clubId: r.teamId, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, goalDifference: r.goalDifference, points: r.points, note: "" }));

/** A division's table in the season in progress: the scores so far (the ones it started with, and the season's own). */
export function currentTable(world: World, code: DivisionCode): TableRow[] {
  if (!world.divisions.some((x) => x.code === code)) return [];
  return tableRows(divisionState(world, code).rows);
}

/** A saved season's table of one division. */
export function savedTable(world: World, year: number, code: DivisionCode): { rows: TableRow[]; final?: SavedDivision["final"] } | undefined {
  const division = world.history.find((s) => s.year === year)?.divisions.find((d) => d.code === code);
  if (!division) return undefined;
  return {
    rows: division.rows.map(([clubId, played, won, drawn, lost, goalsFor, goalsAgainst, points, note], i) => ({
      position: i + 1,
      clubId,
      played,
      won,
      drawn,
      lost,
      goalsFor,
      goalsAgainst,
      goalDifference: goalsFor - goalsAgainst,
      points,
      note,
    })),
    ...(division.final ? { final: division.final } : {}),
  };
}

/** A finished season's division, to look back at: its final table, every result and its play-off. */
export interface PastDivision {
  code: DivisionCode;
  rows: TableRow[];
  final?: SavedDivision["final"];
  teams: Team[];
  /** Its league games with their scores (`result`), or null for a season whose results weren't kept. */
  fixtures: Fixture[] | null;
  /** The play-off's ties, each game carrying its score (`result`). */
  bracket: PlayoffTie[][];
}

/** A saved table's rows as standings rows (for a bracket). */
const standingRows = (rows: readonly TableRow[]): StandingRow[] =>
  rows.map((r) => ({ position: r.position, teamId: r.clubId, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, goalDifference: r.goalDifference, points: r.points, form: [] }));

export function pastDivision(world: World, year: number, code: DivisionCode): PastDivision | undefined {
  const saved = world.history.find((s) => s.year === year)?.divisions.find((d) => d.code === code);
  const table = savedTable(world, year, code);
  if (!saved || !table) return undefined;
  const fixtures = saved.games
    ? unpackGames(saved.games, saved.rows).map((g, i): Fixture => ({
        id: i + 1,
        matchday: g.matchday,
        utcDate: gameDate(year, g.matchday),
        homeId: g.homeId,
        awayId: g.awayId,
        result: { home: g.home, away: g.away },
      }))
    : null;
  const config = playoffConfigOf(code);
  let bracket: PlayoffTie[][] = [];
  if (config && saved.playoff) {
    const scores: ResultMap = {};
    for (const [id, [home, away]] of Object.entries(saved.playoff)) scores[Number(id)] = { home, away };
    let rows = promotionRows(divisionConfig(code), standingRows(table.rows), (id) => world.clubs[id]!.name);
    // A pyramid play-off: the upper division's club from its own saved table.
    const tie = pyramidPlayoffOf(code);
    if (tie?.lower === code) {
      const upperTable = savedTable(world, year, tie.upper);
      rows = pyramidRows(tie, upperTable ? standingRows(upperTable.rows) : [], rows);
    }
    const last = fixtures ? lastMatchday(fixtures) : (divisionConfig(code).teams - 1) * 2;
    const scored = (f: Fixture): Fixture => ({ ...f, result: scores[f.id] ?? f.result });
    bracket = buildBracket(rows, config, scores, { seasonComplete: true, afterMatchday: last, afterDate: gameDate(year, last) }).map((round) =>
      round.map((tie) => ({ ...tie, legs: tie.legs.map(scored), shootout: tie.shootout && scored(tie.shootout), gameShootouts: tie.gameShootouts.map(scored) })),
    );
  }
  // The league's clubs, and the play-off's (a pyramid play-off's club from the division above).
  const clubs = [...new Set([...saved.rows.map((r) => r[0]), ...bracket.flat().flatMap((tie) => [tie.higher.teamId, tie.lower.teamId]).filter((id): id is TeamId => id !== null)])];
  return { code, rows: table.rows, ...(table.final ? { final: table.final } : {}), teams: clubs.map((id) => teamOf(world, id)), fixtures, bracket };
}

/** Where a club plays in the season in progress (undefined in the National League, or once it has left the pyramid). */
export const clubDivision = (world: World, id: TeamId): DivisionCode | undefined => world.divisions.find((d) => d.clubs.includes(id))?.code;

/**
 * How a club's season ended: champions, promoted (automatically or as the
 * play-off's winners), out in the play-offs, relegated (from League Two: into
 * the National League), a European place (the Premier League's zones), or
 * none of those ("neutral"); "nationalLeague": a season there, then back up.
 */
export type PathOutcome =
  | "champions"
  | "promoted"
  | "playoffWinners"
  | "playoffs"
  | "relegated"
  | "out"
  | "championsLeague"
  | "europaLeague"
  | "conferenceLeague"
  | "neutral"
  | "nationalLeague";

const EUROPE = new Set<PathOutcome>(["championsLeague", "europaLeague", "conferenceLeague"]);

/** A club's season: its division ("NL" the National League, "PF" the Primera Federación: the league below) and place, and what came of it. */
export interface PathStep {
  year: number;
  code: DivisionCode | LowerCode;
  /** Its final place (none for a season in the league below). */
  position: number | null;
  /** "up" promoted (as champions, automatically or through the play-off, or from the league below), "down" relegated, "stay". */
  move: "up" | "down" | "stay";
  note: RowNote;
  outcome: PathOutcome;
  /** The cups it won that season. */
  cups: WorldCupCode[];
}

/** What a final place in a division means: its note, or the league's zone for that place (a European place), or nothing. */
export function placeOutcome(code: DivisionCode, position: number, note: RowNote): PathOutcome {
  if (note === "C") return "champions";
  if (note === "P") return "promoted";
  if (note === "W") return "playoffWinners";
  if (note === "O") return "playoffs";
  if (note === "R") return neighbours(code).below ? "relegated" : "out";
  const zone = divisionConfig(code).zones.find((z) => position >= z.from && position <= z.to)?.kind as PathOutcome | undefined;
  return zone && EUROPE.has(zone) ? zone : "neutral";
}

/** A club's path through the world's finished seasons, oldest first: each season's division, place and outcome, its seasons in the league below too. */
export function clubPath(world: World, id: TeamId): PathStep[] {
  return world.history.flatMap((season): PathStep[] => {
    const cups = (season.cups ?? []).filter((c) => c.final[0] === id).map((c) => c.code);
    const steps = season.divisions.flatMap((d): PathStep[] => {
      const at = d.rows.findIndex((r) => r[0] === id);
      if (at < 0) return [];
      const note = d.rows[at]![8];
      const move = note === "R" ? "down" : neighbours(d.code).above && (note === "C" || note === "P" || note === "W") ? "up" : "stay";
      return [{ year: season.year, code: d.code, position: at + 1, move, note, outcome: placeOutcome(d.code, at + 1, note), cups }];
    });
    // Not in a league this season, and up from the league below at its end: a season there.
    if (!steps.length && season.in.includes(id)) {
      return [{ year: season.year, code: LOWER_LEAGUE[clubCountry(world.clubs[id] ?? {})], position: null, move: "up", note: "", outcome: "nationalLeague", cups }];
    }
    return steps;
  });
}

/** A finished season's moves between two divisions (and out of and into each country's bottom one), for its review. */
export function seasonMoves(world: Pick<World, "clubs">, record: SeasonRecord): { upper: DivisionCode; lower: DivisionCode | null; up: TeamId[]; down: TeamId[] }[] {
  return record.divisions.map((d) => {
    const below = neighbours(d.code).below;
    const lower = below ? record.divisions.find((x) => x.code === below) : undefined;
    return {
      upper: d.code,
      lower: lower?.code ?? null,
      // Up from the division below; down from this one (out of the pyramid from the bottom: into the league below, whose clubs of the country come up).
      up: lower ? lower.rows.filter((r) => r[8] === "C" || r[8] === "P" || r[8] === "W").map((r) => r[0]) : record.in.filter((id) => clubCountry(world.clubs[id] ?? {}) === divisionCountry(d.code)),
      down: d.rows.filter((r) => r[8] === "R").map((r) => r[0]),
    };
  });
}
