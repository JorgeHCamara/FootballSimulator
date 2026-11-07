import type { CupRoundKey } from "../config/cups.ts";
import { getLeagueByCode, type LeagueConfig } from "../config/leagues.ts";
import { NATIONAL_LEAGUE_CLUBS } from "../config/nationalLeague.ts";
import { expectedGoals, expectedGoalsNeutral, sampleDixonColes, sampleLikelyScore, simulateFixtures } from "../engine/match.ts";
import { clubPriors, seasonRatings, type SeasonRatings } from "../engine/offseason.ts";
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
  type PlayoffTie,
} from "../engine/playoffs.ts";
import type { LeagueModel } from "../engine/ratings.ts";
import { effectiveResults, isValidScore } from "../engine/results.ts";
import { createRng, randomSeed, type Rng } from "../engine/rng.ts";
import { balancedDoubleRoundRobin, doubleRoundRobin } from "../engine/schedule.ts";
import { computeStandings, sortFixtures } from "../engine/standings.ts";
import type { Fixture, ResultMap, Score, StandingRow, Team, TeamId } from "../engine/types.ts";
import {
  cupConfig,
  cupPlayable,
  finishCups,
  generateCup,
  outsidersNeeded,
  WORLD_CUPS,
  type SavedCup,
  type WorldCupCode,
  type WorldCupSeason,
  type WorldCupTie,
} from "./worldCups.ts";
import { divisionForm, seasonRng, shuffled, teamOf } from "./worldForm.ts";

/*
 * My World: a fictional timeline of the English pyramid (Premier League to
 * League Two), started from the site's live data and played on season by
 * season in the visitor's browser (saved by src/lib/myWorldStorage.ts). A
 * world is set up with its countries (World.countries): England, Spain or
 * both; Spain's leagues are still to come, so only England's play for now.
 *
 * A season plays all four leagues with the site's own engine: each game's score
 * from the club ratings (Dixon–Coles, as the season outlook draws them, with
 * its season rating noise), the table with the league's tiebreakers, and the
 * league's own play-off. Promotion and relegation come from the league configs
 * (their promotion and relegation places, and the play-off winner), applied to
 * all four at once. League Two's relegated clubs drop into the National League
 * for a season, and the National League's clubs (Boreham Wood and Harrogate
 * Town, the first time) come up in their place. The FA Cup and the EFL Cup
 * are part of every season too (src/lib/worldCups.ts): the first season takes
 * the real cups where they stand, every later one is drawn among the world's
 * clubs, with the real FA Cup's non-league sides (World.cupPool) in the FA Cup.
 *
 * Between seasons each club's rating carries over through the site's own
 * between-season rule (src/engine/offseason.ts, the one the real starting
 * ratings are built with): its rating from the season's results keeps most of
 * its difference from average, a promoted club becomes a below-average one in
 * its new league, a relegated club the reverse, and a new club starts below
 * average. Nothing here touches the live outlook, snapshots or SIM_VERSION.
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

/** The English pyramid's divisions the world plays, top first (league config codes). */
export const ENGLAND = ["PL", "ELC", "EL1", "EL2"] as const;
export type DivisionCode = (typeof ENGLAND)[number];

export const isDivision = (code: string): code is DivisionCode => (ENGLAND as readonly string[]).includes(code);
export const divisionConfig = (code: DivisionCode): LeagueConfig => getLeagueByCode(code)!;

/** The countries a world can be set up with: England, and Spain (whose leagues are still to come to My World). */
export const WORLD_COUNTRIES = ["ENG", "ESP"] as const;
export type WorldCountry = (typeof WORLD_COUNTRIES)[number];
export const isWorldCountry = (code: string): code is WorldCountry => (WORLD_COUNTRIES as readonly string[]).includes(code);
/** Each country's leagues, top first (league config codes): England's play; Spain's are listed at setup as coming soon. */
export const COUNTRY_LEAGUES: Record<WorldCountry, readonly string[]> = { ENG: ENGLAND, ESP: ["PD", "SD"] };
/** The countries whose leagues a world plays so far. */
export const PLAYED_COUNTRIES: readonly WorldCountry[] = ["ENG"];

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
  /**
   * The countries the world simulates, as chosen at setup: England, Spain or
   * both. Only England's leagues play so far; Spain's join a world that has
   * it once they come to My World.
   */
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
  params: Record<DivisionCode, DivisionParams>;
  /** The season in progress, top division first. */
  divisions: DivisionSeason[];
  /** Finished seasons, oldest first. */
  history: SeasonRecord[];
  /** The last season has just ended: its review shows, and the next season's tables and fixtures wait until it's started. */
  review: boolean;
  /**
   * The National League's clubs this season, outside the Football League:
   * at the season's end they come up to League Two in place of its relegated
   * clubs, who take their place. Boreham Wood and Harrogate Town to begin with.
   */
  nationalLeague: TeamId[];
  /** How many fictional new clubs have come up so far (worlds from before the National League; else only when it's short of clubs). */
  newClubs: number;
  /** Every finished season's top three in each division, oldest first: the world's own Past Winners. */
  winners: WorldWinners[];
  /** The season's cups, the FA Cup first (src/lib/worldCups.ts). */
  cups: WorldCupSeason[];
  /**
   * The non-league sides that play the FA Cup (the real cup's, when the world
   * started): with the National League's clubs they fill its first round
   * every season, in a new order each time. They play no league.
   */
  cupPool: TeamId[];
}

/** The National League clubs' world ids: clear of the real clubs' (numbered from 1) and the fictional ones'. */
export const NATIONAL_LEAGUE_ID_BASE = 90_000;

/** The FA Cup's non-league sides' world ids (World.cupPool). */
export const CUP_POOL_ID_BASE = 80_000;

/** The National League's clubs a world starts with (src/config/nationalLeague.ts), as world clubs. */
export const nationalLeagueClubs = (): WorldClub[] =>
  NATIONAL_LEAGUE_CLUBS.map((c, i) => ({ id: NATIONAL_LEAGUE_ID_BASE + i + 1, name: c.name, shortName: c.shortName, tla: c.tla, crest: c.crest, origin: "real", realId: c.espnId }));

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

/** Everything a new world starts from; `missing`: leagues and cups whose live data didn't load (no world can start then). */
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
    const { clubs, cupPool } = worldPool(upgraded.clubs, pack?.cups.find((c) => c.code === "FAC"));
    upgraded = withCups({ ...upgraded, clubs, cupPool, cups: [] }, WORLD_CUPS);
  } else {
    const redraw = upgraded.cups.filter((c) => !cupPlayable(c)).map((c) => c.code);
    if (redraw.length) upgraded = withCups(upgraded, redraw);
  }
  return upgraded;
}

/** Can a world start from this pack: all four leagues, with full clubs lists, in the same season, and both cups. */
export function packReady(pack: StartPack): boolean {
  if (pack.missing.length) return false;
  const years = new Set(pack.leagues.map((l) => l.year));
  return (
    ENGLAND.every((code) => {
      const league = pack.leagues.find((l) => l.code === code);
      return league !== undefined && league.teams.length === divisionConfig(code).teams;
    }) &&
    years.size === 1 &&
    WORLD_CUPS.every((code) => pack.cups.some((c) => c.code === code))
  );
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
  return world.divisions.map((d, i) => {
    if (!last) return [...d.clubs].sort((a, b) => quality(world, a) - quality(world, b) || a - b);
    const placeIn = (code: DivisionCode | undefined) => new Map(last.divisions.find((x) => x.code === code)?.rows.map((r, p) => [r[0], p]) ?? []);
    const here = placeIn(d.code);
    const above = i > 0 ? placeIn(ENGLAND[i - 1]) : new Map<TeamId, number>();
    const below = i < world.divisions.length - 1 ? placeIn(ENGLAND[i + 1]) : new Map(last.in.map((id, p) => [id, p]));
    // Up from below (the weakest), stayed, down from above (the strongest); within each, the lowest-placed first.
    const group = (id: TeamId) => (here.has(id) ? 1 : above.has(id) ? 2 : 0);
    const place = (id: TeamId) => here.get(id) ?? above.get(id) ?? below.get(id) ?? -1;
    return [...d.clubs].sort((a, b) => group(a) - group(b) || place(b) - place(a) || a - b);
  });
}

/**
 * The FA Cup's non-league sides (World.cupPool) from the live FA Cup's: every
 * club of it in no league, as world clubs (a National League club among them
 * is the world's own). Without the live data, no pool: fillPool makes it up.
 */
function worldPool(clubs: Readonly<Record<number, WorldClub>>, start: StartCup | undefined): { clubs: Record<number, WorldClub>; cupPool: TeamId[] } {
  const out = { ...clubs };
  const cupPool: TeamId[] = [];
  const known = new Map(Object.values(clubs).flatMap((c) => (c.realId !== undefined ? [[c.realId, c.id] as const] : [])));
  NATIONAL_LEAGUE_CLUBS.forEach((c, i) => {
    if (clubs[NATIONAL_LEAGUE_ID_BASE + i + 1] && !known.has(c.espnId)) known.set(c.espnId, NATIONAL_LEAGUE_ID_BASE + i + 1);
  });
  let next = CUP_POOL_ID_BASE + 1;
  for (const team of start?.teams ?? []) {
    if (start!.divisions[team.id] || known.has(team.id)) continue;
    const id = next++;
    out[id] = { id, name: team.name, shortName: team.shortName, tla: team.tla, ...(team.crest ? { crest: team.crest } : {}), origin: "real", realId: team.id };
    known.set(team.id, id);
    cupPool.push(id);
  }
  return { clubs: out, cupPool };
}

/** The pool made up to what the cups need (the National League's clubs count), with fictional new clubs. */
function fillPool(world: World): World {
  const needed = Math.max(...WORLD_CUPS.map((code) => outsidersNeeded(cupConfig(code), world.divisions.reduce((n, d) => n + d.clubs.length, 0))));
  if (world.nationalLeague.length + world.cupPool.length >= needed) return world;
  const clubs = { ...world.clubs };
  const cupPool = [...world.cupPool];
  let newClubs = world.newClubs;
  while (world.nationalLeague.length + cupPool.length < needed) {
    const id = NEW_CLUB_ID_BASE + newClubs + 1;
    const { name, shortName } = newClubName({ ...world, clubs }, newClubs);
    clubs[id] = { id, name, shortName, tla: shortName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(), origin: "new", joined: world.year };
    cupPool.push(id);
    newClubs++;
  }
  return { ...world, clubs, cupPool, newClubs };
}

/**
 * The world with the given cups drawn for its season in progress (the others
 * kept): the FA Cup's non-league entrants are the National League's clubs and
 * then the pool, in the season's own order.
 */
function withCups(world: World, codes: readonly WorldCupCode[]): World {
  const filled = fillPool(world);
  const ranking = divisionRanking(filled);
  const outsiders = [...filled.nationalLeague, ...shuffled(filled.cupPool, seasonRng(filled, 300))];
  const cups = WORLD_CUPS.map((code) => (codes.includes(code) ? generateCup(code, ranking, outsiders) : filled.cups.find((c) => c.code === code) ?? generateCup(code, ranking, outsiders)));
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
  if (!packReady(pack)) throw new Error("The live data for the four leagues isn't complete");
  // The world's countries, England's leagues among them (the only ones that play so far), in the fixed order.
  const countries = WORLD_COUNTRIES.filter((c) => (user.countries ?? ["ENG"]).includes(c));
  if (!countries.includes("ENG")) throw new Error("A world needs England's leagues for now");
  const clubs: Record<number, WorldClub> = {};
  const ratings: Record<number, [number, number]> = {};
  const params = {} as Record<DivisionCode, DivisionParams>;
  const divisions: DivisionSeason[] = [];
  let next = 1;
  let userClub: TeamId | undefined;
  for (const code of ENGLAND) {
    const league = pack.leagues.find((l) => l.code === code)!;
    const ids = new Map<number, TeamId>();
    for (const team of league.teams) {
      const id = next++;
      ids.set(team.id, id);
      clubs[id] = { id, name: team.name, shortName: team.shortName, tla: team.tla, ...(team.crest ? { crest: team.crest } : {}), origin: "real", realId: team.id };
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
  // The National League, below League Two: its clubs come up after the first season.
  const nationalLeague = nationalLeagueClubs();
  for (const club of nationalLeague) clubs[club.id] = club;
  const year = pack.leagues[0]!.year;
  // The FA Cup's non-league sides, from the real cup.
  const pool = worldPool(clubs, pack.cups.find((c) => c.code === "FAC"));
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
  const inherited = WORLD_CUPS.flatMap((code) => {
    const start = pack.cups.find((c) => c.code === code);
    const season = start && inheritedCup(start, year, idOf);
    return season ? [season] : [];
  });
  return withCups(
    { ...world, cups: inherited },
    WORLD_CUPS.filter((code) => !inherited.some((c) => c.code === code)),
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
  const order = shuffled(d.clubs, seasonRng(world, 100 + ENGLAND.indexOf(d.code)));
  const schedule = d.calendar === 2 ? balancedDoubleRoundRobin : doubleRoundRobin;
  return { fixtures: schedule(order, gameDate(world.year, 1)), results: {} };
}

/** Places of a league's table: its promotion and relegation places, and whether a play-off sends one more club up. */
export function movementPlaces(league: LeagueConfig): { promotion: number[]; relegation: number[]; playoff: number[]; playoffPromotes: boolean } {
  const places = (kind: string) => league.zones.filter((z) => z.kind === kind).flatMap((z) => Array.from({ length: z.to - z.from + 1 }, (_, i) => z.from + i));
  const rounds = league.playoff?.rounds ?? [];
  const playoff = [...new Set(rounds.flatMap((r) => [...(r.pairs ?? []).flat(), ...(r.entrants ?? [])]))].sort((a, b) => a - b);
  return { promotion: places("promotion"), relegation: places("relegation"), playoff, playoffPromotes: Boolean(league.playoff?.promotedTo) };
}

/** Clubs each division sends up and down: the counts the pyramid's leagues must agree on (3, 3 and 4 between the four English leagues). */
export function movementCounts(): { up: number; down: number }[] {
  return ENGLAND.map((code) => {
    const m = movementPlaces(divisionConfig(code));
    return { up: m.promotion.length + (m.playoffPromotes ? 1 : 0), down: m.relegation.length };
  });
}

/** Fictional towns for the new clubs that come up from below (none is a real club's). */
const NEW_TOWNS = [
  "Larkmoor", "Fennick", "Brackenford", "Wyncombe", "Holtwick", "Saltmere", "Corrowby", "Dunsley",
  "Mirefield", "Penbury", "Rookhaven", "Thistlewood", "Ambridge Vale", "Coldwater", "Hartsdale", "Quarrybank",
];
const NEW_SUFFIXES = ["Town", "United", "Rovers", "Athletic", "City", "Albion"];

/** A new club's name: a fictional town and suffix not yet used in the world. */
function newClubName(world: World, n: number): { name: string; shortName: string } {
  const used = new Set(Object.values(world.clubs).map((c) => c.name));
  for (let i = 0; i < NEW_TOWNS.length * NEW_SUFFIXES.length; i++) {
    const k = n + i;
    const town = NEW_TOWNS[k % NEW_TOWNS.length]!;
    const name = `${town} ${NEW_SUFFIXES[(Math.floor(k / NEW_TOWNS.length) + k) % NEW_SUFFIXES.length]}`;
    if (!used.has(name)) return { name, shortName: town };
  }
  return { name: `New Club ${n + 1}`, shortName: `New Club ${n + 1}` };
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
  /** Every league game has a score: the play-off's clubs are known. */
  leagueComplete: boolean;
  /** The play-off's ties (none in the Premier League): clubs placed once the league is complete. */
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

function stateOf(world: World, index: number, picks: ResultMap = seasonScores(world.divisions[index]!)): DivisionState {
  const d = world.divisions[index]!;
  const league = divisionConfig(d.code);
  const teams = d.clubs.map((id) => teamOf(world, id));
  const fixtures = sortFixtures(divisionFixtures(world, d).fixtures);
  const results = effectiveResults(fixtures, picks);
  const rows = standingsOf(league, d, teams, fixtures, results);
  const leagueComplete = fixtures.every((f) => results[f.id]);
  const options = playoffOptions(world, d, lastMatchday(fixtures));
  const bracket = league.playoff ? buildBracket(rows, league.playoff, picks, { ...options, seasonComplete: leagueComplete }) : [];
  const done = leagueComplete && bracket.every((round) => round.every((tie) => tieOutcome(tie, picks) !== null));
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
  return { code: d.code, index, league, teams, fixtures, picks, results, rows, leagueComplete, bracket, playoffOptions: options, done, nextRound, model: divisionForm(world, d, index).model };
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
 * tie had go; they all go while the league isn't complete; and a shoot-out's
 * score goes once its tie isn't level. Scores just added stay.
 */
function tidyPlayoff(world: World, index: number, before: ResultMap, after: ResultMap): ResultMap {
  const config = divisionConfig(world.divisions[index]!.code).playoff;
  if (!config) return after;
  const out = { ...after };
  const bracketWith = (picks: ResultMap) => {
    const state = stateOf(world, index, picks);
    return state.leagueComplete ? state.bracket : null;
  };
  if (!bracketWith(out)) {
    for (const id of playoffIds(config)) delete out[id];
    return out;
  }
  const pairing = (tie: PlayoffTie) => `${tie.higher.teamId}-${tie.lower.teamId}`;
  const was = bracketWith(before);
  if (was) {
    const pairings = new Map(was.flat().map((tie) => [`${tie.round}-${tie.index}`, pairing(tie)]));
    const unchanged = (id: number) => before[id] !== undefined && out[id] !== undefined && before[id]!.home === out[id]!.home && before[id]!.away === out[id]!.away;
    for (let pass = 0; pass <= config.rounds.length; pass++) {
      const stale = bracketWith(out)!
        .flat()
        .filter((tie) => pairings.get(`${tie.round}-${tie.index}`) !== pairing(tie))
        .flatMap((tie) => tieIds(tie.round, tie.index, tie.config))
        .filter(unchanged);
      if (!stale.length) break;
      for (const id of stale) delete out[id];
    }
  }
  for (const tie of bracketWith(out)!.flat()) {
    if (tie.config.bestOf) {
      for (const game of seriesGames(tie, out)) if (out[game.shootout.id] && !game.needsPenalties) delete out[game.shootout.id];
    } else if (tie.shootout && out[tie.shootout.id] && !needsShootout(tie, out)) delete out[tie.shootout.id];
  }
  return out;
}

/** The world with a division's new scores (`after`, from `before`), less the play-off scores they leave stale. */
function withScores(world: World, index: number, before: ResultMap, after: ResultMap): World {
  const scores = Object.fromEntries(Object.entries(tidyPlayoff(world, index, before, after)).map(([id, s]) => [id, [s.home, s.away] as [number, number]]));
  return {
    ...world,
    divisions: world.divisions.map((d, i) => {
      if (i !== index) return d;
      const { scores: _old, ...rest } = d;
      return Object.keys(scores).length ? { ...rest, scores } : rest;
    }),
  };
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

/** The play-off's games without a score, once the league is complete ("Simulate matchday" on the play-off), from the season's form. */
export function simulatePlayoffs(world: World, code: DivisionCode, rng: Rng = createRng(randomSeed())): World {
  const state = divisionState(world, code);
  if (!state.league.playoff || !state.leagueComplete) return world;
  const added = simulatePlayoff(state.rows, state.league.playoff, state.picks, state.model, rng, state.playoffOptions);
  return withScores(world, state.index, state.picks, { ...state.picks, ...added });
}

/** The rest of one league's season, its play-off included ("Simulate rest of season"): every game drawn from the season's form, as a whole season is. */
export function simulateRest(world: World, code: DivisionCode, rng: Rng = createRng(randomSeed())): World {
  const state = divisionState(world, code);
  const league = simulateFixtures(state.fixtures, state.results, state.model, rng, { fast: true });
  const picks = { ...state.picks, ...league };
  if (state.league.playoff) {
    const all = { ...state.results, ...league };
    const d = world.divisions[state.index]!;
    const rows = standingsOf(state.league, d, state.teams, state.fixtures, all);
    Object.assign(picks, simulatePlayoff(rows, state.league.playoff, { ...state.picks, ...all }, state.model, rng, state.playoffOptions));
  }
  return withScores(world, state.index, state.picks, picks);
}

/** One division's season back to how it started: every score typed in, rolled or simulated goes. */
export function resetDivision(world: World, code: DivisionCode): World {
  const index = indexOf(world, code);
  return withScores(world, index, seasonScores(world.divisions[index]!), {});
}

/** Games still to play in a division's season: league games, play-off games, and a level tie's shoot-out. */
export function gamesLeft(state: DivisionState): number {
  const league = state.fixtures.filter((f) => !state.results[f.id]).length;
  const config = state.league.playoff;
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
  teams: Team[];
  fixtures: Fixture[];
  results: ResultMap;
  rows: StandingRow[];
  notes: Map<TeamId, RowNote>;
  final?: SavedDivision["final"];
  /** The play-off's scores, by game id. */
  playoff: ResultMap;
  ratings: SeasonRatings;
}

/** Plays the rest of one division's season: every game without a score (from the season's form, on its own random stream), the table, the play-off. */
function playDivision(world: World, d: DivisionSeason, index: number): PlayedDivision {
  const league = divisionConfig(d.code);
  const teams = d.clubs.map((id) => teamOf(world, id));
  const { fixtures } = divisionFixtures(world, d);
  const picks = seasonScores(d);
  const { model, rng } = divisionForm(world, d, index);
  const all = effectiveResults(fixtures, picks);
  for (const f of fixtures) if (!all[f.id]) all[f.id] = sampleDixonColes(expectedGoals(model, f.homeId, f.awayId), model.rho ?? 0, rng);
  const rows = standingsOf(league, d, teams, fixtures, all);

  const places = movementPlaces(league);
  const notes = new Map<TeamId, RowNote>(rows.map((r) => [r.teamId, ""]));
  for (const r of rows) {
    if (places.playoff.includes(r.position)) notes.set(r.teamId, "O");
    if (places.promotion.includes(r.position)) notes.set(r.teamId, "P");
    if (places.relegation.includes(r.position)) notes.set(r.teamId, "R");
    if (r.position === 1) notes.set(r.teamId, "C");
  }
  let final: SavedDivision["final"];
  const playoff: ResultMap = {};
  if (league.playoff) {
    let finalTie: PlayoffTie | undefined;
    const rounds = league.playoff.rounds.length;
    const knockout = seasonRng(world, 50 + index);
    const options = playoffOptions(world, d, lastMatchday(fixtures));
    // The play-off's scores so far stand (there are none until the league is complete: see tidyPlayoff).
    const added = simulatePlayoff(rows, league.playoff, picks, model, knockout, options, (r, ties) => {
      if (r === rounds - 1) finalTie = ties[0];
    });
    const scores = { ...picks, ...added };
    // Every play-off score, real ones included, by game id: the season's saved play-off.
    for (const tie of buildBracket(rows, league.playoff, scores, { ...options, seasonComplete: true }).flat()) {
      for (const game of [...tie.legs, ...(tie.shootout ? [tie.shootout] : []), ...tie.gameShootouts]) {
        const score = scores[game.id] ?? game.result;
        if (score) playoff[game.id] = score;
      }
    }
    const outcome = finalTie ? tieOutcome(finalTie, scores) : null;
    if (finalTie && outcome) {
      const loser = outcome.winner === finalTie.higher.teamId ? finalTie.lower.teamId! : finalTie.higher.teamId!;
      const winnerGoals = outcome.winner === finalTie.higher.teamId ? outcome.higherGoals : outcome.lowerGoals;
      const loserGoals = outcome.winner === finalTie.higher.teamId ? outcome.lowerGoals : outcome.higherGoals;
      final = [outcome.winner, loser, winnerGoals, loserGoals, outcome.onPenalties];
      if (places.playoffPromotes) notes.set(outcome.winner, "W");
    }
  }
  return { code: d.code, teams, fixtures, results: all, rows, notes, ...(final ? { final } : {}), playoff, ratings: seasonRatings({ teams, fixtures, results: all }) };
}

/**
 * Plays the season in progress in all four leagues, saves every final table,
 * moves clubs up and down together (League Two's relegated clubs out, new clubs
 * in) and sets up the next season: new calendars, ratings carried over. The
 * world after it, with the season's review showing.
 */
export function playSeason(world: World): World {
  const played = world.divisions.map((d, i) => playDivision(world, d, i));
  const up = played.map((p, i) => (i === 0 ? [] : p.rows.filter((r) => ["C", "P", "W"].includes(p.notes.get(r.teamId)!)).map((r) => r.teamId)));
  const down = played.map((p) => p.rows.filter((r) => p.notes.get(r.teamId) === "R").map((r) => r.teamId));
  // The pyramid must stay the same size: as many come up as go down at each step.
  for (let i = 1; i < played.length; i++) {
    if (up[i]!.length !== down[i - 1]!.length) throw new Error(`${played[i]!.code}: ${up[i]!.length} up but ${down[i - 1]!.length} down`);
  }

  const clubs = { ...world.clubs };
  // League Two's relegated clubs swap places with the National League's: they come up, the relegated go down there.
  const out = down.at(-1)!;
  for (const id of out) clubs[id] = { ...clubs[id]!, left: world.year };
  const arrivals: TeamId[] = world.nationalLeague.slice(0, out.length);
  // A National League short of clubs (more relegated than it has) is made up with fictional new ones.
  let newClubs = world.newClubs;
  while (arrivals.length < out.length) {
    const id = NEW_CLUB_ID_BASE + newClubs + 1;
    const { name, shortName } = newClubName({ ...world, clubs }, newClubs);
    clubs[id] = { id, name, shortName, tla: shortName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(), origin: "new", joined: world.year + 1 };
    arrivals.push(id);
    newClubs++;
  }
  const nationalLeague = [...world.nationalLeague.slice(out.length), ...out];

  const nextClubs = played.map((p, i) => {
    const leaving = new Set([...up[i]!, ...down[i]!]);
    const stay = p.rows.map((r) => r.teamId).filter((id) => !leaving.has(id));
    const fromAbove = i > 0 ? down[i - 1]! : [];
    const fromBelow = i < played.length - 1 ? up[i + 1]! : arrivals;
    return [...stay, ...fromAbove, ...fromBelow];
  });
  nextClubs.forEach((ids, i) => {
    if (ids.length !== divisionConfig(ENGLAND[i]!).teams) throw new Error(`${ENGLAND[i]}: ${ids.length} clubs next season`);
  });

  // Next season's ratings: each division's from this season's results, through the between-season rule.
  const ratings: Record<number, [number, number]> = {};
  nextClubs.forEach((ids, i) => {
    const { strengths } = clubPriors(
      ids.map((id) => ({ id })),
      played[i]!.ratings,
      played[i + 1]?.ratings ?? null,
      played[i - 1]?.ratings ?? null,
    );
    for (const [id, s] of strengths) ratings[id] = [s.attack, s.defence];
  });

  // The cups played to their finals (what's left of them drawn from the season's form), for the season's record.
  const cups = finishCups(world);
  const record: SeasonRecord = {
    year: world.year,
    divisions: played.map((p) => ({
      code: p.code,
      rows: p.rows.map((r): SavedRow => [r.teamId, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points, p.notes.get(r.teamId) ?? ""]),
      ...(p.final ? { final: p.final } : {}),
      games: packGames(p.fixtures, p.results, p.rows),
      ...(Object.keys(p.playoff).length ? { playoff: Object.fromEntries(Object.entries(p.playoff).map(([id, s]) => [id, [s.home, s.away] as [number, number]])) } : {}),
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
    divisions: nextClubs.map((ids, i) => ({ code: ENGLAND[i]!, clubs: ids, calendar: 2 as const })),
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
  const config = divisionConfig(code).playoff;
  let bracket: PlayoffTie[][] = [];
  if (config && saved.playoff) {
    const scores: ResultMap = {};
    for (const [id, [home, away]] of Object.entries(saved.playoff)) scores[Number(id)] = { home, away };
    const rows: StandingRow[] = table.rows.map((r) => ({ position: r.position, teamId: r.clubId, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, goalDifference: r.goalDifference, points: r.points, form: [] }));
    const last = fixtures ? lastMatchday(fixtures) : (divisionConfig(code).teams - 1) * 2;
    const scored = (f: Fixture): Fixture => ({ ...f, result: scores[f.id] ?? f.result });
    bracket = buildBracket(rows, config, scores, { seasonComplete: true, afterMatchday: last, afterDate: gameDate(year, last) }).map((round) =>
      round.map((tie) => ({ ...tie, legs: tie.legs.map(scored), shootout: tie.shootout && scored(tie.shootout), gameShootouts: tie.gameShootouts.map(scored) })),
    );
  }
  return { code, rows: table.rows, ...(table.final ? { final: table.final } : {}), teams: saved.rows.map((r) => teamOf(world, r[0])), fixtures, bracket };
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

/** A club's season: its division ("NL": the National League) and place, and what came of it. */
export interface PathStep {
  year: number;
  code: DivisionCode | "NL";
  /** Its final place (none for a National League season). */
  position: number | null;
  /** "up" promoted (as champions, automatically or through the play-off, or from the National League), "down" relegated, "stay". */
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
  if (note === "R") return code === ENGLAND.at(-1) ? "out" : "relegated";
  const zone = divisionConfig(code).zones.find((z) => position >= z.from && position <= z.to)?.kind as PathOutcome | undefined;
  return zone && EUROPE.has(zone) ? zone : "neutral";
}

/** A club's path through the world's finished seasons, oldest first: each season's division, place and outcome, its National League seasons too. */
export function clubPath(world: World, id: TeamId): PathStep[] {
  return world.history.flatMap((season): PathStep[] => {
    const cups = (season.cups ?? []).filter((c) => c.final[0] === id).map((c) => c.code);
    const steps = season.divisions.flatMap((d, i): PathStep[] => {
      const at = d.rows.findIndex((r) => r[0] === id);
      if (at < 0) return [];
      const note = d.rows[at]![8];
      const move = note === "R" ? "down" : i > 0 && (note === "C" || note === "P" || note === "W") ? "up" : "stay";
      return [{ year: season.year, code: d.code, position: at + 1, move, note, outcome: placeOutcome(d.code, at + 1, note), cups }];
    });
    // Not in the Football League this season, and up from the National League at its end: a season there.
    if (!steps.length && season.in.includes(id)) return [{ year: season.year, code: "NL", position: null, move: "up", note: "", outcome: "nationalLeague", cups }];
    return steps;
  });
}

/** A finished season's moves between two divisions (and out of and into the bottom one), for its review. */
export function seasonMoves(record: SeasonRecord): { upper: DivisionCode; lower: DivisionCode | null; up: TeamId[]; down: TeamId[] }[] {
  return record.divisions.map((d, i) => {
    const lower = record.divisions[i + 1];
    return {
      upper: d.code,
      lower: lower?.code ?? null,
      // Up from the division below; down from this one (out of the pyramid from the bottom).
      up: lower ? lower.rows.filter((r) => r[8] === "C" || r[8] === "P" || r[8] === "W").map((r) => r[0]) : record.in,
      down: d.rows.filter((r) => r[8] === "R").map((r) => r[0]),
    };
  });
}
