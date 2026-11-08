import { getTranslations } from "next-intl/server";
import type { LeagueConfig, SiteLocale } from "../config/leagues.ts";
import { leagueFacts, type LeagueFact } from "../lib/leagueFacts.ts";
import { ZONE_STYLES } from "./zones.ts";

/** "{league} format": how the competition runs and where each place leads, from its config. */
export async function LeagueFactsSection({ league, locale }: { league: LeagueConfig; locale: SiteLocale }) {
  const facts = leagueFacts(league);
  if (!facts) return null;
  const [t, tz] = await Promise.all([getTranslations("Facts"), getTranslations("Zones")]);
  const place = (n: number) => t("place", { n });
  const range = (from: number, to: number) => (from === to ? place(from) : t("range", { from: place(from), to: place(to) }));
  const phase = (name?: Record<SiteLocale, string>) => (name ? name[locale].toLowerCase() : t("regularSeason"));
  const sentence = (fact: LeagueFact): string => {
    switch (fact.kind) {
      case "clubs":
        return t("clubs", { clubs: fact.clubs });
      case "roundRobin":
        if (fact.firstPhase) return t("roundRobinPhase", { phase: phase(fact.firstPhase.name), times: fact.times, games: fact.games });
        return t(fact.perTournament ? "roundRobinTournament" : "roundRobin", { times: fact.times, games: fact.games });
      case "games":
        return t(fact.perTournament ? "gamesTournament" : "games", { games: fact.games });
      case "tournaments":
        return t("tournaments", { count: fact.names.length, names: fact.names.join(", ") });
      case "split": {
        const halved = fact.groups.filter((g) => g.carryOver < 1);
        return t("split", {
          hasRound: fact.afterRound !== undefined ? "yes" : "no",
          round: fact.afterRound ?? 0,
          phase: phase(league.split?.firstPhaseName),
          groups: fact.groups.map((g) => `${range(g.from, g.to)}: ${g.name[locale]}`).join(", "),
          legs: fact.groups.every((g) => g.legs === 1) ? "one" : "two",
          carry: halved.length ? t("carryHalved", { group: halved.map((g) => g.name[locale]).join(", ") }) : "",
        });
      }
      case "splitPlaced": {
        const list = (places: number[]) => places.map(place).join(", ");
        return t("splitPlaced", {
          round: fact.afterRound,
          count: fact.groups.reduce((n, g) => n + g.places.length, 0),
          groups: fact.groups.map((g) => t("placesList", { group: g.name[locale], list: list(g.places) })).join("; "),
        });
      }
      case "splitHalves":
        return t("splitHalves", { round: fact.afterRound, top: fact.top, bottom: fact.bottom });
      case "tables":
        return t("tables", { count: fact.names.length, names: fact.names.map((n) => n[locale]).join(", ") });
      case "titlePlayoff":
        return t(fact.perTournament ? "titlePlayoffTournament" : "titlePlayoff");
      case "finalAndReducido":
        return t("finalAndReducido");
      case "annual":
        return t("annual");
    }
  };
  const placesTitle = { table: "placesTitle", eachTable: "placesTitleEach", annual: "placesTitleAnnual" } as const;

  return (
    <section className="space-y-3 pt-8" data-testid="league-facts">
      <h2 className="text-xl font-bold tracking-tight">{t("title", { league: league.name })}</h2>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{facts.facts.map(sentence).join(" ")}</p>
      {facts.places.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold">{t(placesTitle[facts.placesScope])}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-zinc-600 dark:text-zinc-400" data-testid="league-places">
            {facts.places.map((zone) => (
              <li key={`${zone.kind}-${zone.from}`} className="flex items-center gap-1.5">
                <span className={`h-3 w-3 shrink-0 rounded-sm ring-1 ring-zinc-300 dark:ring-zinc-600 ${ZONE_STYLES[zone.kind].row}`} />
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{range(zone.from, zone.to)}</span> {tz(zone.kind)}
              </li>
            ))}
          </ul>
          {facts.continentalPlaces && <p className="text-xs text-zinc-500">{t("placesNote")}</p>}
        </div>
      )}
    </section>
  );
}
