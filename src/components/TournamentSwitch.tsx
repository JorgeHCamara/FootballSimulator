"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { LeagueConfig, SiteLocale } from "../config/leagues.ts";
import type { MatchParams, TeamStrength } from "../engine/ratings.ts";
import type { Team, TeamId } from "../engine/types.ts";
import type { Tournament } from "../lib/leagueData.ts";
import { LeagueSimulator } from "./LeagueSimulator.tsx";
import { annualFixtures, tournamentChampion, tournamentConfig } from "../lib/tournaments.ts";

export { tournamentChampion, tournamentConfig };

interface Props {
  league: LeagueConfig & { annual: NonNullable<LeagueConfig["annual"]> };
  teams: Team[];
  /** The season's tournaments, latest first (as in the config). */
  tournaments: Tournament[];
  /** The tournament shown first (the current one). */
  current: string;
  /** The current tournament's groups (from ESPN's standings). */
  groups?: { id: string; teamIds: number[] }[];
  priorStrengths?: Record<number, TeamStrength>;
  /** The league's match parameters (rho, home splits). */
  matchParams?: MatchParams;
  /** Points deducted in the current tournament's table (ESPN), also applied to the annual table. */
  deductions?: Record<number, number>;
}

/**
 * A season of several tournaments (Argentina, Colombia, Uruguay, Paraguay),
 * each with its own tables, play-offs and saved predictions, plus the annual
 * table of every club over all of them, which decides the continental places
 * (and in some leagues relegation). The annual table shares the current
 * tournament's predictions.
 */
export function TournamentSwitch({ league, teams, tournaments, current, groups, priorStrengths, deductions, matchParams }: Props) {
  const t = useTranslations("Simulator");
  const lang = useLocale() as SiteLocale;
  const [view, setView] = useState<string>(current);
  const stages = useMemo(
    () => (league.espn?.stages && !("table" in league.espn.stages) ? league.espn.stages : []),
    [league.espn?.stages],
  );
  const configOf = (tournament: Tournament) => tournamentConfig(league, stages.find((s) => s.table === tournament.id));
  // Oldest first in the switch, then the annual table.
  const ordered = useMemo(() => [...tournaments].reverse(), [tournaments]);
  const shown = tournaments.find((x) => x.id === view);
  const live = tournaments.find((x) => x.id === current) ?? tournaments[0]!;

  // The annual table: every tournament's regular phase (and, where it counts,
  // its real play-off games) in one table of all clubs, later tournaments'
  // rounds numbered after the earlier ones'.
  const annual = useMemo(() => {
    const fixtures = annualFixtures(league, ordered);
    const config: LeagueConfig = {
      ...league,
      zones: league.annual.zones,
      gamesPerTeam: Math.round(fixtures.length * 2 / Math.max(1, new Set(fixtures.flatMap((f) => [f.homeId, f.awayId])).size)),
      groups: undefined,
      playoff: undefined,
    };
    const champions = league.annual.championsQualify
      ? ordered.flatMap((x) => {
          const id = tournamentChampion(tournamentConfig(league, stages.find((s) => s.table === x.id)), teams, x);
          return id === null ? [] : [{ id, tournament: x.name }];
        })
      : [];
    return { config, fixtures, champions };
  }, [ordered, league, stages, teams]);

  const teamName = (id: TeamId) => teams.find((x) => x.id === id)?.shortName ?? "";
  const notes = [
    annual.champions.length
      ? t("annualQualifiedNote", {
          champions: annual.champions.map((c) => t("annualChampion", { club: teamName(c.id), tournament: c.tournament })).join(", "),
        })
      : "",
    // What else decides the places and relegation in this league (Copa winners, averages tables…).
    t(`annualNotes.${league.code}` as "annualNotes.ARG"),
  ].filter(Boolean);

  const button = (active: boolean) =>
    `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ${active ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"}`;

  // A tournament's own groups (Uruguay's Intermedio), else the league's: ESPN's
  // standings only describe the current tournament, but a league's groups last
  // the whole year (Argentina's Zones A and B in both the Apertura and Clausura).
  const shownGroups = shown ? (shown.groups ?? groups) : undefined;

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
          league={configOf(shown)}
          teams={teams}
          fixtures={shown.fixtures}
          seasonKey={shown.seasonKey}
          season={shown.season}
          {...(shown.postseason ? { postseason: shown.postseason } : {})}
          {...(shownGroups ? { groups: shownGroups } : {})}
          {...(priorStrengths ? { priorStrengths } : {})}
          {...(matchParams ? { matchParams } : {})}
          {...(deductions && shown.id === current ? { deductions } : {})}
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
          {...(annual.champions.length ? { qualifiedElsewhere: annual.champions.map((c) => c.id) } : {})}
          {...(priorStrengths ? { priorStrengths } : {})}
          {...(matchParams ? { matchParams } : {})}
          {...(notes.length ? { qualifiedNote: notes.join(" ") } : {})}
          {...(deductions ? { deductions } : {})}
        />
      )}
    </div>
  );
}
