"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { LeagueConfig, SiteLocale } from "../config/leagues.ts";
import type { TeamStrength } from "../engine/ratings.ts";
import type { Fixture, Team, TeamId } from "../engine/types.ts";
import type { Tournament } from "../lib/leagueData.ts";
import { realChampion } from "../engine/playoffs.ts";
import { LeagueSimulator } from "./LeagueSimulator.tsx";

interface Props {
  league: LeagueConfig & { annual: NonNullable<LeagueConfig["annual"]> };
  teams: Team[];
  /** The season's tournaments, latest first (as in the config). */
  tournaments: Tournament[];
  /** The tournament shown first (the current one). */
  current: string;
  groups?: { id: string; teamIds: number[] }[];
  priorStrengths?: Record<number, TeamStrength>;
}

/**
 * A season of several tournaments (Argentina: Apertura and Clausura), each with
 * its own tables, play-offs and saved predictions, plus the annual table of
 * every club over all of them, which decides the continental places and
 * relegation. The annual table shares the current tournament's predictions.
 */
export function TournamentSwitch({ league, teams, tournaments, current, groups, priorStrengths }: Props) {
  const t = useTranslations("Simulator");
  const lang = useLocale() as SiteLocale;
  const [view, setView] = useState<string>(current);
  // Oldest first in the switch, then the annual table.
  const ordered = useMemo(() => [...tournaments].reverse(), [tournaments]);
  const shown = tournaments.find((x) => x.id === view);
  const live = tournaments.find((x) => x.id === current) ?? tournaments[0]!;

  // The annual table: every tournament's regular phase in one table of all
  // clubs, later tournaments' rounds numbered after the earlier ones'.
  const annual = useMemo(() => {
    let offset = 0;
    const fixtures: Fixture[] = [];
    for (const tournament of ordered) {
      fixtures.push(...tournament.fixtures.map((f) => ({ ...f, matchday: f.matchday + offset })));
      offset += Math.max(0, ...tournament.fixtures.map((f) => f.matchday));
    }
    const config: LeagueConfig = {
      ...league,
      zones: league.annual.zones,
      gamesPerTeam: offset,
      groups: undefined,
      playoff: undefined,
    };
    const champions = ordered.flatMap((x) => {
      const id = realChampion(x.postseason);
      return id === null ? [] : [{ id, tournament: x.name }];
    });
    return { config, fixtures, champions };
  }, [ordered, league]);

  const teamName = (id: TeamId) => teams.find((x) => x.id === id)?.shortName ?? "";
  const qualifiedNote = t("annualQualifiedNote", {
    champions: annual.champions.map((c) => t("annualChampion", { club: teamName(c.id), tournament: c.tournament })).join(", "),
  });

  const button = (active: boolean) =>
    `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ${active ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"}`;

  return (
    <div className="space-y-3">
      <div className="flex max-w-full overflow-x-auto rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800 sm:w-fit" role="group" aria-label={t("tournament")} data-testid="tournament-switch">
        {ordered.map((x) => (
          <button key={x.id} type="button" aria-pressed={view === x.id} className={button(view === x.id)} onClick={() => setView(x.id)}>
            {x.name}
          </button>
        ))}
        <button type="button" aria-pressed={view === "annual"} className={button(view === "annual")} onClick={() => setView("annual")}>
          {league.annual.name[lang]}
        </button>
      </div>
      {shown ? (
        <LeagueSimulator
          key={shown.id}
          league={league}
          teams={teams}
          fixtures={shown.fixtures}
          seasonKey={shown.seasonKey}
          season={shown.season}
          {...(shown.postseason ? { postseason: shown.postseason } : {})}
          {...(groups ? { groups } : {})}
          {...(priorStrengths ? { priorStrengths } : {})}
        />
      ) : (
        <LeagueSimulator
          key="annual"
          league={annual.config}
          teams={teams}
          fixtures={annual.fixtures}
          // Shares the current tournament's predictions, both ways.
          seasonKey={live.seasonKey}
          season={live.season}
          {...(annual.champions.length ? { qualifiedElsewhere: annual.champions.map((c) => c.id), qualifiedNote } : {})}
        />
      )}
    </div>
  );
}
