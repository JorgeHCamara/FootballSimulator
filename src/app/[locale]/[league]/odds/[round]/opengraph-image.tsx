import { oddsCardImage } from "../../../../../lib/oddsCard.tsx";
import { roundFromParam } from "../../../../../lib/oddsReports.ts";
import { OG_SIZE } from "../../../../../lib/ogImage.tsx";
import { timedCard } from "../../../../../lib/cardPerf.ts";

export const alt = "FootSimu odds report";
export const size = OG_SIZE;
export const contentType = "image/png";

/** A round's report card: the race after it, the top five with their changes. */
async function drawImage({ params }: { params: Promise<{ locale: string; league: string; round: string }> }) {
  const { locale, league, round } = await params;
  return oddsCardImage(locale, league, roundFromParam(round) ?? -1);
}

/** The card, with its [perf] line (src/lib/cardPerf.ts). */
export default async function Image(props: { params: Promise<{ locale: string; league: string; round: string }> }) {
  const p = await props.params;
  return timedCard("odds-round", p.locale, `${p.league}/${p.round}`, () => drawImage(props));
}
