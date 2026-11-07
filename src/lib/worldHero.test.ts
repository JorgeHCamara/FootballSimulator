import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { SiteLocale } from "../config/leagues.ts";
import { WORLD_COUNTRIES, WORLD_CUPS, WORLD_LEAGUES } from "./worldCountries.ts";
import { HOW_STEPS, PLAY_ANCHOR, worldFacts } from "./worldHero.ts";

type World = { title: string; intro: string; homeBody: string; hero: Record<string, string>; how: Record<string, string> };
const world = (locale: SiteLocale) => (JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")) as { World: World }).World;

/** Names of competitions and clubs: the mode's words must stay true as countries are added, so they name none. */
const NAMED = /Premier League|League One|League Two|Championship|National League|La ?Liga|Segunda|Primera|Bundesliga|FA Cup|EFL Cup|Carabao|Copa del Rey|Copa da Liga|DFB|England|Spain|Germany|Inglaterra|Espanha|España|Alemanha|Alemania|ingl[eê]s|espanhol|español|alem[aã]|alem[aá]n/i;

describe("My World hero", () => {
  it("counts the mode's countries, leagues and cups from the config", () => {
    assert.deepEqual(worldFacts(), { countries: WORLD_COUNTRIES.length, leagues: WORLD_LEAGUES.length, cups: WORLD_CUPS.length });
    assert.ok(worldFacts().countries >= 1 && worldFacts().leagues > worldFacts().countries && worldFacts().cups >= 1);
    assert.deepEqual(
      HOW_STEPS.map((s) => s.key),
      ["pick", "play", "season", "again"],
    );
    assert.equal(PLAY_ANCHOR, "play");
  });

  it("says what the mode is without naming any league, cup, club or country, in every language", () => {
    for (const locale of ["en", "pt", "es"] as const) {
      const w = world(locale);
      const texts = [w.intro, w.homeBody, ...Object.values(w.hero), ...Object.values(w.how)];
      for (const text of texts) assert.doesNotMatch(text, NAMED, `${locale}: ${text}`);
      for (const key of ["badge", "start", "continue", "countries", "leagues", "cups", "saved", "noSignup"]) assert.ok(w.hero[key], `${locale}: hero.${key}`);
      for (const key of ["countries", "leagues", "cups"]) assert.match(w.hero[key]!, /^\{count\} /, `${locale}: hero.${key} takes the count`);
      for (const step of HOW_STEPS) assert.ok((w.how[step.key] ?? "").length > 30, `${locale}: how.${step.key}`);
      assert.ok(w.how.title);
      assert.ok(w.intro.length > 80 && w.intro.length < 400, `${locale}: the intro fits a hero`);
    }
    assert.equal(world("en").title, "My World");
    assert.equal(world("pt").title, "Meu mundo");
    assert.equal(world("es").title, "Mi mundo");
  });
});
