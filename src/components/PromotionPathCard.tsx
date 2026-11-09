"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { LeagueConfig, SiteLocale } from "../config/leagues.ts";
import { buildLeagueModel, DOMESTIC_PRIOR_GAMES, matchParamOptions, NO_DATA_PRIOR, ratingHalfLife, type MatchParams, type TeamStrength } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import type { ResultMap, Team, TeamId } from "../engine/types.ts";
import { percent } from "../lib/clubText.ts";
import type { LeagueData, Tournament } from "../lib/leagueData.ts";
import { promotionScenario, simulatePromotion, type PromotionChances } from "../lib/promotionSeason.ts";
import { annualFixtures } from "../lib/tournaments.ts";
import { useSimStore } from "../store/simStore.ts";
import { Icon } from "./Icon.tsx";
import { TeamBadge } from "./TeamBadge.tsx";

/** Simulated seasons behind the card's chances: enough for whole percentages, quick on a phone. */
const ITERATIONS = 1500;

interface Props {
  league: LeagueConfig & { promotionPath: NonNullable<LeagueConfig["promotionPath"]>; annual: NonNullable<LeagueConfig["annual"]> };
  teams: Team[];
  /** Latest first. */
  tournaments: Tournament[];
  promotionGames?: LeagueData["promotionGames"];
  /** The season's year: promotion is to the next one's top flight. */
  year: number;
  priorStrengths?: Record<number, TeamStrength>;
  matchParams?: MatchParams;
}

/**
 * Who goes up (Primera B): each tournament's champion, the promotion path
 * the champions and the aggregate table lead to (direct places, grand final,
 * play-off), and every club's chances of promotion, from the real results
 * and the user's predictions in every tournament.
 */
export function PromotionPathCard({ league, teams, tournaments, promotionGames, year, priorStrengths, matchParams }: Props) {
  const t = useTranslations("Promotion");
  const lang = useLocale() as SiteLocale;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useSimStore.persist.hasHydrated()) setHydrated(true);
    return useSimStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);
  const seasons = useSimStore((s) => s.seasons);
  // Each tournament's predictions, by its key: a new object only when one of them changes.
  const keys = tournaments.map((x) => x.seasonKey);
  const predictionsKey = hydrated ? keys.map((k) => JSON.stringify(seasons[k]?.predictions ?? {})).join("|") : "";
  const predictions = useMemo<Record<string, ResultMap>>(
    () => (hydrated ? Object.fromEntries(keys.map((k) => [k, seasons[k]?.predictions ?? {}])) : {}),
    [predictionsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const teamMap = useMemo(() => new Map(teams.map((x) => [x.id, x])), [teams]);
  // Ratings from every real game of the season (predictions don't change how good a club is).
  const model = useMemo(() => {
    const fixtures = annualFixtures(league, [...tournaments].reverse());
    return buildLeagueModel(teams, fixtures, realResults(fixtures), {
      priorGames: league.ratingPriorGames ?? DOMESTIC_PRIOR_GAMES,
      missingPrior: NO_DATA_PRIOR,
      halfLife: ratingHalfLife(league),
      ...matchParamOptions(matchParams),
      ...(priorStrengths ? { priorStrengths: new Map(Object.entries(priorStrengths).map(([id, s]) => [Number(id), s])) } : {}),
    });
  }, [league, tournaments, teams, priorStrengths, matchParams]);
  const input = useMemo(
    () => ({ league, teams, tournaments, predictions, model, ...(promotionGames ? { promotionGames } : {}) }),
    [league, teams, tournaments, predictions, model, promotionGames],
  );
  const scenario = useMemo(() => promotionScenario(input), [input]);
  // The chances: worked out after the page has drawn (a second or so of simulation).
  const [chances, setChances] = useState<PromotionChances | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    setChances(null);
    const timer = setTimeout(() => setChances(simulatePromotion(input, ITERATIONS, 2026)), 50);
    return () => clearTimeout(timer);
  }, [input, hydrated]);

  const name = (id: TeamId) => teamMap.get(id)?.shortName ?? "";
  const club = (id: TeamId) => (
    <span className="inline-flex items-center gap-1 font-semibold whitespace-nowrap">
      {teamMap.get(id) && <TeamBadge team={teamMap.get(id)!} size={18} />}
      {name(id)}
    </span>
  );
  const path = scenario.path;
  const pathText = () => {
    if (!path) return t("pathPending");
    const tie = (kind: "grandFinal" | "playoff") => scenario.ties.find((x) => x.kind === kind);
    const playoff = tie("playoff");
    switch (path.rule) {
      case "doubleChampion":
        return t("doubleChampion", { champion: name(path.direct[0]!), a: playoff ? name(playoff.lower) : "", b: playoff ? name(playoff.higher) : "" });
      case "bothTop":
        return t("bothTop", { a: name(path.direct[0]!), b: name(path.direct[1]!) });
      case "oneTop":
        return t("oneTop", { up: name(path.direct[0]!), a: playoff ? name(playoff.lower) : "", b: playoff ? name(playoff.higher) : "" });
      case "neitherTop": {
        const final = path.grandFinal!;
        const against = path.playoff && "against" in path.playoff ? path.playoff.against : null;
        return t("neitherTop", { a: name(final.lower), b: name(final.higher), c: against === null ? "" : name(against) });
      }
    }
  };
  // Tournaments still to be decided: their title chances are a column.
  const open = scenario.champions.filter((c) => c.champion === null).map((c) => c.tournament);
  const rows = chances
    ? teams
        .map((x) => ({
          id: x.id,
          promoted: chances.promoted.get(x.id) ?? 0,
          titles: open.map((o) => chances.champion.get(o.id)?.get(x.id) ?? 0),
          grandFinal: chances.grandFinal.get(x.id) ?? 0,
          playoff: chances.playoff.get(x.id) ?? 0,
        }))
        .filter((r) => r.promoted > 0 || r.titles.some((c) => c > 0) || r.playoff > 0)
        .sort((a, b) => b.promoted - a.promoted || b.playoff - a.playoff || a.id - b.id)
    : [];
  const pct = (share: number) => (share > 0 ? percent(share, lang) : "–");

  return (
    <section className="space-y-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40" data-testid="promotion-path">
      <h2 className="flex items-center gap-2 font-bold">
        <Icon name="trending-up" size={18} className="shrink-0 text-emerald-700 dark:text-emerald-300" />
        {t("title", { league: league.promotionPath.promotedTo, year: year + 1 })}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="promotion-champions">
        {scenario.champions.map(({ tournament, champion }) => (
          <li key={tournament.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm dark:bg-zinc-900">
            <span className="text-zinc-500">{t("champion", { tournament: tournament.name })}</span>
            <span className="ml-auto">{champion === null ? <span className="text-zinc-500">{t("undecided")}</span> : club(champion)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-zinc-700 dark:text-zinc-300" data-testid="promotion-scenario">
        {pathText()}
      </p>
      <div>
        <h3 className="text-sm font-semibold">{t("chancesTitle")}</h3>
        {chances ? (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-sm" data-testid="promotion-chances">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1 pr-2 font-medium">{t("club")}</th>
                  <th className="whitespace-nowrap px-2 py-1 text-right font-medium">{t("promotion")}</th>
                  {open.map((o) => (
                    <th key={o.id} className="whitespace-nowrap px-2 py-1 text-right font-medium">
                      {/* Phones: the tournament's name alone. */}
                      <span className="sm:hidden">{o.name}</span>
                      <span className="hidden sm:inline">{t("tournamentTitle", { tournament: o.name })}</span>
                    </th>
                  ))}
                  {/* The grand final and the play-off from tablets up: on phones the club, its promotion and title chances fit. */}
                  <th className="hidden px-2 py-1 text-right font-medium sm:table-cell">{t("grandFinal")}</th>
                  <th className="hidden py-1 pl-2 text-right font-medium sm:table-cell">{t("playoff")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-emerald-200/70 dark:border-emerald-900/60" data-testid="promotion-row" data-team={r.id}>
                    <td className="py-1 pr-2">{club(r.id)}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums" data-testid="promotion-chance">
                      {pct(r.promoted)}
                    </td>
                    {r.titles.map((c, i) => (
                      <td key={open[i]!.id} className="px-2 py-1 text-right tabular-nums">
                        {pct(c)}
                      </td>
                    ))}
                    <td className="hidden px-2 py-1 text-right tabular-nums sm:table-cell">{pct(r.grandFinal)}</td>
                    <td className="hidden py-1 pl-2 text-right tabular-nums sm:table-cell">{pct(r.playoff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-1 text-sm text-zinc-500">{t("simulating")}</p>
        )}
        <p className="mt-2 text-xs text-zinc-500">{t("note")}</p>
      </div>
    </section>
  );
}
