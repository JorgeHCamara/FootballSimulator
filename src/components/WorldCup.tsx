"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { tieWinner } from "../engine/cup.ts";
import { worldSeasonLabel, type World } from "../lib/myWorld.ts";
import { cupCountry } from "../lib/worldCountries.ts";
import {
  pastCup,
  resetCup,
  rollCupScore,
  setCupScore,
  simulateWorldCupRest,
  simulateWorldCupRound,
  type WorldCupCode,
  type WorldCupState,
} from "../lib/worldCups.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { CupRounds } from "./CupRounds.tsx";
import { CupChampion } from "./CupSimulator.tsx";
import { worldCupWinners } from "../lib/worldWinners.ts";
import { Icon } from "./Icon.tsx";
import { PastWinners } from "./PastWinners.tsx";
import { SeasonPicker } from "./WorldSeason.tsx";

const noop = () => {};
// Phones: the season picker, the buttons, the rounds. Desktop, as on the cup pages: the picker and the buttons on one row above the rounds.
const grid = "grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start";

/** A finished season's cup, to look back at: every round with its scores, and the winner (nothing to change). */
function PastCup({ world, year, code }: { world: World; year: number; code: WorldCupCode }) {
  const t = useTranslations("World");
  const past = useMemo(() => pastCup(world, year, code), [world, year, code]);
  const [roundIndex, setRoundIndex] = useState(() => Math.max(0, (past?.rounds?.length ?? 1) - 1));
  if (!past) return null;
  return (
    <div className="min-w-0 space-y-4 lg:col-span-2 lg:col-start-1 lg:row-start-2" data-testid="world-past-cup" data-cup={code}>
      {past.rounds ? (
        <CupRounds
          cup={past.cup}
          rounds={past.rounds}
          teams={past.teams}
          predictions={{}}
          divisions={past.divisions}
          onScore={noop}
          onSimulate={noop}
          roundIndex={Math.min(roundIndex, past.rounds.length - 1)}
          onSelect={setRoundIndex}
          readOnly
          kickOff={false}
          ownDraw
        />
      ) : (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300" data-testid="world-past-no-fixtures">
          {t("pastNoFixtures")}
        </p>
      )}
      <CupChampion cup={past.cup} rounds={past.rounds ?? []} winner={past.final[0]} predictions={{}} teams={past.teams} season={worldSeasonLabel(world, year, cupCountry(code))} />
    </div>
  );
}

/**
 * One cup's season, as on the cup pages: its rounds, every score open to
 * typing in or rolling with the dice, and the same buttons (simulate the
 * round, the rest of the cup, undo, reset). The season picker beside the
 * buttons shows a finished season's cup instead, to look back at.
 */
export function WorldCup({
  world,
  state,
  year,
  onYear,
  onChange,
  canUndo,
  onUndo,
}: {
  world: World;
  state: WorldCupState;
  /** The season shown: the one in progress (world.year) or a finished one. */
  year: number;
  onYear: (year: number) => void;
  onChange: (world: World) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const t = useTranslations("World");
  const tc = useTranslations("Cup");
  const sim = useTranslations("Simulator");
  const [confirmReset, setConfirmReset] = useState(false);
  // The round shown: the first still open to begin with, the next one once a round is simulated.
  const [roundIndex, setRoundIndex] = useState(() => state.nextRound ?? state.rounds.length - 1);
  const { code, cup, rounds, picks } = state;
  const shown = Math.min(roundIndex, rounds.length - 1);
  const round = rounds[shown]!;
  const roundDecided = round.drawn !== "pending" && round.ties.every((tie) => tieWinner(tie, picks) !== null);
  const picked = Object.keys(picks).length > 0;
  const actionButton =
    "grow rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 lg:grow-0 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";

  const pw = useTranslations("PastWinners");
  // Past Winners instead of the rounds: this world's finished seasons of the cup (no real history yet).
  const [winners, setWinners] = useState(false);
  // The view, beside the season picker: the rounds (Fixtures), or Past Winners (the one shown is pressed).
  const view = (active: boolean) =>
    `flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold sm:flex-initial ${active ? "border-pitch-600 bg-pitch-600 text-white hover:bg-pitch-700" : "border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"}`;
  const picker = (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:col-start-1 lg:row-start-1 lg:self-center">
      <SeasonPicker
        world={world}
        year={year}
        country={cupCountry(code)}
        onYear={(y) => {
          // A season picked: its rounds again.
          setWinners(false);
          onYear(y);
        }}
      />
      <div className="flex gap-2">
        <button type="button" aria-pressed={!winners} onClick={() => setWinners(false)} className={view(!winners)} data-testid="world-table-view">
          <Icon name="calendar-days" size={16} className="shrink-0" />
          {tc("fixtures")}
        </button>
        <button type="button" aria-pressed={winners} onClick={() => setWinners(true)} className={view(winners)} data-testid="world-past-winners">
          <Icon name="trophy" size={16} className="shrink-0" />
          {pw("title")}
        </button>
      </div>
    </div>
  );
  if (winners) {
    return (
      <div className={grid}>
        {picker}
        <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-2" data-testid="world-winners" data-cup={code}>
          <PastWinners key={code} rows={worldCupWinners(world, code)} comingSoon />
        </div>
      </div>
    );
  }
  if (year !== world.year) {
    return (
      <div className={grid}>
        {picker}
        <PastCup key={`${year}-${code}`} world={world} year={year} code={code} />
      </div>
    );
  }
  return (
    <div className={grid}>
      {picker}
      <div className="flex flex-wrap gap-2 lg:col-start-2 lg:row-start-1 lg:justify-end" data-testid="world-actions">
        <button
          type="button"
          className="grow rounded-lg bg-pitch-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pitch-700 disabled:opacity-40 lg:grow-0"
          onClick={() => {
            onChange(simulateWorldCupRound(world, code, shown));
            // Show the next round, which has just been drawn.
            if (shown < rounds.length - 1) setRoundIndex(shown + 1);
          }}
          disabled={round.drawn === "pending" || roundDecided}
          data-testid="world-simulate-round"
        >
          {tc("simulateRound")}
        </button>
        <button
          type="button"
          className={actionButton}
          onClick={() => {
            onChange(simulateWorldCupRest(world, code));
            setRoundIndex(rounds.length - 1);
          }}
          disabled={state.done}
          data-testid="world-simulate-rest"
        >
          {tc("simulateAll")}
        </button>
        <button type="button" className={actionButton} onClick={onUndo} disabled={!canUndo} data-testid="world-undo">
          {sim("undo")}
        </button>
        <button type="button" className={actionButton} onClick={() => setConfirmReset(true)} disabled={!picked} data-testid="world-reset-cup">
          {sim("reset")}
        </button>
      </div>
      <div className="min-w-0 space-y-4 lg:col-span-2 lg:col-start-1 lg:row-start-2" data-testid="world-cup" data-cup={code}>
        <CupRounds
          cup={cup}
          rounds={rounds}
          teams={state.teams}
          predictions={picks}
          divisions={state.divisions}
          onScore={(fixture, score) => onChange(setCupScore(world, code, fixture, score))}
          onSimulate={(fixture) => onChange(rollCupScore(world, code, fixture))}
          roundIndex={shown}
          onSelect={setRoundIndex}
          kickOff={false}
          ownDraw
        />
        <CupChampion cup={cup} rounds={rounds} winner={state.winner} predictions={picks} teams={state.teams} season={worldSeasonLabel(world, world.year, cupCountry(code))} />
      </div>
      <ConfirmDialog
        open={confirmReset}
        danger
        title={t("resetCupTitle")}
        message={t(state.season.real ? "resetConfirmFirst" : "resetConfirm", { in: t(`cups.${code}.in`) })}
        confirmLabel={t("resetCupAction")}
        cancelLabel={sim("cancel")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          onChange(resetCup(world, code));
          setConfirmReset(false);
        }}
      />
    </div>
  );
}
