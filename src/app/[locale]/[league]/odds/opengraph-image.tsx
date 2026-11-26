import { oddsCardImage } from "../../../../lib/oddsCard.tsx";
import { OG_SIZE } from "../../../../lib/ogImage.tsx";
import { timedCard } from "../../../../lib/cardPerf.ts";

export const alt = "FootSimu odds report";
export const size = OG_SIZE;
export const contentType = "image/png";

/** The latest report's card. */
async function drawImage({ params }: { params: Promise<{ locale: string; league: string }> }) {
  const { locale, league } = await params;
  return oddsCardImage(locale, league);
}

/** The card, with its [perf] line (src/lib/cardPerf.ts). */
export default async function Image(props: { params: Promise<{ locale: string; league: string }> }) {
  const p = await props.params;
  return timedCard("odds", p.locale, p.league, () => drawImage(props));
}
