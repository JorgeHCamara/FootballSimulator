import { getTranslations } from "next-intl/server";
import { getLeagueBySlug, type SiteLocale, type ZoneKind } from "../../../../../config/leagues.ts";
import { OG_SIZE } from "../../../../../lib/ogImage.tsx";
import { scenarioOutcome, SCENARIO_ITERATIONS } from "../../../../../lib/scenario.ts";
import { renderGenericShareCard, renderShareCard } from "../../../../../lib/shareCard.tsx";
import { loadSharedScenario } from "../../../../../lib/sharedScenario.ts";

export const alt = "Foot Simu prediction";
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
  const shared = await loadSharedScenario(slug, code).catch(() => undefined);
  const league = shared?.league ?? getLeagueBySlug(slug);
  const season = shared?.data.season ?? "";
  const outcome = shared?.predictions ? scenarioOutcome(shared.league, shared.data, shared.predictions) : null;
  if (!shared || !outcome) {
    return renderGenericShareCard({
      title: league ? t("genericTitle", { league: league.name, season }).trim() : "Foot Simu",
      subtitle: t("genericSubtitle"),
      cta: t("cta"),
    });
  }
  const teams = new Map(shared.data.teams.map((team) => [team.id, team]));
  const percentFormat = new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 });
  const percent = (share: number) => (share > 0 && share < 0.01 ? "<1%" : share > 0.99 && share < 1 ? ">99%" : percentFormat.format(share));
  const { headline } = outcome;
  const team = teams.get(headline.teamId)?.name ?? "";
  const zones = Object.fromEntries(
    (["title", ...outcome.places.map((z) => z.kind)] as ZoneKind[]).map((kind) => [kind, tz(kind)]),
  ) as Partial<Record<ZoneKind, string>>;
  return renderShareCard({
    league: shared.league,
    outcome,
    teams,
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
      columns: { position: t("position"), team: t("team"), points: t("points"), chance: t("chance") },
      zones,
      percent,
    },
  });
}
