import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Faq } from "../../../components/Faq.tsx";
import { Flag } from "../../../components/Flag.tsx";
import { JsonLd } from "../../../components/JsonLd.tsx";
import { LeagueSimulator } from "../../../components/LeagueSimulator.tsx";
import { LEAGUES, getLeagueBySlug, type LeagueConfig, type SiteLocale } from "../../../config/leagues.ts";
import { Link } from "../../../i18n/navigation.ts";
import { routing } from "../../../i18n/routing.ts";
import { getLeagueData } from "../../../lib/leagueData.ts";
import { HREFLANG, OG_LOCALE, SITE_NAME, SITE_URL, alternates, faqJsonLd, fill, type FaqItem } from "../../../lib/site.ts";

export const revalidate = 3600;

type Params = Promise<{ locale: string; league: string }>;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => LEAGUES.map((l) => ({ locale, league: l.slug })));
}

function seoValues(league: LeagueConfig, locale: string, season: string) {
  const lang = locale as SiteLocale;
  return { simulator: league.simulatorName[lang], league: league.name, aka: league.aka[lang], season };
}

/** Leagues decided by playoffs rather than relegation and European places (MLS) get their own wording. */
const playoffWording = (league: LeagueConfig) => league.zones.some((z) => z.kind === "playoffs");

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league: slug } = await params;
  const league = getLeagueBySlug(slug);
  if (!league) return {};
  const { season } = await getLeagueData(league);
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const values = seoValues(league, locale, season);
  const title = t("leagueTitle", values);
  const description = t(playoffWording(league) ? "leagueDescriptionPlayoffs" : "leagueDescription", values);
  return {
    title,
    description,
    alternates: alternates(locale, `/${league.slug}`),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OG_LOCALE[locale],
      title,
      description,
      url: `/${locale}/${league.slug}`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function LeaguePage({ params }: { params: Params }) {
  const { locale, league: slug } = await params;
  setRequestLocale(locale);
  const league = getLeagueBySlug(slug);
  if (!league) notFound();

  const [data, t, seo, faqT, meta] = await Promise.all([
    getLeagueData(league),
    getTranslations("Simulator"),
    getTranslations("Seo"),
    getTranslations("Faq"),
    getTranslations("Metadata"),
  ]);
  const values = seoValues(league, locale, data.season);
  const playoffs = playoffWording(league);
  const faq = (faqT.raw(playoffs ? "leaguePlayoffs" : "league") as FaqItem[]).map((item) => ({ q: fill(item.q, values), a: fill(item.a, values) }));
  const pageUrl = `${SITE_URL}/${locale}/${league.slug}`;
  const lang = locale as SiteLocale;

  return (
    <div className="space-y-4" data-source={data.source}>
      <JsonLd
        data={[
          {
            "@type": "WebApplication",
            name: `${values.simulator} ${data.season}`,
            url: pageUrl,
            description: meta(playoffWording(league) ? "leagueDescriptionPlayoffs" : "leagueDescription", values),
            applicationCategory: "GameApplication",
            applicationSubCategory: "Sports simulation",
            operatingSystem: "Web",
            inLanguage: HREFLANG[locale],
            isAccessibleForFree: true,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            about: { "@type": "SportsOrganization", name: league.name, sport: "Soccer" },
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: seo("breadcrumbHome"), item: `${SITE_URL}/${locale}` },
              { "@type": "ListItem", position: 2, name: values.simulator, item: pageUrl },
            ],
          },
          faqJsonLd(faq),
        ]}
      />

      <nav aria-label="Breadcrumb" className="text-xs text-zinc-500">
        <Link href="/" className="hover:underline">
          {seo("breadcrumbHome")}
        </Link>
        <span aria-hidden> › </span>
        <span>{values.simulator}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="flex items-center gap-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
          <Flag code={league.flag} width={36} />
          <span>
            {values.simulator} <span className="font-semibold text-zinc-500 dark:text-zinc-400">{data.season}</span>
          </span>
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{seo(playoffs ? "introPlayoffs" : "intro", values)}</p>
        {data.source === "live" && <p className="text-xs text-zinc-500">{t("liveSource")}</p>}
      </header>


      <LeagueSimulator
        league={league}
        teams={data.teams}
        fixtures={data.fixtures}
        seasonKey={data.seasonKey}
        season={data.season}
        {...(data.postseason ? { postseason: data.postseason } : {})}
        {...(data.groups ? { groups: data.groups } : {})}
      />

      <div className="grid gap-8 pt-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-xl font-bold tracking-tight">{seo("howTitle", values)}</h2>
          <ol className="space-y-2">
            {(["step1", "step2", "step3"] as const).map((step, i) => (
              <li key={step} className="flex gap-3 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pitch-600 text-xs font-bold text-white">{i + 1}</span>
                <span className="pt-0.5">{seo(step === "step3" && playoffs ? "step3Playoffs" : step)}</span>
              </li>
            ))}
          </ol>
          <h2 className="pt-4 text-xl font-bold tracking-tight">{seo("otherLeagues")}</h2>
          <ul className="flex flex-wrap gap-2">
            {LEAGUES.filter((l) => l.code !== league.code).map((l) => (
              <li key={l.code}>
                <Link
                  href={`/${l.slug}`}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium hover:border-pitch-500 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <Flag code={l.flag} width={18} />
                  {l.simulatorName[lang]}
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <Faq title={seo("faqTitle")} items={faq} />
      </div>
    </div>
  );
}
