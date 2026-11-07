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
  divisionState,
  gamesLeft,
  playoffConfigOf,
  pyramidPlayoffOf,
  setScore,
  simulateRest,
  currentTable,
  divisionConfig,
  ENGLAND,
  FIXTURE_SEASONS,
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
  simulateMatchday,
  simulatePlayoffs,
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
const logQuality = (world: World, id: number) => Math.log(world.ratings[id]![0] / world.ratings[id]![1]);
/** The world with every club's rating and level k times as far from average, in log terms. */
const stretched = (world: World, k: number): World => {
  const scale = (r: Record<number, [number, number]>) => Object.fromEntries(Object.entries(r).map(([id, [a, d]]) => [id, [a ** k, d ** k] as [number, number]]));
  return { ...world, ratings: scale(world.ratings), levels: scale(world.levels) };
};
const logLevel = (world: World, id: number) => Math.log(world.levels[id]![0] / world.levels[id]![1]);
const correlation = (pairs: number[][]) => {
  const mean = (k: 0 | 1) => pairs.reduce((s, p) => s + p[k]!, 0) / pairs.length;
  const [mx, my] = [mean(0), mean(1)];
  const cov = pairs.reduce((s, p) => s + (p[0]! - mx) * (p[1]! - my), 0);
  const vx = pairs.reduce((s, p) => s + (p[0]! - mx) ** 2, 0);
  const vy = pairs.reduce((s, p) => s + (p[1]! - my) ** 2, 0);
  return cov / Math.sqrt(vx * vy);
};

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
    // Each club's level starts as its rating (its own copy).
    assert.deepEqual(world.levels, world.ratings);
    assert.notEqual(world.levels[1], world.ratings[1]);
    const { levels: _l, ...unlevelled } = world;
    assert.deepEqual(upgradeWorld(unlevelled as World).levels, world.ratings, "a world from before the levels starts them from the ratings");
    assert.equal(world.history.length, 0);
    assert.throws(() => createWorld(pack, { league: "PL", club: -1 }), /isn't in that league/);
    // The world's countries, as chosen at setup: the club's own by default, and always among them.
    assert.deepEqual(world.countries, ["ENG"]);
    assert.deepEqual(createWorld(pack, { league: "EL2", club: user.id, countries: ["ESP", "ENG"] }, 42).countries, ["ENG", "ESP"], "in the fixed order");
    assert.deepEqual(createWorld(pack, { league: "EL2", club: user.id, countries: ["ESP"] }, 42).countries, ["ENG", "ESP"], "the club's country comes along");
    const { countries: _c, ...before } = world;
    assert.deepEqual(upgradeWorld(before as World).countries, ["ENG"], "a world from before the choice is England's");
    assert.ok(Object.values(world.clubs).every((c) => c.country === "ENG"), "every club with its country");
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
    assert.equal(Object.keys(after.clubs).length, 126, "92 in the pyramid, 2 in the National League, 32 in the FA Cup's pool");
    assert.equal(after.newClubs, 0, "no fictional clubs");
    // The review's moves.
    const moves = seasonMoves(after, season);
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
    // Every club's level too, kept for the clubs that went down to the National League.
    for (const d of after.divisions) for (const id of d.clubs) assert.ok(after.levels[id], `${d.code}: ${id} has a level`);
    for (const id of season.out) assert.deepEqual(after.levels[id], start().levels[id], "a club that left keeps its level");
    // A season moves a club's level a little, never resets it: the levels after it stand in the order they stood before.
    const division = divisionOf(start());
    const pairs = after.divisions.flatMap((d) => d.clubs.filter((id) => division.get(id) === d.code).map((id) => [logLevel(start(), id), logLevel(after, id)]));
    assert.ok(correlation(pairs) > 0.9, `correlation ${correlation(pairs).toFixed(2)}`);
  });

  it("ten seasons on, the clubs still stand where they started: a club that keeps winning becomes a better club, and the top clubs stay top clubs", () => {
    // The three countries, their ratings stretched to a real spread (the sample's live ratings sit close to average).
    const first = stretched(createWorld(pack, { league: "EL2", club: pack.leagues[3]!.teams[0]!.id, countries: ["ENG", "ESP", "GER"] }, 7, NOW), 2);
    let world = first;
    const topClub = [...first.divisions[0]!.clubs].sort((a, b) => logQuality(first, b) - logQuality(first, a))[0]!;
    // The Premier League's best-rated club is made to win every game for three seasons: its level rises season after season.
    let level = logLevel(world, topClub);
    for (let i = 0; i < 3; i++) {
      world = startNextSeason(playSeason(unbeatable(world, topClub)));
      assert.ok(logLevel(world, topClub) > level, `season ${i + 1}: a better club`);
      level = logLevel(world, topClub);
    }
    for (let i = 3; i < 10; i++) world = startNextSeason(playSeason(world));
    // Ten seasons on, the clubs still in their first division stand in much the same order as they started (under the
    // real starting ratings' rule, 75% of the difference from average kept each season, next to nothing was left of it).
    const division = divisionOf(first);
    const pairs = world.divisions.flatMap((d) => d.clubs.filter((id) => division.get(id) === d.code).map((id) => [logLevel(first, id), logLevel(world, id)]));
    assert.ok(pairs.length > 80, `${pairs.length} clubs still in their first division`);
    assert.ok(correlation(pairs) > 0.6, `correlation ${correlation(pairs).toFixed(2)}`);
    // The three best-rated Premier League clubs at the start are still in it.
    const top3 = [...first.divisions[0]!.clubs].sort((a, b) => logQuality(first, b) - logQuality(first, a)).slice(0, 3);
    for (const id of top3) assert.equal(clubDivision(world, id), "PL", `${first.clubs[id]!.name} still in the Premier League`);
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
    // Always the same 126 clubs: 92 in the Football League, 2 in the National League, 32 in the FA Cup's pool; no fictional ones.
    assert.equal(Object.keys(world.clubs).length, 126);
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

describe("My World: Spain", () => {
  const NOW = new Date("2026-11-06T12:00:00Z");
  let world: World;
  let after: World;
  before(() => {
    const sd = pack.leagues.find((l) => l.code === "SD")!;
    world = createWorld(pack, { league: "SD", club: sd.teams[3]!.id, countries: ["ENG", "ESP"] }, 11, NOW);
    after = playSeason(world);
  });

  it("moves the clubs Spain's configs say: 3 between La Liga and the Segunda División (two up, the play-off winner), 4 out of the Segunda", () => {
    assert.deepEqual(movementCounts("ESP"), [
      { up: 0, down: 3 },
      { up: 3, down: 4 },
    ]);
  });

  it("a world with England and Spain plays both pyramids and the three cups, every club with its country; Spain's Primera Federación starts empty", () => {
    assert.deepEqual(world.countries, ["ENG", "ESP"]);
    assert.deepEqual(world.divisions.map((d) => d.code), ["PL", "ELC", "EL1", "EL2", "PD", "SD"]);
    assert.deepEqual(world.divisions.map((d) => d.clubs.length), [20, 24, 24, 24, 20, 22]);
    assert.deepEqual(world.cups.map((c) => c.code), ["FAC", "EFC", "CDR"]);
    assert.equal(clubDivision(world, world.userClub), "SD");
    // The Copa del Rey's lower sides: its clubs in no league (the sample data reuses two Segunda ids among them, which stand for the league clubs).
    const cdrData = pack.cups.find((c) => c.code === "CDR")!;
    const leagueIds = new Set(pack.leagues.filter((l) => l.code === "PD" || l.code === "SD").flatMap((l) => l.teams.map((t) => t.id)));
    const lowerSides = cdrData.teams.filter((t) => !cdrData.divisions[t.id] && !leagueIds.has(t.id)).length;
    assert.ok(lowerSides >= 84, `${lowerSides} lower sides, enough for the cup`);
    const spanish = Object.values(world.clubs).filter((c) => c.country === "ESP");
    assert.equal(spanish.length, 42 + lowerSides, "the two leagues' clubs and the real Copa del Rey's lower sides");
    assert.ok(world.nationalLeague.every((id) => world.clubs[id]!.country === "ENG"), "only England's National League clubs below the leagues");
    assert.equal(world.cupPool.filter((id) => world.clubs[id]!.country === "ESP").length, lowerSides);
    assert.equal(world.cupPool.filter((id) => world.clubs[id]!.country === "ENG").length, 32, "the EFL Cup brings none");
    // The Copa del Rey drawn among Spain's clubs: the lower sides and the Segunda in the opening rounds, La Liga's strongest four in the round of 32.
    const cdr = world.cups.find((c) => c.code === "CDR")!;
    const where = (id: number) => clubDivision(world, id) ?? "lower";
    const count = (ids: readonly number[]) => ids.reduce<Record<string, number>>((m, id) => ({ ...m, [where(id)]: (m[where(id)] ?? 0) + 1 }), {});
    assert.deepEqual(count(cdr.entrants.qualifyingRound!), { lower: 20 });
    assert.deepEqual(count(cdr.entrants.firstRound!), { lower: 64, SD: 22, PD: 16 });
    assert.deepEqual(count(cdr.entrants.roundOf32!), { PD: 4 });
    assert.ok(cdr.entrants.firstRound!.every((id) => !cdr.entrants.qualifyingRound!.includes(id)), "no club twice");
  });

  it("plays a season of both countries: each pyramid moves on its own, and the Segunda's four relegated clubs swap with Copa del Rey sides from the pool the first time", () => {
    const season = after.history[0]!;
    assert.deepEqual(season.divisions.map((d) => d.code), ["PL", "ELC", "EL1", "EL2", "PD", "SD"]);
    const notesOf = (code: DivisionCode) => season.divisions.find((d) => d.code === code)!.rows.map((r) => r[8]);
    assert.equal(count(notesOf("PD"), "R"), 3);
    assert.equal(count(notesOf("SD"), "C", "P", "W"), 3, "two up and the play-off winner");
    assert.equal(count(notesOf("SD"), "R"), 4);
    assert.equal(count(notesOf("EL2"), "R"), 2);
    // Out of the Segunda: into the Primera Federación; in: four real clubs from the Copa del Rey's lower sides, the pool four smaller.
    const outEsp = season.out.filter((id) => after.clubs[id]!.country === "ESP");
    const inEsp = season.in.filter((id) => after.clubs[id]!.country === "ESP");
    assert.equal(outEsp.length, 4);
    assert.equal(inEsp.length, 4);
    assert.ok(inEsp.every((id) => after.clubs[id]!.origin === "real" && world.cupPool.includes(id)), "real Copa del Rey sides");
    assert.equal(after.cupPool.filter((id) => after.clubs[id]!.country === "ESP").length, world.cupPool.filter((id) => world.clubs[id]!.country === "ESP").length - 4);
    assert.deepEqual(after.nationalLeague.filter((id) => after.clubs[id]!.country === "ESP"), outEsp, "the relegated wait in the Primera Federación");
    assert.deepEqual(after.nationalLeague.filter((id) => after.clubs[id]!.country === "ENG"), season.out.filter((id) => after.clubs[id]!.country === "ENG"));
    assert.equal(after.newClubs, 0, "no fictional clubs");
    const sd = after.divisions.find((d) => d.code === "SD")!;
    assert.equal(sd.clubs.length, 22);
    assert.ok(inEsp.every((id) => sd.clubs.includes(id)), "up into the Segunda");
    assert.ok(outEsp.every((id) => !after.divisions.some((d) => d.clubs.includes(id))));
    // The season's cups: all three, with their finals.
    assert.deepEqual(season.cups!.map((c) => c.code), ["FAC", "EFC", "CDR"]);
    assert.ok(season.cups!.every((c) => after.clubs[c.final[0]]));
    assert.equal(after.clubs[season.cups![2]!.final[0]]!.country, "ESP");
    // The review's moves, country by country.
    const moves = seasonMoves(after, season);
    assert.deepEqual(moves.map((m) => [m.upper, m.lower, m.up.length, m.down.length]), [
      ["PL", "ELC", 3, 3],
      ["ELC", "EL1", 3, 3],
      ["EL1", "EL2", 4, 4],
      ["EL2", null, 2, 2],
      ["PD", "SD", 3, 3],
      ["SD", null, 4, 4],
    ]);
    // Next season's Copa del Rey: the relegated four and the pool's in the qualifying and first rounds.
    const cdr = after.cups.find((c) => c.code === "CDR")!;
    const lower = [...cdr.entrants.qualifyingRound!, ...cdr.entrants.firstRound!].filter((id) => !after.divisions.some((d) => d.clubs.includes(id)));
    assert.equal(lower.length, 84);
    assert.ok(outEsp.every((id) => lower.includes(id)), "the Primera Federación's clubs are in");
  });

  it("a reserve side is never promoted or in the play-off: its place passes down", () => {
    const sd = pack.leagues.find((l) => l.code === "SD")!;
    const reserves = sd.teams.filter((t) => divisionConfig("SD").reserveTeams!.some((start) => t.name.startsWith(start)));
    assert.ok(reserves.length >= 1, "the sample Segunda has reserve sides");
    // A reserve side that wins every game tops the table but goes nowhere: the champions' promotion passes to the next club.
    // (Unbeatable through the first season too, so it's still in the Segunda for a full season of its own calendar.)
    const id = world.divisions.find((d) => d.code === "SD")!.clubs.find((c) => world.clubs[c]!.realId === reserves[0]!.id)!;
    const unbeatable = (w: World) => ({ ...w, ratings: { ...w.ratings, [id]: [8, 0.1] as [number, number] } });
    const first = playSeason(unbeatable(world));
    assert.equal(first.history[0]!.divisions.find((d) => d.code === "SD")!.rows.find((r) => r[0] === id)![8], "", "never promoted");
    const strong = playSeason(startNextSeason(unbeatable(first)));
    const table = strong.history[1]!.divisions.find((d) => d.code === "SD")!;
    assert.equal(table.rows[0]![0], id, "top of the table");
    assert.equal(table.rows[0]![8], "", "no promotion for a reserve side");
    assert.equal(table.rows[1]![8], "C", "the club below takes the champions' place");
    assert.equal(count(table.rows.map((r) => r[8]), "C", "P", "W"), 3);
    assert.ok(!strong.divisions.find((d) => d.code === "PD")!.clubs.includes(id));
    assert.ok(strong.divisions.find((d) => d.code === "SD")!.clubs.includes(id), "stays in the Segunda");
  });

  it("a Spanish club's path: relegated into the Primera Federación, a season there, then back up", () => {
    const season = after.history[0]!;
    const down = season.out.filter((id) => after.clubs[id]!.country === "ESP")[0]!;
    assert.deepEqual(clubPath(after, down).map((s) => [s.code, s.move, s.outcome]), [["SD", "down", "out"]]);
    const later = playSeason(startNextSeason(after));
    assert.deepEqual(clubPath(later, down).map((s) => [s.code, s.move, s.outcome]), [["SD", "down", "out"], ["PF", "up", "nationalLeague"]]);
    assert.equal(clubDivision(later, down), "SD");
  });

  it("a world of Spain alone", () => {
    const pd = pack.leagues.find((l) => l.code === "PD")!;
    const spain = createWorld(pack, { league: "PD", club: pd.teams[0]!.id, countries: ["ESP"] }, 5, NOW);
    assert.deepEqual(spain.countries, ["ESP"]);
    assert.deepEqual(spain.divisions.map((d) => d.code), ["PD", "SD"]);
    assert.deepEqual(spain.cups.map((c) => c.code), ["CDR"]);
    assert.deepEqual(spain.nationalLeague, []);
    assert.ok(Object.values(spain.clubs).every((c) => c.country === "ESP"));
    const played = playSeason(spain);
    assert.equal(played.history[0]!.divisions.length, 2);
    assert.equal(played.nationalLeague.length, 4);
  });
});

describe("My World: Germany", () => {
  const NOW = new Date("2026-11-06T12:00:00Z");
  let world: World;
  let after: World;
  before(() => {
    const bl2 = pack.leagues.find((l) => l.code === "BL2")!;
    world = createWorld(pack, { league: "BL2", club: bl2.teams[2]!.id, countries: ["GER"] }, 21, NOW);
    after = playSeason(world);
  });

  it("moves two clubs each way between the Bundesliga and the 2. Bundesliga, the pyramid play-off (16th v 3rd) adding one to both or neither; two out of the 2. Bundesliga", () => {
    assert.deepEqual(movementCounts("GER"), [
      { up: 0, down: 2 },
      { up: 3, down: 2 },
    ]);
    assert.deepEqual(pyramidPlayoffOf("BL2"), { upper: "BL1", lower: "BL2", upperPlace: 16, lowerPlace: 3 });
    assert.equal(pyramidPlayoffOf("BL1"), pyramidPlayoffOf("BL2"));
    assert.equal(pyramidPlayoffOf("SD"), undefined);
    const config = playoffConfigOf("BL2")!;
    assert.deepEqual(config.rounds.map((r) => [r.key, r.legs, r.levelTie, r.pairs]), [["final", 2, "penalties", [[16, 3]]]]);
    assert.equal(config.promotedTo, "Bundesliga");
    assert.deepEqual(config.directPromotion, [1, 2]);
    assert.equal(playoffConfigOf("BL1"), undefined);
  });

  it("a world of Germany alone: the two leagues and the DFB-Pokal, the real cup's 28 lower sides in the pool, the 3. Liga empty to begin with", () => {
    assert.deepEqual(world.countries, ["GER"]);
    assert.deepEqual(world.divisions.map((d) => [d.code, d.clubs.length]), [["BL1", 18], ["BL2", 18]]);
    assert.deepEqual(world.cups.map((c) => c.code), ["DFB"]);
    assert.deepEqual(world.nationalLeague, []);
    assert.ok(Object.values(world.clubs).every((c) => c.country === "GER"));
    assert.equal(world.cupPool.length, 28);
    const dfb = world.cups[0]!;
    assert.deepEqual(Object.keys(dfb.entrants), ["firstRound"]);
    assert.equal(dfb.entrants.firstRound!.length, 64, "every club in the first round: the 36 league clubs and the 28 lower sides");
  });

  it("the 2. Bundesliga's play-off is the tie with the Bundesliga's 16th: two legs, the Bundesliga club hosting the first, its clubs known once both leagues are complete, its games counted in the 2. Bundesliga's", () => {
    const bl2 = divisionState(world, "BL2");
    assert.ok(bl2.playoff, "a play-off, though the league config has none");
    assert.equal(bl2.playoffKnown, false);
    assert.equal(divisionState(world, "BL1").playoff, undefined);
    assert.equal(gamesLeft(bl2), bl2.fixtures.filter((f) => !bl2.results[f.id]).length + 2, "the tie's two legs");
    // The 2. Bundesliga played out: its tie waits for the Bundesliga.
    const lowerDone = simulateRest(world, "BL2", createRng(1));
    const waiting = divisionState(lowerDone, "BL2");
    assert.equal(waiting.leagueComplete, true);
    assert.equal(waiting.playoffKnown, false);
    assert.equal(waiting.done, false);
    assert.equal(gamesLeft(waiting), 2);
    assert.equal(waiting.bracket[0]![0]!.legs.length, 0, "no clubs yet");
    // The Bundesliga played out too: the tie's clubs known, the 16th hosting the first leg; Simulate rest on the 2. Bundesliga then plays it.
    const bothDone = simulateRest(lowerDone, "BL1", createRng(2));
    const known = divisionState(bothDone, "BL2");
    assert.equal(known.playoffKnown, true);
    assert.equal(known.done, false);
    const tie = known.bracket[0]![0]!;
    const upper16 = divisionState(bothDone, "BL1").rows.find((r) => r.position === 16)!.teamId;
    const lower3 = known.eligibleRows.find((r) => r.position === 3)!.teamId;
    assert.deepEqual([tie.lower.teamId, tie.higher.teamId], [upper16, lower3]);
    assert.equal(tie.legs.length, 2);
    assert.equal(tie.legs[0]!.homeId, upper16, "first leg at the Bundesliga club");
    assert.equal(tie.legs[1]!.homeId, lower3, "second leg at the 2. Bundesliga club");
    assert.ok(known.model.strengths.has(upper16), "the Bundesliga club rated on the 2. Bundesliga's scale");
    const played = simulateRest(bothDone, "BL2", createRng(3));
    const finished = divisionState(played, "BL2");
    assert.equal(finished.done, true);
    assert.equal(gamesLeft(finished), 0);
    assert.equal(seasonDone(played), true, "both leagues and the tie decided (the cup is counted apart, by cupsDone)");
    // A Bundesliga result that changes its 16th clears the tie's scores (they belonged to another pairing).
    const bl1 = divisionState(played, "BL1");
    const sixteenth = bl1.rows.find((r) => r.position === 16)!;
    const seventeenth = bl1.rows.find((r) => r.position === 17)!;
    const swing = bl1.fixtures.find((f) => f.homeId === seventeenth.teamId && f.awayId === sixteenth.teamId) ?? bl1.fixtures.find((f) => f.awayId === seventeenth.teamId && f.homeId === sixteenth.teamId)!;
    const changed = setScore(played, "BL1", swing, swing.homeId === seventeenth.teamId ? { home: 9, away: 0 } : { home: 0, away: 9 });
    const afterChange = divisionState(changed, "BL2");
    if (afterChange.bracket[0]![0]!.lower.teamId !== upper16) {
      assert.equal(Object.keys(afterChange.picks).some((id) => Number(id) >= 2_000_000_000), false, "the tie's scores went with its pairing");
      assert.equal(afterChange.done, false);
    }
  });

  it("playSeason settles the tie for both tables: the 2. Bundesliga's 3rd goes up or the Bundesliga's 16th goes down, and the leagues still match", () => {
    const season = after.history[0]!;
    const bl1 = season.divisions.find((d) => d.code === "BL1")!;
    const bl2 = season.divisions.find((d) => d.code === "BL2")!;
    const notes = (rows: typeof bl1.rows) => rows.map((r) => r[8]);
    const won = bl2.rows[2]![8] === "W";
    assert.ok(won || bl2.rows[2]![8] === "O", "the 3rd was in the play-off");
    assert.equal(bl1.rows[15]![8], won ? "R" : "", "the 16th goes down only if it lost the tie");
    assert.equal(count(notes(bl1.rows), "R"), won ? 3 : 2);
    assert.equal(count(notes(bl2.rows), "C", "P", "W"), won ? 3 : 2);
    assert.equal(count(notes(bl2.rows), "R"), 2, "17th and 18th down to the 3. Liga");
    assert.ok(bl2.final, "the tie's result saved as the 2. Bundesliga's play-off final");
    assert.ok([bl1.rows[15]![0], bl2.rows[2]![0]].includes(bl2.final![0]) && [bl1.rows[15]![0], bl2.rows[2]![0]].includes(bl2.final![1]));
    assert.equal(bl1.final, undefined);
    // Next season's divisions: the right size, the winner in the Bundesliga.
    assert.deepEqual(after.divisions.map((d) => d.clubs.length), [18, 18]);
    assert.ok(after.divisions[0]!.clubs.includes(bl2.final![0]), "the tie's winner in the Bundesliga");
    assert.ok(after.divisions[1]!.clubs.includes(bl2.final![1]), "the loser in the 2. Bundesliga");
    // Out of the 2. Bundesliga: into the 3. Liga; in: two real DFB-Pokal sides from the pool.
    assert.equal(season.out.length, 2);
    assert.equal(season.in.length, 2);
    assert.ok(season.in.every((id) => after.clubs[id]!.origin === "real" && world.cupPool.includes(id)));
    assert.equal(after.cupPool.length, 26);
    assert.deepEqual(after.nationalLeague, season.out);
    assert.deepEqual(seasonMoves(after, season).map((m) => [m.upper, m.lower, m.up.length, m.down.length]), [
      ["BL1", "BL2", won ? 3 : 2, won ? 3 : 2],
      ["BL2", null, 2, 2],
    ]);
    // The past season's 2. Bundesliga shows the tie as its play-off, both legs scored.
    const past = pastDivision(after, season.year, "BL2")!;
    assert.equal(past.bracket.length, 1);
    assert.equal(past.bracket[0]!.length, 1);
    const tie = past.bracket[0]![0]!;
    assert.equal(tie.legs.length, 2);
    assert.ok(tie.legs.every((leg) => leg.result));
    assert.equal(tieOutcome(tie, {})?.winner, bl2.final![0]);
    assert.equal(pastDivision(after, season.year, "BL1")!.bracket.length, 0);
    // The club's path: the loser from the Bundesliga is "relegated", the winner from the 2. Bundesliga "play-off winners".
    const winnerPath = clubPath(after, bl2.final![0]).at(-1)!;
    assert.equal(winnerPath.outcome, won ? "playoffWinners" : "neutral");
    assert.equal(clubPath(after, bl2.final![1]).at(-1)!.outcome, won ? "relegated" : "playoffs");
    assert.deepEqual(cupStatesCodes(after), ["DFB"]);
  });

  it("every country together: three pyramids, four cups", () => {
    const all = createWorld(pack, { league: "PL", club: pack.leagues[0]!.teams[0]!.id, countries: ["ENG", "ESP", "GER"] }, 4, NOW);
    assert.deepEqual(all.divisions.map((d) => d.code), ["PL", "ELC", "EL1", "EL2", "PD", "SD", "BL1", "BL2"]);
    assert.deepEqual(all.cups.map((c) => c.code), ["FAC", "EFC", "CDR", "DFB"]);
    const played = playSeason(all);
    assert.equal(played.history[0]!.divisions.length, 8);
    assert.equal(played.history[0]!.cups!.length, 4);
    assert.deepEqual(played.divisions.map((d) => d.clubs.length), [20, 24, 24, 24, 20, 22, 18, 18]);
  });
});

const cupStatesCodes = (w: World) => w.cups.map((c) => c.code);
