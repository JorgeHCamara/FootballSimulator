import { getLeagueByCode, type LeagueConfig } from "../config/leagues.ts";
import { expectedGoals, sampleDixonColes, sampleNormal } from "../engine/match.ts";
import { ratingNoiseSd } from "../engine/montecarlo.ts";
import { clubPriors, seasonRatings, type SeasonRatings } from "../engine/offseason.ts";
import { simulatePlayoff, tieOutcome, type PlayoffTie } from "../engine/playoffs.ts";
import type { LeagueModel, TeamStrength } from "../engine/ratings.ts";
import { createRng, randomSeed, type Rng } from "../engine/rng.ts";
import { doubleRoundRobin } from "../engine/schedule.ts";
import { computeStandings } from "../engine/standings.ts";
import type { Fixture, ResultMap, StandingRow, Team, TeamId } from "../engine/types.ts";
import { SEASON_RATING_NOISE } from "./seasonNoise.ts";

/*
 * My World: a fictional timeline of the English pyramid (Premier League to
 * League Two), started from the site's live data and played on season by
 * season in the visitor's browser (saved by src/lib/myWorldStorage.ts).
 *
 * A season plays all four leagues with the site's own engine: each game's score
 * from the club ratings (Dixon–Coles, as the season outlook draws them, with
 * its season rating noise), the table with the league's tiebreakers, and the
 * league's own play-off. Promotion and relegation come from the league configs
 * (their promotion and relegation places, and the play-off winner), applied to
 * all four at once. League Two's relegated clubs leave the pyramid (kept in the
 * save, for a National League later) and as many new clubs come up from below.
 *
 * Between seasons each club's rating carries over through the site's own
 * between-season rule (src/engine/offseason.ts, the one the real starting
 * ratings are built with): its rating from the season's results keeps most of
 * its difference from average, a promoted club becomes a below-average one in
 * its new league, a relegated club the reverse, and a new club starts below
 * average. Nothing here touches the live outlook, snapshots or SIM_VERSION.
 */

/** The save's format: a save of another version is set aside, not read (see myWorldStorage.ts). */
export const WORLD_VERSION = 1;

/** The English pyramid's divisions the world plays, top first (league config codes). */
export const ENGLAND = ["PL", "ELC", "EL1", "EL2"] as const;
export type DivisionCode = (typeof ENGLAND)[number];

export const isDivision = (code: string): code is DivisionCode => (ENGLAND as readonly string[]).includes(code);
export const divisionConfig = (code: DivisionCode): LeagueConfig => getLeagueByCode(code)!;

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
}

/** A finished season, as saved: every division's final table, who left the pyramid and who joined it. */
export interface SeasonRecord {
  year: number;
  divisions: SavedDivision[];
  /** Clubs relegated out of the bottom division. */
  out: TeamId[];
  /** New clubs that came up into it for the next season. */
  in: TeamId[];
}

export interface World {
  version: typeof WORLD_VERSION;
  /** Which pyramid (only England so far). */
  pyramid: "ENG";
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
  /** The last season has just been played: its review shows until the next season is started. */
  review: boolean;
  /** How many new clubs have come up so far (their ids and names). */
  newClubs: number;
}

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

/** Everything a new world starts from; `missing`: leagues whose live data didn't load (no world can start then). */
export interface StartPack {
  leagues: StartLeague[];
  missing: DivisionCode[];
}

/** Can a world start from this pack: all four leagues, with full clubs lists, in the same season. */
export function packReady(pack: StartPack): boolean {
  if (pack.missing.length) return false;
  const years = new Set(pack.leagues.map((l) => l.year));
  return ENGLAND.every((code) => {
    const league = pack.leagues.find((l) => l.code === code);
    return league !== undefined && league.teams.length === divisionConfig(code).teams;
  }) && years.size === 1;
}

/**
 * A new world from the live data: every club gets a world id of its own (the
 * site's sample leagues reuse ids across leagues), the first season is the
 * real one, with its results, deductions and ratings. `user`: the visitor's
 * club, by its league and id in the live data.
 */
export function createWorld(pack: StartPack, user: { league: DivisionCode; club: number }, seed = randomSeed(), now = new Date()): World {
  if (!packReady(pack)) throw new Error("The live data for the four leagues isn't complete");
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
  return {
    version: WORLD_VERSION,
    pyramid: "ENG",
    id: `${now.getTime().toString(36)}-${(seed >>> 0).toString(36)}`,
    createdAt: now.toISOString(),
    seed: seed >>> 0,
    userClub,
    year: pack.leagues[0]!.year,
    clubs,
    ratings,
    params,
    divisions,
    history: [],
    review: false,
    newClubs: 0,
  };
}

/** A season's own random stream: the same world and season always play out the same way. */
const seasonRng = (world: World, salt: number) => createRng((world.seed ^ Math.imul(world.year + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);

const DAY = 86_400_000;
/** Placeholder kick-off dates (only their order matters): a game a week from early August. */
const gameDate = (year: number, matchday: number) => new Date(Date.UTC(year, 7, 8, 14) + (matchday - 1) * 7 * DAY).toISOString();

const teamOf = (world: World, id: TeamId): Team => {
  const c = world.clubs[id]!;
  return { id, name: c.name, shortName: c.shortName, tla: c.tla, ...(c.crest ? { crest: c.crest } : {}) };
};

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A division's games this season: the first season's real calendar, or a new double round robin (in a new order every season). */
export function divisionFixtures(world: World, d: DivisionSeason): { fixtures: Fixture[]; results: ResultMap } {
  if (d.games) {
    const fixtures = d.games.map((g): Fixture => ({ id: g[0], matchday: g[1], utcDate: gameDate(world.year, g[1]), homeId: g[2], awayId: g[3], result: null }));
    const results: ResultMap = {};
    for (const g of d.games) if (g[4] !== null && g[5] !== null) results[g[0]] = { home: g[4], away: g[5] };
    return { fixtures, results };
  }
  const order = shuffled(d.clubs, seasonRng(world, 100 + ENGLAND.indexOf(d.code)));
  return { fixtures: doubleRoundRobin(order, gameDate(world.year, 1)), results: {} };
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

interface PlayedDivision {
  code: DivisionCode;
  teams: Team[];
  fixtures: Fixture[];
  results: ResultMap;
  rows: StandingRow[];
  notes: Map<TeamId, RowNote>;
  final?: SavedDivision["final"];
  ratings: SeasonRatings;
}

/** Plays one division's season: the games left (from the season's noisy ratings), the table, the play-off. */
function playDivision(world: World, d: DivisionSeason, index: number): PlayedDivision {
  const league = divisionConfig(d.code);
  const teams = d.clubs.map((id) => teamOf(world, id));
  const { fixtures, results } = divisionFixtures(world, d);
  const rng = seasonRng(world, index);
  // This season's ratings: the club's own, with the season outlook's rating noise (less once games are in).
  const played = new Map<TeamId, number>();
  for (const f of fixtures) if (results[f.id]) for (const id of [f.homeId, f.awayId]) played.set(id, (played.get(id) ?? 0) + 1);
  const strengths = new Map<TeamId, TeamStrength>();
  for (const id of d.clubs) {
    const [attack, defence] = world.ratings[id] ?? [1, 1];
    const sd = ratingNoiseSd(SEASON_RATING_NOISE.sd, SEASON_RATING_NOISE.k, played.get(id) ?? 0);
    strengths.set(id, { attack: attack * Math.exp(sd * sampleNormal(rng)), defence: defence * Math.exp(sd * sampleNormal(rng)) });
  }
  const p = world.params[d.code];
  const model: LeagueModel = { avgHomeGoals: p.avgHomeGoals, avgAwayGoals: p.avgAwayGoals, strengths, ...(p.rho ? { rho: p.rho } : {}) };
  const all: ResultMap = { ...results };
  for (const f of fixtures) if (!all[f.id]) all[f.id] = sampleDixonColes(expectedGoals(model, f.homeId, f.awayId), p.rho, rng);
  const rows = computeStandings(teams, fixtures, all, { tiebreakers: league.tiebreakers, includeForm: false, ...(d.deductions ? { deductions: d.deductions } : {}) });

  const places = movementPlaces(league);
  const notes = new Map<TeamId, RowNote>(rows.map((r) => [r.teamId, ""]));
  for (const r of rows) {
    if (places.playoff.includes(r.position)) notes.set(r.teamId, "O");
    if (places.promotion.includes(r.position)) notes.set(r.teamId, "P");
    if (places.relegation.includes(r.position)) notes.set(r.teamId, "R");
    if (r.position === 1) notes.set(r.teamId, "C");
  }
  let final: SavedDivision["final"];
  if (league.playoff) {
    const last = fixtures.reduce((m, f) => Math.max(m, f.matchday), 0);
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
    let finalTie: PlayoffTie | undefined;
    const rounds = league.playoff.rounds.length;
    const knockout = seasonRng(world, 50 + index);
    const added = simulatePlayoff(rows, league.playoff, {}, model, knockout, { afterMatchday: last, afterDate: gameDate(world.year, last), ...(real.length ? { real } : {}) }, (r, ties) => {
      if (r === rounds - 1) finalTie = ties[0];
    });
    const outcome = finalTie ? tieOutcome(finalTie, added) : null;
    if (finalTie && outcome) {
      const loser = outcome.winner === finalTie.higher.teamId ? finalTie.lower.teamId! : finalTie.higher.teamId!;
      const winnerGoals = outcome.winner === finalTie.higher.teamId ? outcome.higherGoals : outcome.lowerGoals;
      const loserGoals = outcome.winner === finalTie.higher.teamId ? outcome.lowerGoals : outcome.higherGoals;
      final = [outcome.winner, loser, winnerGoals, loserGoals, outcome.onPenalties];
      if (places.playoffPromotes) notes.set(outcome.winner, "W");
    }
  }
  return { code: d.code, teams, fixtures, results: all, rows, notes, ...(final ? { final } : {}), ratings: seasonRatings({ teams, fixtures, results: all }) };
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
  const out = down.at(-1)!;
  for (const id of out) clubs[id] = { ...clubs[id]!, left: world.year };
  // As many new clubs come up into the bottom division as left it.
  const arrivals: TeamId[] = [];
  let newClubs = world.newClubs;
  for (let k = 0; k < out.length; k++) {
    const id = NEW_CLUB_ID_BASE + newClubs + 1;
    const { name, shortName } = newClubName({ ...world, clubs }, newClubs);
    clubs[id] = { id, name, shortName, tla: shortName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase(), origin: "new", joined: world.year + 1 };
    arrivals.push(id);
    newClubs++;
  }

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

  const record: SeasonRecord = {
    year: world.year,
    divisions: played.map((p) => ({
      code: p.code,
      rows: p.rows.map((r): SavedRow => [r.teamId, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points, p.notes.get(r.teamId) ?? ""]),
      ...(p.final ? { final: p.final } : {}),
    })),
    out,
    in: arrivals,
  };
  return {
    ...world,
    year: world.year + 1,
    clubs,
    ratings,
    divisions: nextClubs.map((ids, i) => ({ code: ENGLAND[i]!, clubs: ids })),
    history: [...world.history, record],
    review: true,
    newClubs,
  };
}

/** The review's been seen: the next season shows. */
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

/** A division's table in the season in progress: the first season's real one so far, or every club on nothing. */
export function currentTable(world: World, code: DivisionCode): TableRow[] {
  const d = world.divisions.find((x) => x.code === code);
  if (!d) return [];
  const { fixtures, results } = divisionFixtures(world, d);
  const rows = computeStandings(
    d.clubs.map((id) => teamOf(world, id)),
    fixtures,
    results,
    { tiebreakers: divisionConfig(code).tiebreakers, includeForm: false, ...(d.deductions ? { deductions: d.deductions } : {}) },
  );
  return rows.map((r) => ({ position: r.position, clubId: r.teamId, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, goalsFor: r.goalsFor, goalsAgainst: r.goalsAgainst, goalDifference: r.goalDifference, points: r.points, note: "" }));
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

/** Where a club plays in the season in progress (undefined once it has left the pyramid). */
export const clubDivision = (world: World, id: TeamId): DivisionCode | undefined => world.divisions.find((d) => d.clubs.includes(id))?.code;

/** A club's season: its division and place, and what came of it. */
export interface PathStep {
  year: number;
  code: DivisionCode;
  position: number;
  /** "up" promoted (as champions, automatically or through the play-off), "down" relegated (from the bottom: out), "stay". */
  move: "up" | "down" | "stay";
  note: RowNote;
}

/** A club's path through the world's finished seasons, oldest first. */
export function clubPath(world: World, id: TeamId): PathStep[] {
  return world.history.flatMap((season) =>
    season.divisions.flatMap((d, i) => {
      const at = d.rows.findIndex((r) => r[0] === id);
      if (at < 0) return [];
      const note = d.rows[at]![8];
      const move = note === "R" ? "down" : i > 0 && (note === "C" || note === "P" || note === "W") ? "up" : "stay";
      return [{ year: season.year, code: d.code, position: at + 1, move, note }];
    }),
  );
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
