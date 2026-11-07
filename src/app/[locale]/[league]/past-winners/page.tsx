import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdSlot } from "../../../../components/AdSlot.ts";
import { Flag } from "../../../../components/Flag.tsx";
import { Icon } from "../../../../components/Icon.tsx";
import { JsonLd } from "../../../../components/JsonLd.tsx";
import { PastWinners } from "../../../../components/PastWinners.tsx";
import { getLeagueBySlug, type SiteLocale } from "../../../../config/leagues.ts";
import { Link } from "../../../../i18n/navigation.ts";
import { routing } from "../../../../i18n/routing.ts";
import { OG_LOCALE, SITE_NAME, SITE_URL, alternates } from "../../../../lib/site.ts";
import type { WinnerRow } from "../../../../lib/winners.ts";
import { historySlugs, leagueWinners, pastWinnersPath } from "../../../../lib/winnersData.ts";

/** Only the leagues with a history file (src/data/history) have this page; it's built from the file, nothing live. */
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => historySlugs().map((league) => ({ locale, league })));
}

type Params = Promise<{ locale: string; league: string }>;
const langOf = (locale: string) => (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;

/** The oldest season played (the page says "since" it). */
const oldest = (rows: WinnerRow[]) => [...rows].reverse().find((r) => r.status === "completed") ?? rows.at(-1)!;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league: slug } = await params;
  const league = getLeagueBySlug(slug);
  const rows = league ? leagueWinners(slug) : undefined;
  if (!league || !rows) return {};
  const t = await getTranslations({ locale, namespace: "PastWinners" });
  const year = String(oldest(rows).startYear);
  const title = t("metaTitle", { league: league.name, year });
  const description = t("metaDescription", { league: league.name, year });
  const path = pastWinnersPath(league);
  return {
    title,
    description,
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
  const league = getLeagueBySlug(slug);
  const rows = league ? leagueWinners(slug) : undefined;
  if (!league || !rows) notFound();
  const lang = langOf(locale);
  const [t, seo, sim] = await Promise.all([getTranslations("PastWinners"), getTranslations("Seo"), getTranslations("Simulator")]);
  const leaguePath = `/${league.slug}`;
  const path = pastWinnersPath(league);
  const pageUrl = `${SITE_URL}/${locale}${path}`;
  const heading = t("heading", { league: league.name });
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
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("intro", { league: league.name, season: oldest(rows).season })}</p>
      </header>

      <div className="flex w-fit rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="tablist">
        <Link href={leaguePath} role="tab" aria-selected={false} className={tab(false)} data-testid="view-table">
          {sim("table")}
        </Link>
        <Link href={`${leaguePath}#chances`} role="tab" aria-selected={false} className={tab(false)} data-testid="view-chances">
          {sim("chances")}
        </Link>
        <span role="tab" aria-selected className={tab(true)} data-testid="past-winners-tab">
          {t("title")}
        </span>
      </div>

      <PastWinners rows={rows} />

      {/* The same reserved placement as the league and club pages: nothing unless the slots are turned on (src/lib/adSlots.ts). */}
      <AdSlot kind="inContent" />
    </div>
  );
}
