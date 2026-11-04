import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Flag } from "../../../../../components/Flag.tsx";
import { LeagueSimulator } from "../../../../../components/LeagueSimulator.tsx";
import { ShareMenu } from "../../../../../components/ShareMenu.tsx";
import { getLeagueBySlug } from "../../../../../config/leagues.ts";
import { Link } from "../../../../../i18n/navigation.ts";
import { domesticPriors } from "../../../../../lib/priors.ts";
import { loadSharedScenario } from "../../../../../lib/sharedScenario.ts";
import { alternates, OG_LOCALE, SITE_NAME } from "../../../../../lib/site.ts";

type Params = Promise<{ locale: string; league: string; code: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league: slug, code } = await params;
  const league = getLeagueBySlug(slug);
  if (!league) return {};
  const shared = await loadSharedScenario(slug, code).catch(() => undefined);
  const t = await getTranslations({ locale, namespace: "SharePage" });
  const values = { league: league.name, season: shared?.data.season ?? "" };
  const title = t("title", values);
  const description = t("description", values);
  return {
    title,
    description,
    alternates: alternates(locale, `/${slug}/share/${code}`),
    // One page per prediction: kept out of search results, links still followed.
    robots: { index: false, follow: true },
    // The card comes from the opengraph-image and twitter-image files next to this page.
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: `/${locale}/${slug}/share/${code}`, locale: OG_LOCALE[locale] },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * A shared prediction: the predicted table read-only (the scores come from the
 * link; the visitor's own predictions are untouched), with a way to make one.
 */
export default async function SharePage({ params }: { params: Params }) {
  const { locale, league: slug, code } = await params;
  setRequestLocale(locale);
  // League data unavailable (the feed is down): the league page, which has its own fallbacks.
  const shared = await loadSharedScenario(slug, code).catch((error: unknown) => {
    console.warn(`share ${slug}: league data unavailable:`, error);
    return null;
  });
  if (shared === null) redirect(`/${locale}/${slug}`);
  if (!shared) {
    // A league whose links open its own page (or an unknown one).
    if (getLeagueBySlug(slug)) redirect(`/${locale}/${slug}?r=${encodeURIComponent(code)}`);
    notFound();
  }
  // A link from another season (or a broken one): the league page.
  if (!shared.predictions) redirect(`/${locale}/${slug}`);
  const { league, data, predictions } = shared;
  const [t, ts] = await Promise.all([getTranslations("SharePage"), getTranslations("Simulator")]);
  const values = { league: league.name, season: data.season };
  const priorStrengths = domesticPriors(league.code, data.seasonYear);
  const path = `/${locale}/${slug}/share/${code}`;
  const shareProps = {
    path,
    imagePath: `${path}/opengraph-image`,
    title: ts("shareTitle", values),
    text: ts("shareText", values),
    league: league.code,
  };
  const cta = "flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold";

  return (
    <div className="space-y-6" data-testid="share-page">
      <header className="space-y-3">
        <span className="inline-flex rounded-full bg-pitch-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-pitch-700 dark:bg-pitch-900/40 dark:text-pitch-100">
          {t("eyebrow")}
        </span>
        <h1 className="flex items-center gap-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
          <Flag code={league.flag} width={36} />
          <span>{t("heading", values)}</span>
        </h1>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{t("note")}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Link href={`/${slug}`} className={`${cta} bg-pitch-600 text-white hover:bg-pitch-700`} data-testid="make-own">
            {t("makeOwn")}
          </Link>
          <Link
            href={`/${slug}?r=${code}`}
            className={`${cta} border border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800`}
            data-testid="start-from"
          >
            {t("startFrom")}
          </Link>
          <div className="hidden sm:block">
            <ShareMenu {...shareProps} variant="inline" />
          </div>
        </div>
      </header>

      <LeagueSimulator
        league={league}
        teams={data.teams}
        fixtures={data.fixtures}
        seasonKey={data.seasonKey}
        season={data.season}
        scenario={predictions}
        {...(data.postseason ? { postseason: data.postseason } : {})}
        {...(data.groups ? { groups: data.groups } : {})}
        {...(priorStrengths ? { priorStrengths } : {})}
        {...(data.deductions ? { deductions: data.deductions } : {})}
        {...(data.firstPhaseIds ? { firstPhaseIds: data.firstPhaseIds } : {})}
      />

      {/* Phones: share this prediction, right under the table. */}
      <div className="sm:hidden">
        <ShareMenu {...shareProps} variant="bar" />
      </div>
    </div>
  );
}
