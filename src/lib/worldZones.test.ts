import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createRng } from "../engine/rng.ts";
import {
  createWorld,
  divisionState,
  gamesInSeason,
  gamesLeft,
  pastDivision,
  playSeason,
  seasonMoves,
  setScore,
  simulateMatchday,
  simulatePlayoffs,
  simulateRest,
  startNextSeason,
  type StartPack,
  type World,
} from "./myWorld.ts";
import { worldStartPack } from "./myWorldStart.ts";
import { cupClubs, cupConfig } from "./worldCups.ts";
import { worldCupWinners, worldWinners } from "./worldWinners.ts";
import { drawZones, zoneFixtures } from "./worldZones.ts";

describe("Argentina's zone leagues: the calendars", () => {
  const check = (code: "ARG" | "PN", clubs: number) => {
    const fixtures = zoneFixtures(code, drawZones(Array.from({ length: clubs }, (_, i) => i + 1)), "2027-02-01T15:00:00Z");
    const per = new Map<number, number>();
    const home = new Map<number, number>();
    for (const f of fixtures) {
      for (const id of [f.homeId, f.awayId]) per.set(id, (per.get(id) ?? 0) + 1);
      home.set(f.homeId, (home.get(f.homeId) ?? 0) + 1);
    }
    // One game a round per club.
    for (const round of new Set(fixtures.map((f) => f.matchday))) {
      const ids = fixtures.filter((f) => f.matchday === round).flatMap((f) => [f.homeId, f.awayId]);
      assert.equal(new Set(ids).size, ids.length, `${code} round ${round}`);
    }
    assert.equal(new Set(fixtures.map((f) => f.id)).size, fixtures.length);
    return { fixtures, per: new Set(per.values()), home: new Set(home.values()) };
  };

  it("Liga Profesional: two tournaments of 16 rounds, each zone's round robin, the free clubs and a derby round across the zones", () => {
    const { fixtures, per, home } = check("ARG", 30);
    assert.equal(fixtures.length, 480);
    assert.deepEqual([...per], [32]);
    assert.deepEqual([...home], [16]);
    const apertura = fixtures.filter((f) => f.matchday <= 16);
    assert.equal(apertura.length, 240);
    // No pairing twice in a tournament; the Clausura is the Apertura the other way round.
    const pairs = new Set(apertura.map((f) => [f.homeId, f.awayId].sort((a, b) => a - b).join("-")));
    assert.equal(pairs.size, 240);
    const clausura = new Set(fixtures.filter((f) => f.matchday > 16).map((f) => `${f.awayId}-${f.homeId}`));
    assert.ok(apertura.every((f) => clausura.has(`${f.homeId}-${f.awayId}`)));
  });

  it("Primera Nacional: each zone home and away, an interzonal round after each half (36 games)", () => {
    const { fixtures, per, home } = check("PN", 36);
    assert.equal(fixtures.length, 648);
    assert.deepEqual([...per], [36]);
    assert.deepEqual([...home], [18]);
    assert.equal(new Set(fixtures.map((f) => f.matchday)).size, 36);
  });
});

describe("Argentina in My World", () => {
  let pack: StartPack;
  let world: World;
  before(async () => {
    process.env.FOOTSIMU_SAMPLE_DATA = "1";
    pack = await worldStartPack();
    const arg = pack.leagues.find((l) => l.code === "ARG")!;
    world = createWorld(pack, { league: "ARG", club: arg.teams[0]!.id, countries: ["ARG"] }, 11);
  });

  it("starts from the real season: the Liga Profesional's Apertura and Clausura in their zones, the Primera Nacional's zones", () => {
    const lp = divisionState(world, "ARG");
    assert.deepEqual(lp.zones!.stages.map((s) => s.key), ["apertura", "clausura"]);
    assert.deepEqual(lp.zones!.zones.map((z) => z.length), [15, 15]);
    // The sample's Apertura is played: its play-off's clubs are known.
    assert.equal(lp.zones!.stages[0]!.complete, true);
    assert.deepEqual(lp.zones!.stages[0]!.bracket.map((r) => r.length), [8, 4, 2, 1]);
    assert.equal(gamesInSeason(lp), 480 + 15 * 2);
    const pn = divisionState(world, "PN");
    assert.deepEqual(pn.zones!.zones.map((z) => z.length), [18, 18]);
    assert.deepEqual(pn.zones!.stages[0]!.bracket.map((r) => r.length), [1, 7, 4, 2, 1]);
    assert.equal(world.cups.map((c) => c.code).join(), "CAR");
  });

  it("plays a tournament's play-off on its own, and drops its scores when a game changes who's in it", () => {
    let w = simulatePlayoffs(world, "ARG", createRng(3), 0);
    const apertura = divisionState(w, "ARG").zones!.stages[0]!;
    assert.equal(apertura.decided, true, "the Apertura's play-off played");
    assert.equal(divisionState(w, "ARG").zones!.stages[1]!.decided, false, "the Clausura's waits for its games");
    // The 16th seed wins a game 9–0: it climbs the table, so some of the round of 16's pairings change and their scores go.
    const sixteenth = apertura.seeds[15]!.teamId;
    const game = apertura.fixtures.find((f) => f.homeId === sixteenth || f.awayId === sixteenth)!;
    const pairing = (stage: typeof apertura) => new Map(stage.bracket.flat().map((tie) => [`${tie.round}-${tie.index}`, `${tie.higher.teamId}-${tie.lower.teamId}`]));
    const was = pairing(apertura);
    w = setScore(w, "ARG", game, game.homeId === sixteenth ? { home: 9, away: 0 } : { home: 0, away: 9 });
    const state = divisionState(w, "ARG");
    const after = state.zones!.stages[0]!;
    const changed = after.bracket.flat().filter((tie) => was.get(`${tie.round}-${tie.index}`) !== `${tie.higher.teamId}-${tie.lower.teamId}`);
    assert.ok(changed.length > 0, "the table moved the pairings");
    for (const tie of changed.filter((t) => t.round === 0)) for (const leg of tie.legs) assert.equal(state.picks[leg.id], undefined, "a changed tie's score is gone");
    assert.ok(after.bracket[0]!.some((tie) => tie.legs.some((leg) => state.picks[leg.id])), "unchanged ties keep theirs");
  });

  it("plays whole seasons: two champions a year, two down from the Liga Profesional, the final's and the Reducido's winners up, four down, the Copa Argentina", () => {
    let w = world;
    for (let season = 0; season < 2; season++) {
      for (const code of ["ARG", "PN"] as const) w = simulateRest(w, code, createRng(season + 1));
      for (const code of ["ARG", "PN"] as const) {
        const state = divisionState(w, code);
        assert.equal(state.done, true, `${code} done`);
        assert.equal(gamesLeft(state), 0);
      }
      w = startNextSeason(playSeason(w));
      const record = w.history.at(-1)!;
      const [lp, pn] = record.divisions;
      assert.equal(lp!.rows.filter((r) => r[8] === "R").length, 2);
      assert.ok(lp!.rows.filter((r) => r[8] === "C").length >= 1);
      assert.deepEqual(pn!.rows.filter((r) => ["C", "W"].includes(r[8])).length, 2);
      assert.equal(pn!.rows[0]![8], "C", "the Primera Nacional's champion first");
      assert.equal(pn!.rows.filter((r) => r[8] === "R").length, 4);
      assert.deepEqual(record.divisions.map((d) => d.zones?.map((z) => z.length)), [[15, 15], [18, 18]]);
      assert.deepEqual(seasonMoves(w, record).map((m) => [m.up.length, m.down.length]), [[2, 2], [4, 4]]);
      assert.deepEqual(w.divisions.map((d) => [d.clubs.length, d.groups?.map((g) => g.length)]), [[30, [15, 15]], [36, [18, 18]]]);
      // The world's Past Winners: the Apertura and the Clausura, the Primera Nacional's final; the cup's final.
      const lpRows = worldWinners(w, "ARG", null).filter((r) => r.startYear === record.year);
      assert.deepEqual(lpRows.map((r) => r.tournament), ["Clausura", "Apertura"]);
      assert.ok(lpRows.every((r) => r.format === "final" && r.champion && r.runnerUp && !r.third));
      assert.equal(worldWinners(w, "PN", null).filter((r) => r.startYear === record.year)[0]!.champion!.id, pn!.rows[0]![0]);
      assert.equal(worldCupWinners(w, "CAR")[0]!.startYear, record.year);
      // A finished season rebuilt from what's saved: the same champions.
      const past = pastDivision(w, record.year, "ARG")!;
      assert.deepEqual(past.zones!.stages.map((s) => s.champion), lpRows.map((r) => r.champion!.id).reverse());
    }
    // The Copa Argentina drawn among the world's clubs: the Liga Profesional's 30, the Primera Nacional's best 15, 19 from below.
    const cup = w.cups[0]!;
    const clubs = cupClubs(cup);
    assert.equal(clubs.length, 64);
    const division = (id: number) => w.divisions.find((d) => d.clubs.includes(id))?.code ?? "below";
    const count = (code: string) => clubs.filter((id) => division(id) === code).length;
    assert.deepEqual([count("ARG"), count("PN"), count("below")], [30, 15, 19]);
    assert.equal(cupConfig("CAR").worldEntrants!.join(), "30,15");
    // A generated season: zone calendars of 480 and 648 games.
    assert.deepEqual(["ARG", "PN"].map((code) => divisionState(w, code as "ARG").fixtures.length), [480, 648]);
    const next = simulateMatchday(w, "PN", 1, createRng(1));
    assert.equal(gamesLeft(divisionState(next, "PN")), gamesInSeason(divisionState(next, "PN")) - 18);
  });
});
