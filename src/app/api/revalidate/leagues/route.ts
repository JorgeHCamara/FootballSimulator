import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { authorized } from "../../../../lib/leagueRefresh.ts";
import { announcePublications, expireArchives, refreshLeagues } from "../../../../lib/refreshRun.ts";

/** Every domestic league's ESPN data, a few leagues at a time. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Expired at once, not served stale (see refreshLeagues in src/lib/refreshRun.ts). */
const expire = (tag: string) => revalidateTag(tag, { expire: 0 });

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
 * copy missing or not ESPN's); the others are "skipped". A league with a game
 * near is checked with the small scoreboard feed first ("via": "scoreboard")
 * and its season downloaded only when that differs ("via": "season"; see
 * scoreboardVerdict). `?full=1` checks every league's season, `?league=PL`
 * that one's, whatever the plan.
 *
 * `?archive=PL` (a list, or `all`) instead expires those leagues' past-round
 * odds reports (src/lib/oddsArchive.ts): their entries are worked out again,
 * and their pages rebuilt, on their next visit. For a correction their
 * snapshots don't carry.
 *
 * `?publish=snapshots:PL:<sha256>,xg:PL:<sha256>` instead announces files the
 * daily job has just committed to main (src/lib/publishedData.ts; the site
 * isn't deployed for them). Each file is first checked at the source by its
 * fingerprint ("pending" while GitHub still serves the last version: the job
 * asks again), then:
 * - new snapshots: the league's snapshots entry and the pages that read it
 *   (its latest report, its past rounds, the reports' hub, the sitemap) and
 *   its archive tag. Not its league, club or match pages;
 * - new xG: the league's xG entry and, with it, every page built from the
 *   league's data where its ratings use xG (they're tagged with it, see
 *   readXg), so their chances are worked out again from the new xG: the run
 *   is keyed by the xG it used (dataVersion), never expired by hand.
 * No other league is touched, and no ESPN data is read.
 */
export async function GET(request: NextRequest) {
  const token = process.env.REVALIDATE_TOKEN;
  if (!token) return Response.json({ error: "not configured" }, { status: 404 });
  if (!authorized(request.headers.get("authorization"), token)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const noStore = { headers: { "Cache-Control": "no-store" } };

  const archive = params.get("archive");
  if (archive) return Response.json({ archive: expireArchives(archive, expire) }, noStore);

  const publish = params.get("publish");
  if (publish) return Response.json(await announcePublications(publish, { expire }), noStore);

  const only = params.get("league")?.toUpperCase();
  return Response.json(await refreshLeagues({ ...(only ? { only } : {}), full: params.get("full") === "1" }, { expire }), noStore);
}
