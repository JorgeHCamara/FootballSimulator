import { CUPS, type CupConfig, type CupRoundConfig, type CupRoundKey } from "../config/cups.ts";
import type { CompetitionCode } from "../config/leagues.ts";
import {
  buildCup,
  clubTiers,
  CUP_ID_BASE,
  cupGameId,
  cupSecondLegId,
  cupShootoutId,
  cupWinner,
  isCupShootoutId,
  needsShootout,
  simulateCup,
  simulateCupRound,
  tieAggregate,
  tieWinner,
  type CupBuildOptions,
  type CupRound,
  type CupTie,
  type RealCupTie,
} from "../engine/cup.ts";
import { cupModelFor } from "../engine/cupModel.ts";
import { expectedGoals, expectedGoalsNeutral, sampleLikelyScore } from "../engine/match.ts";
import { simulatePenalties } from "../engine/playoffs.ts";
import type { LeagueModel, TeamStrength } from "../engine/ratings.ts";
import { isValidScore } from "../engine/results.ts";
import { createRng, randomSeed, type Rng } from "../engine/rng.ts";
import type { Fixture, ResultMap, Score, Team, TeamId } from "../engine/types.ts";
import type { World } from "./myWorld.ts";
import { COUNTRY_CUPS, cupCountry, isWorldCup, WORLD_CUPS, type WorldCountry, type WorldCupCode } from "./worldCountries.ts";
import { seasonRng, seasonStrengths, teamOf, worldTierStrength } from "./worldForm.ts";

export { COUNTRY_CUPS, cupCountry, isWorldCup, WORLD_CUPS, type WorldCupCode };

/*
 * My World's cups: the FA Cup and the EFL Cup in England, the Copa del Rey in
 * Spain (src/lib/worldCountries.ts), part of every season beside the leagues
 * (src/lib/myWorld.ts), played with the site's own cup engine
 * (src/engine/cup.ts: a draw per round, one game or two legs, a level tie on
 * penalties). The world's first season takes the real cup where it stands
 * (its draw and results so far, from the live data); every later season's cup
 * is drawn among the world's own clubs: the Football League's 92, and for the
 * FA Cup the non-league sides of the real one (World.cupPool), which play the
 * cup and nothing else. Which clubs enter in which round follows the cup's
 * round sizes, from the weakest club up: the FA Cup's first round takes the
 * non-league sides, League Two and League One, its third round the
 * Championship and the Premier League; the EFL Cup's preliminary round the
 * four lowest-ranked League Two clubs (the clubs up from the National League
 * and the two just above the relegation places), its first round the rest of
 * the Football League, its second round the Premier League's eleven
 * lowest-ranked clubs (the promoted ones among them), and its third round the
 * top nine. The clubs play the cups on the same form as their league season
 * (src/lib/worldForm.ts), scaled by their division as the site's cups are
 * (src/engine/cupModel.ts). Each cup is played round by round as on the cup
 * pages: any score typed in, a dice roll (a likely roll) for one game, a round
 * or the rest of the cup simulated (the full score distribution, as the
 * leagues' buttons draw it); playSeason finishes what's left when the season
 * ends and keeps every tie of the season (SavedCup).
 */

export const cupConfig = (code: WorldCupCode): CupConfig => CUPS.find((c) => c.code === code)!;

/** A real tie a season started with, or a finished season's: its clubs, each leg's score and the shoot-out. */
export interface WorldCupTie {
  round: CupRoundKey;
  homeId: TeamId;
  awayId: TeamId;
  /** Each leg's score, home side first (the second leg at the away club); null while unplayed. */
  legs: ([number, number] | null)[];
  /** The last leg's shoot-out, its home side first. */
  penalties?: [number, number];
}

/** A cup's season in progress. */
export interface WorldCupSeason {
  code: WorldCupCode;
  /** The clubs entering in each round: a generated season's first round, and the rounds later entrants join (the FA Cup's third round). */
  entrants: Partial<Record<CupRoundKey, TeamId[]>>;
  /** The world's first season only: the real draw so far, with its results. */
  real?: WorldCupTie[];
  /** The season's scores beyond those: typed in, rolled or simulated, by game id (legs and shoot-outs, as the cup engine numbers them). */
  scores?: Record<number, [number, number]>;
}

/** A finished season's cup, as saved. */
export interface SavedCup {
  code: WorldCupCode;
  /** The final: [winner, runner-up, winner's goals, runner-up's goals, decided on penalties]. */
  final: [TeamId, TeamId, number, number, boolean];
  /** The rounds, first to last, each with its legs (kept with `ties`). */
  rounds?: [CupRoundKey, 1 | 2][];
  /** Every club in the competition; `ties` refers to them by their place here. */
  clubs?: TeamId[];
  /** Every tie, packed nine characters a tie (see packCupTies). Kept for the last FIXTURE_SEASONS seasons. */
  ties?: string;
}

const DAY = 86_400_000;
/** Placeholder kick-off dates (only their order matters): a round every four weeks from November, a second leg a week after the first. */
const cupDate = (year: number, round: number, leg = 0) => new Date(Date.UTC(year, 10, 1, 15) + (round * 28 + leg * 7) * DAY).toISOString();

/** The clubs a round brings in beyond the previous round's winners: twice its ties, less the ties before it. */
export const roundEntrants = (cup: CupConfig, r: number) => cup.rounds[r]!.ties * 2 - (r > 0 ? cup.rounds[r - 1]!.ties : 0);

/** How many clubs from outside the league pyramid the cup needs: its entrants beyond the pyramid's clubs (32 non-league sides in the FA Cup, none in the EFL Cup). */
export function outsidersNeeded(cup: CupConfig, leagueClubs: number): number {
  const total = cup.rounds.reduce((n, _, r) => n + Math.max(0, roundEntrants(cup, r)), 0);
  // Only some of each league's clubs enter (the Copa Argentina): the rest of the places are for clubs from below.
  const entering = cup.worldEntrants ? Math.min(leagueClubs, cup.worldEntrants.reduce((n, k) => n + k, 0)) : leagueClubs;
  return Math.max(0, total - entering);
}

/**
 * A cup's season drawn among the world's clubs. `ranking`: each division's
 * clubs this season from the weakest up, top division first; `outsiders`: the
 * non-league sides in order (the first ones get in). Each round takes the
 * clubs it brings in from the weakest of those still out, so the cup's rounds
 * fill as the real one's do (see the top of this file).
 */
export function generateCup(code: WorldCupCode, ranking: readonly (readonly TeamId[])[], outsiders: readonly TeamId[]): WorldCupSeason {
  const cup = cupConfig(code);
  const leagueClubs = ranking.reduce((n, ids) => n + ids.length, 0);
  // Only each league's strongest clubs (the Copa Argentina's 30 and 15): the end of its ranking, weakest up.
  const leagues = cup.worldEntrants ? ranking.map((ids, i) => ids.slice(Math.max(0, ids.length - (cup.worldEntrants![i] ?? ids.length)))) : ranking;
  const queue = [...outsiders.slice(0, outsidersNeeded(cup, leagueClubs)), ...[...leagues].reverse().flat()];
  const entrants: Partial<Record<CupRoundKey, TeamId[]>> = {};
  cup.rounds.forEach((round, r) => {
    const needed = roundEntrants(cup, r);
    if (needed <= 0) return;
    const ids = queue.splice(0, needed);
    if (ids.length < needed) throw new Error(`${code}: ${ids.length} clubs for the ${round.key}, ${needed} needed`);
    entrants[round.key] = ids;
  });
  return { code, entrants };
}

/** A country's cups' seasons drawn among its clubs (generateCup). */
export const generateCups = (country: WorldCountry, ranking: readonly (readonly TeamId[])[], outsiders: readonly TeamId[]): WorldCupSeason[] =>
  COUNTRY_CUPS[country].map((code) => generateCup(code, ranking, outsiders));

/** The ties a season started with (WorldCupTie) as the cup engine's real ties: their games numbered by their place in the round. */
function realTiesOf(cup: CupConfig, year: number, ties: readonly WorldCupTie[]): RealCupTie[] {
  const counts = new Map<CupRoundKey, number>();
  return ties.flatMap((t): RealCupTie[] => {
    const r = cup.rounds.findIndex((x) => x.key === t.round);
    if (r < 0) return [];
    const i = counts.get(t.round) ?? 0;
    counts.set(t.round, i + 1);
    const config = cup.rounds[r]!;
    const neutral = Boolean(config.neutral ?? config.venue);
    const legs = t.legs.map((score, n): Fixture => ({
      id: n === 0 ? cupGameId(r, i) : cupSecondLegId(r, i),
      matchday: r + 1,
      utcDate: cupDate(year, r, n),
      homeId: n === 0 ? t.homeId : t.awayId,
      awayId: n === 0 ? t.awayId : t.homeId,
      result: score ? { home: score[0], away: score[1] } : null,
      ...(neutral ? { neutral: true } : {}),
      ...(n === t.legs.length - 1 && t.penalties ? { penalties: { home: t.penalties[0], away: t.penalties[1] } } : {}),
    }));
    return [{ round: t.round, homeId: t.homeId, awayId: t.awayId, legs }];
  });
}

const buildOptions = (cup: CupConfig, season: WorldCupSeason, year: number, seed: number, tiers?: Record<TeamId, number>): CupBuildOptions => ({
  entrants: season.entrants,
  // The draws are the world's own: the same world and season always draw the same.
  drawSalt: (seed ^ Math.imul(year + 1, 0x9e3779b1)) >>> 0,
  roundDates: Object.fromEntries(cup.rounds.map((round, r) => [round.key, cupDate(year, r)])),
  ...(tiers ? { tiers } : {}),
});

/** Every club in a cup's season: the ties it started with and every round's entrants. */
export const cupClubs = (season: WorldCupSeason): TeamId[] => [
  ...new Set([...(season.real ?? []).flatMap((t) => [t.homeId, t.awayId]), ...Object.values(season.entrants).flat()]),
];

/**
 * Can the season be played to its final: every round drawable from the round
 * before it and its entrants, with no club through without a game (a real
 * draw the data only had part of isn't taken). Checked when a world takes the
 * real cup over, and when a save loads.
 */
export function cupPlayable(season: WorldCupSeason, year = 2000, seed = 1): boolean {
  const cup = cupConfig(season.code);
  const real = realTiesOf(cup, year, season.real ?? []);
  const options = buildOptions(cup, season, year, seed);
  const model = cupModelFor(new Map(), cupClubs(season), 0);
  const results = simulateCup(cup, real, {}, model, createRng(seed), options);
  const rounds = buildCup(cup, real, results, options);
  // A world's cup is whole: a round the data only had part of (byes after it, see CupRound.byes) means drawing its own instead.
  return cupWinner(rounds, results) !== null && rounds.every((r) => !r.byes?.length);
}

/** The season's scores beyond the ones it started with (WorldCupSeason.scores), as results. */
export function cupScores(season: WorldCupSeason): ResultMap {
  const out: ResultMap = {};
  for (const [id, [home, away]] of Object.entries(season.scores ?? {})) out[Number(id)] = { home, away };
  return out;
}

/** Each league club's division this season (the non-league sides have none), for the division tags and the rounds the lower club hosts. */
export const cupDivisions = (world: World): Record<TeamId, CompetitionCode> =>
  Object.fromEntries(world.divisions.flatMap((d) => d.clubs.map((id) => [id, d.code] as const)));

/** The cup's model: each league club's season form scaled by its division's tier, the non-league sides at the cup's outsider tier, on the world's scale (worldTierStrength). */
function cupModel(world: World, cup: CupConfig, clubs: Iterable<TeamId>): LeagueModel {
  const strengths = new Map<TeamId, TeamStrength>();
  for (const [id, s] of seasonStrengths(world)) {
    const scale = worldTierStrength(s.tier);
    strengths.set(id, { attack: s.attack * scale.attack, defence: s.defence * scale.defence });
  }
  const outsider = worldTierStrength(cup.outsiderTier);
  for (const id of clubs) if (!strengths.has(id)) strengths.set(id, outsider);
  return cupModelFor(strengths, clubs, cup.outsiderTier);
}

/** A cup's season in progress, as the page shows it and plays it. */
export interface WorldCupState {
  code: WorldCupCode;
  index: number;
  cup: CupConfig;
  season: WorldCupSeason;
  teams: Map<TeamId, Team>;
  divisions: Record<TeamId, CompetitionCode>;
  real: RealCupTie[];
  options: CupBuildOptions;
  /** The scores beyond the ones the season started with (WorldCupSeason.scores). */
  picks: ResultMap;
  rounds: CupRound[];
  /** The season's form (cupModel). */
  model: LeagueModel;
  winner: TeamId | null;
  /** The final is decided. */
  done: boolean;
  /** The first round still open (not drawn yet, or with a tie undecided), where the page opens; null once the cup is won. */
  nextRound: number | null;
}

const indexOf = (world: World, code: WorldCupCode) => {
  const index = (world.cups ?? []).findIndex((c) => c.code === code);
  if (index < 0) throw new Error(`No ${code} in this world`);
  return index;
};

function stateOf(world: World, index: number, picks: ResultMap = cupScores(world.cups[index]!)): WorldCupState {
  const season = world.cups[index]!;
  const cup = cupConfig(season.code);
  const clubs = cupClubs(season);
  const divisions = cupDivisions(world);
  const real = realTiesOf(cup, world.year, season.real ?? []);
  const options = buildOptions(cup, season, world.year, world.seed, clubTiers(cup, divisions, clubs));
  const rounds = buildCup(cup, real, picks, options);
  const winner = cupWinner(rounds, picks);
  const open = rounds.findIndex((r) => r.drawn === "pending" || r.ties.some((tie) => tieWinner(tie, picks) === null));
  return {
    code: season.code,
    index,
    cup,
    season,
    teams: new Map(clubs.map((id) => [id, teamOf(world, id)])),
    divisions,
    real,
    options,
    picks,
    rounds,
    model: cupModel(world, cup, clubs),
    winner,
    done: winner !== null,
    nextRound: winner !== null || open < 0 ? null : open,
  };
}

/** A cup's season in progress: its rounds, scores and form. */
export const cupState = (world: World, code: WorldCupCode): WorldCupState => stateOf(world, indexOf(world, code));

/** Both cups' seasons in progress, the FA Cup first. */
export const cupStates = (world: World): WorldCupState[] => (world.cups ?? []).map((_, i) => stateOf(world, i));

/** Every cup is won: the season can be finished (playSeason draws nothing more in them). */
export const cupsDone = (world: World) => cupStates(world).every((s) => s.done);

/** Games still to play in a cup's season: every round's games without a score (rounds not drawn yet in full), and a level tie's shoot-out. */
export function cupGamesLeft(state: WorldCupState): number {
  let left = 0;
  for (const round of state.rounds) {
    const legs = round.config.legs === 2 ? 2 : 1;
    const played = round.ties.flatMap((tie) => tie.legs).filter((leg) => leg.result || state.picks[leg.id]).length;
    const shootouts = round.ties.filter((tie) => needsShootout(tie, state.picks) && !(state.picks[tie.shootout.id] ?? tie.shootout.result)).length;
    left += round.config.ties * legs - played + shootouts;
  }
  return left;
}

/** A cup's games in its season: every round's ties, one game or two legs each (a level tie's shoot-out comes on top), for the share played. */
export function cupGamesInSeason(state: WorldCupState): number {
  return state.rounds.reduce((sum, round) => sum + round.config.ties * (round.config.legs === 2 ? 2 : 1), 0);
}

/** The slot a cup game id belongs to: its round and tie. */
function slotOf(id: number): { round: number; index: number } {
  const offset = id - CUP_ID_BASE;
  const round = Math.floor(offset / 1000);
  const rest = offset % 1000;
  return { round, index: rest >= 500 ? rest - 500 : Math.floor(rest / 2) };
}

/**
 * Cup scores belong to one pairing, as on the cup pages: once an earlier
 * result changes who meets whom in a round, the scores its ties had go (they
 * all go while the round can't be drawn), and a shoot-out's score goes once
 * its tie isn't level. Scores just added stay.
 */
function tidyCup(world: World, index: number, before: ResultMap, after: ResultMap): ResultMap {
  const cup = cupConfig(world.cups[index]!.code);
  const pairings = (picks: ResultMap) => new Map(stateOf(world, index, picks).rounds.flatMap((r) => r.ties.map((tie) => [`${r.index}-${tie.index}`, `${tie.homeId}-${tie.awayId}`])));
  const was = pairings(before);
  const out = { ...after };
  const unchanged = (id: number) => before[id] !== undefined && out[id] !== undefined && before[id]!.home === out[id]!.home && before[id]!.away === out[id]!.away;
  for (let pass = 0; pass <= cup.rounds.length; pass++) {
    const now = pairings(out);
    const stale = Object.keys(out)
      .map(Number)
      .filter((id) => {
        const { round, index: tie } = slotOf(id);
        const key = `${round}-${tie}`;
        return (now.get(key) === undefined || now.get(key) !== was.get(key)) && unchanged(id);
      });
    if (!stale.length) break;
    for (const id of stale) delete out[id];
  }
  for (const tie of stateOf(world, index, out).rounds.flatMap((r) => r.ties)) if (out[tie.shootout.id] && !needsShootout(tie, out)) delete out[tie.shootout.id];
  return out;
}

/** The world with a cup's new scores (`after`, from `before`), less the scores they leave stale. */
function withCupScores(world: World, index: number, before: ResultMap, after: ResultMap): World {
  const scores = Object.fromEntries(Object.entries(tidyCup(world, index, before, after)).map(([id, s]) => [id, [s.home, s.away] as [number, number]]));
  return {
    ...world,
    cups: world.cups.map((c, i) => {
      if (i !== index) return c;
      const { scores: _old, ...rest } = c;
      return Object.keys(scores).length ? { ...rest, scores } : rest;
    }),
  };
}

function putCupScore(world: World, index: number, id: number, score: Score | null): World {
  const before = cupScores(world.cups[index]!);
  const after = { ...before };
  if (score) after[id] = score;
  else delete after[id];
  return withCupScores(world, index, before, after);
}

/** A score typed in for a cup game (a leg or a shoot-out), or cleared (null). Typing in the score a game started with is the same as leaving it. */
export function setCupScore(world: World, code: WorldCupCode, fixture: Fixture, score: Score | null): World {
  if (score && !isValidScore(score)) return world;
  const same = score && fixture.result && score.home === fixture.result.home && score.away === fixture.result.away;
  return putCupScore(world, indexOf(world, code), fixture.id, same ? null : score);
}

/** The dice: a likely roll for one cup game, another score than the one it has (a shoot-out: a shoot-out score). */
export function rollCupScore(world: World, code: WorldCupCode, fixture: Fixture, rng: Rng = createRng(randomSeed())): World {
  const state = cupState(world, code);
  const xg = fixture.neutral ? expectedGoalsNeutral(state.model, fixture.homeId, fixture.awayId) : expectedGoals(state.model, fixture.homeId, fixture.awayId);
  const score = isCupShootoutId(fixture.id) ? simulatePenalties(rng) : sampleLikelyScore(xg, rng, state.model.rho ?? 0, state.picks[fixture.id]);
  return putCupScore(world, state.index, fixture.id, score);
}

/** A round's games without a score ("Simulate round"), each drawn from the season's form, the full distribution (upsets included); nothing while the round isn't drawn. */
export function simulateWorldCupRound(world: World, code: WorldCupCode, round: number, rng: Rng = createRng(randomSeed())): World {
  const state = cupState(world, code);
  const r = state.rounds[round];
  if (!r || r.drawn === "pending") return world;
  return withCupScores(world, state.index, state.picks, { ...state.picks, ...simulateCupRound(r, state.picks, state.model, rng) });
}

/** The rest of the cup ("Simulate to the final"): every round's games drawn from the season's form, each round drawn from the winners of the one before. */
export function simulateWorldCupRest(world: World, code: WorldCupCode, rng: Rng = createRng(randomSeed())): World {
  const state = cupState(world, code);
  return withCupScores(world, state.index, state.picks, { ...state.picks, ...simulateCup(state.cup, state.real, state.picks, state.model, rng, state.options) });
}

/** One cup's season back to how it started: every score typed in, rolled or simulated goes. */
export function resetCup(world: World, code: WorldCupCode): World {
  const index = indexOf(world, code);
  return withCupScores(world, index, cupScores(world.cups[index]!), {});
}

const packChar = (n: number) => String.fromCharCode(48 + n);
const NONE = ".";

/**
 * A season's ties and scores in nine characters a tie: its round, its clubs
 * (their place in `clubs`), the goals of its first leg, of its second leg
 * ("." where there is one game) and of its shoot-out ("." where it wasn't
 * needed).
 */
export function packCupTies(rounds: readonly CupRound[], results: ResultMap, clubs: readonly TeamId[]): string {
  const place = new Map(clubs.map((id, i) => [id, i]));
  const scoreOf = (f: Fixture) => results[f.id] ?? f.result;
  const goals = (s: Score | null | undefined) => (s ? packChar(s.home) + packChar(s.away) : NONE + NONE);
  return rounds
    .flatMap((round) =>
      round.ties.map(
        (tie) =>
          packChar(round.index) +
          packChar(place.get(tie.homeId)!) +
          packChar(place.get(tie.awayId)!) +
          goals(scoreOf(tie.legs[0]!)) +
          goals(tie.legs[1] ? scoreOf(tie.legs[1]) : null) +
          goals(needsShootout(tie, results) ? scoreOf(tie.shootout) : null),
      ),
    )
    .join("");
}

/** The ties packCupTies packed, with their clubs' ids. */
export function unpackCupTies(packed: string, rounds: readonly [CupRoundKey, 1 | 2][], clubs: readonly TeamId[]): WorldCupTie[] {
  const at = (i: number) => packed.charCodeAt(i) - 48;
  const goals = (i: number): [number, number] | null => (packed[i] === NONE ? null : [at(i), at(i + 1)]);
  return Array.from({ length: Math.floor(packed.length / 9) }, (_, n) => {
    const i = n * 9;
    const round = rounds[at(i)]!;
    const legs = [goals(i + 3), ...(round[1] === 2 ? [goals(i + 5)] : [])];
    const penalties = goals(i + 7);
    return { round: round[0], homeId: clubs[at(i + 1)]!, awayId: clubs[at(i + 2)]!, legs, ...(penalties ? { penalties } : {}) };
  });
}

/** A packed string's shape (see packCupTies): nine characters a tie, its round and clubs among the season's. */
export function isPackedCupTies(value: unknown, clubs: number, rounds: number): boolean {
  if (typeof value !== "string" || value.length % 9 !== 0) return false;
  for (let i = 0; i < value.length; i += 9) {
    const round = value.charCodeAt(i) - 48;
    const home = value.charCodeAt(i + 1) - 48;
    const away = value.charCodeAt(i + 2) - 48;
    if (round < 0 || round >= rounds || home < 0 || home >= clubs || away < 0 || away >= clubs) return false;
  }
  return true;
}

/**
 * Plays the rest of every cup (every game without a score, from the season's
 * form, on the season's own random stream) and saves each: the final and
 * every tie with its scores. For playSeason.
 */
export function finishCups(world: World): SavedCup[] {
  return (world.cups ?? []).map((season, i): SavedCup => {
    const state = stateOf(world, i);
    const scores = { ...state.picks, ...simulateCup(state.cup, state.real, state.picks, state.model, seasonRng(world, 200 + i), state.options) };
    const rounds = buildCup(state.cup, state.real, scores, state.options);
    const final = rounds.at(-1)?.ties[0];
    const winner = cupWinner(rounds, scores);
    const total = final && tieAggregate(final, scores);
    if (!final || winner === null || !total) throw new Error(`${season.code}: the cup couldn't be played to its final`);
    const home = winner === final.homeId;
    const clubs = [...state.teams.keys()].sort((a, b) => a - b);
    return {
      code: season.code,
      final: [winner, home ? final.awayId : final.homeId, home ? total.home : total.away, home ? total.away : total.home, needsShootout(final, scores)],
      rounds: state.cup.rounds.map((r) => [r.key, r.legs === 2 ? 2 : 1]),
      clubs,
      ties: packCupTies(rounds, scores, clubs),
    };
  });
}

/** A finished season's cup, to look back at: its rounds, every tie carrying its scores, and the final. */
export interface PastCup {
  code: WorldCupCode;
  cup: CupConfig;
  final: SavedCup["final"];
  teams: Map<TeamId, Team>;
  /** Each league club's division that season, for the division tags. */
  divisions: Record<TeamId, CompetitionCode>;
  /** Null for a season whose ties weren't kept. */
  rounds: CupRound[] | null;
}

export function pastCup(world: World, year: number, code: WorldCupCode): PastCup | undefined {
  const season = world.history.find((s) => s.year === year);
  const saved = season?.cups?.find((c) => c.code === code);
  if (!season || !saved) return undefined;
  const cup = cupConfig(code);
  const divisions: Record<TeamId, CompetitionCode> = Object.fromEntries(season.divisions.flatMap((d) => d.rows.map((r) => [r[0], d.code] as const)));
  const teams = new Map((saved.clubs ?? saved.final.slice(0, 2)).map((id) => [id as TeamId, teamOf(world, id as TeamId)]));
  let rounds: CupRound[] | null = null;
  if (saved.ties !== undefined && saved.rounds && saved.clubs) {
    const ties = unpackCupTies(saved.ties, saved.rounds, saved.clubs);
    // The rounds as the season had them (the cup's own config where a round is still in it).
    rounds = saved.rounds.map(([key, legs], r): CupRound => {
      const own = cup.rounds.find((x) => x.key === key);
      const inRound = ties.filter((t) => t.round === key);
      const config: CupRoundConfig = { key, espnSlug: own?.espnSlug ?? "", ties: inRound.length, ...(legs === 2 ? { legs: 2 } : {}), ...(own?.neutral ? { neutral: true } : {}), ...(own?.venue ? { venue: own.venue } : {}), ...(own?.noExtraTime !== undefined ? { noExtraTime: own.noExtraTime } : {}) };
      const neutral = Boolean(config.neutral ?? config.venue);
      const built = inRound.map((t, i): CupTie => {
        const legFixtures = t.legs.map((score, n): Fixture => ({
          id: n === 0 ? cupGameId(r, i) : cupSecondLegId(r, i),
          matchday: r + 1,
          utcDate: cupDate(year, r, n),
          homeId: n === 0 ? t.homeId : t.awayId,
          awayId: n === 0 ? t.awayId : t.homeId,
          result: score ? { home: score[0], away: score[1] } : null,
          ...(neutral ? { neutral: true } : {}),
        }));
        const last = legFixtures.at(-1)!;
        return { round: r, index: i, homeId: t.homeId, awayId: t.awayId, game: legFixtures[0]!, legs: legFixtures, shootout: { ...last, id: cupShootoutId(r, i), result: t.penalties ? { home: t.penalties[0], away: t.penalties[1] } : null }, real: true };
      });
      return { index: r, config, drawn: "real", ties: built, participants: built.flatMap((t) => [t.homeId, t.awayId]) };
    });
  }
  return { code, cup, final: saved.final, teams, divisions, rounds };
}
