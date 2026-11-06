import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ChanceRace } from "../../../../../components/ChanceRace.tsx";
import { Faq } from "../../../../../components/Faq.tsx";
import { Flag } from "../../../../../components/Flag.tsx";
import { Icon } from "../../../../../components/Icon.tsx";
import { JsonLd } from "../../../../../components/JsonLd.tsx";
import { zoneHex } from "../../../../../components/zones.ts";
import type { SiteLocale } from "../../../../../config/leagues.ts";
import type { Team, TeamId } from "../../../../../engine/types.ts";
import { Link } from "../../../../../i18n/navigation.ts";
import { isOutcome, leagueChancePath, leagueOutcomes, outcomeChance, type Outcome } from "../../../../../lib/chancePages.ts";
import { leagueChanceText, leagueOutcomeKey, type ChanceTranslators } from "../../../../../lib/chanceText.ts";
import { loadLeague, type LoadedLeague } from "../../../../../lib/clubPage.ts";
import { latestReportPath, readSnapshots, seasonReports } from "../../../../../lib/oddsReports.ts";
import { OG_LOCALE, SITE_NAME, SITE_URL, alternates, faqJsonLd } from "../../../../../lib/site.ts";

/** As the league's club pages: refreshed at most every hour (ISR). */
export const revalidate = 3600;
/** Room for the shared outlook on a cold server (see the club page). */
export const maxDuration = 60;

/** Rendered on its first visit, then kept and refreshed: none at build time. */
export function generateStaticParams() {
  return [];
}

type Params = Promise<{ locale: string; league: string; outcome: string }>;
const langOf = (locale: string) => (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;

/** The league and its outlook, when it has this outcome; undefined for a 404. */
async function load(slug: string, outcome: string): Promise<(LoadedLeague & { outcome: Outcome }) | undefined> {
  if (!isOutcome(outcome)) return undefined;
  const loaded = await loadLeague(slug);
  return loaded && leagueOutcomes(loaded.outlook).includes(outcome) ? { ...loaded, outcome } : undefined;
}

async function translators(locale: string): Promise<ChanceTranslators> {
  const [t, tc, tz] = await Promise.all([
    getTranslations({ locale, namespace: "Chances" }),
    getTranslations({ locale, namespace: "Club" }),
    getTranslations({ locale, namespace: "Zones" }),
  ]);
  return { t: t as never, tc: tc as never, tz: tz as never };
}

const shortNames = (loaded: LoadedLeague) => {
  const byId = new Map(loaded.data.teams.map((x) => [x.id, x.shortName]));
  return (id: TeamId) => byId.get(id) ?? "";
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league, outcome } = await params;
  const loaded = await load(league, outcome);
  if (!loaded) return {};
  const text = leagueChanceText(loaded, loaded.outcome, langOf(locale), shortNames(loaded), await translators(locale));
  const path = leagueChancePath(loaded.league, loaded.outcome);
  return {
    title: text.title,
    description: text.description,
    alternates: alternates(locale, path),
    // The league's own card (a chance page has none of its own: nested pages don't inherit it).
    openGraph: { type: "website", siteName: SITE_NAME, title: text.title, description: text.description, url: `/${locale}${path}`, locale: OG_LOCALE[locale], images: [{ url: `/${locale}/${loaded.league.slug}/opengraph-image`, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: text.title, description: text.description, images: [`/${locale}/${loaded.league.slug}/opengraph-image`] },
    // A season that's over: the page stays, search engines are pointed at the next season's.
    ...(loaded.outlook.complete ? { robots: { index: false, follow: true } } : {}),
  };
}

/** "{league} title odds": every club's chance of an outcome, from the shared outlook, with an FAQ. */
export default async function LeagueChancePage({ params }: { params: Params }) {
  const { locale, league: slug, outcome: param } = await params;
  setRequestLocale(locale);
  const loaded = await load(slug, param);
  if (!loaded) notFound();
  const lang = langOf(locale);
  const tr = await translators(locale);
  const { t, tc } = tr;
  const seo = await getTranslations("Seo");
  const { league, data, outlook, season, outcome } = loaded;
  const text = leagueChanceText(loaded, outcome, lang, shortNames(loaded), tr);
  const teams = new Map<TeamId, Team>(data.teams.map((x) => [x.id, x]));
  const count = new Intl.NumberFormat(lang).format(outlook.iterations);
  const leaguePath = `/${league.slug}`;
  const path = leagueChancePath(league, outcome);
  const pageUrl = `${SITE_URL}/${locale}${path}`;
  const zone = outcomeChance([...outlook.clubs.values()].find((c) => outcomeChance(c, outcome))!, outcome)!.zone;
  const others = leagueOutcomes(outlook).filter((o) => o !== outcome);
  const hasReport = Boolean(seasonReports(await readSnapshots(league.code), data.seasonKey)?.snapshots.length);
  const chip = (o: Outcome) => {
    const { key, name } = leagueOutcomeKey(outlook, o);
    return t("chip", { Topic: t(`Topic.${key}`, { name }), topic: t(`topic.${key}`, { name }) });
  };

  return (
    <div className="space-y-8" data-testid="chance-page" data-outcome={outcome}>
      <JsonLd
        data={[
          faqJsonLd(text.faq),
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: seo("breadcrumbHome"), item: `${SITE_URL}/${locale}` },
              { "@type": "ListItem", position: 2, name: league.simulatorName[lang], item: `${SITE_URL}/${locale}${leaguePath}` },
              { "@type": "ListItem", position: 3, name: text.h1, item: pageUrl },
            ],
          },
        ]}
      />

      <nav aria-label={seo("breadcrumb")} className="flex min-w-0 items-center text-xs text-zinc-500">
        <Link href="/" className="shrink-0 hover:underline">
          {seo("breadcrumbHome")}
        </Link>
        <Icon name="chevron-right" size={12} className="mx-1 shrink-0" />
        <Link href={leaguePath} className="truncate hover:underline">
          {league.simulatorName[lang]}
        </Link>
      </nav>

      <header className="space-y-3">
        <Link
          href={leaguePath}
          className="inline-flex max-w-full items-center gap-2 rounded-full bg-pitch-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-pitch-700 hover:bg-pitch-100 dark:bg-pitch-900/40 dark:text-pitch-100"
        >
          <Flag code={league.flag} width={18} />
          <span className="truncate">
            {league.name} {season}
          </span>
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight break-words sm:text-3xl">{text.h1}</h1>
        {text.lead && (
          <p className="max-w-3xl leading-relaxed text-zinc-700 dark:text-zinc-300" data-testid="chance-lead">
            {text.lead}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link href={leaguePath} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700" data-testid="chance-simulate">
            <Icon name="dices" size={18} />
            {t("simulate", { simulator: league.simulatorName[lang] })}
          </Link>
          {hasReport && (
            <Link
              href={latestReportPath(league)}
              className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              data-testid="chance-report"
            >
              <Icon name="trending-up" size={18} />
              {t("latestReport")}
            </Link>
          )}
        </div>
      </header>

      <section className="space-y-3" data-testid="chance-table">
        <h2 className="text-xl font-bold tracking-tight">{text.tableTitle}</h2>
        <ChanceRace rows={text.rows} teams={teams} outcome={outcome} color={zoneHex(zone)} lang={lang} standing={(position, points) => t("standing", { position, points })} />
        {text.rest > 0 && (
          <p className="text-xs text-zinc-500" data-testid="chance-rest">
            {t("league.rest", { count: text.rest, iterations: count })}
          </p>
        )}
        <p className="text-xs text-zinc-500">{tc("chancesNote", { count })}</p>
      </section>

      {others.length > 0 && (
        <section className="space-y-3" data-testid="chance-more">
          <h2 className="text-xl font-bold tracking-tight">{t("league.more", { league: league.name })}</h2>
          <ul className="flex flex-wrap gap-2">
            {others.map((o) => (
              <li key={o}>
                <Link
                  href={leagueChancePath(league, o)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold hover:border-pitch-500 hover:bg-pitch-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-pitch-900/30"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: zoneHex(outcomeChance([...outlook.clubs.values()].find((c) => outcomeChance(c, o))!, o)!.zone) }} />
                  {chip(o)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Faq title={seo("faqTitle")} items={text.faq} />
    </div>
  );
}
