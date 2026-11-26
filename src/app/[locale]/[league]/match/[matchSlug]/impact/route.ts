import { unstable_cache } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { SiteLocale } from "../../../../../../config/leagues.ts";
import { dataVersion } from "../../../../../../lib/clubOutlook.ts";
import { IMPACT_KEEP_SECONDS, IMPACT_MISSING_CACHE_CONTROL, impactCacheControl, impactKeyFor, xgFingerprint } from "../../../../../../lib/impactCache.ts";
import { impactNumbers, impactPossible, impactView } from "../../../../../../lib/matchImpact.ts";
import { locateMatch } from "../../../../../../lib/matchPreview.ts";
import { isBot, perfLog, since } from "../../../../../../lib/perfLog.ts";

/** Three season simulations on a first request. */
export const maxDuration = 60;

/**
 * Kept by the CDN by the game's kick-off (impactCacheControl): three hours within 48 hours of it, up to a day
 * further off. The URL has its language, so each language is its own CDN entry.
 */
const headersFor = (kickoff: string) => ({ "Cache-Control": impactCacheControl(kickoff), "X-Robots-Tag": "noindex" });
const MISSING = { "Cache-Control": IMPACT_MISSING_CACHE_CONTROL, "X-Robots-Tag": "noindex" };

/**
 * A match page's "What this result means" (see impactView), as JSON: the page
 * loads without it and fetches it here. 404 for an unknown or moved game,
 * null for a game without it (played, called off, last season's).
 */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string; league: string; matchSlug: string }> }) {
  const { locale, league, matchSlug } = await params;
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const found = await locateMatch(league, matchSlug).catch(() => undefined);
  if (!found || "moved" in found) return Response.json(null, { status: 404, headers: MISSING });
  const headers = headersFor(found.match.fixture.utcDate);
  if (!impactPossible(found)) return Response.json(null, { headers });
  // The numbers, once per game whatever the language: kept in Next's data cache by what they depend on (impactKeyFor).
  const { key, far } = impactKeyFor({ league: found.league.code, slug: matchSlug, kickoff: found.match.fixture.utcDate }, () => ({ dataVersion: dataVersion(found.data), xg: xgFingerprint(found.data.xg) }));
  const start = performance.now();
  let simMs: number | undefined;
  const numbers = await unstable_cache(
    async () => {
      const t0 = performance.now();
      const result = impactNumbers(found);
      simMs = since(t0);
      return result;
    },
    key,
    { revalidate: IMPACT_KEEP_SECONDS },
  )();
  perfLog({ op: "match-impact", key: `${league}/${matchSlug}`, ms: since(start), cache: simMs === undefined ? "hit" : "miss", locale: lang, far, ...(simMs !== undefined ? { simMs } : {}), bot: isBot(request.headers.get("user-agent")) });
  if (!numbers) return Response.json(null, { headers });
  const [t, tz] = await Promise.all([getTranslations({ locale: lang, namespace: "Match" }), getTranslations({ locale: lang, namespace: "Zones" })]);
  return Response.json(impactView(found.match, numbers, lang, t as never, tz as never), { headers });
}
