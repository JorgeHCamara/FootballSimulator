import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { farImpactCacheKey, fingerprintOf, IMPACT_CACHE_CONTROL, IMPACT_FAR_MS, IMPACT_KEEP_SECONDS, IMPACT_MISSING_CACHE_CONTROL, impactCacheKey, impactKeyFor, isFarFromKickoff, xgFingerprint } from "./impactCache.ts";
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

describe("the match impact entry: one per game, by the game alone far from kick-off", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");
  const game = { league: "PL", slug: "arsenal-vs-chelsea-2026-12-05", kickoff: "2026-12-05T15:00:00Z" };
  const data = { dataVersion: "PL:espn:2026:380:abc123", xg: "0123456789ab" };

  it("more than 48 hours before kick-off: league, match, kick-off and SIM_VERSION, no data version, no xG", () => {
    let read = false;
    const { key, far } = impactKeyFor(game, () => ((read = true), data), now);
    assert.equal(far, true);
    assert.deepEqual(key, ["match-impact", "PL", game.slug, `far@${game.kickoff}`, `sim-${SIM_VERSION}`]);
    assert.deepEqual(key, farImpactCacheKey(game));
    assert.equal(read, false, "the league's data version isn't even worked out");
    // A new result elsewhere in the league (another data version, other xG) keeps the entry.
    assert.deepEqual(impactKeyFor(game, () => ({ dataVersion: "PL:espn:2026:380:zzz999", xg: "ffffffffffff" }), now).key, key);
    // A game moved to another kick-off is another entry.
    assert.notDeepEqual(impactKeyFor({ ...game, kickoff: "2026-12-06T15:00:00Z" }, () => data, now).key, key);
  });

  it("within 48 hours of kick-off (and after it): by the league's data, as before", () => {
    const close = now + IMPACT_FAR_MS - 60_000;
    const near = { ...game, kickoff: new Date(close).toISOString() };
    const { key, far } = impactKeyFor(near, () => data, now);
    assert.equal(far, false);
    assert.deepEqual(key, impactCacheKey({ league: "PL", slug: game.slug, ...data }));
    assert.equal(isFarFromKickoff(near.kickoff, now), false);
    assert.equal(isFarFromKickoff(new Date(now + IMPACT_FAR_MS + 60_000).toISOString(), now), true);
    assert.equal(isFarFromKickoff(new Date(now - 3_600_000).toISOString(), now), false);
  });

  it("no language in any key: the three languages read the same numbers", () => {
    for (const { key } of [impactKeyFor(game, () => data, now), impactKeyFor(game, () => data, Date.parse(game.kickoff))]) {
      assert.ok(!key.some((part) => /(^|[^a-z])(en|pt|es)([^a-z]|$)/.test(part)), key.join(" "));
    }
  });

  it("kept 24 hours in the data cache; the route's answer is public and kept a day by the CDN, stale a week", () => {
    assert.equal(IMPACT_KEEP_SECONDS, 86_400);
    assert.equal(IMPACT_CACHE_CONTROL, "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");
    assert.doesNotMatch(IMPACT_CACHE_CONTROL, /private|no-store|no-cache/);
    assert.match(IMPACT_MISSING_CACHE_CONTROL, /^public, .*s-maxage=3600$/);
  });
});
