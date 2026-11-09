import { getTranslations } from "next-intl/server";
import { getLeagueBySlug, type SiteLocale, type ZoneKind } from "../../../../../config/leagues.ts";
import type { TeamId } from "../../../../../engine/types.ts";
import { crestsDrawn } from "../../../../../lib/cardCache.ts";
import { firstCardThatRenders } from "../../../../../lib/cardFallback.ts";
import { OG_SIZE } from "../../../../../lib/ogImage.tsx";
import { cardRows, scenarioOutcome, SCENARIO_ITERATIONS } from "../../../../../lib/scenario.ts";
import { crestDataUri, renderGenericShareCard, renderShareCard } from "../../../../../lib/shareCard.tsx";
import { loadSharedScenario } from "../../../../../lib/sharedScenario.ts";

export const alt = "FootSimu prediction";
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * The share card: the predicted final table from the scenario in the link
 * (nothing is stored), or a branded card for the league when the link holds
 * no readable scenario.
 */
export default async function Image({ params }: { params: Promise<{ locale: string; league: string; code: string }> }) {
  const { locale, league: slug, code } = await params;
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const [t, tz] = await Promise.all([getTranslations({ locale: lang, namespace: "ShareCard" }), getTranslations({ locale: lang, namespace: "Zones" })]);
  // A scenario that couldn't be loaded (as opposed to a link that holds none): its branded card is a stand-in, kept briefly.
  let failed = false;
  const shared = await loadSharedScenario(slug, code).catch(() => {
    failed = true;
    return undefined;
  });
  const league = shared?.league ?? getLeagueBySlug(slug);
  const season = shared?.data.season ?? "";
  const outcome = shared?.predictions ? scenarioOutcome(shared.league, shared.data, shared.predictions) : null;
  const generic = () =>
    renderGenericShareCard({
      title: league ? t("genericTitle", { league: league.name, season }).trim() : "FootSimu",
      subtitle: t("genericSubtitle"),
      cta: t("cta"),
    }, failed ? "brief" : "final");
  if (!shared || !outcome) return firstCardThatRenders([generic]);
  const teams = new Map(shared.data.teams.map((team) => [team.id, team]));
  const percentFormat = new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 });
  const percent = (share: number) => (share > 0 && share < 0.01 ? "<1%" : share > 0.99 && share < 1 ? ">99%" : percentFormat.format(share));
  const { headline } = outcome;
  const team = teams.get(headline.teamId)?.name ?? "";
  const zones = Object.fromEntries(
    (["title", ...outcome.places.map((z) => z.kind)] as ZoneKind[]).map((kind) => [kind, tz(kind)]),
  ) as Partial<Record<ZoneKind, string>>;
  // Each row's crest beside its name (one that fails or takes too long: none; crestDataUri never throws).
  const crests = new Map<TeamId, string>();
  await Promise.all(
    cardRows(outcome.rows).map(async (row) => {
      if (row === "gap") return;
      const crest = await crestDataUri(teams.get(row.teamId)?.crest);
      if (crest) crests.set(row.teamId, crest);
    }),
  );
  const card = (withCrests: boolean) => renderShareCard({
    league: shared.league,
    outcome,
    teams,
    ...(withCrests ? { crests } : {}),
    // Every crest on it, or kept only briefly.
    cache: crestsDrawn(cardRows(outcome.rows).flatMap((row) => (row === "gap" ? [] : [[teams.get(row.teamId)?.crest, crests.get(row.teamId)] as const]))) ? "final" : "brief",
    text: {
      pill: `${shared.league.name} ${season}`.toUpperCase(),
      myPrediction: t("myPrediction"),
      headline: t(headline.kind === "relegated" ? "relegated" : headline.kind === "top" ? "top" : "champions", { team }),
      // A chance only while some games are still to play.
      ...(!outcome.complete
        ? { badge: t(headline.kind === "relegated" ? "relegationChance" : headline.kind === "top" ? "topChance" : "titleChance", { pct: percent(headline.chance) }) }
        : {}),
      basedOn: t("basedOn", { count: new Intl.NumberFormat(lang).format(SCENARIO_ITERATIONS) }),
      cta: t("cta"),
      columns: { position: t("position"), team: t("team"), points: t("points") },
      zones,
    },
  });
  // With the crests; if one can't be drawn, names only; then the branded card.
  return firstCardThatRenders([() => card(true), () => card(false), generic]);
}
