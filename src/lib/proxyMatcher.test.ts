import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { routing } from "../i18n/routing.ts";

// src/proxy.ts imports next-intl's middleware, which needs Next's runtime: its matcher is read from the file.
const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const literal = /matcher:\s*"((?:[^"\\]|\\.)*)"/.exec(source)?.[1];
// The string as JavaScript reads it ("\\." in the file is "\." in the pattern).
const pattern = literal === undefined ? undefined : (JSON.parse(`"${literal}"`) as string);
// Next matches the whole path against the matcher, as a regular expression.
const runsOn = (path: string) => new RegExp(`^${pattern}$`).test(path);

describe("the proxy (language routing)", () => {
  it("lists every language the site has, and only those", () => {
    assert.ok(pattern, "the matcher is a string literal");
    const listed = /\(\?:([a-z|]+)\)\(\?:\/\|\$\)/.exec(pattern!)?.[1]?.split("|");
    assert.deepEqual([...(listed ?? [])].sort(), [...routing.locales].sort());
  });

  it("runs on addresses without a language, to send them to theirs", () => {
    for (const path of ["/", "/premier-league", "/premier-league/team/arsenal", "/odds", "/espanyol", "/english", "/estonia"]) assert.ok(runsOn(path), path);
  });

  it("skips every page that already has its language, API routes, Next's files and files with an extension", () => {
    for (const path of ["/en", "/pt", "/es", "/en/premier-league", "/pt/brasileirao/team/flamengo", "/es/premier-league/opengraph-image", "/api/revalidate/leagues", "/_next/static/chunks/a.js", "/_vercel/insights/script.js", "/sitemap.xml", "/robots.txt", "/ads.txt", "/icon.svg"]) {
      assert.ok(!runsOn(path), path);
    }
  });
});
