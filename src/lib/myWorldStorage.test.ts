import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createRng } from "../engine/rng.ts";
import { createWorld, divisionState, pastDivision, playSeason, savedTable, setScore, simulateMatchday, simulateRest, startNextSeason, WORLD_VERSION, type StartPack, type World } from "./myWorld.ts";
import { worldStartPack } from "./myWorldStart.ts";
import { clearWorld, isWorld, loadWorld, saveWorld, WORLD_KEY } from "./myWorldStorage.ts";

/** A browser's localStorage, in memory; `full` makes every write fail (storage full or blocked). */
function memoryStore({ full = false, blocked = false } = {}) {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => {
      if (blocked) throw new Error("SecurityError");
      return items.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (full || blocked) throw new Error("QuotaExceededError");
      items.set(k, v);
    },
    removeItem: (k: string) => void items.delete(k),
  };
}

let pack: StartPack;
let world: World;
before(async () => {
  process.env.FOOTSIMU_SAMPLE_DATA = "1";
  pack = await worldStartPack();
  world = createWorld(pack, { league: "EL1", club: pack.leagues[2]!.teams[3]!.id }, 99, new Date("2026-11-06T12:00:00Z"));
});

describe("My World: the save", () => {
  it("checks the world's countries: England, Spain or both, with their divisions; a save without them is England's", () => {
    assert.equal(isWorld({ ...world, countries: ["ENG", "ESP"] }), false, "Spain's divisions are missing");
    assert.equal(isWorld(createWorld(pack, { league: "PD", club: pack.leagues.find((l) => l.code === "PD")!.teams[0]!.id, countries: ["ENG", "ESP"] }, 3)), true);
    assert.equal(isWorld(createWorld(pack, { league: "PD", club: pack.leagues.find((l) => l.code === "PD")!.teams[0]!.id, countries: ["ESP"] }, 3)), true);
    assert.equal(isWorld({ ...world, countries: [] }), false);
    assert.equal(isWorld({ ...world, countries: ["FRA"] }), false);
    assert.equal(isWorld({ ...world, countries: "ENG" }), false);
    const store = memoryStore();
    const { countries: _c, ...old } = world;
    store.setItem(WORLD_KEY, JSON.stringify(old));
    assert.deepEqual(loadWorld(store).world!.countries, ["ENG"]);
  });

  it("checks the club levels: a save from before them starts them from the ratings; levels of another shape are unreadable", () => {
    const store = memoryStore();
    const { levels: _l, ...old } = world;
    store.setItem(WORLD_KEY, JSON.stringify(old));
    assert.deepEqual(loadWorld(store).world!.levels, world.ratings);
    assert.equal(isWorld({ ...world, levels: 5 }), false);
    assert.equal(isWorld({ ...world, levels: null }), false);
  });

  it("saves and reloads the same world", () => {
    const store = memoryStore();
    assert.deepEqual(loadWorld(store), { world: null, reason: "none" });
    assert.equal(saveWorld(store, world), true);
    assert.deepEqual(loadWorld(store).world, world);
    assert.ok(store.items.get(WORLD_KEY)!.length < 80_000, "a new world is small");
  });

  it("after seasons are played, a reload finds every season's tables and results (history lookup)", () => {
    const store = memoryStore();
    let w = world;
    for (let i = 0; i < 3; i++) {
      w = playSeason(w);
      assert.equal(saveWorld(store, w), true, "saved after the season");
      w = startNextSeason(w);
      assert.equal(saveWorld(store, w), true, "saved when the next one starts");
    }
    const loaded = loadWorld(store).world!;
    assert.deepEqual(loaded, w);
    assert.equal(loaded.history.length, 3);
    for (const season of w.history) {
      for (const code of ["PL", "ELC", "EL1", "EL2"] as const) {
        assert.deepEqual(savedTable(loaded, season.year, code), savedTable(w, season.year, code));
        assert.deepEqual(pastDivision(loaded, season.year, code), pastDivision(w, season.year, code), "every result too");
      }
    }
    // A season's review survives a refresh.
    const mid = playSeason(loaded);
    saveWorld(store, mid);
    assert.equal(loadWorld(store).world!.review, true);
    // The save stays small: about 14 KB a season, every result included.
    assert.ok(store.items.get(WORLD_KEY)!.length < 20_000 * (mid.history.length + 1));
  });

  it("a season in progress keeps every score through a reload: a matchday simulated, scores typed in, a league simulated", () => {
    const store = memoryStore();
    let w = simulateMatchday(world, "PL", divisionState(world, "PL").nextRound!, createRng(1));
    const game = divisionState(w, "PL").fixtures.find((f) => !divisionState(w, "PL").results[f.id])!;
    w = setScore(w, "PL", game, { home: 3, away: 3 });
    w = simulateRest(w, "EL2", createRng(2));
    assert.equal(saveWorld(store, w), true);
    const loaded = loadWorld(store).world!;
    assert.deepEqual(loaded, w);
    assert.deepEqual(divisionState(loaded, "PL").results[game.id], { home: 3, away: 3 });
    assert.equal(divisionState(loaded, "EL2").done, true);
    // A whole season's scores still fit easily.
    assert.ok(store.items.get(WORLD_KEY)!.length < 120_000);
    // A past season's results that can't be read make the save unreadable too.
    const finished = playSeason(w);
    for (const games of ["1zz00", "123", 5]) {
      const broken = memoryStore();
      broken.setItem(WORLD_KEY, JSON.stringify({ ...finished, history: finished.history.map((s) => ({ ...s, divisions: s.divisions.map((d, i) => (i === 0 ? { ...d, games } : d)) })) }));
      assert.deepEqual(loadWorld(broken), { world: null, reason: "unreadable" }, String(games));
    }
    // Scores that can't be scores make the save unreadable.
    for (const scores of [{ 1: [1] }, { 1: [1, -2] }, { 1: "2-1" }, [[1, 2]]]) {
      const broken = memoryStore();
      broken.setItem(WORLD_KEY, JSON.stringify({ ...w, divisions: w.divisions.map((d, i) => (i === 0 ? { ...d, scores } : d)) }));
      assert.deepEqual(loadWorld(broken), { world: null, reason: "unreadable" }, JSON.stringify(scores));
    }
  });

  it("a save from before the realistic calendar: a season not yet being played takes it on load; a bad calendar is unreadable", () => {
    const after = startNextSeason(playSeason(world));
    const old = { ...after, divisions: after.divisions.map(({ calendar: _c, ...d }) => d) };
    const store = memoryStore();
    store.setItem(WORLD_KEY, JSON.stringify(old));
    assert.deepEqual(loadWorld(store).world!.divisions.map((d) => d.calendar), [2, 2, 2, 2]);
    const broken = memoryStore();
    broken.setItem(WORLD_KEY, JSON.stringify({ ...after, divisions: after.divisions.map((d) => ({ ...d, calendar: 3 })) }));
    assert.deepEqual(loadWorld(broken), { world: null, reason: "unreadable" });
  });

  it("a new world replaces the old one (after the reset)", () => {
    const store = memoryStore();
    saveWorld(store, playSeason(world));
    clearWorld(store);
    assert.deepEqual(loadWorld(store), { world: null, reason: "none" });
    const fresh = createWorld(pack, { league: "PL", club: pack.leagues[0]!.teams[0]!.id }, 5, new Date("2026-11-07T12:00:00Z"));
    saveWorld(store, fresh);
    assert.equal(loadWorld(store).world!.history.length, 0);
    assert.equal(loadWorld(store).world!.userClub, fresh.userClub);
  });

  it("an older version's save, or one that can't be read, is set aside (a new world starts, nothing breaks)", () => {
    const old = memoryStore();
    old.setItem(WORLD_KEY, JSON.stringify({ ...world, version: WORLD_VERSION - 1 }));
    assert.deepEqual(loadWorld(old), { world: null, reason: "incompatible" });
    assert.equal(old.items.has(WORLD_KEY), false, "removed");
    for (const text of ["{not json", "null", "[]", JSON.stringify({ ...world, divisions: [] }), JSON.stringify({ ...world, userClub: 123456789 }), JSON.stringify({ ...world, nationalLeague: [123456789] }), JSON.stringify({ ...world, history: [{ year: 2026, divisions: [{ code: "PL", rows: [[1, 2]] }] }] })]) {
      const broken = memoryStore();
      broken.setItem(WORLD_KEY, text);
      assert.deepEqual(loadWorld(broken), { world: null, reason: "unreadable" }, text.slice(0, 40));
      assert.equal(broken.items.has(WORLD_KEY), false);
    }
    assert.equal(isWorld(world), true);
  });

  it("without storage the world still plays, unsaved", () => {
    assert.deepEqual(loadWorld(undefined), { world: null, reason: "unavailable" });
    assert.deepEqual(loadWorld(memoryStore({ blocked: true })), { world: null, reason: "unavailable" });
    assert.equal(saveWorld(memoryStore({ full: true }), world), false);
    assert.equal(saveWorld(undefined, world), false);
    assert.doesNotThrow(() => clearWorld(undefined));
  });
});
