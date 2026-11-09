import { getTranslations } from "next-intl/server";
import { zoneHex } from "../components/zones.ts";
import { getLeagueBySlug, type SiteLocale } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import { type CardCache, crestsDrawn } from "./cardCache.ts";
import { firstCardThatRenders } from "./cardFallback.ts";
import { percent } from "./clubText.ts";
import { loadReport, type LoadedReport } from "./oddsPage.ts";
import { moversCardSections, type Category, type Change } from "./oddsReports.ts";
import { dateLocale, reportText } from "./oddsText.ts";
import { crestDataUri, renderGenericShareCard, renderMoversCard, renderOddsCard, type MoverCardRow } from "./shareCard.tsx";

/**
 * A report's card (its latest without `round`): the race after the round, the
 * top five with their changes. A round's report never changes after it
 * ("final"); the latest moves on with the next round ("live").
 */
export async function oddsCardImage(locale: string, leagueSlug: string, round?: number) {
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const generic = async () => {
    const ts = await getTranslations({ locale: lang, namespace: "ShareCard" });
    // A stand-in (no such report, or not loaded): kept briefly.
    return renderGenericShareCard({ title: getLeagueBySlug(leagueSlug)?.name ?? "FootSimu", subtitle: ts("genericSubtitle"), cta: ts("cta") }, "brief");
  };
  const loaded = await loadReport(leagueSlug, round).catch(() => undefined);
  if (!loaded) return firstCardThatRenders([generic]);
  // With the crests; if that fails (a crest that can't be drawn), with the clubs' initials; then the branded card.
  const cache: CardCache = round === undefined ? "live" : "final";
  return firstCardThatRenders([() => reportCard(loaded, lang, true, cache), () => reportCard(loaded, lang, false, cache), generic]);
}

async function reportCard(loaded: LoadedReport, lang: SiteLocale, withCrests: boolean, cache: CardCache) {
  const { t, race, round: roundName, season, count } = await reportText(loaded, lang);
  const { report, teams, league } = loaded;
  const raceName = race(report.lead);
  // Each crest asked for, drawn or not: a card missing one is kept only briefly.
  const crests: [string | undefined, string | undefined][] = [];
  const rows = await Promise.all(
    report.race.series.map(async (s) => {
      const team = teams.get(s.teamId);
      const change = report.rows.find((r) => r.teamId === s.teamId)?.values[report.lead.kind];
      // A crest that fails or takes too long: the initials (crestDataUri never throws).
      const crest = withCrests ? await crestDataUri(team?.crest) : undefined;
      if (withCrests) crests.push([team?.crest, crest]);
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
  }, crestsDrawn(crests) ? cache : "brief");
}

/**
 * A round's biggest-movers card (moversCardSections): 404 for an unknown
 * league or round; the report's card when the round has no changes to show
 * (the season's first report, or the first after a model change).
 */
export async function moversCardImage(locale: string, leagueSlug: string, round: number): Promise<Response> {
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const loaded = await loadReport(leagueSlug, round).catch(() => undefined);
  if (!loaded) return new Response(null, { status: 404 });
  if (!moversCardSections(loaded.report).length) return oddsCardImage(locale, leagueSlug, round);
  // With the crests; then with the clubs' initials; then the report's own card.
  return firstCardThatRenders([() => moversCard(loaded, lang, true), () => moversCard(loaded, lang, false), () => oddsCardImage(locale, leagueSlug, round)]);
}

async function moversCard(loaded: LoadedReport, lang: SiteLocale, withCrests: boolean) {
  const { t, topic, round: roundName, season, count } = await reportText(loaded, lang);
  const { report, teams, league } = loaded;
  const crests = new Map<TeamId, string | undefined>();
  const sections = moversCardSections(report);
  if (withCrests) {
    const ids = [...new Set(sections.flatMap((s) => [...s.up, ...s.down].map((c) => c.teamId)))];
    // A crest that fails or takes too long: the initials (crestDataUri never throws).
    await Promise.all(ids.map(async (id) => crests.set(id, await crestDataUri(teams.get(id)?.crest))));
  }
  const row = (c: Change, category: Category): MoverCardRow => {
    const team = teams.get(c.teamId);
    const crest = crests.get(c.teamId);
    const up = c.delta! > 0;
    return {
      name: team?.shortName ?? "",
      tla: team?.tla ?? "",
      ...(crest ? { crest } : {}),
      from: percent(c.before ?? 0, lang),
      to: percent(c.now, lang),
      // Up is good, except for relegation.
      delta: { text: t("deltaPoints", { sign: up ? "+" : "−", n: Math.abs(c.delta!) }), up, good: category.kind === "relegation" ? !up : up },
    };
  };
  const date = new Intl.DateTimeFormat(dateLocale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${report.snapshot.date}T12:00:00Z`));
  return renderMoversCard({
    pill: `${league.name} ${season}`.toUpperCase(),
    title: t("card.moversTitle", { round: roundName }),
    date: t("asOf", { date }),
    up: t("up"),
    down: t("down"),
    sections: sections.map((s) => ({
      name: s.category.kind === "continental" ? topic(s.category) : t(`category.${s.category.kind}`),
      color: zoneHex(s.category.zone),
      up: s.up.map((c) => row(c, s.category)),
      down: s.down.map((c) => row(c, s.category)),
    })),
    basedOn: t("card.basedOn", { count }),
    cta: t("card.cta"),
  }, crestsDrawn([...crests].map(([id, drawn]) => [teams.get(id)?.crest, drawn])) ? "final" : "brief");
}
