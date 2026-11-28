// What a visitor and a search engine get from a page: pinned before a change that
// mustn't alter it (lighter pages, scoped client messages), and compared after.
//
// Usage, with a sample build running (FOOTSIMU_SAMPLE_DATA=1 npm run build && npm start):
//   PRESERVE_WRITE=/tmp/pages.json BASE_URL=http://localhost:3000 node e2e/preservation.cjs
//   PRESERVE_COMPARE=/tmp/pages.json BASE_URL=http://localhost:3000 node e2e/preservation.cjs
// Sample leagues are generated around today's date, so capture and compare on the
// same day (a capture of main, then of the branch). Without either variable it only
// checks what must always hold, which `npm run test:e2e` does on every run:
// - every page is server-rendered: its heading, tables and structured data are in
//   the HTML without JavaScript;
// - its title, Open Graph site name and structured data spell the brand "FootSimu";
// - canonical and hreflang (en, pt-BR, es, x-default) are there, and no indexable
//   page asks not to be indexed;
// - with JavaScript, it hydrates without an error and without a missing message
//   (a client component whose messages a route doesn't send would log one).
//
// What is compared: each page's visible text without JavaScript (desktop and phone
// widths), every link (address and text), images, title, meta tags, canonical and
// hreflang links and the JSON-LD; and the sitemap and robots.txt as served.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { fullSitemap } = require("./sitemap.cjs");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LOCALES = ["en", "pt", "es"];
const SITE_PAGES = ["about", "privacy", "contact"];

/** The sample pages, by kind: every kind of indexable page the site renders. */
async function samplePaths(page, live) {
  // The club, match and chance addresses come from the league page itself (the sample clubs and dates).
  await page.goto(`${BASE_URL}/en/premier-league`);
  const hrefs = await page.$$eval("a[href]", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  const club = hrefs.find((h) => /^\/en\/premier-league\/team\/[^/]+$/.test(h));
  assert.ok(club, "a club page link on the league page");
  await page.goto(`${BASE_URL}${club}`);
  const clubHrefs = await page.$$eval("a[href]", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  const upcoming = clubHrefs.find((h) => /^\/en\/premier-league\/match\//.test(h));
  const clubChance = clubHrefs.find((h) => /^\/en\/premier-league\/team\/[^/]+\/chances\//.test(h));
  const sitemap = await fullSitemap(BASE_URL);
  const today = new Date().toISOString().slice(0, 10);
  // Played games: the newest in the sitemap (its last 6 days) still follows its league. A settled one (over a
  // week old, src/lib/settledMatch.ts) has left the index window and the sitemap (src/lib/indexPolicy.ts), so
  // it's an earlier matchday's game on the league page (picked with JavaScript, the matchday menu).
  const day = 86_400_000;
  const playedGames = [...sitemap.matchAll(/<loc>[^<]*?(\/en\/premier-league\/match\/[^<]*-(\d{4}-\d{2}-\d{2}))<\/loc>/g)]
    .filter((m) => m[2] < today)
    .sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  const recent = playedGames.filter((m) => Date.parse(`${m[2]}T12:00:00Z`) > Date.now() - 6 * day).at(-1)?.[1];
  let played;
  await live.goto(`${BASE_URL}/en/premier-league`);
  const matchdays = live.getByTestId("matchday-select");
  for (let md = Number(await matchdays.inputValue()) - 1; md >= 1 && !played; md--) {
    await matchdays.selectOption(String(md));
    const href = await live.locator('[data-testid="fixtures"]').getByRole("link", { name: "Match preview" }).first().getAttribute("href");
    if (Date.parse(`${href.slice(-10)}T12:00:00Z`) < Date.now() - 10 * day) played = href;
  }
  const round = [...sitemap.matchAll(/<loc>[^<]*?(\/en\/premier-league\/odds\/matchday-\d+)<\/loc>/g)].map((m) => m[1])[0];
  const strip = (path) => path.replace(/^\/en/, "");
  const paths = {
    home: "",
    league: "/premier-league",
    leagueGroups: "/mls",
    leagueTournaments: "/argentina-primera-division",
    leaguePromotionPath: "/colombia-primera-b",
    leagueFirstParty: "/brasileirao-serie-c",
    cup: "/fa-cup",
    continental: "/champions-league",
    club: strip(club),
    clubChance: clubChance && strip(clubChance),
    leagueChance: "/premier-league/chances/title",
    matchUpcoming: upcoming && strip(upcoming),
    matchPlayed: played && strip(played),
    matchRecent: recent && strip(recent),
    odds: "/premier-league/odds",
    oddsRound: round && strip(round),
    oddsHub: "/odds",
    pastWinners: "/premier-league/past-winners",
    quiz: "/quiz",
    myWorld: "/my-world",
    // Not changed by any of this, only read: they share the layout (its client messages).
    about: "/about",
    privacy: "/privacy",
    contact: "/contact",
  };
  for (const [kind, path] of Object.entries(paths)) assert.ok(path !== undefined, `no sample ${kind} page`);
  return paths;
}

/** Everything a page shows and tells search engines, read from its server HTML (no JavaScript). */
async function readPage(page) {
  return page.evaluate(() => {
    const attr = (el, name) => el.getAttribute(name) ?? "";
    const text = (s) => s.replace(/\s+/g, " ").trim();
    return {
      title: document.title,
      text: text(document.body.innerText),
      // A settled match page (src/lib/settledMatch.ts) shows its clubs' table as it stood after the game: its
      // text is compared without that section, which has its own tests.
      settled: document.querySelector('[data-testid="match-page"]')?.getAttribute("data-settled") === "true",
      textOutsideForm: (() => {
        const form = document.querySelector('[data-testid="match-form-table"]');
        if (form) form.style.display = "none";
        const outside = text(document.body.innerText);
        if (form) form.style.display = "";
        return outside;
      })(),
      links: [...document.querySelectorAll("a[href]")].map((a) => `${attr(a, "href")} | ${text(a.textContent)} | ${attr(a, "aria-label")}`),
      images: [...document.querySelectorAll("img")].map((img) => `${attr(img, "src")} | ${attr(img, "alt")}`),
      meta: [...document.querySelectorAll("head meta")].map((m) => `${attr(m, "name") || attr(m, "property") || attr(m, "charset") || attr(m, "http-equiv")}=${attr(m, "content")}`).sort(),
      headLinks: [...document.querySelectorAll("head link[rel=canonical], head link[rel=alternate]")].map((l) => `${attr(l, "rel")} ${attr(l, "hreflang")} ${attr(l, "href")}`).sort(),
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)),
      headings: [...document.querySelectorAll("h1, h2, h3")].map((h) => `${h.tagName} ${text(h.textContent)}`),
      tables: [...document.querySelectorAll("table")].map((t) => t.rows.length),
    };
  });
}

/** What must hold on every indexable page, whatever the capture. */
function checkInvariants(url, view, { indexable }) {
  assert.ok(view.headings.some((h) => h.startsWith("H1 ")), `${url}: an h1 in the server HTML`);
  assert.match(view.title, /FootSimu/, `${url}: the title names FootSimu`);
  assert.doesNotMatch(view.title, /Foot ?simu(?!\b)|Footsimu|FOOTSIMU|Foot Simu/, `${url}: the brand is spelled FootSimu`);
  const ogSite = view.meta.find((m) => m.startsWith("og:site_name="));
  assert.equal(ogSite, "og:site_name=FootSimu", `${url}: og:site_name`);
  const hreflangs = view.headLinks.filter((l) => l.startsWith("alternate ")).map((l) => l.split(" ")[1]).sort();
  assert.deepEqual(hreflangs, ["en", "es", "pt-BR", "x-default"], `${url}: hreflang`);
  assert.ok(view.headLinks.some((l) => l.startsWith("canonical ")), `${url}: canonical`);
  const robots = view.meta.find((m) => m.startsWith("robots="));
  if (indexable) assert.ok(!robots || !/noindex/.test(robots), `${url}: indexable (${robots})`);
  // Names in the structured data (the site's, the publisher's) spell FootSimu; "Foot Simu" stays only as the
  // home page's alternateName, a search alias.
  const names = JSON.stringify(view.jsonLd, (key, value) => (key === "alternateName" ? undefined : value)).match(/"name":"[^"]*Foot ?[Ss]imu[^"]*"/g) ?? [];
  for (const name of names) assert.match(name, /FootSimu/, `${url}: JSON-LD brand`);
}

(async () => {
  const browser = await chromium.launch();
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  const phone = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const withJs = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await noJs.newPage();
  const phonePage = await phone.newPage();
  const live = await withJs.newPage();
  const errors = [];
  live.on("pageerror", (e) => errors.push(`${live.url()}: ${e.message}`));
  live.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    // Vercel Web Analytics' script is only served on Vercel, so it 404s locally.
    if ((m.location().url ?? "").includes("/_vercel/insights/")) return;
    if (m.type() === "warning" && !/MISSING_MESSAGE|messages/i.test(m.text())) return;
    errors.push(`${live.url()}: ${m.text()}`);
  });

  const capture = { pages: {} };
  try {
    const paths = await samplePaths(page, live);
    for (const locale of LOCALES) {
      for (const [kind, path] of Object.entries(paths)) {
        const url = `${BASE_URL}/${locale}${path}`;
        process.stdout.write(`- ${locale} ${kind} … `);
        const res = await page.goto(url);
        assert.equal(res.status(), 200, `${url}: HTTP ${res.status()}`);
        const view = await readPage(page);
        await phonePage.goto(url);
        view.phoneText = (await phonePage.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim();
        // A match far from today is noindex by design (inIndexWindow); every other page is indexable. The site's
        // own pages (about, privacy, contact) are only compared, not checked.
        if (!SITE_PAGES.includes(kind)) checkInvariants(url, view, { indexable: !kind.startsWith("match") });
        // Hydrated: no error, no message a client component lacks.
        await live.goto(url);
        await live.waitForLoadState("networkidle");
        capture.pages[`${locale}:${kind}`] = { path, ...view };
        console.log("ok");
      }
    }
    capture.sitemap = await fullSitemap(BASE_URL);
    capture.robots = await (await fetch(`${BASE_URL}/robots.txt`)).text();
    assert.deepEqual(errors, [], "errors or missing messages after hydration");

    if (process.env.PRESERVE_WRITE) {
      fs.writeFileSync(process.env.PRESERVE_WRITE, JSON.stringify(capture, null, 1));
      console.log(`captured ${Object.keys(capture.pages).length} pages to ${process.env.PRESERVE_WRITE}`);
    }
    if (process.env.PRESERVE_COMPARE) {
      const before = JSON.parse(fs.readFileSync(process.env.PRESERVE_COMPARE, "utf8"));
      const differences = [];
      for (const [key, was] of Object.entries(before.pages)) {
        const now = capture.pages[key];
        if (!now) {
          differences.push(`${key}: missing`);
          continue;
        }
        // A page settled since the capture: everything but its clubs' section, as captured; that section has its
        // own tests (the "after this match" label, the table as it stood).
        const skip = now.settled && !was.settled ? ["text", "phoneText", "settled"] : [];
        for (const field of Object.keys(was).filter((f) => !skip.includes(f))) {
          try {
            assert.deepEqual(now[field], was[field]);
          } catch (error) {
            differences.push(`${key} ${field}:\n${error.message.split("\n").slice(0, 30).join("\n")}`);
          }
        }
      }
      // The sitemap: the same addresses, each with the same date, but a settled match's: its settle time
      // (src/lib/sitemapDates.ts, tested there).
      const entries = (xml) => new Map([...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => [m[1].match(/<loc>([^<]*)<\/loc>/)[1], m[1]]));
      const [was, now] = [entries(before.sitemap), entries(capture.sitemap)];
      // In any order (the sitemap now comes in pieces); a game at the window's edges may come or go between
      // the two captures (and the pieces leave a game out a day before its page turns noindex).
      const atEdge = (url) => {
        const date = /\/match\/.*-(\d{4}-\d{2}-\d{2})$/.exec(url)?.[1];
        if (!date) return false;
        const at = Date.parse(`${date}T12:00:00Z`);
        return Math.abs(at - (Date.now() - 30 * 86_400_000)) < 3 * 86_400_000 || Math.abs(at - (Date.now() + 14 * 86_400_000)) < 3 * 86_400_000;
      };
      const addresses = (map) => [...map.keys()].filter((url) => !atEdge(url)).sort().join("\n");
      if (addresses(was) !== addresses(now)) differences.push("sitemap.xml: another set of addresses");
      const settledDate = (url) => /\/match\/.*-(\d{4}-\d{2}-\d{2})$/.exec(url)?.[1];
      for (const [url, entry] of was) {
        const other = now.get(url);
        if (other === undefined || other === entry) continue;
        const date = settledDate(url);
        const stripped = (e) => e.replace(/<lastmod>[^<]*<\/lastmod>/, "");
        const settledAt = date && new Date(Date.parse(`${date}T12:00:00Z`) + 8 * 86_400_000).toISOString();
        if (!date || stripped(other) !== stripped(entry) || !other.includes(`<lastmod>${settledAt}</lastmod>`)) differences.push(`sitemap.xml: ${url} differs`);
      }
      if (capture.robots !== before.robots) differences.push("robots.txt differs");
      const settledNow = Object.entries(capture.pages).filter(([, v]) => v.settled).map(([k]) => k);
      console.log(`settled match pages: ${settledNow.join(", ") || "none"}`);
      assert.deepEqual(differences, [], `pages differ from the capture:\n${differences.join("\n\n")}`);
      console.log(`${Object.keys(before.pages).length} pages, the sitemap and robots.txt: as captured`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
