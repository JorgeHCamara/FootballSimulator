import { getTranslations } from "next-intl/server";
import { routing } from "../../i18n/routing.ts";
import { OG_SIZE, renderOgImage } from "../../lib/ogImage.tsx";

export const alt = "FootSimu – Football Simulator";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Drawn at build time, one per language: served as a file, never by a function. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const home = await getTranslations({ locale, namespace: "Home" });
  const meta = await getTranslations({ locale, namespace: "Metadata" });
  return renderOgImage({ title: home("heading"), subtitle: meta("ogTagline") });
}
