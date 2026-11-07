import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createWorld, ENGLAND, playSeason, savedTable, startNextSeason, upgradeWorld, type StartPack, type World } from "./myWorld.ts";
import { worldStartPack } from "./myWorldStart.ts";
import { isWorld, loadWorld, saveWorld, WORLD_KEY } from "./myWorldStorage.ts";
import { mostTitles } from "./winners.ts";
import { leagueWinners } from "./winnersData.ts";
import { historySeason, worldWinners } from "./worldWinners.ts";

let pack: StartPack;
before(async () => {
  process.env.FOOTSIMU_SAMPLE_DATA = "1";
  pack = await worldStartPack();
});

const NOW = new Date("2026-11-06T12:00:00Z");
const start = () => createWorld(pack, { league: "EL2", club: pack.leagues[3]!.teams[0]!.id }, 7, NOW);
const memoryStore = () => {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      items.set(k, v);
    },
    removeItem: (k: string) => {
      items.delete(k);
    },
  };
};

describe("My World's Past Winners", () => {
  it("starts with no seasons of its own", () => {
    assert.deepEqual(start().winners, []);
  });

  it("records each league's top three when a season is ended: the clubs, their names and their points", () => {
    const first = start();
    const world = startNextSeason(playSeason(first));
    assert.equal(world.winners.length, ENGLAND.length);
    for (const code of ENGLAND) {
      const entry = world.winners.find((w) => w.code === code && w.year === first.year)!;
      const table = savedTable(world, first.year, code)!;
      assert.deepEqual(
        entry.top.map((p) => p[0]),
        table.rows.slice(0, 3).map((r) => r.clubId),
        `${code}: the top three`,
      );
      assert.deepEqual(
        entry.top.map((p) => p[2]),
        table.rows.slice(0, 3).map((r) => r.points),
      );
      for (const [id, name] of entry.top) assert.equal(name, world.clubs[id]!.name);
    }
    assert.equal(startNextSeason(playSeason(world)).winners.length, 2 * ENGLAND.length, "another season adds four more");
  });

  it("lists the world's seasons newest first, on top of the real history; the current season only once it's ended", () => {
    const real = leagueWinners("premier-league")!;
    const first = start();
    assert.equal(worldWinners(first, "PL", real).length, real.length, "nothing of its own yet");
    const one = startNextSeason(playSeason(first));
    const rows = worldWinners(one, "PL", real);
    assert.equal(rows.length, real.length + 1);
    assert.equal(rows[0]!.world, true);
    assert.equal(rows[0]!.season, historySeason(first.year));
    assert.equal(rows[0]!.competition, real[0]!.competition, "it belongs to the competition's current era");
    assert.equal(rows[0]!.champion!.name, one.clubs[one.winners.find((w) => w.code === "PL")!.top[0]![0]]!.name);
    assert.equal(rows[1], real[0]);
    const two = startNextSeason(playSeason(one));
    assert.deepEqual(
      worldWinners(two, "PL", real)
        .slice(0, 2)
        .map((r) => r.season),
      [historySeason(first.year + 1), historySeason(first.year)],
    );
  });

  it("shows a league without a real history with the world's seasons alone", () => {
    const one = startNextSeason(playSeason(start()));
    const rows = worldWinners(one, "EL2", null);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.competition, "League Two");
    assert.ok(rows[0]!.champion!.tla, "a world club's code, for its badge disc");
  });

  it("adds a real club's world titles to its real ones", () => {
    const real = leagueWinners("premier-league")!;
    const one = startNextSeason(playSeason(start()));
    const champion = one.winners.find((w) => w.code === "PL")!.top[0]![0];
    const realId = one.clubs[champion]!.realId!;
    // As if the real history's latest champion were this club.
    const latest = { ...real[0]!, champion: { ...real[0]!.champion!, key: `espn:${realId}` } };
    const rows = worldWinners(one, "PL", [latest]);
    assert.equal(rows[0]!.champion!.key, `espn:${realId}`);
    assert.equal(mostTitles(rows)[0]!.titles, 2);
  });

  it("keeps the record in the save; a save from before gets it from its finished seasons' tables", () => {
    const world = startNextSeason(playSeason(start()));
    const store = memoryStore();
    assert.ok(saveWorld(store, world));
    assert.deepEqual(loadWorld(store).world!.winners, world.winners);

    const { winners: _w, ...rest } = world;
    const old = rest as World;
    assert.ok(isWorld(old), "a save without the field is still readable");
    store.setItem(WORLD_KEY, JSON.stringify(old));
    const loaded = loadWorld(store).world!;
    assert.deepEqual(loaded.winners, world.winners);
    assert.equal(upgradeWorld(loaded), loaded, "nothing more to change");
  });

  it("rejects a save whose record is broken", () => {
    const world = startNextSeason(playSeason(start()));
    assert.equal(isWorld({ ...world, winners: "none" }), false);
    assert.equal(isWorld({ ...world, winners: [{ year: world.year, code: "PL", top: [[999_999, "Nobody", 1]] }] }), false);
    assert.equal(isWorld({ ...world, winners: [{ year: world.year, code: "PL", top: [[world.userClub, 1, 1]] }] }), false);
  });
});

describe("historySeason", () => {
  it("labels a world season as the history files do: split years in Europe, a calendar year in Brazil", () => {
    assert.equal(historySeason(2026), "2026-27");
    assert.equal(historySeason(2026, true), "2026");
  });
});
