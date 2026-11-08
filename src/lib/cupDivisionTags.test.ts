import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CUPS } from "../config/cups.ts";
import { COUNTRY_CUPS, COUNTRY_LEAGUES, WORLD_COUNTRIES } from "./worldCountries.ts";

const division = (locale: string) =>
  (JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")) as { Cup: { division: Record<string, string> } }).Cup.division;

describe("Cup division tags", () => {
  // A club's tag is `Cup.division.<code>`: a missing message shows the raw key (e.g. "Cup.division.BSC").
  const codes = new Set<string>([...CUPS.flatMap((c) => c.feederLeagues), ...WORLD_COUNTRIES.flatMap((c) => (COUNTRY_CUPS[c].length ? COUNTRY_LEAGUES[c] : []))]);
  for (const locale of ["en", "es", "pt"]) {
    it(`has a tag for every cup club's division in ${locale}`, () => {
      const tags = division(locale);
      for (const code of codes) assert.ok(tags[code], `${locale}: Cup.division.${code}`);
      assert.ok(tags.nonLeague);
    });
  }
});
