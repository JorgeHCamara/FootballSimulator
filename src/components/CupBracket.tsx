"use client";

import { useTranslations } from "next-intl";
import { tieWinner, type CupRound, type CupTie } from "../engine/cup.ts";
import type { ResultMap } from "../engine/types.ts";
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
 * each pair of quarter-finals sits beside its semi-final, with connector
 * stubs on wide screens. Columns stack on phones.
 */
// Connector stubs between columns (literal strings so Tailwind generates them).
const TO_NEXT =
  "lg:after:absolute lg:after:top-1/2 lg:after:-right-4 lg:after:w-4 lg:after:border-t-2 lg:after:border-zinc-300 lg:after:content-[''] dark:lg:after:border-zinc-600";
const FROM_PREVIOUS =
  "lg:before:absolute lg:before:top-1/2 lg:before:-left-4 lg:before:w-4 lg:before:border-t-2 lg:before:border-zinc-300 lg:before:content-[''] dark:lg:before:border-zinc-600";

export function CupBracket(props: Props) {
  const { rounds, highlight, cup, fullRounds, predictions } = props;
  const t = useTranslations("Cup");
  const columns = orderColumns(rounds, predictions);
  // The FA Cup draws every round afresh, so a path only exists once the next round is drawn.
  const drawn = (column: number) => (rounds[column]?.ties.length ?? 0) > 0 && rounds[column]!.drawn !== "pending";
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="cup-bracket">
      {rounds.map((round, column) => {
        const toNext = column < rounds.length - 1 && drawn(column + 1);
        const fromPrevious = column > 0 && drawn(column);
        return (
          <section key={round.config.key} className={`flex flex-col ${highlight === column ? "" : "lg:opacity-90"}`} data-testid="bracket-round">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              {t(`round.${round.config.key}`)}
              {round.config.venue && <span className="ml-1 font-medium normal-case text-zinc-500"> · {round.config.venue}</span>}
            </h3>
            <div className="flex grow flex-col justify-around gap-3">
              {round.ties.length === 0 ? (
                <PendingRound cup={cup} round={round} rounds={fullRounds} />
              ) : (
                columns[column]!.map((tie) => (
                  <div
                    key={tie.game.id}
                    className={`relative ${toNext ? TO_NEXT : ""} ${fromPrevious ? FROM_PREVIOUS : ""}`}
                    data-testid="bracket-tie"
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

/**
 * Orders each column by the draw of the round after it: for every tie of the
 * next round, the tie its home club came through, then its away club's. So
 * the two quarter-finals feeding a semi-final sit beside it. A column whose
 * next round isn't drawn keeps its draw order.
 */
export function orderColumns(rounds: readonly CupRound[], results: ResultMap): CupTie[][] {
  const columns = rounds.map((r) => [...r.ties]);
  for (let c = columns.length - 2; c >= 0; c--) {
    if (rounds[c + 1]!.ties.length === 0) continue;
    const ordered: CupTie[] = [];
    for (const next of columns[c + 1]!) {
      for (const club of [next.homeId, next.awayId]) {
        const feeder = columns[c]!.find((tie) => !ordered.includes(tie) && tieWinner(tie, results) === club);
        if (feeder) ordered.push(feeder);
      }
    }
    columns[c] = [...ordered, ...columns[c]!.filter((tie) => !ordered.includes(tie))];
  }
  return columns;
}
