import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CupSimulator } from "../../../components/CupSimulator.tsx";
import { Faq } from "../../../components/Faq.tsx";
import { Flag } from "../../../components/Flag.tsx";
import { JsonLd } from "../../../components/JsonLd.tsx";
import { LeagueSimulator } from "../../../components/LeagueSimulator.tsx";
import { COMPETITIONS, getCompetitionBySlug, type CompetitionConfig } from "../../../config/competitions.ts";
import type { CupConfig } from "../../../config/cups.ts";
import type { LeagueConfig, SiteLocale } from "../../../config/leagues.ts";
import { Link } from "../../../i18n/navigation.ts";
import { routing } from "../../../i18n/routing.ts";
import { getCupData, type CupData } from "../../../lib/cupData.ts";
import { getContinentalPriors, getExternalSeeds } from "../../../lib/continental.ts";
import { getLeagueData, type LeagueData } from "../../../lib/leagueData.ts";
import { HREFLANG, OG_LOCALE, SITE_NAME, SITE_URL, alternates, faqJsonLd, fill, type FaqItem } from "../../../lib/site.ts";

export const revalidate = 3600;

type Params = Promise<{ locale: string; league: string }>;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => COMPETITIONS.map((c) => ({ locale, league: c.slug })));
}

function seoValues(competition: CompetitionConfig, locale: string, season: string) {
  const lang = locale as SiteLocale;
  return { simulator: competition.simulatorName[lang], league: competition.name, aka: competition.aka[lang], season };
}

/** Leagues decided by playoffs rather than relegation and European places (MLS) get their own wording. */
const playoffWording = (league: LeagueConfig) => league.zones.some((z) => z.kind === "playoffs");

/** Which set of texts a page uses: league, play-off league, continental competition, or cup. */
type Wording = "league" | "leagueAmericas" | "zones" | "playoffs" | "continental" | "continentalGroups" | "cup" | "cupBracket";

type Loaded = { kind: "league"; config: LeagueConfig; data: LeagueData; wording: Wording } | { kind: "cup"; config: CupConfig; data: CupData; wording: "cup" | "cupBracket" };

async function load(slug: string): Promise<Loaded | undefined> {
  const competition = getCompetitionBySlug(slug);
  if (!competition) return undefined;
  if (competition.kind === "cup") {
    // A fixed bracket (Coppa Italia) has no draws to talk about.
    const wording = competition.cup.rounds.some((r) => r.bracket) ? "cupBracket" : "cup";
    return { kind: "cup", config: competition.cup, data: await getCupData(competition.cup), wording };
  }
  const { league } = competition;
  const wording: Wording = league.continental
    ? league.groups
      ? "continentalGroups"
      : "continental"
    : league.playoff?.seedFromGroups
      ? "zones" // Argentina: zone tables and a title play-off
      : playoffWording(league)
        ? "playoffs"
        : league.zones.some((z) => z.kind === "libertadores")
          ? "leagueAmericas" // continental places are the Libertadores, not Europe
          : "league";
  return { kind: "league", config: league, data: await getLeagueData(league), wording };
}

const META_KEYS: Record<
  Wording,
  {
    title: "leagueTitle" | "continentalTitle" | "continentalGroupsTitle" | "cupTitle" | "cupTitleBracket";
    description:
      | "leagueDescription"
      | "leagueDescriptionPlayoffs"
      | "leagueDescriptionAmericas"
      | "zonesDescription"
      | "continentalDescription"
      | "continentalGroupsDescription"
      | "cupDescription"
      | "cupDescriptionBracket";
  }
> = {
  league: { title: "leagueTitle", description: "leagueDescription" },
  leagueAmericas: { title: "leagueTitle", description: "leagueDescriptionAmericas" },
  zones: { title: "leagueTitle", description: "zonesDescription" },
  continental: { title: "continentalTitle", description: "continentalDescription" },
  continentalGroups: { title: "continentalGroupsTitle", description: "continentalGroupsDescription" },
  playoffs: { title: "leagueTitle", description: "leagueDescriptionPlayoffs" },
  cup: { title: "cupTitle", description: "cupDescription" },
  cupBracket: { title: "cupTitleBracket", description: "cupDescriptionBracket" },
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league: slug } = await params;
  const loaded = await load(slug);
  if (!loaded) return {};
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const values = seoValues(loaded.config, locale, loaded.data.season);
  const keys = META_KEYS[loaded.wording];
  const title = t(keys.title, values);
  const description = t(keys.description, values);
  return {
    title,
    description,
    alternates: alternates(locale, `/${loaded.config.slug}`),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OG_LOCALE[locale],
      title,
      description,
      url: `/${locale}/${loaded.config.slug}`,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function LeaguePage({ params }: { params: Params }) {
  const { locale, league: slug } = await params;
  setRequestLocale(locale);
  const loaded = await load(slug);
  if (!loaded) notFound();

  const [t, seo, faqT, meta] = await Promise.all([
    getTranslations("Simulator"),
    getTranslations("Seo"),
    getTranslations("Faq"),
    getTranslations("Metadata"),
  ]);
  const { config, data, wording } = loaded;
  const values = seoValues(config, locale, data.season);
  const faqKey =
    wording === "cup" || wording === "cupBracket" || wording === "continental" || wording === "continentalGroups" || wording === "zones"
      ? wording
      : wording === "playoffs"
        ? "leaguePlayoffs"
        : "league";
  // Cups: the FAQ explains where this cup's ratings come from.
  const cupT = await getTranslations("Cup");
  const faqValues = loaded.kind === "cup" ? { ...values, ratingNote: cupT(`ratingNote.${loaded.config.code}`) } : values;
  // Group-stage formats differ per competition (Libertadores, Sudamericana).
  const faqPath = wording === "continentalGroups" ? `${faqKey}.${config.code}` : faqKey;
  const faq = (faqT.raw(faqPath) as FaqItem[]).map((item) => ({ q: fill(item.q, faqValues), a: fill(item.a, faqValues) }));
  const pageUrl = `${SITE_URL}/${locale}/${config.slug}`;
  const lang = locale as SiteLocale;
  const intro =
    wording === "cupBracket"
      ? "introCupBracket"
      : wording === "cup"
        ? "introCup"
        : wording === "continental"
          ? "introContinental"
          : wording === "continentalGroups"
            ? (`introContinentalGroups.${config.code}` as "intro")
          : wording === "playoffs"
            ? "introPlayoffs"
            : wording === "zones"
              ? "introZones"
              : "intro";
  // Continental competitions: clubs joining the knockout phase from another
  // competition (Sudamericana: Libertadores third places), and ratings that
  // start from each club's domestic league.
  const external = loaded.kind === "league" ? await getExternalSeeds(loaded.config) : undefined;
  const leagueTeams =
    loaded.kind === "league"
      ? [...loaded.data.teams, ...(external?.teams ?? []).filter((t) => !loaded.data.teams.some((own) => own.id === t.id))]
      : [];
  const priorStrengths = loaded.kind === "league" && loaded.config.continental ? await getContinentalPriors(loaded.config, leagueTeams.map((t) => t.id)) : undefined;
  const stepKey = (step: "step1" | "step2" | "step3") =>
    wording === "cupBracket" && step === "step2"
      ? "step2CupBracket"
      : wording === "cup" || wording === "cupBracket"
        ? (`${step}Cup` as const)
        : step === "step3" && wording === "playoffs"
          ? "step3Playoffs"
          : step === "step3" && wording === "continental"
            ? "step3Continental"
            : step === "step3" && wording === "continentalGroups"
              ? (`step3ContinentalGroups.${config.code}` as "step3")
              : step === "step3" && wording === "zones"
                ? "step3Zones"
                : step === "step3" && wording === "leagueAmericas"
                  ? "step3Americas"
                  : step;

  return (
    <div className="space-y-4" data-source={data.source}>
      <JsonLd
        data={[
          {
            "@type": "WebApplication",
            name: `${values.simulator} ${data.season}`,
            url: pageUrl,
            description: meta(META_KEYS[wording].description, values),
            applicationCategory: "GameApplication",
            applicationSubCategory: "Sports simulation",
            operatingSystem: "Web",
            inLanguage: HREFLANG[locale],
            isAccessibleForFree: true,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            about: { "@type": "SportsOrganization", name: config.name, sport: "Soccer" },
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
          <Flag code={config.flag} width={36} />
          <span>
            {values.simulator} <span className="font-semibold text-zinc-500 dark:text-zinc-400">{data.season}</span>
          </span>
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{seo(intro, values)}</p>
        {data.source === "live" && <p className="text-xs text-zinc-500">{t("liveSource")}</p>}
      </header>

      {loaded.kind === "cup" ? (
        <CupSimulator cup={loaded.config} data={loaded.data} />
      ) : (
        <LeagueSimulator
          league={loaded.config}
          teams={leagueTeams}
          fixtures={loaded.data.fixtures}
          seasonKey={loaded.data.seasonKey}
          season={loaded.data.season}
          {...(loaded.data.postseason ? { postseason: loaded.data.postseason } : {})}
          {...(loaded.data.groups ? { groups: loaded.data.groups } : {})}
          {...(priorStrengths ? { priorStrengths } : {})}
          {...(external ? { externalSeeds: external.rows } : {})}
        />
      )}

      <div className="grid gap-8 pt-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-xl font-bold tracking-tight">{seo("howTitle", values)}</h2>
          <ol className="space-y-2">
            {(["step1", "step2", "step3"] as const).map((step, i) => (
              <li key={step} className="flex gap-3 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pitch-600 text-xs font-bold text-white">{i + 1}</span>
                <span className="pt-0.5">{seo(stepKey(step), values)}</span>
              </li>
            ))}
          </ol>
          <h2 className="pt-4 text-xl font-bold tracking-tight">{seo("otherLeagues")}</h2>
          <ul className="flex flex-wrap gap-2">
            {COMPETITIONS.filter((c) => c.slug !== config.slug).map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/${c.slug}`}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium hover:border-pitch-500 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <Flag code={c.flag} width={18} />
                  {c.simulatorName[lang]}
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
