import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Icon } from "../../../components/Icon.tsx";
import { QuizClient, type QuizItem, type QuizLabels } from "../../../components/QuizClient.tsx";
import { getLeagueByCode, type SiteLocale } from "../../../config/leagues.ts";
import { ordinal, percent } from "../../../lib/clubText.ts";
import type { QuizQuestion } from "../../../lib/quiz.ts";
import { todaysQuiz } from "../../../lib/quizPage.ts";
import { OG_LOCALE, SITE_NAME, alternates } from "../../../lib/site.ts";

/** A new set every day (UTC): rebuilt within a quarter of an hour of midnight, and as the live chances move. */
export const revalidate = 900;
/** Room for the day's two live outlooks on a cold server (they're shared with the club pages). */
export const maxDuration = 60;

type Params = Promise<{ locale: string }>;
const langOf = (locale: string) => (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Quiz" });
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: alternates(locale, "/quiz"),
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: `/${locale}/quiz`, locale: OG_LOCALE[locale] },
    twitter: { card: "summary_large_image", title, description },
  };
}

type Translate = Awaited<ReturnType<typeof getTranslations<"Quiz">>>;
type TranslateZones = Awaited<ReturnType<typeof getTranslations<"Zones">>>;

/** A question's words in a language: the prompt, its context line, each option's reveal and the sentence after. */
function itemOf(q: QuizQuestion, lang: SiteLocale, t: Translate, tz: TranslateZones, count: string): QuizItem {
  const league = getLeagueByCode(q.league)?.name ?? q.league;
  const right = q.options[q.answer]!;
  if (q.kind === "likelier") {
    const topic = q.topic!;
    const key = topic.kind === "title" ? "likelier.title" : topic.kind === "relegation" ? "likelier.relegation" : topic.zone === "promotion" ? "likelier.promotion" : "likelier.zone";
    const zone = topic.kind === "zone" ? tz(topic.zone) : "";
    const [a, b] = q.options;
    return {
      id: q.id,
      prompt: t(key, { league, zone }),
      context: t("contextLive", { league }),
      options: q.options.map((o) => ({ name: o.name, detail: percent(o.chance ?? 0, lang) })),
      answer: q.answer,
      reveal: t("reveal.likelier", { a: a!.name, pctA: percent(a!.chance ?? 0, lang), b: b!.name, pctB: percent(b!.chance ?? 0, lang), count }),
    };
  }
  const season = q.season ?? "";
  const detail = (o: QuizQuestion["options"][number]) => t("placePoints", { place: ordinal(o.place ?? 0, lang), points: o.points ?? 0 });
  const values = { league, season, club: right.name, place: ordinal(right.place ?? 0, lang), points: right.points ?? 0 };
  const reveal =
    q.kind === "higher"
      ? (() => {
          const other = q.options[1 - q.answer]!;
          return t("reveal.higher", { ...values, other: other.name, otherPlace: ordinal(other.place ?? 0, lang) });
        })()
      : t(`reveal.${q.kind}`, values);
  return { id: q.id, prompt: t(q.kind, { league, season }), context: t("contextPast", { league, season }), options: q.options.map((o) => ({ name: o.name, detail: detail(o) })), answer: q.answer, reveal };
}

export default async function Page({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = langOf(locale);
  const [t, tz] = await Promise.all([getTranslations("Quiz"), getTranslations("Zones")]);
  const { date, questions, iterations } = await todaysQuiz(lang);
  const count = new Intl.NumberFormat(lang).format(iterations);
  const items = questions.map((q) => itemOf(q, lang, t, tz, count));
  const keys = ["question", "right", "wrong", "next", "finish", "score", "perfect", "good", "tryAgain", "tomorrow", "share", "shareText", "copied", "simulate", "playedElsewhere", "startedElsewhere", "continueIn", "languages"] as const;
  // "{n}", "{total}", "{score}", "{language}" stay for the component to fill in.
  const labels = Object.fromEntries(keys.map((k) => [k, t.raw(k) as unknown])) as unknown as QuizLabels;
  const day = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="quiz" data-date={date}>
      <header className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-pitch-700 dark:text-pitch-100">
          <Icon name="circle-help" size={16} />
          {t("eyebrow", { date: day })}
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t("title")}</h1>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("intro", { count: items.length })}</p>
      </header>
      <QuizClient date={date} locale={lang} items={items} labels={labels} />
    </div>
  );
}
