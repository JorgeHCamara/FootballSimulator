import assert from "node:assert/strict";
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

  it("the xG fingerprint: a short hash of the xG the model uses, \"none\" without any", () => {
    const xg = { 2: [1.2, 0.4], 1: [0.9, 1.1] } as const;
    assert.match(xgFingerprint(xg), /^[0-9a-f]{12}$/);
    assert.equal(xgFingerprint({ 1: [0.9, 1.1], 2: [1.2, 0.4] }), xgFingerprint(xg), "whatever order the games come in");
    assert.notEqual(xgFingerprint({ ...xg, 3: [2.1, 0.2] }), xgFingerprint(xg), "new xG, another fingerprint");
    assert.notEqual(xgFingerprint({ ...xg, 2: [1.3, 0.4] }), xgFingerprint(xg), "a corrected game too");
    assert.equal(xgFingerprint(undefined), "none");
    assert.equal(xgFingerprint({}), "none");
  });
});
