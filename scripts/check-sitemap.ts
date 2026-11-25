// Live sitemap check: fetches the deployed /sitemap.xml (an index of pieces,
// src/app/sitemap.xml/route.ts) and every piece, and fails when a piece lists
// a match outside the index window (INDEX_PAST_DAYS ago to INDEX_NEXT_DAYS
// ahead, a day either side for the league's time zone: matchOutsideWindow) or
// is too big to be regenerated at run time (a Vercel function answers with
// 4.5 MB at most). Each piece's cache age is printed: a piece regenerates at
// least daily (revalidate), so an age well past a day means its regeneration
// fails.
//
//   npm run sitemap:check                         https://footsimu.com
//   npm run sitemap:check -- http://localhost:3000

import { matchOutsideWindow } from "../src/lib/sitemapWindow.ts";

const base = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "https://footsimu.com").replace(/\/$/, "");
const LIMIT = 4.5 * 1024 * 1024;
const now = Date.now();

async function get(url: string) {
  const res = await fetch(url, { headers: { "user-agent": "footsimu-sitemap-check" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return { text: await res.text(), age: res.headers.get("age"), cache: res.headers.get("x-vercel-cache") };
}

const index = await get(`${base}/sitemap.xml`);
const locs = [...index.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
const pieces = index.text.includes("<sitemapindex") ? locs.map((loc) => `${base}${new URL(loc).pathname}`) : [`${base}/sitemap.xml`];
let failures = 0;
for (const url of pieces) {
  const piece = url === `${base}/sitemap.xml` ? index : await get(url);
  const bytes = Buffer.byteLength(piece.text);
  const games = [...piece.text.matchAll(/<loc>([^<]*\/match\/[^<]+)<\/loc>/g)].map((m) => m[1]!);
  const outside = games.filter((g) => matchOutsideWindow(g, now));
  const age = piece.age ? `${(Number(piece.age) / 3600).toFixed(1)} h` : "-";
  const failed = outside.length > 0 || bytes >= LIMIT;
  if (failed) failures++;
  console.log(`${failed ? "FAIL" : "ok  "} ${new URL(url).pathname.padEnd(56)} ${(bytes / 1024).toFixed(0).padStart(6)} KB  ${String(games.length).padStart(5)} games  age ${age} (${piece.cache ?? "-"})${outside.length ? `  ${outside.length} outside the window, e.g. ${outside[0]}` : ""}${bytes >= LIMIT ? "  too big to regenerate" : ""}`);
}
console.log(`\n${pieces.length} sitemap(s) at ${base}: ${failures ? `${failures} failed` : "every game inside the window"}.`);
if (failures) process.exit(1);
