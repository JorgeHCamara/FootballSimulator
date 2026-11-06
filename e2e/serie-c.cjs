// End-to-end checks for Brasileirão Série C, the site's first-party league
// (its own committed data, see src/lib/firstParty.ts). Runs against the same
// local build as the smoke test (FOOTSIMU_SAMPLE_DATA=1 still shows the real
// Série C):
//   BASE_URL=http://localhost:3000 node e2e/serie-c.cjs

const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LEAGUE = "brasileirao-serie-c";

// The CBF's official first-phase table, 2026.
const FIRST_PHASE = [
  "Botafogo-PB", "Brusque", "Ferroviária", "Maringá", "Floresta", "Inter de Limeira", "Paysandu", "Santa Cruz", "Ypiranga", "Guarani",
  "Figueirense", "Maranhão", "Amazonas", "Caxias", "Ituano", "Volta Redonda", "Barra", "Anápolis", "Itabaiana", "Confiança",
];

const ONLY = process.env.E2E_ONLY;
async function step(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  process.stdout.write(`- ${name} … `);
  await fn();
  console.log("ok");
}

const names = (page) => page.locator('[data-testid="standings-row"] td:nth-child(2)').allInnerTexts().then((x) => x.map((n) => n.trim()));

/** Every request a page makes that leaves the site: none may go to the CBF or ESPN. */
function watchRequests(page) {
  const outside = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) outside.push(url.hostname);
  });
  return outside;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const track = (page) => {
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !(m.location().url ?? "").includes("/_vercel/insights/")) errors.push(m.text());
    });
    return page;
  };
  try {
    await step("EN/PT/ES: the first stage as the CBF's table, real names and local crests, no feed called", async () => {
      for (const [locale, heading, tabs] of [
        ["en", "Série C Simulator", ["1st stage", "Group B", "Group C"]],
        ["pt", "Simulador da Série C", ["1ª fase", "Grupo B", "Grupo C"]],
        ["es", "Simulador de la Serie C", ["1ª fase", "Grupo B", "Grupo C"]],
      ]) {
        const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
        const outside = watchRequests(page);
        await page.goto(`${BASE_URL}/${locale}/${LEAGUE}`);
        await page.waitForLoadState("networkidle");
        assert.match(await page.locator("h1").innerText(), new RegExp(heading), locale);
        const sw = page.locator('[data-testid="group-switch"]');
        assert.deepEqual((await sw.locator("button span.sm\\:hidden").allInnerTexts()).map((x) => x.trim()), tabs, locale);
        await sw.locator("button").first().click();
        assert.deepEqual(await names(page), FIRST_PHASE, locale);
        const zones = await page.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
        assert.deepEqual(zones, [...Array(8).fill("promotionPlayoff"), ...Array(10).fill(""), "relegation", "relegation"], locale);
        // Every club's own crest, from the site itself, drawn.
        const crests = await page.locator('[data-testid="standings-row"] img').evaluateAll((imgs) => imgs.map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 })));
        assert.equal(crests.length, 20, locale);
        assert.equal(new Set(crests.map((c) => c.src)).size, 20, locale);
        for (const c of crests) {
          assert.match(c.src, /^\/crests\/serie-c\/\d+\.jpg$/, locale);
          if (!c.ok) {
            await page.locator(`img[src="${c.src}"]`).first().scrollIntoViewIfNeeded();
            await page.waitForFunction((src) => [...document.querySelectorAll(`img[src="${src}"]`)].some((i) => i.complete && i.naturalWidth > 0), c.src);
          }
        }
        assert.deepEqual([...new Set(outside)].filter((h) => /cbf|espn/.test(h)), [], `${locale}: requests to ${[...new Set(outside)].join(", ")}`);
        await page.close();
      }
    });

    await step("the groups, the final and the champion, as played", async () => {
      const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
      await page.goto(`${BASE_URL}/en/${LEAGUE}`);
      const sw = page.locator('[data-testid="group-switch"]');
      await sw.getByRole("button", { name: "Group B" }).click();
      assert.deepEqual(await names(page), ["Maringá", "Santa Cruz", "Floresta", "Botafogo-PB"]);
      const zones = await page.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.deepEqual(zones, ["promotion", "promotion", "", ""]);
      await sw.getByRole("button", { name: "Group C" }).click();
      assert.deepEqual(await names(page), ["Ferroviária", "Inter de Limeira", "Brusque", "Paysandu"]);
      // The final: Maringá host the first leg, Ferroviária (the better campaign) the second.
      await page.locator('[data-testid="matchday-select"]').selectOption("-1");
      const playoff = page.locator('[data-testid="playoff"]');
      const text = await playoff.innerText();
      assert.match(text, /Maringá[\s\S]*1[\s\S]*1[\s\S]*Ferroviária/);
      const legs = await playoff.locator("[data-fixture]").evaluateAll((rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
      assert.equal(legs.length, 2, legs.join(" | "));
      assert.match(legs[0], /Maringá.*1.*1.*Ferroviária/);
      assert.match(legs[1], /Ferroviária.*1.*2.*Maringá/);
      assert.match(await page.locator("main").innerText(), /Série C 2026 champion[\s\S]{0,80}Maringá/);
      await page.close();
    });

    await step("change a first-stage result: the groups follow, and the season can be replayed and undone", async () => {
      const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
      await page.goto(`${BASE_URL}/en/${LEAGUE}`);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.locator('[data-testid="group-switch"] button').first().click();
      // Round 1: change the first game's score.
      await page.locator('[data-testid="matchday-select"]').selectOption("1");
      const row = page.locator('[data-testid="fixtures"] [data-fixture]').first();
      await row.getByTitle("Change this result").click();
      const inputs = row.locator("input");
      await inputs.nth(0).fill("9");
      await inputs.nth(1).fill("0");
      await inputs.nth(1).press("Enter");
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="standings-row"] [data-testid="points"]')].reduce((s, e) => s + Number.parseInt(e.textContent, 10), 0) > 0);
      // The table changed with it (a 9–0), and the real first-stage table is gone.
      const after = await names(page);
      assert.equal(after.length, 20);
      // Replay the whole season, then undo it.
      const replay = page.getByTestId("replay-season");
      await replay.click();
      await page.waitForTimeout(300);
      const replayed = await names(page);
      assert.equal(replayed.length, 20);
      await page.getByRole("button", { name: "Undo" }).click();
      await page.waitForTimeout(300);
      assert.deepEqual(await names(page), after, "undo brings the table back");
      // Reset: the real season again.
      await page.getByRole("button", { name: "Reset" }).click();
      await page.getByRole("button", { name: "Reset predictions" }).click();
      await page.waitForTimeout(300);
      assert.deepEqual(await names(page), FIRST_PHASE);
      await page.close();
    });

    await step("club pages: real name and crest, the final outcome", async () => {
      const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
      const outside = watchRequests(page);
      for (const [slug, name, text] of [
        ["maringa", "Maringá", /100%/],
        ["confianca", "Confiança", /100%/],
      ]) {
        const res = await page.goto(`${BASE_URL}/en/${LEAGUE}/team/${slug}`);
        assert.equal(res.status(), 200, slug);
        assert.match(await page.locator("h1").innerText(), new RegExp(name));
        assert.match(await page.locator("main").innerText(), text);
        assert.ok((await page.locator(`main img[src^="/crests/serie-c/"]`).count()) > 0, slug);
      }
      assert.deepEqual([...new Set(outside)].filter((h) => /cbf|espn/.test(h)), []);
      await page.close();
    });

    await step("in the Brazil menu, the sitemap and the format section; fits a phone", async () => {
      const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
      await page.goto(`${BASE_URL}/en`);
      const menu = page.locator('[data-testid="league-menu"]');
      await menu.getByRole("button", { name: "South America" }).click();
      assert.deepEqual((await menu.locator("#menu-br a").allInnerTexts()).map((x) => x.trim()), ["Brasileirão Série A", "Brasileirão Série B", "Brasileirão Série C", "Copa do Brasil"]);
      const sitemap = await (await page.request.get(`${BASE_URL}/sitemap.xml`)).text();
      for (const path of [`/en/${LEAGUE}`, `/pt/${LEAGUE}`, `/es/${LEAGUE}`, `/pt/${LEAGUE}/team/santa-cruz`]) assert.match(sitemap, new RegExp(path.replace(/\//g, "\\/")));
      await page.goto(`${BASE_URL}/en/${LEAGUE}`);
      assert.match(await page.getByTestId("league-facts").innerText(), /top 8 go into two groups \(1st, 4th, 5th, 8th: Group B; 2nd, 3rd, 6th, 7th: Group C\)/);
      await page.close();
      const phone = track(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
      await phone.goto(`${BASE_URL}/pt/${LEAGUE}`);
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, "fits the screen");
      await phone.close();
    });

    assert.deepEqual(errors, []);
    console.log("Série C e2e passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
