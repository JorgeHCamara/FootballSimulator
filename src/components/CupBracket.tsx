"use client";

import { useTranslations } from "next-intl";
import { bracketColumns, type CupRound } from "../engine/cup.ts";
import { PendingRound, TieCard, type CupViewProps } from "./CupRounds.tsx";

interface Props extends CupViewProps {
  /** The last rounds (quarter-finals, semi-finals, final). */
  rounds: CupRound[];
  /** Index (within `rounds`) of the round picked in the round bar. */
  highlight: number;
  /** Every round of the cup (for the "draw after …" note of a pending round). */
  fullRounds: CupRound[];
}

/**
 * The closing rounds as a bracket: one column per round, ties spread out so
 * each pair of quarter-finals sits beside the semi-final it fed (the FA Cup
 * draws every round, so the order follows the draw). Columns stack on phones.
 */
export function CupBracket(props: Props) {
  const { rounds, highlight, cup, fullRounds, predictions } = props;
  const t = useTranslations("Cup");
  const columns = bracketColumns(rounds, predictions);
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="cup-bracket">
      {rounds.map((round, column) => {
        return (
          <section key={round.config.key} className={`flex flex-col ${highlight === column ? "" : "lg:opacity-90"}`} data-testid="bracket-round">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              {t(`round.${round.config.key}`)}
              {round.config.venue && <span className="ml-1 font-medium normal-case text-zinc-500"> · {round.config.venue}</span>}
            </h3>
            <div className="flex grow flex-col justify-around gap-3">
              {round.ties.length === 0 ? (
                <PendingRound cup={cup} round={round} rounds={fullRounds} predictions={predictions} teams={props.teams} />
              ) : (
                columns[column]!.map((tie) => (
                  <div key={tie.game.id} data-testid="bracket-tie">
                    <TieCard tie={tie} {...props} compact />
                  </div>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
