"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { CupConfig } from "../config/cups.ts";
import type { CompetitionCode } from "../config/leagues.ts";
import { needsShootout, tieWinner, type CupRound, type CupTie } from "../engine/cup.ts";
import type { Fixture, ResultMap, Score, Team, TeamId } from "../engine/types.ts";
import { CupBracket } from "./CupBracket.tsx";
import { MatchRow } from "./FixtureList.tsx";

export interface CupViewProps {
  cup: CupConfig;
  rounds: CupRound[];
  teams: Map<TeamId, Team>;
  predictions: ResultMap;
  divisions: Record<TeamId, CompetitionCode>;
  onScore: (fixture: Fixture, score: Score | null) => void;
  onSimulate: (fixture: Fixture) => void;
}

/** Short division label for a cup club: PL, CH, L1, L2 or NL (non-league). */
export function useDivisionTag(divisions: Record<TeamId, CompetitionCode>) {
  const t = useTranslations("Cup");
  return (id: TeamId) => {
    const code = divisions[id];
    return code ? t(`division.${code}`) : t("division.nonLeague");
  };
}

/** One tie as a card: the game, its shoot-out when level, the winner in bold. */
export function TieCard({ tie, teams, predictions, divisions, onScore, onSimulate, compact = false }: Omit<CupViewProps, "cup" | "rounds"> & { tie: CupTie; compact?: boolean }) {
  const t = useTranslations("Simulator");
  const tag = useDivisionTag(divisions);
  const winner = tieWinner(tie, predictions);
  const pens = needsShootout(tie, predictions) || predictions[tie.shootout.id] !== undefined;
  const home = teams.get(tie.homeId);
  const away = teams.get(tie.awayId);
  if (!home || !away) return null;
  return (
    <ul
      className={`rounded-xl border bg-white dark:bg-zinc-900 ${winner !== null ? "border-pitch-300 dark:border-pitch-800" : "border-zinc-200 dark:border-zinc-800"} ${compact ? "text-sm" : ""}`}
      data-testid="cup-tie"
      data-round={tie.round}
      data-home={tie.homeId}
      data-away={tie.awayId}
      data-winner={winner ?? ""}
    >
      <MatchRow
        fixture={tie.game}
        home={home}
        away={away}
        prediction={predictions[tie.game.id]}
        {...(compact ? {} : { tags: { home: tag(tie.homeId), away: tag(tie.awayId) } })}
        winner={winner}
        joinsNext={pens}
        onScore={(score) => onScore(tie.game, score)}
        onSimulate={() => onSimulate(tie.game)}
      />
      {pens && (
        <MatchRow
          fixture={tie.shootout}
          home={home}
          away={away}
          prediction={predictions[tie.shootout.id]}
          label={t("penalties")}
          attached
          winner={winner}
          onScore={(score) => onScore(tie.shootout, score)}
          onSimulate={() => onSimulate(tie.shootout)}
        />
      )}
    </ul>
  );
}

interface RoundsProps extends CupViewProps {
  roundIndex: number;
  onSelect: (index: number) => void;
}

/** Round bar (First Round … Final) and the selected round: a card grid, or the bracket from the quarter-finals. */
export function CupRounds(props: RoundsProps) {
  const { cup, rounds, roundIndex, onSelect, predictions } = props;
  const t = useTranslations("Cup");
  const format = useFormatter();
  const round = rounds[roundIndex]!;
  const bracketFrom = rounds.findIndex((r) => r.config.ties <= 4);
  const decided = (r: CupRound) => r.ties.filter((tie) => tieWinner(tie, predictions) !== null).length;

  const status = (r: CupRound) => {
    if (r.drawn === "pending") return t("drawPending");
    const done = decided(r);
    if (done === r.config.ties) return t("roundComplete");
    return r.drawn === "simulated" ? t("simulatedDraw") : `${done}/${r.config.ties}`;
  };
  const when = (r: CupRound) => {
    const date = r.ties[0]?.game.utcDate;
    return date && !Number.isNaN(Date.parse(date)) ? format.dateTime(new Date(date), { day: "numeric", month: "short" }) : "";
  };

  return (
    <div className="space-y-3">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="round-bar">
        <div className="flex min-w-max gap-1 rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="tablist">
          {rounds.map((r, i) => {
            const active = i === roundIndex;
            const complete = r.drawn !== "pending" && decided(r) === r.config.ties;
            return (
              <button
                key={r.config.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(i)}
                className={`flex min-w-[6.5rem] flex-col items-start rounded-md px-3 py-1.5 text-left ${active ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"}`}
              >
                <span className="text-sm font-semibold">
                  {t(`round.${r.config.key}`)}
                  {complete && <span className="ml-1 text-pitch-600 dark:text-pitch-100">✓</span>}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{[when(r), status(r)].filter(Boolean).join(" · ")}</span>
              </button>
            );
          })}
        </div>
      </div>

      {round.config.venue && <p className="text-xs text-zinc-500">{t("atVenue", { venue: round.config.venue })}</p>}
      {round.drawn === "simulated" && round.ties.length > 0 && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-900/30 dark:text-sky-100" data-testid="simulated-draw-note">
          {t("simulatedDrawNote")}
        </p>
      )}

      {bracketFrom >= 0 && roundIndex >= bracketFrom ? (
        <CupBracket {...props} rounds={rounds.slice(bracketFrom)} highlight={roundIndex - bracketFrom} />
      ) : round.drawn === "pending" && round.ties.length === 0 ? (
        <PendingRound cup={cup} round={round} rounds={rounds} />
      ) : (
        <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="round-grid">
          {round.ties.map((tie) => (
            <TieCard key={tie.game.id} tie={tie} {...props} />
          ))}
          {round.drawn === "pending" && <PendingRound cup={cup} round={round} rounds={rounds} />}
        </div>
      )}
    </div>
  );
}

/** A round whose draw hasn't been made: who it waits for and how many clubs go in the hat. */
export function PendingRound({ cup, round, rounds }: { cup: CupConfig; round: CupRound; rounds: CupRound[] }) {
  const t = useTranslations("Cup");
  const previous = rounds[round.index - 1];
  const entrants = cup.rounds[round.index]!.entrantsFrom;
  const count = round.config.ties * 2;
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700" data-testid="pending-round">
      <p className="font-semibold text-zinc-700 dark:text-zinc-300">{previous ? t("drawAfter", { round: t(`round.${previous.config.key}`) }) : t("drawPending")}</p>
      <p className="mt-1">
        {entrants ? t("drawClubsEntering", { count, entering: entrants.length ? t("entrantsFrom", { leagues: entrants.join(" + ") }) : "" }) : t("drawClubs", { count })}
      </p>
    </div>
  );
}
