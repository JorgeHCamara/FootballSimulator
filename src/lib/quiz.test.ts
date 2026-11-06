import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRng } from "../engine/rng.ts";
import { HISTORY, HISTORY_LEAGUES, type HistorySeason } from "./history.ts";
import { dailyQuiz, historicalQuestion, LIVE_PER_DAY, liveLeaguesFor, liveQuestion, QUESTIONS_PER_DAY, quizScore, quizSeed, type LiveCandidate, type QuizQuestion } from "./quiz.ts";
import { quizDate } from "./quizPage.ts";

const LOCALES = ["en", "pt", "es"] as const;

/** A year of days, from a date. */
const days = (from: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(`${from}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

const seasonOf = (league: string, year: number) => HISTORY.leagues[league as keyof typeof HISTORY.leagues]!.find((s) => s.year === year)!;

/** Live chances for a league: every club with a chance, some still open. */
const liveFor = (league: string): LiveCandidate[] => {
  const base = HISTORY_LEAGUES.indexOf(league as (typeof HISTORY_LEAGUES)[number]) * 100;
  const clubs = (chances: number[]) => chances.map((chance, i) => ({ id: base + i, name: `${league} Club ${i}`, chance }));
  return [
    { league, topic: { kind: "title" }, clubs: clubs([0.62, 0.3, 0.06, 0.02, 0, 0]) },
    { league, topic: { kind: "zone", zone: "championsLeague" }, clubs: clubs([0.99, 0.9, 0.55, 0.4, 0.1, 0.06]) },
    { league, topic: { kind: "relegation" }, clubs: clubs([0, 0, 0.01, 0.2, 0.45, 0.8]) },
  ];
};

/** What a question asks, checked against the season's table. */
function assertRight(q: QuizQuestion) {
  assert.ok(q.answer >= 0 && q.answer < q.options.length, `${q.id}: an answer among the options`);
  assert.equal(new Set(q.options.map((o) => o.id)).size, q.options.length, `${q.id}: different options`);
  if (q.kind === "likelier") {
    assert.equal(q.options.length, 2);
    const [a, b] = q.options.map((o) => o.chance!);
    assert.ok(Math.abs(a! - b!) >= 0.08, `${q.id}: far enough apart to tell`);
    assert.ok(q.options[q.answer]!.chance! > q.options[1 - q.answer]!.chance!, `${q.id}: the likelier club`);
    return;
  }
  const season = seasonOf(q.league, Number(q.id.split(":")[2]));
  assert.equal(q.season, season.label);
  const right = q.options[q.answer]!;
  // Each option is where it finished, with its points.
  for (const o of q.options) {
    const row = season.table[o.place! - 1]!;
    assert.deepEqual([row[0], row[1], row[2]], [o.id, o.name, o.points]);
  }
  const others = q.options.filter((_, i) => i !== q.answer);
  if (q.kind === "champion") {
    assert.equal(q.options.length, 4);
    assert.equal(right.id, season.champion);
    assert.equal(right.place, 1);
  } else if (q.kind === "runnerUp") {
    assert.equal(q.options.length, 4);
    assert.equal(right.place, 2);
  } else if (q.kind === "relegated") {
    assert.equal(q.options.length, 4);
    assert.ok(season.relegated.includes(right.id), `${q.id}: relegated`);
    for (const o of others) assert.ok(!season.relegated.includes(o.id), `${q.id}: only one relegated club`);
  } else {
    assert.equal(q.options.length, 2);
    assert.ok(right.place! + 4 <= others[0]!.place!, `${q.id}: finished higher, at least four places`);
  }
}

describe("the history", () => {
  it("has every league, a final table per season and the champion on top", () => {
    for (const code of HISTORY_LEAGUES) {
      const seasons = HISTORY.leagues[code] ?? [];
      assert.ok(seasons.length >= 10, `${code}: ${seasons.length} seasons`);
      for (const s of seasons) {
        assert.ok(s.table.length >= 16, `${code} ${s.label}: a full table`);
        if (s.champion !== null) assert.equal(s.champion, s.table[0]![0], `${code} ${s.label}: the champion is the leader`);
        for (const id of s.relegated) assert.ok(s.table.some(([t]) => t === id), `${code} ${s.label}: relegated clubs are in the table`);
        // Sorted by place: points never go up down the table (but the abandoned 2019/20 Ligue 1 was ranked by points per game).
        if (code === "FL1" && s.year === 2019) continue;
        for (let i = 1; i < s.table.length; i++) assert.ok(s.table[i]![2] <= s.table[i - 1]![2], `${code} ${s.label}: in order`);
      }
    }
  });

  it("knows a few champions and relegations", () => {
    assert.equal(seasonOf("PL", 2015).table[0]![1], "Leicester City");
    assert.equal(seasonOf("PL", 2018).table[0]![1], "Manchester City");
    assert.equal(seasonOf("PL", 2018).table[0]![2], 98);
    assert.equal(seasonOf("BL1", 2023).table[0]![1], "Bayer Leverkusen");
    assert.equal(seasonOf("SA", 2022).table[0]![1], "Napoli");
    // No title awarded when the 2019/20 Eredivisie was abandoned.
    assert.equal(seasonOf("DED", 2019).champion, null);
    assert.equal(seasonOf("PL", 2023).relegated.length, 3);
  });
});

describe("historical questions", () => {
  it("each kind asks about the season's real table", () => {
    const rng = createRng(7);
    for (const code of HISTORY_LEAGUES)
      for (const season of HISTORY.leagues[code]!)
        for (const kind of ["champion", "runnerUp", "relegated", "higher"] as const) {
          const q = historicalQuestion(kind, code, season, rng);
          if (kind === "champion" && season.champion === null) assert.equal(q, undefined, "no champion to ask about");
          else if (q) assertRight(q);
        }
  });

  it("no question from a season without its subject", () => {
    const rng = createRng(1);
    const pl = seasonOf("PL", 2023);
    assert.equal(historicalQuestion("relegated", "PL", { ...pl, relegated: [] }, rng), undefined);
    assert.equal(historicalQuestion("champion", "PL", { ...pl, champion: null }, rng), undefined);
    const short: HistorySeason = { ...pl, table: pl.table.slice(0, 8) };
    assert.equal(historicalQuestion("higher", "PL", short, rng), undefined);
  });
});

describe("live questions", () => {
  it("two clubs both still in it, and the likelier one is the answer", () => {
    for (const candidate of liveFor("PL"))
      for (let seed = 0; seed < 50; seed++) {
        const q = liveQuestion(candidate, createRng(seed))!;
        assertRight(q);
        for (const o of q.options) assert.ok(o.chance! >= 0.03 && o.chance! <= 0.97, "not settled");
        assert.equal(q.topic, candidate.topic);
      }
  });

  it("none when nothing is open", () => {
    const settled: LiveCandidate = { league: "PL", topic: { kind: "title" }, clubs: [{ id: 1, name: "A", chance: 1 }, { id: 2, name: "B", chance: 0 }] };
    assert.equal(liveQuestion(settled, createRng(1)), undefined);
    const close: LiveCandidate = { league: "PL", topic: { kind: "title" }, clubs: [{ id: 1, name: "A", chance: 0.5 }, { id: 2, name: "B", chance: 0.45 }] };
    assert.equal(liveQuestion(close, createRng(1)), undefined, "too close to tell");
  });

  it("the day's leagues: the same for a date and language, LIVE_PER_DAY different ones", () => {
    for (const locale of LOCALES)
      for (const date of days("2026-08-01", 60)) {
        const leagues = liveLeaguesFor(date, locale);
        assert.deepEqual(leagues, liveLeaguesFor(date, locale));
        assert.equal(leagues.length, LIVE_PER_DAY);
        assert.equal(new Set(leagues).size, LIVE_PER_DAY);
        for (const code of leagues) assert.ok((HISTORY_LEAGUES as readonly string[]).includes(code));
      }
  });
});

describe("the daily quiz", () => {
  it("the same set for a date and language, a different one the next day or in another language", () => {
    const a = dailyQuiz("2026-11-06", "en", HISTORY);
    assert.deepEqual(dailyQuiz("2026-11-06", "en", HISTORY), a);
    assert.notDeepEqual(dailyQuiz("2026-11-07", "en", HISTORY), a);
    assert.notDeepEqual(dailyQuiz("2026-11-06", "pt", HISTORY), a);
    assert.notEqual(quizSeed("2026-11-06", "en"), quizSeed("2026-11-06", "pt"));
    const live = liveFor("PL");
    assert.deepEqual(dailyQuiz("2026-11-06", "en", HISTORY, live), dailyQuiz("2026-11-06", "en", HISTORY, live));
  });

  it("every day of a year: six questions, each with one right answer, none twice", () => {
    for (const locale of LOCALES)
      for (const date of days("2026-07-01", 365)) {
        const live = liveLeaguesFor(date, locale).flatMap(liveFor);
        const qs = dailyQuiz(date, locale, HISTORY, live);
        assert.equal(qs.length, QUESTIONS_PER_DAY, `${date} ${locale}`);
        assert.equal(new Set(qs.map((q) => q.id)).size, qs.length, `${date} ${locale}: no question twice`);
        for (const q of qs) assertRight(q);
        // Two live ones, from different leagues: the middle one and the last one.
        const liveAt = qs.flatMap((q, i) => (q.kind === "likelier" ? [i] : []));
        assert.deepEqual(liveAt, [2, 5], `${date} ${locale}`);
        assert.notEqual(qs[2]!.league, qs[5]!.league);
        // A historical question of every kind.
        const kinds = new Set(qs.filter((q) => q.kind !== "likelier").map((q) => q.kind));
        assert.equal(kinds.size, 4, `${date} ${locale}: ${[...kinds]}`);
      }
  });

  it("without live chances (the season over or not loading): all six from the past", () => {
    for (const date of days("2026-06-01", 30)) {
      const qs = dailyQuiz(date, "es", HISTORY);
      assert.equal(qs.length, QUESTIONS_PER_DAY);
      assert.ok(qs.every((q) => q.kind !== "likelier"));
      for (const q of qs) assertRight(q);
    }
  });

  it("asks most about the leagues a language follows first", () => {
    const count = (locale: (typeof LOCALES)[number], league: string) =>
      days("2026-01-01", 200)
        .flatMap((d) => dailyQuiz(d, locale, HISTORY))
        .filter((q) => q.league === league).length;
    assert.ok(count("en", "PL") > count("en", "BSA") * 3);
    assert.ok(count("pt", "BSA") > count("pt", "PL"));
    assert.ok(count("es", "PD") > count("es", "PL"));
  });

  it("the day is the UTC date", () => {
    assert.equal(quizDate(new Date("2026-11-06T23:59:00Z")), "2026-11-06");
    assert.equal(quizDate(new Date("2026-11-07T00:01:00Z")), "2026-11-07");
  });
});

describe("the score", () => {
  it("counts the right answers, unanswered ones as wrong", () => {
    const qs = dailyQuiz("2026-11-06", "en", HISTORY);
    const right = qs.map((q) => q.answer);
    assert.equal(quizScore(qs, right), qs.length);
    assert.equal(quizScore(qs, qs.map((q) => (q.answer + 1) % q.options.length)), 0);
    assert.equal(quizScore(qs, [right[0]!, null, undefined]), 1);
    assert.equal(quizScore(qs, []), 0);
  });
});
