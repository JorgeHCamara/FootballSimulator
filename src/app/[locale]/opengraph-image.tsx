import { getTranslations } from "next-intl/server";
import { OG_SIZE, renderOgImage } from "../../lib/ogImage.tsx";

export const alt = "Foot Simu – Football Simulator";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const home = await getTranslations({ locale, namespace: "Home" });
  const meta = await getTranslations({ locale, namespace: "Metadata" });
  return renderOgImage({ title: home("heading"), subtitle: meta("ogTagline") });
}
