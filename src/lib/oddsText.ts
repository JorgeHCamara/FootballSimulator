import { getTranslations } from "next-intl/server";
import type { SiteLocale } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import { percent } from "./clubText.ts";
import type { LoadedReport } from "./oddsPage.ts";
import { latestReportPath, reportPath, seasonYearLabel, type Category } from "./oddsReports.ts";

export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** British English dates in English, like the rest of the site. */
export const dateLocale = (lang: SiteLocale) => (lang === "en" ? "en-GB" : lang);

/** The texts every page of a report shares (heading, title, description, card). */
export async function reportText(loaded: LoadedReport, lang: SiteLocale) {
  const [t, tc, tz] = (await Promise.all([
    getTranslations({ locale: lang, namespace: "Odds" }),
    getTranslations({ locale: lang, namespace: "Club" }),
    getTranslations({ locale: lang, namespace: "Zones" }),
  ])) as unknown as [Translate, Translate, Translate];
  const { report, teams, league } = loaded;
  const round = t("round", { n: report.snapshot.round });
  const season = seasonYearLabel(report.season);
  const h1 = t(`h1.${report.lead.kind === "title" ? "title" : report.lead.kind === "playoffs" ? "playoffs" : "other"}`, { league: league.name, round });
  /** A category's name in a sentence: "title", "Champions League", "relegation"… */
  const topic = (c: Category) => (c.kind === "continental" ? tz(c.zone) : tc(`topic.${c.kind}`));
  /** "title race", "Libertadores race"… */
  const race = (c: Category) => t(`race.${c.kind}`, { zone: tz(c.zone) });
  const leader = [...report.rows].sort((a, b) => (b.values[report.lead.kind]?.now ?? 0) - (a.values[report.lead.kind]?.now ?? 0))[0];
  const name = (id: TeamId) => teams.get(id)?.shortName ?? "";
  const count = new Intl.NumberFormat(lang).format(report.snapshot.iterations);
  // The season's first report has nothing to compare with: the chances after the round, no "who rose and who fell".
  const description = t(report.previous ? "description" : "descriptionFirst", {
    league: league.name,
    season,
    round,
    leader: leader ? name(leader.teamId) : "",
    race: race(report.lead),
    leaderPct: leader ? percent(leader.values[report.lead.kind]!.now, lang) : "",
    topics: new Intl.ListFormat(lang === "en" ? "en-GB" : lang, { type: "conjunction" }).format(report.categories.map(topic)),
    count,
  });
  return { t, tc, tz, round, season, h1, topic, race, leader, name, count, description };
}

/** Title, description, canonical and alternates of a report page (the latest-report page has its own title). */
export async function reportMetadata(loaded: LoadedReport, locale: string, latestPage: boolean) {
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const { t, h1, season, round, description } = await reportText(loaded, lang);
  const path = latestPage ? latestReportPath(loaded.league) : reportPath(loaded.league, loaded.report.snapshot.round);
  const title = latestPage ? t("metaTitleLatest", { league: loaded.league.name, round }) : t("metaTitle", { h1, season });
  // The season's first report (no changes to show): the page loads, search engines are pointed at the later ones.
  return { title, description, path, indexable: Boolean(loaded.report.previous) };
}
