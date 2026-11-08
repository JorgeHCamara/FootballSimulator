import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CUPS, type CupConfig } from "../config/cups.ts";
import { calendarSlug, eventRound, groupLegs } from "../lib/cupData.ts";
import { espnFixtures, type EspnCalendarEntry, type EspnEvent } from "../lib/espn.ts";
import { sampleCup } from "../lib/sampleLeague.ts";
import { buildCup, clubsAlive, cupGameId, cupSecondLegId, cupShootoutId, cupWinner, drawRoundRandom, iterationRng, levelTieRule, needsShootout, simulateCup, tieAggregate, tieWinner, type RealCupTie } from "./cup.ts";
import { cupModelFor } from "./cupModel.ts";
import { runCupMonteCarlo } from "./cupMontecarlo.ts";
import type { LeagueModel } from "./ratings.ts";
import { createRng } from "./rng.ts";
import type { Fixture, ResultMap, TeamId } from "./types.ts";

/*
 * The EFL Cup (Carabao Cup) 2026/27: no extra time before the final, two-legged
 * semi-finals on aggregate then penalties, a neutral final at Wembley, and the
 * quarter-final draw simulated (afresh in every run) until ESPN publishes it.
 */

const efc = CUPS.find((c) => c.code === "EFC")!;
const faCup = CUPS.find((c) => c.code === "FAC")!;

// ESPN's 2026/27 calendar (site API scoreboard, leagues[0].calendar[0].entries).
const CALENDAR: EspnCalendarEntry[] = [
  { label: "Preliminary Round", startDate: "2026-06-01T07:00Z", endDate: "2026-08-04T06:59Z" },
  { label: "First Round", startDate: "2026-08-04T07:00Z", endDate: "2026-08-18T06:59Z" },
  { label: "Second Round", startDate: "2026-08-18T07:00Z", endDate: "2026-09-01T06:59Z" },
  { label: "Third Round", startDate: "2026-09-01T07:00Z", endDate: "2026-09-29T06:59Z" },
  { label: "Fourth Round", startDate: "2026-09-29T07:00Z", endDate: "2026-11-03T07:59Z" },
  { label: "Quarterfinals", startDate: "2026-11-03T08:00Z", endDate: "2026-12-29T07:59Z" },
  { label: "Semifinals", startDate: "2026-12-29T08:00Z", endDate: "2027-02-09T07:59Z" },
  { label: "Final", startDate: "2027-02-09T08:00Z", endDate: "2027-06-01T06:59Z" },
];

// The fourth round as ESPN reports it (27–29 October 2026), club ids as the feed's.
const CLUBS = {
  bradford: 405, peterborough: 2650, fleetwood: 3700, arsenal: 359, city: 382, brighton: 331, bournemouth: 349, villa: 362,
  fulham: 370, palace: 384, sunderland: 366, brentford: 337, liverpool: 364, chelsea: 363, everton: 368, newcastle: 361,
} satisfies Record<string, TeamId>;
type Tie = { id: number; home: TeamId; away: TeamId; score: [number, number]; pens?: [number, number] };
const FOURTH_ROUND: Tie[] = [
  { id: 401921830, home: CLUBS.everton, away: CLUBS.newcastle, score: [3, 1] },
  { id: 401921834, home: CLUBS.city, away: CLUBS.brighton, score: [2, 2], pens: [4, 3] },
  { id: 401921835, home: CLUBS.bradford, away: CLUBS.peterborough, score: [2, 0] },
  { id: 401921836, home: CLUBS.fleetwood, away: CLUBS.arsenal, score: [1, 1], pens: [5, 3] },
  { id: 401921840, home: CLUBS.bournemouth, away: CLUBS.villa, score: [3, 0] },
  { id: 401921841, home: CLUBS.fulham, away: CLUBS.palace, score: [0, 1] },
  { id: 401921842, home: CLUBS.liverpool, away: CLUBS.chelsea, score: [1, 1], pens: [6, 5] },
  { id: 401921843, home: CLUBS.sunderland, away: CLUBS.brentford, score: [3, 2] },
];
const WINNERS: TeamId[] = [CLUBS.everton, CLUBS.city, CLUBS.bradford, CLUBS.fleetwood, CLUBS.bournemouth, CLUBS.palace, CLUBS.liverpool, CLUBS.sunderland];
const ROUND_FOURTH = 4;
const ROUND = { fourth: ROUND_FOURTH, quarter: 5, semi: 6, final: 7 };

const fixtureOf = (t: Tie, date = "2026-10-28T19:45Z"): Fixture => ({
  id: t.id,
  matchday: 1,
  utcDate: date,
  homeId: t.home,
  awayId: t.away,
  result: { home: t.score[0], away: t.score[1] },
  ...(t.pens ? { penalties: { home: t.pens[0], away: t.pens[1] } } : {}),
});
/** The rounds before (decided, synthetic clubs 10000+): the engine stops at the first round still pending, as the real feed never has one before the latest round. */
const earlierRounds: RealCupTie[] = efc.rounds.slice(0, ROUND_FOURTH).flatMap((round, r) =>
  Array.from({ length: round.ties }, (_, t): RealCupTie => {
    const home = 10_000 + r * 1000 + t * 2;
    return { round: round.key, homeId: home, awayId: home + 1, legs: [fixtureOf({ id: 300_000 + r * 1000 + t, home, away: home + 1, score: [1, 0] }, `2026-08-${String(1 + r * 7).padStart(2, "0")}T15:00Z`)] };
  }),
);
const realFourth: RealCupTie[] = [...earlierRounds, ...FOURTH_ROUND.map((t): RealCupTie => ({ round: "fourthRound", homeId: t.home, awayId: t.away, legs: [fixtureOf(t)] }))];
/** ESPN's published quarter-final draw (unplayed). */
const QUARTER_DRAW: [TeamId, TeamId][] = [
  [CLUBS.city, CLUBS.liverpool],
  [CLUBS.everton, CLUBS.bradford],
  [CLUBS.fleetwood, CLUBS.bournemouth],
  [CLUBS.palace, CLUBS.sunderland],
];
const realQuarters: RealCupTie[] = QUARTER_DRAW.map(([home, away], i) => ({ round: "quarterFinals", homeId: home, awayId: away, legs: [{ id: 401950000 + i, matchday: 1, utcDate: "2026-12-16T20:00Z", homeId: home, awayId: away, result: null }] }));
const options = { entrants: {}, drawSalt: 0, roundDates: { quarterFinals: "2026-12-16T20:00:00Z", semiFinals: "2027-01-13T20:00:00Z", final: "2027-03-14T16:30:00Z" } };
const model: LeagueModel = { avgHomeGoals: 1.5, avgAwayGoals: 1.2, strengths: new Map() };
const strengths = Object.fromEntries(Object.values(CLUBS).map((id) => [id, { attack: 1, defence: 1 }]));

const espnEvent = (t: Tie, { slug, date = "2026-10-28T19:45Z" }: { slug?: string; date?: string } = {}): EspnEvent => ({
  id: String(t.id),
  date,
  season: { year: 2026, ...(slug ? { slug } : {}) },
  status: { type: { name: t.pens ? "STATUS_FINAL_PEN" : "STATUS_FULL_TIME", state: "post", completed: true } },
  competitions: [
    {
      competitors: [
        { homeAway: "home", score: String(t.score[0]), ...(t.pens ? { shootoutScore: t.pens[0] } : {}), team: { id: String(t.home), displayName: `Club ${t.home}` } },
        { homeAway: "away", score: String(t.score[1]), ...(t.pens ? { shootoutScore: t.pens[1] } : {}), team: { id: String(t.away), displayName: `Club ${t.away}` } },
      ],
    },
  ],
});

describe("EFL Cup: the competition", () => {
  it("is registered under England with its rounds, two-legged semi-finals and a neutral final at Wembley", () => {
    assert.equal(efc.slug, "efl-cup");
    assert.equal(efc.country, "England");
    assert.equal(efc.espn.slug, "eng.league_cup");
    assert.deepEqual(efc.rounds.map((r) => [r.key, r.ties]), [["preliminaryRound", 2], ["firstRound", 35], ["secondRound", 23], ["thirdRound", 16], ["fourthRound", 8], ["quarterFinals", 4], ["semiFinals", 2], ["final", 1]]);
    assert.deepEqual(efc.rounds.map((r) => r.legs ?? 1), [1, 1, 1, 1, 1, 1, 2, 1]);
    const final = efc.rounds.at(-1)!;
    assert.deepEqual([final.neutral, final.venue], [true, "Wembley"]);
    assert.deepEqual(efc.feederLeagues, ["PL", "ELC", "EL1", "EL2"]);
    assert.equal(efc.aka.en, "Carabao Cup");
    assert.equal(efc.aka.pt, "Copa da Liga Inglesa, Carabao Cup");
    assert.equal(efc.aka.es, "Copa de la Liga de Inglaterra, Carabao Cup");
  });

  it("no extra time in any round but the final (the Coupe de France too; the Copa Argentina has none at all); the cups before say nothing and keep their behaviour", () => {
    assert.deepEqual(
      efc.rounds.map((r) => levelTieRule(r)),
      ["penalties", "penalties", "penalties", "penalties", "penalties", "penalties", "penalties", "extraTime"],
    );
    const cdf = CUPS.find((c) => c.code === "CDF")!;
    assert.deepEqual(cdf.rounds.map((r) => levelTieRule(r)), [...Array(7).fill("penalties"), "extraTime"]);
    // The Copa Argentina: straight to penalties in every round, the final too.
    const car = CUPS.find((c) => c.code === "CAR")!;
    assert.deepEqual(car.rounds.map((r) => levelTieRule(r)), Array(6).fill("penalties"));
    for (const cup of CUPS.filter((c) => !["EFC", "CDF", "CAR"].includes(c.code))) {
      assert.ok(cup.rounds.every((r) => r.noExtraTime === undefined && levelTieRule(r) === undefined), `${cup.code}: no rule shown, as before`);
    }
    // Either way the engine decides a level tie on penalties: the flag only changes the rule shown.
    const results = simulateCup(efc, [...realFourth, ...realQuarters], {}, model, createRng(5), options);
    const final = buildCup(efc, [...realFourth, ...realQuarters], results, options)[ROUND.final]!;
    assert.equal(final.config.noExtraTime, false);
    assert.equal(final.ties[0]!.game.neutral, true);
    assert.equal(tieWinner(final.ties[0]!, results) !== null, true, "decided: by the score, or on penalties when level");
  });
});

describe("EFL Cup: ESPN's rounds and shoot-outs", () => {
  it("maps an event to its round by its season slug, else by the calendar window its kick-off falls in", () => {
    const city = FOURTH_ROUND[1]!;
    assert.equal(eventRound(espnEvent(city, { slug: "fourth-round" }), efc.rounds, CALENDAR)?.key, "fourthRound");
    assert.equal(eventRound(espnEvent(city, { slug: "quarterfinals" }), efc.rounds, CALENDAR)?.key, "quarterFinals", "the slug wins over the date");
    assert.equal(eventRound(espnEvent(city), efc.rounds, CALENDAR)?.key, "fourthRound", "28 October: the Fourth Round window");
    assert.equal(eventRound(espnEvent(city, { date: "2026-12-16T20:00Z" }), efc.rounds, CALENDAR)?.key, "quarterFinals");
    assert.equal(eventRound(espnEvent(city, { date: "2027-01-13T20:00Z" }), efc.rounds, CALENDAR)?.key, "semiFinals");
    assert.equal(eventRound(espnEvent(city, { date: "2027-03-14T16:30Z" }), efc.rounds, CALENDAR)?.key, "final");
    assert.equal(eventRound(espnEvent(city, { date: "2026-08-02T14:00Z" }), efc.rounds, CALENDAR)?.key, "preliminaryRound");
    assert.equal(eventRound(espnEvent(city), efc.rounds), undefined, "no slug and no calendar: unknown");
    assert.equal(eventRound(espnEvent(city, { slug: "replay" }), efc.rounds, CALENDAR), undefined);
    assert.equal(calendarSlug("Rd of 16"), "round-of-16");
    assert.equal(calendarSlug("Quarterfinals"), "quarterfinals");
  });

  it("a shoot-out from the feed decides a level tie: Manchester City 2-2 Brighton, City win 4-3 on penalties", () => {
    const city = FOURTH_ROUND[1]!;
    const [fixture] = espnFixtures([espnEvent(city, { slug: "fourth-round" })]);
    assert.deepEqual(fixture!.result, { home: 2, away: 2 });
    assert.deepEqual(fixture!.penalties, { home: 4, away: 3 });
    const real: RealCupTie[] = [{ round: "fourthRound", homeId: city.home, awayId: city.away, legs: [fixture!] }];
    const tie = buildCup(efc, real, {}, options)[ROUND.fourth]!.ties[0]!;
    assert.equal(needsShootout(tie, {}), true);
    assert.equal(tieWinner(tie, {}), CLUBS.city);
    // Bradford City 0-0 Burnley, Bradford win 4-2 on penalties.
    const burnley = 379;
    const bradford: RealCupTie = { round: "fourthRound", homeId: CLUBS.bradford, awayId: burnley, legs: [fixtureOf({ id: 401921999, home: CLUBS.bradford, away: burnley, score: [0, 0], pens: [4, 2] })] };
    assert.equal(tieWinner(buildCup(efc, [bradford], {}, options)[ROUND.fourth]!.ties[0]!, {}), CLUBS.bradford);
    // The away club winning the shoot-out: Fleetwood 1-1 Arsenal was 5-3 to the home side; 3-5 would send Arsenal through.
    const fleetwood = FOURTH_ROUND[3]!;
    const awayWins: RealCupTie = { round: "fourthRound", homeId: fleetwood.home, awayId: fleetwood.away, legs: [fixtureOf({ ...fleetwood, pens: [3, 5] })] };
    assert.equal(tieWinner(buildCup(efc, [awayWins], {}, options)[ROUND.fourth]!.ties[0]!, {}), CLUBS.arsenal);
  });

  it("groups the two legs of a semi-final into one tie, in date order", () => {
    const first: Fixture = { id: 1, matchday: 1, utcDate: "2027-01-13T20:00Z", homeId: CLUBS.city, awayId: CLUBS.liverpool, result: { home: 1, away: 0 } };
    const second: Fixture = { id: 2, matchday: 1, utcDate: "2027-02-03T20:00Z", homeId: CLUBS.liverpool, awayId: CLUBS.city, result: null };
    assert.deepEqual(groupLegs([second, first]).map((legs) => legs.map((l) => l.id)), [[1, 2]]);
  });
});

describe("EFL Cup: the fourth round played, the quarter-finals to come", () => {
  it("draws the quarter-finals among the eight fourth-round winners while ESPN has no fixtures", () => {
    const rounds = buildCup(efc, realFourth, {}, options);
    assert.deepEqual(rounds.slice(0, ROUND.quarter).map((r) => r.drawn), ["real", "real", "real", "real", "real"]);
    assert.deepEqual(rounds[ROUND.fourth]!.ties.map((t) => tieWinner(t, {})), WINNERS);
    const quarters = rounds[ROUND.quarter]!;
    assert.equal(quarters.drawn, "simulated");
    assert.equal(quarters.ties.length, 4);
    assert.deepEqual(quarters.ties.flatMap((t) => [t.homeId, t.awayId]).sort((a, b) => a - b), [...WINNERS].sort((a, b) => a - b), "every winner once");
    assert.ok(quarters.ties.every((t) => !t.real && t.legs.length === 1 && !t.game.neutral));
    assert.equal(rounds[ROUND.semi]!.drawn, "pending");
    // An open, unseeded draw: every run of the chances draws it afresh.
    const draws = new Set(Array.from({ length: 12 }, (_, i) => drawRoundRandom(WINNERS, iterationRng(2026, i)).map((p) => p.join("-")).join(",")));
    assert.ok(draws.size > 1, "the draw changes from run to run");
    const mc = runCupMonteCarlo({ config: efc, real: realFourth, fixed: {}, strengths, options: { entrants: {} }, iterations: 200, seed: 2026 });
    for (const id of WINNERS) assert.equal(mc.reached[id]![ROUND.quarter], 200, `${id} in every quarter-final draw`);
    // No fixed pairing: with equal strengths and a fresh draw, two winners can both reach the semi-finals.
    assert.ok(WINNERS.every((id) => mc.reached[id]![ROUND.semi]! > 40 && mc.reached[id]![ROUND.semi]! < 160));
    assert.equal(Object.values(mc.won).reduce((a, b) => a + b, 0), 200, "one winner per run");
  });

  it("uses the real quarter-final fixtures as soon as ESPN publishes them", () => {
    const rounds = buildCup(efc, [...realFourth, ...realQuarters], {}, options);
    const quarters = rounds[ROUND.quarter]!;
    assert.equal(quarters.drawn, "real");
    assert.deepEqual(quarters.ties.map((t) => [t.homeId, t.awayId, t.real]), realQuarters.map((t) => [t.homeId, t.awayId, true]));
    assert.equal(quarters.ties[0]!.game.utcDate, "2026-12-16T20:00Z");
    // The chances follow the real pairing: City and Liverpool meet, so exactly one of them reaches the semi-finals in every run.
    const mc = runCupMonteCarlo({ config: efc, real: [...realFourth, ...realQuarters], fixed: {}, strengths, options: { entrants: {} }, iterations: 100, seed: 7 });
    assert.equal(mc.reached[CLUBS.city]![ROUND.semi]! + mc.reached[CLUBS.liverpool]![ROUND.semi]!, 100);
  });

  it("changing a played result (Everton 3-1 Newcastle) sends the other club through to the quarter-finals", () => {
    const before = buildCup(efc, [...realFourth, ...realQuarters], {}, options);
    assert.ok(before[ROUND.quarter]!.participants.includes(CLUBS.everton) && !before[ROUND.quarter]!.participants.includes(CLUBS.newcastle));
    // The Everton tie is the round's first slot (lowest feed id): the edit keys on its slot id.
    const edited: ResultMap = { [cupGameId(ROUND.fourth, 0)]: { home: 0, away: 2 } };
    const after = buildCup(efc, realFourth, edited, options);
    assert.equal(tieWinner(after[ROUND.fourth]!.ties[0]!, edited), CLUBS.newcastle);
    const quarters = after[ROUND.quarter]!;
    assert.ok(quarters.participants.includes(CLUBS.newcastle) && !quarters.participants.includes(CLUBS.everton));
    assert.ok(quarters.ties.some((t) => t.homeId === CLUBS.newcastle || t.awayId === CLUBS.newcastle));
    const alive = clubsAlive(after, edited, Object.values(CLUBS));
    assert.ok(alive.has(CLUBS.newcastle) && !alive.has(CLUBS.everton));
    // With the published draw, Everton's real quarter-final is kept but pending: Newcastle isn't in it.
    const kept = buildCup(efc, [...realFourth, ...realQuarters], edited, options)[ROUND.quarter]!;
    assert.equal(kept.drawn, "real");
    assert.ok(!kept.ties.some((t) => t.homeId === CLUBS.newcastle || t.awayId === CLUBS.newcastle));
    // A level score with a shoot-out typed in: the shoot-out decides it.
    const level: ResultMap = { [cupGameId(ROUND.fourth, 0)]: { home: 1, away: 1 }, [cupShootoutId(ROUND.fourth, 0)]: { home: 2, away: 4 } };
    assert.equal(tieWinner(buildCup(efc, realFourth, level, options)[ROUND.fourth]!.ties[0]!, level), CLUBS.newcastle);
  });

  it("two-legged semi-finals: aggregate, then penalties after the second leg at the second club's ground", () => {
    const results: ResultMap = {};
    let rounds = buildCup(efc, [...realFourth, ...realQuarters], results, options);
    for (const tie of rounds[ROUND.quarter]!.ties) results[tie.game.id] = { home: 1, away: 0 };
    rounds = buildCup(efc, [...realFourth, ...realQuarters], results, options);
    const semis = rounds[ROUND.semi]!;
    assert.equal(semis.drawn, "simulated");
    assert.equal(semis.ties.length, 2);
    const [tie] = semis.ties;
    assert.equal(tie!.legs.length, 2);
    assert.deepEqual([tie!.legs[0]!.homeId, tie!.legs[0]!.awayId], [tie!.homeId, tie!.awayId]);
    assert.deepEqual([tie!.legs[1]!.homeId, tie!.legs[1]!.awayId], [tie!.awayId, tie!.homeId], "second leg at the other club");
    assert.equal(tie!.legs[1]!.id, cupSecondLegId(ROUND.semi, 0));
    assert.equal(tie!.shootout.homeId, tie!.awayId, "the shoot-out follows the second leg");
    // 1-0 at home, 0-1 away: 1-1 on aggregate, no away goals, straight to penalties.
    results[tie!.legs[0]!.id] = { home: 1, away: 0 };
    results[tie!.legs[1]!.id] = { home: 1, away: 0 };
    assert.deepEqual(tieAggregate(tie!, results), { home: 1, away: 1 });
    assert.equal(needsShootout(tie!, results), true);
    assert.equal(tieWinner(tie!, results), null);
    results[tie!.shootout.id] = { home: 4, away: 2 }; // the second leg's host wins the shoot-out
    assert.equal(tieWinner(tie!, results), tie!.awayId);
    results[tie!.shootout.id] = { home: 2, away: 4 };
    assert.equal(tieWinner(tie!, results), tie!.homeId);
    // 2-0 then 1-2: 3-2 on aggregate, no shoot-out.
    results[tie!.legs[0]!.id] = { home: 2, away: 0 };
    results[tie!.legs[1]!.id] = { home: 2, away: 1 };
    assert.equal(needsShootout(tie!, results), false);
    assert.equal(tieWinner(tie!, results), tie!.homeId);
  });

  it("plays down to a neutral final at Wembley between the two semi-final winners", () => {
    const results = simulateCup(efc, [...realFourth, ...realQuarters], {}, model, createRng(11), options);
    const rounds = buildCup(efc, [...realFourth, ...realQuarters], results, options);
    const final = rounds[ROUND.final]!;
    assert.equal(final.drawn, "determined");
    assert.equal(final.ties[0]!.game.neutral, true);
    assert.deepEqual(rounds[ROUND.semi]!.ties.map((t) => tieWinner(t, results)).sort(), [final.ties[0]!.homeId, final.ties[0]!.awayId].sort());
    const winner = cupWinner(rounds, results);
    assert.ok(winner !== null && WINNERS.includes(winner));
  });
});

describe("EFL Cup: sample data", () => {
  it("builds a season offline: the preliminary round from the real draw, then every round down to the final", () => {
    const data = sampleCup(efc as CupConfig);
    assert.equal(data.real.length, 2);
    assert.equal(data.entrants.firstRound?.length, 68);
    assert.equal(data.entrants.thirdRound?.length, 9);
    const all = [...data.real.flatMap((t) => [t.homeId, t.awayId]), ...Object.values(data.entrants).flat()];
    const sampleModel = cupModelFor(new Map(Object.entries(data.strengths).map(([id, s]) => [Number(id), s])), all, efc.outsiderTier);
    const buildOptions = { entrants: data.entrants, drawSalt: 0, roundDates: data.roundDates };
    const results = simulateCup(efc, data.real, {}, sampleModel, createRng(3), buildOptions);
    const rounds = buildCup(efc, data.real, results, buildOptions);
    assert.deepEqual(rounds.map((r) => r.ties.length), [2, 35, 23, 16, 8, 4, 2, 1]);
    assert.ok(cupWinner(rounds, results) !== null);
  });
});
