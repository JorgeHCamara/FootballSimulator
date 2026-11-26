// The impact route's Cache-Control depends on the game's kick-off (impactCacheControl in src/lib/impactCache.ts):
// the near header within 48 hours of it, a far one (as long as the game stays far) before. The sample games' dates
// move with today, so the e2e checks ask the function itself, at the times just before and after the request.

const assert = require("node:assert/strict");

const parse = (cc) => ({
  head: (cc ?? "").replace(/s-maxage=\d+, stale-while-revalidate=\d+$/, ""),
  s: Number(/(?:^|[ ,])s-maxage=(\d+)/.exec(cc ?? "")?.[1]),
  w: Number(/stale-while-revalidate=(\d+)/.exec(cc ?? "")?.[1]),
});

/** Asserts `cc` is what impactCacheControl gives for `kickoff` at some moment between `t0` and `t1` (ms). */
async function assertImpactCacheControl(cc, kickoff, t0, t1, label) {
  const { impactCacheControl } = await import("../src/lib/impactCache.ts");
  // A second's slack either side: the server's clock and rounding.
  const [early, late] = [impactCacheControl(kickoff, t0 - 1000), impactCacheControl(kickoff, t1 + 1000)].map(parse);
  const got = parse(cc);
  assert.equal(got.head, early.head, `${label}: ${cc}`);
  assert.ok(got.s <= Math.max(early.s, late.s) && got.s >= Math.min(early.s, late.s), `${label}: s-maxage for a kick-off at ${kickoff} (${cc})`);
  assert.ok(got.w <= Math.max(early.w, late.w) && got.w >= Math.min(early.w, late.w), `${label}: stale-while-revalidate for a kick-off at ${kickoff} (${cc})`);
}

/** A match page's kick-off, from its SportsEvent JSON-LD. */
function kickoffOf(html) {
  const startDate = /"startDate":"([^"]+)"/.exec(html)?.[1];
  assert.ok(startDate, "the match page's startDate");
  return startDate;
}

module.exports = { assertImpactCacheControl, kickoffOf };
