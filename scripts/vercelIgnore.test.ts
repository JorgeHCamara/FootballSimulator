import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error a plain script, run by Vercel before anything is installed
import { decide } from "./vercel-ignore.mjs";

describe("the ignored build step", () => {
  const main = { ref: "main", previous: "abc1234" };

  it("skips main's commits that only change published data", () => {
    assert.equal(decide({ ...main, changed: ["src/data/snapshots/PL.json", "src/data/xg/PL.json"] }).build, false);
  });

  it("builds when anything else changed since the last deployment, however many data commits came after", () => {
    assert.equal(decide({ ...main, changed: ["src/data/snapshots/PL.json", "src/lib/espn.ts"] }).build, true);
    assert.equal(decide({ ...main, changed: ["src/data/priors/PL.json"] }).build, true);
    assert.equal(decide({ ...main, changed: ["src/data/snapshots.ts"] }).build, true);
  });

  it("builds whenever it can't be sure", () => {
    assert.equal(decide({ ref: "uat", previous: "abc1234", changed: ["src/data/xg/PL.json"] }).build, true);
    assert.equal(decide({ ref: "main", previous: undefined, changed: ["src/data/xg/PL.json"] }).build, true);
    assert.equal(decide({ ...main, changed: undefined }).build, true);
    // A redeploy of the commit already live (a new environment variable): nothing differs, and it must build.
    assert.equal(decide({ ...main, changed: [] }).build, true);
  });
});
