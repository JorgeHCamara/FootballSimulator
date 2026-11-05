import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { OddsReportView } from "../../../../components/OddsReportView.tsx";
import { reportMetadata } from "../../../../lib/oddsText.ts";
import { loadReport } from "../../../../lib/oddsPage.ts";
import { OG_LOCALE, SITE_NAME, alternates } from "../../../../lib/site.ts";

/** The latest round's report; it changes when a new round's snapshot is deployed, the results in its sentences hourly. */
export const revalidate = 3600;

type Params = Promise<{ locale: string; league: string }>;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league } = await params;
  const loaded = await loadReport(league);
  if (!loaded) return {};
  const { title, description, path } = await reportMetadata(loaded, locale, true);
  return {
    title,
    description,
    alternates: alternates(locale, path),
    openGraph: { type: "article", siteName: SITE_NAME, title, description, url: `/${locale}${path}`, locale: OG_LOCALE[locale], publishedTime: loaded.report.snapshot.date },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** A league's latest "what changed" report, with links to every earlier one. */
export default async function LatestOddsPage({ params }: { params: Params }) {
  const { locale, league } = await params;
  setRequestLocale(locale);
  const loaded = await loadReport(league);
  if (!loaded) notFound();
  return <OddsReportView loaded={loaded} locale={locale} />;
}
