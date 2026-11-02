import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getLeagueByCode } from "../config/leagues.ts";
import { createRng } from "./rng.ts";
import {
  PLAYOFF_ID_BASE,
  buildBracket,
  needsShootout,
  playoffCancelled,
  playoffIds,
  playoffWinners,
  seedByGroupPlace,
  seriesGames,
  simulatePenalties,
  simulatePlayoff,
  tieOutcome,
  type PlayoffConfig,
  type PlayoffTie,
} from "./playoffs.ts";
import type { LeagueModel } from "./ratings.ts";
import type { Fixture, ResultMap, StandingRow } from "./types.ts";

const row = (position: number, teamId: number): StandingRow => ({
  position,
  teamId,
  played: 38,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDifference: 0,
  points: 0,
  form: [],
});
// Team id = 100 + position, so 3rd is 103 and 6th is 106.
const rows = Array.from({ length: 24 }, (_, i) => row(i + 1, 101 + i));
const options = { seasonComplete: true, afterMatchday: 38, afterDate: "2026-11-15T20:00:00Z" };

const serieB: PlayoffConfig = {
  rounds: [{ key: "semiFinals", legs: 2, levelTie: "betterPlaced", pairs: [[3, 6], [4, 5]] }],
  directPromotion: [1, 2],
  promotedTo: "Série A",
};

const championship: PlayoffConfig = {
  rounds: [
    { key: "eliminators", legs: 1, levelTie: "penalties", pairs: [[5, 8], [6, 7]] },
    { key: "semiFinals", legs: 2, levelTie: "penalties", entrants: [3, 4] },
    { key: "final", legs: 1, levelTie: "penalties", venue: "Wembley" },
  ],
  directPromotion: [1, 2],
  promotedTo: "Premier League",
};

const model: LeagueModel = {
  avgHomeGoals: 1.5,
  avgAwayGoals: 1.2,
  strengths: new Map(rows.map((r) => [r.teamId, { attack: 1, defence: 1 }])),
};

describe("Série B play-off (two legs, draw advantage)", () => {
  const [[semi1, semi2]] = buildBracket(rows, serieB, {}, options) as [[ReturnType<typeof buildBracket>[0][0], ReturnType<typeof buildBracket>[0][0]]];

  it("seeds 3rd v 6th and 4th v 5th, better-placed club at home in the second leg", () => {
    assert.deepEqual([semi1.higher.teamId, semi1.lower.teamId, semi2.higher.teamId, semi2.lower.teamId], [103, 106, 104, 105]);
    assert.deepEqual([semi1.legs[0]!.homeId, semi1.legs[1]!.homeId], [106, 103]);
    // Ids are unchanged from the first version, so old share links still work.
    assert.deepEqual(playoffIds(serieB), [1, 2, 3, 4].map((n) => PLAYOFF_ID_BASE + n));
    assert.equal(semi1.shootout, null);
  });

  it("goes to the better-placed club on a level aggregate", () => {
    const results: ResultMap = { [semi1.legs[0]!.id]: { home: 2, away: 1 }, [semi1.legs[1]!.id]: { home: 1, away: 0 } };
    assert.deepEqual(tieOutcome(semi1, results), { higherGoals: 2, lowerGoals: 2, winner: 103, onPenalties: false });
  });

  it("shows positions only until the season is complete", () => {
    const [[tie]] = buildBracket(rows, serieB, {}, { ...options, seasonComplete: false }) as [[(typeof semi1)]];
    assert.deepEqual([tie.higher.position, tie.lower.position, tie.higher.teamId], [3, 6, null]);
    assert.equal(tie.legs.length, 0);
  });

  it("uses real play-off results from the feed for matching legs", () => {
    const real: Fixture[] = [{ id: 999, matchday: 1, utcDate: "2026-11-21T20:00Z", homeId: 106, awayId: 103, result: { home: 0, away: 2 } }];
    const [[tie]] = buildBracket(rows, serieB, {}, { ...options, real }) as [[(typeof semi1)]];
    assert.deepEqual(tie.legs[0]!.result, { home: 0, away: 2 });
    assert.equal(tie.legs[0]!.utcDate, "2026-11-21T20:00Z");
  });
});

describe("Championship 2026/27 play-off", () => {
  it("plays single-leg eliminators at the better-placed club, with penalties if level", () => {
    const [eliminators] = buildBracket(rows, championship, {}, options);
    const [e1, e2] = eliminators!;
    assert.deepEqual([e1!.higher.teamId, e1!.lower.teamId, e2!.higher.teamId, e2!.lower.teamId], [105, 108, 106, 107]);
    assert.equal(e1!.legs.length, 1);
    assert.equal(e1!.legs[0]!.homeId, 105);

    const level: ResultMap = { [e1!.legs[0]!.id]: { home: 1, away: 1 } };
    assert.equal(tieOutcome(e1!, level), null, "level and no shoot-out yet");
    assert.ok(needsShootout(e1!, level));
    const pens = { ...level, [e1!.shootout!.id]: { home: 3, away: 4 } };
    assert.deepEqual(tieOutcome(e1!, pens), { higherGoals: 1, lowerGoals: 1, winner: 108, onPenalties: true });
  });

  it("re-seeds the semi-finals: 3rd v the lowest-placed winner, 3rd and 4th host the second leg", () => {
    const [eliminators] = buildBracket(rows, championship, {}, options);
    // 8th beats 5th, 6th beats 7th → semis 3rd v 8th, 4th v 6th.
    const results: ResultMap = {
      [eliminators![0]!.legs[0]!.id]: { home: 0, away: 1 },
      [eliminators![1]!.legs[0]!.id]: { home: 2, away: 0 },
    };
    const semis = buildBracket(rows, championship, results, options)[1]!;
    assert.deepEqual(semis.map((t) => [t.higher.teamId, t.lower.teamId]), [[103, 108], [104, 106]]);
    assert.deepEqual(semis[0]!.legs.map((l) => l.homeId), [108, 103]);
  });

  it("leaves the semi-final opponents open until both eliminators are decided", () => {
    const semis = buildBracket(rows, championship, {}, options)[1]!;
    assert.deepEqual(semis.map((t) => t.higher.position), [3, 4]);
    assert.ok(semis.every((t) => t.lower.teamId === null && t.lower.from && t.legs.length === 0));
  });

  it("plays the final at a neutral ground and promotes its winner", () => {
    const results = simulatePlayoff(rows, championship, {}, model, createRng(7), options);
    const bracket = buildBracket(rows, championship, results, options);
    const final = bracket[2]![0]!;
    assert.equal(final.legs.length, 1);
    assert.equal(final.legs[0]!.neutral, true);
    const [winner] = playoffWinners(bracket, results);
    assert.ok(winner !== null && [103, 104, 105, 106, 107, 108].includes(winner!));
    // Every tie in every round is decided.
    for (const round of bracket) for (const tie of round) assert.ok(tieOutcome(tie, results), `round ${tie.round} tie ${tie.index}`);
  });

  it("lists every leg and shoot-out id", () => {
    const ids = playoffIds(championship);
    // 2 eliminators (1 leg + pens), 2 semis (2 legs + pens), 1 final (1 leg + pens)
    assert.equal(ids.length, 2 * 2 + 2 * 3 + 2);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("penalty shoot-out", () => {
  it("always has a winner", () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      const s = simulatePenalties(rng);
      assert.notEqual(s.home, s.away);
      assert.ok(Math.max(s.home, s.away) >= 3);
    }
  });
});

describe("MLS Cup playoffs (conferences, best-of-three, fixed bracket)", () => {
  // East clubs are 201–215 and West clubs 301–315 (id = conference base + position).
  // Overall table alternates West and East: 301 is 1st overall, 201 2nd, 302 3rd…
  const east = Array.from({ length: 15 }, (_, i) => row(i + 1, 201 + i));
  const west = Array.from({ length: 15 }, (_, i) => row(i + 1, 301 + i));
  const overall = Array.from({ length: 30 }, (_, i) => row(i + 1, (i % 2 === 0 ? 301 : 201) + Math.floor(i / 2)));
  const mls: PlayoffConfig = {
    groupStage: { count: 2, rounds: 4 },
    rounds: [
      { key: "wildCard", legs: 1, levelTie: "penalties", noExtraTime: true, pairs: [[8, 9]] },
      { key: "roundOne", legs: 1, bestOf: 3, levelTie: "penalties", noExtraTime: true, entrants: [1, 2, 3, 4, 5, 6, 7] },
      { key: "conferenceSemiFinals", legs: 1, levelTie: "penalties", fixedBracket: true },
      { key: "conferenceFinal", legs: 1, levelTie: "penalties", fixedBracket: true },
      { key: "mlsCup", legs: 1, levelTie: "penalties" },
    ],
    title: "MLS Cup",
  };
  const mlsOptions = { ...options, afterMatchday: 34, groups: [east, west] };
  const bracket = (results: ResultMap, seasonComplete = true) => buildBracket(overall, mls, results, { ...mlsOptions, seasonComplete });
  /** A score for `fixture` that `winner` wins (by `margin`; 0 = a draw). */
  const win = (fixture: Fixture, winner: number, margin = 1) =>
    fixture.homeId === winner ? { home: 1 + margin, away: 1 } : { home: 1, away: 1 + margin };
  const tieOf = (b: ReturnType<typeof bracket>, round: number, higher: number) => b[round]!.find((t) => t.higher.teamId === higher)!;

  it("has two wild cards, eight Round One series, four semifinals, two finals and MLS Cup, with unique ids", () => {
    assert.deepEqual(bracket({}).map((r) => r.length), [2, 8, 4, 2, 1]);
    const ids = playoffIds(mls);
    assert.equal(ids.length, 2 * 2 + 8 * 6 + 4 * 2 + 2 * 2 + 2);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("shows conference slots before the season ends", () => {
    const [wildCards, roundOne] = bracket({}, false);
    assert.deepEqual(wildCards!.map((t) => [t.group, t.higher.position, t.lower.position]), [[0, 8, 9], [1, 8, 9]]);
    assert.deepEqual(roundOne![0]!.higher, { teamId: null, position: 1, group: 0 });
    assert.deepEqual(roundOne![0]!.lower, { teamId: null, position: null, from: { round: 0, tie: 0 }, group: 0 });
    assert.equal(roundOne![0]!.legs.length, 0);
  });

  it("puts the wild-card winner against 1st, then 2v7, 3v6, 4v5", () => {
    const eastWildCard = bracket({})[0]![0];
    // 9th wins a draw on penalties (no extra time).
    const results: ResultMap = { [eastWildCard!.legs[0]!.id]: { home: 0, away: 0 }, [eastWildCard!.shootout!.id]: { home: 3, away: 4 } };
    assert.equal(tieOutcome(eastWildCard!, results)?.winner, 209);
    const roundOne = bracket(results)[1]!.filter((t) => t.group === 0);
    assert.deepEqual(roundOne.map((t) => [t.higher.teamId, t.lower.teamId]), [[201, 209], [202, 207], [203, 206], [204, 205]]);
  });

  it("plays Round One as best of three: higher seed hosts games 1 and 3, drawn games go to penalties", () => {
    const series = tieOf(bracket({}), 1, 202);
    assert.deepEqual(series.legs.map((g) => g.homeId), [202, 207, 202]);
    const [g1, g2, g3] = series.legs;
    // 2–0 sweep: game 3 isn't needed.
    const sweep: ResultMap = { [g1!.id]: win(g1!, 207), [g2!.id]: win(g2!, 207) };
    assert.deepEqual(seriesGames(series, sweep).map((g) => g.needed), [true, true, false]);
    assert.deepEqual(tieOutcome(series, sweep), { higherGoals: 0, lowerGoals: 2, winner: 207, onPenalties: false });
    // 1–1, then a drawn game 3 decided by its own shoot-out.
    const decider: ResultMap = { [g1!.id]: win(g1!, 202), [g2!.id]: win(g2!, 207), [g3!.id]: { home: 2, away: 2 } };
    assert.equal(tieOutcome(series, decider), null);
    assert.equal(seriesGames(series, decider)[2]!.needsPenalties, true);
    decider[series.gameShootouts[2]!.id] = { home: 5, away: 4 };
    assert.equal(tieOutcome(series, decider)?.winner, 202);
  });

  it("follows the fixed bracket (1/8/9 v 4/5, 2/7 v 3/6) and hosts MLS Cup at the better overall record", () => {
    const results: ResultMap = {};
    const play = (round: number, winners: Record<number, number>) => {
      for (const tie of bracket(results)[round]!) {
        const winner = winners[tie.higher.teamId!] ?? tie.higher.teamId!;
        for (const game of tie.legs) {
          if (!seriesGames(tie, results).find((g) => g.game.id === game.id)?.needed && tie.config.bestOf) continue;
          results[game.id] = win(game, winner);
        }
      }
    };
    play(0, {}); // 8th seeds win the wild cards
    play(1, { 202: 207, 204: 205 }); // 7th beats 2nd, 5th beats 4th in the East
    const semis = bracket(results)[2]!.filter((t) => t.group === 0);
    assert.deepEqual(semis.map((t) => [t.higher.teamId, t.lower.teamId]), [[201, 205], [203, 207]]);
    play(2, {});
    play(3, {});
    const cup = bracket(results)[4]![0];
    // East champion 201 is 2nd overall; West champion 301 is 1st overall and hosts.
    assert.deepEqual([cup!.higher.teamId, cup!.lower.teamId, cup!.legs[0]!.homeId], [301, 201, 301]);
  });

  it("simulates the whole playoff to one MLS Cup winner, stopping series once decided", () => {
    const simulated = simulatePlayoff(overall, mls, {}, mlsModel, createRng(11), mlsOptions);
    const ids = new Set(playoffIds(mls));
    assert.ok(Object.keys(simulated).every((id) => ids.has(Number(id))));
    const final = buildBracket(overall, mls, simulated, { ...mlsOptions, seasonComplete: true });
    const [champion] = playoffWinners(final, simulated);
    assert.ok(champion !== null && champion !== undefined);
    for (const series of final[1]!) {
      for (const g of seriesGames(series, simulated)) assert.equal(simulated[g.game.id] !== undefined, g.needed);
    }
  });

  it("takes real results from the feed, including a series' shoot-out", () => {
    const series = tieOf(bracket({}), 1, 203);
    const real: Fixture[] = [
      { id: 9001, matchday: 0, utcDate: "2026-11-20T00:00Z", homeId: 203, awayId: 206, result: { home: 1, away: 1 }, penalties: { home: 4, away: 2 } },
      { id: 9002, matchday: 0, utcDate: "2026-11-27T00:00Z", homeId: 206, awayId: 203, result: { home: 0, away: 2 } },
    ];
    const withReal = buildBracket(overall, mls, {}, { ...mlsOptions, seasonComplete: true, real });
    const s = tieOf(withReal, 1, 203);
    assert.deepEqual(s.legs.map((g) => g.result), [{ home: 1, away: 1 }, { home: 0, away: 2 }, null]);
    assert.deepEqual(s.gameShootouts[0]!.result, { home: 4, away: 2 });
    assert.equal(tieOutcome(s, {})?.winner, 203);
    assert.equal(series.legs.length, 3);
  });
});

const mlsModel: LeagueModel = {
  avgHomeGoals: 1.5,
  avgAwayGoals: 1.2,
  strengths: new Map([...Array(15).keys()].flatMap((i) => [[201 + i, { attack: 1, defence: 1 }], [301 + i, { attack: 1, defence: 1 }]] as const)),
};

describe("League Two play-off (4th–7th, three promoted directly)", () => {
  const leagueTwo = getLeagueByCode("EL2")!.playoff!;

  it("pairs 4th v 7th and 5th v 6th, with a Wembley final", () => {
    const [semis, [final]] = buildBracket(rows, leagueTwo, {}, options) as [PlayoffTie[], PlayoffTie[]];
    assert.deepEqual(semis.map((t) => [t.higher.teamId, t.lower.teamId]), [[104, 107], [105, 106]]);
    assert.equal(final!.config.venue, "Wembley");
  });

  it("promotes four clubs: 1st–3rd plus the play-off winner", () => {
    const results = simulatePlayoff(rows, leagueTwo, {}, model, createRng(5), options);
    const [winner] = playoffWinners(buildBracket(rows, leagueTwo, results, options), results);
    assert.ok(winner !== null && [104, 105, 106, 107].includes(winner!));
    assert.deepEqual(leagueTwo.directPromotion, [1, 2, 3]);
    assert.equal(leagueTwo.promotedTo, "League One");
  });
});

describe("Serie B play-off (preliminaries, fixed semi-finals, draw advantage)", () => {
  const serieB = getLeagueByCode("SB")!.playoff!;
  const table = rows.slice(0, 20);
  /** A score for `fixture` that `winner` wins. */
  const win = (fixture: Fixture, winner: number) => (fixture.homeId === winner ? { home: 2, away: 1 } : { home: 1, away: 2 });

  it("plays 5v8 and 6v7 at the better-placed club; a draw sends it through", () => {
    const [prelims] = buildBracket(table, serieB, {}, options);
    assert.deepEqual(prelims!.map((t) => [t.higher.teamId, t.lower.teamId, t.legs[0]!.homeId]), [[105, 108, 105], [106, 107, 106]]);
    assert.equal(tieOutcome(prelims![0]!, { [prelims![0]!.legs[0]!.id]: { home: 1, away: 1 } })?.winner, 105);
  });

  it("pairs 3rd with the 6/7 winner and 4th with the 5/8 winner, even after upsets", () => {
    const [prelims] = buildBracket(table, serieB, {}, options);
    // 8th beats 5th, 7th beats 6th.
    const results: ResultMap = { [prelims![0]!.legs[0]!.id]: win(prelims![0]!.legs[0]!, 108), [prelims![1]!.legs[0]!.id]: win(prelims![1]!.legs[0]!, 107) };
    const semis = buildBracket(table, serieB, results, options)[1]!;
    assert.deepEqual(semis.map((t) => [t.higher.teamId, t.lower.teamId]), [[103, 107], [104, 108]]);
    assert.equal(semis[0]!.config.legs, 2);
  });

  it("is not played when 3rd finishes more than 14 points clear of 4th", () => {
    const withPoints = (third: number, fourth: number) => table.map((r) => ({ ...r, points: r.position === 3 ? third : r.position === 4 ? fourth : 40 }));
    assert.equal(playoffCancelled(serieB, withPoints(75, 61)), false, "14 points: play-off held");
    assert.equal(playoffCancelled(serieB, withPoints(76, 61)), true, "15 points: 3rd goes up");
    assert.deepEqual(buildBracket(withPoints(76, 61), serieB, {}, options), []);
    assert.deepEqual(simulatePlayoff(withPoints(76, 61), serieB, {}, model, createRng(1), options), {});
  });
});

describe("Ligue 2 play-off (4th v 5th, winner at 3rd, then v Ligue 1's 16th)", () => {
  const ligue2 = getLeagueByCode("FL2")!.playoff!;

  it("plays 4th v 5th, then the winner at 3rd's ground; a draw goes to penalties", () => {
    const [[first], [second]] = buildBracket(rows.slice(0, 18), ligue2, {}, options) as [PlayoffTie[], PlayoffTie[]];
    assert.deepEqual([first!.higher.teamId, first!.lower.teamId], [104, 105]);
    assert.ok(first!.shootout);
    assert.deepEqual([second!.higher.teamId, second!.lower.from], [103, { round: 0, tie: 0 }]);
    assert.deepEqual(ligue2.winnerPlays, { league: "Ligue 1", position: 16 });
  });
});

describe("Eerste Divisie play-off (two-legged rounds, winner meets the Eredivisie's 16th)", () => {
  const eerste = getLeagueByCode("DJL")!.playoff!;

  it("plays 5v8 and 6v7, then 3rd and 4th join; the winner goes on to face the Eredivisie's 16th", () => {
    const [roundOne, semis] = buildBracket(rows.slice(0, 18), eerste, {}, options) as [PlayoffTie[], PlayoffTie[]];
    assert.deepEqual(roundOne.map((t) => [t.higher.teamId, t.lower.teamId, t.legs.length]), [[105, 108, 2], [106, 107, 2]]);
    assert.deepEqual(semis.map((t) => t.higher.teamId), [103, 104]);
    assert.deepEqual(eerste.winnerPlays, { league: "Eredivisie", position: 16 });
    assert.deepEqual(getLeagueByCode("DJL")!.reserveTeams, ["Jong "]);
  });
});

describe("Segunda División play-off (3rd–6th, two-legged rounds, draw advantage)", () => {
  const segunda = getLeagueByCode("SD")!.playoff!;

  it("pairs 3v6 and 4v5 over two legs, then a two-legged final; level aggregate sends the better-placed club through", () => {
    const [semis, [final]] = buildBracket(rows.slice(0, 22), segunda, {}, options) as [PlayoffTie[], PlayoffTie[]];
    assert.deepEqual(semis.map((t) => [t.higher.teamId, t.lower.teamId, t.legs.length]), [[103, 106, 2], [104, 105, 2]]);
    const [first, second] = semis[0]!.legs;
    assert.equal(tieOutcome(semis[0]!, { [first!.id]: { home: 1, away: 1 }, [second!.id]: { home: 0, away: 0 } })?.winner, 103);
    assert.equal(final!.config.legs, 2);
    assert.deepEqual(getLeagueByCode("SD")!.reserveTeams, ["Real Sociedad II", "RC Celta Fortuna"]);
  });
});

describe("UEFA knockout phase (league-phase seeding, drawn pairings)", () => {
  const ucl = getLeagueByCode("UCL")!;
  const config = ucl.playoff!;
  // Team id = 100 + position.
  const table = Array.from({ length: 36 }, (_, i) => row(i + 1, 101 + i));
  const leg = (id: number, homeId: number, awayId: number, utcDate: string, result: Fixture["result"] = null): Fixture => ({
    id,
    matchday: 0,
    utcDate,
    homeId,
    awayId,
    result,
  });
  const pairsOf = (ties: PlayoffTie[]) => ties.map((t) => [t.higher.teamId, t.lower.teamId]);

  it("projects 9th–24th into the play-off and the top 8 into the round of 16 along the seeding", () => {
    const bracket = buildBracket(table, config, {}, options);
    assert.deepEqual(bracket.map((r) => r.length), [8, 8, 4, 2, 1]);
    assert.deepEqual(pairsOf(bracket[0]!), [[109, 124], [110, 123], [111, 122], [112, 121], [113, 120], [114, 119], [115, 118], [116, 117]]);
    // Round of 16: 1st meets the 16th/17th winner, 8th the 9th/24th winner.
    assert.deepEqual(bracket[1]![0]!.lower.from, { round: 0, tie: 7 });
    assert.deepEqual(bracket[1]![7]!.lower.from, { round: 0, tie: 0 });
    // The better-placed club hosts the second leg.
    assert.equal(bracket[0]![0]!.legs[1]!.homeId, 109);
    // Placeholder dates spread like UEFA's calendar: play-off three weeks after
    // the league phase (15 Nov in these options), final 17 weeks after it.
    assert.equal(bracket[0]![0]!.legs[0]!.utcDate.slice(0, 10), "2026-12-06");
    assert.equal(buildBracket(table, config, {}, { ...options, seasonComplete: false })[4]![0]!.higher.teamId, null);
  });

  it("replaces projected pairings with the real draw once the feed lists it", () => {
    // Real draw: 9th v 23rd and 10th v 24th (the other ties as projected).
    const real = [leg(1, 123, 109, "2027-02-16T20:00:00Z"), leg(2, 124, 110, "2027-02-17T20:00:00Z")];
    const ties = buildBracket(table, config, {}, { ...options, real })[0]!;
    assert.deepEqual(pairsOf(ties).slice(0, 3), [[109, 123], [110, 124], [111, 122]]);
    assert.equal(ties[0]!.legs[0]!.utcDate, "2027-02-16T20:00:00Z", "the real leg is used");
    assert.equal(new Set(ties.flatMap((t) => [t.higher.teamId, t.lower.teamId])).size, 16);
  });

  it("keeps every club once when the real draw breaks several projected pairs", () => {
    // 9 v 17, 16 v 24: their projected partners (24, 17) are taken, so 23 … end up re-paired.
    const real = [leg(1, 117, 109, "2027-02-16T20:00:00Z"), leg(2, 124, 116, "2027-02-16T20:00:00Z")];
    const ties = buildBracket(table, config, {}, { ...options, real })[0]!;
    const pairs = pairsOf(ties);
    assert.deepEqual(pairs[0], [109, 117]);
    assert.ok(pairs.some(([a, b]) => a === 116 && b === 124));
    assert.equal(new Set(pairs.flat()).size, 16);
  });

  it("plays down to one winner, with the final at a neutral venue", () => {
    const model: LeagueModel = { avgHomeGoals: 1.5, avgAwayGoals: 1.2, strengths: new Map() };
    const results = simulatePlayoff(table, config, {}, model, createRng(4), options);
    const bracket = buildBracket(table, config, results, options);
    assert.equal(bracket[4]![0]!.legs[0]!.neutral, true);
    const [winner] = playoffWinners(bracket, results);
    assert.ok(winner !== null && winner! >= 101 && winner! <= 124);
  });
});

describe("seedByGroupPlace (Libertadores knockout seeding)", () => {
  const groupRow = (position: number, teamId: number, points: number, goalDifference = 0): StandingRow => ({ ...row(position, teamId), points, goalDifference });
  it("ranks every group winner before any runner-up, each by record", () => {
    const groups = [
      [groupRow(1, 1, 10), groupRow(2, 2, 12, 1), groupRow(3, 3, 4)],
      [groupRow(1, 11, 13), groupRow(2, 12, 9), groupRow(3, 13, 2)],
    ];
    const seeds = seedByGroupPlace(groups);
    assert.deepEqual(seeds.map((r) => [r.position, r.teamId]), [[1, 11], [2, 1], [3, 2], [4, 12], [5, 3], [6, 13]]);
  });

  it("puts clubs from another competition right after the qualifying places (Sudamericana)", () => {
    const groups = [
      [groupRow(1, 1, 10), groupRow(2, 2, 8), groupRow(3, 3, 4)],
      [groupRow(1, 11, 13), groupRow(2, 12, 9), groupRow(3, 13, 2)],
    ];
    const external = [groupRow(3, 91, 5), groupRow(3, 92, 7)];
    const seeds = seedByGroupPlace(groups, external, 2);
    assert.deepEqual(seeds.map((r) => r.teamId), [11, 1, 12, 2, 92, 91, 3, 13]);
    assert.deepEqual(seeds.map((r) => r.position), [1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("Argentina's play-offs (zones interleaved, cross-zone round of 16)", () => {
  const arg = getLeagueByCode("ARG")!;
  const zoneRow = (zone: "A" | "B", place: number) => row(place, (zone === "A" ? 100 : 200) + place);
  const zoneA = Array.from({ length: 15 }, (_, i) => zoneRow("A", i + 1));
  const zoneB = Array.from({ length: 15 }, (_, i) => zoneRow("B", i + 1));

  it("seeds A1, B1, A2, B2… and pairs 1st of one zone with 8th of the other", () => {
    const seeds = seedByGroupPlace([zoneA, zoneB], [], arg.playoff!.seedFromGroups!.places, true);
    assert.deepEqual(seeds.slice(0, 4).map((r) => r.teamId), [101, 201, 102, 202]);
    const bracket = buildBracket(seeds, arg.playoff!, {}, options);
    assert.deepEqual(bracket.map((r) => r.length), [8, 4, 2, 1]);
    const pairs = bracket[0]!.map((t) => [t.higher.teamId, t.lower.teamId]);
    assert.deepEqual(pairs, [[101, 208], [201, 108], [102, 207], [202, 107], [103, 206], [203, 106], [104, 205], [204, 105]]);
    // One leg at the better-placed club; the final at a neutral ground.
    assert.equal(bracket[0]![1]!.legs.length, 1);
    assert.equal(bracket[0]![1]!.legs[0]!.homeId, 201);
    assert.equal(bracket[3]![0]!.config.neutral, true);
  });

  it("follows the fixed bracket: 1A/8B meets 4B/5A in the quarter-finals", () => {
    const seeds = seedByGroupPlace([zoneA, zoneB], [], 8, true);
    const r16 = buildBracket(seeds, arg.playoff!, {}, options)[0]!;
    const higherWins = Object.fromEntries(r16.map((t) => [t.legs[0]!.id, { home: 1, away: 0 }]));
    const qf = buildBracket(seeds, arg.playoff!, higherWins, options)[1]!;
    assert.deepEqual(qf.map((t) => [t.higher.teamId, t.lower.teamId]), [[101, 204], [201, 104], [102, 203], [202, 103]]);
  });
});
