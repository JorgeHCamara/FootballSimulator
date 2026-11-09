import { getTranslations } from "next-intl/server";
import { COMPETITIONS } from "../../../config/competitions.ts";
import { getLeagueBySlug, type SiteLocale } from "../../../config/leagues.ts";
import { routing } from "../../../i18n/routing.ts";
import { OG_SIZE, renderOgImage } from "../../../lib/ogImage.tsx";

export const alt = "FootSimu league simulator";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Drawn at build time, as the league pages are (every language, every league and cup): served as files, never by a function. */
export function generateStaticParams() {
  return routing.locales.flatMap((locale) => COMPETITIONS.map((c) => ({ locale, league: c.slug })));
}

export default async function Image({ params }: { params: Promise<{ locale: string; league: string }> }) {
  const { locale, league: slug } = await params;
  const league = getLeagueBySlug(slug);
  const meta = await getTranslations({ locale, namespace: "Metadata" });
  if (!league) return renderOgImage({ title: "FootSimu", subtitle: meta("ogTagline") });
  return renderOgImage({ title: league.simulatorName[locale as SiteLocale], subtitle: meta("ogTagline"), flag: league.flag });
}
