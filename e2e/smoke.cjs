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
      await menu.getByRole("button", { name: "Brasil" }).click();
      assert.deepEqual((await menu.locator("#menu-br a").allInnerTexts()).map((x) => x.trim()), ["Brasileirão Série A", "Brasileirão Série B"]);
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
      for (const [country, flag, leagues] of [["Germany", "de", ["Bundesliga", "2. Bundesliga"]], ["Italy", "it", ["Serie A", "Serie B"]], ["France", "fr", ["Ligue 1", "Ligue 2"]]]) {
        await menu.getByRole("button", { name: country }).click();
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

    await step("header menu: countries A–Z with league submenus, no scrollbar", async () => {
      const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await desktop.goto(`${BASE_URL}/en`);
      const menu = desktop.locator('[data-testid="league-menu"]');
      const countries = (await menu.locator(":scope > li > button").allInnerTexts()).map((x) => x.trim());
      assert.deepEqual(countries, ["Brazil", "England", "France", "Germany", "Italy", "Netherlands", "Portugal", "Spain", "USA"]);
      const overflow = await menu.evaluate((el) => el.scrollWidth - el.clientWidth);
      assert.equal(overflow, 0, "no horizontal scroll in the menu");

      await menu.getByRole("button", { name: "England" }).hover();
      const england = menu.locator("#menu-gb-eng");
      await england.waitFor();
      assert.deepEqual((await england.locator("a").allInnerTexts()).map((x) => x.trim()), ["Premier League", "Championship", "League One", "League Two", "FA Cup"]);
      await england.getByRole("link", { name: "Championship" }).click();
      await desktop.waitForURL(/\/en\/championship$/);
      await desktop.close();

      const pt = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await pt.goto(`${BASE_URL}/pt`);
      const ptCountries = (await pt.locator('[data-testid="league-menu"] > li > button').allInnerTexts()).map((x) => x.trim());
      assert.equal(ptCountries[0], "Alemanha");
      assert.equal(ptCountries.at(-1), "Portugal");
      await pt.close();

      const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
      await phone.goto(`${BASE_URL}/en`);
      assert.equal(await phone.locator('[data-testid="league-menu"]').isVisible(), false, "country bar hidden on phones");
      const burger = phone.locator('[data-testid="mobile-menu-button"]');
      await burger.tap();
      const panel = phone.locator('[data-testid="mobile-menu"]');
      await panel.waitFor();
      const headings = (await panel.locator(":scope > ul > li > p").allInnerTexts()).map((x) => x.trim().toLowerCase());
      assert.deepEqual(headings, ["brazil", "england", "france", "germany", "italy", "netherlands", "portugal", "spain", "usa"]);
      await phone.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
      await burger.tap();
      await panel.getByRole("link", { name: "Brasileirão Série B" }).tap();
      await phone.waitForURL(/\/en\/brasileirao-serie-b$/);
      await panel.waitFor({ state: "detached" });
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth), 390, "no horizontal page scroll");
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
