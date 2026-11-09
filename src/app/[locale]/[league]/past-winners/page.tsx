import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdSlot } from "../../../../components/AdSlot.ts";
import { Flag } from "../../../../components/Flag.tsx";
import { Icon } from "../../../../components/Icon.tsx";
import { JsonLd } from "../../../../components/JsonLd.tsx";
import { PastWinners } from "../../../../components/PastWinners.tsx";
import { CUPS, getCupBySlug } from "../../../../config/cups.ts";
import { getLeagueBySlug, type SiteLocale } from "../../../../config/leagues.ts";
import { Link } from "../../../../i18n/navigation.ts";
import { routing } from "../../../../i18n/routing.ts";
import { OG_LOCALE, SITE_NAME, SITE_URL, alternates } from "../../../../lib/site.ts";
import type { WinnerRow } from "../../../../lib/winners.ts";
import { historySlugs, leagueWinners, pastWinnersPath } from "../../../../lib/winnersData.ts";

/**
 * The leagues with a history file (src/data/history) have this page, built from the file, nothing live; so
 * does every cup, its history still to come (the page says so, and stays out of search results until then).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  // Cups with a page of their own (the Copa Argentina's Past Winners are My World's only, for now).
  const slugs = [...new Set([...historySlugs(), ...CUPS.filter((c) => !c.noPastWinnersPage).map((c) => c.slug)])];
  return routing.locales.flatMap((locale) => slugs.map((league) => ({ locale, league })));
}

/** The competition and its rows: a league with a history file, or a cup (no rows until its file comes). */
function competitionOf(slug: string) {
  const league = getLeagueBySlug(slug);
  const found = league ? undefined : getCupBySlug(slug);
  const cup = found?.noPastWinnersPage ? undefined : found;
  const competition = league ?? cup;
  const rows = leagueWinners(slug) ?? (cup ? [] : undefined);
  return competition && rows ? { competition, rows, cup: Boolean(cup) } : undefined;
}

type Params = Promise<{ locale: string; league: string }>;
const langOf = (locale: string) => (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;

/**
 * The article the league's name takes: none for "La Liga" ("of La Liga", not "of the La Liga") and, in English,
 * "Serie A" (Spanish keeps "de la Serie A"); masculine for the Brasileirão ("do Brasileirão", "del Brasileirão").
 */
const articleOf = (name: string, locale: string) => (/^La /.test(name) || (locale === "en" && /^Serie /.test(name)) ? "none" : /^Brasileirão/.test(name) ? "masc" : "other");

/** The oldest season played (the page says "since" it). */
const oldest = (rows: WinnerRow[]) => [...rows].reverse().find((r) => r.status === "completed") ?? rows.at(-1)!;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league: slug } = await params;
  const found = competitionOf(slug);
  if (!found) return {};
  const { competition: league, rows } = found;
  const t = await getTranslations({ locale, namespace: "PastWinners" });
  const article = articleOf(league.name, locale);
  const title = rows.length > 0 ? t("metaTitle", { league: league.name, article, year: String(oldest(rows).startYear) }) : t("heading", { league: league.name, article });
  const description = rows.length > 0 ? t("metaDescription", { league: league.name, article, year: String(oldest(rows).startYear) }) : t("comingSoon");
  const path = pastWinnersPath(league);
  return {
    title,
    description,
    // No history yet (the cups): out of search results until it comes.
    ...(rows.length === 0 ? { robots: { index: false, follow: true } } : {}),
    alternates: alternates(locale, path),
    // The league's own card (a nested page has none of its own).
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: `/${locale}${path}`, locale: OG_LOCALE[locale], images: [{ url: `/${locale}/${league.slug}/opengraph-image`, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [`/${locale}/${league.slug}/opengraph-image`] },
  };
}

/** "{league} past winners": every season's champion, runner-up and third place, from the league's history file. */
export default async function PastWinnersPage({ params }: { params: Params }) {
  const { locale, league: slug } = await params;
  setRequestLocale(locale);
  const found = competitionOf(slug);
  if (!found) notFound();
  const { competition: league, rows, cup } = found;
  const lang = langOf(locale);
  const [t, seo, sim, tc] = await Promise.all([getTranslations("PastWinners"), getTranslations("Seo"), getTranslations("Simulator"), getTranslations("Cup")]);
  const leaguePath = `/${league.slug}`;
  const path = pastWinnersPath(league);
  const pageUrl = `${SITE_URL}/${locale}${path}`;
  const heading = t("heading", { league: league.name, article: articleOf(league.name, locale) });
  // The league page's view switch, with this view selected: Table and Chances go back to the simulator.
  const tab = (active: boolean) => `rounded-md px-3 py-1.5 text-sm font-semibold ${active ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"}`;

  return (
    <div className="space-y-4" data-testid="past-winners-page" data-league={league.code}>
      <JsonLd
        data={[
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: seo("breadcrumbHome"), item: `${SITE_URL}/${locale}` },
              { "@type": "ListItem", position: 2, name: league.simulatorName[lang], item: `${SITE_URL}/${locale}${leaguePath}` },
              { "@type": "ListItem", position: 3, name: heading, item: pageUrl },
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
        <Icon name="chevron-right" size={12} className="mx-1 shrink-0" />
        <span className="truncate">{t("breadcrumb")}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="flex items-center gap-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
          <Flag code={league.flag} width={36} />
          <span>{heading}</span>
        </h1>
        {rows.length > 0 && (
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("intro", { league: league.name, article: articleOf(league.name, locale), season: oldest(rows).season })}</p>
        )}
      </header>

      <div className="flex w-fit rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="tablist">
        <Link href={leaguePath} role="tab" aria-selected={false} className={tab(false)} data-testid="view-table">
          {cup ? tc("fixtures") : sim("table")}
        </Link>
        <Link href={`${leaguePath}#chances`} role="tab" aria-selected={false} className={tab(false)} data-testid="view-chances">
          {sim("chances")}
        </Link>
        <span role="tab" aria-selected className={tab(true)} data-testid="past-winners-tab">
          {t("title")}
        </span>
      </div>

      <PastWinners rows={rows} comingSoon={rows.length === 0} />

      {/* The same reserved placement as the league and club pages: nothing unless the slots are turned on (src/lib/adSlots.ts). */}
      <AdSlot kind="inContent" />
    </div>
  );
}
