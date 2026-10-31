"use client";

import { useTranslations } from "next-intl";
import { tieOutcome, type TwoLeggedTie } from "../engine/playoffs.ts";
import type { ResultMap, StandingRow, Team, TeamId } from "../engine/types.ts";
import { TeamBadge } from "./TeamBadge.tsx";

interface Props {
  ties: TwoLeggedTie[];
  rows: StandingRow[];
  teams: Map<TeamId, Team>;
  predictions: ResultMap;
  seasonComplete: boolean;
  directPromotion: readonly number[];
  promotedTo: string;
  nextSeason: string;
}

/** The clubs going up: direct promotion places plus the play-off winners. */
export function PromotedClubs({ ties, rows, teams, predictions, seasonComplete, directPromotion, promotedTo, nextSeason }: Props) {
  const t = useTranslations("Simulator");
  const winners = ties.map((tie) => (seasonComplete ? tieOutcome(tie, predictions)?.winner : undefined));
  const promoted =
    seasonComplete && winners.every((w) => w !== undefined)
      ? [
          ...directPromotion
            .map((position) => rows.find((r) => r.position === position))
            .filter((r): r is StandingRow => r !== undefined)
            .map((r) => ({ teamId: r.teamId, label: r.position === 1 ? t("promotedChampion") : t("promotedRunnerUp") })),
          ...winners.map((teamId) => ({ teamId: teamId!, label: t("promotedPlayoff") })),
        ]
      : null;

  return (
    <section className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40" data-testid="promoted">
      <h2 className="font-bold">{t("promotedTitle", { league: promotedTo, year: nextSeason })}</h2>
      {promoted ? (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {promoted.map(({ teamId, label }) => (
            <li key={teamId} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 dark:bg-zinc-900" data-testid="promoted-team">
              <TeamBadge team={teams.get(teamId)!} size={24} />
              <span className="font-semibold">{teams.get(teamId)?.name}</span>
              <span className="ml-auto text-xs text-zinc-500">{label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("promotedPending")}</p>
      )}
    </section>
  );
}
