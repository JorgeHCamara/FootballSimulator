import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_GAMES, type SeasonRatings } from "../engine/offseason.ts";
import type { TeamStrength } from "../engine/ratings.ts";
import { FORM_CARRY, LEVEL_FADE, LEVEL_FOLLOW, nextSeason, type Strength } from "./worldLevels.ts";

/** A division's season ratings: each club's rating from its results, and MIN_GAMES games unless said otherwise. */
const season = (strengths: Record<number, Strength>, games: Record<number, number> = {}): SeasonRatings => ({
  model: { avgHomeGoals: 1.5, avgAwayGoals: 1.2, strengths: new Map(Object.entries(strengths).map(([id, s]) => [Number(id), { attack: s[0], defence: s[1] }])) },
  games: new Map(Object.keys(strengths).map((id) => [Number(id), games[Number(id)] ?? MIN_GAMES])),
});
const log = (s: TeamStrength) => [Math.log(s.attack), Math.log(s.defence)] as const;
const close = (a: number, b: number, message?: string) => assert.ok(Math.abs(a - b) < 0.002, `${message ?? ""}: ${a} vs ${b}`);
const geometricMean = (list: TeamStrength[], k: keyof TeamStrength) => Math.exp(list.reduce((sum, s) => sum + Math.log(s[k]), 0) / list.length);

describe("My World: a club's level between seasons", () => {
  // Four clubs whose ratings and levels multiply to 1 either way, so the rescaling to average 1 changes nothing.
  const played = season({ 1: [1.5, 0.5], 2: [0.5, 1.5], 3: [1.2, 0.8], 4: [1 / (1.5 * 0.5 * 1.2), 1 / (0.5 * 1.5 * 0.8)] });
  const levels: Record<number, Strength> = { 1: [1.2, 0.8], 2: [0.8, 1.2], 3: [1.1, 0.9], 4: [1 / (1.2 * 0.8 * 1.1), 1 / (0.8 * 1.2 * 0.9)] };

  it("settles a returning club's level LEVEL_FOLLOW of the way to its season, less the fade, and starts its rating FORM_CARRY of the way from that level", () => {
    const next = nextSeason([1, 2, 3, 4], played, null, null, levels);
    for (const id of [1, 2, 3, 4]) {
      const [la, ld] = log({ attack: levels[id]![0], defence: levels[id]![1] });
      const [sa, sd] = log(played.model.strengths.get(id)!);
      const level = [(1 - LEVEL_FADE) * (la + LEVEL_FOLLOW * (sa - la)), (1 - LEVEL_FADE) * (ld + LEVEL_FOLLOW * (sd - ld))];
      const [na, nd] = log(next.levels.get(id)!);
      close(na, level[0]!, `club ${id} level attack`);
      close(nd, level[1]!, `club ${id} level defence`);
      const [ra, rd] = log(next.ratings.get(id)!);
      close(ra, level[0]! + FORM_CARRY * (sa - level[0]!), `club ${id} rating attack`);
      close(rd, level[1]! + FORM_CARRY * (sd - level[1]!), `club ${id} rating defence`);
    }
    // A club above its level moves up, one below it down, but only part of the way: the season's form mostly fades.
    assert.ok(next.levels.get(1)!.attack > 1.2 && next.levels.get(1)!.attack < 1.5);
    assert.ok(next.ratings.get(1)!.attack > next.levels.get(1)!.attack && next.ratings.get(1)!.attack < 1.5);
    assert.ok(next.levels.get(2)!.attack < 0.8 && next.ratings.get(2)!.attack > 0.5);
  });

  it("keeps every division averaging 1 (geometric mean) in ratings and levels, within the real ratings' bounds", () => {
    const next = nextSeason([1, 2, 3, 4], season({ 1: [2.4, 0.5], 2: [2.2, 0.6], 3: [2, 0.7], 4: [1.9, 0.8] }), null, null, { 1: [3, 0.3], 2: [3, 0.3], 3: [2, 0.5], 4: [2, 0.5] });
    for (const list of [[...next.ratings.values()], [...next.levels.values()]]) {
      close(geometricMean(list, "attack"), 1, "attack average");
      close(geometricMean(list, "defence"), 1, "defence average");
      for (const s of list) assert.ok(s.attack >= 0.4 && s.attack <= 2.5 && s.defence >= 0.4 && s.defence <= 2.5);
    }
  });

  it("a club that keeps doing better than its level becomes a better club season after season, and one that keeps doing worse a lesser one", () => {
    let current: Record<number, Strength> = { ...levels };
    const first = { up: current[1]![0] / current[1]![1], down: current[2]![0] / current[2]![1] };
    let last = first;
    for (let i = 0; i < 5; i++) {
      const next = nextSeason([1, 2, 3, 4], played, null, null, current);
      current = Object.fromEntries([...next.levels].map(([id, s]) => [id, [s.attack, s.defence] as Strength]));
      const now = { up: current[1]![0] / current[1]![1], down: current[2]![0] / current[2]![1] };
      assert.ok(now.up > last.up, `season ${i + 1}: club 1 up`);
      assert.ok(now.down < last.down, `season ${i + 1}: club 2 down`);
      last = now;
    }
    // Five seasons at 1.5/0.5 from a 1.2/0.8 level: about half the way there.
    const way = Math.log(last.up / first.up) / Math.log(1.5 / 0.5 / (1.2 / 0.8));
    assert.ok(way > 0.4 && way < 0.6, `${way} of the way`);
  });

  it("a promoted club becomes a below-average one, level and rating alike; a relegated club an above-average one", () => {
    const lower = season({ 11: [1.4, 0.7], 12: [1 / 1.4, 1 / 0.7] });
    const upper = season({ 21: [0.8, 1.3], 22: [1 / 0.8, 1 / 1.3] });
    const all = { ...levels, 11: [1.3, 0.75] as Strength, 12: [1 / 1.3, 1 / 0.75] as Strength, 21: [0.85, 1.2] as Strength, 22: [1 / 0.85, 1 / 1.2] as Strength };
    // Club 11 comes up to this division, club 21 comes down to it, clubs 2 and 4 leave.
    const next = nextSeason([1, 3, 11, 21], played, lower, upper, all);
    const promoted = { rating: next.ratings.get(11)!, level: next.levels.get(11)! };
    const relegated = { rating: next.ratings.get(21)!, level: next.levels.get(21)! };
    for (const s of [promoted.rating, promoted.level]) assert.ok(s.attack < 1 && s.defence > 1, "promoted: below average");
    for (const s of [relegated.rating, relegated.level]) assert.ok(s.attack > 1 && s.defence < 1, "relegated: above average");
    // Still the division's best and worst are the clubs that were.
    assert.ok(next.ratings.get(1)!.attack > relegated.rating.attack && relegated.rating.attack > next.ratings.get(3)!.attack);
  });

  it("a club with no season in the leagues the world plays starts below average, at its old level here if it had one", () => {
    const next = nextSeason([1, 3, 31, 32], played, null, null, { ...levels, 31: [1.3, 0.7] });
    // Both start at the no-data rating (rescaled with the division).
    assert.equal(next.ratings.get(31)!.attack, next.ratings.get(32)!.attack);
    assert.ok(next.ratings.get(31)!.attack < 1 && next.ratings.get(31)!.defence > 1);
    // Club 31 keeps the level it went down with, club 32 starts at the no-data one.
    assert.ok(next.levels.get(31)!.attack > 1 && next.levels.get(31)!.attack > next.levels.get(32)!.attack);
    assert.ok(next.levels.get(32)!.attack < 1 && next.levels.get(32)!.defence > 1);
  });

  it("a club with fewer than MIN_GAMES games counts as having no season", () => {
    const strengths: Record<number, Strength> = { 1: [1.5, 0.5], 2: [0.5, 1.5], 3: [1.2, 0.8], 4: [1 / (1.5 * 0.5 * 1.2), 1 / (0.5 * 1.5 * 0.8)] };
    const short = nextSeason([1, 2, 3, 4], season(strengths, { 3: MIN_GAMES - 1 }), null, null, levels);
    const { 3: _three, ...without } = strengths;
    assert.deepEqual(short, nextSeason([1, 2, 3, 4], season(without), null, null, levels), "as if it hadn't played");
    const full = nextSeason([1, 2, 3, 4], played, null, null, levels);
    assert.ok(short.ratings.get(3)!.attack < full.ratings.get(3)!.attack, "the no-data rating instead of its results");
  });
});
