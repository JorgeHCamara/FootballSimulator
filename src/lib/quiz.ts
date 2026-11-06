import type { SiteLocale, ZoneKind } from "../config/leagues.ts";
import { createRng } from "../engine/rng.ts";
import type { TeamId } from "../engine/types.ts";
import { HISTORY_LEAGUES, type HistoryFile, type HistoryLeague, type HistorySeason } from "./history.ts";

/*
 * The daily quiz (/[locale]/quiz): QUESTIONS_PER_DAY questions picked from the
 * date and language alone, so everyone playing in a language on a day gets the
 * same set. Historical questions come from past final tables
 * (src/data/history.json); "who is likelier" questions from the live season
 * outlook (the chances are only shown once answered). Pure: the page passes in
 * the live chances (src/lib/quizPage.ts).
 */

export const QUESTIONS_PER_DAY = 6;
/** Of which from the live outlook, when there are chances to ask about. */
export const LIVE_PER_DAY = 2;

export type HistoricalKind = "champion" | "runnerUp" | "relegated" | "higher";
export type QuizKind = HistoricalKind | "likelier";

/** A live question's subject: the title, a place ("Champions League", "promotion"…) or relegation. */
export type LiveTopic = { kind: "title" } | { kind: "zone"; zone: ZoneKind } | { kind: "relegation" };

/** The chances one live question can be asked from: every club of a league for one topic. */
export interface LiveCandidate {
  league: string;
  topic: LiveTopic;
  clubs: { id: TeamId; name: string; chance: number }[];
}

export interface QuizOption {
  id: TeamId;
  name: string;
  /** Shown once answered: its final place and points (a past season), or its chance (live). */
  place?: number;
  points?: number;
  chance?: number;
}

export interface QuizQuestion {
  /** Stable within the day (for keys and the saved answers). */
  id: string;
  kind: QuizKind;
  league: string;
  /** A past season's label ("2023/24"). */
  season?: string;
  topic?: LiveTopic;
  options: QuizOption[];
  /** Index of the right option. */
  answer: number;
}

/** How often each league's questions come up, by language (the leagues its visitors follow first). */
const WEIGHTS: Record<SiteLocale, Partial<Record<HistoryLeague, number>>> = {
  en: { PL: 4, ELC: 1.5, PD: 1.5, BL1: 1.5, SA: 1.5, FL1: 1, PPL: 0.5, DED: 0.5, BSA: 0.5 },
  pt: { BSA: 4, PPL: 2.5, PL: 1.5, PD: 1, BL1: 1, SA: 1, FL1: 0.5, DED: 0.5, ELC: 0.3 },
  es: { PD: 4, PL: 1.5, BL1: 1, SA: 1.5, FL1: 1, PPL: 1, BSA: 1, DED: 0.5, ELC: 0.3 },
};

/** A day's seed: the date ("2026-11-06") and language, hashed (FNV-1a). */
export function quizSeed(date: string, locale: SiteLocale): number {
  let hash = 0x811c9dc5;
  for (const ch of `${date}|${locale}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return hash;
}

type Rng = () => number;
const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)]!;
function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
/** `count` different items, in random order. */
const sample = <T>(items: readonly T[], count: number, rng: Rng): T[] => shuffle(items, rng).slice(0, count);

function weightedLeague(locale: SiteLocale, rng: Rng, avoid: ReadonlySet<string>, allowed: readonly string[]): string | undefined {
  const pool = allowed.filter((code) => !avoid.has(code));
  const from = pool.length ? pool : [...allowed];
  if (!from.length) return undefined;
  const weight = (code: string) => WEIGHTS[locale][code as HistoryLeague] ?? 0.5;
  let r = rng() * from.reduce((sum, code) => sum + weight(code), 0);
  for (const code of from) {
    r -= weight(code);
    if (r <= 0) return code;
  }
  return from.at(-1);
}

const optionAt = (season: HistorySeason, index: number): QuizOption => {
  const [id, name, points] = season.table[index]!;
  return { id, name, place: index + 1, points };
};

/** The seasons a kind of question can be asked about. */
function usable(kind: HistoricalKind, season: HistorySeason): boolean {
  const n = season.table.length;
  if (n < 12) return false;
  if (kind === "champion") return season.champion !== null;
  if (kind === "relegated") return season.relegated.length > 0;
  return true;
}

/** One historical question about a season, or undefined when its table can't make one. */
export function historicalQuestion(kind: HistoricalKind, league: string, season: HistorySeason, rng: Rng): QuizQuestion | undefined {
  if (!usable(kind, season)) return undefined;
  const n = season.table.length;
  const id = `${kind}:${league}:${season.year}`;
  let right: number;
  let others: number[];
  if (kind === "champion" || kind === "runnerUp") {
    right = kind === "champion" ? 0 : 1;
    // Against others from the top six.
    others = sample([0, 1, 2, 3, 4, 5].filter((i) => i !== right), 3, rng);
  } else if (kind === "relegated") {
    const down = new Set(season.relegated);
    const relegatedAt = season.table.flatMap(([teamId], i) => (down.has(teamId) ? [i] : []));
    right = pick(relegatedAt, rng);
    // Against mid-table clubs: well clear of the top and of anything decided at the bottom (play-offs too).
    const middle = Array.from({ length: n }, (_, i) => i).filter((i) => i >= 5 && i < n - 5 && !down.has(season.table[i]![0]));
    if (middle.length < 3) return undefined;
    others = sample(middle, 3, rng);
  } else {
    // Who finished higher: two clubs at least four places apart.
    const a = Math.floor(rng() * n);
    const far = Array.from({ length: n }, (_, i) => i).filter((i) => Math.abs(i - a) >= 4);
    const b = pick(far, rng);
    right = Math.min(a, b);
    others = [Math.max(a, b)];
  }
  const order = shuffle([right, ...others], rng);
  return { id, kind, league, season: season.label, options: order.map((i) => optionAt(season, i)), answer: order.indexOf(right) };
}

/** A live question from a league's chances: two clubs both still in it, far enough apart to tell, or undefined. */
export function liveQuestion(candidate: LiveCandidate, rng: Rng): QuizQuestion | undefined {
  const open = candidate.clubs.filter((c) => c.chance >= 0.03 && c.chance <= 0.97);
  const pairs: [number, number][] = [];
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) if (Math.abs(open[i]!.chance - open[j]!.chance) >= 0.08) pairs.push([i, j]);
  if (!pairs.length) return undefined;
  const [i, j] = pick(pairs, rng);
  const options = shuffle([open[i]!, open[j]!], rng).map((c) => ({ id: c.id, name: c.name, chance: c.chance }));
  const answer = options[0]!.chance! >= options[1]!.chance! ? 0 : 1;
  const topic = candidate.topic.kind === "zone" ? `zone-${candidate.topic.zone}` : candidate.topic.kind;
  return { id: `likelier:${candidate.league}:${topic}`, kind: "likelier", league: candidate.league, topic: candidate.topic, options, answer };
}

/**
 * The live outlooks a day asks about: LIVE_PER_DAY leagues picked from the
 * date and language (weighted as the historical ones), so the page only has to
 * work out those.
 */
export function liveLeaguesFor(date: string, locale: SiteLocale, leagues: readonly string[] = HISTORY_LEAGUES): string[] {
  const rng = createRng(quizSeed(date, locale) ^ 0x5bd1e995);
  const out = new Set<string>();
  for (let i = 0; i < LIVE_PER_DAY; i++) {
    const code = weightedLeague(locale, rng, out, leagues);
    if (code) out.add(code);
  }
  return [...out];
}

/**
 * The day's questions: LIVE_PER_DAY live ones from `live` (when it has chances
 * to ask about), the rest historical, one of each kind first, no league twice
 * in a row where it can be helped. The same date, language, history and live
 * chances always give the same set.
 */
export function dailyQuiz(date: string, locale: SiteLocale, history: HistoryFile, live: readonly LiveCandidate[] = []): QuizQuestion[] {
  const rng = createRng(quizSeed(date, locale));
  const questions: QuizQuestion[] = [];
  const used = new Set<string>();
  for (const candidate of shuffle(live, rng)) {
    if (questions.length >= LIVE_PER_DAY) break;
    if (questions.some((q) => q.league === candidate.league)) continue;
    const q = liveQuestion(candidate, rng);
    if (q) questions.push(q);
  }
  const leagues = (Object.keys(history.leagues) as HistoryLeague[]).filter((code) => history.leagues[code]?.length);
  const kinds: HistoricalKind[] = ["champion", "runnerUp", "relegated", "higher"];
  const plan = [...shuffle(kinds, rng), ...shuffle(kinds, rng)];
  const recent = new Set<string>();
  for (const kind of plan) {
    if (questions.length >= QUESTIONS_PER_DAY) break;
    // A few tries for a league and season that make this kind of question and haven't been asked today.
    for (let attempt = 0; attempt < 8; attempt++) {
      const league = weightedLeague(locale, rng, recent, leagues);
      const seasons = league ? (history.leagues[league as HistoryLeague] ?? []) : [];
      if (!league || !seasons.length) break;
      const q = historicalQuestion(kind, league, pick(seasons, rng), rng);
      if (!q || used.has(q.id)) continue;
      used.add(q.id);
      questions.push(q);
      recent.clear();
      recent.add(league);
      break;
    }
  }
  // Live questions first and last: a historical warm-up, a live one in the middle and at the end.
  const liveOnes = questions.filter((q) => q.kind === "likelier");
  const past = questions.filter((q) => q.kind !== "likelier");
  const middle = Math.ceil(past.length / 2);
  return [...past.slice(0, middle), ...liveOnes.slice(0, 1), ...past.slice(middle), ...liveOnes.slice(1)];
}

/** The score: how many answers (option indexes, in question order) are right. */
export function quizScore(questions: readonly QuizQuestion[], answers: readonly (number | null | undefined)[]): number {
  return questions.reduce((sum, q, i) => sum + (answers[i] === q.answer ? 1 : 0), 0);
}
