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

/** E2E_ONLY="match pages" runs only the steps whose name contains it (for a quick rerun of one check). */
const ONLY = process.env.E2E_ONLY;

async function step(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
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
  page.on("console", (m) => {
    // Vercel Web Analytics' script is only served on Vercel, so it 404s locally.
    if (m.type() === "error" && !(m.location().url ?? "").includes("/_vercel/insights/")) errors.push(m.text());
  });

  try {
    let initialPoints = 0;
    let simulatedOrder = [];

    await step("home page lists the nine featured leagues", async () => {
      await page.goto(`${BASE_URL}/en`);
      const cards = (await page.locator("main ul").first().locator("li a > span > span:first-child").allInnerTexts()).map((x) => x.trim());
      assert.deepEqual(cards, ["Premier League", "Championship", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "Primeira Liga", "Brasileirão Série A", "MLS"]);
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

    let shareUrl;
    await step("share link opens the predicted table read-only in a fresh browser", async () => {
      // Desktop: the Share button next to the table opens a menu.
      await page.locator('[data-testid="actions"] [data-testid="share-button"]').click();
      const menu = page.locator('[data-testid="share-menu"]');
      await menu.waitFor();
      assert.deepEqual((await menu.locator('[role="menuitem"]').allInnerTexts()).map((x) => x.replace(/^\W+/u, "").trim()), [
        "Copy link", "Post on X", "WhatsApp", "Reddit", "Facebook", "Download image",
      ]);
      await page.locator('[data-testid="share-copy"]').click();
      await page.locator('[data-testid="share-copy"]', { hasText: "Copied!" }).waitFor();
      shareUrl = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(shareUrl, /\/en\/[a-z0-9-]+\/share\/[A-Za-z0-9_-]+$/);
      const leaguePath = new URL(shareUrl).pathname.replace(/\/share\/.*$/, "");
      assert.ok(shareUrl.length < 400, `share link ${shareUrl.length} characters`);
      // The X, WhatsApp, Reddit and Facebook links carry it.
      const x = await page.locator('[data-testid="share-x"]').getAttribute("href");
      assert.ok(x.startsWith("https://x.com/intent/post?text=") && x.includes(encodeURIComponent(shareUrl)));
      assert.ok((await page.locator('[data-testid="share-whatsapp"]').getAttribute("href")).startsWith("https://wa.me/?text="));
      assert.ok((await page.locator('[data-testid="share-reddit"]').getAttribute("href")).includes(`url=${encodeURIComponent(shareUrl)}`));
      assert.ok((await page.locator('[data-testid="share-facebook"]').getAttribute("href")).includes(`u=${encodeURIComponent(shareUrl)}`));
      assert.equal(await page.locator('[data-testid="share-download"]').getAttribute("href"), `${new URL(shareUrl).pathname}/opengraph-image`);
      // Each channel is counted (Vercel Analytics custom event).
      assert.match(await page.evaluate(() => JSON.stringify(window.vaq ?? [])), /"Share".*"copy"/);
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });

      const fresh = await browser.newContext();
      const other = await fresh.newPage();
      await other.goto(shareUrl);
      await other.locator('[data-testid="share-page"]').waitFor();
      assert.deepEqual(await tableOrder(other), simulatedOrder);
      // Read-only: no actions, no fixtures to edit.
      assert.equal(await other.locator('[data-testid="actions"]').count(), 0);
      assert.equal(await other.locator('[data-testid="fixtures"]').count(), 0);
      // Proper link-preview tags.
      const meta = (selector) => other.locator(selector).getAttribute("content");
      assert.match(await meta('meta[property="og:title"]'), /^My .+ prediction/);
      assert.ok((await meta('meta[property="og:image"]')).includes("/share/") && (await meta('meta[property="og:image"]')).includes("opengraph-image"));
      assert.equal(await meta('meta[name="twitter:card"]'), "summary_large_image");
      assert.ok((await meta('meta[name="twitter:image"]')).includes("twitter-image"));
      assert.match(await meta('meta[name="robots"]'), /noindex/);
      // "Make your own prediction": the league page; "Start from this prediction": loads it there.
      assert.equal(await other.locator('[data-testid="make-own"]').getAttribute("href"), leaguePath);
      await other.locator('[data-testid="start-from"]').click();
      await other.getByText("Loaded a shared simulation.").waitFor();
      assert.deepEqual(await tableOrder(other), simulatedOrder);
      await fresh.close();
    });

    await step("a game's row: the score, the dice and the preview link; the dice rolls likely scores", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/premier-league`);
      const fixtures = p.locator('[data-testid="fixtures"]');
      const row = fixtures.locator('[data-testid="match-row"]').filter({ has: p.locator('svg[data-icon="dices"]') }).first();
      await row.waitFor();
      // No chances, likeliest scores or tooltips by the game.
      assert.equal(await p.locator('[data-testid="match-odds"]').count(), 0);
      assert.doesNotMatch(await fixtures.innerText(), /%|Likely/);
      assert.equal(await row.locator("[title]").count(), 0, "no tooltips in the row");
      const dice = row.getByRole("button", { name: "Simulate this match" });
      assert.equal(await row.getByRole("button").count(), 1, "the dice is the only button");
      // Next to it, the game's preview page (a chart icon), both a full fingertip on phones.
      const preview = row.getByRole("link", { name: "Match preview" });
      assert.match(await preview.getAttribute("href"), /^\/en\/premier-league\/match\/[a-z0-9-]+-vs-[a-z0-9-]+-\d{4}-\d{2}-\d{2}$/);
      assert.equal(await preview.locator('svg[data-icon="chart-column"]').count(), 1);
      // Every game of the matchday has one (played ones too), and the dice where a score can still be entered.
      const rows = fixtures.locator('[data-testid="match-row"]');
      assert.equal(await fixtures.getByRole("link", { name: "Match preview" }).count(), await rows.count());
      // Rolling fills in a realistic score, a different one each time.
      const scores = [];
      const read = () => row.locator("input").evaluateAll((inputs) => inputs.map((x) => x.value).join("-"));
      for (let i = 0; i < 8; i++) {
        const before = await read();
        await dice.click();
        // The score changes (a re-roll never repeats the one already there).
        await p.waitForFunction(
          ([id, previous]) => [...document.querySelectorAll(`[data-fixture="${id}"] input`)].map((x) => x.value).join("-") !== previous,
          [await row.getAttribute("data-fixture"), before],
        );
        const [home, away] = (await read()).split("-").map(Number);
        scores.push(`${home}-${away}`);
        assert.ok(home + away <= 5, `${home}-${away}`);
      }
      for (let i = 1; i < scores.length; i++) assert.notEqual(scores[i], scores[i - 1], "each roll changes the score");
      assert.ok(new Set(scores).size <= 6, `at most 6 different scores: ${[...new Set(scores)]}`);
      await p.getByRole("button", { name: "Reset" }).click();
      const confirm = p.getByRole("dialog");
      if (await confirm.count()) await confirm.getByRole("button", { name: /Reset/ }).click();
      await p.close();
    });

    await step("cup dice: likely scores too, a different one each roll", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/fa-cup`);
      const row = p.locator('[data-testid="match-row"]').filter({ has: p.getByRole("button", { name: "Simulate this match" }) }).first();
      await row.waitFor();
      const dice = row.getByRole("button", { name: "Simulate this match" });
      const read = () => row.locator('input[type="number"]').evaluateAll((inputs) => inputs.slice(0, 2).map((x) => x.value).join("-"));
      const scores = [];
      for (let i = 0; i < 8; i++) {
        const before = await read();
        await dice.click();
        await p.waitForFunction(
          ([el, previous]) => [...el.querySelectorAll('input[type="number"]')].slice(0, 2).map((x) => x.value).join("-") !== previous,
          [await row.elementHandle(), before],
        );
        const score = await read();
        const [home, away] = score.split("-").map(Number);
        assert.ok(home + away <= 5, score);
        scores.push(score);
      }
      assert.ok(new Set(scores).size <= 6, `at most 6 different scores: ${[...new Set(scores)]}`);
      await p.close();
    });

    await step("cup buttons: Simulate round and Simulate to the final fill in realistic scores", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const goals = () =>
        p.locator('[data-testid="match-row"]').evaluateAll((rows) =>
          rows.map((r) => [...r.querySelectorAll('input[type="number"]')].slice(0, 2).map((x) => Number(x.value || 0))).filter((s) => s.length === 2),
        );
      await p.goto(`${BASE_URL}/en/fa-cup`);
      await p.getByRole("button", { name: "Simulate round" }).click();
      await p.getByRole("button", { name: "Simulate to the final" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      // Every round's games (shown round by round): none a long shot.
      const select = p.locator("select").first();
      const rounds = await select.locator("option").count().catch(() => 0);
      let checked = 0;
      for (let r = 0; r < Math.max(1, rounds); r++) {
        if (rounds) await select.selectOption({ index: r });
        for (const [home, away] of await goals()) {
          assert.ok(home + away <= 5, `${home}-${away}`);
          checked++;
        }
      }
      assert.ok(checked > 0);
      await p.close();
    });

    await step("icons are Lucide icons, not emojis", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1D400}-\u{1D7FF}]/u;
      for (const path of ["en/premier-league", "en/fa-cup", "en/argentina-primera-division"]) {
        await p.goto(`${BASE_URL}/${path}`);
        await p.locator("main").waitFor();
        const share = p.locator('[data-testid="actions"] [data-testid="share-button"]').first();
        if (await share.count()) await share.click();
        assert.doesNotMatch(await p.locator("body").innerText(), emoji, path);
      }
      // The dice, the share menu and the matchday arrows are Lucide's.
      await p.goto(`${BASE_URL}/en/premier-league`);
      assert.ok((await p.locator('[data-testid="fixtures"] svg[data-icon="dices"]').count()) > 0);
      assert.equal(await p.locator('[data-testid="fixtures"] svg[data-icon="chevron-left"]').count(), 1);
      await p.locator('[data-testid="actions"] [data-testid="share-button"]').click();
      assert.deepEqual(await p.locator('[data-testid="share-menu"] svg').evaluateAll((s) => s.map((x) => x.dataset.icon)), ["link", "send", "message-circle", "messages-square", "thumbs-up", "download"]);
      await p.close();
    });

    await step("share card: a 1200×630 PNG per league and language, cached, with a branded fallback", async () => {
      const png = async (path) => {
        const res = await page.request.get(`${BASE_URL}${path}`);
        assert.equal(res.status(), 200, path);
        assert.equal(res.headers()["content-type"], "image/png", path);
        assert.match(res.headers()["cache-control"], /s-maxage=31536000/, path);
        const body = await res.body();
        assert.equal(body.subarray(1, 4).toString(), "PNG", path);
        return { width: body.readUInt32BE(16), height: body.readUInt32BE(20), bytes: body.length };
      };
      const card = await png(`${new URL(shareUrl).pathname}/opengraph-image`);
      assert.deepEqual([card.width, card.height], [1200, 630]);
      assert.deepEqual(await png(`${new URL(shareUrl).pathname}/twitter-image`).then((c) => [c.width, c.height]), [1200, 630]);
      // Other leagues and languages, from their own Share menus.
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      for (const path of ["pt/brasileirao", "es/greek-super-league", "pt/austrian-bundesliga"]) {
        await p.goto(`${BASE_URL}/${path}`);
        await p.locator('[data-testid="actions"] [data-testid="share-button"]').click();
        const image = await p.locator('[data-testid="share-download"]').getAttribute("href");
        assert.match(image, new RegExp(`^/${path}/share/[A-Za-z0-9_-]+/opengraph-image$`));
        const c = await png(image);
        assert.deepEqual([c.width, c.height], [1200, 630], path);
      }
      await p.close();
      // An unreadable link: the league's branded card.
      const fallback = await png("/en/premier-league/share/not-a-prediction/opengraph-image");
      assert.deepEqual([fallback.width, fallback.height], [1200, 630]);
      // …and its page goes to the league page.
      const res = await page.request.get(`${BASE_URL}/en/premier-league/share/not-a-prediction`, { maxRedirects: 0 });
      assert.ok([307, 308].includes(res.status()) && res.headers().location.endsWith("/en/premier-league"));
      // Leagues without a single table (MLS) share their page, as before.
      const mls = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await mls.goto(`${BASE_URL}/en/mls`);
      await mls.locator('[data-testid="actions"] [data-testid="share-button"]').click();
      assert.match(await mls.locator('[data-testid="share-download"]').getAttribute("href"), /^\/en\/mls\/opengraph-image$/);
      await mls.close();
    });

    await step("share on phones: native share sheet, image sharing, fallbacks, thumb-sized sticky bar", async () => {
      const phone = async (init) => {
        const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
        await ctx.addInitScript(init);
        const p = await ctx.newPage();
        await p.goto(`${BASE_URL}/en/premier-league`);
        return { ctx, p, bar: p.locator('[data-testid="share-bar"]') };
      };
      // Native share available (Android Chrome, iOS Safari): one tap opens the sheet with the link.
      let { ctx, p, bar } = await phone(() => {
        window.__shares = [];
        navigator.share = async (data) => { window.__shares.push({ ...data, files: data.files?.length ?? 0 }); };
        navigator.canShare = (data) => Boolean(data?.files);
      });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 360, "no sideways scroll at 360px");
      assert.equal(await p.locator('[data-testid="actions"] [data-testid="share-button"]').isVisible(), false, "phones: no Share among the actions");
      const button = bar.locator('[data-testid="share-button"]');
      assert.ok((await button.boundingBox()).height >= 44, "at least 44px tall");
      // Static, right under the results: it never covers the table when scrolling.
      assert.equal(await bar.evaluate((e) => getComputedStyle(e.parentElement).position), "static");
      const tableBox = await p.locator('[data-testid="standings"]').boundingBox();
      const barBox = await bar.boundingBox();
      assert.ok(barBox.y >= tableBox.y + tableBox.height, "the bar is below the table");
      await p.locator('[data-testid="standings-row"]').nth(5).scrollIntoViewIfNeeded();
      const covered = await p.evaluate(() => {
        const bar = document.querySelector('[data-testid="share-bar"]').getBoundingClientRect();
        return [...document.querySelectorAll('[data-testid="standings-row"]')].some((r) => {
          const row = r.getBoundingClientRect();
          return row.bottom > bar.top && row.top < bar.bottom;
        });
      });
      assert.equal(covered, false, "no table row under the bar");
      await button.tap();
      await p.waitForFunction(() => window.__shares.length === 1);
      const shared = await p.evaluate(() => window.__shares[0]);
      assert.match(shared.url, /\/en\/premier-league\/share\//);
      assert.match(shared.title, /Premier League/);
      assert.equal(await p.locator('[data-testid="share-menu"]').count(), 0, "no menu after sharing");
      // Files can be shared: the card itself (Stories, Status).
      await bar.locator('[data-testid="share-image"]').tap();
      await p.waitForFunction(() => window.__shares.length === 2, null, { timeout: 30000 });
      assert.equal(await p.evaluate(() => window.__shares[1].files), 1);
      await ctx.close();

      // Closing the share sheet is not an error: nothing else opens.
      ({ ctx, p, bar } = await phone(() => {
        navigator.share = async () => { throw new DOMException("Share canceled", "AbortError"); };
      }));
      await bar.locator('[data-testid="share-button"]').tap();
      await p.waitForTimeout(300);
      assert.equal(await p.locator('[data-testid="share-menu"]').count(), 0);
      await ctx.close();

      // A failing share sheet falls back to the menu, with a note.
      ({ ctx, p, bar } = await phone(() => {
        navigator.share = async () => { throw new DOMException("Not supported", "NotSupportedError"); };
      }));
      await bar.locator('[data-testid="share-button"]').tap();
      await p.locator('[data-testid="share-menu"]').waitFor();
      assert.match(await p.locator('[data-testid="share-menu"]').innerText(), /Couldn't open the share sheet/);
      await ctx.close();

      // No Web Share API (older browsers, desktop Firefox): the menu, and no image button.
      ({ ctx, p, bar } = await phone(() => {
        delete Navigator.prototype.share;
        delete navigator.share;
      }));
      assert.equal(await bar.locator('[data-testid="share-image"]').count(), 0);
      await bar.locator('[data-testid="share-button"]').tap();
      await p.locator('[data-testid="share-menu"]').waitFor();
      await p.locator('[data-testid="share-copy"]').tap();
      await p.locator('[data-testid="share-copy"]', { hasText: "Copied!" }).waitFor();
      await ctx.close();
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
      // Played games show their score and kick-off only: no "Final" label that reads like a cup final.
      await p.locator('[data-testid="matchday-select"]').selectOption({ index: 0 });
      const played = p.locator('[data-testid="fixtures"] [data-testid="match-row"]');
      assert.ok((await played.count()) > 0);
      for (const row of await played.allInnerTexts()) assert.doesNotMatch(row, /\bfinal\b/i, row);
      await ctx.close();
    });

    await step("Série B play-off decides the four promoted clubs", async () => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/en/brasileirao-serie-b`);
      // The play-off is the last entry in the matchday selector, after Matchday 38.
      const options = await p.locator('[data-testid="matchday-select"] option').allInnerTexts();
      assert.deepEqual(options.slice(-2), ["Matchday 38", "Play-off"]);
      await p.locator('[data-testid="matchday-select"]').selectOption({ label: "Play-off" });
      await p.locator('[data-testid="fixtures"] [data-testid="playoff"]').waitFor();
      assert.equal(await p.locator('[data-testid="playoff-tie"]').count(), 2);
      // Before the league ends the legs show positions, not clubs.
      const placeholders = await p.locator('[data-testid="playoff-placeholder"]').allInnerTexts();
      assert.equal(placeholders.length, 4);
      assert.match(placeholders[0], /6th place[\s\S]*3rd place/);
      assert.match(placeholders[1], /3rd place[\s\S]*6th place/);
      assert.match(placeholders[2], /5th place[\s\S]*4th place/);
      assert.equal(await p.getByRole("button", { name: "Simulate matchday" }).isDisabled(), true, "play-off locked until the season ends");
      assert.equal(await p.locator('[data-testid="promoted-team"]').count(), 0, "nothing promoted before the season ends");

      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="promoted-team"]').first().waitFor();
      const promoted = await p.locator('[data-testid="promoted-team"]').allInnerTexts();
      assert.equal(promoted.length, 4);
      assert.equal(await p.locator('[data-testid="playoff-result"]').count(), 2);

      // 1st and 2nd go up directly; each play-off winner is one of its tie's two clubs.
      const names = await p.locator('[data-testid="standings-row"] td:nth-child(2)').allInnerTexts();
      assert.ok(promoted[0].includes(names[0]) && promoted[1].includes(names[1]), "1st and 2nd promoted");
      const winners = promoted.slice(2).map((x) => x.split("\n")[0]);
      assert.ok([names[2], names[5]].some((n) => winners[0].includes(n) || n.includes(winners[0])), "3v6 winner");
      assert.ok([names[3], names[4]].some((n) => winners[1].includes(n) || n.includes(winners[1])), "4v5 winner");
      await ctx.close();
    });

    await step("Championship 2026/27 play-off: eliminators, semis, Wembley final, 3 promoted", async () => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await p.goto(`${BASE_URL}/en/championship`);
      assert.equal(await p.locator('[data-testid="standings-row"]').count(), 24);
      const options = await p.locator('[data-testid="matchday-select"] option').allInnerTexts();
      assert.deepEqual(options.slice(-2), ["Matchday 46", "Play-off"]);
      await p.locator('[data-testid="matchday-select"]').selectOption({ label: "Play-off" });
      const rounds = await p.locator('[data-testid="playoff-round"] h3').allInnerTexts();
      assert.deepEqual(rounds.map((r) => r.toLowerCase()), ["eliminators", "semi-finals", "final"]);
      const placeholders = await p.locator('[data-testid="playoff-placeholder"]').allInnerTexts();
      assert.match(placeholders[0], /5th place[\s\S]*8th place/);

      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="promoted-team"]').first().waitFor();
      assert.equal(await p.locator('[data-testid="promoted-team"]').count(), 3);
      assert.equal(await p.locator('[data-testid="playoff-result"]').count(), 5, "2 eliminators, 2 semis, 1 final");
      assert.match(await p.locator('[data-testid="playoff-result"]').last().innerText(), /goes up to Premier League/);
      assert.match(await p.locator('[data-testid="promoted"] h2').innerText(), /Premier League \d{4}/); // "2027/28" with real data
      await ctx.close();
    });

    await step("Primeira Liga and Eredivisie pages; Série B and Eredivisie stay in the menu", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      for (const slug of ["primeira-liga", "eredivisie"]) {
        await p.goto(`${BASE_URL}/en/${slug}`);
        assert.equal(await p.locator('[data-testid="standings-row"]').count(), 18, slug);
      }
      await p.goto(`${BASE_URL}/pt`);
      const menu = p.locator('[data-testid="league-menu"]');
      await menu.getByRole("button", { name: "América do Sul" }).click();
      assert.deepEqual((await menu.locator("#menu-br a").allInnerTexts()).map((x) => x.trim()), ["Brasileirão Série A", "Brasileirão Série B", "Copa do Brasil"]);
      await p.close();
    });

    await step("League One and League Two: 24 clubs, zones and play-offs", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const expected = {
        "league-one": { promotion: [1, 2], promotionPlayoff: [3, 6], relegation: [21, 24], semi: /3rd place × 6th place/ },
        "league-two": { promotion: [1, 3], promotionPlayoff: [4, 7], relegation: [23, 24], semi: /4th place × 7th place/ },
      };
      for (const [slug, zones] of Object.entries(expected)) {
        await p.goto(`${BASE_URL}/en/${slug}`);
        const kinds = await p.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
        assert.equal(kinds.length, 24, slug);
        for (const kind of ["promotion", "promotionPlayoff", "relegation"]) {
          const [from, to] = zones[kind];
          const at = kinds.flatMap((k, i) => (k === kind ? [i + 1] : []));
          assert.deepEqual([at[0], at.at(-1), at.length], [from, to, to - from + 1], `${slug} ${kind}`);
        }
        await p.locator('[data-testid="matchday-select"]').selectOption("-1");
        assert.match(await p.locator('[data-testid="playoff"]').innerText(), zones.semi, slug);
      }
      await p.close();
    });

    await step("2. Bundesliga, Serie B and Ligue 2: zones, play-offs, menus", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const expected = {
        "2-bundesliga": { rows: 18, zones: { promotion: [1, 2], promotionPlayoff: [3, 3], relegationPlayoff: [16, 16], relegation: [17, 18] } },
        "serie-b": { rows: 20, zones: { promotion: [1, 2], promotionPlayoff: [3, 8], relegationPlayoff: [16, 17], relegation: [18, 20] }, rounds: ["preliminary round", "semi-finals", "final"], text: /5th place × 8th place/ },
        "ligue-2": { rows: 18, zones: { promotion: [1, 2], promotionPlayoff: [3, 5], relegationPlayoff: [16, 16], relegation: [17, 18] }, rounds: ["play-off 1", "play-off 2"], text: /4th place × 5th place/ },
      };
      for (const [slug, e] of Object.entries(expected)) {
        await p.goto(`${BASE_URL}/en/${slug}`);
        const kinds = await p.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
        assert.equal(kinds.length, e.rows, slug);
        for (const [kind, [from, to]] of Object.entries(e.zones)) {
          const at = kinds.flatMap((k, i) => (k === kind ? [i + 1] : []));
          assert.deepEqual([at[0], at.at(-1), at.length], [from, to, to - from + 1], `${slug} ${kind}`);
        }
        const options = await p.locator('[data-testid="matchday-select"] option').allInnerTexts();
        if (!e.rounds) {
          assert.ok(!options.includes("Play-off"), `${slug}: no bracket (play-offs against other leagues)`);
          continue;
        }
        await p.locator('[data-testid="matchday-select"]').selectOption("-1");
        const playoff = p.locator('[data-testid="playoff"]');
        assert.deepEqual((await playoff.locator('[data-testid="playoff-round"] h3').allInnerTexts()).map((x) => x.trim().toLowerCase()), e.rounds, slug);
        assert.match(await playoff.innerText(), e.text, slug);
      }
      // Ligue 2: the play-off winner isn't promoted yet, it faces Ligue 1's 16th.
      await p.goto(`${BASE_URL}/en/ligue-2`);
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="promoted-contender"]').waitFor();
      assert.equal(await p.locator('[data-testid="promoted-team"]').count(), 2);
      assert.match(await p.locator('[data-testid="promoted-contender"]').innerText(), /plays Ligue 1's 16th over two legs/);
      // Header: the second divisions sit under their country, top division first.
      const menu = p.locator('[data-testid="league-menu"]');
      for (const [country, flag, leagues] of [["Germany", "de", ["Bundesliga", "2. Bundesliga", "DFB-Pokal"]], ["Italy", "it", ["Serie A", "Serie B", "Coppa Italia"]], ["France", "fr", ["Ligue 1", "Ligue 2"]]]) {
        // Countries sit in the Europe panel.
        await menu.getByRole("button", { name: "Europe" }).click();
        await menu.locator(`#menu-${flag}`).waitFor();
        assert.deepEqual((await menu.locator(`#menu-${flag} a`).allInnerTexts()).map((x) => x.trim()), leagues, country);
        await p.keyboard.press("Escape");
      }
      await p.close();
    });

    await step("Eerste Divisie: reserve teams can't go up, places pass to first teams", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/eerste-divisie`);
      const rows = p.locator('[data-testid="standings-row"]');
      assert.equal(await rows.count(), 20);
      const info = await rows.evaluateAll((r) => r.map((x) => ({ zone: x.dataset.zone, reserve: !!x.querySelector('[data-testid="reserve-tag"]') })));
      assert.equal(info.filter((r) => r.reserve).length, 2, "two reserve sides in the sample");
      assert.ok(info.filter((r) => r.reserve).every((r) => r.zone === ""), "reserve sides have no zone");
      const firstTeams = info.filter((r) => !r.reserve).map((r) => r.zone);
      assert.deepEqual(firstTeams.slice(0, 9), ["promotion", "promotion", ...Array(6).fill("promotionPlayoff"), ""]);
      assert.match(await p.locator("main").innerText(), /Reserve teams can't be promoted/);
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="promoted-contender"]').waitFor();
      const promoted = await p.locator('[data-testid="promoted-team"]').allInnerTexts();
      assert.equal(promoted.length, 2);
      assert.ok(promoted.every((t) => !t.startsWith("Jong")), promoted.join(" | "));
      assert.match(await p.locator('[data-testid="promoted-contender"]').innerText(), /plays Eredivisie's 16th over two legs/);
      await p.locator('[data-testid="matchday-select"]').selectOption("-1");
      assert.doesNotMatch(await p.locator('[data-testid="playoff"]').innerText(), /^Jong /m);
      await p.close();
    });

    await step("Segunda División: 22 clubs, B teams skipped, two-legged play-off", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/segunda-division`);
      const rows = p.locator('[data-testid="standings-row"]');
      assert.equal(await rows.count(), 22);
      const info = await rows.evaluateAll((r) => r.map((x) => ({ zone: x.dataset.zone, reserve: !!x.querySelector('[data-testid="reserve-tag"]'), name: x.innerText })));
      assert.deepEqual(info.filter((r) => r.reserve).map((r) => /Real Sociedad II|RC Celta Fortuna/.test(r.name)), [true, true]);
      const firstTeams = info.filter((r) => !r.reserve).map((r) => r.zone);
      assert.deepEqual(firstTeams.slice(0, 7), ["promotion", "promotion", ...Array(4).fill("promotionPlayoff"), ""]);
      // Relegation follows the real position, reserve sides included: 19th–22nd.
      assert.deepEqual(info.slice(18).map((r) => r.zone), Array(4).fill("relegation"));
      assert.ok(info.slice(0, 18).every((r) => r.zone !== "relegation"));
      await p.locator('[data-testid="matchday-select"]').selectOption("-1");
      const text = await p.locator('[data-testid="playoff"]').innerText();
      assert.match(text, /3rd place × 6th place/);
      assert.match(text, /hosts the 2nd leg and goes through if the aggregate is level/);
      await p.close();
    });

    await step("FA Cup: round cards, simulated draws, bracket, champion, chances, share", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/fa-cup`);
      const bar = p.locator('[data-testid="round-bar"] button');
      assert.deepEqual(
        (await bar.allInnerTexts()).map((x) => x.split("\n")[0].replace(/\s*✓$/, "").trim()),
        ["First Round", "Second Round", "Third Round", "Fourth Round", "Fifth Round", "Quarter-finals", "Semi-finals", "Final"],
      );
      const ties = p.locator('[data-testid="cup-tie"]');
      assert.equal(await ties.count(), 40, "40 first-round ties");
      assert.equal(await ties.first().locator("input").count(), 0, "played ties show the result");
      assert.match(await p.locator('[data-testid="round-grid"]').innerText(), /L1|L2|NL/, "division tags");
      await bar.nth(1).click();
      await p.locator('[data-testid="pending-round"]').waitFor();
      assert.match(await p.locator('[data-testid="pending-round"]').innerText(), /after the First Round/);
      await bar.nth(0).click();

      // Penalties only while the game is level; a winner clears the shoot-out score.
      const openTie = ties.filter({ has: p.locator("input") }).first();
      const fixtureId = await openTie.locator('[data-testid="match-row"]').getAttribute("data-fixture");
      const tie = p.locator(`[data-testid="cup-tie"]:has([data-fixture="${fixtureId}"])`);
      await tie.locator("input").nth(0).fill("1");
      await tie.locator("input").nth(1).fill("1");
      const line = tie.locator('[data-testid="shootout-line"]');
      await line.waitFor();
      await line.locator("input").nth(0).fill("4");
      await line.locator("input").nth(1).fill("3");
      assert.equal(await tie.getAttribute("data-winner"), await tie.getAttribute("data-home"));
      // Every card in the round is as tall as the one with penalties, at 3 and 2 columns.
      for (const width of [1280, 900]) {
        await p.setViewportSize({ width, height: 900 });
        const heights = await ties.evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height)))]);
        assert.equal(heights.length, 1, `equal card heights at ${width}px: ${heights.join(", ")}`);
      }
      await p.setViewportSize({ width: 1280, height: 900 });
      await tie.locator("input").nth(0).fill("2");
      await line.waitFor({ state: "detached" });
      assert.equal(await tie.getAttribute("data-winner"), await tie.getAttribute("data-home"));
      await tie.locator("input").nth(0).fill("0");
      await tie.locator("input").nth(1).fill("0");
      await line.waitFor();
      assert.deepEqual(await line.locator("input").evaluateAll((els) => els.map((e) => e.value)), ["", ""], "old shoot-out score cleared");
      assert.equal(await tie.getAttribute("data-winner"), "");
      await p.getByRole("button", { name: "Reset" }).click();
      await p.getByRole("button", { name: "Reset predictions" }).click();

      // Simulate the first round: the second round is drawn, each winner once.
      await p.getByRole("button", { name: "Simulate round" }).click();
      await p.locator('[data-testid="simulated-draw-note"]').waitFor();
      assert.equal(await ties.count(), 20, "second round drawn");
      const clubs = await ties.evaluateAll((els) => els.flatMap((e) => [e.dataset.home, e.dataset.away]));
      assert.equal(new Set(clubs).size, 40, "every winner exactly once in the second round");
      const before = await ties.evaluateAll((els) => els.map((e) => e.textContent));
      await p.locator('[data-testid="new-draw"]').click();
      await p.waitForTimeout(200);
      const after = await ties.evaluateAll((els) => els.map((e) => e.textContent));
      assert.notDeepEqual(before, after, "New draw reshuffles");

      // Down to the final: bracket, Wembley, champion with a road to the final.
      await p.getByRole("button", { name: "Simulate to the final" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      assert.equal(await p.locator('[data-testid="bracket-round"]').count(), 3);
      assert.match(await p.locator('[data-testid="cup-bracket"]').innerText(), /Wembley/);
      assert.equal(await p.locator('[data-testid="cup-tie"]').count(), 7, "4 quarter-finals, 2 semis, 1 final");
      // The bracket follows the draw: each semi-final's quarter-finals sit beside it, home side's first.
      const column = (i) => p.locator('[data-testid="bracket-round"]').nth(i).locator('[data-testid="cup-tie"]').evaluateAll((els) => els.map((e) => ({ home: e.dataset.home, away: e.dataset.away, winner: e.dataset.winner })));
      const [qf, sf, fin] = [await column(0), await column(1), await column(2)];
      assert.deepEqual(qf.map((t) => t.winner), sf.flatMap((t) => [t.home, t.away]), "quarter-finals ordered by the semi-final draw");
      assert.deepEqual(sf.map((t) => t.winner), [fin[0].home, fin[0].away], "semi-finals ordered by the final");
      const champion = await p.locator('[data-testid="champion"]').innerText();
      assert.match(champion, /FA Cup \d{4}\/\d{2} winner/);
      assert.match(champion, /Third Round: \d+–\d+ v /);
      assert.ok((await bar.allInnerTexts()).every((x) => x.includes("Complete")));

      // Share link reproduces the bracket and champion in a fresh browser.
      const shareUrl = await p.evaluate(async () => {
        const original = navigator.clipboard.writeText;
        let copied = "";
        navigator.clipboard.writeText = async (text) => { copied = text; };
        document.querySelector('[data-testid="actions"] button:last-child').click();
        await new Promise((r) => setTimeout(r, 50));
        navigator.clipboard.writeText = original;
        return copied;
      });
      assert.match(shareUrl, /[?&]r=/);
      const fresh = await (await browser.newContext()).newPage();
      await fresh.goto(shareUrl);
      await fresh.locator('[data-testid="champion-team"]').waitFor();
      assert.equal(await fresh.locator('[data-testid="champion-team"]').innerText(), await p.locator('[data-testid="champion-team"]').innerText());
      await fresh.context().close();

      // Chances: every club still in (per the real results), win chances add up to about 100%.
      await p.getByRole("button", { name: "Reset" }).click();
      await p.getByRole("button", { name: "Reset predictions" }).click();
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="cup-chances"]').waitFor({ timeout: 90000 });
      await p.getByRole("button", { name: /Show all/ }).click();
      const rows = await p.locator('[data-testid="cup-chance-row"]').count();
      assert.equal(rows, 80 - 20 + 44, "60 first-round survivors/unplayed clubs plus 44 entrants");
      const wins = await p.locator('[data-testid="cup-win-chance"]').allInnerTexts();
      const total = wins.reduce((n, x) => n + (x === "–" ? 0 : x.startsWith("<") ? 0.05 : parseFloat(x)), 0);
      assert.ok(total > 90 && total < 110, `win chances sum to ${total}%`);
      await p.close();

      // Phone: no horizontal scroll; header menu lists the cup under England.
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await phone.goto(`${BASE_URL}/en/fa-cup`);
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390);
      await phone.close();
    });

    await step("Copa do Brasil: two-legged ties with aggregate, waiting rounds, neutral final", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/copa-do-brasil`);
      const bar = p.locator('[data-testid="round-bar"] button');
      assert.equal(await bar.count(), 9);
      assert.match((await bar.nth(5).innerText()).split("\n")[0], /Round of 16/);
      const ties = p.locator('[data-testid="cup-tie"]');
      assert.equal(await ties.count(), 14, "14 first-round ties");
      assert.match(await p.locator('[data-testid="round-grid"]').innerText(), /\bB\b/, "Série B tags");
      await p.getByRole("button", { name: "Simulate to the final" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      // Fifth round: two legs, the second at the other club, and the aggregate.
      await bar.nth(4).click();
      assert.equal(await ties.count(), 16);
      const first = ties.first();
      assert.equal(await first.getAttribute("data-legs"), "2");
      const legs = await first.locator('[data-testid="match-row"]').allInnerTexts();
      assert.match(legs[0], /1st leg/);
      assert.match(legs[1], /2nd leg/);
      assert.match(await first.locator('[data-testid="cup-aggregate"]').innerText(), /Aggregate: .+ \d+–\d+ /);
      const fifthHeights = await ties.evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height)))]);
      assert.equal(fifthHeights.length, 1, `equal two-legged card heights: ${fifthHeights.join(", ")}`);
      // Bracket: two-legged quarter- and semi-finals, a single neutral final.
      await bar.nth(8).click();
      const bracketTies = p.locator('[data-testid="cup-bracket"] [data-testid="cup-tie"]');
      assert.deepEqual(await bracketTies.evaluateAll((els) => els.map((e) => e.dataset.legs)), ["2", "2", "2", "2", "2", "2", "1"]);
      assert.match(await p.locator('[data-testid="cup-bracket"]').innerText(), /Mané Garrincha/);
      assert.match(await p.locator('[data-testid="champion"]').innerText(), /Copa do Brasil \d{4} winner/);
      assert.ok(!(await p.locator('[data-testid="simulated-draw-note"]').isVisible()), "the final isn't a draw");
      await p.close();
    });

    await step("Copa del Rey: two-legged qualifier, lower club at home, La Cartuja final", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/copa-del-rey`);
      const bar = p.locator('[data-testid="round-bar"] button');
      assert.deepEqual(
        (await bar.allInnerTexts()).map((x) => x.split("\n")[0].replace(/\s*✓$/, "").trim()),
        ["Qualifying round", "First Round", "Second Round", "Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
      );
      assert.equal(await p.locator('[data-testid="cup-tie"]').first().getAttribute("data-legs"), "2");
      await p.getByRole("button", { name: "Simulate to the final" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      await bar.nth(7).click();
      const legs = await p.locator('[data-testid="cup-bracket"] [data-testid="cup-tie"]').evaluateAll((els) => els.map((e) => e.dataset.legs));
      assert.deepEqual(legs, ["1", "1", "1", "1", "2", "2", "1"]);
      assert.match(await p.locator('[data-testid="cup-bracket"]').innerText(), /La Cartuja/);
      // Spain's menu: La Liga, Segunda División, Copa del Rey.
      const menu = p.locator('[data-testid="league-menu"]');
      await menu.getByRole("button", { name: "Europe" }).click();
      assert.deepEqual((await menu.locator("#menu-es a").allInnerTexts()).map((x) => x.trim()), ["La Liga", "Segunda División", "Copa del Rey"]);
      await p.close();
    });

    await step("Coppa Italia: fixed bracket from the round of 16, two-legged semis, Olimpico final", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/coppa-italia`);
      const bar = p.locator('[data-testid="round-bar"] button');
      assert.deepEqual(
        (await bar.allInnerTexts()).map((x) => x.split("\n")[0].replace(/\s*✓$/, "").trim()),
        ["Preliminary round", "First Round", "Second Round", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
      );
      const ties = p.locator('[data-testid="cup-tie"]');
      assert.equal(await ties.count(), 4, "4 preliminary-round ties");
      // Up to the round of 16, then the quarter-finals list the fixed pairings before anyone's through.
      for (let i = 0; i < 3; i++) await p.getByRole("button", { name: "Simulate round" }).click();
      await bar.nth(3).click();
      assert.equal(await ties.count(), 8);
      await bar.nth(4).click();
      const pairings = (i) => p.locator('[data-testid="bracket-round"]').nth(i).locator('[data-testid="bracket-pairings"] li').allInnerTexts();
      assert.equal((await pairings(0)).length, 4, "fixed quarter-final pairings listed");
      assert.equal((await pairings(1)).length, 2, "semi-finals: each side's four clubs");
      assert.equal((await pairings(1))[0].split(" / ").length, 7, "4 + 4 clubs, joined by 'v'");
      assert.deepEqual(await pairings(2), ["Winner of SF 1 v Winner of SF 2"]);
      assert.match((await bar.nth(4).innerText()), /Fixed bracket/);
      // The bracket: quarter-final i is between the winners of round-of-16 ties 2i and 2i+1, no draw.
      await p.getByRole("button", { name: "Simulate to the final" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      await bar.nth(3).click();
      const r16Winners = await ties.evaluateAll((els) => els.map((e) => e.dataset.winner));
      await bar.nth(6).click();
      const column = (i) => p.locator('[data-testid="bracket-round"]').nth(i).locator('[data-testid="cup-tie"]').evaluateAll((els) => els.map((e) => ({ home: e.dataset.home, away: e.dataset.away, winner: e.dataset.winner, legs: e.dataset.legs })));
      const [qf, sf, fin] = [await column(0), await column(1), await column(2)];
      assert.deepEqual(qf.flatMap((t) => [t.home, t.away]), r16Winners, "quarter-finals follow the bracket");
      assert.deepEqual(sf.flatMap((t) => [t.home, t.away]), qf.map((t) => t.winner), "semi-finals follow the bracket");
      assert.deepEqual([fin[0].home, fin[0].away], sf.map((t) => t.winner));
      assert.deepEqual([...qf, ...sf, ...fin].map((t) => t.legs), ["1", "1", "1", "1", "2", "2", "1"]);
      assert.match(await p.locator('[data-testid="cup-bracket"]').innerText(), /Stadio Olimpico/);
      assert.match(await p.locator('[data-testid="champion"]').innerText(), /Coppa Italia \d{4}\/\d{2} winner/);
      assert.ok(!(await p.locator('[data-testid="simulated-draw-note"]').isVisible()), "no draw in a fixed bracket");
      // Italy's menu: Serie A, Serie B, Coppa Italia.
      const menu = p.locator('[data-testid="league-menu"]');
      await menu.getByRole("button", { name: "Europe" }).click();
      assert.deepEqual((await menu.locator("#menu-it a").allInnerTexts()).map((x) => x.trim()), ["Serie A", "Serie B", "Coppa Italia"]);
      await p.close();
    });

    await step("DFB-Pokal: single games, amateurs at home to professional clubs, Berlin final", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/dfb-pokal`);
      const bar = p.locator('[data-testid="round-bar"] button');
      assert.deepEqual(
        (await bar.allInnerTexts()).map((x) => x.split("\n")[0].replace(/\s*✓$/, "").trim()),
        ["First Round", "Second Round", "Round of 16", "Quarter-finals", "Semi-finals", "Final"],
      );
      const ties = p.locator('[data-testid="cup-tie"]');
      assert.equal(await ties.count(), 32, "32 first-round ties");
      assert.match(await p.locator('[data-testid="round-grid"]').innerText(), /\b2BL\b/, "2. Bundesliga tags");
      await p.getByRole("button", { name: "Simulate to the final" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      await bar.nth(2).click();
      assert.equal(await ties.count(), 8, "round of 16 drawn");
      await bar.nth(5).click();
      const legs = await p.locator('[data-testid="cup-bracket"] [data-testid="cup-tie"]').evaluateAll((els) => els.map((e) => e.dataset.legs));
      assert.deepEqual(legs, ["1", "1", "1", "1", "1", "1", "1"]);
      assert.match(await p.locator('[data-testid="cup-bracket"]').innerText(), /Olympiastadion Berlin/);
      assert.match(await p.locator('[data-testid="champion"]').innerText(), /DFB-Pokal \d{4}\/\d{2} winner/);
      const menu = p.locator('[data-testid="league-menu"]');
      await menu.getByRole("button", { name: "Europe" }).click();
      assert.deepEqual((await menu.locator("#menu-de a").allInnerTexts()).map((x) => x.trim()), ["Bundesliga", "2. Bundesliga", "DFB-Pokal"]);
      await p.close();
    });

    await step("Champions League: 36-club league phase, knockout phase to the final, win chances", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/champions-league`);
      const rows = p.locator('[data-testid="standings-row"]');
      assert.equal(await rows.count(), 36);
      const zones = await rows.evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.deepEqual([zones[0], zones[7], zones[8], zones[23], zones[24], zones[35]], ["knockoutRoundOf16", "knockoutRoundOf16", "knockoutPlayoff", "knockoutPlayoff", "eliminated", "eliminated"]);
      const select = p.locator('[data-testid="matchday-select"]');
      const options = await select.locator("option").allInnerTexts();
      assert.equal(options.length, 9, "8 matchdays and the knockout phase");
      assert.equal(options.at(-1), "Knockout phase");
      assert.equal(await p.locator('[data-testid="fixtures"] [data-testid="match-row"]').count(), 18, "18 games a matchday");
      // Before the league phase ends: projected pairings by position.
      await select.selectOption({ label: "Knockout phase" });
      const rounds = p.locator('[data-testid="playoff-round"]');
      assert.equal(await rounds.count(), 1, "one knockout round at a time");
      assert.match(await rounds.first().innerText(), /9th place[\s\S]*24th place/);
      // Simulate the league phase and the whole knockout phase.
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      assert.match(await p.locator('[data-testid="champion"]').innerText(), /Champions League/);
      await p.locator('[data-testid="knockout-draw-note"]').waitFor();
      assert.match(await p.locator('[data-testid="playoff"]').innerText(), /Metropolitano/);
      // One round at a time: the final is shown once everything is decided; each tab has its ties.
      const tabs = p.locator('[data-testid="knockout-rounds"] button');
      assert.deepEqual(await tabs.allInnerTexts(), ["Play-off", "Round of 16", "QF", "SF", "Final"]);
      const perRound = [];
      for (let i = 0; i < 5; i++) {
        await tabs.nth(i).click();
        perRound.push(await p.locator('[data-testid="playoff-tie"]').count());
      }
      assert.deepEqual(perRound, [8, 8, 4, 2, 1]);
      // Chances: top 8, top 24, final and win columns; win chances add up to about 100%.
      await p.getByRole("button", { name: "Reset" }).click();
      await p.getByRole("button", { name: "Reset predictions" }).click();
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="win-chance"]').first().waitFor({ timeout: 90000 });
      const wins = await p.locator('[data-testid="win-chance"]').allInnerTexts();
      assert.equal(wins.length, 36);
      const total = wins.reduce((n, x) => n + (x === "–" ? 0 : x.startsWith("<") ? 0.05 : parseFloat(x)), 0);
      assert.ok(total > 90 && total < 110, `win chances sum to ${total}%`);
      await p.close();
    });

    await step("Copa Libertadores: eight group tables, knockout seeded from the groups, win chances", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/copa-libertadores`);
      const rows = p.locator('[data-testid="standings-row"]');
      assert.equal(await rows.count(), 4, "one group at a time");
      assert.deepEqual(await rows.evaluateAll((r) => r.map((x) => x.dataset.zone)), ["knockoutRoundOf16", "knockoutRoundOf16", "sudamericana", "eliminated"]);
      const groups = p.locator('[data-testid="group-switch"] button');
      assert.deepEqual(await groups.allInnerTexts(), ["Group A", "B", "C", "D", "E", "F", "G", "H"]);
      const groupA = await rows.allInnerTexts();
      await p.getByRole("button", { name: "Group C" }).click();
      await p.waitForFunction((before) => document.querySelector('[data-testid="standings-row"]')?.textContent !== before, groupA[0]);
      assert.deepEqual(await groups.allInnerTexts(), ["A", "B", "Group C", "D", "E", "F", "G", "H"]);
      const options = await p.locator('[data-testid="matchday-select"] option').allInnerTexts();
      assert.equal(options.length, 7, "6 matchdays and the knockout phase");
      // Before the groups end: the round of 16 is projected by seed (1st v 16th…).
      await p.locator('[data-testid="matchday-select"]').selectOption({ label: "Knockout phase" });
      assert.deepEqual(await p.locator('[data-testid="knockout-rounds"] button').allInnerTexts(), ["Round of 16", "QF", "SF", "Final"]);
      assert.match(await p.locator('[data-testid="playoff-round"]').innerText(), /1st place[\s\S]*16th place/);
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      assert.match(await p.locator('[data-testid="champion"]').innerText(), /Copa Libertadores/);
      assert.match(await p.locator('[data-testid="playoff"]').innerText(), /Estadio Centenario/);
      // Every group's top two are in the round of 16.
      await p.locator('[data-testid="knockout-rounds"] button', { hasText: "Round of 16" }).click();
      assert.equal(await p.locator('[data-testid="playoff-tie"]').count(), 8);
      await p.getByRole("button", { name: "Reset" }).click();
      await p.getByRole("button", { name: "Reset predictions" }).click();
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="win-chance"]').first().waitFor({ timeout: 90000 });
      assert.match(await p.locator('[data-testid="chances"] thead').innerText(), /Top 2/);
      await p.close();
    });

    await step("Copa Sudamericana: group winners to the round of 16, runners-up to the play-off", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/copa-sudamericana`);
      const rows = p.locator('[data-testid="standings-row"]');
      assert.deepEqual(await rows.evaluateAll((r) => r.map((x) => x.dataset.zone)), ["knockoutRoundOf16", "knockoutPlayoff", "eliminated", "eliminated"]);
      await p.locator('[data-testid="matchday-select"]').selectOption({ label: "Knockout phase" });
      assert.deepEqual(await p.locator('[data-testid="knockout-rounds"] button').allInnerTexts(), ["Play-off", "Round of 16", "QF", "SF", "Final"]);
      assert.match(await p.locator('[data-testid="playoff"]').innerText(), /Copa Libertadores/);
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      assert.match(await p.locator('[data-testid="champion"]').innerText(), /Copa Sudamericana/);
      // Round of 16: the eight group winners against the eight play-off winners.
      await p.locator('[data-testid="knockout-rounds"] button', { hasText: "Round of 16" }).click();
      assert.equal(await p.locator('[data-testid="playoff-tie"]').count(), 8);
      await p.getByRole("button", { name: "Reset" }).click();
      await p.getByRole("button", { name: "Reset predictions" }).click();
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="win-chance"]').first().waitFor({ timeout: 90000 });
      assert.match(await p.locator('[data-testid="chances"] thead').innerText(), /1st[\s\S]*Top 2[\s\S]*Final[\s\S]*Win/);
      await p.close();
    });

    await step("Argentina: two zones, cross-zone play-offs to a neutral final, title chances", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/argentina-primera-division`);
      const rows = p.locator('[data-testid="standings-row"]');
      assert.equal(await rows.count(), 15, "one zone at a time");
      const zones = await rows.evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.deepEqual(zones.slice(7, 9), ["titlePlayoffs", ""]);
      assert.deepEqual(await p.locator('[data-testid="group-switch"] button').allInnerTexts(), ["Zone A", "Zone B"]);
      const options = await p.locator('[data-testid="matchday-select"] option').allInnerTexts();
      assert.equal(options.length, 17, "16 rounds and the play-offs");
      await p.locator('[data-testid="matchday-select"]').selectOption({ label: "Play-off" });
      const first = p.locator('[data-testid="playoff-round"]').first();
      assert.match(await first.innerText(), /1st in Zone A[\s\S]*8th in Zone B/);
      assert.match(await p.locator('[data-testid="playoff"]').innerText(), /Winner 1A\/8B\/4B\/5A|Winner 1A\/4B\/5A\/8B/);
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      assert.match(await p.locator('[data-testid="playoff"]').innerText(), /neutral ground/);
      await p.getByRole("button", { name: "Reset" }).click();
      await p.getByRole("button", { name: "Reset predictions" }).click();
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="win-chance"]').first().waitFor({ timeout: 90000 });
      assert.match(await p.locator('[data-testid="chances"] thead').innerText(), /Playoffs[\s\S]*Win/);
      await p.getByRole("tab", { name: "Table" }).click();

      // Apertura · Clausura · Annual table: the current tournament first.
      const switcher = p.locator('[data-testid="tournament-switch"] button');
      assert.deepEqual(await switcher.allInnerTexts(), ["Apertura", "Clausura", "Annual table"]);
      assert.equal(await switcher.nth(1).getAttribute("aria-pressed"), "true");
      // The earlier tournament: every game played.
      await switcher.nth(0).click();
      await p.locator('[data-testid="matchday-select"]').waitFor();
      assert.equal(await p.locator('[data-testid="matchday-select"] option').count(), 17);
      // …in the same Zones A and B as the current tournament, with its play-off seeded across them.
      assert.deepEqual(await p.locator('[data-testid="group-switch"] button').allInnerTexts(), ["Zone A", "Zone B"]);
      assert.equal(await rows.count(), 15);
      await p.locator('[data-testid="matchday-select"]').selectOption({ label: "Play-off" });
      assert.doesNotMatch(await p.locator('[data-testid="playoff"]').innerText(), /in Zone A|The pairings are set/, "the zones are complete: real clubs, not slots");
      await p.locator('[data-testid="matchday-select"]').selectOption({ index: 0 });
      const played = async () => (await rows.evaluateAll((r) => r.map((x) => Number(x.children[2].textContent)))).reduce((a, b) => a + b, 0);
      // The annual table: all 30 clubs; the Apertura champion (sample: club 1) is in the
      // Libertadores already, so the places pass down; the last club goes down.
      await switcher.nth(2).click();
      await p.locator('[data-testid="qualified-note"]').waitFor();
      assert.equal(await rows.count(), 30);
      const annualZones = await rows.evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.equal(annualZones.filter((z) => z === "libertadores").length, 4, "champion + top 3");
      assert.equal(annualZones.filter((z) => z === "sudamericana").length, 6);
      assert.equal(annualZones[29], "relegation");
      assert.equal(await p.locator('[data-testid="qualified-tag"]').count(), 1);
      assert.match(await p.locator('[data-testid="qualified-note"]').innerText(), /Apertura champion/);
      // The annual table shares the Clausura's predictions.
      const before = await played();
      await switcher.nth(1).click();
      await p.getByRole("button", { name: "Simulate matchday" }).click();
      await switcher.nth(2).click();
      await p.locator('[data-testid="qualified-note"]').waitFor();
      assert.ok((await played()) > before, "a Clausura prediction counts in the annual table");
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="libertadores-chance"]').first().waitFor({ timeout: 90000 });
      assert.match(await p.locator('[data-testid="chances"] thead').innerText(), /Libertadores[\s\S]*Sudamericana[\s\S]*Relegation/);
      await p.close();
    });

    await step("Colombia, Uruguay, Paraguay: tournaments of the year and the annual table", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const rows = p.locator('[data-testid="standings-row"]');
      const switcher = p.locator('[data-testid="tournament-switch"] button');
      for (const [slug, names, clubs, title] of [ // Colombia, Uruguay, Paraguay and Peru
        ["colombia-primera-a", ["Apertura", "Finalización", "Reclassification"], 20, "titlePlayoffs"],
        ["uruguay-primera-division", ["Apertura", "Intermedio", "Clausura", "Annual table"], 16, "title"],
        ["paraguay-primera-division", ["Apertura", "Clausura", "Cumulative table"], 12, "title"],
        ["peru-liga-1", ["Apertura", "Clausura", "Cumulative table"], 18, "title"],
      ]) {
        await p.goto(`${BASE_URL}/en/${slug}`);
        assert.deepEqual(await switcher.allInnerTexts(), names, slug);
        assert.equal(await rows.count(), clubs, slug);
        assert.equal(await rows.first().getAttribute("data-zone"), title, slug);
        // The annual table: every club, Libertadores and Sudamericana places, a note on the rules.
        await switcher.last().click();
        await p.locator('[data-testid="qualified-note"]').waitFor();
        assert.equal(await rows.count(), clubs, `${slug} annual`);
        const zones = await rows.evaluateAll((r) => r.map((x) => x.dataset.zone));
        assert.ok(zones.includes("libertadores") && zones.includes("sudamericana"), slug);
        assert.doesNotMatch(await p.locator('[data-testid="qualified-note"]').innerText(), /Copa Argentina/, `${slug}: its own note`);
      }
      // Colombia: two-legged play-offs straight to penalties; the earlier champion passes its place down.
      await p.goto(`${BASE_URL}/en/colombia-primera-a`);
      await p.locator('[data-testid="matchday-select"]').selectOption({ label: "Play-off" });
      assert.match(await p.locator('[data-testid="playoff"]').innerText(), /1st place × 8th place[\s\S]*straight to penalties/);
      await switcher.last().click();
      assert.equal(await p.locator('[data-testid="qualified-tag"]').count(), 1);
      await p.close();
    });

    await step("Liga MX: 18 clubs, Liguilla with the better-placed club through on a level aggregate", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/liga-mx`);
      const rows = p.locator('[data-testid="standings-row"]');
      assert.equal(await rows.count(), 18);
      const zones = await rows.evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.deepEqual([zones[0], zones[7], zones[8]], ["titlePlayoffs", "titlePlayoffs", ""]);
      await p.locator('[data-testid="matchday-select"]').selectOption({ label: "Play-off" });
      const liguilla = p.locator('[data-testid="playoff"]');
      assert.match(await liguilla.innerText(), /1st place × 8th place[\s\S]*goes through if the aggregate is level/);
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      assert.match(await p.locator('[data-testid="champion"]').innerText(), /Liga MX/);
      assert.equal(await p.locator('[data-testid="playoff-tie"]').count(), 4 + 2 + 1);
      await p.close();
    });

    await step("Ecuador: the first stage, then title, middle and relegation groups as their own tables and rounds", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/ecuador-ligapro`);
      const groups = p.locator('[data-testid="group-switch"] button');
      const zones = () => p.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
      // Sample data: the first stage isn't over. Its table shows first, the groups with places standing in.
      assert.deepEqual(await groups.allInnerTexts(), ["First stage", "Title hexagonal", "Quadrangular", "Relegation hexagonal"]);
      assert.equal(await groups.nth(0).getAttribute("aria-pressed"), "true");
      const before = await zones();
      assert.deepEqual([before[0], before[5], before[6], before[9], before[10], before[15]], ["splitTitle", "splitTitle", "splitMiddle", "splitMiddle", "splitRelegation", "splitRelegation"]);
      await groups.nth(2).click();
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="standings-row"]').length === 4);
      assert.match(await p.locator('[data-testid="standings"]').innerText(), /7th place/);
      // Simulating the season fills them in.
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.waitForFunction(() => !/7th place/.test(document.querySelector('[data-testid="standings"]')?.textContent ?? ""));
      assert.deepEqual(await zones(), ["sudamericana", "", "", ""]);
      await groups.nth(1).click();
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="standings-row"]').length === 6);
      assert.deepEqual((await zones()).slice(0, 4), ["title", "libertadores", "libertadoresQualifying", "sudamericana"]);
      await groups.nth(3).click();
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="standings-row"]').length === 6 && document.querySelector('[data-testid="standings-row"]')?.dataset.zone === "");
      assert.deepEqual(await zones(), ["", "", "", "", "relegation", "relegation"]);
      // Chances: per group; no "1st place" in the relegation group.
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="chances"] tbody tr').first().waitFor({ timeout: 90000 });
      assert.doesNotMatch(await p.locator('[data-testid="chances"] thead').innerText(), /1st place|Title/);
      await groups.nth(0).click();
      await p.waitForFunction(() => /Title/.test(document.querySelector('[data-testid="chances"] thead')?.textContent ?? ""));
      await p.close();
    });

    await step("Saudi Pro League: Asian places, the AFC Champions League wording and chances", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/saudi-pro-league`);
      const zones = await p.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.equal(zones.length, 18);
      assert.deepEqual(
        [zones[0], zones[3], zones[4], zones[5], zones[6], zones[7], zones[8], zones[15], zones[17]],
        ["aclElite", "aclElite", "aclEliteQualifying", "aclTwo", "gulfClub", "gulfClub", "", "relegation", "relegation"],
      );
      const text = await p.locator("main").innerText();
      assert.match(text, /AFC Champions League/);
      assert.doesNotMatch(text, /Europe and relegation|Copa Libertadores and relegation/);
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="acl-chance"]').first().waitFor({ timeout: 90000 });
      await p.close();
    });

    await step("J1 League, Scottish Premiership, Süper Lig, Pro League and Super League Greece: zones, menus", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const zonesOf = () => p.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
      await p.goto(`${BASE_URL}/en/j1-league`);
      const j1 = await zonesOf();
      assert.equal(j1.length, 20);
      assert.deepEqual([j1[0], j1[1], j1[2], j1[3], j1[17], j1[19]], ["aclElite", "aclElite", "aclEliteQualifying", "", "relegation", "relegation"]);
      assert.match(await p.locator("main").innerText(), /AFC Champions League/);
      await p.goto(`${BASE_URL}/en/scottish-premiership`);
      const sco = await zonesOf();
      assert.equal(sco.length, 12);
      assert.deepEqual([sco[0], sco[1], sco[2], sco[3], sco[10], sco[11]], ["championsLeague", "championsLeagueQualifying", "europaLeague", "conferenceLeague", "relegationPlayoff", "relegation"]);
      const menu = p.locator('[data-testid="league-menu"]');
      await menu.getByRole("button", { name: "Europe" }).click();
      assert.deepEqual((await menu.locator("#menu-gb-sct a").allInnerTexts()).map((x) => x.trim()), ["Scottish Premiership"]);
      assert.deepEqual((await menu.locator("#menu-tr a").allInnerTexts()).map((x) => x.trim()), ["Süper Lig"]);
      assert.deepEqual((await menu.locator("#menu-be a").allInnerTexts()).map((x) => x.trim()), ["Pro League"]);
      assert.deepEqual((await menu.locator("#menu-gr a").allInnerTexts()).map((x) => x.trim()), ["Super League Greece"]);
      assert.deepEqual((await menu.locator("#menu-at a").allInnerTexts()).map((x) => x.trim()), ["Austrian Bundesliga"]);
      await p.keyboard.press("Escape");
      await p.goto(`${BASE_URL}/en/super-lig`);
      const tsl = await zonesOf();
      assert.equal(tsl.length, 18);
      assert.deepEqual([tsl[0], tsl[1], tsl[2], tsl[3], tsl[4], tsl[15], tsl[17]], ["championsLeague", "championsLeagueQualifying", "europaLeague", "conferenceLeague", "", "relegation", "relegation"]);
      await p.goto(`${BASE_URL}/en/belgian-pro-league`);
      const bpl = await zonesOf();
      assert.equal(bpl.length, 18);
      assert.deepEqual([bpl[0], bpl[1], bpl[2], bpl[3], bpl[4], bpl[15], bpl[16], bpl[17]], ["championsLeague", "championsLeagueQualifying", "europaLeague", "conferenceLeague", "", "", "relegation", "relegation"]);
      await p.close();
    });

    await step("Super League Greece: the regular season, then the play-offs as their own tables and rounds", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const zonesOf = () => p.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
      const rowTexts = () => p.locator('[data-testid="standings-row"]').allInnerTexts();
      const playedOf = (text) => Number(text.split(/\s+/).find((x, i, all) => i > 1 && /^\d+$/.test(x) && !/^\d+$/.test(all[i - 1] ?? "")));
      await p.goto(`${BASE_URL}/en/greek-super-league`);
      const gsl = p.locator('[data-testid="group-switch"] button');
      const select = p.locator('[data-testid="matchday-select"]');
      // From the start: the regular season first, then the three groups.
      assert.deepEqual(await gsl.allInnerTexts(), ["Regular season", "Championship play-offs", "Europe play-offs", "Relegation play-outs"]);
      assert.equal(await gsl.nth(0).getAttribute("aria-pressed"), "true");
      const before = await zonesOf();
      assert.deepEqual([before[0], before[3], before[4], before[7], before[8], before[13]], ["championshipPlayoffs", "championshipPlayoffs", "europePlayoffs", "europePlayoffs", "relegationPlayouts", "relegationPlayouts"]);
      // Rounds: 26 matchdays, then each group's own.
      const options = (await select.locator("option").allInnerTexts()).map((x) => x.trim());
      assert.equal(options.length, 26 + 6 + 6 + 10);
      assert.equal(options[25], "Matchday 26");
      assert.deepEqual([options[26], options[31], options[32], options[38], options[47]], ["Championship play-offs 1", "Championship play-offs 6", "Europe play-offs 1", "Relegation play-outs 1", "Relegation play-outs 10"]);
      // Before the regular season ends, places stand in for the clubs.
      await gsl.nth(1).click();
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="standings-row"]').length === 4);
      assert.match((await rowTexts())[0], /1st place/);
      assert.deepEqual(await zonesOf(), ["title", "championsLeagueQualifying", "europaLeague", "conferenceLeague"]);
      await p.locator('[data-testid="table-note"]').waitFor();
      assert.equal(await select.inputValue(), "1001", "the group's own rounds show");
      assert.match(await p.locator('[data-testid="fixtures-note"]').innerText(), /regular season/);
      assert.match(await p.locator('[data-testid="fixtures"]').innerText(), /1st/);
      assert.ok(await p.getByRole("button", { name: "Simulate matchday" }).isDisabled());
      // Chances before the split: the whole season, no groups.
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="chances"] tbody tr').first().waitFor({ timeout: 90000 });
      assert.match(await p.locator('[data-testid="chances"] thead').innerText(), /Title.*Relegation/s);
      assert.equal(await gsl.count(), 0);
      await p.getByRole("tab", { name: "Table" }).click();
      // Simulating the season fills the groups: their own games only, from the carried points.
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.waitForFunction(() => !/1st place/.test(document.querySelector('[data-testid="standings"]')?.textContent ?? ""));
      assert.ok((await rowTexts()).every((r) => playedOf(r) === 6), "6 play-off games each");
      assert.equal(await p.locator('[data-testid="carried"]').count(), 4);
      assert.ok(!(await p.getByRole("button", { name: "Simulate matchday" }).isDisabled()));
      assert.match(await p.locator('[data-testid="fixtures-note"]').innerText(), /after matchday 26/);
      await gsl.nth(2).click();
      await p.waitForFunction(() => document.querySelector('[data-testid="standings-row"]')?.dataset.zone === "conferenceLeague");
      await gsl.nth(3).click();
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="standings-row"]').length === 6);
      assert.deepEqual(await zonesOf(), ["", "", "", "", "relegation", "relegation"]);
      assert.ok((await rowTexts()).every((r) => playedOf(r) === 10), "10 play-out games each");
      assert.equal(await select.inputValue(), "3010", "the play-outs' rounds show");
      // The regular season keeps its own table: 26 games each.
      await gsl.nth(0).click();
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="standings-row"]').length === 14);
      assert.deepEqual(await zonesOf(), before);
      assert.ok((await rowTexts()).every((r) => playedOf(r) === 26));
      assert.equal(await select.inputValue(), "26");
      // The chances are for the groups once they're known.
      await p.getByRole("tab", { name: "Chances" }).click();
      assert.deepEqual(await gsl.allInnerTexts(), ["Championship play-offs", "Europe play-offs", "Relegation play-outs"]);
      await p.getByRole("tab", { name: "Table" }).click();
      // Kept after a reload.
      await p.reload();
      await gsl.first().waitFor();
      // The saved choice is restored once the page has hydrated.
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="group-switch"] button')[1]?.getAttribute("aria-pressed") === "true", null, { timeout: 15_000 }).catch(() => {});
      assert.equal(await gsl.nth(1).getAttribute("aria-pressed"), "true", "the play-offs show first once known");
      assert.ok((await rowTexts()).every((r) => playedOf(r) === 6));
      await p.close();
    });

    await step("Austrian Bundesliga: the regular season, then the championship and qualification groups", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const zonesOf = () => p.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
      const playedOf = (text) => Number(text.split(/\s+/).find((x, i, all) => i > 1 && /^\d+$/.test(x) && !/^\d+$/.test(all[i - 1] ?? "")));
      await p.goto(`${BASE_URL}/en/austrian-bundesliga`);
      const tabs = p.locator('[data-testid="group-switch"] button');
      const select = p.locator('[data-testid="matchday-select"]');
      assert.deepEqual(await tabs.allInnerTexts(), ["Regular season", "Championship group", "Qualification group"]);
      const before = await zonesOf();
      assert.deepEqual(before, [...Array(6).fill("championshipGroup"), ...Array(6).fill("qualificationGroup")]);
      const options = (await select.locator("option").allInnerTexts()).map((x) => x.trim());
      assert.equal(options.length, 22 + 10 + 10);
      assert.deepEqual([options[21], options[22], options[32], options[41]], ["Matchday 22", "Championship group 1", "Qualification group 1", "Qualification group 10"]);
      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await tabs.nth(1).click();
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="standings-row"]').length === 6 && !/1st place/.test(document.querySelector('[data-testid="standings"]')?.textContent ?? ""));
      assert.deepEqual(await zonesOf(), ["title", "championsLeagueQualifying", "conferenceLeague", "conferenceLeaguePlayoff", "conferenceLeaguePlayoff", ""]);
      assert.ok((await p.locator('[data-testid="standings-row"]').allInnerTexts()).every((r) => playedOf(r) === 10), "10 group games each");
      // Points carried over in full: a club's carried points are its regular-season points.
      await tabs.nth(0).click();
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="standings-row"]').length === 12);
      const leader = (await p.locator('[data-testid="standings-row"]').first().locator('[data-testid="points"]').innerText()).trim();
      await tabs.nth(1).click();
      await p.waitForFunction(() => document.querySelectorAll('[data-testid="carried"]').length === 6);
      const carried = await p.locator('[data-testid="carried"]').allInnerTexts();
      assert.ok(carried.includes(leader), `the regular-season leader's ${leader} points carried over in full`);
      await tabs.nth(2).click();
      await p.waitForFunction(() => document.querySelector('[data-testid="standings-row"]')?.dataset.zone === "conferenceLeaguePlayoff");
      assert.deepEqual(await zonesOf(), ["conferenceLeaguePlayoff", "", "", "", "", "relegation"]);
      await p.close();
    });

    await step("split leagues on a phone: no wider than the screen, short table names", async () => {
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      for (const [slug, labels] of [
        ["greek-super-league", ["Regular", "Title", "Europe", "Relegation"]],
        ["ecuador-ligapro", ["1st stage", "Title", "Quadrangular", "Relegation"]],
      ]) {
        await phone.goto(`${BASE_URL}/en/${slug}`);
        const sw = phone.locator('[data-testid="group-switch"]');
        assert.deepEqual((await sw.locator("button").allInnerTexts()).map((x) => x.trim()), labels);
        assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, `${slug} fits the screen`);
        const box = await sw.boundingBox();
        assert.ok(box.x + box.width <= 390 && (await sw.evaluate((e) => e.scrollWidth <= e.clientWidth)), `${slug}: the table names fit`);
      }
      await phone.close();
    });

    await step("Chile: 16 clubs, Libertadores, Sudamericana and relegation zones", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/chile-primera-division`);
      const zones = await p.locator('[data-testid="standings-row"]').evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.equal(zones.length, 16);
      assert.deepEqual([zones[0], zones[2], zones[3], zones[5], zones[6], zones[14], zones[15]], ["libertadores", "libertadoresQualifying", "sudamericana", "sudamericana", "", "relegation", "relegation"]);
      assert.match(await p.locator("main").innerText(), /Copa Libertadores and relegation/);
      await p.close();
    });

    await step("MLS: East/West conference tables, playoff zones and chances", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/mls`);
      const rows = p.locator('[data-testid="standings-row"]');
      assert.equal(await rows.count(), 15, "one conference at a time");
      const zones = await rows.evaluateAll((r) => r.map((x) => x.dataset.zone));
      assert.deepEqual(zones.slice(0, 10), [...Array(7).fill("playoffs"), "playoffWildCard", "playoffWildCard", ""]);
      const switcher = p.locator('[data-testid="group-switch"]');
      const east = await rows.allInnerTexts();
      await switcher.getByRole("button", { name: "Western Conference" }).click();
      await p.waitForFunction((before) => document.querySelector('[data-testid="standings-row"]')?.textContent !== before, east[0]);
      const west = await rows.allInnerTexts();
      assert.equal(west.length, 15);
      assert.ok(west.every((r) => !east.includes(r)), "different clubs in the West");
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="playoff-chance"]').first().waitFor({ timeout: 30000 });
      assert.equal(await p.locator('[data-testid="playoff-chance"]').count(), 15);
      assert.match(await p.locator("main").innerText(), /playoff and wild-card places/);
      assert.doesNotMatch(await p.locator("main").innerText(), /relegation/i);
      await p.close();
    });

    await step("MLS Cup playoffs: conference brackets, best-of-three Round One, one champion", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/mls`);
      await p.locator('[data-testid="matchday-select"]').selectOption("-1");
      const playoff = p.locator('[data-testid="playoff"]');
      await playoff.waitFor();
      assert.deepEqual(
        (await playoff.locator('[data-testid="playoff-round"] h3').allInnerTexts()).map((x) => x.trim().toLowerCase()),
        ["wild card", "round one", "conference semifinals", "conference final", "mls cup"],
      );
      const text = await playoff.innerText();
      assert.match(text, /8th in the East × 9th in the East/);
      assert.match(text, /1st in the West × Winner 8\/9 \(West\)/);
      assert.match(text, /Winner 1\/8\/9 \(East\) × Winner 4\/5 \(East\)/);
      assert.match(text, /Single match at the higher seed's ground/);
      assert.match(await p.locator('[data-testid="champion"]').innerText(), /MLS Cup \d{4} champion/);

      await p.getByRole("button", { name: "Simulate rest of season" }).click();
      await p.locator('[data-testid="champion-team"]').waitFor();
      const results = await playoff.locator('[data-testid="playoff-result"]').allInnerTexts();
      assert.equal(results.length, 2 + 8 + 4 + 2 + 1, "every tie decided");
      const series = results.filter((r) => r.startsWith("Series:"));
      assert.equal(series.length, 8);
      for (const r of series) assert.match(r, /(2–[01]|[01]–2) /, r);
      assert.match(results.at(-1), /wins the MLS Cup!/);
      // A series game's shoot-out goes away once the game has a winner.
      {
        const series = playoff.locator('[data-testid="playoff-tie"]').filter({ hasText: "Best of three" }).nth(2);
        const g1 = series.locator('[data-testid="match-row"]').filter({ hasText: "Game 1" }).first();
        if ((await g1.locator("input").count()) === 0) await g1.getByRole("button").first().click();
        await g1.locator("input").nth(0).fill("2");
        await g1.locator("input").nth(1).fill("2");
        const pens1 = series.locator('[data-testid="match-row"][data-attached="true"]').filter({ hasText: "Game 1: penalties" });
        await pens1.waitFor();
        await pens1.locator("input").nth(0).fill("5");
        await pens1.locator("input").nth(1).fill("4");
        await g1.locator("input").nth(0).fill("3");
        await pens1.waitFor({ state: "detached" });
      }
      // A drawn series game's shoot-out sits right under that game, labelled with it.
      const aSeries = playoff.locator('[data-testid="playoff-tie"]').filter({ hasText: "Best of three" }).first();
      const game2 = aSeries.locator('[data-testid="match-row"]').filter({ hasText: "Game 2" }).first();
      const inputs = game2.locator("input");
      if ((await inputs.count()) === 0) await game2.getByRole("button").first().click();
      await game2.locator("input").first().fill("1");
      await game2.locator("input").last().fill("1");
      const pens = aSeries.locator('[data-testid="match-row"][data-attached="true"]');
      await pens.filter({ hasText: "Game 2: penalties" }).waitFor();
      const order = await aSeries.locator('[data-testid="match-row"]').evaluateAll((rows) => rows.map((r) => (r.dataset.attached ? "pens" : r.innerText.match(/Game \d/)?.[0])));
      assert.equal(order[order.indexOf("Game 2") + 1], "pens", `order: ${order.join(", ")}`);
      await p.close();
    });

    await step("header menu: continents with country columns, UEFA first, no scrollbar", async () => {
      const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await desktop.goto(`${BASE_URL}/en`);
      const menu = desktop.locator('[data-testid="league-menu"]');
      const continents = (await menu.locator(":scope > li > button").allInnerTexts()).map((x) => x.trim());
      assert.deepEqual(continents, ["Europe", "South America", "North America", "Asia"]);
      const overflow = await menu.evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.equal(overflow, 0, "no horizontal scroll in the menu");

      await menu.getByRole("button", { name: "Europe" }).hover();
      const panel = menu.locator('[data-testid="menu-panel"]');
      await panel.waitFor();
      const columns = (await panel.locator("p").allInnerTexts()).map((x) => x.trim().toLowerCase());
      assert.deepEqual(columns, ["uefa", "austria", "belgium", "england", "france", "germany", "greece", "italy", "netherlands", "portugal", "scotland", "spain", "turkey"]);
      assert.deepEqual((await menu.locator("#menu-eu a").allInnerTexts()).map((x) => x.trim()), ["Champions League", "Europa League", "Conference League"]);
      const england = menu.locator("#menu-gb-eng");
      assert.deepEqual((await england.locator("a").allInnerTexts()).map((x) => x.trim()), ["Premier League", "Championship", "League One", "League Two", "FA Cup"]);
      // The wide panel stays inside the window.
      const box = await panel.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 1280, `panel within the viewport: ${box.x}–${box.x + box.width}`);
      await england.getByRole("link", { name: "Championship" }).click();
      await desktop.waitForURL(/\/en\/championship$/);
      await menu.getByRole("button", { name: "South America" }).click();
      assert.deepEqual((await menu.locator('[data-testid="menu-panel"] p').allInnerTexts()).map((x) => x.trim().toLowerCase()), ["conmebol", "argentina", "brazil", "chile", "colombia", "ecuador", "paraguay", "peru", "uruguay"]);
      // No column (or link) overlaps the next.
      const [conmebol, brazil] = await Promise.all(["#menu-conmebol", "#menu-ar"].map((id) => menu.locator(id).boundingBox()));
      const widest = await menu.locator("#menu-conmebol a").evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
      assert.ok(widest <= brazil.x && conmebol.x + conmebol.width <= brazil.x, `columns overlap: ${widest} > ${brazil.x}`);
      assert.deepEqual((await menu.locator("#menu-conmebol a").allInnerTexts()).map((x) => x.trim()), ["Copa Libertadores", "Copa Sudamericana"]);
      await menu.getByRole("button", { name: "North America" }).click();
      assert.deepEqual((await menu.locator("#menu-us a").allInnerTexts()).map((x) => x.trim()), ["MLS"]);
      assert.deepEqual((await menu.locator("#menu-mx a").allInnerTexts()).map((x) => x.trim()), ["Liga MX"]);
      await menu.getByRole("button", { name: "Asia" }).click();
      assert.deepEqual((await menu.locator("#menu-sa a").allInnerTexts()).map((x) => x.trim()), ["Saudi Pro League"]);
      assert.deepEqual((await menu.locator("#menu-jp a").allInnerTexts()).map((x) => x.trim()), ["J1 League"]);
      await desktop.close();

      const pt = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await pt.goto(`${BASE_URL}/pt`);
      const ptMenu = pt.locator('[data-testid="league-menu"]');
      assert.deepEqual((await ptMenu.locator(":scope > li > button").allInnerTexts()).map((x) => x.trim()), ["Europa", "América do Sul", "América do Norte", "Ásia"]);
      await ptMenu.getByRole("button", { name: "Europa" }).click();
      const ptColumns = (await ptMenu.locator('[data-testid="menu-panel"] p').allInnerTexts()).map((x) => x.trim().toLowerCase());
      assert.deepEqual(ptColumns.slice(0, 2), ["uefa", "alemanha"]);
      await pt.close();

      const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
      await phone.goto(`${BASE_URL}/en`);
      assert.equal(await phone.locator('[data-testid="league-menu"]').isVisible(), false, "continent bar hidden on phones");
      const burger = phone.locator('[data-testid="mobile-menu-button"]');
      await burger.tap();
      const mobile = phone.locator('[data-testid="mobile-menu"]');
      await mobile.waitFor();
      // One row per continent, all closed on the home page: no competition links yet.
      const rows = mobile.locator('[data-testid="mobile-continent-button"]');
      // Europe's row: UEFA and the big five's flags, whatever the menu's order.
      assert.deepEqual(await rows.nth(0).locator("[data-flag]").evaluateAll((els) => els.map((e) => e.dataset.flag)), ["eu", "gb-eng", "es", "de", "it", "fr"]);
      assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.firstElementChild.textContent.trim())), ["Europe", "South America", "North America", "Asia"]);
      // Closed: no competition links, only the latest odds.
      assert.equal(await mobile.locator('a:not([data-testid="mobile-latest-odds"])').count(), 0, "continents start closed");
      assert.equal(await mobile.getByTestId("mobile-latest-odds").getAttribute("href"), "/en/odds");
      const countriesShown = async () => (await mobile.locator("li > div > p").allInnerTexts()).map((x) => x.trim().toLowerCase());
      // Asia: only its countries.
      await rows.nth(3).tap();
      assert.deepEqual(await countriesShown(), ["japan", "saudi arabia"]);
      assert.equal(await rows.nth(3).getAttribute("aria-expanded"), "true");
      // South America closes Asia.
      await rows.nth(1).tap();
      assert.deepEqual(await countriesShown(), ["conmebol", "argentina", "brazil", "chile", "colombia", "ecuador", "paraguay", "peru", "uruguay"]);
      assert.equal(await rows.nth(3).getAttribute("aria-expanded"), "false");
      await rows.nth(0).tap();
      assert.deepEqual(await countriesShown(), ["uefa", "austria", "belgium", "england", "france", "germany", "greece", "italy", "netherlands", "portugal", "scotland", "spain", "turkey"]);
      await phone.keyboard.press("Escape");
      await mobile.waitFor({ state: "detached" });
      await burger.tap();
      await rows.nth(1).tap();
      await mobile.getByRole("link", { name: "Brasileirão Série B" }).tap();
      await phone.waitForURL(/\/en\/brasileirao-serie-b$/);
      await mobile.waitFor({ state: "detached" });
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, "no horizontal page scroll");
      // On a competition's page, its continent starts open.
      await phone.goto(`${BASE_URL}/en/saudi-pro-league`);
      await burger.tap();
      await mobile.waitFor();
      assert.deepEqual(await countriesShown(), ["japan", "saudi arabia"]);
      await phone.context().close();
    });

    await step("kick-off times follow the visitor's time zone", async () => {
      const shown = {};
      for (const timezoneId of ["America/Sao_Paulo", "Europe/Lisbon"]) {
        const ctx = await browser.newContext({ timezoneId, locale: "en-US" });
        const p = await ctx.newPage();
        await p.goto(LEAGUE);
        const kickoff = p.locator('[data-testid="kickoff"]').first();
        await kickoff.waitFor();
        const utc = await kickoff.getAttribute("data-utc");
        const text = await kickoff.innerText();
        const hour = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", timeZone: timezoneId }).format(new Date(utc));
        assert.ok(text.includes(hour), `${timezoneId}: expected ${hour} in "${text}"`);
        shown[timezoneId] = text;
        await ctx.close();
      }
      assert.notEqual(shown["America/Sao_Paulo"], shown["Europe/Lisbon"]);
    });

    await step("layout: actions sit between table and fixtures on phones", async () => {
      const box = async (p, selector) => (await p.locator(selector).first().boundingBox());
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await phone.goto(LEAGUE);
      const [tabs, table, actions, fixtures] = await Promise.all(
        ['[role="tablist"]', '[data-testid="standings"]', '[data-testid="actions"]', '[data-testid="fixtures"]'].map((s) => box(phone, s)),
      );
      assert.ok(tabs.y < table.y && table.y < actions.y && actions.y < fixtures.y, "phone order: tabs, table, actions, fixtures");
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, "no horizontal scroll");
      await phone.close();

      const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await desktop.goto(LEAGUE);
      const [dTabs, dTable, dActions, dFixtures] = await Promise.all(
        ['[role="tablist"]', '[data-testid="standings"]', '[data-testid="actions"]', '[data-testid="fixtures"]'].map((s) => box(desktop, s)),
      );
      assert.ok(Math.abs(dTabs.y - dActions.y) < 12, "desktop: tabs and actions on one row");
      assert.ok(dActions.y < dTable.y && dFixtures.x > dTable.x + dTable.width - 1, "desktop: fixtures beside the table");
      await desktop.close();
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

    await step("About, Privacy and Contact pages in every language, linked from the footer", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const titles = {
        en: ["About Foot Simu", "Privacy policy", "Contact"],
        pt: ["Sobre o Foot Simu", "Política de privacidade", "Contato"],
        es: ["Acerca de Foot Simu", "Política de privacidad", "Contacto"],
      };
      for (const [locale, [about, privacy, contact]] of Object.entries(titles)) {
        for (const [page, heading] of [["about", about], ["privacy", privacy], ["contact", contact]]) {
          const response = await p.goto(`${BASE_URL}/${locale}/${page}`);
          assert.equal(response.status(), 200, `${locale}/${page}`);
          assert.equal((await p.locator("h1").innerText()).trim(), heading);
          assert.match(await p.title(), new RegExp(heading));
          const hreflang = await p.locator('link[rel="alternate"][hreflang]').evaluateAll((l) => l.map((x) => x.getAttribute("href")));
          assert.ok(hreflang.some((h) => h.endsWith(`/pt/${page}`)) && hreflang.some((h) => h.endsWith(`/es/${page}`)), `${locale}/${page} hreflang`);
        }
        assert.equal(await p.locator('a[href="mailto:contact@footsimu.com"]').count(), 1, `${locale} contact email`);
      }
      // Privacy: dated, and it says how predictions, analytics and ads are handled.
      await p.goto(`${BASE_URL}/en/privacy`);
      const privacy = await p.locator('[data-testid="legal-page"]').innerText();
      for (const words of [/Last updated/, /local storage/, /Vercel Web Analytics/, /Google AdSense/, /consent/]) assert.match(privacy, words);
      // The footer reaches them, in the page's language.
      await p.goto(`${BASE_URL}/pt/premier-league`);
      const links = p.locator('[data-testid="site-links"] a');
      assert.deepEqual(await links.allInnerTexts(), ["Sobre", "Privacidade", "Contato"]);
      await links.nth(1).click();
      await p.waitForURL(/\/pt\/privacy$/);
      // About links to Contact inside the site.
      await p.goto(`${BASE_URL}/en/about`);
      await p.getByRole("link", { name: "let us know" }).click();
      await p.waitForURL(/\/en\/contact$/);
      // No ads until a publisher id is set: no AdSense code, ads.txt is a 404.
      assert.equal(await p.locator('script[src*="adsbygoogle"]').count(), 0);
      assert.equal(await p.locator('meta[name="google-adsense-account"]').count(), 0);
      if (!process.env.EXPECT_ADSENSE) assert.equal((await p.request.get(`${BASE_URL}/ads.txt`)).status(), 404);
      const sitemap = await (await p.request.get(`${BASE_URL}/sitemap.xml`)).text();
      for (const page of ["about", "privacy", "contact"]) assert.match(sitemap, new RegExp(`footsimu\\.com/es/${page}<`));
      await p.close();
    });

    await step("domestic chances carry a note on early-season estimates; continental ones don't", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      for (const [path, text] of [
        ["en/premier-league", /Early in the season these chances are rough estimates, based on current form and last season's results\./],
        ["pt/brasileirao", /No começo da temporada, essas chances são estimativas aproximadas/],
        ["es/la-liga", /Al principio de la temporada, estas probabilidades son estimaciones aproximadas/],
      ]) {
        await p.goto(`${BASE_URL}/${path}`);
        await p.getByRole("tab", { name: /Chances|Probabilidades/ }).click();
        await p.locator('[data-testid="chances-note"]').waitFor({ timeout: 90000 });
        assert.match(await p.locator('[data-testid="chances-note"]').innerText(), text);
      }
      await p.goto(`${BASE_URL}/en/champions-league`);
      await p.getByRole("tab", { name: "Chances" }).click();
      await p.locator('[data-testid="chances"] tbody tr').first().waitFor({ timeout: 90000 });
      assert.equal(await p.locator('[data-testid="chances-note"]').count(), 0);
      await p.close();
    });

    await step("league pages explain their format and places", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/premier-league`);
      const facts = p.locator('[data-testid="league-facts"]');
      assert.match(await facts.locator("h2").innerText(), /Premier League format/);
      assert.match(await facts.innerText(), /20 clubs take part\. Each club plays every other club twice, home and away: 38 games\./);
      assert.deepEqual((await facts.locator('[data-testid="league-places"] li').allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()), [
        "1st–4th Champions League",
        "5th Europa League",
        "6th Conference League",
        "18th–20th Relegation",
      ]);
      await p.goto(`${BASE_URL}/en/greek-super-league`);
      assert.match(await facts.innerText(), /After 26 rounds the table splits into separate tables: 1st–4th: Championship play-offs, 5th–8th: Europe play-offs, 9th–14th: Relegation play-outs\..*half of them, rounded up/s);
      await p.goto(`${BASE_URL}/pt/liga-mx`);
      assert.match(await facts.innerText(), /Em cada torneio, cada clube enfrenta todos os outros uma vez: 17 jogos\./);
      await p.goto(`${BASE_URL}/es/scottish-premiership`);
      assert.match(await facts.innerText(), /3 veces: 33 partidos/);
      // Continental competitions keep their own explanation.
      await p.goto(`${BASE_URL}/en/champions-league`);
      assert.equal(await facts.count(), 0);
      await p.close();
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

    await step("footer lists every competition by name; no 'other simulators' block", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/premier-league`);
      assert.doesNotMatch(await p.locator("main").innerText(), /Other league simulators/);
      const links = (await p.locator("footer nav a").allInnerTexts()).map((x) => x.trim());
      assert.equal(links.length, 43, "every competition once");
      assert.ok(links.every((x) => !/Simulator/.test(x)), links.join(", "));
      assert.ok(links.includes("Premier League") && links.includes("Süper Lig") && links.includes("Champions League"));
      await p.close();
    });

    await step("home page: no long list of every competition, feature cards stay", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en`);
      const text = await p.locator("main").innerText();
      assert.doesNotMatch(text, /A free football simulator for the top leagues/);
      assert.match(text, /Your predictions[\s\S]*Realistic simulation[\s\S]*Season chances/);
      await p.close();
    });

    await step("club pages: linked from the table and fixtures, chances, fixtures, SEO tags, card, sitemap, 404s", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/premier-league`);
      const link = p.locator('[data-testid="standings"] [data-testid="club-link"]').first();
      const href = await link.getAttribute("href");
      assert.match(href, /^\/en\/premier-league\/team\/[a-z0-9-]+$/);
      assert.ok((await p.locator('[data-testid="match-row"] [data-testid="club-link"]').count()) > 0, "fixture names link too");
      await link.click();
      await p.waitForURL(`${BASE_URL}${href}`);
      await p.goto(`${BASE_URL}${href}`);
      // One short H1 (the club), the chances wording under it; the title keeps the full wording.
      assert.equal(await p.locator("h1").count(), 1);
      const h1 = (await p.locator("h1").innerText()).trim();
      assert.match(await p.getByTestId("club-subtitle").innerText(), /^\d{4}(\/\d{2})? · Title, Champions League and relegation chances$/);
      const title = await p.title();
      assert.ok(title.startsWith(`${h1} `) && title.endsWith(": title, Champions League and relegation chances | Foot Simu"), title);
      // The card's three chances (a 0% one gives way to another place the club has a chance of).
      assert.match(await p.locator('meta[name="description"]').getAttribute("content"), /: [A-Z][^:%]+ \S+%, [A-Z][^%]+ \S+%, [A-Z][^%]+ \S+% in 10,000 simulated seasons/);
      assert.equal(await p.locator('link[rel="canonical"]').getAttribute("href"), `https://footsimu.com${href}`);
      for (const [lang, path] of [["en", "en"], ["pt-BR", "pt"], ["es", "es"]]) {
        assert.equal(await p.locator(`link[rel="alternate"][hreflang="${lang}"]`).getAttribute("href"), `https://footsimu.com${href.replace(/^\/en/, `/${path}`)}`);
      }
      assert.match(await p.locator('meta[property="og:image"]').getAttribute("content"), /\/team\/[a-z0-9-]+\/opengraph-image/);
      const ld = JSON.parse(await p.locator('script[type="application/ld+json"]').first().textContent());
      assert.equal(ld["@graph"][0]["@type"], "SportsTeam");
      assert.equal(ld["@graph"][0].memberOf.name, "Premier League");
      assert.match(await p.getByTestId("club-summary").innerText(), /simulated seasons\. Their likely finish is \d+(st|nd|rd|th)(–\d+(st|nd|rd|th))? \(\d+% of seasons\)/);
      assert.equal(await p.locator('[data-testid="club-chances"] [data-zone]').count(), 5);
      assert.ok((await p.locator('[data-testid="club-form"] [data-result] svg').count()) > 0, "form badges are Lucide icons");
      const fixtures = await p.getByTestId("club-fixture").count();
      assert.ok(fixtures > 0);
      assert.equal(await p.locator('[data-testid="club-toughest"] li').count(), Math.min(3, fixtures));
      assert.equal(await p.locator('[data-testid="club-others"] li').count(), 19);
      assert.equal(await p.getByTestId("club-simulate").getAttribute("href"), "/en/premier-league");
      // The card.
      const card = await p.request.get(`${BASE_URL}${href}/opengraph-image`);
      assert.equal(card.status(), 200);
      assert.equal(card.headers()["content-type"], "image/png");
      // In Portuguese and Spanish too.
      await p.goto(`${BASE_URL}${href.replace(/^\/en/, "/pt")}`);
      assert.equal((await p.locator("h1").innerText()).trim(), h1);
      assert.match(await p.getByTestId("club-subtitle").innerText(), / · Chances de título, Champions League e rebaixamento$/);
      await p.goto(`${BASE_URL}${href.replace(/^\/en/, "/es")}`);
      assert.match(await p.getByTestId("club-subtitle").innerText(), / · Probabilidades de título, Champions League y descenso$/);
      // Conferences (MLS) and annual tables (Argentina) have pages too; continental competitions don't.
      const sitemap = await (await p.request.get(`${BASE_URL}/sitemap.xml`)).text();
      for (const slug of ["mls", "argentina-primera-division", "greek-super-league", "brasileirao"]) {
        const url = sitemap.match(new RegExp(`https://footsimu.com/en/${slug}/team/[a-z0-9-]+`))?.[0];
        assert.ok(url, slug);
        const res = await p.goto(url.replace("https://footsimu.com", BASE_URL));
        assert.equal(res.status(), 200, url);
        assert.ok((await p.locator('[data-testid="club-chances"] [data-zone]').count()) > 0, url);
      }
      assert.doesNotMatch(sitemap, /champions-league\/team\//);
      assert.equal((await p.goto(`${BASE_URL}/en/premier-league/team/not-a-club`)).status(), 404);
      assert.equal((await p.goto(`${BASE_URL}/en/champions-league/team/arsenal`)).status(), 404);
      await p.close();
      // Phones: nothing wider than the screen.
      const m = await browser.newPage({ viewport: { width: 360, height: 780 } });
      await m.goto(`${BASE_URL}${href}`);
      assert.equal(await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
      await m.close();
    });

    await step("MLS club pages: every club's page answers 200 in every language, all requested at once", async () => {
      const sitemap = await (await page.request.get(`${BASE_URL}/sitemap.xml`)).text();
      const paths = [...new Set([...sitemap.matchAll(/<loc>https:\/\/footsimu\.com\/en(\/mls\/team\/[a-z0-9-]+)<\/loc>/g)].map((m) => m[1]))];
      assert.equal(paths.length, 30, "every MLS club");
      // A crawl: every club page in every language at the same moment.
      const statuses = await Promise.all(
        paths.flatMap((path) => ["en", "pt", "es"].map(async (locale) => [`/${locale}${path}`, (await page.request.get(`${BASE_URL}/${locale}${path}`)).status()])),
      );
      for (const [path, status] of statuses) assert.equal(status, 200, path);
    });

    await step("match pages: odds, scores, dice, what each result means, played games, SEO, card, redirects, sitemap", async () => {
      const sitemap = await (await page.request.get(`${BASE_URL}/sitemap.xml`)).text();
      const urls = [...sitemap.matchAll(/<loc>https:\/\/footsimu\.com(\/en\/premier-league\/match\/[a-z0-9-]+)<\/loc>/g)].map((m) => m[1]);
      assert.ok(urls.length > 0, "games in the sitemap");
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      // An upcoming game.
      let upcoming;
      for (const url of urls.reverse()) {
        await p.goto(`${BASE_URL}${url}`);
        if ((await p.getByTestId("match-page").getAttribute("data-state")) === "upcoming") {
          upcoming = url;
          break;
        }
      }
      assert.ok(upcoming, "an upcoming game");
      // One short H1 (the two clubs, with crests), the wording under it.
      assert.equal(await p.locator("h1").count(), 1);
      assert.match((await p.locator("h1").innerText()).replace(/\s+/g, " ").trim(), /^\S.* vs \S.*$/);
      assert.equal(await p.locator("h1 img, h1 [aria-hidden]").count(), 2, "both crests");
      assert.match(await p.getByTestId("match-subtitle").innerText(), /^Prediction, odds and simulated scores · Premier League · Matchday \d+$/);
      assert.match(await p.title(), /^.+ vs .+ prediction \(\d{1,2} [A-Z][a-z]{2} \d{4}\): odds and simulated scores \| Foot Simu$/);
      assert.match(await p.locator('meta[name="description"]').getAttribute("content"), / win \d+%, draw \d+%, .+ win \d+%\. Expected goals \d\.\d–\d\.\d/);
      assert.equal(await p.locator('link[rel="canonical"]').getAttribute("href"), `https://footsimu.com${upcoming}`);
      for (const [lang, path] of [["en", "en"], ["pt-BR", "pt"], ["es", "es"]]) {
        assert.equal(await p.locator(`link[rel="alternate"][hreflang="${lang}"]`).getAttribute("href"), `https://footsimu.com${upcoming.replace(/^\/en/, `/${path}`)}`);
      }
      assert.match(await p.locator('meta[property="og:image"]').getAttribute("content"), /\/match\/[a-z0-9-]+\/opengraph-image/);
      const ld = JSON.parse(await p.locator('script[type="application/ld+json"]').first().textContent());
      assert.equal(ld["@graph"][0]["@type"], "SportsEvent");
      assert.ok(ld["@graph"][0].homeTeam.name && ld["@graph"][0].awayTeam.name && ld["@graph"][0].startDate);
      // Odds adding up to about 100%, five scores, expected goals.
      const odds = await p.locator('[data-testid="match-prediction"] [data-outcome]').allInnerTexts();
      const total = odds.map((x) => Number(x.match(/(\d+)%/)[1])).reduce((a, b) => a + b, 0);
      assert.ok(total >= 98 && total <= 102, String(total));
      assert.equal(await p.locator('[data-testid="match-scores"] li').count(), 5);
      assert.match(await p.getByTestId("match-xg").innerText(), /\d\.\d\d\s*–\s*\d\.\d\d/);
      // What each result means: loaded after the page (a placeholder until then), rows for both clubs.
      await p.getByTestId("match-impact").waitFor({ timeout: 60_000 });
      assert.equal(await p.getByTestId("match-impact-loading").count(), 0);
      assert.ok((await p.getByTestId("match-impact-row").count()) >= 2);
      // Its own address: JSON, kept by the CDN, not for search engines; an unknown game's is a 404.
      const impact = await p.request.get(`${new URL(p.url()).pathname}/impact`.replace(/^/, BASE_URL));
      assert.equal(impact.status(), 200);
      assert.match(impact.headers()["content-type"], /application\/json/);
      assert.equal(impact.headers()["x-robots-tag"], "noindex");
      assert.match(impact.headers()["cache-control"], /s-maxage=10800, stale-while-revalidate=86400/);
      const numbers = await impact.json();
      assert.ok(numbers.rows.length >= 2);
      // The same numbers in every language, each in its own words.
      const other = await (await p.request.get(`${BASE_URL}${new URL(p.url()).pathname.replace(/^\/en\//, "/pt/")}/impact`)).json();
      assert.deepEqual(other.heads.map((h) => h.score), numbers.heads.map((h) => h.score));
      assert.deepEqual(other.rows.map((r) => r.cells.map((c) => c.change.tone)), numbers.rows.map((r) => r.cells.map((c) => c.change.tone)));
      assert.notEqual(other.note, numbers.note);
      assert.equal((await p.request.get(`${BASE_URL}/en/premier-league/match/nobody-vs-nobody-2026-01-01/impact`)).status(), 404);
      // The dice: one of the likeliest scores, another one each roll.
      const dice = p.getByTestId("match-dice");
      await dice.click();
      const first = await p.getByTestId("match-dice-result").innerText();
      assert.match(first, /\d+–\d+/);
      await dice.click();
      await p.waitForFunction(() => document.querySelector('[data-testid="match-dice-result"]').dataset.rolls === "2");
      assert.notEqual(await p.getByTestId("match-dice-result").innerText(), first, "a re-roll gives another score");
      // Links: both club pages and the league.
      assert.equal(await p.locator('[data-testid="match-scoreboard"] [data-testid="match-club-link"]').count(), 2);
      assert.equal(await p.getByTestId("match-simulate").getAttribute("href"), "/en/premier-league");
      assert.equal((await p.request.get(`${BASE_URL}${upcoming}/opengraph-image`)).headers()["content-type"], "image/png");
      // Portuguese and Spanish.
      await p.goto(`${BASE_URL}${upcoming.replace(/^\/en/, "/pt")}`);
      assert.match(await p.getByTestId("match-subtitle").innerText(), /^Palpite, probabilidades e placares simulados · Premier League · Rodada \d+$/);
      await p.goto(`${BASE_URL}${upcoming.replace(/^\/en/, "/es")}`);
      assert.match(await p.getByTestId("match-subtitle").innerText(), /^Pronóstico, probabilidades y marcadores simulados · Premier League · Jornada \d+$/);
      // A played game: the final score on top, the pre-match odds kept, no "what it means".
      let playedUrl;
      for (const url of [...urls].reverse()) {
        await p.goto(`${BASE_URL}${url}`);
        if ((await p.getByTestId("match-page").getAttribute("data-state")) === "played") {
          playedUrl = url;
          break;
        }
      }
      assert.ok(playedUrl, "a played game");
      assert.match(await p.getByTestId("match-final-score").innerText(), /^\d+–\d+$/);
      assert.match(await p.locator('[data-testid="match-prediction"] h2').innerText(), /^Pre-match prediction$/);
      assert.match(await p.getByTestId("match-subtitle").innerText(), /^Final score and pre-match prediction · Premier League · Matchday \d+$/);
      assert.match(await p.title(), /^.+ \d+–\d+ .+ \(.+\): result and pre-match prediction \| Foot Simu$/);
      assert.equal(await p.getByTestId("match-impact").count(), 0);
      assert.equal(await p.getByTestId("match-impact-loading").count(), 0, "played: no placeholder either");
      // Played: no dice (it has its real score).
      assert.equal(await p.getByTestId("match-dice").count(), 0);
      assert.equal(await p.locator('nav[aria-label="Breadcrumb"]').count(), 1);
      // Inside the index window: indexable.
      assert.equal(await p.locator('meta[name="robots"][content*="noindex"]').count(), 0);
      // A game moved to another day: its old address redirects; an unknown one is a 404.
      const moved = await p.request.get(`${BASE_URL}${upcoming.replace(/\d{2}$/, (d) => String(Number(d) === 1 ? 2 : Number(d) - 1).padStart(2, "0"))}`, { maxRedirects: 0 });
      assert.equal(moved.status(), 308);
      // (`next start` sends an ISR page's redirect with the same Location twice; Playwright joins them.)
      assert.equal(new URL(moved.headers().location.split(", ")[0], BASE_URL).pathname, upcoming);
      assert.equal((await p.goto(`${BASE_URL}/en/premier-league/match/nobody-vs-noone-2026-11-08`)).status(), 404);
      // The clubs' other meeting is months away: no redirect to it, a 404.
      assert.equal((await p.goto(`${BASE_URL}${upcoming.replace(/\d{4}-\d{2}-\d{2}$/, "2027-05-20")}`)).status(), 404);
      // Far from today (over 14 days ahead): the page loads, asking not to be indexed.
      const leaguePage = await p.goto(`${BASE_URL}/en/premier-league`);
      assert.equal(leaguePage.status(), 200);
      // The last matchday: far ahead.
      const matchdays = p.getByTestId("matchday-select");
      if (await matchdays.count()) {
        const last = await matchdays.locator("option").last().getAttribute("value");
        await matchdays.selectOption(last);
      }
      const farHref = await p.locator('[data-testid="fixtures"]').getByRole("link", { name: "Match preview" }).last().getAttribute("href");
      const far = await p.goto(`${BASE_URL}${farHref}`);
      assert.equal(far.status(), 200);
      assert.match(await p.locator('meta[name="robots"]').getAttribute("content"), /noindex,\s*follow/);
      assert.ok(!sitemap.includes(`https://footsimu.com${farHref}<`), "not in the sitemap");
      // Breadcrumb label in Portuguese and Spanish.
      await p.goto(`${BASE_URL}${upcoming.replace(/^\/en/, "/pt")}`);
      assert.equal(await p.locator('nav[aria-label="Trilha de navegação"]').count(), 1);
      await p.goto(`${BASE_URL}${upcoming.replace(/^\/en/, "/es")}`);
      assert.equal(await p.locator('nav[aria-label="Ruta de navegación"]').count(), 1);
      // From a club page's fixture list: only games inside the window are links; the rest are plain text.
      const club = sitemap.match(/https:\/\/footsimu\.com(\/en\/premier-league\/team\/[a-z0-9-]+)/)[1];
      await p.goto(`${BASE_URL}${club}`);
      const clubLinks = await p.locator('[data-testid="club-fixture"] [data-testid="club-match-link"]').evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      assert.ok(clubLinks.length > 0);
      for (const href of clubLinks) {
        assert.match(href, /^\/en\/premier-league\/match\/[a-z0-9-]+-vs-[a-z0-9-]+-\d{4}-\d{2}-\d{2}$/);
        assert.ok(sitemap.includes(`https://footsimu.com${href}<`), `${href} is in the window (the sitemap's)`);
      }
      assert.ok((await p.getByTestId("club-fixture").count()) > clubLinks.length, "later games are plain text");
      await p.close();
      // Phones: nothing past the screen's edge (element edges: a phone viewport widens to fit its content);
      // each result's column headed by one line (the winner's crest and the score).
      for (const width of [320, 360, 390]) {
        const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
        const m = await ctx.newPage();
        await m.goto(`${BASE_URL}${upcoming}`);
        await m.getByTestId("match-impact").waitFor({ timeout: 60_000 });
        // (Screen-reader-only content, like the H1 on phones, is clipped: not counted.)
        const right = await m.evaluate(() => Math.max(...[...document.querySelectorAll("body *")].filter((e) => !e.closest(".sr-only")).map((e) => e.getBoundingClientRect().right)));
        // Phones: no visible H1 (the match card names the clubs), but one in the page.
        assert.equal(await m.locator("h1").count(), 1);
        assert.ok(!(await m.locator("h1").isVisible()) || (await m.locator("h1").boundingBox()).width <= 1, `${width}px: no visible H1`);
        assert.ok(right <= width + 0.5, `${width}px: content reaches ${right}px`);
        const heads = await m.getByTestId("match-impact-head").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        assert.equal(heads.length, 3);
        for (const h of heads) assert.ok(h <= 20, `${width}px: a result's header is one line (${h}px)`);
        await ctx.close();
      }
      // The league page's fixture rows on a phone: the preview link and the dice, 44px each, apart.
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const m = await ctx.newPage();
      await m.goto(`${BASE_URL}/en/premier-league`);
      const row = m.locator('[data-testid="match-row"]').filter({ has: m.locator('svg[data-icon="dices"]') }).first();
      await row.waitFor();
      const boxes = await Promise.all([row.getByRole("link", { name: "Match preview" }).boundingBox(), row.getByRole("button", { name: "Simulate this match" }).boundingBox()]);
      for (const box of boxes) assert.ok(box.width >= 44 && box.height >= 44, `tap target ${box.width}×${box.height}`);
      assert.ok(boxes[0].x + boxes[0].width <= boxes[1].x, "side by side, not overlapping");
      await ctx.close();
    });

    await step("projected final table: one club per place, round by round, the round picker, fits a phone", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await p.goto(`${BASE_URL}/en/premier-league`);
      const section = p.getByTestId("projected");
      assert.equal(await section.locator("h2").innerText(), "Projected final table");
      const places = async () => (await section.locator('[data-testid="projected-table"] tbody tr td:first-child').allInnerTexts()).map(Number);
      assert.deepEqual(await places(), Array.from({ length: 20 }, (_, i) => i + 1));
      // Every club links to its page.
      assert.equal(await section.locator('[data-testid="projected-row"] a[href^="/en/premier-league/team/"]').count(), 20);
      // Round by round: a column per round, a row per club, every round's places 1–20 once each.
      const grid = section.getByTestId("projected-grid");
      const columns = await grid.locator("thead th button").count();
      assert.ok(columns > 1, `${columns} rounds`);
      assert.equal(await grid.locator("tbody tr").count(), 20);
      const first = (await grid.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.querySelectorAll("td")[0].textContent))).map(Number).sort((a, b) => a - b);
      assert.deepEqual(first, Array.from({ length: 20 }, (_, i) => i + 1));
      // The picker: the latest first; back a round, and a round from the grid.
      const select = section.getByTestId("projected-round");
      assert.equal(await select.inputValue(), String(columns - 1));
      assert.ok(await section.getByTestId("projected-next").isDisabled());
      await section.getByTestId("projected-previous").click();
      assert.equal(await select.inputValue(), String(columns - 2));
      await grid.locator("thead th button").first().click();
      assert.equal(await select.inputValue(), "0");
      assert.ok(await section.getByTestId("projected-previous").isDisabled());
      assert.deepEqual((await places()).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
      await p.close();
      // Phones: the page doesn't scroll sideways (the grid scrolls inside its box).
      const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
      const phone = await ctx.newPage();
      await phone.goto(`${BASE_URL}/pt/premier-league`);
      assert.equal(await phone.getByTestId("projected").locator("h2").innerText(), "Classificação final projetada");
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 360, "no sideways scroll at 360px");
      await ctx.close();
    });

    await step("odds reports: latest and per round, movers, table, key game, race chart, SEO, card, hub, nav, sitemap", async () => {
      const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      // From the league page and the main menu.
      await p.goto(`${BASE_URL}/en/premier-league`);
      assert.equal(await p.getByTestId("league-latest-odds").getAttribute("href"), "/en/premier-league/odds");
      assert.match(await p.getByTestId("league-latest-odds").innerText(), /^Latest odds: what changed after Matchday \d+$/);
      assert.equal(await p.getByTestId("nav-latest-odds").getAttribute("href"), "/en/odds");
      await p.getByTestId("league-latest-odds").click();
      await p.waitForURL(`${BASE_URL}/en/premier-league/odds`);
      await p.goto(`${BASE_URL}/en/premier-league/odds`);
      assert.equal(await p.locator("h1").count(), 1);
      const h1 = await p.locator("h1").innerText();
      const round = Number(h1.match(/^Premier League title odds after Matchday (\d+)$/)[1]);
      assert.match(await p.title(), new RegExp(`^Latest Premier League odds: what changed after Matchday ${round} \\| Foot Simu$`));
      assert.match(await p.locator('meta[name="description"]').getAttribute("content"), /who rose and who fell after Matchday \d+\. .+ lead the title race at \d+%/);
      assert.equal(await p.locator('link[rel="canonical"]').getAttribute("href"), "https://footsimu.com/en/premier-league/odds");
      assert.equal(await p.locator('link[rel="alternate"][hreflang="pt-BR"]').getAttribute("href"), "https://footsimu.com/pt/premier-league/odds");
      assert.match(await p.locator('meta[property="og:image"]').getAttribute("content"), /\/premier-league\/odds\/opengraph-image/);
      const ld = JSON.parse(await p.locator('script[type="application/ld+json"]').first().textContent());
      assert.equal(ld["@graph"][0]["@type"], "Article");
      assert.equal(ld["@graph"][0].headline, h1);
      assert.match(ld["@graph"][0].datePublished, /^\d{4}-\d{2}-\d{2}$/);
      // Risers and fallers: title, Champions League, relegation; Lucide arrows, no emojis.
      assert.deepEqual(await p.getByTestId("odds-category").evaluateAll((els) => els.map((e) => e.dataset.kind)), ["title", "continental", "relegation"]);
      assert.ok((await p.getByTestId("odds-mover").count()) > 0);
      assert.ok((await p.locator('[data-testid="odds-movers"] svg[data-icon="trending-up"]').count()) > 0);
      assert.ok((await p.locator('[data-testid="odds-movers"] svg[data-icon="trending-down"]').count()) > 0);
      assert.doesNotMatch(await p.locator("main").innerText(), /\p{Extended_Pictographic}/u, "no emojis");
      assert.match(await p.locator('[data-testid="odds-sentences"]').first().innerText(), /chances (rose|fell) from \d+% to \d+%\./);
      // Every club, the key game with its match page, the race.
      assert.equal(await p.getByTestId("odds-row").count(), 20);
      assert.match(await p.getByTestId("odds-result-link").getAttribute("href"), /^\/en\/premier-league\/match\/[a-z0-9-]+-vs-[a-z0-9-]+-\d{4}-\d{2}-\d{2}$/);
      assert.match(await p.getByTestId("odds-result-score").innerText(), /^\d+–\d+$/);
      assert.equal(await p.locator('[data-testid="race-legend"] li').count(), 5);
      const archive = await p.locator('[data-testid="odds-archive"] a').evaluateAll((links) => links.map((a) => a.getAttribute("href")));
      assert.ok(archive.length >= 2);
      assert.equal(await p.locator('[data-testid="race-table"] tbody tr').count(), archive.length);
      assert.equal(archive[0], `/en/premier-league/odds/matchday-${round}`);
      // An earlier round's own page.
      await p.goto(`${BASE_URL}${archive[1]}`);
      const earlier = Number(archive[1].match(/matchday-(\d+)$/)[1]);
      assert.equal(await p.locator("h1").innerText(), `Premier League title odds after Matchday ${earlier}`);
      assert.equal(await p.locator('link[rel="canonical"]').getAttribute("href"), `https://footsimu.com${archive[1]}`);
      assert.match(await p.title(), new RegExp(`^Premier League title odds after Matchday ${earlier} \\(\\d{4}(/\\d{2})?\\) \\| Foot Simu$`));
      assert.equal((await p.request.get(`${BASE_URL}${archive[1]}/opengraph-image`)).headers()["content-type"], "image/png");
      // Indexable, unlike the season's first report.
      assert.equal(await p.locator('meta[name="robots"][content*="noindex"]').count(), 0);
      // The season's first report: nothing to compare with, so no changes, its own description, noindex, not in the sitemap.
      const first = archive.at(-1);
      await p.goto(`${BASE_URL}${first}`);
      assert.match(await p.locator('meta[name="robots"]').getAttribute("content"), /noindex,\s*follow/);
      const firstDescription = await p.locator('meta[name="description"]').getAttribute("content");
      assert.doesNotMatch(firstDescription, /rose|fell|since the last round/);
      assert.match(firstDescription, /every club's .+ chances after Matchday \d+, from [\d,]+ simulated seasons\./);
      assert.equal(await p.locator('meta[property="og:description"]').getAttribute("content"), firstDescription);
      assert.match(await p.getByTestId("odds-movers").innerText(), /first report/);
      assert.equal(await p.locator('[data-testid="odds-table"] svg[data-icon^="trending"]').count(), 0, "no changes");
      assert.doesNotMatch(await p.getByTestId("odds-table").innerText(), /±0/, "no made-up ±0");
      const firstMap = await (await p.request.get(`${BASE_URL}/sitemap.xml`)).text();
      assert.ok(!firstMap.includes(`https://footsimu.com${first}<`), "the first report isn't in the sitemap");
      assert.ok(firstMap.includes(`https://footsimu.com${archive[0]}<`), "the latest is");
      // Portuguese and Spanish.
      await p.goto(`${BASE_URL}/pt/premier-league/odds`);
      assert.match(await p.locator("h1").innerText(), /^Premier League: chances de título após a Rodada \d+$/);
      await p.goto(`${BASE_URL}/es/premier-league/odds`);
      assert.match(await p.locator("h1").innerText(), /^Premier League: probabilidades de título tras la Jornada \d+$/);
      // No such round, or no reports (a continental competition): 404.
      assert.equal((await p.goto(`${BASE_URL}/en/premier-league/odds/matchday-999`)).status(), 404);
      assert.equal((await p.goto(`${BASE_URL}/en/champions-league/odds`)).status(), 404);
      // The hub: every domestic league's latest report.
      await p.goto(`${BASE_URL}/en/odds`);
      assert.equal(await p.locator("h1").count(), 1);
      assert.ok((await p.getByTestId("odds-hub-item").count()) >= 30);
      // Every report in the sitemap.
      const sitemap = await (await p.request.get(`${BASE_URL}/sitemap.xml`)).text();
      for (const path of ["/en/odds", "/pt/premier-league/odds", ...archive.slice(0, -1).map((a) => a.replace(/^\/en/, "/es"))]) assert.ok(sitemap.includes(`https://footsimu.com${path}<`), path);
      await p.close();
      // Phones: nothing past the screen's edge; the menu's link.
      for (const width of [360, 390]) {
        const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
        const m = await ctx.newPage();
        for (const path of ["/en/premier-league/odds", "/pt/premier-league/odds", "/es/j1-league/odds", "/pt/odds"]) {
          await m.goto(`${BASE_URL}${path}`);
          const right = await m.evaluate(() => Math.max(...[...document.querySelectorAll("body *")].filter((e) => !e.closest(".sr-only, details:not([open])")).map((e) => e.getBoundingClientRect().right)));
          assert.ok(right <= width + 0.5, `${path} at ${width}px reaches ${right}px`);
          // The table's column names fit, in whole words ("Rebaix." on phones in Portuguese).
          const cut = await m.getByTestId("odds-column").evaluateAll((cols) => cols.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent));
          assert.deepEqual(cut, [], `${path} at ${width}px`);
        }
        await m.getByTestId("mobile-menu-button").click();
        assert.equal(await m.getByTestId("mobile-latest-odds").getAttribute("href"), "/pt/odds");
        await ctx.close();
      }
    });

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
