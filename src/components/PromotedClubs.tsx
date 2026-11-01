"use client";

import { useTranslations } from "next-intl";
import { playoffWinners, type PlayoffTie } from "../engine/playoffs.ts";
import type { ResultMap, StandingRow, Team, TeamId } from "../engine/types.ts";
import { TeamBadge } from "./TeamBadge.tsx";

interface Props {
  bracket: PlayoffTie[][];
  rows: StandingRow[];
  teams: Map<TeamId, Team>;
  predictions: ResultMap;
  seasonComplete: boolean;
  directPromotion: readonly number[];
  promotedTo: string;
  nextSeason: string;
  /** The play-off isn't held (Serie B), so `clearPosition` goes up directly instead. */
  cancelled?: boolean;
  clearPosition?: number;
  /** The play-off winner still has to beat another league's club (Ligue 2 v Ligue 1's 16th). */
  winnerPlays?: { league: string; position: number };
}

/** The clubs going up: direct promotion places plus the play-off winners. */
export function PromotedClubs(props: Props) {
  const { bracket, rows, teams, predictions, seasonComplete, directPromotion, promotedTo, nextSeason, cancelled, clearPosition, winnerPlays } = props;
  const t = useTranslations("Simulator");
  const winners = seasonComplete && !cancelled ? playoffWinners(bracket, predictions) : [];
  const decided = seasonComplete && (cancelled || (winners.length > 0 && winners.every((w) => w !== null)));
  const directPositions = cancelled && clearPosition ? [...directPromotion, clearPosition] : directPromotion;
  const direct = directPositions
    .map((position) => rows.find((r) => r.position === position))
    .filter((r): r is StandingRow => r !== undefined)
    .map((r) => ({
      teamId: r.teamId,
      label: r.position === 1 ? t("promotedChampion") : r.position === 2 ? t("promotedRunnerUp") : t("playoffPlace", { position: r.position }),
    }));
  // A winner that still faces another league's club isn't promoted yet.
  const promoted = decided
    ? [...direct, ...(winnerPlays ? [] : winners.map((teamId) => ({ teamId: teamId!, label: t("promotedPlayoff") })))]
    : null;
  const contender = decided && winnerPlays && winners[0] != null ? teams.get(winners[0]) : undefined;

  return (
    <section className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40" data-testid="promoted">
      <h2 className="font-bold">{t("promotedTitle", { league: promotedTo, year: nextSeason })}</h2>
      {promoted ? (
        <>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {promoted.map(({ teamId, label }) => (
              <li key={teamId} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 dark:bg-zinc-900" data-testid="promoted-team">
                <TeamBadge team={teams.get(teamId)!} size={24} />
                <span className="font-semibold">{teams.get(teamId)?.name}</span>
                <span className="ml-auto text-xs text-zinc-500">{label}</span>
              </li>
            ))}
          </ul>
          {contender && winnerPlays && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300" data-testid="promoted-contender">
              {t("promotedBarrage", { winner: contender.name, ...winnerPlays })}
            </p>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("promotedPending")}</p>
      )}
    </section>
  );
}
