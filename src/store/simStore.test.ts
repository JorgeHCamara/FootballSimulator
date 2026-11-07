import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { syncedPairings } from "./simStore.ts";

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
