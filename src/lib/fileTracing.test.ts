import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { NEVER_TRACED, ROUTE_FILES, routeGlob, TRACED_FILES, tracingExcludes, tracingIncludes, type TracedGroup } from "../config/fileTracing.ts";

/*
 * The files a server function reads at run time must be traced into it
 * (src/config/fileTracing.ts): follows every route's imports to the modules
 * that read them and checks the route is given those files, so a new reader
 * (or a route that starts using one) can't ship without them.
 */

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");

/** The modules that read files from disk, and which group they read. */
const READERS: Record<string, TracedGroup> = {
  "src/lib/winnersData.ts": "history",
  "src/lib/oddsReports.ts": "snapshots",
  "src/lib/xgStore.ts": "xg",
  "src/lib/shareCard.tsx": "cards",
};

const importsOf = new Map<string, string[]>();
function imports(file: string): string[] {
  let found = importsOf.get(file);
  if (found) return found;
  const source = readFileSync(join(root, file), "utf8");
  found = [];
  for (const m of source.matchAll(/(?:import|export)\s[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = (m[1] ?? m[2])!;
    if (!spec.startsWith(".")) continue;
    const target = relative(root, resolve(join(root, dirname(file)), spec));
    if (existsSync(join(root, target)) && statSync(join(root, target)).isFile()) found.push(target);
  }
  importsOf.set(file, found);
  return found;
}

function groupsRead(entry: string): Set<TracedGroup> {
  const seen = new Set([entry]);
  const stack = [entry];
  const groups = new Set<TracedGroup>();
  while (stack.length) {
    const file = stack.pop()!;
    if (READERS[file]) groups.add(READERS[file]);
    for (const next of imports(file)) if (!seen.has(next)) (seen.add(next), stack.push(next));
  }
  return groups;
}

const walk = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((name) => (statSync(join(root, dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
/** Every server entry under src/app, as Turbopack names it ("/[locale]/[league]/page", "/sitemap.xml/route"), and its file. */
const entries = walk("src/app")
  .filter((f) => /\/(page|route|opengraph-image|twitter-image)\.tsx?$/.test(f) || /^src\/app\/(sitemap|robots|manifest)\.ts$/.test(f))
  .map((file) => {
    const inApp = file.slice("src/app".length).replace(/\.tsx?$/, "");
    const name = /\/page$/.test(inApp)
      ? inApp
      : /\/route$/.test(inApp)
        ? inApp
        : /^\/(sitemap|robots|manifest)$/.test(inApp)
          ? `${inApp}.${{ "/sitemap": "xml", "/robots": "txt", "/manifest": "webmanifest" }[inApp]}/route`
          : `${inApp}/route`;
    return { file, route: name };
  });

// Turbopack matches a key anywhere in the entry's name; Next's picomatch with `contains` does the same.
const picomatch = createRequire(import.meta.url)("next/dist/compiled/picomatch") as (glob: string, options: object) => (path: string) => boolean;
const matches = (glob: string, route: string) => picomatch(glob, { dot: true, contains: true })(route);

describe("files traced into the server functions", () => {
  it("every route that reads files from disk is given them", () => {
    for (const { file, route } of entries) {
      const needed = [...groupsRead(file)].sort();
      const given = [...(ROUTE_FILES[route] ?? [])];
      for (const group of needed) assert.ok(given.includes(group), `${route} (${file}) reads ${group} but isn't given it`);
    }
  });

  it("each key matches its own route and no other, as Next matches them", () => {
    for (const route of Object.keys(ROUTE_FILES)) {
      assert.ok(entries.some((e) => e.route === route), `${route}: no such route`);
      const hit = entries.filter((e) => matches(routeGlob(route), e.route)).map((e) => e.route);
      assert.deepEqual([...new Set(hit)], [route], `${routeGlob(route)} matches ${hit.join(", ")}`);
    }
  });

  it("routes that read nothing get nothing: robots.txt, the legal pages, the site's and leagues' own cards", () => {
    const includes = tracingIncludes();
    for (const route of ["/robots.txt/route", "/[locale]/about/page", "/[locale]/privacy/page", "/[locale]/contact/page", "/[locale]/opengraph-image/route", "/[locale]/[league]/opengraph-image/route"]) {
      assert.deepEqual(Object.keys(includes).filter((glob) => matches(glob, route)), [], route);
    }
    // The fonts only where a card is drawn.
    const withCards = Object.entries(ROUTE_FILES).filter(([, groups]) => groups.includes("cards")).map(([route]) => route);
    assert.ok(withCards.every((route) => /(opengraph-image|twitter-image|movers-image)\/route$/.test(route)));
  });

  it("the fonts are excluded only from routes that don't draw a card; the site's own crests from every listed route", () => {
    const excludes = tracingExcludes();
    for (const [route, groups] of Object.entries(ROUTE_FILES)) {
      const excluded = excludes[routeGlob(route)] ?? [];
      // A card fetches the crest it draws (ownCrest in shareCard.tsx): no function carries public/crests.
      for (const files of NEVER_TRACED) assert.ok(excluded.includes(files), `${route} carries ${files}`);
      assert.equal(TRACED_FILES.cards.every((files) => excluded.includes(files)), !groups.includes("cards"), `${route}: the fonts`);
    }
    assert.ok(!Object.values(tracingIncludes()).flat().some((files) => files.includes("public/crests")), "no route is given the crests");
    // Every route that draws a card is listed, so its crests are excluded too.
    for (const { route, file } of entries) if (groupsRead(file).has("cards") && !/\/page$/.test(route)) assert.ok(ROUTE_FILES[route]?.includes("cards"), `${route} draws a card`);
  });
});
