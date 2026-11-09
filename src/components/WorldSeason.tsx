"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import type { SiteLocale } from "../config/leagues.ts";
import { playoffCancelled } from "../engine/playoffs.ts";
import type { Fixture, Score, Team, TeamId } from "../engine/types.ts";
import { ordinal } from "../lib/clubText.ts";
import {
  bracketOpen,
  COUNTRY_CUPS,
  COUNTRY_LEAGUES,
  divisionCountry,
  pastDivision,
  playoffConfigOf,
  playoutOf,
  pyramidPlayoffOf,
  resetDivision,
  rollScore,
  worldSeasonLabel,
  setScore,
  simulateMatchday,
  simulatePlayoffs,
  simulateRest,
  tableRows,
  type DivisionCode,
  type DivisionState,
  type World,
  type WorldCountry,
} from "../lib/myWorld.ts";
import { isWorldCup, type WorldCupCode } from "../lib/worldCups.ts";
import { worldWinners } from "../lib/worldWinners.ts";
import { isSplitDivision, serieCFinalZones, serieCFormat, serieCTables, type SerieCPhase } from "../lib/worldSerieC.ts";
import { groupOfRound, GROUP_ROUND_BASE } from "../engine/split.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { FixtureList, PLAYOFF_MATCHDAY, PLAYOUT_MATCHDAY } from "./FixtureList.tsx";
import { Icon } from "./Icon.tsx";
import { PastWinners } from "./PastWinners.tsx";
import { useRealWinners } from "./PastWinnersProvider.tsx";
import { PromotedClubs } from "./PromotedClubs.tsx";
import { WorldTable } from "./WorldTable.tsx";
import { ZoneColumns, zoneStageShown } from "./WorldZones.tsx";

/** A country's competitions as tabs: one button per league, then its cups. */
export function DivisionTabs({ country, value, onChange, label, testId }: { country: WorldCountry; value: DivisionCode | WorldCupCode; onChange: (code: DivisionCode | WorldCupCode) => void; label: string; testId: string }) {
  const t = useTranslations("World");
  const codes = [...COUNTRY_LEAGUES[country], ...COUNTRY_CUPS[country]];
  const columns = codes.length >= 6 ? "sm:grid-cols-3 lg:grid-cols-6" : codes.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-3";
  return (
    <div role="tablist" aria-label={label} className={`grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 ${columns}`} data-testid={testId} data-country={country}>
      {codes.map((code) => (
        <button
          key={code}
          type="button"
          role="tab"
          aria-selected={value === code}
          onClick={() => onChange(code)}
          className={`min-h-9 rounded-md px-2 text-sm font-semibold ${value === code ? "bg-white shadow-sm dark:bg-zinc-900" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300"}`}
          data-league={code}
        >
          {t(isWorldCup(code) ? `cups.${code}.name` : `leagues.${code}.name`)}
        </button>
      ))}
    </div>
  );
}

/** Série C's round names: "Group A, round 1" for the second phase's (its keys from GROUP_ROUND_BASE). */
function splitRounds(t: ReturnType<typeof useTranslations<"World">>, matchdays: readonly number[], year: number, code: DivisionCode): Record<number, string> | undefined {
  if (!isSplitDivision(code)) return undefined;
  const two = serieCFormat(year).groups === 2;
  const labels: Record<number, string> = {};
  for (const md of matchdays) {
    const g = groupOfRound(md);
    if (g === null) continue;
    labels[md] = t("serieC.round", { group: t(two ? "serieC.promotionGroup" : "serieC.group", { group: String.fromCharCode(65 + g) }), round: md % GROUP_ROUND_BASE });
  }
  return labels;
}

/** Série C's tables in progress: the first phase (one table or two groups), then the second phase's groups. */
function SerieCTables({ split, code, world }: { split: SerieCPhase; code: DivisionCode; world: World }) {
  const t = useTranslations("World");
  const letter = (g: number | null) => String.fromCharCode(65 + (g ?? 0));
  return (
    <div className="space-y-4" data-testid="world-split-tables">
      {serieCTables(split).map((table) => (
        <WorldTable
          key={`${table.kind}-${table.group}`}
          rows={tableRows(table.rows)}
          code={code}
          clubs={world.clubs}
          highlight={world.userClub}
          final={false}
          testId={table.kind === "first" ? "world-table" : "world-group-table"}
          zones={table.zones}
          title={
            table.kind === "first"
              ? t("serieC.firstStage")
              : table.kind === "firstGroup"
                ? t("serieC.group", { group: letter(table.group) })
                : t(split.format.groups === 2 ? "serieC.promotionGroup" : "serieC.group", { group: letter(table.group) })
          }
        />
      ))}
      {!split.members && <p className="text-xs text-zinc-500" data-testid="world-split-note">{t(split.format.groups === 2 ? "serieC.secondPendingGroups" : "serieC.secondPending")}</p>}
    </div>
  );
}

/** The matchday a division's fixtures open on: its next round; once the league is complete, the play-off, or the play-out (Serie B) once the play-off has no game left; else its last matchday. */
export function openingMatchday(state: DivisionState): number {
  if (state.nextRound !== null) {
    if (!state.leagueComplete) return state.nextRound;
    const playoffLeft = state.playoff !== undefined && (!state.playoffKnown || bracketOpen(state.bracket, state.picks));
    return state.playout !== undefined && !playoffLeft && bracketOpen(state.playoutBracket, state.picks) ? PLAYOUT_MATCHDAY : PLAYOFF_MATCHDAY;
  }
  return state.playoff ? PLAYOFF_MATCHDAY : state.playout ? PLAYOUT_MATCHDAY : (state.fixtures.at(-1)?.matchday ?? 1);
}

/** A picker in the style of the page's buttons: an icon, then a select (labelled for screen readers). */
export function Picker({
  icon,
  label,
  value,
  options,
  onChange,
  testId,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label className="flex w-full items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold sm:w-auto dark:border-zinc-700 dark:bg-zinc-900">
      {icon}
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-0 flex-1 cursor-pointer bg-transparent pr-1 font-semibold text-zinc-900 focus:outline-none dark:text-zinc-100 dark:[color-scheme:dark]"
        data-testid={testId}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The season picker: this season, then every finished one, newest first. */
export function SeasonPicker({ world, year, onYear, country }: { world: World; year: number; onYear: (year: number) => void; /** The country shown: its leagues' or cup's season labels. */ country?: WorldCountry }) {
  const t = useTranslations("World");
  return (
    <Picker
      icon={<Icon name="calendar-days" size={16} className="shrink-0 text-zinc-500" />}
      label={t("seasonSelect")}
      value={String(year)}
      options={[
        { value: String(world.year), label: t("seasonCurrent", { season: worldSeasonLabel(world, world.year, country) }) },
        ...[...world.history].reverse().map((s) => ({ value: String(s.year), label: worldSeasonLabel(world, s.year, country) })),
      ]}
      onChange={(y) => onYear(Number(y))}
      testId="world-season-select"
    />
  );
}

/** A finished season's league, to look back at: its final table, its play-off final, and every result (nothing to change). */
function PastSeason({ world, year, code }: { world: World; year: number; code: DivisionCode }) {
  const t = useTranslations("World");
  const past = useMemo(() => pastDivision(world, year, code), [world, year, code]);
  const [matchday, setMatchday] = useState(1);
  const [playoffStage, setPlayoffStage] = useState<number | null>(null);
  const teams = useMemo(() => new Map<TeamId, Team>((past?.teams ?? []).map((team) => [team.id, team])), [past]);
  if (!past) return null;
  // Argentina's zone leagues: each tournament's zone tables and play-off, rebuilt from the saved season.
  if (past.zones && past.fixtures) {
    return (
      <ZoneColumns
        world={world}
        year={year}
        code={code}
        season={past.zones}
        fixtures={past.fixtures}
        teams={teams}
        picks={{}}
        matchday={matchday}
        onMatchday={setMatchday}
        readOnly
        onScore={() => {}}
        onSimulate={() => {}}
        playoffStage={playoffStage}
        onPlayoffStage={setPlayoffStage}
      />
    );
  }
  const playoff = playoffConfigOf(code);
  const matchdays = [...new Set((past.fixtures ?? []).map((f) => f.matchday))]
    .sort((a, b) => a - b)
    .concat(past.bracket.length ? [PLAYOFF_MATCHDAY] : [])
    .concat(past.playout.length ? [PLAYOUT_MATCHDAY] : []);
  const final = past.final;
  return (
    <>
      <div className="min-w-0 space-y-2 lg:col-span-2 lg:col-start-1 lg:row-start-2">
        <WorldTable
          rows={past.rows}
          code={code}
          clubs={world.clubs}
          highlight={world.userClub}
          final
          testId="world-past-table"
          {...(isSplitDivision(code) ? { zones: serieCFinalZones(year, past.rows.length), title: t("serieC.classification") } : {})}
        />
        {final && (
          <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400" data-testid="world-past-final">
            <Icon name="trophy" size={16} className="shrink-0 text-amber-500" />
            {t("review.final", {
              winner: world.clubs[final[0]]!.name,
              loser: world.clubs[final[1]]!.name,
              score: final[4] ? t("review.penalties", { score: `${final[2]}–${final[3]}` }) : `${final[2]}–${final[3]}`,
            })}
          </p>
        )}
      </div>
      <div className="min-w-0 lg:col-start-3 lg:row-start-2" data-testid="world-fixtures">
        {past.fixtures ? (
          <FixtureList
            matchday={matchday}
            matchdays={matchdays}
            onMatchdayChange={setMatchday}
            {...(splitRounds(t, matchdays, year, code) ? { roundLabels: splitRounds(t, matchdays, year, code)! } : {})}
            fixtures={past.fixtures.filter((f) => f.matchday === matchday)}
            teams={teams}
            predictions={{}}
            onScore={() => {}}
            onSimulate={() => {}}
            kickOff={false}
            readOnly
            {...(playoff && past.bracket.length
              ? { playoff: { bracket: past.bracket, seasonComplete: true, ...(playoff.promotedTo ? { promotedTo: playoff.promotedTo } : {}) } }
              : {})}
            {...(past.playout.length ? { playout: { bracket: past.playout, seasonComplete: true } } : {})}
          />
        ) : (
          <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300" data-testid="world-past-no-fixtures">
            {t("pastNoFixtures")}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * One league's season, as on the league pages: its table and its fixtures
 * matchday by matchday, every score open to typing in or rolling with the
 * dice, and the same buttons (simulate the matchday, the rest of the season,
 * undo, reset). No match previews: the games are the world's own. The season
 * picker beside the buttons shows a finished season instead, to look back at.
 */
export function WorldSeason({
  world,
  state,
  year,
  onYear,
  matchday,
  onMatchday,
  onChange,
  canUndo,
  onUndo,
  locale,
}: {
  world: World;
  state: DivisionState;
  locale: SiteLocale;
  /** The season shown: the one in progress (world.year) or a finished one. */
  year: number;
  onYear: (year: number) => void;
  matchday: number;
  onMatchday: (matchday: number) => void;
  onChange: (world: World) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const t = useTranslations("World");
  const sim = useTranslations("Simulator");
  const pw = useTranslations("PastWinners");
  const [confirmReset, setConfirmReset] = useState(false);
  // A zone league (Argentina's): the tournament whose play-off shows, when the fixtures are on the play-off.
  const [playoffStage, setPlayoffStage] = useState<number | null>(null);
  // Past Winners instead of the table and fixtures: the league's real history with this world's finished seasons on top.
  const [winners, setWinners] = useState(false);
  const real = useRealWinners();
  const { code, picks } = state;
  const playoff = state.playoff;
  // A pyramid play-off's places before its clubs are known: "16th in the Bundesliga" v "3rd in the 2. Bundesliga".
  const tie = pyramidPlayoffOf(code);
  const slotLabels = tie?.lower === code ? { [tie.upperPlace]: `${ordinal(tie.upperPlace, locale)} ${t(`leagues.${tie.upper}.in`)}`, [tie.lowerPlace]: `${ordinal(tie.lowerPlace, locale)} ${t(`leagues.${code}.in`)}` } : undefined;
  // No play-off when the table makes it unnecessary (Serie B's 3rd more than 14 points clear of 4th): that club goes up directly.
  const playoffOff = Boolean(playoff && state.playoffKnown && playoffCancelled(playoff, state.playoffRows));
  // The relegation play-out (Serie B's 16th v 17th), and the note when the table has made it unnecessary.
  const playoutRule = playoutOf(code);
  const clubAt = (place: number) => world.clubs[state.rows.find((r) => r.position === place)?.teamId ?? -1]?.name ?? "";
  const playoutNote = state.playoutCancelled && playoutRule ? t("playOutCancelled", { lower: clubAt(playoutRule.places[1]), upper: clubAt(playoutRule.places[0]), gap: playoutRule.gap }) : undefined;
  // The league's clubs, and a pyramid play-off's club from the division above (the Bundesliga's 16th in the 2. Bundesliga's tie).
  const teams = useMemo(() => {
    const map = new Map<TeamId, Team>(state.teams.map((team) => [team.id, team]));
    for (const r of state.playoffRows) {
      const c = world.clubs[r.teamId];
      if (c && !map.has(r.teamId)) map.set(r.teamId, { id: c.id, name: c.name, shortName: c.shortName, tla: c.tla, ...(c.crest ? { crest: c.crest } : {}) });
    }
    // Série C's second phase before its groups are known: places standing in for the clubs ("1st", "2nd in Group A").
    for (const [id, slot] of state.split?.slots ?? []) {
      const place = ordinal(slot.place, locale);
      const name = slot.group === null ? place : t("serieC.slot", { place, group: String.fromCharCode(65 + slot.group) });
      map.set(id, { id, name, shortName: name, tla: "" });
    }
    return map;
  }, [state.teams, state.playoffRows, state.split, world.clubs, locale, t]);
  const matchdays = useMemo(
    () =>
      [...new Set(state.fixtures.map((f) => f.matchday))]
        .sort((a, b) => a - b)
        .concat(playoff ? [PLAYOFF_MATCHDAY] : [])
        .concat(state.playout ? [PLAYOUT_MATCHDAY] : []),
    [state.fixtures, playoff, state.playout],
  );
  const onPlayoff = matchday === PLAYOFF_MATCHDAY;
  const onPlayout = matchday === PLAYOUT_MATCHDAY;
  // A zone league's tournament on show (its play-off is the one "Simulate matchday" plays there).
  const zoneStage = state.zones ? state.zones.stages[zoneStageShown(state.zones, code, matchday, playoffStage)]! : undefined;
  const games = useMemo(() => state.fixtures.filter((f) => f.matchday === matchday), [state.fixtures, matchday]);
  const picked = Object.keys(picks).length > 0;

  const onScore = (fixture: Fixture, score: Score | null) => onChange(setScore(world, code, fixture, score));
  const actionButton =
    "grow rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 lg:grow-0 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";

  // Phones: the season picker, table, buttons, fixtures. Desktop, as on the league pages: the picker
  // and the buttons on one row above the table and fixtures columns.
  const grid = "grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[auto_minmax(0,1fr)_400px] lg:items-start";
  // The view, beside the season picker: the table and fixtures, or Past Winners (the one shown is pressed).
  const view = (active: boolean) =>
    `flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold sm:flex-initial ${active ? "border-pitch-600 bg-pitch-600 text-white hover:bg-pitch-700" : "border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"}`;
  const picker = (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:col-start-1 lg:row-start-1 lg:self-center">
      <SeasonPicker
        world={world}
        year={year}
        country={divisionCountry(code)}
        onYear={(y) => {
          // A season picked: its table again.
          setWinners(false);
          onYear(y);
        }}
      />
      <div className="flex gap-2">
        <button type="button" aria-pressed={!winners} onClick={() => setWinners(false)} className={view(!winners)} data-testid="world-table-view">
          <Icon name="table" size={16} className="shrink-0" />
          {sim("table")}
        </button>
        <button type="button" aria-pressed={winners} onClick={() => setWinners(true)} className={view(winners)} data-testid="world-past-winners">
          <Icon name="trophy" size={16} className="shrink-0" />
          {pw("title")}
        </button>
      </div>
    </div>
  );
  if (winners) {
    const rows = worldWinners(world, code, real[code] ?? null);
    return (
      <div className={grid}>
        {picker}
        <div className="min-w-0 lg:col-span-3 lg:col-start-1 lg:row-start-2" data-testid="world-winners">
          <PastWinners key={code} rows={rows} comingSoon={!real[code]} />
        </div>
      </div>
    );
  }
  if (year !== world.year) {
    return (
      <div className={grid}>
        {picker}
        <PastSeason key={`${year}-${code}`} world={world} year={year} code={code} />
      </div>
    );
  }
  // Argentina's zone leagues: the zones' tables and a tournament's fixtures and play-off (src/components/WorldZones.tsx).
  const zoneColumns = state.zones ? (
    <ZoneColumns
      world={world}
      year={world.year}
      code={code}
      season={state.zones}
      fixtures={state.fixtures}
      teams={teams}
      picks={picks}
      matchday={matchday}
      onMatchday={onMatchday}
      readOnly={false}
      onScore={onScore}
      onSimulate={(fixture) => onChange(rollScore(world, code, fixture))}
      playoffStage={playoffStage}
      onPlayoffStage={setPlayoffStage}
    />
  ) : null;
  return (
    <div className={grid}>
      {picker}
      {zoneColumns}
      {!zoneColumns && (
      <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-2">
        {state.split ? (
          <SerieCTables split={state.split} code={code} world={world} />
        ) : (
          <WorldTable rows={tableRows(state.rows)} code={code} clubs={world.clubs} highlight={world.userClub} final={false} testId="world-table" />
        )}
        {playoff?.promotedTo && (
          <PromotedClubs
            bracket={state.bracket}
            rows={state.eligibleRows}
            teams={teams}
            predictions={picks}
            seasonComplete={state.playoffKnown}
            directPromotion={playoff.directPromotion ?? []}
            promotedTo={playoff.promotedTo}
            nextSeason={worldSeasonLabel(world, world.year + 1, divisionCountry(code))}
            cancelled={playoffOff}
            {...(playoff.directIfClear ? { clearPosition: playoff.directIfClear.position } : {})}
          />
        )}
      </div>
      )}
      <div className="flex flex-wrap gap-2 lg:col-span-2 lg:col-start-2 lg:row-start-1 lg:justify-end" data-testid="world-actions">
        <button
          type="button"
          className="grow rounded-lg bg-pitch-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pitch-700 disabled:opacity-40 lg:grow-0"
          onClick={() => onChange(onPlayoff || onPlayout ? simulatePlayoffs(world, code, undefined, zoneStage?.index) : simulateMatchday(world, code, matchday))}
          disabled={(onPlayoff && (zoneStage ? !zoneStage.complete || zoneStage.decided : !state.playoffKnown)) || (onPlayout && !state.leagueComplete) || state.done}
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
      {!zoneColumns && (
      <div className="min-w-0 lg:col-start-3 lg:row-start-2" data-testid="world-fixtures">
        <FixtureList
          matchday={matchday}
          matchdays={matchdays}
          onMatchdayChange={onMatchday}
          {...(splitRounds(t, matchdays, world.year, code) ? { roundLabels: splitRounds(t, matchdays, world.year, code)! } : {})}
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
                  seasonComplete: state.playoffKnown,
                  ...(playoff.promotedTo ? { promotedTo: playoff.promotedTo } : {}),
                  ...(slotLabels ? { slotLabels } : {}),
                  ...(playoffOff && playoff.directIfClear ? { cancelled: playoff.directIfClear } : {}),
                },
              }
            : {})}
          {...(state.playout
            ? { playout: { bracket: state.playoutBracket, seasonComplete: state.leagueComplete, ...(playoutNote ? { cancelledNote: playoutNote } : {}) } }
            : {})}
        />
      </div>
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
