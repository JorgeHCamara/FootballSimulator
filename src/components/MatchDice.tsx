"use client";

import { useState } from "react";
import { sampleLikelyScore, type ExpectedGoals } from "../engine/match.ts";
import { createRng, randomSeed } from "../engine/rng.ts";
import type { Score } from "../engine/types.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  xg: ExpectedGoals;
  rho: number;
  home: string;
  away: string;
  labels: { button: string; again: string; result: string };
}

/**
 * The simulator's dice for one game: a likely roll (one of the likeliest
 * scores, the likeliest most often); rolling again gives another one.
 */
export function MatchDice({ xg, rho, home, away, labels }: Props) {
  const [score, setScore] = useState<Score | null>(null);
  const [rolls, setRolls] = useState(0);
  const roll = () => {
    setScore((current) => sampleLikelyScore(xg, createRng(randomSeed()), rho, current ?? undefined));
    setRolls((n) => n + 1);
  };
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={roll}
        className="flex h-11 items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700"
        data-testid="match-dice"
      >
        <Icon name="dices" size={18} />
        {score ? labels.again : labels.button}
      </button>
      <div
        className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-300 px-3 text-sm dark:border-zinc-700"
        aria-live="polite"
        data-testid="match-dice-result"
        data-rolls={rolls}
      >
        {score ? (
          <>
            <span className="min-w-0 truncate text-right font-medium">{home}</span>
            <span className="shrink-0 rounded-md bg-zinc-100 px-3 py-1 text-lg font-extrabold tabular-nums dark:bg-zinc-800" aria-label={labels.result.replace("{score}", `${score.home}–${score.away}`)}>
              {score.home}–{score.away}
            </span>
            <span className="min-w-0 truncate font-medium">{away}</span>
          </>
        ) : (
          <span className="text-zinc-400">–</span>
        )}
      </div>
    </div>
  );
}
