// Expected goals (xG) for every played game of this season and last, from
// ESPN's core API, into src/data/xg/<CODE>.json (see src/lib/xg.ts). Only
// games not stored yet are fetched (and recent ones ESPN had no xG for yet);
// gently: two requests at a time, a pause between, retries with backoff.
//
//   npm run xg                 every league with xG
//   npm run xg -- PL BSA       only these
//   npm run xg -- --dry-run    fetch and print, write nothing

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLeagueByCode } from "../src/config/leagues.ts";
import { fetchEspnSeason } from "../src/lib/espn.ts";
import { currentSeasonYear } from "../src/lib/leagueData.ts";
import { formatXgFile, xgFromStats, XG_LEAGUES, type XgFile } from "../src/lib/xg.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/data/xg");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.filter((a) => !a.startsWith("--"));
const CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues";
/** Requests at a time, and the pause each takes after a request. */
const CONCURRENCY = 2;
const PAUSE_MS = 150;
/** A game with no xG yet is asked again while it's this recent (ESPN can add it hours later). */
const RECHECK_DAYS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The home side's statistics for a game; null for none (404); retries 429s, 5xx and network errors with backoff. */
async function homeStats(slug: string, id: string, teamId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${CORE}/${slug}/events/${id}/competitions/${id}/competitors/${teamId}/statistics`);
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as Parameters<typeof xgFromStats>[0];
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      // Network error: try again.
    }
    await sleep(1000 * 2 ** attempt);
  }
  throw new Error(`ESPN ${slug} ${id}: no answer after 5 tries`);
}

async function read(code: string): Promise<XgFile> {
  try {
    return JSON.parse(await readFile(join(DIR, `${code}.json`), "utf8")) as XgFile;
  } catch {
    return { league: code as XgFile["league"], matches: {} };
  }
}

let fetched = 0;
for (const code of XG_LEAGUES.filter((c) => !only.length || only.includes(c))) {
  const league = getLeagueByCode(code)!;
  const file = await read(code);
  const current = currentSeasonYear(league);
  const recent = Date.now() - RECHECK_DAYS * 86_400_000;
  const todo: { id: string; home: string; date: string }[] = [];
  for (const year of [current, current - 1]) {
    const events = await fetchEspnSeason(league.espn.slug, year, league.espn.seasons);
    for (const e of events) {
      if (!e.status.type.completed || e.status.type.state !== "post") continue;
      const home = e.competitions[0]?.competitors.find((c) => c.homeAway === "home");
      if (!home || !/^\d+$/.test(home.team.id)) continue;
      const stored = file.matches[e.id];
      if (stored !== undefined && !(stored === null && Date.parse(e.date) > recent)) continue;
      todo.push({ id: e.id, home: home.team.id, date: e.date });
    }
  }
  let found = 0;
  let queue = 0;
  const work = async () => {
    while (queue < todo.length) {
      const game = todo[queue++]!;
      const stats = await homeStats(league.espn.slug, game.id, game.home);
      const xg = stats ? xgFromStats(stats) : null;
      file.matches[game.id] = xg;
      if (xg) found++;
      fetched++;
      await sleep(PAUSE_MS);
    }
  };
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, work));
  } catch (error) {
    console.error(`${code}: stopped:`, error);
  }
  const total = Object.values(file.matches);
  console.log(`${code}: ${todo.length} fetched (${found} with xG); stored ${total.length} games, ${total.filter(Boolean).length} with xG`);
  if (!dryRun && todo.length) {
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, `${code}.json`), formatXgFile(file));
  }
}
console.log(`${fetched} request(s)${dryRun ? " (dry run, nothing written)" : ""}`);
