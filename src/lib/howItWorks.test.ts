import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { expectedGoals, likelyScores, outcomeProbabilities } from "../engine/match.ts";
import type { LeagueModel } from "../engine/ratings.ts";
import { SCENARIO_ITERATIONS } from "./scenario.ts";

/*
 * "How FootSimu works" (src/app/[locale]/how-it-works, messages HowItWorks):
 * real prose in all three languages, the same sections in each, and a worked
 * example whose numbers are the match model's own.
 */

interface Copy {
  title: string;
  description: string;
  deck: string;
  diagram: { title: string; text: string }[];
  sections: { id: string; h: string; p: string[] }[];
  example: Record<"title" | "setup" | "xg" | "outcomes" | "scores" | "note", string>;
}

const copyOf = (locale: string) => (JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")) as { HowItWorks: Copy }).HowItWorks;
const footerOf = (locale: string) => (JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")) as { Footer: Record<string, string> }).Footer;
const LOCALES = ["en", "pt", "es"] as const;
/** The article's prose: its sections and the example ([label](href) counted as its label). */
const body = (c: Copy) => [...c.sections.flatMap((s) => [s.h, ...s.p]), ...Object.values(c.example)].join(" ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const everything = (c: Copy) => JSON.stringify(c);

describe("How FootSimu works", () => {
  it("is real prose in every language: 900 to 1,300 words of article", () => {
    for (const locale of LOCALES) {
      const n = words(body(copyOf(locale)));
      assert.ok(n >= 900 && n <= 1300, `${locale}: ${n} words`);
    }
  });

  it("has the same sections, in the same order, and the same diagram steps in every language", () => {
    const en = copyOf("en");
    for (const locale of ["pt", "es"]) {
      const c = copyOf(locale);
      assert.deepEqual(c.sections.map((s) => s.id), en.sections.map((s) => s.id), locale);
      assert.deepEqual(c.sections.map((s) => s.p.length), en.sections.map((s) => s.p.length), `${locale} paragraphs`);
      assert.equal(c.diagram.length, 4, locale);
    }
    assert.deepEqual(en.sections.map((s) => s.id), ["what", "data", "ratings", "match", "season", "reading", "limits", "updates", "accuracy", "credits"]);
  });

  it("spells the brand FootSimu, uses no emoji and links only to Contact or the credited sources", () => {
    for (const locale of LOCALES) {
      const text = everything(copyOf(locale));
      assert.doesNotMatch(text, /Foot Simu|FootSim(?!u)|Football Simulator/, locale);
      assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${locale}: no emoji`);
      const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
      assert.deepEqual(links, ["contact", "https://www.football-data.org/", "https://www.thesportsdb.com/"], locale);
    }
  });

  it("says how many seasons are simulated: the real number", () => {
    assert.equal(SCENARIO_ITERATIONS, 10_000);
    assert.match(body(copyOf("en")), /10,000/);
    for (const locale of ["pt", "es"]) assert.match(body(copyOf(locale)), /10\.000/, locale);
  });

  it("doesn't claim hourly updates, a headline accuracy figure or bookmakers' odds as an input", () => {
    const en = body(copyOf("en"));
    assert.doesNotMatch(en, /every hour|refreshed hourly/i);
    assert.match(en, /every 30 minutes/);
    assert.doesNotMatch(en, /\d+% (accurate|correct)|accuracy of \d/i);
    assert.match(en, /bookmakers' odds are not an input/);
  });

  it("works its example out with the match model: the expected goals, the three outcomes and the likeliest scores", () => {
    // League averages 1.50 home and 1.20 away; Club A attack 1.15, defence 0.90; Club B attack 1.00, defence 0.95;
    // a typical low-score correction (rho -0.1).
    const model = { avgHomeGoals: 1.5, avgAwayGoals: 1.2, strengths: new Map([[1, { attack: 1.15, defence: 0.9 }], [2, { attack: 1, defence: 0.95 }]]) } as unknown as LeagueModel;
    const xg = expectedGoals(model, 1, 2);
    const odds = outcomeProbabilities(xg, -0.1);
    const scores = likelyScores(xg, -0.1, 3);
    const pct = (p: number) => `${Math.round(p * 100)}%`;
    const en = copyOf("en").example;
    assert.equal(en.xg, `Expected goals: Club A ${xg.home.toFixed(2)}, Club B ${xg.away.toFixed(2)}.`);
    assert.equal(en.outcomes, `Club A win ${pct(odds.home)}, draw ${pct(odds.draw)}, Club B win ${pct(odds.away)}.`);
    assert.equal(en.scores, `Likeliest scores: ${scores.map((s) => `${s.home}–${s.away} (${pct(s.p)})`).join(", ")}.`);
    // "fail to win slightly more often than they win"; "about one match in eight".
    assert.ok(odds.home < 0.5 && odds.home > 0.45);
    assert.ok(Math.abs(1 / scores[0]!.p - 8) < 0.5);
    // The same numbers in Portuguese and Spanish (decimal commas).
    for (const locale of ["pt", "es"]) {
      const ex = copyOf(locale).example;
      for (const n of [xg.home.toFixed(2).replace(".", ","), xg.away.toFixed(2).replace(".", ","), pct(odds.home), pct(odds.draw), pct(odds.away), pct(scores[0]!.p)]) assert.ok(Object.values(ex).join(" ").includes(n), `${locale}: ${n}`);
    }
  });

  it("is labelled in the footer in every language", () => {
    assert.deepEqual(LOCALES.map((l) => footerOf(l).howItWorks), ["How it works", "Como funciona", "Cómo funciona"]);
    assert.deepEqual(LOCALES.map((l) => copyOf(l).title), ["How FootSimu works", "Como o FootSimu funciona", "Cómo funciona FootSimu"]);
  });
});
