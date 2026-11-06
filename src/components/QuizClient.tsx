"use client";

import { useEffect, useState } from "react";
import { Link } from "../i18n/navigation.ts";
import { Icon } from "./Icon.tsx";

/** One question as the page shows it: its words worked out on the server, in the visitor's language. */
export interface QuizItem {
  id: string;
  /** "Premier League 2018/19: who won it?" */
  prompt: string;
  /** "2018/19 · Premier League" or "This season · Premier League". */
  context: string;
  /** Each option's name, and what's shown once answered ("1st · 98 pts", "61%"). */
  options: { name: string; detail: string }[];
  answer: number;
  /** The sentence after the answer ("Manchester City won it with 98 points."). */
  reveal: string;
}

export interface QuizLabels {
  question: string;
  right: string;
  wrong: string;
  next: string;
  finish: string;
  score: string;
  perfect: string;
  good: string;
  tryAgain: string;
  tomorrow: string;
  share: string;
  shareText: string;
  copied: string;
  simulate: string;
  playedElsewhere: string;
  startedElsewhere: string;
  continueIn: string;
  /** Each site language's name, in the visitor's language ("Portuguese"). */
  languages: Record<string, string>;
}

interface Props {
  date: string;
  locale: string;
  items: QuizItem[];
  labels: QuizLabels;
}

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

const LOCALES = ["en", "pt", "es"] as const;
type Locale = (typeof LOCALES)[number];

/** What this browser keeps for a day: the language it was played in, its answers, and whether each was right. */
interface Saved {
  locale: Locale;
  answers: (number | null)[];
  /** Missing when kept by an older version (by language), until it's opened in that language again. */
  correct?: (boolean | null)[];
}

/** One quiz a day, whatever the language: the key has the date only. */
export const quizKey = (date: string) => `footsimu:quiz:${date}`;
/** The key before: one per date and language, so each language could be played once more. Read for the day it shipped. */
const legacyKey = (date: string, locale: string) => `footsimu:quiz:${date}:${locale}`;

const isAnswers = (value: unknown): value is (number | null)[] => Array.isArray(value) && value.every((a) => a === null || typeof a === "number");
const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);
const correctOf = (items: QuizItem[], answers: (number | null)[]) => items.map((q, i) => (answers[i] === null || answers[i] === undefined ? null : answers[i] === q.answer));

/** The day's play in this browser, in whichever language: the new key, else the old per-language ones (this language first). */
function readSaved(date: string, locale: Locale, items: QuizItem[]): Saved | null {
  const saved = JSON.parse(localStorage.getItem(quizKey(date)) ?? "null") as Partial<Saved> | null;
  if (saved && isLocale(saved.locale) && isAnswers(saved.answers)) return { locale: saved.locale, answers: saved.answers, correct: Array.isArray(saved.correct) ? saved.correct : undefined };
  for (const l of [locale, ...LOCALES.filter((l) => l !== locale)]) {
    const answers = JSON.parse(localStorage.getItem(legacyKey(date, l)) ?? "null") as unknown;
    if (!isAnswers(answers) || answers.every((a) => a === null)) continue;
    return { locale: l, answers, correct: l === locale && answers.length === items.length ? correctOf(items, answers) : undefined };
  }
  return null;
}

/**
 * The day's quiz: one question at a time, right or wrong at once with the
 * answer explained, then the score. The answers are kept in this browser for
 * the day (a reload shows where the visitor got to), and it's one quiz a day
 * whatever the language: each language asks its own set, so once started in
 * one, the others show the score, or send the visitor back to finish it.
 */
export function QuizClient({ date, locale: lang, items, labels }: Props) {
  const locale: Locale = isLocale(lang) ? lang : "en";
  const [answers, setAnswers] = useState<(number | null)[]>(() => items.map(() => null));
  const [index, setIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  /** Today's quiz, played (or started) in another language, or as a set that has since changed. */
  const [elsewhere, setElsewhere] = useState<Saved | null>(null);

  // Today's answers so far, from this browser (none in a private window: the quiz still works).
  useEffect(() => {
    try {
      const saved = readSaved(date, locale, items);
      if (!saved) return;
      if (saved.locale === locale && saved.answers.length === items.length) {
        setAnswers(saved.answers);
        const next = saved.answers.findIndex((a) => a === null);
        setIndex(next === -1 ? items.length : next);
        // Moved over from the old key, so the other languages see it too.
        localStorage.setItem(quizKey(date), JSON.stringify({ ...saved, correct: correctOf(items, saved.answers) }));
        return;
      }
      const complete = saved.answers.every((a) => a !== null);
      // This language's set changed since (its live questions): a finished one keeps its score, an unfinished one starts again.
      if (saved.locale === locale && !(complete && saved.correct)) return;
      setElsewhere({ ...saved });
    } catch {
      // Storage unavailable: start afresh.
    }
  }, [date, locale, items]);

  const choose = (option: number) => {
    if (answers[index] !== null || elsewhere) return;
    const next = answers.map((a, i) => (i === index ? option : a));
    setAnswers(next);
    try {
      localStorage.setItem(quizKey(date), JSON.stringify({ locale, answers: next, correct: correctOf(items, next) } satisfies Saved));
    } catch {
      // Not kept: fine.
    }
  };

  if (elsewhere) {
    const language = labels.languages[elsewhere.locale] ?? elsewhere.locale;
    const complete = elsewhere.answers.every((a) => a !== null);
    const marks = elsewhere.correct;
    if (complete && marks && marks.length) {
      const note = elsewhere.locale === locale ? undefined : fill(labels.playedElsewhere, { language });
      return <Score marks={marks.map(Boolean)} labels={labels} note={note} copied={copied} setCopied={setCopied} />;
    }
    return (
      <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900" data-testid="quiz-elsewhere" data-locale={elsewhere.locale}>
        <Icon name={complete ? "trophy" : "circle-help"} size={36} className="mx-auto text-pitch-600" />
        <p className="text-zinc-700 dark:text-zinc-300">{fill(complete ? labels.playedElsewhere : labels.startedElsewhere, { language })}</p>
        <Link href="/quiz" locale={elsewhere.locale} className="mx-auto flex h-11 w-fit items-center justify-center gap-1.5 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700">
          {complete ? labels.finish : fill(labels.continueIn, { language })}
          <Icon name="chevron-right" size={18} />
        </Link>
        <p className="text-sm text-zinc-500">{labels.tomorrow}</p>
      </div>
    );
  }

  if (index >= items.length) return <Score marks={items.map((q, i) => answers[i] === q.answer)} labels={labels} copied={copied} setCopied={setCopied} />;

  const q = items[index]!;
  const chosen = answers[index];
  const answered = chosen !== null && chosen !== undefined;
  const right = answered && chosen === q.answer;
  return (
    <div className="space-y-4" data-testid="quiz-question" data-index={index}>
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-zinc-500">
        <span>{fill(labels.question, { n: index + 1, total: items.length })}</span>
        <span className="truncate">{q.context}</span>
      </div>
      {/* Progress: one segment per question. */}
      <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }} aria-hidden>
        {items.map((item, i) => (
          <li key={item.id} className={`h-1.5 rounded-full ${i < index ? (answers[i] === item.answer ? "bg-pitch-600" : "bg-red-500") : i === index ? "bg-zinc-400" : "bg-zinc-200 dark:bg-zinc-700"}`} />
        ))}
      </ol>
      <h2 className="text-xl font-bold leading-snug text-balance sm:text-2xl">{q.prompt}</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {q.options.map((option, i) => {
          const isAnswer = i === q.answer;
          const tone = !answered
            ? "border-zinc-300 bg-white hover:border-pitch-500 hover:bg-pitch-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-pitch-900/30"
            : isAnswer
              ? "border-pitch-600 bg-pitch-50 dark:bg-pitch-900/40"
              : i === chosen
                ? "border-red-500 bg-red-50 dark:bg-red-900/30"
                : "border-zinc-200 bg-white opacity-70 dark:border-zinc-800 dark:bg-zinc-900";
          return (
            <li key={option.name}>
              <button
                type="button"
                onClick={() => choose(i)}
                disabled={answered}
                className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition ${tone}`}
                data-testid="quiz-option"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{option.name}</span>
                  {answered && <span className="block text-xs text-zinc-500">{option.detail}</span>}
                </span>
                {answered && isAnswer && <Icon name="check" size={20} strokeWidth={3} className="shrink-0 text-pitch-700 dark:text-pitch-100" />}
                {answered && !isAnswer && i === chosen && <Icon name="x" size={20} strokeWidth={3} className="shrink-0 text-red-600" />}
              </button>
            </li>
          );
        })}
      </ul>
      {answered && (
        <div className={`flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center ${right ? "bg-pitch-50 dark:bg-pitch-900/30" : "bg-red-50 dark:bg-red-900/20"}`} data-testid="quiz-feedback" data-correct={right}>
          <p className="min-w-0 flex-1 text-sm leading-relaxed">
            <span className="font-bold">{right ? labels.right : labels.wrong}</span> {q.reveal}
          </p>
          <button
            type="button"
            onClick={() => setIndex(index + 1)}
            className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700"
            data-testid="quiz-next"
          >
            {index === items.length - 1 ? labels.finish : labels.next}
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

/** The score: how many were right, one mark per question, and the share button. `note` says where it was played, when not here. */
function Score({ marks, labels, note, copied, setCopied }: { marks: boolean[]; labels: QuizLabels; note?: string; copied: boolean; setCopied: (copied: boolean) => void }) {
  const score = marks.filter(Boolean).length;
  const total = marks.length;
  const verdict = score === total ? labels.perfect : score >= Math.ceil(total * 0.6) ? labels.good : labels.tryAgain;
  const shareText = fill(labels.shareText, { score, total });
  const share = async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    try {
      if (navigator.share) await navigator.share({ text: shareText, url });
      else {
        await navigator.clipboard.writeText(`${shareText} ${url}`);
        setCopied(true);
      }
    } catch {
      // Cancelled: nothing to do.
    }
  };
  return (
    <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900" data-testid="quiz-score">
      <Icon name="trophy" size={36} className="mx-auto text-pitch-600" />
      <p className="text-3xl font-extrabold tabular-nums">{fill(labels.score, { score, total })}</p>
      <p className="text-zinc-700 dark:text-zinc-300">{verdict}</p>
      <ol className="mx-auto flex max-w-xs justify-center gap-1.5" aria-hidden>
        {marks.map((right, i) => (
          <li key={i} className={`flex h-7 w-7 items-center justify-center rounded-full ${right ? "bg-pitch-600 text-white" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"}`}>
            <Icon name={right ? "check" : "x"} size={14} strokeWidth={3} />
          </li>
        ))}
      </ol>
      {note && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="quiz-played-elsewhere">
          {note}
        </p>
      )}
      <p className="text-sm text-zinc-500">{labels.tomorrow}</p>
      <div className="flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        <button type="button" onClick={share} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700" data-testid="quiz-share">
          <Icon name="share" size={18} />
          {copied ? labels.copied : labels.share}
        </button>
        <Link href="/" className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          <Icon name="dices" size={18} />
          {labels.simulate}
        </Link>
      </div>
    </div>
  );
}
