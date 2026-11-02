"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { CupConfig } from "../config/cups.ts";
import type { CompetitionCode } from "../config/leagues.ts";
import { LEAGUES } from "../config/leagues.ts";
import { bracketSides, needsShootout, tieAggregate, tieWinner, type CupRound, type CupTie } from "../engine/cup.ts";
import { useEffect, useState } from "react";
import type { Fixture, ResultMap, Score, Team, TeamId } from "../engine/types.ts";
import { CupBracket } from "./CupBracket.tsx";
import { MatchRow } from "./FixtureList.tsx";

export interface CupViewProps {
  cup: CupConfig;
  rounds: CupRound[];
  teams: Map<TeamId, Team>;
  predictions: ResultMap;
  divisions: Record<TeamId, CompetitionCode>;
  onScore: (fixture: Fixture, score: Score | null) => void;
  onSimulate: (fixture: Fixture) => void;
}

/**
 * Short division label for a cup club: PL, CH, L1, L2 or NL (non-league) in
 * the FA Cup, A or B in the Copa do Brasil (clubs outside them get no tag).
 */
export function useDivisionTag(divisions: Record<TeamId, CompetitionCode>, cup: CupConfig) {
  const t = useTranslations("Cup");
  return (id: TeamId): string | undefined => {
    const code = divisions[id];
    if (code) return t(`division.${code}`);
    return cup.tagOutsiders ? t("division.nonLeague") : undefined;
  };
}

/** One tie as a card: its game (or both legs), the aggregate, the shoot-out when level, the winner in bold. */
export function TieCard({ cup, tie, teams, predictions, divisions, onScore, onSimulate, compact = false }: Omit<CupViewProps, "rounds"> & { tie: CupTie; compact?: boolean }) {
  const t = useTranslations("Cup");
  const tag = useDivisionTag(divisions, cup);
  const winner = tieWinner(tie, predictions);
  // Only a level tie has a shoot-out (a score left from an earlier draw is cleared by CupSimulator).
  const pens = needsShootout(tie, predictions);
  const twoLegs = tie.legs.length === 2;
  const total = twoLegs ? tieAggregate(tie, predictions) : null;
  const home = teams.get(tie.homeId);
  const away = teams.get(tie.awayId);
  if (!home || !away) return null;
  const tagsFor = (leg: Fixture) => {
    if (compact) return {};
    const homeTag = tag(leg.homeId);
    const awayTag = tag(leg.awayId);
    return homeTag || awayTag ? { tags: { ...(homeTag ? { home: homeTag } : {}), ...(awayTag ? { away: awayTag } : {}) } } : {};
  };
  return (
    <ul
      className={`flex h-full flex-col rounded-xl border bg-white dark:bg-zinc-900 ${winner !== null ? "border-pitch-300 dark:border-pitch-900" : "border-zinc-200 dark:border-zinc-800"} ${compact ? "text-sm" : ""}`}
      data-testid="cup-tie"
      data-round={tie.round}
      data-home={tie.homeId}
      data-away={tie.awayId}
      data-winner={winner ?? ""}
      data-legs={tie.legs.length}
    >
      {tie.legs.map((leg, n) => (
        <MatchRow
          key={leg.id}
          fixture={leg}
          home={teams.get(leg.homeId) ?? home}
          away={teams.get(leg.awayId) ?? away}
          prediction={predictions[leg.id]}
          {...tagsFor(leg)}
          {...(twoLegs ? { label: t(n === 0 ? "firstLeg" : "secondLeg") } : {})}
          winner={winner}
          joinsNext={n === tie.legs.length - 1 ? pens || total !== null : true}
          inlineDice
          onScore={(score) => onScore(leg, score)}
          onSimulate={() => onSimulate(leg)}
        />
      ))}
      {total && (
        <li className="px-3 pb-1 text-center text-xs text-zinc-600 dark:text-zinc-300" data-testid="cup-aggregate">
          {t("aggregate", { home: home.shortName, away: away.shortName, hg: total.home, ag: total.away })}
        </li>
      )}
      {pens && (
        <ShootoutLine
          fixture={tie.shootout}
          prediction={predictions[tie.shootout.id]}
          onScore={(score) => onScore(tie.shootout, score)}
          onSimulate={() => onSimulate(tie.shootout)}
        />
      )}
    </ul>
  );
}

/**
 * A level game's penalty shoot-out, as one compact line under the score
 * (small boxes aligned with the score above) so a card with penalties is
 * only slightly taller than its neighbours.
 */
function ShootoutLine({ fixture, prediction, onScore, onSimulate }: { fixture: Fixture; prediction: Score | undefined; onScore: (score: Score | null) => void; onSimulate: () => void }) {
  const t = useTranslations("Simulator");
  const shown = prediction ?? fixture.result ?? null;
  const locked = fixture.result !== null && prediction === undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ home: shown ? String(shown.home) : "", away: shown ? String(shown.away) : "" });
  useEffect(() => {
    setDraft({ home: shown ? String(shown.home) : "", away: shown ? String(shown.away) : "" });
  }, [shown?.home, shown?.away]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (side: "home" | "away", value: string) => {
    const next = { ...draft, [side]: value.replace(/\D/g, "").slice(0, 2) };
    setDraft(next);
    const ok = (x: string) => /^\d{1,2}$/.test(x);
    if (ok(next.home) && ok(next.away)) onScore({ home: Number(next.home), away: Number(next.away) });
    else if (next.home === "" && next.away === "" && prediction) onScore(null);
  };
  const box = `h-7 w-8 rounded-md border text-center text-sm font-bold tabular-nums outline-none focus:border-pitch-500 focus:ring-2 focus:ring-pitch-500/30 ${
    prediction ? "border-pitch-500/60 bg-pitch-50 dark:bg-pitch-900/40" : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950"
  }`;
  return (
    <li className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pb-2.5" data-testid="shootout-line" data-fixture={fixture.id}>
      <span className="text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{t("penalties")}</span>
      <span className="flex items-center gap-1">
        {locked && !editing ? (
          <button type="button" title={t("editResult")} onClick={() => setEditing(true)} className="flex h-7 items-center gap-1 rounded-md bg-zinc-100 px-2.5 text-sm font-bold tabular-nums dark:bg-zinc-800">
            {shown!.home} <span className="text-zinc-400">–</span> {shown!.away}
          </button>
        ) : (
          <>
            <input type="number" inputMode="numeric" min={0} max={99} aria-label={t("penalties")} className={box} value={draft.home} onChange={(e) => update("home", e.target.value)} />
            <span className="text-zinc-400">–</span>
            <input type="number" inputMode="numeric" min={0} max={99} aria-label={t("penalties")} className={box} value={draft.away} onChange={(e) => update("away", e.target.value)} />
          </>
        )}
      </span>
      <span>
        {!(locked && !editing) && (
          <button type="button" onClick={onSimulate} title={t("simulateMatch")} aria-label={t("simulateMatch")} className="rounded-md px-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
            🎲
          </button>
        )}
      </span>
    </li>
  );
}

interface RoundsProps extends CupViewProps {
  roundIndex: number;
  onSelect: (index: number) => void;
}

/** Round bar (First Round … Final) and the selected round: a card grid, or the bracket from the quarter-finals. */
export function CupRounds(props: RoundsProps) {
  const { cup, rounds, roundIndex, onSelect, predictions } = props;
  const t = useTranslations("Cup");
  const format = useFormatter();
  const round = rounds[roundIndex]!;
  // The closing rounds (quarter-finals on), not an early round that happens to be small (Coppa Italia's preliminary round).
  const bracketFrom = rounds.findIndex((_, i) => rounds.slice(i).every((r) => r.config.ties <= 4));
  const decided = (r: CupRound) => r.ties.filter((tie) => tieWinner(tie, predictions) !== null).length;

  const status = (r: CupRound) => {
    if (r.drawn === "pending") return t(r.config.bracket ? "bracketStatus" : "drawPending");
    const done = decided(r);
    if (done === r.config.ties) return t("roundComplete");
    return r.drawn === "simulated" ? t("simulatedDraw") : `${done}/${r.config.ties}`;
  };
  const when = (r: CupRound) => {
    const date = r.ties[0]?.game.utcDate;
    return date && !Number.isNaN(Date.parse(date)) ? format.dateTime(new Date(date), { day: "numeric", month: "short" }) : "";
  };

  return (
    <div className="space-y-3">
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="round-bar">
        <div className="flex min-w-max gap-1 rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="tablist">
          {rounds.map((r, i) => {
            const active = i === roundIndex;
            const complete = r.drawn !== "pending" && decided(r) === r.config.ties;
            return (
              <button
                key={r.config.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(i)}
                className={`flex min-w-[6.5rem] flex-col items-start rounded-md px-3 py-1.5 text-left ${active ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"}`}
              >
                <span className="text-sm font-semibold">
                  {t(`round.${r.config.key}`)}
                  {complete && <span className="ml-1 text-pitch-600 dark:text-pitch-100">✓</span>}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{[when(r), status(r)].filter(Boolean).join(" · ")}</span>
              </button>
            );
          })}
        </div>
      </div>

      {round.config.venue && <p className="text-xs text-zinc-500">{t("atVenue", { venue: round.config.venue })}</p>}
      {round.drawn === "simulated" && round.ties.length > 0 && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-900/30 dark:text-sky-100" data-testid="simulated-draw-note">
          {t("simulatedDrawNote")}
        </p>
      )}

      {bracketFrom >= 0 && roundIndex >= bracketFrom ? (
        <CupBracket {...props} rounds={rounds.slice(bracketFrom)} fullRounds={rounds} highlight={roundIndex - bracketFrom} />
      ) : round.drawn === "pending" && round.ties.length === 0 ? (
        <PendingRound cup={cup} round={round} rounds={rounds} predictions={predictions} teams={props.teams} />
      ) : (
        <div className="space-y-3">
          {/* Equal rows: every card in the round is as tall as the tallest (e.g. one with penalties). */}
          <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="round-grid">
            {round.ties.map((tie) => (
              <TieCard key={tie.game.id} tie={tie} {...props} />
            ))}
          </div>
          {round.drawn === "pending" && <PendingRound cup={cup} round={round} rounds={rounds} predictions={predictions} teams={props.teams} />}
        </div>
      )}
    </div>
  );
}

/** A round whose draw hasn't been made: who it waits for and how many clubs go in the hat. */
export function PendingRound({ cup, round, rounds, predictions, teams }: { cup: CupConfig; round: CupRound; rounds: CupRound[]; predictions: ResultMap; teams: Map<TeamId, Team> }) {
  const t = useTranslations("Cup");
  const previous = rounds[round.index - 1];
  // Fixed bracket (Coppa Italia): the pairings are already known, only the clubs aren't.
  const sides = previous ? bracketSides(cup, rounds, round.index, predictions) : null;
  if (sides && previous) {
    const name = (id: TeamId) => teams.get(id)?.shortName ?? teams.get(id)?.name ?? "?";
    // Up to four clubs per side by name; more (a final far ahead) reads as "winner of semi-final 1".
    const side = (ids: TeamId[], i: number) => (ids.length <= 4 ? ids.map(name).join(" / ") : t("bracketWinnerOf", { round: t(`roundShort.${previous.config.key}`), n: i + 1 }));
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-700" data-testid="pending-round">
        <p className="text-center font-semibold text-zinc-700 dark:text-zinc-300">{t("bracketAfter")}</p>
        <ul className="mt-3 space-y-2" data-testid="bracket-pairings">
          {sides.map(([a, b], i) => (
            <li key={i} className="rounded-lg bg-zinc-100 px-3 py-2 text-center text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {side(a, 2 * i)} <span className="text-zinc-400">{t("versus")}</span> {side(b, 2 * i + 1)}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const entrants = cup.rounds[round.index]!.entrantsFrom;
  const count = round.config.ties * 2;
  // The previous round is decided but its draw can't be made here: clubs
  // entering this round are only named by the real draw.
  const waiting = previous && previous.drawn !== "pending" && previous.ties.length > 0 && previous.ties.every((tie) => tieWinner(tie, predictions) !== null);
  const leagues = (entrants ?? []).map((code) => LEAGUES.find((l) => l.code === code)?.name ?? code).join(" + ");
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700" data-testid="pending-round">
      <p className="font-semibold text-zinc-700 dark:text-zinc-300">
        {round.config.ties === 1 && previous
          ? t("finalAfter", { round: t(`round.${previous.config.key}`) })
          : waiting
            ? t("waitingRealDraw")
            : previous
              ? t("drawAfter", { round: t(`round.${previous.config.key}`) })
              : t("drawPending")}
      </p>
      {round.config.ties > 1 && (
        <p className="mt-1">
          {entrants ? t("drawClubsEntering", { count, entering: leagues ? t("entrantsFrom", { leagues }) : "" }) : t("drawClubs", { count })}
        </p>
      )}
    </div>
  );
}
