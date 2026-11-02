"use client";

import { useTranslations } from "next-intl";
import { playoffWinners, type PlayoffTie } from "../engine/playoffs.ts";
import type { ResultMap, Team, TeamId } from "../engine/types.ts";
import { TeamBadge } from "./TeamBadge.tsx";

interface Props {
  bracket: PlayoffTie[][];
  teams: Map<TeamId, Team>;
  predictions: ResultMap;
  seasonComplete: boolean;
  /** Competition the play-off decides, e.g. "MLS Cup". */
  title: string;
  season: string;
  /** Continental competition: what comes before the knockout phase (its own wording). */
  knockout?: "leaguePhase" | "groupStage";
}

/** The winner of a title play-off (MLS Cup), once the bracket is decided. */
export function PlayoffChampion({ bracket, teams, predictions, seasonComplete, title, season, knockout }: Props) {
  const t = useTranslations("Simulator");
  const [winner] = seasonComplete ? playoffWinners(bracket, predictions) : [];
  const team = winner != null ? teams.get(winner) : undefined;

  return (
    <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40" data-testid="champion">
      <h2 className="font-bold">{t("championTitle", { title, year: season })}</h2>
      {team ? (
        <p className="mt-2 flex items-center gap-2 rounded-lg bg-white px-3 py-2 dark:bg-zinc-900" data-testid="champion-team">
          <TeamBadge team={team} size={28} />
          <span className="text-lg font-semibold">{team.name}</span>
          <span className="ml-auto text-xl" aria-hidden>
            🏆
          </span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t(knockout === "groupStage" ? "championPendingGroups" : knockout ? "championPendingLeaguePhase" : "championPending")}</p>
      )}
    </section>
  );
}
