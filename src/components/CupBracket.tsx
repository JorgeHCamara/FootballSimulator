"use client";

import { useTranslations } from "next-intl";
import type { CupRound } from "../engine/cup.ts";
import { PendingRound, TieCard, type CupViewProps } from "./CupRounds.tsx";

interface Props extends CupViewProps {
  /** The last rounds (quarter-finals, semi-finals, final). */
  rounds: CupRound[];
  /** Index (within `rounds`) of the round picked in the round bar. */
  highlight: number;
}

/**
 * The closing rounds as a bracket: one column per round, ties spread out so
 * each pair of quarter-finals sits beside its semi-final, with connector
 * stubs on wide screens. Columns stack on phones.
 */
export function CupBracket(props: Props) {
  const { rounds, highlight, cup } = props;
  const t = useTranslations("Cup");
  const allRounds = [...rounds];
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="cup-bracket">
      {rounds.map((round, column) => {
        const last = column === rounds.length - 1;
        return (
          <section key={round.config.key} className={`flex flex-col ${highlight === column ? "" : "lg:opacity-90"}`} data-testid="bracket-round">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              {t(`round.${round.config.key}`)}
              {round.config.venue && <span className="ml-1 font-medium normal-case text-zinc-500"> · {round.config.venue}</span>}
            </h3>
            <div className="flex grow flex-col justify-around gap-3">
              {round.ties.length === 0 ? (
                <PendingRound cup={cup} round={round} rounds={[...props.rounds.slice(0, 0), ...allRounds]} />
              ) : (
                round.ties.map((tie) => (
                  <div
                    key={tie.game.id}
                    className={`relative ${last ? "" : "lg:after:absolute lg:after:top-1/2 lg:after:-right-4 lg:after:w-4 lg:after:border-t-2 lg:after:border-zinc-300 lg:after:content-[''] dark:lg:after:border-zinc-600"} ${column === 0 ? "" : "lg:before:absolute lg:before:top-1/2 lg:before:-left-4 lg:before:w-4 lg:before:border-t-2 lg:before:border-zinc-300 lg:before:content-[''] dark:lg:before:border-zinc-600"}`}
                  >
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
