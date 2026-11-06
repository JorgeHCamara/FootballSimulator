import { oddsCardImage } from "../../../../lib/oddsCard.tsx";
import { OG_SIZE } from "../../../../lib/ogImage.tsx";

export const alt = "FootSimu odds report";
export const size = OG_SIZE;
export const contentType = "image/png";

/** The latest report's card. */
export default async function Image({ params }: { params: Promise<{ locale: string; league: string }> }) {
  const { locale, league } = await params;
  return oddsCardImage(locale, league);
}
