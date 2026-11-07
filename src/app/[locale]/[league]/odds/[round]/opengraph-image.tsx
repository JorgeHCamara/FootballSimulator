import { oddsCardImage } from "../../../../../lib/oddsCard.tsx";
import { roundFromParam } from "../../../../../lib/oddsReports.ts";
import { OG_SIZE } from "../../../../../lib/ogImage.tsx";

export const alt = "FootSimu odds report";
export const size = OG_SIZE;
export const contentType = "image/png";

/** A round's report card: the race after it, the top five with their changes. */
export default async function Image({ params }: { params: Promise<{ locale: string; league: string; round: string }> }) {
  const { locale, league, round } = await params;
  return oddsCardImage(locale, league, roundFromParam(round) ?? -1);
}
