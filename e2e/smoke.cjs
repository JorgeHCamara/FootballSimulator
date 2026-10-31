// End-to-end smoke test for the league simulator.
// Usage: start the app (npm run build && npm start, or npm run dev), then
//   BASE_URL=http://localhost:3000 npm run test:e2e
// Requires Playwright with Chromium (npx playwright install chromium).

const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LEAGUE = `${BASE_URL}/en/bundesliga`;

async function totalPoints(page) {
  const values = await page.locator('[data-testid="standings-row"] [data-testid="points"]').allInnerTexts();
  return values.reduce((sum, text) => sum + Number.parseInt(text, 10), 0);
}

async function tableOrder(page) {
  return page.locator('[data-testid="standings-row"] td:nth-child(2)').allInnerTexts();
}

async function step(name, fn) {
  process.stdout.write(`- ${name} … `);
  await fn();
  console.log("ok");
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  try {
    let initialPoints = 0;
    let simulatedOrder = [];

    await step("home page lists the six leagues", async () => {
      await page.goto(`${BASE_URL}/en`);
      assert.equal(await page.locator("main ul").first().locator("li").count(), 6);
    });

    await step("league table renders 18 teams", async () => {
      await page.goto(LEAGUE);
      await page.waitForLoadState("networkidle");
      assert.equal(await page.locator('[data-testid="standings-row"]').count(), 18);
      initialPoints = await totalPoints(page);
    });

    await step("table positions are marked by zone (light and dark)", async () => {
      for (const colorScheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ colorScheme });
        const p = await ctx.newPage();
        await p.goto(`${BASE_URL}/en/premier-league`);
        const zones = await p.locator('[data-testid="standings-row"]').evaluateAll((rows) =>
          rows.map((r) => ({ zone: r.dataset.zone, bg: getComputedStyle(r).backgroundColor })),
        );
        const kinds = zones.map((z) => z.zone);
        assert.deepEqual(kinds.slice(0, 6), ["championsLeague", "championsLeague", "championsLeague", "championsLeague", "europaLeague", "conferenceLeague"]);
        assert.deepEqual(kinds.slice(17), ["relegation", "relegation", "relegation"]);
        const clear = zones[10].bg;
        for (const i of [0, 4, 5, 19]) assert.notEqual(zones[i].bg, clear, `${colorScheme}: row ${i + 1} not tinted`);
        assert.notEqual(zones[0].bg, zones[19].bg, `${colorScheme}: Champions League and relegation share a colour`);
        await ctx.close();
      }
    });

    await step("simulating a matchday adds points", async () => {
      await page.getByRole("button", { name: "Simulate matchday" }).click();
      const after = await totalPoints(page);
      // 9 matches: each adds 2 (draw) or 3 (win) points to the league total.
      assert.ok(after >= initialPoints + 18 && after <= initialPoints + 27, `${initialPoints} -> ${after}`);
    });

    await step("typing a score updates the table", async () => {
      const before = await totalPoints(page);
      await page.getByRole("button", { name: "Next matchday" }).click();
      const row = page.locator('[data-testid="match-row"]').first();
      await row.locator("input").nth(0).fill("3");
      await row.locator("input").nth(1).fill("1");
      assert.equal(await totalPoints(page), before + 3);
    });

    await step("undo reverts the last change", async () => {
      const before = await totalPoints(page);
      await page.getByRole("button", { name: "Undo" }).click();
      assert.equal(await totalPoints(page), before - 3);
    });

    await step("predictions survive a reload", async () => {
      await page.getByRole("button", { name: "Simulate rest of season" }).click();
      simulatedOrder = await tableOrder(page);
      const points = await totalPoints(page);
      await page.reload();
      await page.waitForLoadState("networkidle");
      await page.waitForFunction((p) => {
        const cells = [...document.querySelectorAll('[data-testid="standings-row"] [data-testid="points"]')];
        return cells.reduce((s, c) => s + Number.parseInt(c.textContent ?? "0", 10), 0) === p;
      }, points);
      assert.deepEqual(await tableOrder(page), simulatedOrder);
    });

    await step("share link reproduces the table in a fresh browser", async () => {
      await page.getByRole("button", { name: "Share" }).click();
      const url = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(url, /\?r=/);
      const fresh = await browser.newContext();
      const other = await fresh.newPage();
      await other.goto(url);
      await other.getByText("Loaded a shared simulation.").waitFor();
      assert.deepEqual(await tableOrder(other), simulatedOrder);
      await fresh.close();
    });

    await step("chances tab shows probabilities", async () => {
      await page.getByRole("tab", { name: "Chances" }).click();
      await page.locator('[data-testid="chances"]').waitFor({ timeout: 20_000 });
      // Season fully simulated, so exactly one team has a 100% title chance.
      const titles = await page.locator('[data-testid="title-chance"]').allInnerTexts();
      assert.equal(titles.filter((x) => x === "100%").length, 1);
    });

    await step("reset asks for confirmation in a modal", async () => {
      await page.getByRole("tab", { name: "Table" }).click();
      let nativeDialog = false;
      page.on("dialog", (d) => {
        nativeDialog = true;
        d.dismiss();
      });
      const predicted = await totalPoints(page);
      const modal = page.getByRole("dialog", { name: "Reset this league?" });

      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await modal.waitFor();
      await modal.getByRole("button", { name: "Cancel" }).click();
      await modal.waitFor({ state: "hidden" });
      assert.equal(await totalPoints(page), predicted, "cancel keeps predictions");

      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await modal.waitFor();
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
      assert.equal(await totalPoints(page), predicted, "Esc keeps predictions");

      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await modal.getByRole("button", { name: "Reset predictions" }).click();
      await modal.waitFor({ state: "hidden" });
      assert.equal(await totalPoints(page), initialPoints);
      assert.equal(nativeDialog, false, "no native browser dialog");
    });

    await step("matchday dropdown is readable in dark mode", async () => {
      const ctx = await browser.newContext({ colorScheme: "dark" });
      const p = await ctx.newPage();
      await p.goto(LEAGUE);
      const colors = await p.locator('[data-testid="matchday-select"] option').first().evaluate((o) => {
        const cs = getComputedStyle(o);
        return { color: cs.color, background: cs.backgroundColor };
      });
      // Compare perceived lightness (Tailwind 4 emits lab() colours).
      const lightness = (c) => {
        const lab = c.match(/^lab\(([\d.]+)/);
        if (lab) return Number(lab[1]);
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).map(Number);
        return ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * 100;
      };
      assert.ok(lightness(colors.background) < 20, `dark background: ${colors.background}`);
      assert.ok(lightness(colors.color) > 80, `light text: ${colors.color}`);
      await ctx.close();
    });

    await step("Portuguese and Spanish pages are translated", async () => {
      await page.goto(`${BASE_URL}/pt/brasileirao`);
      await page.getByRole("button", { name: "Simular rodada" }).waitFor();
      await page.goto(`${BASE_URL}/es/la-liga`);
      await page.getByRole("button", { name: "Simular jornada" }).waitFor();
    });

    await step("table shows no +N points badge after simulating", async () => {
      await page.goto(LEAGUE);
      await page.getByRole("button", { name: "Simulate matchday" }).click();
      const cells = await page.locator('[data-testid="standings-row"] [data-testid="points"]').allInnerTexts();
      assert.ok(cells.every((c) => /^-?\d+$/.test(c.trim())), cells.join(","));
      await page.getByRole("button", { name: "Undo" }).click();
    });

    await step("SEO: titles, structured data, sitemap, robots and images", async () => {
      await page.goto(`${BASE_URL}/pt/brasileirao`);
      assert.match(await page.title(), /^Simulador do Brasileirão .* \| Foot Simu$/);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.locator("html").getAttribute("lang"), "pt-BR");
      const types = (await page.locator('script[type="application/ld+json"]').allInnerTexts())
        .flatMap((text) => JSON.parse(text)["@graph"].map((node) => node["@type"]));
      for (const type of ["WebApplication", "BreadcrumbList", "FAQPage"]) assert.ok(types.includes(type), type);
      assert.equal(await page.locator('link[rel="alternate"][hreflang="x-default"]').count(), 1);
      assert.ok(await page.locator('meta[property="og:image"]').getAttribute("content"));

      await page.goto(`${BASE_URL}/en`);
      assert.match(await page.title(), /^Football Simulator/);
      assert.equal(await page.locator("main svg[viewBox='0 0 30 20']").count() >= 6, true, "home flags");

      const sitemap = await (await page.request.get(`${BASE_URL}/sitemap.xml`)).text();
      assert.match(sitemap, /footsimu\.com\/pt\/brasileirao/);
      const robots = await (await page.request.get(`${BASE_URL}/robots.txt`)).text();
      assert.match(robots, /Sitemap: https:\/\/footsimu\.com\/sitemap\.xml/);
      for (const path of ["/en/opengraph-image", "/pt/brasileirao/opengraph-image", "/apple-icon"]) {
        const res = await page.request.get(`${BASE_URL}${path}`);
        assert.equal(res.status(), 200, path);
        assert.equal(res.headers()["content-type"], "image/png", path);
      }
    });

    assert.deepEqual(errors, [], `browser errors:\n${errors.join("\n")}`);

    await step("unknown league returns 404", async () => {
      const res = await page.goto(`${BASE_URL}/en/not-a-league`);
      assert.equal(res.status(), 404);
    });

    console.log("\nAll e2e checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error("\n", error);
  process.exit(1);
});
