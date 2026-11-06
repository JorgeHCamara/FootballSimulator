import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Tailwind generates no CSS for a utility whose colour isn't in the theme, so a
// class naming an undefined shade of a custom colour silently does nothing.
const SRC = join(import.meta.dirname, "..");
const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
const theme = css.match(/@theme\s*\{([^}]*)\}/)?.[1] ?? "";

/** Custom colour families declared in @theme, with their defined shades. */
const families = new Map<string, Set<string>>();
for (const [, name, shade] of theme.matchAll(/--color-([a-z]+)-(\d+)\s*:/g)) {
  if (!families.has(name!)) families.set(name!, new Set());
  families.get(name!)!.add(shade!);
}

const sources = (readdirSync(SRC, { recursive: true, encoding: "utf8" }))
  .filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith(".test.ts"))
  .map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }));

describe("theme colours", () => {
  it("declares the pitch ramp", () => {
    assert.deepEqual([...(families.get("pitch") ?? [])].sort((a, b) => +a - +b), ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"]);
  });

  it("uses only shades of custom colours that the theme defines", () => {
    const missing: string[] = [];
    for (const [name, shades] of families) {
      const use = new RegExp(`(?<![\\w-])(?:[a-z]+-)+${name}-(\\d+)\\b`, "g");
      for (const { file, text } of sources) {
        for (const m of text.matchAll(use)) if (!shades.has(m[1]!)) missing.push(`${file}: ${m[0]}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});
