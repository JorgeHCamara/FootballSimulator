import { moversCardImage } from "../../../../../../lib/oddsCard.tsx";
import { roundFromParam } from "../../../../../../lib/oddsReports.ts";

/** Room for a cold render (the league's data and crests). */
export const maxDuration = 60;

/**
 * A round's biggest-movers card (1200×630 PNG), beside its report card
 * (opengraph-image): what the "Share the biggest movers" button shares and
 * downloads. Not a page: not in the sitemap.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; league: string; round: string }> }) {
  const { locale, league, round } = await params;
  const n = roundFromParam(round);
  if (n === undefined) return new Response(null, { status: 404 });
  return moversCardImage(locale, league, n);
}
