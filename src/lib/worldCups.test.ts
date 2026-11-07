import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import type { CupRoundKey } from "../config/cups.ts";
import { cupGameId, needsShootout, tieWinner, type CupRound } from "../engine/cup.ts";
import { likelyScoreSet, expectedGoals } from "../engine/match.ts";
import { createRng } from "../engine/rng.ts";
import type { ResultMap, TeamId } from "../engine/types.ts";
import {
  clubDivision,
  clubPath,
  createWorld,
  CUP_POOL_ID_BASE,
  divisionRanking,
  FIXTURE_SEASONS,
  NATIONAL_LEAGUE_ID_BASE,
  packReady,
  playSeason,
  startNextSeason,
  type StartCup,
  type StartPack,
  type World,
} from "./myWorld.ts";
import { worldStartPack } from "./myWorldStart.ts";
import { isWorld, loadWorld, saveWorld, WORLD_KEY } from "./myWorldStorage.ts";
import {
  cupClubs,
  cupConfig,
  cupGamesInSeason,
  cupGamesLeft,
  cupPlayable,
  cupsDone,
  cupState,
  cupStates,
  generateCup,
  outsidersNeeded,
  packCupTies,
  pastCup,
  resetCup,
  rollCupScore,
  setCupScore,
  simulateWorldCupRest,
  simulateWorldCupRound,
  unpackCupTies,
  WORLD_CUPS,
} from "./worldCups.ts";

// The four English leagues and the two cups from the generated sample data (no network).
let pack: StartPack;
let world: World;
before(async () => {
  process.env.FOOTSIMU_SAMPLE_DATA = "1";
  pack = await worldStartPack();
  world = createWorld(pack, { league: "EL2", club: pack.leagues[3]!.teams[4]!.id }, 42, new Date("2026-11-06T12:00:00Z"));
});

const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
/** Each division's clubs from the weakest up: ids 1–20 the Premier League, 21–44 the Championship, 45–68 League One, 69–92 League Two. */
const RANKING = [ids(1, 20), ids(21, 24), ids(45, 24), ids(69, 24)];
const divisionOf = (w: World, id: TeamId) => clubDivision(w, id) ?? (w.nationalLeague.includes(id) ? "NL" : w.cupPool.includes(id) ? "pool" : "?");
const count = (w: World, list: readonly TeamId[]) => {
  const out: Record<string, number> = {};
  for (const id of list) out[divisionOf(w, id)] = (out[divisionOf(w, id)] ?? 0) + 1;
  return out;
};
const memoryStore = () => {
  const items = new Map<string, string>();
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
};

/** The sample pack with every club's id unique across its leagues, as the live data's are (the sample leagues reuse ids). */
function uniquePack(): StartPack {
  return {
    ...pack,
    leagues: pack.leagues.map((l, i) => {
      const shift = (id: number) => id + (i + 1) * 1000;
      return {
        ...l,
        teams: l.teams.map((t) => ({ ...t, id: shift(t.id) })),
        games: l.games.map((g) => [g[0], g[1], shift(g[2]), shift(g[3]), g[4], g[5]] as typeof g),
        ...(l.deductions ? { deductions: Object.fromEntries(Object.entries(l.deductions).map(([id, n]) => [shift(Number(id)), n])) } : {}),
        ...(l.playoffGames ? { playoffGames: l.playoffGames.map((g) => [g[0], shift(g[1]), shift(g[2]), ...g.slice(3)] as typeof g) } : {}),
        model: { ...l.model, strengths: Object.fromEntries(Object.entries(l.model.strengths).map(([id, s]) => [shift(Number(id)), s])) },
      };
    }),
  };
}

/**
 * A cup as the live data would have it this season, built from a pack's
 * leagues: `outsiders` non-league sides, a first round of real ties (the
 * first `played` with a result, the first of them level and on penalties),
 * and the clubs entering later. For the FA Cup: League One, League Two and
 * the outsiders in the first round, the Premier League and the Championship
 * in the third.
 */
function liveFaCup(pack: StartPack, { played = 10, outsiders = 32, ties = 40, year = pack.leagues[0]!.year, unknown = false } = {}): StartCup {
  const league = (code: string) => pack.leagues.find((l) => l.code === code)!.teams;
  const teams = pack.leagues.flatMap((l) => l.teams);
  const divisions = Object.fromEntries(pack.leagues.flatMap((l) => l.teams.map((t) => [t.id, l.code])));
  const extra = ids(90_001, outsiders).map((id) => ({ id, name: `Outsider ${id}`, shortName: `Out ${id}`, tla: "OUT" }));
  const first = [...league("EL1").map((t) => t.id), ...league("EL2").map((t) => t.id), ...extra.map((t) => t.id)];
  const real = Array.from({ length: ties }, (_, i): StartCup["real"][number] => ({
    round: "firstRound",
    homeId: unknown && i === 0 ? 99_999 : first[2 * i]!,
    awayId: first[2 * i + 1]!,
    legs: [i < played ? (i === 0 ? [1, 1] : [2, 1]) : null],
    ...(i === 0 && played > 0 ? { penalties: [4, 3] as [number, number] } : {}),
  }));
  return { code: "FAC", year, teams: [...teams, ...extra], divisions, real, entrants: { thirdRound: [...league("PL"), ...league("ELC")].map((t) => t.id) } };
}

describe("My World: the cups' entry rounds", () => {
  it("the FA Cup brings 32 non-league sides in; the EFL Cup is the Football League's 92 alone; the Copa del Rey 84 from below Spain's two leagues", () => {
    assert.equal(outsidersNeeded(cupConfig("FAC"), 92), 32);
    assert.equal(outsidersNeeded(cupConfig("EFC"), 92), 0);
    assert.equal(outsidersNeeded(cupConfig("CDR"), 42), 84);
  });

  it("the Copa del Rey: the lower sides in the qualifying round and, with the Segunda and most of La Liga, in the first round; La Liga's strongest four in the round of 32", () => {
    const spain = [ids(1, 20), ids(21, 22)];
    const outsiders = ids(2001, 90);
    const cdr = generateCup("CDR", spain, outsiders);
    assert.deepEqual(Object.keys(cdr.entrants), ["qualifyingRound", "firstRound", "roundOf32"]);
    assert.deepEqual(cdr.entrants.qualifyingRound, ids(2001, 20));
    assert.deepEqual(cdr.entrants.firstRound, [...ids(2021, 64), ...ids(21, 22), ...ids(1, 16)]);
    assert.deepEqual(cdr.entrants.roundOf32, ids(17, 4));
    assert.ok(cupPlayable(cdr));
  });

  it("fills each round from the weakest club up, as many as its ties need: the FA Cup's first round takes the non-league sides and the two lower leagues, its third round the top two", () => {
    const outsiders = ids(1001, 40);
    const fac = generateCup("FAC", RANKING, outsiders);
    assert.deepEqual(Object.keys(fac.entrants), ["firstRound", "thirdRound"]);
    assert.deepEqual(fac.entrants.firstRound, [...outsiders.slice(0, 32), ...ids(69, 24), ...ids(45, 24)], "32 outsiders, League Two, League One");
    assert.deepEqual(fac.entrants.thirdRound, [...ids(21, 24), ...ids(1, 20)], "the Championship and the Premier League");
    assert.equal(fac.real, undefined);
  });

  it("the EFL Cup: the four lowest-ranked League Two clubs in the preliminary round, the rest of the Football League in the first, the Premier League's eleven lowest in the second and its top nine in the third", () => {
    const efc = generateCup("EFC", RANKING, []);
    assert.deepEqual(efc.entrants.preliminaryRound, ids(69, 4));
    assert.deepEqual(efc.entrants.firstRound, [...ids(73, 20), ...ids(45, 24), ...ids(21, 24)]);
    assert.deepEqual(efc.entrants.secondRound, ids(1, 11));
    assert.deepEqual(efc.entrants.thirdRound, ids(12, 9));
    assert.ok(cupPlayable(efc), "drawable round by round to the final");
  });

  it("throws when the clubs can't fill a round", () => {
    assert.throws(() => generateCup("FAC", RANKING, ids(1001, 10)), /thirdRound, 44 needed/);
  });
});

describe("My World: a new world's cups", () => {
  it("has both cups, the FA Cup's pool of 32 non-league sides from the real cup (clubs of the world that play no league), and every club of each cup in the world", () => {
    assert.ok(packReady(pack));
    assert.deepEqual(world.cups.map((c) => c.code), ["FAC", "EFC"], "England's cups, of the six a world can play");
    assert.deepEqual([...WORLD_CUPS], ["FAC", "EFC", "CDR", "DFB", "CIT", "CDB"]);
    assert.equal(world.cupPool.length, 32);
    const pool = world.cupPool.map((id) => world.clubs[id]!);
    assert.ok(pool.every((c) => c.origin === "real" && c.realId !== undefined && c.id > CUP_POOL_ID_BASE && c.id < NATIONAL_LEAGUE_ID_BASE), "real clubs, with the pool's ids");
    assert.ok(pool.every((c) => clubDivision(world, c.id) === undefined && !world.nationalLeague.includes(c.id)), "in no league");
    const fac = cupClubs(world.cups[0]!);
    assert.equal(fac.length, 124, "92 league clubs and 32 non-league sides");
    assert.ok(fac.every((id) => world.clubs[id]), "every one a club of the world");
    assert.deepEqual(count(world, world.cups[0]!.entrants.firstRound!), { NL: 2, pool: 30, EL1: 24, EL2: 24 }, "the National League's clubs are in, two of the pool sit the season out");
    assert.deepEqual(count(world, world.cups[0]!.entrants.thirdRound!), { PL: 20, ELC: 24 });
    assert.deepEqual(count(world, cupClubs(world.cups[1]!)), { PL: 20, ELC: 24, EL1: 24, EL2: 24 });
    // The first season of the sample data draws its own cups: its cup clubs can't be matched to its league clubs (the sample leagues reuse ids).
    assert.equal(world.cups[0]!.real, undefined);
    assert.equal(world.cups[1]!.real, undefined);
  });

  it("without the cups' data, no new world", () => {
    assert.equal(packReady({ ...pack, cups: pack.cups.filter((c) => c.code !== "EFC") }), false);
    assert.equal(packReady({ ...pack, missing: ["FAC"] }), false);
  });

  it("takes the real cup over where it stands when the data is this season's and every club is known: its draw, its results so far, its shoot-out", () => {
    const unique = uniquePack();
    const live = createWorld({ ...unique, cups: [liveFaCup(unique), ...unique.cups.filter((c) => c.code !== "FAC")] }, { league: "EL2", club: unique.leagues[3]!.teams[4]!.id }, 42);
    const season = live.cups[0]!;
    assert.equal(season.real?.length, 40);
    assert.ok(season.real!.every((t) => live.clubs[t.homeId] && live.clubs[t.awayId]), "every club as a world club");
    assert.deepEqual(count(live, season.real!.flatMap((t) => [t.homeId, t.awayId])), { EL1: 24, EL2: 24, pool: 32 });
    assert.equal(live.cupPool.length, 32);
    const state = cupState(live, "FAC");
    assert.equal(state.rounds[0]!.drawn, "real");
    assert.equal(state.rounds[0]!.ties.length, 40);
    assert.deepEqual(state.rounds[0]!.ties[1]!.game.result, { home: 2, away: 1 }, "the result it started with");
    assert.deepEqual(state.rounds[0]!.ties[0]!.shootout.result, { home: 4, away: 3 }, "the level tie's shoot-out");
    assert.equal(tieWinner(state.rounds[0]!.ties[0]!, state.picks), state.rounds[0]!.ties[0]!.homeId, "decided on penalties");
    assert.equal(cupGamesLeft(state), 123 - 10, "ten ties played");
    assert.equal(cupGamesInSeason(state), 123, "the season's games: 40 first-round ties to the final");
    assert.equal(state.rounds[1]!.drawn, "pending");
    // Played on from there to the final.
    const done = simulateWorldCupRest(live, "FAC", createRng(3));
    assert.notEqual(cupState(done, "FAC").winner, null);
    assert.deepEqual(cupState(done, "FAC").rounds[0]!.ties[1]!.game.result, { home: 2, away: 1 }, "the real result stands");
  });

  it("draws its own cup instead when the data is another season's, names a club the world doesn't have, or can't be played to the final", () => {
    const unique = uniquePack();
    const user = { league: "EL2" as const, club: unique.leagues[3]!.teams[4]!.id };
    const withCup = (cup: StartCup) => createWorld({ ...unique, cups: [cup, ...unique.cups.filter((c) => c.code !== "FAC")] }, user, 42).cups[0]!;
    assert.notEqual(withCup(liveFaCup(unique)).real, undefined, "taken over as it is");
    assert.equal(withCup(liveFaCup(unique, { year: unique.leagues[0]!.year - 1 })).real, undefined, "last season's cup");
    assert.equal(withCup(liveFaCup(unique, { unknown: true })).real, undefined, "an unknown club");
    assert.equal(withCup(liveFaCup(unique, { ties: 39 })).real, undefined, "a first round the data only had part of");
    assert.equal(cupPlayable({ code: "FAC", entrants: { firstRound: ids(1, 80) } }), false, "no third-round entrants: the third round can't be drawn");
  });
});

describe("My World: a cup played your way", () => {
  const first = (w: World, code: "FAC" | "EFC" = "FAC") => cupState(w, code).rounds[0]!.ties[0]!;

  it("games left: 123 in the FA Cup, 93 in the EFL Cup (two-legged semi-finals), counted down as they're played; a level game adds its shoot-out", () => {
    assert.deepEqual(cupStates(world).map(cupGamesLeft), [123, 93]);
    assert.equal(cupsDone(world), false);
    let w = setCupScore(world, "FAC", first(world).game, { home: 2, away: 0 });
    assert.equal(cupGamesLeft(cupState(w, "FAC")), 122);
    w = setCupScore(w, "FAC", first(w).game, { home: 1, away: 1 });
    assert.equal(cupGamesLeft(cupState(w, "FAC")), 123, "level: the shoot-out is still to play");
    assert.equal(needsShootout(first(w), cupState(w, "FAC").picks), true);
    w = setCupScore(w, "FAC", first(w).shootout, { home: 5, away: 4 });
    assert.equal(cupGamesLeft(cupState(w, "FAC")), 122);
    assert.equal(tieWinner(first(w), cupState(w, "FAC").picks), first(w).homeId);
    // The game decided after all: its shoot-out score goes.
    w = setCupScore(w, "FAC", first(w).game, { home: 0, away: 3 });
    assert.equal(cupState(w, "FAC").picks[first(w).shootout.id], undefined);
    assert.equal(tieWinner(first(w), cupState(w, "FAC").picks), first(w).awayId);
    // Cleared, or an invalid score: as it was.
    w = setCupScore(w, "FAC", first(w).game, null);
    assert.deepEqual(w.cups[0]!.scores, undefined);
    assert.equal(setCupScore(w, "FAC", first(w).game, { home: -1, away: 2 }), w);
  });

  it("the dice make a likely roll; a level tie's shoot-out rolls a shoot-out score", () => {
    const state = cupState(world, "FAC");
    const tie = state.rounds[0]!.ties[3]!;
    const rolled = rollCupScore(world, "FAC", tie.game, createRng(7));
    const score = cupState(rolled, "FAC").picks[tie.game.id]!;
    const likely = likelyScoreSet(expectedGoals(state.model, tie.homeId, tie.awayId));
    assert.ok(likely.some((s) => s.home === score.home && s.away === score.away), `${score.home}-${score.away} among the likely scores`);
    const level = setCupScore(world, "FAC", tie.game, { home: 1, away: 1 });
    const pens = cupState(rollCupScore(level, "FAC", tie.shootout, createRng(8)), "FAC").picks[tie.shootout.id]!;
    assert.notEqual(pens.home, pens.away, "a shoot-out has a winner");
  });

  it("Simulate round decides the round and draws the next; a changed earlier result redraws the ties it touches, whose scores go (the rest stay)", () => {
    let w = simulateWorldCupRound(world, "FAC", 0, createRng(1));
    let state = cupState(w, "FAC");
    assert.ok(state.rounds[0]!.ties.every((tie) => tieWinner(tie, state.picks) !== null), "every first-round tie decided");
    assert.equal(state.rounds[1]!.drawn, "simulated");
    assert.equal(state.rounds[1]!.ties.length, 20);
    assert.equal(state.rounds[2]!.drawn, "pending", "the third round waits for the second");
    assert.equal(simulateWorldCupRound(w, "FAC", 2, createRng(1)), w, "nothing to simulate in a round not drawn");
    w = simulateWorldCupRound(w, "FAC", 1, createRng(2));
    state = cupState(w, "FAC");
    assert.equal(state.rounds[2]!.ties.length, 32, "the third round drawn, the Premier League and the Championship in");
    assert.equal(cupGamesLeft(state), 123 - 60);
    const pairing = (tie: { homeId: TeamId; awayId: TeamId }) => `${tie.homeId}-${tie.awayId}`;
    const before = new Map(state.rounds[1]!.ties.map((tie) => [tie.index, pairing(tie)]));
    const scoresBefore = { ...state.picks };
    // A first-round tie's winner flips: its second-round tie is redrawn with the new winner.
    const flipped = state.rounds[0]!.ties.find((tie) => tieWinner(tie, state.picks) === tie.homeId)!;
    const loser = flipped.awayId;
    w = setCupScore(w, "FAC", flipped.game, { home: 0, away: 1 });
    state = cupState(w, "FAC");
    assert.ok(state.rounds[1]!.ties.some((tie) => tie.homeId === loser || tie.awayId === loser), "the new winner is in the second round");
    const kept = state.rounds[1]!.ties.filter((tie) => state.picks[tie.game.id]);
    assert.ok(kept.length > 0 && kept.length < 20, `${kept.length} second-round scores kept`);
    for (const tie of kept) {
      assert.equal(pairing(tie), before.get(tie.index), "only ties still paired as they were keep their score");
      assert.deepEqual(state.picks[tie.game.id], scoresBefore[tie.game.id]);
    }
    assert.equal(state.rounds[2]!.drawn, "pending", "the third round waits again");
    assert.ok(state.rounds[2]!.ties.every((tie) => !state.picks[tie.game.id]), "no third-round score left");
  });

  it("Simulate to the final wins the cup; Reset puts the cup back as it started", () => {
    const w = simulateWorldCupRest(world, "EFC", createRng(5));
    const state = cupState(w, "EFC");
    assert.notEqual(state.winner, null);
    assert.equal(state.done, true);
    assert.equal(state.nextRound, null);
    assert.equal(cupGamesLeft(state), 0);
    assert.equal(state.rounds.at(-1)!.drawn, "determined");
    assert.deepEqual(state.rounds.map((r) => r.ties.length), [2, 35, 23, 16, 8, 4, 2, 1]);
    assert.ok(state.rounds[6]!.ties.every((tie) => tie.legs.length === 2 && state.picks[tie.legs[1]!.id]), "two-legged semi-finals, both legs played");
    assert.equal(cupsDone(w), false, "the FA Cup is still to play");
    assert.equal(cupsDone(simulateWorldCupRest(w, "FAC", createRng(6))), true);
    assert.deepEqual(resetCup(w, "EFC"), world);
  });

  it("the same world draws the same cup: the rounds don't depend on how the season is played", () => {
    const again = createWorld(pack, { league: "EL2", club: pack.leagues[3]!.teams[4]!.id }, 42, new Date("2026-11-06T12:00:00Z"));
    assert.deepEqual(again.cups, world.cups);
    assert.deepEqual(cupState(again, "FAC").rounds, cupState(world, "FAC").rounds);
    const other = createWorld(pack, { league: "EL2", club: pack.leagues[3]!.teams[4]!.id }, 43, new Date("2026-11-06T12:00:00Z"));
    assert.notDeepEqual(cupState(other, "FAC").rounds[0]!.ties.map((t) => [t.homeId, t.awayId]), cupState(world, "FAC").rounds[0]!.ties.map((t) => [t.homeId, t.awayId]), "another seed, another draw");
  });
});

describe("My World: the cups at the season's end", () => {
  let next: World;
  before(() => {
    next = playSeason(world);
  });

  it("playSeason finishes both cups and records each: the final, and every tie with its scores, to look back at", () => {
    const record = next.history[0]!;
    assert.deepEqual(record.cups?.map((c) => c.code), ["FAC", "EFC"]);
    for (const saved of record.cups!) {
      const [winner, runnerUp, w, l, pens] = saved.final;
      assert.ok(next.clubs[winner] && next.clubs[runnerUp] && winner !== runnerUp);
      assert.ok(pens ? w === l : w > l, "the winner's goals, or level and on penalties");
      const past = pastCup(next, record.year, saved.code)!;
      assert.equal(past.rounds!.length, 8);
      assert.deepEqual(past.rounds!.map((r) => r.ties.length), saved.code === "FAC" ? [40, 20, 32, 16, 8, 4, 2, 1] : [2, 35, 23, 16, 8, 4, 2, 1]);
      const results: ResultMap = {};
      for (const round of past.rounds!) for (const tie of round.ties) assert.notEqual(tieWinner(tie, results), null, `${saved.code} ${round.config.key} decided`);
      assert.equal(tieWinner(past.rounds!.at(-1)!.ties[0]!, results), winner);
      assert.ok(past.teams.size >= 92 && [...past.teams.keys()].every((id) => past.divisions[id] !== undefined || next.clubs[id]!.origin === "real"), "every club with its division that season, or a non-league side");
      assert.equal(past.rounds![6]!.ties[0]!.legs.length, saved.code === "EFC" ? 2 : 1);
    }
    assert.equal(pastCup(next, record.year + 1, "FAC"), undefined);
  });

  it("the cup winners' seasons show the cup; the review's record carries the finals", () => {
    const [fac, efc] = next.history[0]!.cups!;
    for (const saved of [fac!, efc!]) {
      const steps = clubPath(next, saved.final[0]);
      if (steps.length) assert.deepEqual(steps.at(-1)!.cups, [saved.code]);
    }
    const other = next.history[0]!.divisions[0]!.rows.map((r) => r[0]).find((id) => id !== fac!.final[0] && id !== efc!.final[0])!;
    assert.deepEqual(clubPath(next, other).at(-1)!.cups, []);
  });

  it("draws next season's cups among next season's clubs: the FA Cup's first round from the lower leagues, the National League's clubs and the pool; the EFL Cup's rounds from last season's tables", () => {
    const [fac, efc] = next.cups;
    assert.deepEqual(count(next, fac!.entrants.firstRound!), { NL: 2, pool: 30, EL1: 24, EL2: 24 });
    assert.deepEqual(count(next, fac!.entrants.thirdRound!), { PL: 20, ELC: 24 });
    assert.deepEqual(next.nationalLeague, next.history[0]!.out, "last season's relegated clubs are the National League's, and in the FA Cup");
    assert.notDeepEqual(fac!.entrants.firstRound!.filter((id) => next.cupPool.includes(id)), world.cups[0]!.entrants.firstRound!.filter((id) => world.cupPool.includes(id)), "the pool in a new order");
    const last = next.history[0]!;
    const place = (code: string, id: TeamId) => last.divisions.find((d) => d.code === code)!.rows.findIndex((r) => r[0] === id) + 1;
    assert.deepEqual(efc!.entrants.preliminaryRound!.map((id) => (last.in.includes(id) ? "NL" : place("EL2", id))), ["NL", "NL", 22, 21], "the two up from the National League and the two just above the relegation places");
    assert.deepEqual(efc!.entrants.thirdRound!.map((id) => place("PL", id)), [9, 8, 7, 6, 5, 4, 3, 2, 1], "last season's top nine, the champions last");
    assert.deepEqual(efc!.entrants.secondRound!.map((id) => place("PL", id) || "up"), ["up", "up", "up", 17, 16, 15, 14, 13, 12, 11, 10]);
    assert.deepEqual(count(next, efc!.entrants.firstRound!), { ELC: 24, EL1: 24, EL2: 20 });
    assert.ok(cupPlayable(fac!) && cupPlayable(efc!));
    assert.deepEqual(divisionRanking(next).map((ids) => ids.length), [20, 24, 24, 24]);
    assert.deepEqual(cupStates(next).map(cupGamesLeft), [123, 93]);
  });

  it("a cup half played when the season ends: its scores stand, the rest is drawn", () => {
    let w = simulateWorldCupRound(world, "FAC", 0, createRng(1));
    const picks = { ...cupState(w, "FAC").picks };
    w = playSeason(w);
    const past = pastCup(w, world.year, "FAC")!;
    for (const tie of past.rounds![0]!.ties) assert.deepEqual(tie.game.result, picks[tie.game.id], "the first round as it was played");
  });

  it("the season's cups are the same whatever the world's clubs did in the leagues: drawn from the world's seed", () => {
    assert.deepEqual(playSeason(world).history[0]!.cups, next.history[0]!.cups);
  });

  it("keeps the ties of the last FIXTURE_SEASONS seasons, the finals of all", () => {
    let w = next;
    for (let i = 0; i < FIXTURE_SEASONS; i++) w = playSeason(startNextSeason(w));
    assert.equal(w.history.length, FIXTURE_SEASONS + 1);
    assert.equal(w.history[0]!.cups![0]!.ties, undefined);
    assert.equal(w.history[0]!.cups![0]!.clubs, undefined);
    assert.equal(w.history[0]!.cups![0]!.final.length, 5);
    assert.equal(pastCup(w, w.history[0]!.year, "FAC")!.rounds, null);
    assert.notEqual(w.history[1]!.cups![0]!.ties, undefined);
    assert.ok(w.history.every((s) => s.cups!.length === 2));
  });
});

describe("My World: packed cup ties", () => {
  it("packs every tie in nine characters, a second leg and a shoot-out included, and unpacks it", () => {
    const w = simulateWorldCupRest(world, "EFC", createRng(5));
    const state = cupState(w, "EFC");
    const clubs = cupClubs(w.cups[1]!).sort((a, b) => a - b);
    const packed = packCupTies(state.rounds, state.picks, clubs);
    assert.equal(packed.length, 91 * 9);
    const rounds = state.cup.rounds.map((r): [CupRoundKey, 1 | 2] => [r.key, r.legs === 2 ? 2 : 1]);
    const ties = unpackCupTies(packed, rounds, clubs);
    assert.equal(ties.length, 91);
    const semi = ties.filter((t) => t.round === "semiFinals");
    assert.equal(semi.length, 2);
    assert.ok(semi.every((t) => t.legs.length === 2 && t.legs.every((leg) => leg !== null)));
    assert.ok(ties.filter((t) => t.round !== "semiFinals").every((t) => t.legs.length === 1));
    const level = state.rounds.flatMap((r) => r.ties).filter((tie) => needsShootout(tie, state.picks));
    assert.equal(ties.filter((t) => t.penalties).length, level.length, "a shoot-out where the tie was level");
    for (const round of state.rounds) {
      for (const tie of round.ties) {
        const found = ties.find((t) => t.round === round.config.key && t.homeId === tie.homeId && t.awayId === tie.awayId)!;
        assert.deepEqual(found.legs[0], [state.picks[tie.game.id]!.home, state.picks[tie.game.id]!.away]);
      }
    }
  });
});

describe("My World: the cups in the save", () => {
  it("saves and reloads the cups and the pool; a world played on keeps every cup's ties", () => {
    const store = memoryStore();
    const w = simulateWorldCupRound(world, "FAC", 0, createRng(1));
    assert.ok(isWorld(w));
    assert.equal(saveWorld(store, w), true);
    assert.deepEqual(loadWorld(store, pack).world, w);
    const played = startNextSeason(playSeason(w));
    assert.equal(saveWorld(store, played), true);
    assert.deepEqual(loadWorld(store).world, played);
  });

  it("a save from before the cups gets them when it loads: the pool from the live FA Cup, this season's cups drawn among its clubs; fictional non-league sides without the live data", () => {
    const store = memoryStore();
    const { cups: _c, cupPool: _p, ...old } = startNextSeason(playSeason(world));
    const oldClubs = Object.fromEntries(Object.entries(old.clubs).filter(([id]) => !world.cupPool.includes(Number(id))));
    const oldHistory = old.history.map(({ cups: _cups, ...season }) => season);
    store.setItem(WORLD_KEY, JSON.stringify({ ...old, clubs: oldClubs, history: oldHistory }));
    const upgraded = loadWorld(store, pack).world!;
    assert.equal(upgraded.cupPool.length, 32);
    assert.ok(upgraded.cupPool.every((id) => upgraded.clubs[id]!.origin === "real"));
    assert.deepEqual(upgraded.cups.map((c) => c.code), ["FAC", "EFC"]);
    assert.deepEqual(count(upgraded, upgraded.cups[0]!.entrants.firstRound!), { NL: 2, pool: 30, EL1: 24, EL2: 24 });
    assert.deepEqual(upgraded.cups[1]!.entrants.thirdRound, next9(upgraded), "the EFL Cup's third round from last season's table, as a season played with the cups has it");
    assert.equal(upgraded.history[0]!.cups, undefined, "a finished season from before has no cups");
    assert.equal(upgraded.newClubs, 0);
    const alone = loadWorld(store).world!;
    assert.equal(alone.cupPool.length, 30, "made up to the 32 the FA Cup needs with the National League's two");
    assert.ok(alone.cupPool.every((id) => alone.clubs[id]!.origin === "new"));
    assert.equal(alone.newClubs, 30);
    assert.ok(cupsDone(alone) === false && cupPlayable(alone.cups[0]!));
  });

  it("a cup season that can't be played any more (another format) is redrawn when the save loads; the other is kept", () => {
    const store = memoryStore();
    const w = simulateWorldCupRound(world, "EFC", 0, createRng(1));
    saveWorld(store, { ...w, cups: [{ code: "FAC", entrants: { firstRound: w.cups[0]!.entrants.firstRound!.slice(0, 70) } }, w.cups[1]!] });
    const loaded = loadWorld(store, pack).world!;
    assert.equal(loaded.cups[0]!.entrants.firstRound!.length, 80, "redrawn");
    assert.deepEqual(loaded.cups[1], w.cups[1], "kept, with its scores");
  });

  it("rejects cups and pools that don't make sense", () => {
    const bad = (patch: Partial<Record<keyof World, unknown>>) => isWorld({ ...world, ...patch });
    assert.equal(bad({ cups: [{ code: "XYZ", entrants: {} }] }), false);
    assert.equal(bad({ cups: [{ code: "FAC", entrants: { firstRound: [999_999] } }] }), false);
    assert.equal(bad({ cups: [{ code: "FAC", entrants: {}, real: [{ round: "firstRound", homeId: 1, awayId: 999_999, legs: [null] }] }] }), false);
    assert.equal(bad({ cups: [{ code: "FAC", entrants: {}, scores: { 1: [1] } }] }), false);
    assert.equal(bad({ cupPool: [999_999] }), false);
    assert.equal(bad({ cups: [{ code: "FAC", entrants: {}, real: [{ round: "firstRound", homeId: 1, awayId: 2, legs: [[1, 1]], penalties: [4, 3] }] }] }), true);
    const played = playSeason(world);
    const history = (cups: unknown) => isWorld({ ...played, history: [{ ...played.history[0]!, cups }] });
    assert.equal(history([{ code: "FAC", final: [1, 2, 3, 1] }]), false);
    assert.equal(history([{ code: "FAC", final: [1, 999_999, 3, 1, false] }]), false);
    assert.equal(history([{ ...played.history[0]!.cups![0]!, ties: "abc" }]), false);
    assert.equal(history([{ ...played.history[0]!.cups![0]!, clubs: [1] }]), false, "a tie's club beyond the list");
    assert.equal(history([{ code: "FAC", final: [1, 2, 3, 1, false] }]), true, "ties not kept");
    assert.equal(history(played.history[0]!.cups), true);
  });
});

/** The EFL Cup's third-round entrants a season played with the cups would draw: last season's top nine in the Premier League, the champions last. */
function next9(w: World): TeamId[] {
  const rows = w.history.at(-1)!.divisions[0]!.rows;
  return rows.slice(0, 9).map((r) => r[0]).reverse();
}

// A round the page can show: its ties carry their fixtures (for the type above).
export type _Round = CupRound;
export const _cupGameId = cupGameId;
