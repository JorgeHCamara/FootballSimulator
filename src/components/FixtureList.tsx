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
  /** The winner goes on to play another league's club (Ligue 2 v Ligue 1's 16th). */
  winnerPlays?: { league: string; position: number };
  /** Not held this season (Serie B: 3rd finished far enough clear of 4th). */
  cancelled?: { position: number; over: number; points: number };
  /** A continental knockout phase, seeded from a league phase (UEFA) or a group stage (Libertadores): its own wording, and drawn pairings. */
  knockout?: "leaguePhase" | "groupStage" | "groupStageExternal";
  /**
   * Seeds interleaved by zone (Argentina: 1A, 1B, 2A…): the zones' letters and
   * names, so a seed reads "1st in Zone A" and a winner "Winner 1A/8B".
   */
  zoneSlots?: { ids: string[]; names: string[] };
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
  /** A line above the matchday's games (generated fixtures: where they come from). */
  note?: string;
}

export function FixtureList(props: Props) {
  const { matchday, matchdays, onMatchdayChange, fixtures, teams, predictions, onScore, onSimulate, playoff, note } = props;
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
              {md === PLAYOFF_MATCHDAY ? t(playoff?.knockout ? "knockoutPhase" : "playoffs") : t("matchday", { number: md })}
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
      {note && (
        <p className="border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300" data-testid="fixtures-note">
          {note}
        </p>
      )}
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
  // A continental knockout phase (31 ties, most over two legs) shows one round
  // at a time: the first one still open, unless another is picked.
  const [picked, setPicked] = useState<number | null>(null);
  const openRound = bracket.findIndex((round) => round.some((tie) => tieOutcome(tie, predictions) === null));
  const shownRound = picked ?? (openRound >= 0 ? openRound : lastRound);
  const rounds = playoff.knockout ? bracket.map((round, r) => ({ round, r })).filter(({ r }) => r === shownRound) : bracket.map((round, r) => ({ round, r }));

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
  const zones = playoff.zoneSlots;
  /** An interleaved seed as its zone and place within it. */
  const zoneSlot = (position: number) => (zones ? { zone: (position - 1) % zones.ids.length, place: Math.ceil(position / zones.ids.length) } : null);
  const label = (side: PlayoffSide) => {
    if (side.teamId !== null) return teams.get(side.teamId)?.shortName ?? "";
    const group = groupName(side.group);
    if (zones) {
      if (side.from) {
        const possible = seeds(side).map((p) => `${zoneSlot(p)!.place}${zones.ids[zoneSlot(p)!.zone]}`);
        return possible.length <= 4 ? t("playoffSeedsWinner", { seeds: possible.join("/") }) : t("playoffWinnerOf", { round: bracket[side.from.round]![0]!.config.key });
      }
      const slot = zoneSlot(side.position ?? 1)!;
      return t("playoffZonePlace", { position: slot.place, group: zones.names[slot.zone]! });
    }
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
    if (config.levelTie === "betterPlaced") {
      return config.legs === 2 ? t("playoffRule", { higher }) : t("playoffRuleOneLegBetterPlaced", { higher });
    }
    if (config.venue) return t("playoffRuleFinal", { venue: config.venue });
    if (config.neutral) return t(config.noExtraTime ? "playoffRuleNeutralPenalties" : "playoffRuleNeutral");
    if (config.legs === 2) return t(config.noExtraTime ? "playoffRuleTwoLegsPenalties" : "playoffRuleTwoLegs", { higher });
    return config.noExtraTime ? t("playoffRuleOneLegPenalties", { higher }) : t("playoffRuleOneLeg", { higher });
  };

  const scoreRow = (fixture: Fixture, label?: string, layout: { attached?: boolean; joinsNext?: boolean } = {}) => (
    <MatchRow
      key={`${fixture.id}-${fixture.homeId}-${fixture.awayId}`}
      fixture={fixture}
      home={teams.get(fixture.homeId)!}
      away={teams.get(fixture.awayId)!}
      prediction={predictions[fixture.id]}
      {...(label ? { label } : {})}
      {...layout}
      onScore={(score) => onScore(fixture, score)}
      onSimulate={() => onSimulate(fixture)}
    />
  );

  return (
    <div data-testid="playoff">
      {!seasonComplete && <p className="px-3 pt-2 text-xs text-zinc-500">{t(
            playoff.knockout === "groupStageExternal"
              ? "knockoutProjectedGroupsExternal"
              : playoff.knockout === "groupStage"
                ? "knockoutProjectedGroups"
                : playoff.knockout
                  ? "knockoutProjected"
                  : "playoffProjected",
          )}</p>}
      {seasonComplete && playoff.knockout && (
        <p className="px-3 pt-2 text-xs text-zinc-500" data-testid="knockout-draw-note">
          {t("knockoutDrawNote")}
        </p>
      )}
      {playoff.cancelled && (
        <p className="px-3 py-3 text-sm text-zinc-600 dark:text-zinc-300" data-testid="playoff-cancelled">
          {t("playoffCancelled", { ...playoff.cancelled })}
        </p>
      )}
      {playoff.knockout && (
        <div className="flex gap-1 overflow-x-auto px-3 pt-2" role="tablist" data-testid="knockout-rounds">
          {bracket.map((round, r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === shownRound}
              onClick={() => setPicked(r)}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold ${r === shownRound ? "bg-pitch-600 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"}`}
            >
              {t("knockoutRoundShort", { round: round[0]?.config.key ?? "" })}
            </button>
          ))}
        </div>
      )}
      {rounds.map(({ round, r }) => (
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
            // Only while the tie is level (a stale shoot-out score is cleared by LeagueSimulator).
            const showShootout = tie.shootout && needsShootout(tie, predictions);
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
                          .flatMap((g, n) => {
                            // A drawn game's shoot-out decides that game, so it sits right under it.
                            const pens = g.needsPenalties;
                            return [
                              scoreRow(g.game, t("playoffGame", { number: n + 1 }), { joinsNext: pens }),
                              ...(pens ? [scoreRow(g.shootout, t("playoffGamePenalties", { number: n + 1 }), { attached: true })] : []),
                            ];
                          })
                      : tie.legs.map((leg, i) =>
                          scoreRow(leg, leg.neutral && tie.config.venue ? tie.config.venue : undefined, {
                            joinsNext: Boolean(showShootout) && i === tie.legs.length - 1,
                          }),
                        )}
                  {showShootout && tie.shootout && (
                    <MatchRow
                      key={`${tie.shootout.id}-${tie.shootout.homeId}-${tie.shootout.awayId}`}
                      fixture={tie.shootout}
                      home={teams.get(tie.shootout.homeId)!}
                      away={teams.get(tie.shootout.awayId)!}
                      prediction={predictions[tie.shootout.id]}
                      label={t("penalties")}
                      attached
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
                      : r === lastRound && playoff.winnerPlays
                        ? t("playoffToBarrage", { winner: teams.get(outcome.winner)?.shortName ?? "", ...playoff.winnerPlays })
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
  /**
   * Continues the game above (its penalty shoot-out): no kick-off time and no
   * divider between the two, so it reads as part of that game.
   */
  attached?: boolean;
  /** The next row is attached to this one: no divider below. */
  joinsNext?: boolean;
  /** Small pills after the club names (e.g. a cup club's division). */
  tags?: { home?: string; away?: string };
  /** Decided knockout game: the winner's name is bold, the loser's dimmed. */
  winner?: TeamId | null;
  /** The dice sits in the date line instead of its own line below (cup cards). */
  inlineDice?: boolean;
  fixture: Fixture;
  home: Team;
  away: Team;
  prediction: Score | undefined;
  onScore: (score: Score | null) => void;
  onSimulate: () => void;
}

/** Same rule as MatchRow's `showInputs`: no real result, a prediction, or being edited. */
const showInputsFor = (fixture: Fixture, prediction: Score | undefined, editing: boolean) => !(fixture.result !== null && prediction === undefined) || editing;

function parseGoals(text: string): number | null {
  if (!/^\d{1,2}$/.test(text)) return null;
  return Number(text);
}

export function MatchRow({ fixture, home, away, prediction, onScore, onSimulate, disabled = false, label, attached = false, joinsNext = false, tags, winner, inlineDice = false }: RowProps) {
  const side = (id: TeamId) => (winner == null ? "" : winner === id ? "font-bold" : "opacity-60");
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
    <li
      className={`px-3 ${attached ? "pt-0 pb-2.5" : "py-2.5"} ${joinsNext ? "border-b-0" : ""}`}
      data-testid="match-row"
      data-fixture={fixture.id}
      {...(attached ? { "data-attached": "true" } : {})}
    >
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
        {attached ? (
          <span className="font-semibold">{label}</span>
        ) : (
          <span>
            <KickOff utcDate={fixture.utcDate} />
            {label && <span className="font-semibold"> · {label}</span>}
          </span>
        )}
        {inlineDice && showInputsFor(fixture, prediction, editing) && !disabled && (
          <button
            type="button"
            onClick={onSimulate}
            title={t("simulateMatch")}
            aria-label={t("simulateMatch")}
            className="-my-1 rounded-md px-1 text-sm leading-none hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            🎲
          </button>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className={`flex min-w-0 items-center justify-end gap-2 text-right text-sm font-medium ${side(home.id)}`}>
          <span className="truncate">{home.shortName}</span>
          {tags?.home && <Tag label={tags.home} />}
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
        <span className={`flex min-w-0 items-center gap-2 text-sm font-medium ${side(away.id)}`}>
          <TeamBadge team={away} size={22} />
          <span className="truncate">{away.shortName}</span>
          {tags?.away && <Tag label={tags.away} />}
        </span>
      </div>
      {showInputs && !disabled && !inlineDice && (
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

/** A small pill, e.g. a cup club's division. */
function Tag({ label }: { label: string }) {
  return <span className="shrink-0 rounded bg-zinc-200 px-1 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">{label}</span>;
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
