import { getTranslations } from "next-intl/server";
import type { LeagueConfig, SiteLocale, ZoneKind } from "../config/leagues.ts";
import type { LeagueData } from "../lib/leagueData.ts";
import { dateLocale } from "../lib/oddsText.ts";
import { projectedHistory } from "../lib/projected.ts";
import { ProjectedTable } from "./ProjectedTable.tsx";

/** "Projected final table": the most likely final table now and after each round of the season (domestic leagues). */
export async function ProjectedSection({ league, data, locale }: { league: LeagueConfig; data: LeagueData; locale: SiteLocale }) {
  const history = await projectedHistory(league, data).catch((error: unknown) => {
    console.warn(`${league.code}: no projected table:`, error);
    return undefined;
  });
  if (!history) return null;
  const [t, tOdds, tz] = await Promise.all([getTranslations("Projected"), getTranslations("Odds"), getTranslations("Zones")]);
  const day = new Intl.DateTimeFormat(dateLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" });
  const entryNames = history.entries.map((e) =>
    e.round !== undefined
      ? { full: `${tOdds("round", { n: e.round })}${e.date ? ` · ${day.format(new Date(`${e.date}T12:00:00Z`))}` : ""}`, short: String(e.round) }
      : { full: t("latestPlayed", { n: e.played }), short: t("latestShort") },
  );
  const zones = Object.fromEntries([...new Set(history.zones.map((z) => z.kind))].map((kind) => [kind, tz(kind)])) as Partial<Record<ZoneKind, string>>;
  const tableNames = Object.fromEntries(history.tables.flatMap((x) => (x.name ? [[x.id, x.name[locale]]] : [])));
  const keys = ["previous", "next", "pick", "place", "club", "table", "tableTitle", "points", "pointsTitle", "chance", "chanceTitle", "change", "changeTitle", "up", "down", "same", "historyTitle", "historyNote"] as const;
  // "{n}" stays for the component to fill in.
  const labels = { ...Object.fromEntries(keys.map((k) => [k, k === "up" || k === "down" ? t(k, { n: "{n}" }) : t(k)])), tableNames, zones } as Parameters<typeof ProjectedTable>[0]["labels"];
  return (
    <section className="space-y-3 pt-4" data-testid="projected">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">{t(history.scope === "annual" ? "titleAnnual" : "title")}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("intro", { count: new Intl.NumberFormat(locale).format(history.iterations) })}</p>
      </div>
      <ProjectedTable history={history} teams={data.teams} entryNames={entryNames} labels={labels} locale={locale} />
    </section>
  );
}
