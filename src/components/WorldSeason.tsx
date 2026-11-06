"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { Fixture, Score, Team, TeamId } from "../engine/types.ts";
import {
  ENGLAND,
  resetDivision,
  rollScore,
  seasonLabel,
  setScore,
  simulateMatchday,
  simulatePlayoffs,
  simulateRest,
  tableRows,
  type DivisionCode,
  type DivisionState,
  type World,
} from "../lib/myWorld.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { FixtureList, PLAYOFF_MATCHDAY } from "./FixtureList.tsx";
import { PromotedClubs } from "./PromotedClubs.tsx";
import { WorldTable } from "./WorldTable.tsx";

/** A division picker: one button per league, as tabs. */
export function DivisionTabs({ value, onChange, label, testId }: { value: DivisionCode; onChange: (code: DivisionCode) => void; label: string; testId: string }) {
  const t = useTranslations("World");
  return (
    <div role="tablist" aria-label={label} className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 sm:grid-cols-4 dark:bg-zinc-800" data-testid={testId}>
      {ENGLAND.map((code) => (
        <button
          key={code}
          type="button"
          role="tab"
          aria-selected={value === code}
          onClick={() => onChange(code)}
          className={`min-h-9 rounded-md px-2 text-sm font-semibold ${value === code ? "bg-white shadow-sm dark:bg-zinc-900" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300"}`}
          data-league={code}
        >
          {t(`leagues.${code}.name`)}
        </button>
      ))}
    </div>
  );
}

/** The matchday a division's fixtures open on: its next round, the play-off once the league is complete, else its last matchday. */
export function openingMatchday(state: DivisionState): number {
  if (state.nextRound !== null) return state.leagueComplete ? PLAYOFF_MATCHDAY : state.nextRound;
  return state.league.playoff ? PLAYOFF_MATCHDAY : (state.fixtures.at(-1)?.matchday ?? 1);
}

/**
 * One league's season in progress, as on the league pages: its table and its
 * fixtures matchday by matchday, every score open to typing in or rolling
 * with the dice, and the same buttons (simulate the matchday, the rest of the
 * season, undo, reset). No match previews: the games are the world's own.
 */
export function WorldSeason({
  world,
  state,
  matchday,
  onMatchday,
  onChange,
  canUndo,
  onUndo,
  editable,
}: {
  world: World;
  state: DivisionState;
  matchday: number;
  onMatchday: (matchday: number) => void;
  onChange: (world: World) => void;
  canUndo: boolean;
  onUndo: () => void;
  /** Off while the last season's review shows (the next season hasn't started). */
  editable: boolean;
}) {
  const t = useTranslations("World");
  const sim = useTranslations("Simulator");
  const [confirmReset, setConfirmReset] = useState(false);
  const { code, league, picks } = state;
  const playoff = league.playoff;
  const teams = useMemo(() => new Map<TeamId, Team>(state.teams.map((team) => [team.id, team])), [state.teams]);
  const matchdays = useMemo(
    () => [...new Set(state.fixtures.map((f) => f.matchday))].sort((a, b) => a - b).concat(playoff ? [PLAYOFF_MATCHDAY] : []),
    [state.fixtures, playoff],
  );
  const onPlayoff = matchday === PLAYOFF_MATCHDAY;
  const games = useMemo(() => state.fixtures.filter((f) => f.matchday === matchday), [state.fixtures, matchday]);
  const picked = Object.keys(picks).length > 0;

  const onScore = (fixture: Fixture, score: Score | null) => onChange(setScore(world, code, fixture, score));
  const actionButton =
    "grow rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 lg:grow-0 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";

  // Phones: table, buttons, fixtures. Desktop, as on the league pages: the buttons above the table and fixtures columns.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
      <div className={`min-w-0 ${editable ? "lg:col-start-1 lg:row-start-2" : "lg:col-span-2"}`}>
        <WorldTable rows={tableRows(state.rows)} code={code} clubs={world.clubs} highlight={world.userClub} final={false} testId="world-table" />
        {playoff?.promotedTo && (
          <PromotedClubs
            bracket={state.bracket}
            rows={state.rows}
            teams={teams}
            predictions={picks}
            seasonComplete={state.leagueComplete}
            directPromotion={playoff.directPromotion ?? []}
            promotedTo={playoff.promotedTo}
            nextSeason={seasonLabel(world.year + 1)}
          />
        )}
      </div>
      {editable && (
        <>
          <div className="flex flex-wrap gap-2 lg:col-span-2 lg:col-start-1 lg:row-start-1 lg:justify-end" data-testid="world-actions">
            <button
              type="button"
              className="grow rounded-lg bg-pitch-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pitch-700 disabled:opacity-40 lg:grow-0"
              onClick={() => onChange(onPlayoff ? simulatePlayoffs(world, code) : simulateMatchday(world, code, matchday))}
              disabled={(onPlayoff && !state.leagueComplete) || state.done}
              data-testid="world-simulate-matchday"
            >
              {sim("simulateMatchday")}
            </button>
            <button type="button" className={actionButton} onClick={() => onChange(simulateRest(world, code))} disabled={state.done} data-testid="world-simulate-rest">
              {sim("simulateRest")}
            </button>
            <button type="button" className={actionButton} onClick={onUndo} disabled={!canUndo} data-testid="world-undo">
              {sim("undo")}
            </button>
            <button type="button" className={actionButton} onClick={() => setConfirmReset(true)} disabled={!picked} data-testid="world-reset-league">
              {sim("reset")}
            </button>
          </div>
          <div className="min-w-0 lg:col-start-2 lg:row-start-2" data-testid="world-fixtures">
            <FixtureList
              matchday={matchday}
              matchdays={matchdays}
              onMatchdayChange={onMatchday}
              fixtures={games}
              teams={teams}
              predictions={picks}
              onScore={onScore}
              onSimulate={(fixture) => onChange(rollScore(world, code, fixture))}
              kickOff={false}
              {...(playoff
                ? {
                    playoff: {
                      bracket: state.bracket,
                      seasonComplete: state.leagueComplete,
                      ...(playoff.promotedTo ? { promotedTo: playoff.promotedTo } : {}),
                    },
                  }
                : {})}
            />
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirmReset}
        danger
        title={t("resetTitle", { league: t(`leagues.${code}.name`) })}
        message={t(world.divisions.some((d) => d.code === code && d.games) ? "resetConfirmFirst" : "resetConfirm", { in: t(`leagues.${code}.in`) })}
        confirmLabel={t("resetAction")}
        cancelLabel={sim("cancel")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          onChange(resetDivision(world, code));
          setConfirmReset(false);
        }}
      />
    </div>
  );
}
