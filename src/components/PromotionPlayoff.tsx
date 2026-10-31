"use client";

import { useTranslations } from "next-intl";
import type { LeagueConfig } from "../config/leagues.ts";
import { tieOutcome, type TwoLeggedTie } from "../engine/playoffs.ts";
import type { LeagueModel } from "../engine/ratings.ts";
import type { Fixture, ResultMap, Score, StandingRow, Team, TeamId } from "../engine/types.ts";
import { MatchRow } from "./FixtureList.tsx";
import { TeamBadge } from "./TeamBadge.tsx";

interface Props {
  league: LeagueConfig & { playoff: NonNullable<LeagueConfig["playoff"]> };
  ties: TwoLeggedTie[];
  rows: StandingRow[];
  teams: Map<TeamId, Team>;
  predictions: ResultMap;
  model: LeagueModel;
  /** Every league match has a score, so the seeding is final. */
  seasonComplete: boolean;
  nextSeason: string;
  onScore: (fixture: Fixture, score: Score | null) => void;
  onSimulateLeg: (fixture: Fixture) => void;
  onSimulatePlayoff: () => void;
}

export function PromotionPlayoff(props: Props) {
  const { league, ties, rows, teams, predictions, model, seasonComplete, nextSeason, onScore, onSimulateLeg, onSimulatePlayoff } = props;
  const t = useTranslations("Simulator");
  const name = (id: TeamId) => teams.get(id)?.shortName ?? "";
  const outcomes = ties.map((tie) => (seasonComplete ? tieOutcome(tie, predictions) : null));

  const direct = league.playoff.directPromotion
    .map((position) => rows.find((r) => r.position === position))
    .filter((r): r is StandingRow => r !== undefined)
    .map((r) => ({ teamId: r.teamId, label: r.position === 1 ? t("promotedChampion") : t("promotedRunnerUp") }));
  const promoted =
    seasonComplete && outcomes.every((o) => o)
      ? [...direct, ...outcomes.map((o) => ({ teamId: o!.winner, label: t("promotedPlayoff") }))]
      : null;

  return (
    <section className="mt-4 space-y-4" data-testid="playoff">
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <h2 className="font-bold">{t("playoffTitle")}</h2>
          <button
            type="button"
            onClick={onSimulatePlayoff}
            disabled={!seasonComplete}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {t("simulatePlayoff")}
          </button>
        </header>
        {!seasonComplete && <p className="px-3 pt-2 text-xs text-zinc-500">{t("playoffProjected")}</p>}

        {ties.map((tie, i) => {
          const outcome = outcomes[i];
          return (
            <div key={tie.seeds.join("-")} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800" data-testid="playoff-tie">
              <div className="px-3 pt-3">
                <h3 className="text-sm font-semibold">
                  {t("playoffTie", { higherPos: tie.seeds[0], lowerPos: tie.seeds[1] })}
                  <span className="font-normal text-zinc-500">
                    {" "}
                    · {name(tie.higher)} × {name(tie.lower)}
                  </span>
                </h3>
                <p className="text-xs text-zinc-500">{t("playoffRule", { higher: name(tie.higher) })}</p>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {[tie.leg1, tie.leg2].map((leg) => (
                  <MatchRow
                    key={`${leg.id}-${leg.homeId}-${leg.awayId}`}
                    fixture={leg}
                    home={teams.get(leg.homeId)!}
                    away={teams.get(leg.awayId)!}
                    prediction={predictions[leg.id]}
                    model={model}
                    disabled={!seasonComplete}
                    onScore={(score) => onScore(leg, score)}
                    onSimulate={() => onSimulateLeg(leg)}
                  />
                ))}
              </ul>
              {outcome && (
                <p className="bg-pitch-50 px-3 py-2 text-sm font-medium text-pitch-900 dark:bg-pitch-900/30 dark:text-pitch-100" data-testid="playoff-result">
                  {t("playoffAggregate", {
                    higher: name(tie.higher),
                    lower: name(tie.lower),
                    hg: outcome.higherGoals,
                    lg: outcome.lowerGoals,
                    winner: name(outcome.winner),
                    promotedTo: league.playoff.promotedTo,
                  })}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40" data-testid="promoted">
        <h2 className="font-bold">{t("promotedTitle", { league: league.playoff.promotedTo, year: nextSeason })}</h2>
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
      </div>
    </section>
  );
}
