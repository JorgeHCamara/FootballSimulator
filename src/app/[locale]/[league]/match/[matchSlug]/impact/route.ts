import { getTranslations } from "next-intl/server";
import type { SiteLocale } from "../../../../../../config/leagues.ts";
import { impactView } from "../../../../../../lib/matchImpact.ts";
import { loadMatch } from "../../../../../../lib/matchPreview.ts";

/** Three season simulations on a first request. */
export const maxDuration = 60;

/**
 * A match page's "What this result means" (see impactView), as JSON: the
 * page loads without it and fetches it here. The CDN keeps it ten minutes,
 * as long as a match-day page.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; league: string; matchSlug: string }> }) {
  const { locale, league, matchSlug } = await params;
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const loaded = await loadMatch(league, matchSlug).catch(() => undefined);
  if (!loaded || "moved" in loaded) return Response.json(null, { status: 404 });
  const [t, tz] = await Promise.all([getTranslations({ locale: lang, namespace: "Match" }), getTranslations({ locale: lang, namespace: "Zones" })]);
  const view = impactView(loaded, lang, t as never, tz as never);
  return Response.json(view, { headers: { "Cache-Control": "public, max-age=0, s-maxage=600, stale-while-revalidate=86400", "X-Robots-Tag": "noindex" } });
}
