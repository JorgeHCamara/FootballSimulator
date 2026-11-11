import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";
import { LEAGUES, type LeagueConfig } from "../../../../config/leagues.ts";
import { hasClubPages } from "../../../../lib/clubs.ts";
import { freshLeagueData, getLeagueData } from "../../../../lib/leagueData.ts";
import { fetchEspnDays } from "../../../../lib/espn.ts";
import { activeSpan, authorized, refreshPlan, refreshReason, scoreboardVerdict, type CheckWhy, type RefreshReason } from "../../../../lib/leagueRefresh.ts";
import { archiveTag } from "../../../../lib/archiveTag.ts";
import { parsePublications, publicationState, publishedSource, publishedTag, type PublicationState } from "../../../../lib/publishedData.ts";
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
  if (archive) {
    const wanted = archive.toUpperCase().split(",").map((c) => c.trim());
    const codes = LEAGUES.filter((l) => hasClubPages(l) && (wanted.includes("ALL") || wanted.includes(l.code))).map((l) => l.code);
    for (const code of codes) revalidateTag(archiveTag(code), { expire: 0 });
    return Response.json({ archive: codes }, noStore);
  }

  const publish = params.get("publish");
  if (publish) {
    const source = publishedSource();
    const files = await Promise.all(parsePublications(publish).map(async (p) => ({ ...p, state: await publicationState(p, source) })));
    for (const { kind, code, state } of files) {
      if (state !== "published") continue;
      revalidateTag(publishedTag(kind, code), { expire: 0 });
      if (kind === "snapshots") revalidateTag(archiveTag(code), { expire: 0 });
    }
    const named = (state: PublicationState) => files.filter((f) => f.state === state).map((f) => `${f.kind}:${f.code}`);
    return Response.json({ published: named("published"), pending: named("pending"), unavailable: named("unavailable"), source: source?.base ?? null }, noStore);
  }

  const only = params.get("league")?.toUpperCase();
  const full = params.get("full") === "1";
  const leagues = LEAGUES.filter((l) => hasClubPages(l) && (!only || l.code === only));
  const now = Date.now();
  const results: { league: string; reason: RefreshReason; why: CheckWhy; via?: "scoreboard" | "season" }[] = [];
  const check = async (league: LeagueConfig) => {
    const cached = await getLeagueData(league).catch(() => undefined);
    const plan = refreshPlan(league, cached, now, full || Boolean(only));
    if (!plan.check) {
      results.push({ league: league.code, reason: plan.why === "own-data" ? "unchanged" : "skipped", why: plan.why });
      return;
    }
    // A game near, nothing else due: the small feed first. Only "the same games, times and results" ends the
    // check here; a difference, or a feed that can't be read, goes on to the season's download on this same run.
    if (plan.scoreboardFirst && cached && league.espn) {
      const span = activeSpan(now);
      const events = await fetchEspnDays(league.espn.slug, span.from, span.to, { cache: "no-store" }).catch((error: unknown) => {
        console.warn(`${league.code}: no ESPN scoreboard, checking the season:`, error);
        return undefined;
      });
      if (events && scoreboardVerdict(cached, events, now, league.espn.resultsStand) === "same") {
        results.push({ league: league.code, reason: "unchanged", why: plan.why, via: "scoreboard" });
        return;
      }
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
    results.push({ league: league.code, reason, why: plan.why, via: "season" });
  };
  for (let i = 0; i < leagues.length; i += AT_ONCE) await Promise.all(leagues.slice(i, i + AT_ONCE).map(check));
  const refreshed = results.filter((r) => r.reason === "changed").map((r) => r.league);
  // `fetched`: seasons downloaded; `scoreboards`: leagues the small feed cleared on its own.
  const fetched = results.filter((r) => r.via === "season").length;
  const scoreboards = results.filter((r) => r.via === "scoreboard").length;
  return Response.json({ checked: results.length, fetched, scoreboards, refreshed, results }, noStore);
}
