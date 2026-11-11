// The file itself (".js"): these modules also run outside Next (scripts, tests), whose Node needs the extension.
import { unstable_cache } from "next/cache.js";
import { getLeagueByCode, type SiteLocale } from "../config/leagues.ts";
import { CONTINENTAL } from "./leagueFacts.ts";
import { HISTORY } from "./history.ts";
import { getLeagueData } from "./leagueData.ts";
import { dailyQuiz, liveLeaguesFor, type LiveCandidate, type QuizQuestion } from "./quiz.ts";
import { sharedLeagueOutlook } from "./sharedOutlook.ts";

/** The quiz's day: the UTC date ("2026-11-06"), so the set changes at the same moment everywhere. */
export const quizDate = (now = new Date()) => now.toISOString().slice(0, 10);

/** The quiz page's own clock at most (seconds): its `revalidate`. */
export const QUIZ_KEEP_SECONDS = 21600;
/** After midnight UTC, how long the page may still be yesterday's (seconds), before the visit that rebuilds it. */
export const QUIZ_ROLLOVER_SECONDS = 60;

/** How long a quiz page built at `now` may be kept (seconds): until just after the UTC day ends, six hours at most. */
export function quizKeepSeconds(now = new Date()): number {
  const left = Math.ceil((86_400_000 - (now.getTime() % 86_400_000)) / 1000);
  return Math.min(QUIZ_KEEP_SECONDS, left + QUIZ_ROLLOVER_SECONDS);
}

/**
 * Makes the page being rendered last no longer than the UTC day: a tiny data
 * cache entry of the day, read with that lifetime, which Next takes as the
 * page's when it's shorter than its own (the lowest of a route's reads sets
 * how long it's kept). Nothing is fetched.
 */
export async function quizDayClock(now = new Date()): Promise<void> {
  const date = quizDate(now);
  try {
    await unstable_cache(async () => date, ["quiz-day", date], { revalidate: quizKeepSeconds(now) })();
  } catch (error) {
    // Outside a Next.js server (tests): no page to keep.
    if (!(error instanceof Error && error.message.includes("incrementalCache missing"))) throw error;
  }
}

/**
 * A league's live chances to ask about, from its shared outlook (the club
 * pages' numbers): the title, its top place (a continental competition, or
 * promotion), relegation. None when its season is over or doesn't load.
 */
async function liveCandidates(code: string): Promise<LiveCandidate[]> {
  const league = getLeagueByCode(code);
  if (!league) return [];
  const data = await getLeagueData(league).catch(() => undefined);
  const outlook = data ? await sharedLeagueOutlook(league, data).catch(() => null) : null;
  if (!outlook || outlook.complete) return [];
  const clubs = [...outlook.clubs.values()];
  const zones = clubs[0]?.zones ?? [];
  const top = zones.find((z) => CONTINENTAL.has(z.kind) || z.kind === "promotion");
  const of = (kind: string) => clubs.map((c) => ({ id: c.team.id, name: c.team.name, chance: c.zones.find((z) => z.kind === kind)?.chance ?? 0 }));
  return [
    ...(zones.some((z) => z.kind === "title") ? [{ league: code, topic: { kind: "title" as const }, clubs: of("title") }] : []),
    ...(top ? [{ league: code, topic: { kind: "zone" as const, zone: top.kind }, clubs: of(top.kind) }] : []),
    ...(zones.some((z) => z.kind === "relegation") ? [{ league: code, topic: { kind: "relegation" as const }, clubs: of("relegation") }] : []),
  ];
}

/** Today's questions in a language: the live chances of the day's leagues, then the picker (see dailyQuiz). */
export async function todaysQuiz(locale: SiteLocale, now = new Date()): Promise<{ date: string; questions: QuizQuestion[]; iterations: number }> {
  const date = quizDate(now);
  const live = (await Promise.all(liveLeaguesFor(date, locale).map(liveCandidates))).flat();
  return { date, questions: dailyQuiz(date, locale, HISTORY, live), iterations: 10_000 };
}
