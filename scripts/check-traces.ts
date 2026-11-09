/**
 * After `npm run build`: checks the built functions' file traces (.next/server/app/**\/*.nft.json)
 * against src/config/fileTracing.ts. Every listed entry must carry each group of files it reads
 * (Past Winners' history, the odds snapshots, the stored xG, the cards' fonts and crests), and no
 * entry may carry a group it doesn't read: what ships in each function is what it uses.
 *
 *   npm run build && npm run traces:check
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ROUTE_FILES, TRACED_FILES, type TracedGroup } from "../src/config/fileTracing.ts";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const app = join(root, ".next/server/app");
const GROUP_DIRS: Record<TracedGroup, RegExp> = {
  history: /\/src\/data\/history\//,
  snapshots: /\/src\/data\/snapshots\//,
  xg: /\/src\/data\/xg\//,
  cards: /\/(src\/assets\/fonts|public\/crests)\//,
};

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : name.endsWith(".nft.json") ? [join(dir, name)] : []));

let failures = 0;
let total = 0;
const rows: string[] = [];
for (const trace of walk(app)) {
  const entry = `/${trace.slice(app.length + 1).replace(/\.js\.nft\.json$/, "")}`;
  const { files } = JSON.parse(readFileSync(trace, "utf8")) as { files: string[] };
  const paths = files.map((f) => resolve(dirname(trace), f));
  let bytes = 0;
  for (const p of paths) {
    try {
      bytes += statSync(p).size;
    } catch {
      // A traced path that isn't on disk here (a platform file): not counted.
    }
  }
  total += bytes;
  const carried = (Object.keys(GROUP_DIRS) as TracedGroup[]).filter((g) => paths.some((p) => GROUP_DIRS[g].test(p)));
  const wanted = ROUTE_FILES[entry] ?? [];
  const missing = wanted.filter((g) => !carried.includes(g));
  const extra = carried.filter((g) => !wanted.includes(g));
  if (missing.length || extra.length) failures++;
  rows.push(`${missing.length || extra.length ? "FAIL" : "ok  "} ${entry.padEnd(62)} ${(bytes / 1048576).toFixed(1).padStart(6)} MB  ${carried.join(",") || "-"}${missing.length ? `  missing: ${missing.join(",")}` : ""}${extra.length ? `  extra: ${extra.join(",")}` : ""}`);
}
for (const entry of Object.keys(ROUTE_FILES)) {
  if (!walk(app).some((t) => t.endsWith(`${entry}.js.nft.json`))) {
    failures++;
    rows.push(`FAIL ${entry}: no such built entry`);
  }
}
console.log(rows.sort().join("\n"));
console.log(`\n${rows.length} entries, ${(total / 1048576).toFixed(0)} MB traced in all (each function's files counted once per function); files listed in ${Object.keys(TRACED_FILES).length} groups.`);
if (failures) {
  console.error(`${failures} entr${failures === 1 ? "y doesn't" : "ies don't"} carry exactly the files they read (src/config/fileTracing.ts).`);
  process.exit(1);
}
