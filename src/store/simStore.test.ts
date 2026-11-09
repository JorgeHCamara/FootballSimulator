import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Fixture } from "../engine/types.ts";
import { syncedPairings, useSimStore } from "./simStore.ts";

describe("cup predictions belong to their pairing", () => {
  const sf = 3000006002;
  const qf = 3000005001;
  const start = { predictions: { [sf]: { home: 3, away: 1 }, [qf]: { home: 2, away: 1 } }, pairings: { [sf]: "87-50", [qf]: "50-56" } };

  it("drops a prediction whose slot is now another pairing", () => {
    const next = syncedPairings(start, { [sf]: "87-56", [qf]: "50-56" });
    assert.equal(next.removed, 1);
    assert.equal(next.predictions[sf], undefined);
    assert.deepEqual(next.predictions[qf], { home: 2, away: 1 });
  });

  it("still drops it when the slot was unbuilt in between (a score half typed in an earlier round)", () => {
    // The quarter-final undecided for a moment: no semi-final slots at all.
    const between = syncedPairings(start, { [qf]: "50-56" });
    assert.equal(between.removed, 0);
    assert.equal(between.pairings[sf], "87-50", "the semi-final's pairing is remembered");
    // Then decided the other way: the semi-final has another club, its old score goes.
    const after = syncedPairings(between, { [sf]: "87-56", [qf]: "50-56" });
    assert.equal(after.removed, 1);
    assert.equal(after.predictions[sf], undefined);
  });

  it("keeps it when the slot comes back with the same clubs", () => {
    const between = syncedPairings(start, { [qf]: "50-56" });
    const after = syncedPairings(between, { [sf]: "87-50", [qf]: "50-56" });
    assert.equal(after.removed, 0);
    assert.deepEqual(after.predictions[sf], { home: 3, away: 1 });
    assert.equal(after.changed, false);
  });
});

describe("typing a cup score keeps the cup's draw and pairings", () => {
  const leg: Fixture = { id: 3000005001, matchday: 0, utcDate: "", homeId: 50, awayId: 56, result: null };
  const sf = 3000006002;

  it("keeps the New draw: the bracket doesn't jump back to the first draw", () => {
    const store = useSimStore.getState();
    store.reset("CUP:a");
    store.redraw("CUP:a");
    store.setScore("CUP:a", leg, { home: 0, away: 2 });
    assert.equal(useSimStore.getState().seasons["CUP:a"]!.drawSalt, 1);
  });

  it("a link shared before the fair draw keeps its old draw while scores are typed; a New draw or a reset is fair again", () => {
    const store = useSimStore.getState();
    store.replace("CUP:c", [], { [leg.id]: { home: 1, away: 0 } }, { drawSalt: 2, oldDraw: true });
    store.setScore("CUP:c", leg, { home: 3, away: 0 });
    assert.equal(useSimStore.getState().seasons["CUP:c"]!.oldDraw, true);
    store.redraw("CUP:c");
    assert.equal(useSimStore.getState().seasons["CUP:c"]!.oldDraw, undefined);
    assert.equal(useSimStore.getState().seasons["CUP:c"]!.drawSalt, 3);
    store.replace("CUP:d", [], {}, { oldDraw: false });
    assert.equal(useSimStore.getState().seasons["CUP:d"]!.oldDraw, undefined, "a link made since: the fair draw");
  });

  it("keeps each slot's pairing, so a semi-final with another club loses its old scores", () => {
    const store = useSimStore.getState();
    store.reset("CUP:b");
    store.applyResults("CUP:b", { [sf]: { home: 3, away: 1 }, [leg.id]: { home: 2, away: 1 } });
    store.syncPairings("CUP:b", { [sf]: "87-50", [leg.id]: "50-56" });
    // The quarter-final the other way: 56 goes through, and the semi-final is 87 v 56.
    store.setScore("CUP:b", leg, { home: 0, away: 2 });
    assert.equal(useSimStore.getState().seasons["CUP:b"]!.pairings?.[sf], "87-50");
    assert.equal(store.syncPairings("CUP:b", { [sf]: "87-56", [leg.id]: "50-56" }), 1);
    assert.equal(useSimStore.getState().seasons["CUP:b"]!.predictions[sf], undefined);
  });
});
