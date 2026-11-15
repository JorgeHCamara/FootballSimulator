import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
 * EN, PT and ES carry the same messages: every key English has, the other two
 * have (a key missing in one language shows its name instead of its text).
 */

type Messages = Record<string, unknown>;
const read = (locale: string) => JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")) as Messages;
const paths = (messages: Messages, prefix = ""): string[] =>
  Object.entries(messages).flatMap(([key, value]) => (value && typeof value === "object" && !Array.isArray(value) ? paths(value as Messages, `${prefix}${key}.`) : [`${prefix}${key}`]));

describe("messages in every language", () => {
  const en = new Set(paths(read("en")));

  for (const locale of ["pt", "es"]) {
    it(`${locale.toUpperCase()} has every message English has`, () => {
      const other = new Set(paths(read(locale)));
      assert.deepEqual([...en].filter((key) => !other.has(key)), []);
    });
  }

  it("a settled match page's label, in all three (and spelled, as the brand, without emoji)", () => {
    for (const locale of ["en", "pt", "es"]) {
      const text = (read(locale).Match as Messages).afterMatch;
      assert.equal(typeof text, "string", locale);
      assert.doesNotMatch(text as string, /\p{Extended_Pictographic}/u, locale);
    }
  });
});
