// End-to-end checks for Colombia's Primera B, a first-party league of two
// tournaments (its own committed data, see src/lib/firstParty.ts). Runs
// against the same local build as the smoke test (FOOTSIMU_SAMPLE_DATA=1
// still shows the real Primera B):
//   BASE_URL=http://localhost:3000 node e2e/primera-b.cjs

const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LEAGUE = "colombia-primera-b";

const ONLY = process.env.E2E_ONLY;
async function step(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  process.stdout.write(`- ${name} … `);
  await fn();
  console.log("ok");
}

const names = (page) => page.locator('[data-testid="standings-row"] td:nth-child(2)').allInnerTexts().then((x) => x.map((n) => n.trim()));

/** Every request a page makes that leaves the site: none may go to ESPN, Wikipedia, X or Dimayor. */
function watchRequests(page) {
  const outside = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) outside.push(url.hostname);
  });
  return outside;
}
const thirdParty = (hosts) => [...new Set(hosts)].filter((h) => /espn|wiki|twimg|twitter|x\.com|dimayor/.test(h));

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
    await step("EN/PT/ES: both tournaments and the aggregate table, real clubs and local crests, no feed called", async () => {
      for (const [locale, heading, annual] of [
        ["en", "Colombian Primera B Simulator", "Aggregate table"],
        ["pt", "Simulador da Primera B Colombiana", "Reclassificação"],
        ["es", "Simulador de la Primera B", "Reclasificación"],
      ]) {
        const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
        const outside = watchRequests(page);
        await page.goto(`${BASE_URL}/${locale}/${LEAGUE}`);
        await page.waitForLoadState("networkidle");
        assert.match(await page.locator("h1").innerText(), new RegExp(heading), locale);
        const sw = page.locator('[data-testid="tournament-switch"]');
        assert.deepEqual((await sw.locator("button").allInnerTexts()).map((x) => x.trim()), ["Torneo I", "Torneo II", annual], locale);
        // Torneo II, under way, is shown first.
        assert.equal(await sw.getByRole("button", { name: "Torneo II" }).getAttribute("aria-pressed"), "true", locale);
        await page.locator('[data-testid="group-switch"] button').first().click();
        const clubs = await names(page);
        assert.equal(clubs.length, 16, locale);
        const crests = await page.locator('[data-testid="standings-row"] img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src")));
        assert.equal(new Set(crests).size, 16, locale);
        for (const src of crests) assert.match(src, /^\/crests\/primera-b\/\d+\.png$/, locale);
        assert.deepEqual(thirdParty(outside), [], `${locale}: requests to ${[...new Set(outside)].join(", ")}`);
        await page.close();
      }
    });

    await step("Torneo I: the groups as played and Envigado's title", async () => {
      const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
      await page.goto(`${BASE_URL}/en/${LEAGUE}`);
      await page.locator('[data-testid="tournament-switch"]').getByRole("button", { name: "Torneo I", exact: true }).click();
      const groups = page.locator('[data-testid="group-switch"]');
      await groups.getByRole("button", { name: "Group A" }).click();
      assert.deepEqual(await names(page), ["Envigado", "Deportes Quindío", "Inter de Palmira", "Tigres FC"]);
      const zones = await page.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.deepEqual(zones, ["tournamentFinal", "", "", ""]);
      await groups.getByRole("button", { name: "Group B" }).click();
      assert.deepEqual(await names(page), ["Real Cartagena", "Unión Magdalena", "Barranquilla FC", "Bogotá FC"]);
      // The final: Real Cartagena 2–3 Envigado, Envigado 1–1 Real Cartagena.
      await page.locator('[data-testid="matchday-select"]').selectOption("-1");
      const legs = await page.locator('[data-testid="playoff"] [data-fixture]').evaluateAll((rows) => rows.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
      assert.equal(legs.length, 2, legs.join(" | "));
      assert.match(legs[0], /Real Cartagena.*2.*3.*Envigado/);
      assert.match(legs[1], /Envigado.*1.*1.*Real Cartagena/);
      assert.match(await page.locator("main").innerText(), /Primera B Torneo I 2026 champion[\s\S]{0,80}Envigado/);
      await page.close();
    });

    await step("the aggregate table: every game of both tournaments, its top two marked", async () => {
      const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
      await page.goto(`${BASE_URL}/en/${LEAGUE}`);
      await page.locator('[data-testid="tournament-switch"]').getByRole("button", { name: "Aggregate table" }).click();
      const clubs = await names(page);
      assert.deepEqual(clubs.slice(0, 3), ["Deportes Quindío", "Envigado", "Real Cartagena"]);
      const points = await page.locator('[data-testid="standings-row"] [data-testid="points"]').allInnerTexts();
      assert.deepEqual(points.slice(0, 3).map((p) => Number.parseInt(p, 10)), [70, 68, 65]);
      const zones = await page.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.deepEqual(zones.slice(0, 3), ["promotionContention", "promotionContention", ""]);
      await page.close();
    });

    await step("the promotion card: Torneo I's champion, every club's chances, and the path once the season is settled", async () => {
      const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
      await page.goto(`${BASE_URL}/en/${LEAGUE}`);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      const card = page.getByTestId("promotion-path");
      assert.match(await card.locator("h2").innerText(), /Promotion to the Primera A 2027/);
      const champions = (await card.getByTestId("promotion-champions").innerText()).replace(/\s+/g, " ");
      assert.match(champions, /Torneo I champion Envigado/);
      assert.match(champions, /Torneo II champion To be decided/);
      await card.getByTestId("promotion-chances").waitFor();
      const chances = await card.getByTestId("promotion-chance").allInnerTexts();
      const first = await card.getByTestId("promotion-row").first().innerText();
      assert.match(first, /^Envigado/);
      // Two places: the chances add up to about 200%.
      const total = chances.reduce((sum, c) => sum + (Number.parseInt(c.replace(/[<>]/g, ""), 10) || 0), 0);
      assert.ok(total >= 195 && total <= 205, `${total}: ${chances.join(", ")}`);
      // Play the rest of Torneo II: both champions known, the path follows.
      await page.getByRole("button", { name: "Simulate rest of season" }).click();
      await page.waitForFunction(() => !/To be decided/.test(document.querySelector('[data-testid="promotion-champions"]')?.textContent ?? ""));
      const scenario = await card.getByTestId("promotion-scenario").innerText();
      assert.match(scenario, /go up|goes up/);
      await card.getByTestId("promotion-chances").waitFor();
      // Reset: Torneo II as it really stands.
      await page.getByRole("button", { name: "Reset" }).click();
      await page.getByRole("button", { name: "Reset predictions" }).click();
      await page.waitForFunction(() => /To be decided/.test(document.querySelector('[data-testid="promotion-champions"]')?.textContent ?? ""));
      await page.close();
    });

    await step("club pages: real name, local crest and the promotion chance", async () => {
      const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
      const outside = watchRequests(page);
      for (const [slug, name] of [
        ["envigado", "Envigado"],
        ["independiente-valle-del-cauca", "Independiente Valle del Cauca"],
      ]) {
        const res = await page.goto(`${BASE_URL}/en/${LEAGUE}/team/${slug}`);
        assert.equal(res.status(), 200, slug);
        assert.match(await page.locator("h1").innerText(), new RegExp(name));
        assert.match(await page.locator("main").innerText(), /promotion in \d+%|promotion in [<>]\d+%|Promotion/);
        assert.ok((await page.locator(`main img[src^="/crests/primera-b/"]`).count()) > 0, slug);
      }
      assert.deepEqual(thirdParty(outside), []);
      await page.close();
    });

    await step("in the Colombia menu, the sitemap and the format section; fits a phone", async () => {
      const page = track(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
      await page.goto(`${BASE_URL}/en`);
      const menu = page.locator('[data-testid="league-menu"]');
      await menu.getByRole("button", { name: "South America" }).click();
      assert.ok((await menu.locator("#menu-co a").allInnerTexts()).map((x) => x.trim()).includes("Primera B"));
      const sitemap = await (await page.request.get(`${BASE_URL}/sitemap.xml`)).text();
      for (const path of [`/en/${LEAGUE}`, `/pt/${LEAGUE}`, `/es/${LEAGUE}`, `/es/${LEAGUE}/team/envigado`]) assert.match(sitemap, new RegExp(path.replace(/\//g, "\\/")));
      await page.goto(`${BASE_URL}/en/${LEAGUE}`);
      const facts = await page.getByTestId("league-facts").innerText();
      assert.match(facts, /the top 8 go into two groups \(Group A, Group B\): the top 2 head one each and the others are drawn/);
      assert.match(facts, /Two clubs go up to the Primera A/);
      await page.close();
      const phone = track(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
      await phone.goto(`${BASE_URL}/es/${LEAGUE}`);
      await phone.getByTestId("promotion-chances").waitFor();
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, "fits the screen");
      await phone.close();
    });

    assert.deepEqual(errors, []);
    console.log("Primera B e2e passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
