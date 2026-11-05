// Odds snapshots: after each completed round of each domestic league, every
// club's season chances (title, each place, relegation, expected position),
// appended to src/data/snapshots/<CODE>.json. Run by .github/workflows/odds-snapshots.yml
// every few hours, which commits the files; safe to run again (rounds already
// stored are skipped).
//
//   npm run snapshots                 every domestic league
//   npm run snapshots -- PL BSA       only these
//   npm run snapshots -- --dry-run    print, write nothing
//   npm run snapshots -- --backfill   also every earlier completed round of the season not stored yet
//   npm run snapshots -- --projected  add each club's projected place to the season's stored rounds that lack it

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES } from "../src/config/leagues.ts";
import { hasClubPages } from "../src/lib/clubs.ts";
import { getLeagueData } from "../src/lib/leagueData.ts";
import { addSnapshots, backfillFrom, completedRounds, missingRounds, pendingRounds, snapshotAfter, type LeagueSnapshots } from "../src/lib/snapshots.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/data/snapshots");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const backfill = args.includes("--backfill");
const projectedOnly = args.includes("--projected");
const only = args.filter((a) => !a.startsWith("--"));

// Real data only: never snapshot the generated sample leagues.
if (process.env.FOOTSIMU_SAMPLE_DATA === "1") throw new Error("snapshots need real data: unset FOOTSIMU_SAMPLE_DATA");

/** One snapshot per line, so each new round is a one-line diff. */
function format(file: LeagueSnapshots): string {
  const seasons = Object.entries(file.seasons).map(([key, { season, snapshots }]) => {
    const lines = snapshots.map((s) => `        ${JSON.stringify(s)}`).join(",\n");
    return `    ${JSON.stringify(key)}: {\n      "season": ${JSON.stringify(season)},\n      "snapshots": [\n${lines}\n      ]\n    }`;
  });
  return `{\n  "league": ${JSON.stringify(file.league)},\n  "seasons": {\n${seasons.join(",\n")}\n  }\n}\n`;
}

async function read(code: string): Promise<LeagueSnapshots | undefined> {
  try {
    return JSON.parse(await readFile(join(DIR, `${code}.json`), "utf8")) as LeagueSnapshots;
  } catch {
    return undefined;
  }
}

let added = 0;
let failed = 0;
for (const league of LEAGUES.filter((l) => hasClubPages(l) && (!only.length || only.includes(l.code)))) {
  try {
    const data = await getLeagueData(league);
    // ESPN only: its game ids and rebuilt rounds stay the same from run to run.
    if (data.source !== "live" || data.provider !== "espn") {
      console.warn(`${league.code}: skipped (no ESPN data)`);
      continue;
    }
    const file = await read(league.code);
    if (projectedOnly) {
      const season = file?.seasons[data.seasonKey];
      const todo = season?.snapshots.filter((x) => Object.values(x.teams).some((t) => t.projected === undefined)) ?? [];
      let differ = 0;
      for (const stored of todo) {
        // The same run again (same data up to the same moment, same seed): only the projected places are taken from it.
        const again = snapshotAfter(league, data, stored.round, new Date(Date.parse(stored.asOf) - 60_000).toISOString(), new Date(stored.takenAt), stored.iterations);
        if (!again) continue;
        for (const [id, team] of Object.entries(stored.teams)) {
          const fresh = again.teams[id];
          if (!fresh) continue;
          if (JSON.stringify(fresh.chances) !== JSON.stringify(team.chances)) differ++;
          team.projected = fresh.projected!;
          team.projectedChance = fresh.projectedChance!;
        }
      }
      console.log(`${league.code} ${data.season}: projected places added to ${todo.length} round(s)${differ ? ` (${differ} club rows' chances differ from the stored ones)` : ""}`);
      added += todo.length;
      if (!dryRun && todo.length && file) await writeFile(join(DIR, `${league.code}.json`), format(file));
      continue;
    }
    const completed = completedRounds(data.fixtures);
    const from = backfill ? backfillFrom(league, data) : undefined;
    const pending = backfill ? missingRounds(file, data.seasonKey, completed).filter((r) => !from || r.lastKickoff >= from) : pendingRounds(file, data.seasonKey, completed);
    if (!pending.length) {
      console.log(`${league.code} ${data.season}: up to date`);
      continue;
    }
    const snapshots = pending.flatMap((r) => snapshotAfter(league, data, r.round, r.lastKickoff) ?? []);
    for (const s of snapshots) console.log(`${league.code} ${data.season}: round ${s.round} (${s.date}), ${Object.keys(s.teams).length} clubs`);
    added += snapshots.length;
    if (!dryRun && snapshots.length) {
      await mkdir(DIR, { recursive: true });
      await writeFile(join(DIR, `${league.code}.json`), format(addSnapshots(file, league.code, data.seasonKey, data.season, snapshots)));
    }
  } catch (error) {
    failed++;
    console.error(`${league.code}: failed:`, error);
  }
}
console.log(`${added} new snapshot(s)${dryRun ? " (dry run, nothing written)" : ""}${failed ? `, ${failed} league(s) failed` : ""}`);
// A league failing (the feed down) shouldn't block the others' snapshots; fail the run only if every league failed.
if (failed && failed === LEAGUES.filter((l) => hasClubPages(l) && (!only.length || only.includes(l.code))).length) process.exit(1);
