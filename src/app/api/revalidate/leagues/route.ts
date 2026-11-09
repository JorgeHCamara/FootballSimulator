import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { LEAGUES, type LeagueConfig } from "../../../../config/leagues.ts";
import { hasClubPages } from "../../../../lib/clubs.ts";
import { freshLeagueData, getLeagueData } from "../../../../lib/leagueData.ts";
import { authorized, refreshReason, type RefreshReason } from "../../../../lib/leagueRefresh.ts";
import { dataTag, outlookTag } from "../../../../lib/sharedOutlook.ts";

/** Every domestic league's ESPN data, a few leagues at a time. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Leagues checked at once (each: the cached copy and one fresh ESPN load). */
const AT_ONCE = 6;

/**
 * Refreshes a league's pages together when its results change (see
 * src/lib/leagueRefresh.ts): for every domestic league (`?league=PL` for one),
 * compares ESPN's data now with the cached copy and, only when it changed,
 * revalidates the league's data and outlook tags, so its league page, club
 * pages and their images are all rebuilt from the new data on their next
 * visit (see src/lib/leagueRefresh.ts). Called every 30 minutes by
 * .github/workflows/revalidate-leagues.yml; only with the REVALIDATE_TOKEN
 * the site is configured with (404 when it has none).
 */
export async function GET(request: NextRequest) {
  const token = process.env.REVALIDATE_TOKEN;
  if (!token) return Response.json({ error: "not configured" }, { status: 404 });
  if (!authorized(request.headers.get("authorization"), token)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const only = request.nextUrl.searchParams.get("league")?.toUpperCase();
  const leagues = LEAGUES.filter((l) => hasClubPages(l) && (!only || l.code === only));
  const results: { league: string; reason: RefreshReason }[] = [];
  const check = async (league: LeagueConfig) => {
    const [cached, fresh] = await Promise.all([getLeagueData(league).catch(() => undefined), freshLeagueData(league)]);
    const reason = refreshReason(cached, fresh);
    if (reason === "changed") {
      // Expired at once, not served stale while it refreshes: a page rebuilt from a stale copy of the league's
      // data would keep the old results for hours (the copy and the pages are kept that long, see keptEspn).
      // The next visit to each page waits for its rebuild instead. Next's advice for an invalidation from
      // outside a Server Action (a webhook, a cron job).
      revalidateTag(dataTag(league.code), { expire: 0 });
      revalidateTag(outlookTag(league.code), { expire: 0 });
    }
    results.push({ league: league.code, reason });
  };
  for (let i = 0; i < leagues.length; i += AT_ONCE) await Promise.all(leagues.slice(i, i + AT_ONCE).map(check));
  const refreshed = results.filter((r) => r.reason === "changed").map((r) => r.league);
  return Response.json({ checked: results.length, refreshed, results }, { headers: { "Cache-Control": "no-store" } });
}
