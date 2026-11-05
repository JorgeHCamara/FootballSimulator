import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { OddsReportView } from "../../../../../components/OddsReportView.tsx";
import { reportMetadata } from "../../../../../lib/oddsText.ts";
import { loadReport } from "../../../../../lib/oddsPage.ts";
import { roundFromParam } from "../../../../../lib/oddsReports.ts";
import { OG_LOCALE, SITE_NAME, alternates } from "../../../../../lib/site.ts";

/** A round's report doesn't change once its snapshot is in; the results in its sentences come from the hourly league data. */
export const revalidate = 3600;

type Params = Promise<{ locale: string; league: string; round: string }>;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league, round } = await params;
  const n = roundFromParam(round);
  const loaded = n === undefined ? undefined : await loadReport(league, n);
  if (!loaded) return {};
  const { title, description, path, indexable } = await reportMetadata(loaded, locale, false);
  return {
    title,
    description,
    alternates: alternates(locale, path),
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
    openGraph: { type: "article", siteName: SITE_NAME, title, description, url: `/${locale}${path}`, locale: OG_LOCALE[locale], publishedTime: loaded.report.snapshot.date },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** One round's "what changed" report (/{league}/odds/matchday-11). */
export default async function RoundOddsPage({ params }: { params: Params }) {
  const { locale, league, round } = await params;
  setRequestLocale(locale);
  const n = roundFromParam(round);
  const loaded = n === undefined ? undefined : await loadReport(league, n);
  if (!loaded) notFound();
  return <OddsReportView loaded={loaded} locale={locale} />;
}
