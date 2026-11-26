// Cost guards: what the CDN may keep, and what never reaches a function twice.
// - A match's "What this result means" (…/impact): public, kept a day by the CDN and served stale a week
//   (repeated requests are cacheable), the same answer on every request, and the same numbers in EN, PT and ES.
// - A live share card: kept a day by the CDN (browsers an hour).
// - /favicon.ico: the brand icon, a static file (no function).
// - Addresses that aren't a language (/llms.txt, /wp-login.php, /xmlrpc.php): a cacheable 404, not a 500.
//
// Usage: with a sample build running (FOOTSIMU_SAMPLE_DATA=1 npm run build && npm start):
//   BASE_URL=http://localhost:3000 node e2e/cost.cjs

const assert = require("node:assert/strict");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const sMaxAge = (header) => Number(/(?:^|[ ,])s-maxage=(\d+)/.exec(header ?? "")?.[1]);
const swr = (header) => Number(/stale-while-revalidate=(\d+)/.exec(header ?? "")?.[1]);

/** The numbers of an impact answer, without its words: what must be the same in every language. */
const numbersOf = (view) => ({
  scores: view.heads.map((h) => [h.key, h.score, h.team?.id ?? null]),
  rows: view.rows.map((r) => [r.key, r.kind, r.zone ?? null, r.cells.length, r.cells.map((c) => c.change.tone)]),
});

(async () => {
  const html = await (await fetch(`${BASE_URL}/en/premier-league`)).text();
  const matches = [...new Set([...html.matchAll(/href="(\/en\/premier-league\/match\/[^"]+)"/g)].map((m) => m[1]))];
  assert.ok(matches.length, "a sample match page link");

  // The impact answer: cacheable, stable, one set of numbers for the three languages.
  let checked = 0;
  for (const match of matches.slice(0, 3)) {
    const views = {};
    for (const lang of ["en", "pt", "es"]) {
      const url = `${BASE_URL}${match.replace(/^\/en\//, `/${lang}/`)}/impact`;
      const first = await fetch(url);
      const second = await fetch(url);
      for (const res of [first, second]) {
        assert.equal(res.status, 200, `${url}: HTTP ${res.status}`);
        const cc = res.headers.get("cache-control");
        assert.match(cc ?? "", /^public, /, `${url}: public`);
        assert.ok(sMaxAge(cc) >= 86400, `${url}: kept a day by the CDN (${cc})`);
        assert.ok(swr(cc) >= 604800, `${url}: served stale a week (${cc})`);
        assert.doesNotMatch(cc ?? "", /no-store|private|no-cache/, `${url}: nothing that stops the CDN`);
      }
      const [a, b] = [await first.text(), await second.text()];
      assert.equal(a, b, `${url}: the same answer on a repeated request`);
      views[lang] = JSON.parse(a);
    }
    if (views.en === null) continue;
    checked++;
    assert.deepEqual(numbersOf(views.pt), numbersOf(views.en), `${match}: PT's numbers are EN's`);
    assert.deepEqual(numbersOf(views.es), numbersOf(views.en), `${match}: ES's numbers are EN's`);
  }
  assert.ok(checked > 0, "at least one sample match with the impact section");

  // An unknown game's impact: a 404 the CDN keeps a while.
  const missing = await fetch(`${BASE_URL}/en/premier-league/match/nobody-vs-nobody-2026-01-01/impact`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("cache-control") ?? "", /^public, .*s-maxage=\d+/);

  // A live share card (an upcoming game's): a day at the CDN, an hour in browsers.
  const card = await fetch(`${BASE_URL}${matches[0]}/opengraph-image`);
  assert.equal(card.status, 200);
  assert.equal(card.headers.get("content-type"), "image/png");
  const cardCc = card.headers.get("cache-control");
  assert.ok(sMaxAge(cardCc) >= 86400, `live card kept a day by the CDN (${cardCc})`);
  assert.match(cardCc ?? "", /(?:^|[ ,])max-age=3600(?:,|$)/, `browsers keep an hour (${cardCc})`);

  // /favicon.ico: the brand icon, served as a file.
  const favicon = await fetch(`${BASE_URL}/favicon.ico`);
  assert.equal(favicon.status, 200, "/favicon.ico");
  const icon = Buffer.from(await favicon.arrayBuffer());
  assert.deepEqual([...icon.subarray(0, 4)], [0, 0, 1, 0], "an .ico file");

  // Not a language: a 404 (not a 500), cacheable.
  for (const path of ["/llms.txt", "/wp-login.php", "/xmlrpc.php"]) {
    const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
    assert.equal(res.status, 404, `${path}: HTTP ${res.status}`);
    const cc = res.headers.get("cache-control") ?? "";
    assert.doesNotMatch(cc, /no-store|private/, `${path}: cacheable (${cc})`);
    assert.ok(sMaxAge(cc) > 0, `${path}: kept by the CDN (${cc})`);
  }
  // …while the languages' own pages and redirects are as they were.
  assert.equal((await fetch(`${BASE_URL}/en`)).status, 200);
  assert.equal((await fetch(`${BASE_URL}/pt`)).status, 200);
  assert.equal((await fetch(`${BASE_URL}/es`)).status, 200);
  assert.equal((await fetch(`${BASE_URL}/`, { redirect: "manual" })).status, 307);

  console.log(`cost: impact cacheable and the same in EN/PT/ES (${checked} games), live card a day, favicon, junk paths 404`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
