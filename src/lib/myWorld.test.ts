import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { expectedGoals, likelyScoreSet } from "../engine/match.ts";
import { isShootoutId, playoffIds, tieIds, tieOutcome } from "../engine/playoffs.ts";
import { NO_DATA_PRIOR } from "../engine/ratings.ts";
import { createRng } from "../engine/rng.ts";
import { longestVenueRun } from "../engine/schedule.ts";
import {
  clubDivision,
  clubPath,
  createWorld,
  currentTable,
  divisionConfig,
  divisionState,
  ENGLAND,
  FIXTURE_SEASONS,
  gamesLeft,
  movementCounts,
  NATIONAL_LEAGUE_ID_BASE,
  packReady,
  pastDivision,
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
  upgradeWorld,
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
    // League Two's two relegated clubs drop into the National League; its clubs, Boreham Wood and Harrogate Town, come up instead.
    assert.equal(season.out.length, 2);
    for (const id of season.out) {
      assert.equal(after.clubs[id]!.left, year);
      assert.equal(after.clubs[id]!.origin, "real");
      assert.equal(next.get(id), undefined);
    }
    assert.deepEqual(after.nationalLeague, season.out);
    assert.deepEqual(season.in, [NATIONAL_LEAGUE_ID_BASE + 1, NATIONAL_LEAGUE_ID_BASE + 2]);
    assert.deepEqual(season.in.map((id) => after.clubs[id]!.name), ["Boreham Wood", "Harrogate Town"]);
    for (const id of season.in) {
      assert.equal(after.clubs[id]!.origin, "real");
      assert.match(after.clubs[id]!.crest!, /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/soccer\/500\/\d+\.png$/);
      assert.equal(next.get(id), "EL2");
    }
    assert.equal(Object.keys(after.clubs).length, 94, "92 in the pyramid, 2 in the National League");
    assert.equal(after.newClubs, 0, "no fictional clubs");
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
    // Up from the National League: the below-average default for a club without data.
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

  it("a generated season has a real league's home-and-away rhythm: no club plays three in a row at home or away", () => {
    let world = start();
    for (let i = 0; i < 3; i++) {
      world = startNextSeason(playSeason(world));
      for (const d of world.divisions) {
        assert.equal(d.calendar, 2);
        assert.equal(longestVenueRun(divisionState(world, d.code).fixtures), 2, `${world.year} ${d.code}`);
      }
    }
  });

  it("a season already being played on the first calendar keeps it (its scores stay with their games); one not yet played takes the new one", () => {
    const after = startNextSeason(playSeason(start()));
    // A save from before calendar 2: no calendar on its generated season.
    const old: World = { ...after, divisions: after.divisions.map(({ calendar: _c, ...d }) => d) };
    assert.ok(longestVenueRun(divisionState(old, "PL").fixtures) > 2, "the first calendar's long runs");
    // Nothing played yet: it takes calendar 2 when it loads.
    assert.deepEqual(upgradeWorld(old).divisions.map((d) => d.calendar), [2, 2, 2, 2]);
    // The Premier League already being played: it keeps its calendar, and the score stays with its game.
    const game = divisionState(old, "PL").fixtures.find((f) => f.matchday === 1)!;
    const playing = setScore(old, "PL", game, { home: 4, away: 4 });
    const loaded = upgradeWorld(playing);
    assert.deepEqual(loaded.divisions.map((d) => d.calendar), [undefined, 2, 2, 2]);
    const same = divisionState(loaded, "PL").fixtures.find((f) => f.id === game.id)!;
    assert.deepEqual([same.homeId, same.awayId], [game.homeId, game.awayId]);
    assert.deepEqual(divisionState(loaded, "PL").results[game.id], { home: 4, away: 4 });
    assert.equal(upgradeWorld(loaded), loaded, "nothing more to change");
    // The next season it plays is on calendar 2.
    assert.equal(playSeason(loaded).divisions[0]!.calendar, 2);
  });

  it("the National League: Boreham Wood and Harrogate Town come up after the first season, then each season's relegated clubs swap places with the last season's", () => {
    let world = start();
    assert.deepEqual(world.nationalLeague, [NATIONAL_LEAGUE_ID_BASE + 1, NATIONAL_LEAGUE_ID_BASE + 2], "a world starts with them in the National League");
    for (let i = 0; i < 4; i++) {
      const pool = world.nationalLeague;
      world = startNextSeason(playSeason(world));
      const season = world.history.at(-1)!;
      // Up: the clubs that spent the season in the National League; down there: League Two's relegated clubs.
      assert.deepEqual(season.in, pool);
      assert.deepEqual(world.nationalLeague, season.out);
      assert.deepEqual(world.divisions[3]!.clubs.filter((id) => pool.includes(id)).sort(), [...pool].sort(), "back in League Two");
      for (const id of season.out) assert.equal(clubDivision(world, id), undefined);
    }
    // Always the same 94 clubs: 92 in the Football League, 2 in the National League; no fictional ones.
    assert.equal(Object.keys(world.clubs).length, 94);
    assert.equal(world.newClubs, 0);
    assert.equal(world.divisions.flatMap((d) => d.clubs).length + world.nationalLeague.length, 94);
  });

  it("a club's path: each season's outcome (European places, the play-offs, a neutral place), and a season in the National League", () => {
    let world = startNextSeason(playSeason(start()));
    const year = world.history[0]!.year;
    // Every Premier League place has its outcome: the champions, the European places, the neutral zone, the relegated.
    const pl = savedTable(world, year, "PL")!.rows;
    const outcome = (id: number) => clubPath(world, id).find((s) => s.year === year)!.outcome;
    assert.equal(outcome(pl[0]!.clubId), "champions");
    for (const r of pl.slice(1, 4)) assert.equal(outcome(r.clubId), "championsLeague");
    assert.equal(outcome(pl[4]!.clubId), "europaLeague");
    assert.equal(outcome(pl[5]!.clubId), "conferenceLeague");
    for (const r of pl.slice(6, 17)) assert.equal(outcome(r.clubId), "neutral");
    for (const r of pl.slice(17)) assert.equal(outcome(r.clubId), "relegated");
    // Below: promoted, the play-offs' winners and losers, out of League Two.
    const el2 = savedTable(world, year, "EL2")!.rows;
    assert.deepEqual(el2.map((r) => outcome(r.clubId)).filter((o) => o !== "neutral").sort(), [
      ...Array(1).fill("champions"), ...Array(2).fill("promoted"), "out", "out", ...Array(3).fill("playoffs"), "playoffWinners",
    ].sort());
    // A League Two club that goes down: a season in the National League, then back up.
    const me = world.divisions[3]!.clubs[0]!;
    const hopeless = (w: World): World => ({ ...w, ratings: { ...w.ratings, [me]: [0.05, 9] } });
    world = startNextSeason(playSeason(hopeless(world)));
    assert.equal(clubDivision(world, me), undefined);
    assert.ok(world.nationalLeague.includes(me));
    world = startNextSeason(playSeason(world));
    assert.equal(clubDivision(world, me), "EL2", "back up after a season");
    const steps = clubPath(world, me).slice(-2);
    assert.deepEqual(steps.map((s) => [s.code, s.position, s.outcome]), [["EL2", 24, "out"], ["NL", null, "nationalLeague"]]);
  });

  it("a save from before the National League: last season's relegated clubs are in it now, or Boreham Wood and Harrogate Town in a first season", () => {
    const old = (w: World): World => {
      const { nationalLeague: _n, ...rest } = w;
      const clubs = { ...w.clubs };
      delete clubs[NATIONAL_LEAGUE_ID_BASE + 1];
      delete clubs[NATIONAL_LEAGUE_ID_BASE + 2];
      return { ...rest, clubs } as World;
    };
    const first = upgradeWorld(old(start()));
    assert.deepEqual(first.nationalLeague, [NATIONAL_LEAGUE_ID_BASE + 1, NATIONAL_LEAGUE_ID_BASE + 2]);
    assert.equal(first.clubs[NATIONAL_LEAGUE_ID_BASE + 1]!.name, "Boreham Wood");
    const later = startNextSeason(playSeason(start()));
    const upgraded = upgradeWorld({ ...old(later), clubs: later.clubs });
    assert.deepEqual(upgraded.nationalLeague, later.history.at(-1)!.out);
    assert.equal(upgradeWorld(upgraded), upgraded, "nothing more to change");
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
  /** Every league's rest of the season, as the page plays it: Simulate rest of season in each. */
  const playOut = (world: World, seed = 3) => ENGLAND.reduce((w, code, i) => simulateRest(w, code, createRng(seed + i)), world);

  it("games left: every league game and play-off game, counted down as they're played", () => {
    const world = startNextSeason(playSeason(start()));
    // A new season: 380 Premier League games; 552 in each EFL league, plus 7 play-off games in the Championship (eliminators too) and 5 below.
    assert.deepEqual(seasonStates(world).map(gamesLeft), [380, 552 + 7, 552 + 5, 552 + 5]);
    assert.equal(gamesLeft(divisionState(simulateMatchday(world, "PL", 1, createRng(1)), "PL")), 370);
    const elc = simulateRest(world, "ELC", createRng(2));
    assert.equal(gamesLeft(divisionState(elc, "ELC")), 0);
    // A level final still needs its shoot-out: one game left.
    const final = divisionState(elc, "ELC").bracket.at(-1)![0]!;
    let level = setScore(elc, "ELC", final.legs[0]!, { home: 1, away: 1 });
    level = setScore(level, "ELC", divisionState(level, "ELC").bracket.at(-1)![0]!.shootout!, null);
    assert.equal(gamesLeft(divisionState(level, "ELC")), 1);
    assert.equal(divisionState(level, "ELC").done, false);
  });

  it("every league played to the end by its own buttons, then the season finishes from those scores", () => {
    const world = playOut(start());
    assert.ok(seasonDone(world));
    assert.deepEqual(seasonStates(world).map(gamesLeft), [0, 0, 0, 0]);
    const tables = ENGLAND.map((code) => currentTable(world, code));
    const finals = seasonStates(world).map((s) => (s.bracket.length ? tieOutcome(s.bracket.at(-1)![0]!, s.picks)!.winner : null));
    const after = playSeason(world);
    assert.equal(after.review, true);
    // Nothing more is drawn: the saved tables are the ones played, and each final's winner went up.
    for (const [i, code] of ENGLAND.entries()) {
      const saved = savedTable(after, world.year, code)!;
      assert.deepEqual(saved.rows.map((r) => [r.clubId, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points]), tables[i]!.map((r) => [r.clubId, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.points]));
      if (finals[i] !== null) {
        assert.equal(saved.final![0], finals[i]);
        assert.equal(saved.rows.find((r) => r.clubId === finals[i])!.note, "W");
      }
    }
    assert.ok(after.divisions.every((d) => d.scores === undefined), "the next season starts with no scores");
    // The next season is set up (its games ready); the page shows it once it's started from the review.
    assert.deepEqual(seasonStates(after).map(gamesLeft), [380, 559, 557, 557]);
    assert.equal(startNextSeason(after).review, false);
  });

  it("a finished season keeps every result: its fixtures matchday by matchday and its play-off", () => {
    const world = playOut(start(), 11);
    const states = seasonStates(world);
    const after = playSeason(world);
    for (const state of states) {
      const past = pastDivision(after, world.year, state.code)!;
      assert.equal(past.fixtures!.length, state.fixtures.length, `${state.code}: every game`);
      const played = new Map(state.fixtures.map((f) => [`${f.matchday}-${f.homeId}-${f.awayId}`, state.results[f.id]]));
      for (const f of past.fixtures!) assert.deepEqual(f.result, played.get(`${f.matchday}-${f.homeId}-${f.awayId}`), `${state.code}: the same score`);
      assert.deepEqual(past.rows.map((r) => r.clubId), savedTable(after, world.year, state.code)!.rows.map((r) => r.clubId));
      if (!state.bracket.length) {
        assert.deepEqual(past.bracket, []);
        continue;
      }
      // The play-off as it was: every game with its score, the final's winner the saved one.
      const saved = savedTable(after, world.year, state.code)!.final!;
      const final = past.bracket.at(-1)![0]!;
      assert.equal(tieOutcome(final, {})!.winner, saved[0]);
      assert.ok(past.bracket.flat().every((tie) => tie.legs.length > 0 && tie.legs.every((leg) => leg.result)));
    }
    // The packed games are small: five characters a game.
    const record = after.history[0]!;
    assert.equal(record.divisions[0]!.games!.length, 380 * 5);
    // A season finished before results were kept: its table only.
    const old = { ...after, history: [{ ...record, divisions: record.divisions.map(({ games: _g, playoff: _p, ...rest }) => rest) }] };
    assert.equal(pastDivision(old, world.year, "PL")!.fixtures, null);
    assert.deepEqual(pastDivision(old, world.year, "ELC")!.bracket, []);
    assert.equal(pastDivision(after, world.year - 1, "PL"), undefined);
  });

  it(`keeps every result of the last ${FIXTURE_SEASONS} seasons; older ones keep their final tables`, () => {
    const once = playSeason(start());
    const record = once.history[0]!;
    // A long-running world: FIXTURE_SEASONS seasons with every result, then one more is finished.
    const long = { ...once, year: record.year + FIXTURE_SEASONS, history: Array.from({ length: FIXTURE_SEASONS }, (_, i) => ({ ...record, year: record.year + i })) };
    const after = playSeason(long);
    assert.equal(after.history.length, FIXTURE_SEASONS + 1);
    assert.equal(after.history[0]!.divisions[0]!.games, undefined, "the oldest keeps its table only");
    assert.equal(after.history[0]!.divisions[0]!.rows.length, 20);
    assert.ok(after.history.slice(1).every((s) => s.divisions.every((d) => typeof d.games === "string")));
  });

  it("picked scores stand when the rest of the season is played", () => {
    let world = start();
    const me = world.userClub;
    // The visitor's club wins every game it has left, 4–0.
    const mine = divisionState(world, "EL2").fixtures.filter((f) => !f.result && (f.homeId === me || f.awayId === me));
    for (const f of mine) world = setScore(world, "EL2", f, f.homeId === me ? { home: 4, away: 0 } : { home: 0, away: 4 });
    assert.equal(picked(world, "EL2"), mine.length);
    world = simulateRest(simulateRest(world, "EL2", createRng(5)), "PL", createRng(6));
    const after = playSeason(world);
    const row = savedTable(after, world.year, "EL2")!.rows.find((r) => r.clubId === me)!;
    const startRow = currentTable(start(), "EL2").find((r) => r.clubId === me)!;
    assert.equal(row.won, startRow.won + mine.length, "every picked win stands");
    assert.equal(row.goalsFor, startRow.goalsFor + 4 * mine.length);
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

  it("the dice make a likely roll, as on the league pages; Simulate matchday plays that matchday only", () => {
    let world = startNextSeason(playSeason(start()));
    world = simulateMatchday(world, "PL", 1, createRng(9));
    const state = divisionState(world, "PL");
    const first = state.fixtures.filter((f) => f.matchday === 1);
    assert.equal(Object.keys(state.picks).length, first.length);
    assert.ok(first.every((f) => state.picks[f.id]));
    // The dice: a likely score, another one each time.
    const game = state.fixtures.find((f) => f.matchday === 2)!;
    const once = rollScore(world, "PL", game, createRng(1));
    const twice = rollScore(once, "PL", game, createRng(1));
    const likely = likelyScoreSet(expectedGoals(state.model, game.homeId, game.awayId), state.model.rho ?? 0);
    for (const w of [once, twice]) {
      const score = divisionState(w, "PL").picks[game.id]!;
      assert.ok(likely.some((s) => s.home === score.home && s.away === score.away), "a likely score");
    }
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

  it("Simulate rest of season gives real-world tables season after season: no runaway champions, no hopeless bottom clubs", () => {
    // Fifteen seasons played the page's way: every league's rest of the season, then the next season.
    let world = start();
    const champions: number[] = [];
    const bottoms: number[] = [];
    for (let season = 0; season < 15; season++) {
      world = startNextSeason(playSeason(ENGLAND.reduce((w, code, i) => simulateRest(w, code, createRng(100 * season + i)), world)));
      const pl = world.history.at(-1)!.divisions[0]!.rows;
      champions.push(pl[0]![7]);
      bottoms.push(pl.at(-1)![7]);
      // The weakest club still wins some games; the champions still drop points.
      assert.ok(pl.at(-1)![2] >= 2, `${world.year - 1}: the bottom club won ${pl.at(-1)![2]}`);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Real Premier League seasons: champions on about 80–100 points, the bottom club on about 11–35.
    assert.ok(Math.max(...champions) <= 104 && mean(champions) >= 70 && mean(champions) <= 95, `champions: ${champions}`);
    assert.ok(Math.min(...bottoms) >= 8 && mean(bottoms) >= 18 && mean(bottoms) <= 38, `bottom clubs: ${bottoms}`);
    // No drift: the last five seasons no more lopsided than the first five.
    assert.ok(mean(champions.slice(-5)) - mean(bottoms.slice(-5)) <= mean(champions.slice(0, 5)) - mean(bottoms.slice(0, 5)) + 15, `${champions} / ${bottoms}`);
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

  it("games postponed in the real season: the fixtures open on the current matchday, and the postponed game counts as left", () => {
    const late = {
      ...pack,
      leagues: pack.leagues.map((l) => (l.code === "EL2" ? { ...l, games: l.games.map((g, i) => (i === 40 ? [g[0], g[1], g[2], g[3], null, null] as typeof g : g)) } : l)),
    };
    const world = createWorld(late, { league: "EL2", club: late.leagues[3]!.teams[0]!.id }, 7, NOW);
    const state = divisionState(world, "EL2");
    const postponed = state.fixtures.find((f) => !f.result && f.matchday < 19)!;
    assert.ok(postponed, "a game left from an early matchday");
    assert.equal(state.nextRound, 19, "the fixtures open on the real season's current matchday");
    assert.equal(gamesLeft(state), (46 - 18) * 12 + 1 + 5);
    // Simulating matchday 19 leaves it; the rest of the season plays it.
    assert.equal(divisionState(simulateMatchday(world, "EL2", 19, createRng(1)), "EL2").results[postponed.id], undefined);
    assert.ok(divisionState(simulateRest(world, "EL2", createRng(1)), "EL2").results[postponed.id]);
  });
});
