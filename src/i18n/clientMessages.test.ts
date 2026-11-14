import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { CUP_SCOPE, LAYOUT_SCOPE, LEAGUE_SCOPE, MY_WORLD_SCOPE, PAST_WINNERS_SCOPE, pickMessages, SHARE_MENU_KEYS, SHARE_MENU_SCOPE, SHARE_PAGE_SCOPE, type MessageScope } from "./clientMessages.ts";

/*
 * Every route sends the browser only the messages its client components use
 * (src/i18n/clientMessages.ts). Follows each route's imports to the client
 * components it can render, reads which namespaces (and keys) they use, and
 * fails when its scope leaves one out: a client component without its
 * messages would show their keys instead.
 */

const root = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const importsOf = new Map<string, string[]>();
/** A module's own modules (not `import type`, which brings nothing to the page). */
function imports(file: string): string[] {
  let found = importsOf.get(file);
  if (found) return found;
  found = [];
  for (const m of read(file).matchAll(/(?:import|export)\s(?!type\s)[^"']*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = (m[1] ?? m[2])!;
    if (!spec.startsWith(".")) continue;
    const target = relative(root, resolve(join(root, dirname(file)), spec));
    if (existsSync(join(root, target)) && statSync(join(root, target)).isFile()) found.push(target);
  }
  importsOf.set(file, found);
  return found;
}

/** Each namespace a module reads with useTranslations, and the translator's name. */
const translators = (file: string) => [...read(file).matchAll(/(?:const|let)\s+(\w+)\s*=\s*useTranslations\(\s*["'](\w+)["']\s*\)/g)].map((m) => ({ name: m[1]!, namespace: m[2]! }));
const anyTranslations = (file: string) => [...read(file).matchAll(/useTranslations\(\s*["'](\w+)["']\s*\)/g)].map((m) => m[1]!);

const isClientEntry = (file: string) => /^\s*["']use client["']/.test(read(file));

/**
 * The client modules a route can render from `entries` (a "use client" module
 * and every module it imports run in the browser; a server component's
 * useTranslations needs nothing sent), not following into `stop`.
 */
function reach(entries: readonly string[], stop: readonly string[] = []): Set<string> {
  const seen = new Map<string, boolean>(entries.map((e) => [e, isClientEntry(e)]));
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop()!;
    const client = seen.get(file)!;
    for (const next of imports(file)) {
      if (stop.includes(next)) continue;
      const nextClient = client || isClientEntry(next);
      // Seen as a server module first, then reached from a client one: visit again as client.
      if (seen.has(next) && (seen.get(next) || !nextClient)) continue;
      seen.set(next, nextClient);
      stack.push(next);
    }
  }
  return new Set([...seen].filter(([, client]) => client).map(([file]) => file));
}

/** Does the scope send every message these modules' useTranslations read? Returns what's missing. */
function missing(files: Iterable<string>, scope: MessageScope): string[] {
  const out: string[] = [];
  for (const file of files) {
    for (const namespace of anyTranslations(file)) {
      const entries = scope.filter((e) => (typeof e === "string" ? e : e.namespace) === namespace);
      if (entries.some((e) => typeof e === "string")) continue;
      if (entries.length === 0) {
        out.push(`${file}: ${namespace}`);
        continue;
      }
      // Some of the namespace's keys: the module must read only those, by name.
      const keys = new Set(entries.flatMap((e) => (typeof e === "string" ? [] : e.keys)));
      const named = translators(file).filter((t) => t.namespace === namespace);
      if (named.length !== 1) {
        out.push(`${file}: ${namespace} (a translator per namespace, by name, for a scope of some keys)`);
        continue;
      }
      const source = read(file);
      const calls = [...source.matchAll(new RegExp(`\\b${named[0]!.name}(?:\\.\\w+)?\\(\\s*([^)]{0,80})`, "g"))].map((m) => m[1]!);
      for (const arg of calls) {
        const literal = arg.match(/^["']([\w.]+)["']/);
        if (!literal) out.push(`${file}: ${namespace} key not a literal (${arg.slice(0, 30)}…)`);
        else if (!keys.has(literal[1]!)) out.push(`${file}: ${namespace}.${literal[1]}`);
      }
    }
  }
  return out;
}

const pagesUnder = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? pagesUnder(join(dir, d.name)) : d.name === "page.tsx" || d.name === "not-found.tsx" ? [join(dir, d.name)] : []));

const C = (name: string) => `src/components/${name}`;
const APP = "src/app/[locale]";

/** Pages with client components of their own: which scope wraps which of them (the page itself: all of it). */
const SCOPED: Record<string, { scope: MessageScope; name: string; roots: string[] }[]> = {
  [`${APP}/[league]/page.tsx`]: [
    { scope: CUP_SCOPE, name: "CUP_SCOPE", roots: [C("CupSimulator.tsx")] },
    { scope: LEAGUE_SCOPE, name: "LEAGUE_SCOPE", roots: [C("LeagueSimulator.tsx"), C("TournamentSwitch.tsx")] },
  ],
  [`${APP}/[league]/team/[teamSlug]/page.tsx`]: [{ scope: SHARE_MENU_SCOPE, name: "SHARE_MENU_SCOPE", roots: [`${APP}/[league]/team/[teamSlug]/page.tsx`] }],
  [`${APP}/[league]/odds/page.tsx`]: [{ scope: SHARE_MENU_SCOPE, name: "SHARE_MENU_SCOPE", roots: [C("OddsReportView.tsx")] }],
  [`${APP}/[league]/odds/[round]/page.tsx`]: [{ scope: SHARE_MENU_SCOPE, name: "SHARE_MENU_SCOPE", roots: [C("OddsReportView.tsx")] }],
  [`${APP}/[league]/share/[code]/page.tsx`]: [{ scope: SHARE_PAGE_SCOPE, name: "SHARE_PAGE_SCOPE", roots: [`${APP}/[league]/share/[code]/page.tsx`] }],
  [`${APP}/[league]/past-winners/page.tsx`]: [{ scope: PAST_WINNERS_SCOPE, name: "PAST_WINNERS_SCOPE", roots: [C("PastWinners.tsx")] }],
  [`${APP}/my-world/page.tsx`]: [{ scope: MY_WORLD_SCOPE, name: "MY_WORLD_SCOPE", roots: [C("MyWorld.tsx")] }],
};

const locales = ["en", "pt", "es"] as const;
const messages = Object.fromEntries(locales.map((l) => [l, JSON.parse(read(`messages/${l}.json`)) as Record<string, Record<string, unknown>>]));

describe("the messages each route sends to the browser", () => {
  it("the layout: what the header's client components use, and nothing a page's own client components need", () => {
    const layout = `${APP}/layout.tsx`;
    assert.match(read(layout), /pickMessages\(await getMessages\(\), LAYOUT_SCOPE\)/);
    assert.deepEqual(missing(reach([layout]), LAYOUT_SCOPE), []);
    assert.deepEqual([...LAYOUT_SCOPE].sort(), ["Continents", "Countries", "Nav"]);
  });

  it("every page: its own client components get every namespace and key they use", () => {
    const pages = pagesUnder(APP);
    assert.ok(pages.length >= 15, "the pages are found");
    for (const page of pages) {
      const scoped = SCOPED[page] ?? [];
      const source = read(page);
      // What a page renders outside its scopes has only the layout's messages.
      const roots = scoped.flatMap((s) => s.roots);
      const outside = roots.includes(page) ? [] : [...reach([page], roots)];
      assert.deepEqual(missing(outside, LAYOUT_SCOPE), [], `${page}: a client component outside ClientMessages`);
      for (const { scope, name, roots: wrapped } of scoped) {
        assert.ok(source.includes(name), `${page} wraps its client components in ${name}`);
        assert.deepEqual(missing(reach(wrapped), scope), [], `${page}: ${name}`);
      }
      if (/<ClientMessages/.test(source)) assert.ok(SCOPED[page], `${page} has a scope this test doesn't know`);
    }
  });

  it("the share menu reads only the keys its scope sends", () => {
    assert.deepEqual(missing([C("ShareMenu.tsx")], SHARE_MENU_SCOPE), []);
  });

  it("every namespace and key a scope sends exists in EN, PT and ES", () => {
    for (const scope of [LAYOUT_SCOPE, LEAGUE_SCOPE, CUP_SCOPE, SHARE_MENU_SCOPE, SHARE_PAGE_SCOPE, PAST_WINNERS_SCOPE, MY_WORLD_SCOPE] as MessageScope[]) {
      for (const locale of locales) {
        for (const entry of scope) {
          const namespace = typeof entry === "string" ? entry : entry.namespace;
          assert.ok(messages[locale]![namespace], `${locale}: ${namespace}`);
          if (typeof entry !== "string") for (const key of entry.keys) assert.ok(key in messages[locale]![namespace]!, `${locale}: ${namespace}.${key}`);
        }
      }
    }
  });

  it("a scope of some keys sends exactly those, and whole namespaces as they are", () => {
    const en = messages.en!;
    const picked = pickMessages(en, [...LAYOUT_SCOPE, ...SHARE_MENU_SCOPE]);
    assert.deepEqual(Object.keys(picked).sort(), ["Continents", "Countries", "Nav", "Simulator"]);
    assert.deepEqual(Object.keys(picked.Simulator as object).sort(), [...SHARE_MENU_KEYS].sort());
    assert.equal(picked.Nav, en.Nav);
    assert.deepEqual(pickMessages(en, ["NotANamespace"]), {});
  });
});
