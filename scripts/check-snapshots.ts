// Snapshot drift check: for every league file in src/data/snapshots, takes its
// current season's latest stored snapshot again with the live engine (the same
// moment, iterations and model, see REPRODUCIBLE_MODELS in src/lib/snapshots.ts)
// and compares every club's figures: its table row, its chance of each place,
// its expected place and points, and its projected place. Snapshots are rounded
// to 4 decimals from a seeded run, so the live engine should give exactly the
// same numbers (DRIFT_EPSILON = 0); any difference fails the check.
//
//   npm run snapshots:check              every league with a snapshot file
//   npm run snapshots:check -- PL ELC    only these
//
// A drift means the stored history no longer matches what the engine says about
// those rounds: the engine changed without a SIM_VERSION bump, or ESPN corrected
// a result, or a game's xG arrived after its round was taken. Retake the league's
// season with `npm run snapshots -- <CODE> --rebuild` (or bump SIM_VERSION when
// the model changed on purpose). A league whose data can't be loaded from ESPN,
// with no snapshot of its current season, or whose latest snapshot is of a
// model today's engine can't retake, is skipped (and reported), not failed.
// Run by CI (.github/workflows/ci.yml).

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLeagueByCode } from "../src/config/leagues.ts";
import { getLeagueData } from "../src/lib/leagueData.ts";
import { REPRODUCIBLE_MODELS, snapshotAfter, snapshotDrift, snapshotModel, type LeagueSnapshots } from "../src/lib/snapshots.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/data/snapshots");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (process.env.FOOTSIMU_SAMPLE_DATA === "1") throw new Error("the drift check needs real data: unset FOOTSIMU_SAMPLE_DATA");

const codes = (await readdir(DIR))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((code) => !only.length || only.includes(code))
  .sort();

let checked = 0;
let skipped = 0;
const drifted: string[] = [];
for (const code of codes) {
  const league = getLeagueByCode(code);
  if (!league) {
    console.log(`${code}: skipped (no such league)`);
    skipped++;
    continue;
  }
  const file = JSON.parse(await readFile(join(DIR, `${code}.json`), "utf8")) as LeagueSnapshots;
  const data = await getLeagueData(league).catch(() => undefined);
  // The snapshots are of ESPN data (its game ids and rounds): nothing to compare with otherwise.
  if (!data || data.source !== "live" || data.provider !== "espn") {
    console.log(`${code}: skipped (no ESPN data now)`);
    skipped++;
    continue;
  }
  const snapshots = file.seasons[data.seasonKey]?.snapshots ?? [];
  const latest = [...snapshots].sort((a, b) => a.round - b.round).at(-1);
  if (!latest) {
    console.log(`${code}: skipped (no snapshot of ${data.season} yet)`);
    skipped++;
    continue;
  }
  const model = snapshotModel(latest);
  if (!REPRODUCIBLE_MODELS[model]) {
    console.log(`${code}: skipped (round ${latest.round} is model ${model}, which today's engine can't retake)`);
    skipped++;
    continue;
  }
  const again = snapshotAfter(league, data, latest.round, new Date(Date.parse(latest.asOf) - 60_000).toISOString(), new Date(latest.takenAt), latest.iterations, model);
  checked++;
  const drift = again ? snapshotDrift(latest, again) : [{ teamId: "-", field: "snapshot" }];
  if (!drift.length) {
    console.log(`${code} ${data.season} round ${latest.round} (model ${model}): reproduced`);
    continue;
  }
  drifted.push(code);
  const names = new Map(data.teams.map((t) => [String(t.id), t.shortName ?? t.name]));
  const largest = Math.max(0, ...drift.map((d) => (d.stored !== undefined && d.again !== undefined ? Math.abs(d.stored - d.again) : 0)));
  console.log(`${code} ${data.season} round ${latest.round} (model ${model}): DRIFT in ${drift.length} figure(s), largest ${largest.toFixed(4)}`);
  for (const d of drift.slice(0, 8)) console.log(`  ${names.get(d.teamId) ?? d.teamId} ${d.field}: ${d.stored ?? "–"} stored, ${d.again ?? "–"} now`);
  if (drift.length > 8) console.log(`  … and ${drift.length - 8} more`);
}

console.log(`\n${checked} league(s) checked, ${skipped} skipped${drifted.length ? `; drift in ${drifted.join(", ")}: retake with \`npm run snapshots -- <CODE> --rebuild\`` : ", no drift"}`);
if (drifted.length) process.exit(1);
