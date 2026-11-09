import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { LEAGUES, type LeagueConfig } from "../../../../config/leagues.ts";
import { hasClubPages } from "../../../../lib/clubs.ts";
import { freshLeagueData, getLeagueData } from "../../../../lib/leagueData.ts";
import { authorized, refreshPlan, refreshReason, type CheckWhy, type RefreshReason } from "../../../../lib/leagueRefresh.ts";
import { archiveTag } from "../../../../lib/archiveTag.ts";
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
 * visit. Called every 30 minutes by .github/workflows/revalidate-leagues.yml;
 * only with the REVALIDATE_TOKEN the site is configured with (404 when it has
 * none).
 *
 * Only the leagues that need it are checked against ESPN on a run (refreshPlan:
 * a game near, under way or just over, the league's periodic turn, or a cached
 * copy missing or not ESPN's); the others are "skipped". `?full=1` checks every
 * league, `?league=PL` that one, whatever the plan.
 *
 * `?archive=PL` (a list, or `all`) instead expires those leagues' past-round
 * odds reports (src/lib/oddsArchive.ts): their entries are worked out again,
 * and their pages rebuilt, on their next visit. For a correction their
 * snapshots don't carry.
 */
export async function GET(request: NextRequest) {
  const token = process.env.REVALIDATE_TOKEN;
  if (!token) return Response.json({ error: "not configured" }, { status: 404 });
  if (!authorized(request.headers.get("authorization"), token)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const noStore = { headers: { "Cache-Control": "no-store" } };

  const archive = params.get("archive");
  if (archive) {
    const wanted = archive.toUpperCase().split(",").map((c) => c.trim());
    const codes = LEAGUES.filter((l) => hasClubPages(l) && (wanted.includes("ALL") || wanted.includes(l.code))).map((l) => l.code);
    for (const code of codes) revalidateTag(archiveTag(code), { expire: 0 });
    return Response.json({ archive: codes }, noStore);
  }

  const only = params.get("league")?.toUpperCase();
  const full = params.get("full") === "1";
  const leagues = LEAGUES.filter((l) => hasClubPages(l) && (!only || l.code === only));
  const now = Date.now();
  const results: { league: string; reason: RefreshReason; why: CheckWhy }[] = [];
  const check = async (league: LeagueConfig) => {
    const cached = await getLeagueData(league).catch(() => undefined);
    const plan = refreshPlan(league, cached, now, full || Boolean(only));
    if (!plan.check) {
      results.push({ league: league.code, reason: plan.why === "own-data" ? "unchanged" : "skipped", why: plan.why });
      return;
    }
    const fresh = await freshLeagueData(league);
    const reason = refreshReason(cached, fresh);
    if (reason === "changed") {
      // Expired at once, not served stale while it refreshes: a page rebuilt from a stale copy of the league's
      // data would keep the old results for hours (the copy and the pages are kept that long, see keptEspn).
      // The next visit to each page waits for its rebuild instead. Next's advice for an invalidation from
      // outside a Server Action (a webhook, a cron job).
      revalidateTag(dataTag(league.code), { expire: 0 });
      revalidateTag(outlookTag(league.code), { expire: 0 });
    }
    results.push({ league: league.code, reason, why: plan.why });
  };
  for (let i = 0; i < leagues.length; i += AT_ONCE) await Promise.all(leagues.slice(i, i + AT_ONCE).map(check));
  const refreshed = results.filter((r) => r.reason === "changed").map((r) => r.league);
  const fetched = results.filter((r) => r.reason !== "skipped" && r.why !== "own-data").length;
  return Response.json({ checked: results.length, fetched, refreshed, results }, noStore);
}
