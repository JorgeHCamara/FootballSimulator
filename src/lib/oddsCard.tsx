import { getLeagueBySlug, type SiteLocale } from "../config/leagues.ts";
import { dateLocale, reportText } from "./oddsText.ts";
import { percent } from "./clubText.ts";
import { loadReport } from "./oddsPage.ts";
import { crestDataUri, renderGenericShareCard, renderOddsCard } from "./shareCard.tsx";
import { getTranslations } from "next-intl/server";

/** A report's card (its latest without `round`): the race after the round, the top five with their changes. */
export async function oddsCardImage(locale: string, leagueSlug: string, round?: number) {
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const loaded = await loadReport(leagueSlug, round).catch(() => undefined);
  if (!loaded) {
    const ts = await getTranslations({ locale: lang, namespace: "ShareCard" });
    return renderGenericShareCard({ title: getLeagueBySlug(leagueSlug)?.name ?? "Foot Simu", subtitle: ts("genericSubtitle"), cta: ts("cta") });
  }
  const { t, race, round: roundName, season, count } = await reportText(loaded, lang);
  const { report, teams, league } = loaded;
  const raceName = race(report.lead);
  const rows = await Promise.all(
    report.race.series.map(async (s) => {
      const team = teams.get(s.teamId);
      const change = report.rows.find((r) => r.teamId === s.teamId)?.values[report.lead.kind];
      const crest = await crestDataUri(team?.crest);
      return {
        name: team?.shortName ?? "",
        tla: team?.tla ?? "",
        ...(crest ? { crest } : {}),
        value: percent(change?.now ?? 0, lang),
        ...(change?.delta ? { delta: { text: t("deltaPoints", { sign: change.delta > 0 ? "+" : "−", n: Math.abs(change.delta) }), up: change.delta > 0, good: report.lead.kind === "relegation" ? change.delta < 0 : change.delta > 0 } } : {}),
      };
    }),
  );
  const date = new Intl.DateTimeFormat(dateLocale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${report.snapshot.date}T12:00:00Z`));
  return renderOddsCard({
    pill: `${league.name} ${season}`.toUpperCase(),
    title: t("card.title", { race: raceName.charAt(0).toUpperCase() + raceName.slice(1), round: roundName }),
    date: t("asOf", { date }),
    rows,
    basedOn: t("card.basedOn", { count }),
    cta: t("card.cta"),
  });
}
