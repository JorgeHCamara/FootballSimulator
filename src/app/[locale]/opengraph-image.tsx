import { getTranslations } from "next-intl/server";
import { routing } from "../../i18n/routing.ts";
import { OG_SIZE, renderOgImage } from "../../lib/ogImage.tsx";
import { timedCard } from "../../lib/cardPerf.ts";

export const alt = "FootSimu – Football Simulator";
export const size = OG_SIZE;
export const contentType = "image/png";

/** Drawn at build time, one per language: served as a file, never by a function. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

async function drawImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const home = await getTranslations({ locale, namespace: "Home" });
  const meta = await getTranslations({ locale, namespace: "Metadata" });
  return renderOgImage({ title: home("heading"), subtitle: meta("ogTagline") });
}

/** The card, with its [perf] line (src/lib/cardPerf.ts). */
export default async function Image(props: { params: Promise<{ locale: string }> }) {
  const p = await props.params;
  return timedCard("home", p.locale, `home`, () => drawImage(props));
}
