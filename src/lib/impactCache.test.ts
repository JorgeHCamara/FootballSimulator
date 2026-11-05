import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fingerprintOf, impactCacheKey, xgFingerprint } from "./impactCache.ts";
import { SIM_VERSION } from "./simVersion.ts";

describe("the match impact cache key", () => {
  const parts = { league: "PL", slug: "arsenal-vs-chelsea-2026-12-05", dataVersion: "PL:espn:2026:380:abc123", xg: "0123456789ab" };

  it("league, match, data version, xG fingerprint and SIM_VERSION: what the numbers depend on", () => {
    const key = impactCacheKey(parts);
    assert.deepEqual(key, ["match-impact", "PL", "arsenal-vs-chelsea-2026-12-05", "PL:espn:2026:380:abc123", "0123456789ab", `sim-${SIM_VERSION}`]);
    // Each part changes the key.
    for (const name of ["league", "slug", "dataVersion", "xg"] as const) assert.notDeepEqual(impactCacheKey({ ...parts, [name]: "other" }), key, name);
  });

  it("no deployment id: a deploy alone doesn't make a new key", () => {
    const before = impactCacheKey(parts);
    process.env.VERCEL_DEPLOYMENT_ID = "dpl_test123";
    process.env.VERCEL_GIT_COMMIT_SHA = "deadbeefcafe";
    const key = impactCacheKey(parts);
    assert.deepEqual(key, before);
    assert.ok(!key.some((p) => p.includes("dpl_test123") || p.includes("deadbeefcafe")));
    delete process.env.VERCEL_DEPLOYMENT_ID;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("the xG file's fingerprint: a short hash of its contents, \"none\" without one", async () => {
    const text = readFileSync(new URL("../data/xg/PL.json", import.meta.url), "utf8");
    assert.equal(await xgFingerprint("PL"), fingerprintOf(text));
    assert.match(fingerprintOf(text), /^[0-9a-f]{12}$/);
    assert.notEqual(fingerprintOf(`${text} `), fingerprintOf(text), "new xG, another fingerprint");
    assert.equal(await xgFingerprint("NOPE"), "none");
  });
});
