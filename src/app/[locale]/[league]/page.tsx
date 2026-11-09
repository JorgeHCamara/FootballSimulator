import { domesticPriors, leagueMatchParams } from "../../../lib/priors.ts";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdSlot } from "../../../components/AdSlot.ts";
import { CupSimulator } from "../../../components/CupSimulator.tsx";
import { LeagueFactsSection } from "../../../components/LeagueFactsSection.tsx";
import { ProjectedSection } from "../../../components/ProjectedSection.tsx";
import { Faq } from "../../../components/Faq.tsx";
import { Flag } from "../../../components/Flag.tsx";
import { JsonLd } from "../../../components/JsonLd.tsx";
import { LeagueSimulator } from "../../../components/LeagueSimulator.tsx";
import { TournamentSwitch } from "../../../components/TournamentSwitch.tsx";
import { COMPETITIONS, getCompetitionBySlug, type CompetitionConfig } from "../../../config/competitions.ts";
import type { CupConfig } from "../../../config/cups.ts";
import type { LeagueConfig, SiteLocale } from "../../../config/leagues.ts";
import { Link } from "../../../i18n/navigation.ts";
import { routing } from "../../../i18n/routing.ts";
import { getCupData, type CupData } from "../../../lib/cupData.ts";
import { getContinentalPriors, getExternalSeeds } from "../../../lib/continental.ts";
import { getLeagueData, type LeagueData } from "../../../lib/leagueData.ts";
import { HREFLANG, OG_LOCALE, SITE_NAME, SITE_URL, alternates, faqJsonLd, fill, type FaqItem } from "../../../lib/site.ts";
import { Icon } from "../../../components/Icon.tsx";
import { hasClubPages } from "../../../lib/clubs.ts";
import { latestReportPath, readSnapshots, seasonReports } from "../../../lib/oddsReports.ts";
import { leagueChancePath, snapshotOutcomeKey, snapshotOutcomes } from "../../../lib/chancePages.ts";
import { hasPastWinners, pastWinnersPath } from "../../../lib/winnersData.ts";

/**
 * Rebuilt when the league's results change, else every six hours at most:
 * the league's data is only replaced when new results are in (/api/revalidate/leagues revalidates its tags; see leagueDataKeepSeconds), and a league whose data is kept an hour (no route, football-data.org, the cups) still refreshes hourly through its fetches.
 */
export const revalidate = 21600;

type Params = Promise<{ locale: string; league: string }>;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => COMPETITIONS.map((c) => ({ locale, league: c.slug })));
}

function seoValues(competition: CompetitionConfig, locale: string, season: string) {
  const lang = locale as SiteLocale;
  return { simulator: competition.simulatorName[lang], league: competition.name, aka: competition.aka[lang], season };
}

/** The season a page covers: a season of several tournaments ("Clausura 2026") is shown by its year. */
const pageSeason = (data: { season: string; tournaments?: unknown[] }) => (data.tournaments ? (data.season.split(" ").at(-1) ?? data.season) : data.season);

/** Leagues decided by playoffs rather than relegation and European places (MLS) get their own wording. */
const playoffWording = (league: LeagueConfig) => league.zones.some((z) => z.kind === "playoffs");

/** Which set of texts a page uses: league, play-off league, continental competition, or cup. */
type Wording = "league" | "stages" | "promotionPath" | "reducido" | "leagueAmericas" | "leagueAsia" | "zones" | "tournaments" | "liguilla" | "playoffs" | "continental" | "continentalGroups" | "cup" | "cupBracket";

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
    : league.promotionPath
      ? "promotionPath" // Primera B: two tournaments (round robin, groups, final), the aggregate table and the promotion path
      : league.split && league.playoff?.seedFromGroups
      ? "stages" // Série C: a first stage, promotion groups and a final
      : league.playoff?.titleRound !== undefined
      ? "reducido" // Primera Nacional: zone tables, the zone winners' final and the Reducido
      : league.playoff?.seedFromGroups
      ? "zones" // Argentina: zone tables and a title play-off
      : league.annual
        ? "tournaments" // several tournaments a year and an annual table (Colombia, Uruguay, Paraguay)
        : league.playoff?.title && !league.groups
          ? "liguilla" // one table and a title play-off (Liga MX)
      : playoffWording(league)
        ? "playoffs"
        : [...league.zones, ...(league.groups ?? []).flatMap((g) => g.zones ?? [])].some((z) => z.kind === "libertadores")
          ? "leagueAmericas" // continental places are the Libertadores, not Europe
          : league.zones.some((z) => z.kind === "aclElite")
            ? "leagueAsia" // the AFC Champions League
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
      | "leagueDescriptionAsia"
      | "zonesDescription"
      | "stagesDescription"
      | "promotionPathDescription"
      | "reducidoDescription"
      | "tournamentsDescription"
      | "liguillaDescription"
      | "continentalDescription"
      | "continentalGroupsDescription"
      | "cupDescription"
      | "cupDescriptionBracket";
  }
> = {
  league: { title: "leagueTitle", description: "leagueDescription" },
  leagueAmericas: { title: "leagueTitle", description: "leagueDescriptionAmericas" },
  leagueAsia: { title: "leagueTitle", description: "leagueDescriptionAsia" },
  zones: { title: "leagueTitle", description: "zonesDescription" },
  stages: { title: "leagueTitle", description: "stagesDescription" },
  promotionPath: { title: "leagueTitle", description: "promotionPathDescription" },
  reducido: { title: "leagueTitle", description: "reducidoDescription" },
  tournaments: { title: "leagueTitle", description: "tournamentsDescription" },
  liguilla: { title: "leagueTitle", description: "liguillaDescription" },
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
  const values = seoValues(loaded.config, locale, pageSeason(loaded.data));
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

  // The latest "what changed" report (domestic leagues with snapshots), and the chance pages its places make.
  const latestSnapshot =
    loaded.kind === "league" && hasClubPages(loaded.config) ? seasonReports(await readSnapshots(loaded.config.code), loaded.data.seasonKey)?.snapshots.at(-1) : undefined;
  const latestOdds = latestSnapshot?.round;
  const chanceLinks = loaded.kind === "league" && latestSnapshot ? snapshotOutcomes(loaded.config, latestSnapshot).map((o) => ({ outcome: o, ...snapshotOutcomeKey(loaded.config, latestSnapshot, o) })) : [];
  const [oddsT, chancesT] = await Promise.all([getTranslations("Odds"), getTranslations("Chances")]);
  const [t, seo, faqT, meta] = await Promise.all([
    getTranslations("Simulator"),
    getTranslations("Seo"),
    getTranslations("Faq"),
    getTranslations("Metadata"),
  ]);
  const { config, data, wording } = loaded;
  const values = seoValues(config, locale, pageSeason(data));
  const faqKey =
    wording === "cup" ||
    wording === "cupBracket" ||
    wording === "continental" ||
    wording === "continentalGroups" ||
    wording === "zones" ||
    wording === "reducido" ||
    wording === "tournaments" ||
    wording === "liguilla" ||
    wording === "promotionPath"
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
              : wording === "stages"
                ? "introStages"
              : wording === "promotionPath"
                ? "introPromotionPath"
              : wording === "reducido"
                ? "introReducido"
              : wording === "tournaments"
                ? "introTournaments"
                : wording === "liguilla"
                  ? "introLiguilla"
              : "intro";
  // Continental competitions: clubs joining the knockout phase from another
  // competition (Sudamericana: Libertadores third places), and ratings that
  // start from each club's domestic league.
  const external = loaded.kind === "league" ? await getExternalSeeds(loaded.config) : undefined;
  const leagueTeams =
    loaded.kind === "league"
      ? [...loaded.data.teams, ...(external?.teams ?? []).filter((t) => !loaded.data.teams.some((own) => own.id === t.id))]
      : [];
  // Starting ratings: continental competitions from each club's domestic
  // league, domestic leagues from last season (src/data/priors).
  const priorStrengths =
    loaded.kind !== "league"
      ? undefined
      : loaded.config.continental
        ? await getContinentalPriors(loaded.config, leagueTeams.map((t) => t.id))
        : domesticPriors(loaded.config.code, loaded.data.seasonYear);
  // The league's rho (and home splits, and its games' xG when its ratings use it) for the match model.
  const matchParams = loaded.kind === "league" && !loaded.config.continental ? leagueMatchParams(loaded.config, loaded.data.seasonYear, loaded.data.xg) : undefined;
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
                : step === "step3" && wording === "stages"
                  ? "step3Stages"
                : step === "step3" && wording === "promotionPath"
                  ? "step3PromotionPath"
                : step === "step3" && wording === "reducido"
                  ? "step3Reducido"
                : step === "step3" && wording === "tournaments"
                  ? "step3Tournaments"
                  : step === "step3" && wording === "liguilla"
                    ? "step3Liguilla"
                  : step === "step3" && wording === "leagueAmericas"
                  ? "step3Americas"
                  : step === "step3" && wording === "leagueAsia"
                    ? "step3Asia"
                    : step;

  // Past Winners, for a league with a history file (src/data/history): a third tab beside Table and Chances, to its own page.
  const pastWinners = loaded.kind === "league" && hasPastWinners(loaded.config.slug) ? { href: pastWinnersPath(loaded.config), label: (await getTranslations("PastWinners"))("title") } : undefined;

  return (
    <div className="space-y-4" data-source={data.source}>
      <JsonLd
        data={[
          {
            "@type": "WebApplication",
            name: `${values.simulator} ${values.season}`,
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

      <nav aria-label={seo("breadcrumb")} className="text-xs text-zinc-500">
        <Link href="/" className="hover:underline">
          {seo("breadcrumbHome")}
        </Link>
        <Icon name="chevron-right" size={12} className="mx-1 inline-block align-[-1px]" />
        <span>{values.simulator}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="flex items-center gap-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
          <Flag code={config.flag} width={36} />
          <span>
            {values.simulator} <span className="font-semibold text-zinc-500 dark:text-zinc-400">{values.season}</span>
          </span>
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{seo(intro, values)}</p>
        {data.source === "live" && <p className="text-xs text-zinc-500">{"provider" in data && data.provider === "first-party" ? t(`firstPartySource.${config.code}` as "liveSource") : t("liveSource")}</p>}
        {latestOdds && (
          <Link
            href={latestReportPath(config)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-pitch-600/40 bg-pitch-50 px-3 py-1.5 text-sm font-semibold text-pitch-800 hover:bg-pitch-100 dark:bg-pitch-900/30 dark:text-pitch-100 dark:hover:bg-pitch-900/50"
            data-testid="league-latest-odds"
          >
            <Icon name="trending-up" size={16} className="shrink-0" />
            {oddsT("leagueLink", { round: oddsT("round", { n: latestOdds }) })}
          </Link>
        )}
        {chanceLinks.length > 0 && (
          // Every club's title, promotion, play-off and relegation chances, each on its own page.
          <ul className="flex flex-wrap gap-2" data-testid="league-chances">
            {chanceLinks.map((c) => (
              <li key={c.outcome}>
                <Link
                  href={leagueChancePath(config, c.outcome)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-semibold hover:border-pitch-500 hover:bg-pitch-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-pitch-900/30"
                >
                  <Icon name="chart-column" size={16} className="shrink-0 text-zinc-500" />
                  {chancesT("chip", { Topic: chancesT(`Topic.${c.key}`, { name: c.name }), topic: chancesT(`topic.${c.key}`, { name: c.name }) })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>

      {loaded.kind === "cup" ? (
        <CupSimulator cup={loaded.config} data={loaded.data} />
      ) : loaded.data.tournaments && loaded.config.annual ? (
        // Several tournaments a season (Argentina): a switch between them and the annual table.
        <TournamentSwitch
          league={{ ...loaded.config, annual: loaded.config.annual }}
          teams={leagueTeams}
          tournaments={loaded.data.tournaments}
          current={loaded.data.tournaments.find((x) => x.seasonKey === loaded.data.seasonKey)?.id ?? loaded.data.tournaments[0]!.id}
          {...(loaded.data.groups ? { groups: loaded.data.groups } : {})}
          {...(priorStrengths ? { priorStrengths } : {})}
          {...(matchParams ? { matchParams } : {})}
          {...(loaded.data.deductions ? { deductions: loaded.data.deductions } : {})}
          {...(pastWinners ? { pastWinners } : {})}
          {...(loaded.config.promotionPath && loaded.data.seasonYear !== undefined ? { seasonYear: loaded.data.seasonYear } : {})}
          {...(loaded.data.promotionGames ? { promotionGames: loaded.data.promotionGames } : {})}
        />
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
          {...(matchParams ? { matchParams } : {})}
          {...(external ? { externalSeeds: external.rows } : {})}
          {...(loaded.data.deductions ? { deductions: loaded.data.deductions } : {})}
          {...(loaded.data.firstPhaseIds ? { firstPhaseIds: loaded.data.firstPhaseIds } : {})}
          {...(loaded.data.fallbackOrder ? { fallbackOrder: loaded.data.fallbackOrder } : {})}
          {...(pastWinners ? { pastWinners } : {})}
        />
      )}

      {loaded.kind === "league" && hasClubPages(loaded.config) && <ProjectedSection league={loaded.config} data={loaded.data} locale={locale as SiteLocale} />}

      {/* A reserved ad placement, below the simulator: nothing unless the slots are turned on (src/lib/adSlots.ts). */}
      <AdSlot kind="inContent" />

      {loaded.kind === "league" && <LeagueFactsSection league={loaded.config} locale={locale as SiteLocale} />}

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
        </section>
        <Faq title={seo("faqTitle")} items={faq} />
      </div>
    </div>
  );
}
