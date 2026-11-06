import { getTranslations } from "next-intl/server";
import { getLeagueBySlug, type SiteLocale } from "../../../config/leagues.ts";
import { OG_SIZE, renderOgImage } from "../../../lib/ogImage.tsx";

export const alt = "FootSimu league simulator";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string; league: string }> }) {
  const { locale, league: slug } = await params;
  const league = getLeagueBySlug(slug);
  const meta = await getTranslations({ locale, namespace: "Metadata" });
  if (!league) return renderOgImage({ title: "FootSimu", subtitle: meta("ogTagline") });
  return renderOgImage({ title: league.simulatorName[locale as SiteLocale], subtitle: meta("ogTagline"), flag: league.flag });
}
