"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { needsShootout, seriesGames, tieOutcome, type PlayoffSide, type PlayoffTie } from "../engine/playoffs.ts";
import type { Fixture, ResultMap, Score, Team, TeamId } from "../engine/types.ts";
import { TeamBadge } from "./TeamBadge.tsx";

/** Value of the "Playoff" entry in the matchday selector (after the last matchday). */
export const PLAYOFF_MATCHDAY = -1;

export interface PlayoffView {
  bracket: PlayoffTie[][];
  /** Every league match has a score, so the seeding is final and legs can be edited. */
  seasonComplete: boolean;
  /** Promotion play-off: the league the winners go up to. */
  promotedTo?: string;
  /** Title play-off: the competition its winner is champion of (e.g. "MLS Cup"). */
  title?: string;
  /** Short group (conference) names, for slots like "1st in the East". */
  groupNames?: string[];
}

interface Props {
  matchday: number;
  matchdays: number[];
  onMatchdayChange: (matchday: number) => void;
  fixtures: Fixture[];
  teams: Map<TeamId, Team>;
  predictions: ResultMap;
  onScore: (fixture: Fixture, score: Score | null) => void;
  onSimulate: (fixture: Fixture) => void;
  playoff?: PlayoffView;
}

export function FixtureList(props: Props) {
  const { matchday, matchdays, onMatchdayChange, fixtures, teams, predictions, onScore, onSimulate, playoff } = props;
  const t = useTranslations("Simulator");
  const index = matchdays.indexOf(matchday);
  const navButton =
    "rounded-lg px-3 py-1.5 text-lg leading-none hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800";

  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-100 px-2 py-2 dark:border-zinc-800">
        <button
          type="button"
          className={navButton}
          aria-label={t("previous")}
          disabled={index <= 0}
          onClick={() => onMatchdayChange(matchdays[index - 1]!)}
        >
          ‹
        </button>
        <select
          className="cursor-pointer rounded-md border border-transparent bg-white px-2 py-1 text-sm font-semibold text-zinc-900 hover:border-zinc-300 focus:border-pitch-500 focus:outline-none dark:bg-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark] dark:hover:border-zinc-700"
          value={matchday}
          onChange={(e) => onMatchdayChange(Number(e.target.value))}
          data-testid="matchday-select"
          aria-label={t("fixtures")}
        >
          {matchdays.map((md) => (
            <option key={md} value={md} className="bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              {md === PLAYOFF_MATCHDAY ? t("playoffs") : t("matchday", { number: md })}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={navButton}
          aria-label={t("next")}
          disabled={index >= matchdays.length - 1}
          onClick={() => onMatchdayChange(matchdays[index + 1]!)}
        >
          ›
        </button>
      </header>
      {matchday === PLAYOFF_MATCHDAY && playoff ? (
        <PlayoffTies {...props} playoff={playoff} />
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {fixtures.map((f) => (
            <MatchRow
              key={f.id}
              fixture={f}
              home={teams.get(f.homeId)!}
              away={teams.get(f.awayId)!}
              prediction={predictions[f.id]}
              onScore={(score) => onScore(f, score)}
              onSimulate={() => onSimulate(f)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Two-legged play-off ties: both legs, the rule and the aggregate once decided. */
function PlayoffTies({ playoff, teams, predictions, onScore, onSimulate }: Props & { playoff: PlayoffView }) {
  const t = useTranslations("Simulator");
  const { bracket, seasonComplete } = playoff;
  const lastRound = bracket.length - 1;

  // A side is a club once known; before that its table position (league not
  // finished) or "Semi-final winner" style text (earlier round not decided).
  /** Table positions that can fill a side: its own, or those of the earlier tie it comes from. */
  const seeds = (side: PlayoffSide): number[] => {
    if (side.from) {
      const tie = bracket[side.from.round]?.find((x) => x.index === side.from!.tie);
      return tie ? [...seeds(tie.higher), ...seeds(tie.lower)].sort((a, b) => a - b) : [];
    }
    return side.position !== null ? [side.position] : [];
  };
  const groupName = (group: number | undefined) => (group !== undefined ? playoff.groupNames?.[group] : undefined);
  const label = (side: PlayoffSide) => {
    if (side.teamId !== null) return teams.get(side.teamId)?.shortName ?? "";
    const group = groupName(side.group);
    if (side.from) {
      // Conference brackets: name the seeds that can still come through, e.g. "Winner 1/8/9 (East)".
      const possible = seeds(side);
      const winnerOf =
        group && possible.length > 1 && possible.length <= 3
          ? t("playoffSeedsWinner", { seeds: possible.join("/") })
          : t("playoffWinnerOf", { round: bracket[side.from.round]![0]!.config.key });
      return group ? `${winnerOf} (${group})` : winnerOf;
    }
    return group ? t("playoffGroupPlace", { position: side.position ?? 0, group }) : t("playoffPlace", { position: side.position ?? 0 });
  };

  const rule = (tie: PlayoffTie) => {
    const { config } = tie;
    // Before an earlier round decides it, the host is just "the higher seed".
    const higher = tie.higher.teamId === null && tie.higher.from ? t("playoffHigherSeed") : label(tie.higher);
    if (config.bestOf) return t("playoffRuleSeries", { higher });
    if (config.levelTie === "betterPlaced") return t("playoffRule", { higher });
    if (config.venue) return t("playoffRuleFinal", { venue: config.venue });
    if (config.legs === 2) return t("playoffRuleTwoLegs", { higher });
    return config.noExtraTime ? t("playoffRuleOneLegPenalties", { higher }) : t("playoffRuleOneLeg", { higher });
  };

  const scoreRow = (fixture: Fixture, label?: string) => (
    <MatchRow
      key={`${fixture.id}-${fixture.homeId}-${fixture.awayId}`}
      fixture={fixture}
      home={teams.get(fixture.homeId)!}
      away={teams.get(fixture.awayId)!}
      prediction={predictions[fixture.id]}
      {...(label ? { label } : {})}
      onScore={(score) => onScore(fixture, score)}
      onSimulate={() => onSimulate(fixture)}
    />
  );

  return (
    <div data-testid="playoff">
      {!seasonComplete && <p className="px-3 pt-2 text-xs text-zinc-500">{t("playoffProjected")}</p>}
      {bracket.map((round, r) => (
        <div key={r} data-testid="playoff-round">
          {bracket.length > 1 && (
            <h3 className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
              {t("playoffRound", { round: round[0]!.config.key })}
            </h3>
          )}
          {round.map((tie, i) => {
            const outcome = tieOutcome(tie, predictions);
            // Conference rounds: a sub-heading before each conference's ties.
            const group = groupName(tie.group);
            const groupHeading = group && round[i - 1]?.group !== tie.group;
            const known = tie.legs.length > 0;
            const showShootout = tie.shootout && (needsShootout(tie, predictions) || predictions[tie.shootout.id]);
            const pens = tie.shootout ? (predictions[tie.shootout.id] ?? tie.shootout.result) : null;
            return (
              <div key={tie.index} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800" data-testid="playoff-tie">
                {groupHeading && (
                  <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-pitch-700 dark:text-pitch-100" data-testid="playoff-group">
                    {group}
                  </p>
                )}
                <div className="px-3 pt-3">
                  <h4 className="text-sm font-semibold">
                    {label(tie.higher)} × {label(tie.lower)}
                  </h4>
                  <p className="text-xs text-zinc-500">{rule(tie)}</p>
                </div>
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {!known
                    ? Array.from({ length: tie.config.legs }, (_, i) => {
                        // Two legs: lower-placed side hosts the first.
                        const [home, away] = tie.config.legs === 2 && i === 0 ? [tie.lower, tie.higher] : [tie.higher, tie.lower];
                        return <PlaceholderRow key={i} utcDate="" home={label(home)} away={label(away)} />;
                      })
                    : tie.config.bestOf
                      ? // A series: each game still needed, with its own shoot-out when drawn.
                        seriesGames(tie, predictions)
                          .filter((g) => g.needed)
                          .flatMap((g, n) => [
                            scoreRow(g.game, t("playoffGame", { number: n + 1 })),
                            ...(g.needsPenalties || predictions[g.shootout.id] ? [scoreRow(g.shootout, t("penalties"))] : []),
                          ])
                      : tie.legs.map((leg) => scoreRow(leg, leg.neutral && tie.config.venue ? tie.config.venue : undefined))}
                  {showShootout && tie.shootout && (
                    <MatchRow
                      key={`${tie.shootout.id}-${tie.shootout.homeId}-${tie.shootout.awayId}`}
                      fixture={tie.shootout}
                      home={teams.get(tie.shootout.homeId)!}
                      away={teams.get(tie.shootout.awayId)!}
                      prediction={predictions[tie.shootout.id]}
                      label={t("penalties")}
                      onScore={(score) => onScore(tie.shootout!, score)}
                      onSimulate={() => onSimulate(tie.shootout!)}
                    />
                  )}
                </ul>
                {outcome && (
                  <p className="bg-pitch-50 px-3 py-2 text-sm font-medium text-pitch-900 dark:bg-pitch-900/30 dark:text-pitch-100" data-testid="playoff-result">
                    {tie.config.bestOf &&
                      t("playoffSeries", {
                        higher: label(tie.higher),
                        lower: label(tie.lower),
                        hw: outcome.higherGoals,
                        lw: outcome.lowerGoals,
                      }) + " "}
                    {tie.config.legs === 2 &&
                      t("playoffAggregate", {
                        higher: label(tie.higher),
                        lower: label(tie.lower),
                        hg: outcome.higherGoals,
                        lg: outcome.lowerGoals,
                      }) + " "}
                    {outcome.onPenalties &&
                      pens &&
                      t("playoffOnPenalties", {
                        winner: teams.get(outcome.winner)?.shortName ?? "",
                        wp: Math.max(pens.home, pens.away),
                        lp: Math.min(pens.home, pens.away),
                      }) + " "}
                    {r === lastRound && playoff.title
                      ? t("playoffChampion", { winner: teams.get(outcome.winner)?.shortName ?? "", title: playoff.title })
                      : r === lastRound && playoff.promotedTo
                        ? t("playoffPromoted", { winner: teams.get(outcome.winner)?.shortName ?? "", promotedTo: playoff.promotedTo })
                        : t("playoffAdvances", { winner: teams.get(outcome.winner)?.shortName ?? "" })}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface RowProps {
  /** Read-only (e.g. a projected play-off before the season ends). */
  disabled?: boolean;
  /** Shown above the match, after the kick-off time (e.g. "Wembley", "Penalties"). */
  label?: string;
  fixture: Fixture;
  home: Team;
  away: Team;
  prediction: Score | undefined;
  onScore: (score: Score | null) => void;
  onSimulate: () => void;
}

function parseGoals(text: string): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  return Number(text);
}

export function MatchRow({ fixture, home, away, prediction, onScore, onSimulate, disabled = false, label }: RowProps) {
  const t = useTranslations("Simulator");
  const shown = prediction ?? fixture.result ?? null;
  const locked = fixture.result !== null && prediction === undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ home: shown ? String(shown.home) : "", away: shown ? String(shown.away) : "" });

  // Follow external changes (simulate, undo, reset).
  useEffect(() => {
    setDraft({ home: shown ? String(shown.home) : "", away: shown ? String(shown.away) : "" });
  }, [shown?.home, shown?.away]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (side: "home" | "away", value: string) => {
    const next = { ...draft, [side]: value.replace(/\D/g, "").slice(0, 2) };
    setDraft(next);
    const h = parseGoals(next.home);
    const a = parseGoals(next.away);
    if (h !== null && a !== null) onScore({ home: h, away: a });
    else if (next.home === "" && next.away === "" && prediction) onScore(null);
  };

  const showInputs = !locked || editing;
  const scoreBox =
    "h-9 w-10 rounded-md border text-center text-base font-bold tabular-nums outline-none focus:border-pitch-500 focus:ring-2 focus:ring-pitch-500/30";
  const inputTone = prediction
    ? "border-pitch-500/60 bg-pitch-50 dark:bg-pitch-900/40"
    : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <li className="px-3 py-2.5" data-testid="match-row" data-fixture={fixture.id}>
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
        <span>
          <KickOff utcDate={fixture.utcDate} />
          {label && <span className="font-semibold"> · {label}</span>}
        </span>
        {fixture.result && !prediction && <span className="font-semibold uppercase tracking-wide">{t("realResult")}</span>}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className="flex min-w-0 items-center justify-end gap-2 text-right text-sm font-medium">
          <span className="truncate">{home.shortName}</span>
          <TeamBadge team={home} size={22} />
        </span>
        <span className="flex items-center gap-1">
          {showInputs ? (
            <>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                aria-label={t("homeGoals", { team: home.name })}
                className={`${scoreBox} ${inputTone} disabled:cursor-not-allowed disabled:opacity-50`}
                disabled={disabled}
                value={draft.home}
                onChange={(e) => update("home", e.target.value)}
              />
              <span className="text-zinc-400">–</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                aria-label={t("awayGoals", { team: away.name })}
                className={`${scoreBox} ${inputTone} disabled:cursor-not-allowed disabled:opacity-50`}
                disabled={disabled}
                value={draft.away}
                onChange={(e) => update("away", e.target.value)}
              />
            </>
          ) : (
            <button
              type="button"
              title={t("editResult")}
              onClick={() => !disabled && setEditing(true)}
              className="flex h-9 items-center gap-1 rounded-md bg-zinc-100 px-3 text-base font-bold tabular-nums dark:bg-zinc-800"
            >
              {shown!.home} <span className="text-zinc-400">–</span> {shown!.away}
            </button>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <TeamBadge team={away} size={22} />
          <span className="truncate">{away.shortName}</span>
        </span>
      </div>
      {showInputs && !disabled && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={onSimulate}
            title={t("simulateMatch")}
            aria-label={t("simulateMatch")}
            className="rounded-md px-1.5 text-base hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            🎲
          </button>
        </div>
      )}
    </li>
  );
}

/** A play-off leg whose clubs aren't decided yet, e.g. "6th place × 3rd place". */
function PlaceholderRow({ utcDate, home, away }: { utcDate: string; home: string; away: string }) {
  const box = "h-9 w-10 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700";
  return (
    <li className="px-3 py-2.5" data-testid="playoff-placeholder">
      <div className="mb-1 text-[11px] text-zinc-500">
        <KickOff utcDate={utcDate} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm font-medium text-zinc-500">
        <span className="truncate text-right">{home}</span>
        <span className="flex items-center gap-1" aria-hidden>
          <span className={box} />
          <span className="text-zinc-400">–</span>
          <span className={box} />
        </span>
        <span className="truncate">{away}</span>
      </div>
    </li>
  );
}

/**
 * Kick-off in the viewer's own time zone. next-intl would otherwise use the
 * server's zone (UTC on Vercel), so the browser's zone is passed explicitly.
 * Rendered after mount so server and first client render match.
 */
function KickOff({ utcDate }: { utcDate: string }) {
  const format = useFormatter();
  const [timeZone, setTimeZone] = useState<string | null>(null);
  useEffect(() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  if (!timeZone || Number.isNaN(Date.parse(utcDate))) return <span>&nbsp;</span>;
  return (
    <span data-testid="kickoff" data-utc={utcDate}>
      {format.dateTime(new Date(utcDate), {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      })}
    </span>
  );
}
