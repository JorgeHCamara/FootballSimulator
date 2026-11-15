// Page weight budget: a sample league, club, match and chance page's RSC payload and HTML stay under a
// budget. Every byte of them is written to Vercel's page cache on each regeneration and read back on
// each cache miss (ISR writes, ISR reads, Fast Origin Transfer), so a page that quietly grows (all of a
// namespace's messages sent to the browser, a dataset passed whole to a client component, an inline SVG
// repeated fifty times) costs on every page of its kind. Budgets are about 10% over what the pages weighed
// when they were set (2026-11-14, sample data); raise one only for something a visitor gets in return.
//
// Usage: with a sample build running (FOOTSIMU_SAMPLE_DATA=1 npm run build && npm start):
//   BASE_URL=http://localhost:3000 node e2e/budget.cjs

const assert = require("node:assert/strict");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

/**
 * Uncompressed bytes, the largest of EN, PT and ES. Before PR #114: league 141 KB RSC / 356 KB HTML, club
 * 171 / 314, match 97 / 173, chance 100 / 177. After it (2026-11-15): league 83 / 245, club 118 / 225, match
 * 58 / 114, league chance 60 / 114, club chance 56 / 107. When these budgets were set (2026-11-15, after the
 * footer, icons, club fixtures, chance race and projected history were drawn from compact data): league 63 /
 * 192, club 65 / 157, match 41 / 89, league chance 28 / 75, club chance 32 / 76.
 */
const BUDGETS = {
  league: { path: "/premier-league", rsc: 70_000, html: 212_000 },
  club: { path: "club", rsc: 72_000, html: 173_000 },
  match: { path: "match", rsc: 46_000, html: 99_000 },
  leagueChance: { path: "/premier-league/chances/title", rsc: 32_000, html: 84_000 },
  clubChance: { path: "clubChance", rsc: 36_000, html: 84_000 },
};

const size = async (url, headers = {}) => {
  const res = await fetch(url, { headers });
  assert.equal(res.status, 200, `${url}: HTTP ${res.status}`);
  return Buffer.byteLength(await res.text());
};

(async () => {
  // The sample club, its next game and its title chances, from the league page and the club page.
  const hrefs = async (path) => [...(await (await fetch(`${BASE_URL}${path}`)).text()).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const club = (await hrefs("/en/premier-league")).find((h) => /^\/en\/premier-league\/team\/[^/]+$/.test(h));
  assert.ok(club, "a club page link");
  const clubLinks = await hrefs(club);
  const found = {
    club: club.replace(/^\/en/, ""),
    match: clubLinks.find((h) => /^\/en\/premier-league\/match\//.test(h))?.replace(/^\/en/, ""),
    clubChance: clubLinks.find((h) => /\/team\/[^/]+\/chances\/title$/.test(h))?.replace(/^\/en/, ""),
  };
  const failures = [];
  for (const [kind, budget] of Object.entries(BUDGETS)) {
    const path = budget.path.startsWith("/") ? budget.path : found[budget.path];
    assert.ok(path, `no sample ${kind} page`);
    for (const locale of ["en", "pt", "es"]) {
      const url = `${BASE_URL}/${locale}${path}`;
      const [rsc, html] = await Promise.all([size(url, { RSC: "1" }), size(url)]);
      console.log(`- ${locale} ${kind}: RSC ${rsc} (budget ${budget.rsc}), HTML ${html} (budget ${budget.html})`);
      if (rsc > budget.rsc) failures.push(`${url}: RSC payload ${rsc} bytes, over its ${budget.rsc} budget`);
      if (html > budget.html) failures.push(`${url}: HTML ${html} bytes, over its ${budget.html} budget`);
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  console.log("every page within its budget");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
