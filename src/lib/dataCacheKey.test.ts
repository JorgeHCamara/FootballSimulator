import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAGUES } from "../config/leagues.ts";
import { cacheScope, configFingerprint, ESPN_PARSER_VERSION, espnDataKey } from "./dataCacheKey.ts";
import { keptLeagueKey } from "./leagueData.ts";

const PL = LEAGUES.find((l) => l.code === "PL")!;
const BSA = LEAGUES.find((l) => l.code === "BSA")!;
const prod = (deployment: string, sha: string) => ({ VERCEL_ENV: "production", VERCEL_DEPLOYMENT_ID: deployment, VERCEL_GIT_COMMIT_SHA: sha });
const now = new Date("2026-11-09T12:00:00Z");

describe("the feeds' data cache keys", () => {
  it("are the same across production deployments: a redeploy reuses what the last one read", () => {
    assert.deepEqual(keptLeagueKey(PL, undefined, now, prod("dpl_a", "aaa")), keptLeagueKey(PL, undefined, now, prod("dpl_b", "bbb")));
    assert.ok(!keptLeagueKey(PL, undefined, now, prod("dpl_a", "aaa")).some((part) => part.includes("dpl_") || part.includes("aaa")), "no deployment in the key");
  });

  it("change with the parser version, so data read the old way is never reused", () => {
    const now1 = espnDataKey("league-data", "PL", "current-2026", PL, prod("dpl_a", "aaa"), ESPN_PARSER_VERSION);
    const next = espnDataKey("league-data", "PL", "current-2026", PL, prod("dpl_a", "aaa"), ESPN_PARSER_VERSION + 1);
    assert.notDeepEqual(now1, next);
    assert.deepEqual(keptLeagueKey(PL, undefined, now, prod("dpl_a", "aaa")), now1);
  });

  it("keep production, each preview branch and local builds apart", () => {
    assert.equal(cacheScope(prod("dpl_a", "aaa")), "production");
    assert.equal(cacheScope({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "perf/x", VERCEL_DEPLOYMENT_ID: "dpl_1" }), "preview:perf/x");
    assert.equal(cacheScope({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "perf/x", VERCEL_DEPLOYMENT_ID: "dpl_2" }), "preview:perf/x", "a branch's redeploys share");
    assert.equal(cacheScope({}), "local");
    const keys = [prod("d", "s"), { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "a" }, { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "b" }, {}].map((env) => keptLeagueKey(PL, undefined, now, env).join("|"));
    assert.equal(new Set(keys).size, 4);
  });

  it("follow the competition's config and the shared club tables, whatever the order of its keys", () => {
    assert.notEqual(configFingerprint(PL), configFingerprint({ ...PL, teams: PL.teams + 2 }));
    assert.equal(configFingerprint({ a: 1, b: { c: 2, d: 3 } }), configFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    assert.notEqual(keptLeagueKey(PL, undefined, now).join("|"), keptLeagueKey(BSA, undefined, now).join("|"));
  });

  it("start a new entry at the season rollover, and keep past seasons by their years", () => {
    // A split season (August–May) moves on in June; a calendar-year season in January.
    assert.notDeepEqual(keptLeagueKey(PL, undefined, new Date("2027-05-31T12:00:00Z")), keptLeagueKey(PL, undefined, new Date("2027-06-01T12:00:00Z")));
    assert.notDeepEqual(keptLeagueKey(BSA, undefined, new Date("2026-12-31T12:00:00Z")), keptLeagueKey(BSA, undefined, new Date("2027-01-01T12:00:00Z")));
    assert.ok(keptLeagueKey(PL, undefined, now).includes("current-2026"));
    assert.ok(keptLeagueKey(PL, [2025], now).includes("2025"));
  });
});
