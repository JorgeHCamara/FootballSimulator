import { unstable_cache } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { SiteLocale } from "../../../../../../config/leagues.ts";
import { dataVersion } from "../../../../../../lib/clubOutlook.ts";
import { impactNumbers, impactPossible, impactView } from "../../../../../../lib/matchImpact.ts";
import { loadMatch, locateMatch } from "../../../../../../lib/matchPreview.ts";

/** Three season simulations on a first request. */
export const maxDuration = 60;

/** The match page's own refresh (seconds): the CDN keeps the section as long. */
const KEEP = 10800;
const HEADERS = { "Cache-Control": `public, max-age=0, s-maxage=${KEEP}, stale-while-revalidate=86400`, "X-Robots-Tag": "noindex" };

/**
 * The numbers, once per game whatever the language: kept in Next's data cache
 * by league, game and the league's data version (a new result or a moved game
 * makes another one), and by deployment, since a deploy can change the model
 * (the cache outlives deployments).
 */
const cachedNumbers = unstable_cache(
  async (leagueSlug: string, matchSlug: string, _version: string, _deployment: string) => {
    const loaded = await loadMatch(leagueSlug, matchSlug);
    return loaded && !("moved" in loaded) ? impactNumbers(loaded) : null;
  },
  ["match-impact"],
  { revalidate: KEEP },
);

const DEPLOYMENT = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

/**
 * A match page's "What this result means" (see impactView), as JSON: the page
 * loads without it and fetches it here. 404 for an unknown or moved game,
 * null for a game without it (played, called off, last season's).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; league: string; matchSlug: string }> }) {
  const { locale, league, matchSlug } = await params;
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const found = await locateMatch(league, matchSlug).catch(() => undefined);
  if (!found || "moved" in found) return Response.json(null, { status: 404 });
  if (!impactPossible(found)) return Response.json(null, { headers: HEADERS });
  const numbers = await cachedNumbers(league, matchSlug, dataVersion(found.data), DEPLOYMENT);
  if (!numbers) return Response.json(null, { headers: HEADERS });
  const [t, tz] = await Promise.all([getTranslations({ locale: lang, namespace: "Match" }), getTranslations({ locale: lang, namespace: "Zones" })]);
  return Response.json(impactView(found.match, numbers, lang, t as never, tz as never), { headers: HEADERS });
}
