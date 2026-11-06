import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { expectedGoals, likelyScoreSet } from "../engine/match.ts";
import { isShootoutId, playoffIds, tieIds, tieOutcome } from "../engine/playoffs.ts";
import { NO_DATA_PRIOR } from "../engine/ratings.ts";
import { createRng } from "../engine/rng.ts";
import {
  clubDivision,
  clubPath,
  createWorld,
  currentTable,
  divisionConfig,
  divisionState,
  ENGLAND,
  movementCounts,
  NEW_CLUB_ID_BASE,
  packReady,
  playRound,
  playSeason,
  resetDivision,
  rollScore,
  savedTable,
  seasonDone,
  seasonLabel,
  seasonMoves,
  seasonStates,
  setScore,
  simulateMatchday,
  simulatePlayoffs,
  simulateRest,
  startNextSeason,
  type DivisionCode,
  type StartPack,
  type World,
} from "./myWorld.ts";
import { worldStartPack } from "./myWorldStart.ts";
import { SEASON_RATING_NOISE } from "./seasonNoise.ts";
import { SIM_VERSION } from "./simVersion.ts";

// The four English leagues from the generated sample data (no network): their clubs reuse ids across leagues.
let pack: StartPack;
before(async () => {
  process.env.FOOTSIMU_SAMPLE_DATA = "1";
  pack = await worldStartPack();
});

const notes = (world: World, year: number, code: DivisionCode) => savedTable(world, year, code)!.rows.map((r) => r.note);
const count = (list: string[], ...notes: string[]) => list.filter((n) => notes.includes(n)).length;
const divisionOf = (world: World) => new Map(world.divisions.flatMap((d) => d.clubs.map((id) => [id, d.code] as const)));
/** A club that wins every game it plays (for walking a club up the pyramid). */
const unbeatable = (world: World, id: number): World => ({ ...world, ratings: { ...world.ratings, [id]: [8, 0.1] } });

describe("My World: the pyramid", () => {
  it("moves the clubs the league configs say: 3 between the Premier League and the Championship, 3 below that, 4 between League One and League Two, 2 out of League Two", () => {
    assert.deepEqual(movementCounts(), [
      { up: 0, down: 3 },
      { up: 3, down: 3 },
      { up: 3, down: 4 },
      { up: 4, down: 2 },
    ]);
    assert.deepEqual(ENGLAND.map((c) => divisionConfig(c).teams), [20, 24, 24, 24]);
  });

  it("season labels follow the English split year", () => {
    assert.equal(seasonLabel(2026), "2026/27");
    assert.equal(seasonLabel(2027), "2027/28");
    assert.equal(seasonLabel(2099), "2099/00");
  });
});

describe("My World: a new world", () => {
  it("starts from the live data of the four leagues: every club its own id, the real season's games and the live ratings", () => {
    assert.ok(packReady(pack), `missing: ${pack.missing}`);
    const user = pack.leagues.find((l) => l.code === "EL2")!.teams[5]!;
    const world = createWorld(pack, { league: "EL2", club: user.id }, 42, new Date("2026-11-06T12:00:00Z"));
    assert.equal(world.year, pack.leagues[0]!.year);
    assert.deepEqual(world.divisions.map((d) => [d.code, d.clubs.length]), [["PL", 20], ["ELC", 24], ["EL1", 24], ["EL2", 24]]);
    const ids = world.divisions.flatMap((d) => d.clubs);
    assert.equal(new Set(ids).size, 92, "ids unique across leagues (sample leagues reuse theirs)");
    assert.equal(world.clubs[world.userClub]!.name, user.name);
    assert.equal(clubDivision(world, world.userClub), "EL2");
    // The first season is the real one: its results so far stand.
    for (const d of world.divisions) {
      const real = pack.leagues.find((l) => l.code === d.code)!;
      assert.equal(d.games!.length, real.games.length);
      assert.equal(d.games!.filter((g) => g[4] !== null).length, real.games.filter((g) => g[4] !== null).length);
      const played = currentTable(world, d.code).reduce((sum, r) => sum + r.played, 0);
      assert.equal(played, 2 * real.games.filter((g) => g[4] !== null).length, `${d.code}: the real table so far`);
    }
    // The live ratings.
    const first = pack.leagues[0]!.teams[0]!;
    assert.deepEqual(world.ratings[1], pack.leagues[0]!.model.strengths[first.id]);
    assert.equal(world.history.length, 0);
    assert.throws(() => createWorld(pack, { league: "PL", club: -1 }), /isn't in that league/);
    assert.throws(() => createWorld({ ...pack, missing: ["EL1"] }, { league: "EL2", club: user.id }), /isn't complete/);
  });
});

describe("My World: a season", () => {
  const NOW = new Date("2026-11-06T12:00:00Z");
  const start = () => createWorld(pack, { league: "EL2", club: pack.leagues[3]!.teams[0]!.id }, 7, NOW);

  it("plays all four leagues, saves every final table and moves clubs up and down together", () => {
    const world = start();
    const year = world.year;
    const after = playSeason(world);
    assert.equal(after.year, year + 1);
    assert.equal(after.review, true);
    assert.equal(after.history.length, 1);
    const season = after.history[0]!;
    assert.deepEqual(season.divisions.map((d) => [d.code, d.rows.length]), [["PL", 20], ["ELC", 24], ["EL1", 24], ["EL2", 24]]);
    // Every game of the season was played.
    for (const d of season.divisions) {
      const games = divisionConfig(d.code).teams * 2 - 2;
      assert.ok(d.rows.every((r) => r[1] === games), `${d.code}: ${games} games each`);
    }
    // The notes: champions, promoted, play-off winner, play-offs, relegated.
    assert.deepEqual([count(notes(after, year, "PL"), "C"), count(notes(after, year, "PL"), "R")], [1, 3]);
    assert.deepEqual([count(notes(after, year, "ELC"), "C", "P", "W"), count(notes(after, year, "ELC"), "O"), count(notes(after, year, "ELC"), "R")], [3, 5, 3]);
    assert.deepEqual([count(notes(after, year, "EL1"), "C", "P", "W"), count(notes(after, year, "EL1"), "O"), count(notes(after, year, "EL1"), "R")], [3, 3, 4]);
    assert.deepEqual([count(notes(after, year, "EL2"), "C", "P", "W"), count(notes(after, year, "EL2"), "O"), count(notes(after, year, "EL2"), "R")], [4, 3, 2]);
    // The play-off final: its winner went up, as "W".
    for (const code of ["ELC", "EL1", "EL2"] as const) {
      const table = savedTable(after, year, code)!;
      const [winner, loser] = table.final!;
      assert.equal(table.rows.find((r) => r.clubId === winner)!.note, "W");
      assert.equal(table.rows.find((r) => r.clubId === loser)!.note, "O");
    }

    // Where each club plays next season.
    const before = divisionOf(world);
    const next = divisionOf(after);
    const moved = (from: DivisionCode, to: DivisionCode | undefined) => [...before].filter(([id, d]) => d === from && next.get(id) === to).length;
    assert.equal(moved("PL", "ELC"), 3);
    assert.equal(moved("ELC", "PL"), 3);
    assert.equal(moved("ELC", "EL1"), 3);
    assert.equal(moved("EL1", "ELC"), 3);
    assert.equal(moved("EL1", "EL2"), 4);
    assert.equal(moved("EL2", "EL1"), 4);
    assert.equal(moved("EL2", undefined), 2, "two out of League Two");
    assert.deepEqual(after.divisions.map((d) => [d.code, d.clubs.length]), [["PL", 20], ["ELC", 24], ["EL1", 24], ["EL2", 24]]);
    // The relegated clubs are destined for the division below, the promoted ones the division above.
    for (const [i, d] of season.divisions.entries()) {
      for (const [id, , , , , , , , note] of d.rows) {
        if (note === "R" && i < 3) assert.equal(next.get(id), ENGLAND[i + 1]);
        if (["C", "P", "W"].includes(note) && i > 0) assert.equal(next.get(id), ENGLAND[i - 1]);
      }
    }
    // League Two's two relegated clubs left but stay in the save; two new, labelled clubs came up instead.
    assert.equal(season.out.length, 2);
    for (const id of season.out) {
      assert.equal(after.clubs[id]!.left, year);
      assert.equal(after.clubs[id]!.origin, "real");
      assert.equal(next.get(id), undefined);
    }
    assert.equal(season.in.length, 2);
    for (const id of season.in) {
      const club = after.clubs[id]!;
      assert.equal(club.origin, "new");
      assert.equal(club.joined, year + 1);
      assert.ok(id > NEW_CLUB_ID_BASE);
      assert.equal(next.get(id), "EL2");
    }
    assert.equal(new Set(season.in.map((id) => after.clubs[id]!.name)).size, 2);
    assert.equal(Object.keys(after.clubs).length, 94, "92 in the pyramid, 2 out");
    // The review's moves.
    const moves = seasonMoves(season);
    assert.deepEqual(moves.map((m) => [m.upper, m.lower, m.up.length, m.down.length]), [["PL", "ELC", 3, 3], ["ELC", "EL1", 3, 3], ["EL1", "EL2", 4, 4], ["EL2", null, 2, 2]]);
    // The next season starts on nothing, with a new calendar.
    assert.equal(after.divisions.every((d) => d.games === undefined), true);
    assert.ok(currentTable(after, "PL").every((r) => r.played === 0 && r.points === 0));
    assert.equal(startNextSeason(after).review, false);
  });

  it("carries each club's rating into the next season through the between-season rule", () => {
    const after = playSeason(start());
    for (const d of after.divisions) for (const id of d.clubs) assert.ok(after.ratings[id], `${d.code}: ${id} has a rating`);
    const season = after.history[0]!;
    const mean = (ids: number[], k: 0 | 1) => Math.exp(ids.reduce((s, id) => s + Math.log(after.ratings[id]![k]), 0) / ids.length);
    // Promoted clubs start below average in their new league, relegated ones above.
    const promoted = season.divisions[1]!.rows.filter((r) => ["C", "P", "W"].includes(r[8])).map((r) => r[0]);
    const relegated = season.divisions[0]!.rows.filter((r) => r[8] === "R").map((r) => r[0]);
    assert.ok(mean(promoted, 0) < 1 && mean(promoted, 1) > 1, "promoted: below average");
    assert.ok(mean(relegated, 0) > 1 && mean(relegated, 1) < 1, "relegated: above average");
    // New clubs: the below-average default for a club without data.
    for (const id of season.in) {
      const [attack, defence] = after.ratings[id]!;
      assert.ok(attack < 1 && defence > 1);
      assert.ok(attack <= NO_DATA_PRIOR.attack * 1.2);
    }
    // Every division averages 1 (geometric mean).
    for (const d of after.divisions) assert.ok(Math.abs(mean(d.clubs, 0) - 1) < 0.01, d.code);
  });

  it("the same world plays out the same way; another world differently", () => {
    assert.deepEqual(playSeason(start()), playSeason(start()));
    const other = createWorld(pack, { league: "EL2", club: pack.leagues[3]!.teams[0]!.id }, 8, NOW);
    assert.notDeepEqual(playSeason(other).history[0]!.divisions[0]!.rows, playSeason(start()).history[0]!.divisions[0]!.rows);
  });

  it("a League Two club promoted in successive seasons reaches the Premier League, and its path shows the climb", () => {
    let world = start();
    const me = world.userClub;
    const first = world.year;
    for (let i = 0; i < 4; i++) world = startNextSeason(playSeason(unbeatable(world, me)));
    // Three promotions in a row: League Two, League One, the Championship, then a Premier League season.
    assert.deepEqual(
      clubPath(world, me).map((s) => [s.year, s.code, s.position, s.move]),
      [
        [first, "EL2", 1, "up"],
        [first + 1, "EL1", 1, "up"],
        [first + 2, "ELC", 1, "up"],
        [first + 3, "PL", 1, "stay"],
      ],
    );
    // In the saved Premier League table, as its champions.
    const pl = savedTable(world, first + 3, "PL")!;
    assert.equal(pl.rows[0]!.clubId, me);
    assert.equal(pl.rows[0]!.note, "C");
    assert.equal(clubDivision(world, me), "PL");
  });

  it("past seasons' tables stay as they were after later seasons are played", () => {
    let world = startNextSeason(playSeason(start()));
    const first = world.history[0]!.year;
    const saved = structuredClone(ENGLAND.map((code) => savedTable(world, first, code)));
    for (let i = 0; i < 3; i++) world = startNextSeason(playSeason(world));
    assert.equal(world.history.length, 4);
    assert.deepEqual(ENGLAND.map((code) => savedTable(world, first, code)), saved);
    // "The Premier League two seasons ago": the season before last's table.
    const twoAgo = world.history.at(-3)!.year;
    assert.equal(twoAgo, first + 1);
    assert.equal(savedTable(world, twoAgo, "PL")!.rows.length, 20);
    // Every club still has its name, the ones that left too.
    for (const season of world.history) for (const d of season.divisions) for (const r of d.rows) assert.ok(world.clubs[r[0]]!.name);
    assert.equal(savedTable(world, first - 1, "PL"), undefined);
  });

  it("leaves the live site's model alone", () => {
    assert.equal(SIM_VERSION, "2");
    assert.deepEqual(SEASON_RATING_NOISE, { sd: 0.15, k: 5 });
  });
});

describe("My World: a season played your way", () => {
  const NOW = new Date("2026-11-06T12:00:00Z");
  const start = () => createWorld(pack, { league: "EL2", club: pack.leagues[3]!.teams[0]!.id }, 7, NOW);
  const picked = (world: World, code: DivisionCode) => Object.keys(world.divisions.find((d) => d.code === code)!.scores ?? {}).length;
  /** Plays round after round until the whole season is decided; how many rounds that took. */
  const playOut = (world: World, rng = createRng(3)) => {
    let rounds = 0;
    while (!seasonDone(world)) {
      world = playRound(world, rng);
      if (++rounds > 100) throw new Error("the season never ends");
    }
    return { world, rounds };
  };

  it("a round: every league plays its next matchday, from where the real season is", () => {
    const world = start();
    const before = seasonStates(world);
    assert.deepEqual(before.map((s) => s.nextRound), [16, 19, 19, 19], "the sample leagues' next matchdays");
    const after = playRound(world, createRng(1));
    for (const [i, state] of seasonStates(after).entries()) {
      const was = before[i]!;
      const round = state.fixtures.filter((f) => f.matchday === was.nextRound);
      assert.ok(round.length > 0 && round.every((f) => state.results[f.id]), `${state.code}: matchday ${was.nextRound} played`);
      assert.equal(Object.keys(state.picks).length, round.length, `${state.code}: only that matchday`);
      assert.equal(state.nextRound, was.nextRound! + 1);
      // The results the world started with stand.
      for (const f of state.fixtures) if (f.result) assert.deepEqual(state.results[f.id], f.result);
    }
    // The table shows the round.
    const pl = currentTable(after, "PL");
    assert.equal(pl.reduce((n, r) => n + r.played, 0), currentTable(world, "PL").reduce((n, r) => n + r.played, 0) + 20);
  });

  it("round after round to the end of the play-offs, then the season is finished from those scores", () => {
    const { world, rounds } = playOut(start());
    // The Championship takes longest: matchdays 19 to 46, then the eliminators, both semi-final legs and the final.
    assert.equal(rounds, 28 + 4);
    const states = seasonStates(world);
    assert.ok(states.every((s) => s.done && s.nextRound === null));
    for (const s of states.slice(1)) {
      const final = s.bracket.at(-1)![0]!;
      assert.ok(tieOutcome(final, s.picks), `${s.code}: the final is decided`);
    }
    const tables = ENGLAND.map((code) => currentTable(world, code));
    const finals = states.map((s) => (s.bracket.length ? tieOutcome(s.bracket.at(-1)![0]!, s.picks)!.winner : null));
    const after = playSeason(world);
    assert.equal(after.review, true);
    // Nothing more is drawn: the saved tables are the ones the rounds made, and the final's winner went up.
    for (const [i, code] of ENGLAND.entries()) {
      const saved = savedTable(after, world.year, code)!;
      assert.deepEqual(saved.rows.map((r) => [r.clubId, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points]), tables[i]!.map((r) => [r.clubId, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points]));
      if (finals[i] !== null) {
        assert.equal(saved.final![0], finals[i]);
        assert.equal(saved.rows.find((r) => r.clubId === finals[i])!.note, "W");
      }
    }
    assert.ok(after.divisions.every((d) => d.scores === undefined), "the next season starts with no scores");
  });

  it("a season mixed: picked scores, a few rounds, then the rest at once", () => {
    let world = start();
    const me = world.userClub;
    // The visitor's club wins every game it has left, 4–0.
    const mine = divisionState(world, "EL2").fixtures.filter((f) => !f.result && (f.homeId === me || f.awayId === me));
    for (const f of mine) world = setScore(world, "EL2", f, f.homeId === me ? { home: 4, away: 0 } : { home: 0, away: 4 });
    assert.equal(picked(world, "EL2"), mine.length);
    world = playRound(playRound(world, createRng(5)), createRng(6));
    const won = currentTable(world, "EL2").find((r) => r.clubId === me)!;
    const after = playSeason(world);
    const row = savedTable(after, world.year, "EL2")!.rows.find((r) => r.clubId === me)!;
    const startRow = currentTable(start(), "EL2").find((r) => r.clubId === me)!;
    assert.equal(row.won, startRow.won + mine.length, "every picked win stands");
    assert.equal(row.goalsFor, startRow.goalsFor + 4 * mine.length);
    assert.ok(won.played <= row.played);
  });

  it("a result the world started with can be changed, and typing it back in leaves it as it was", () => {
    let world = start();
    const state = divisionState(world, "PL");
    const game = state.fixtures.find((f) => f.result && f.result.home !== 7)!;
    world = setScore(world, "PL", game, { home: 7, away: 0 });
    assert.deepEqual(divisionState(world, "PL").results[game.id], { home: 7, away: 0 });
    assert.equal(picked(world, "PL"), 1);
    world = setScore(world, "PL", game, game.result);
    assert.equal(world.divisions[0]!.scores, undefined, "no score kept");
    assert.deepEqual(divisionState(world, "PL").results[game.id], game.result);
    // Clearing a typed score; a score out of range is ignored.
    const open = state.fixtures.find((f) => !f.result)!;
    world = setScore(world, "PL", open, { home: 2, away: 2 });
    assert.equal(picked(world, "PL"), 1);
    world = setScore(world, "PL", open, null);
    assert.equal(picked(world, "PL"), 0);
    assert.equal(setScore(world, "PL", open, { home: -1, away: 2 }), world);
  });

  it("the dice and the league buttons make likely rolls, as on the league pages", () => {
    let world = startNextSeason(playSeason(start()));
    // Simulate matchday: that matchday's games only, each a likely score.
    world = simulateMatchday(world, "PL", 1, createRng(9));
    const state = divisionState(world, "PL");
    const first = state.fixtures.filter((f) => f.matchday === 1);
    assert.equal(Object.keys(state.picks).length, first.length);
    for (const f of first) {
      const likely = likelyScoreSet(expectedGoals(state.model, f.homeId, f.awayId), state.model.rho ?? 0);
      assert.ok(likely.some((s) => s.home === state.picks[f.id]!.home && s.away === state.picks[f.id]!.away), "a likely score");
    }
    // The dice: another score each time.
    const game = state.fixtures.find((f) => f.matchday === 2)!;
    const once = rollScore(world, "PL", game, createRng(1));
    const twice = rollScore(once, "PL", game, createRng(1));
    assert.notDeepEqual(divisionState(twice, "PL").picks[game.id], divisionState(once, "PL").picks[game.id]);
    // Simulate rest of season: the whole league, play-off included; the other leagues untouched.
    const rest = simulateRest(world, "ELC", createRng(2));
    const elc = divisionState(rest, "ELC");
    assert.ok(elc.done);
    assert.equal(picked(rest, "PL"), first.length);
    assert.equal(picked(rest, "EL1"), 0);
    // Reset: that league's season as it started.
    const reset = resetDivision(rest, "ELC");
    assert.equal(picked(reset, "ELC"), 0);
    assert.equal(picked(reset, "PL"), first.length);
  });

  it("play-off scores belong to their pairing, and a shoot-out to a level tie", () => {
    let world = simulateRest(startNextSeason(playSeason(start())), "EL2", createRng(4));
    const before = divisionState(world, "EL2");
    assert.ok(before.done);
    const [semis, finals] = before.bracket as [typeof before.bracket[0], typeof before.bracket[0]];
    const final = finals[0]!;
    const finalIds = tieIds(1, 0, final.config).filter((id) => before.picks[id]);
    assert.ok(finalIds.length > 0);

    // The other club wins the first semi-final: the final's scores go (its pairing changed), the semi's first leg stays.
    const semi = semis[0]!;
    const loser = tieOutcome(semi, before.picks)!.winner === semi.higher.teamId ? semi.lower.teamId! : semi.higher.teamId!;
    const [leg1, leg2] = semi.legs as [typeof semi.legs[0], typeof semi.legs[0]];
    world = setScore(world, "EL2", leg2, leg2.homeId === loser ? { home: 9, away: 0 } : { home: 0, away: 9 });
    const after = divisionState(world, "EL2");
    assert.equal(tieOutcome(after.bracket[0]![0]!, after.picks)!.winner, loser);
    assert.deepEqual(after.picks[leg1.id], before.picks[leg1.id]);
    for (const id of finalIds) assert.equal(after.picks[id], undefined, "the final's scores went");
    assert.equal(after.done, false);
    assert.equal(after.nextRound, after.bracket[1]![0]!.legs[0]!.matchday, "next: the final");

    // A level semi-final needs its shoot-out; once it isn't level, the shoot-out's score goes.
    const other = after.bracket[0]![1]!;
    world = setScore(world, "EL2", other.legs[0]!, { home: 1, away: 1 });
    world = setScore(world, "EL2", other.legs[1]!, { home: 1, away: 1 });
    const level = divisionState(world, "EL2");
    const shootout = level.bracket[0]![1]!.shootout!;
    assert.ok(isShootoutId(shootout.id));
    world = setScore(world, "EL2", shootout, { home: 5, away: 4 });
    assert.deepEqual(divisionState(world, "EL2").picks[shootout.id], { home: 5, away: 4 });
    world = setScore(world, "EL2", other.legs[1]!, { home: 2, away: 1 });
    assert.equal(divisionState(world, "EL2").picks[shootout.id], undefined);

    // A league game without a score: the play-off waits, and its scores all go.
    const game = before.fixtures.find((f) => before.picks[f.id])!;
    world = setScore(world, "EL2", game, null);
    const open = divisionState(world, "EL2");
    assert.equal(open.leagueComplete, false);
    for (const id of playoffIds(divisionConfig("EL2").playoff!)) assert.equal(open.picks[id], undefined);
    assert.equal(open.nextRound, game.matchday);
    // The play-off's own button: nothing to do until the league is complete.
    assert.equal(simulatePlayoffs(world, "EL2", createRng(1)), world);
  });

  it("games postponed in the real season are played with the first round, not as rounds of their own", () => {
    const late = {
      ...pack,
      leagues: pack.leagues.map((l) => (l.code === "EL2" ? { ...l, games: l.games.map((g, i) => (i === 40 ? [g[0], g[1], g[2], g[3], null, null] as typeof g : g)) } : l)),
    };
    const world = createWorld(late, { league: "EL2", club: late.leagues[3]!.teams[0]!.id }, 7, NOW);
    const state = divisionState(world, "EL2");
    const postponed = state.fixtures.find((f) => !f.result && f.matchday < 19)!;
    assert.ok(postponed, "a game left from an early matchday");
    assert.equal(state.nextRound, 19);
    const after = divisionState(playRound(world, createRng(1)), "EL2");
    assert.ok(after.results[postponed.id], "played with the first round");
    assert.equal(after.nextRound, 20);
  });
});
