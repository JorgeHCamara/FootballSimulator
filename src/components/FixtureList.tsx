"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { expectedGoals, outcomeProbabilities } from "../engine/match.ts";
import { tieOutcome, type TwoLeggedTie } from "../engine/playoffs.ts";
import type { LeagueModel } from "../engine/ratings.ts";
import type { Fixture, ResultMap, Score, Team, TeamId } from "../engine/types.ts";
import { TeamBadge } from "./TeamBadge.tsx";

/** Value of the "Playoff" entry in the matchday selector (after the last matchday). */
export const PLAYOFF_MATCHDAY = -1;

export interface PlayoffView {
  ties: TwoLeggedTie[];
  /** Every league match has a score, so the seeding is final and legs can be edited. */
  seasonComplete: boolean;
  promotedTo: string;
}

interface Props {
  matchday: number;
  matchdays: number[];
  onMatchdayChange: (matchday: number) => void;
  fixtures: Fixture[];
  teams: Map<TeamId, Team>;
  predictions: ResultMap;
  model: LeagueModel;
  onScore: (fixture: Fixture, score: Score | null) => void;
  onSimulate: (fixture: Fixture) => void;
  playoff?: PlayoffView;
}

export function FixtureList(props: Props) {
  const { matchday, matchdays, onMatchdayChange, fixtures, teams, predictions, model, onScore, onSimulate, playoff } = props;
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
              model={model}
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
function PlayoffTies({ playoff, teams, predictions, model, onScore, onSimulate }: Props & { playoff: PlayoffView }) {
  const t = useTranslations("Simulator");
  const name = (id: TeamId) => teams.get(id)?.shortName ?? "";
  return (
    <div data-testid="playoff">
      {!playoff.seasonComplete && <p className="px-3 pt-2 text-xs text-zinc-500">{t("playoffProjected")}</p>}
      {playoff.ties.map((tie) => {
        const outcome = playoff.seasonComplete ? tieOutcome(tie, predictions) : null;
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
                  disabled={!playoff.seasonComplete}
                  onScore={(score) => onScore(leg, score)}
                  onSimulate={() => onSimulate(leg)}
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
                  promotedTo: playoff.promotedTo,
                })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface RowProps {
  /** Read-only (e.g. a projected play-off before the season ends). */
  disabled?: boolean;
  fixture: Fixture;
  home: Team;
  away: Team;
  prediction: Score | undefined;
  model: LeagueModel;
  onScore: (score: Score | null) => void;
  onSimulate: () => void;
}

function parseGoals(text: string): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  return Number(text);
}

export function MatchRow({ fixture, home, away, prediction, model, onScore, onSimulate, disabled = false }: RowProps) {
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

  const odds = outcomeProbabilities(expectedGoals(model, fixture.homeId, fixture.awayId));
  const pct = (x: number) => Math.round(x * 100);
  const showInputs = !locked || editing;
  const scoreBox =
    "h-9 w-10 rounded-md border text-center text-base font-bold tabular-nums outline-none focus:border-pitch-500 focus:ring-2 focus:ring-pitch-500/30";
  const inputTone = prediction
    ? "border-pitch-500/60 bg-pitch-50 dark:bg-pitch-900/40"
    : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950";

  return (
    <li className="px-3 py-2.5" data-testid="match-row" data-fixture={fixture.id}>
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
        <KickOff utcDate={fixture.utcDate} />
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
      <div className="mt-1.5 flex items-center gap-2">
        <div
          className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          title={t("odds", { home: pct(odds.home), draw: pct(odds.draw), away: pct(odds.away) })}
        >
          <span className="bg-pitch-500" style={{ width: `${(odds.home * 100).toFixed(1)}%` }} />
          <span className="bg-zinc-400" style={{ width: `${(odds.draw * 100).toFixed(1)}%` }} />
          <span className="bg-sky-500" style={{ width: `${(odds.away * 100).toFixed(1)}%` }} />
        </div>
        <span className="w-24 text-right text-[10px] tabular-nums text-zinc-500">
          {pct(odds.home)} · {pct(odds.draw)} · {pct(odds.away)}
        </span>
        {showInputs && !disabled && (
          <button
            type="button"
            onClick={onSimulate}
            title={t("simulateMatch")}
            aria-label={t("simulateMatch")}
            className="rounded-md px-1.5 text-base hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            🎲
          </button>
        )}
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
  if (!timeZone) return <span>&nbsp;</span>;
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
