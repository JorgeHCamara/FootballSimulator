import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAGUES, getLeagueBySlug, zoneForPosition } from "../config/leagues.ts";
import { doubleRoundRobin } from "../engine/schedule.ts";
import type { ResultMap } from "../engine/types.ts";
import { mapMatches, mapTeam, type ApiMatch } from "./footballData.ts";
import { decodeResults, encodeResults } from "./shareCodec.ts";

describe("shareCodec", () => {
  const fixtures = doubleRoundRobin(Array.from({ length: 20 }, (_, i) => i + 1)).map((f) => ({
    ...f,
    id: 500_000 + f.id * 7, // realistic, non-contiguous API ids
  }));

  it("round-trips predictions", () => {
    const results: ResultMap = {};
    fixtures.forEach((f, i) => {
      if (i % 3 === 0) results[f.id] = { home: i % 5, away: (i * 7) % 4 };
    });
    results[fixtures[1]!.id] = { home: 99, away: 0 };
    const code = encodeResults(fixtures, results);
    assert.match(code, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeResults(fixtures, code), results);
  });

  it("encodes an empty prediction set", () => {
    assert.deepEqual(decodeResults(fixtures, encodeResults(fixtures, {})), {});
  });

  it("rejects malformed codes", () => {
    assert.equal(decodeResults(fixtures, "!!!"), null);
    assert.equal(decodeResults(fixtures, "AgAAAAA"), null); // wrong version
    assert.equal(decodeResults(fixtures, "AQAA"), null); // truncated entry
    assert.equal(decodeResults(fixtures, "Af__AAA"), null); // index out of range
  });
});

describe("football-data mapping", () => {
  const match = (over: Partial<ApiMatch>): ApiMatch => ({
    id: 1,
    utcDate: "2025-08-16T14:00:00Z",
    status: "FINISHED",
    matchday: 1,
    homeTeam: { id: 10 },
    awayTeam: { id: 20 },
    score: { fullTime: { home: 2, away: 1 } },
    ...over,
  });

  it("keeps finished scores and ignores live ones", () => {
    const [finished, live, scheduled] = mapMatches([
      match({ id: 1 }),
      match({ id: 2, status: "IN_PLAY" }),
      match({ id: 3, status: "TIMED", score: { fullTime: { home: null, away: null } } }),
    ]);
    assert.deepEqual(finished!.result, { home: 2, away: 1 });
    assert.equal(live!.result, null);
    assert.equal(scheduled!.result, null);
  });

  it("drops cancelled matches and ones without teams", () => {
    const out = mapMatches([match({ status: "CANCELLED" }), match({ homeTeam: { id: null } }), match({ matchday: null })]);
    assert.equal(out.length, 0);
  });

  it("fills in missing team short names", () => {
    assert.deepEqual(mapTeam({ id: 1, name: "Example FC", shortName: null, tla: null, crest: null }), {
      id: 1,
      name: "Example FC",
      shortName: "Example FC",
      tla: "EXA",
    });
  });
});

describe("league config", () => {
  it("has unique slugs and codes", () => {
    assert.equal(new Set(LEAGUES.map((l) => l.slug)).size, LEAGUES.length);
    assert.equal(new Set(LEAGUES.map((l) => l.code)).size, LEAGUES.length);
  });

  it("defines non-overlapping zones inside the table", () => {
    for (const league of LEAGUES) {
      const covered = new Set<number>();
      for (const z of league.zones) {
        assert.ok(z.from >= 1 && z.to <= league.teams && z.from <= z.to, `${league.code} ${z.kind}`);
        for (let p = z.from; p <= z.to; p++) {
          assert.ok(!covered.has(p), `${league.code} overlap at ${p}`);
          covered.add(p);
        }
      }
      assert.equal(league.tiebreakers[0], "points");
    }
  });

  it("looks up zones by position", () => {
    const bundesliga = getLeagueBySlug("bundesliga")!;
    assert.equal(zoneForPosition(bundesliga, 16)?.kind, "relegationPlayoff");
    assert.equal(zoneForPosition(bundesliga, 10), undefined);
  });
});
