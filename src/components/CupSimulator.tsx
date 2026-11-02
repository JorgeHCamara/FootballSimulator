"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { CupConfig } from "../config/cups.ts";
import {
  buildCup,
  clubTiers,
  clubsAlive,
  cupIds,
  cupWinner,
  isCupShootoutId,
  needsShootout,
  simulateCup,
  simulateCupRound,
  tieAggregate,
  tieWinner,
  type CupBuildOptions,
} from "../engine/cup.ts";
import { cupModelFor } from "../engine/cupModel.ts";
import type { CupMonteCarloInput } from "../engine/cupMontecarlo.ts";
import { expectedGoals, expectedGoalsNeutral, simulateScore } from "../engine/match.ts";
import { simulatePenalties } from "../engine/playoffs.ts";
import { createRng, randomSeed } from "../engine/rng.ts";
import type { Fixture, ResultMap, Score, TeamId } from "../engine/types.ts";
import type { CupData } from "../lib/cupData.ts";
import { decodeResults, encodeResults } from "../lib/shareCodec.ts";
import { emptySeason, useSimStore } from "../store/simStore.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { CupChances } from "./CupChances.tsx";
import { CupRounds } from "./CupRounds.tsx";
import { TeamBadge } from "./TeamBadge.tsx";

/** Fewer runs than a league: every run plays up to 123 games. */
const CUP_ITERATIONS = 5_000;

interface Props {
  cup: CupConfig;
  data: CupData;
}

type Tab = "fixtures" | "chances";

export function CupSimulator({ cup, data }: Props) {
  const t = useTranslations("Cup");
  const ts = useTranslations("Simulator");
  const { seasonKey } = data;
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("fixtures");
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const season = useSimStore((s) => (hydrated ? s.seasons[seasonKey] : undefined) ?? emptySeason);
  const canUndo = useSimStore((s) => (s.history[seasonKey]?.length ?? 0) > 0);
  const { setScore, applyResults, replace, reset, undo, reconcile, redraw, syncPairings, drop } = useSimStore.getState();

  const teamMap = useMemo(() => new Map(data.teams.map((team) => [team.id, team])), [data.teams]);
  // Rounds played at the lower-division club's ground need each club's tier.
  const tiers = useMemo(
    () => clubTiers(cup, data.divisions, [...data.teams.map((team) => team.id)]),
    [cup, data.divisions, data.teams],
  );
  const buildOptions = useMemo<CupBuildOptions>(
    () => ({ entrants: data.entrants, drawSalt: season.drawSalt ?? 0, roundDates: data.roundDates, tiers }),
    [data.entrants, data.roundDates, season.drawSalt],
  );
  const rounds = useMemo(() => buildCup(cup, data.real, season.predictions, buildOptions), [cup, data.real, season.predictions, buildOptions]);
  const allClubs = useMemo(
    () => [...new Set([...data.real.flatMap((tie) => [tie.homeId, tie.awayId]), ...Object.values(data.entrants).flat()])],
    [data.real, data.entrants],
  );
  const model = useMemo(
    () => cupModelFor(new Map(Object.entries(data.strengths).map(([id, s]) => [Number(id), s])), allClubs, cup.outsiderTier),
    [data.strengths, allClubs, cup.outsiderTier],
  );
  // Share links cover every slot; overrides and reconciliation only the real ties.
  const slotFixtures = useMemo<Fixture[]>(() => cupIds(cup).map((id) => ({ id, matchday: 0, utcDate: "", homeId: 0, awayId: 0, result: null })), [cup]);
  const realFixtures = useMemo(() => rounds.flatMap((r) => r.ties.filter((tie) => tie.real).flatMap((tie) => [...tie.legs, tie.shootout])), [rounds]);

  // A prediction belongs to a pairing: drop it when its slot is drawn differently.
  useEffect(() => {
    if (!hydrated) return;
    const pairings: Record<number, string> = {};
    for (const round of rounds) {
      for (const tie of round.ties) {
        for (const fixture of [...tie.legs, tie.shootout]) pairings[fixture.id] = `${tie.homeId}-${tie.awayId}`;
      }
    }
    const removed = syncPairings(seasonKey, pairings);
    if (removed > 0) setNotice(t("redrawnNotice", { count: removed }));
  }, [hydrated, rounds]); // eslint-disable-line react-hooks/exhaustive-deps

  // A shoot-out score belongs to a level game: once the game has a winner
  // (score changed, dice, simulate), its shoot-out score is cleared.
  useEffect(() => {
    if (!hydrated) return;
    const stale = rounds.flatMap((r) => r.ties).filter((tie) => season.predictions[tie.shootout.id] && !needsShootout(tie, season.predictions));
    if (stale.length) drop(seasonKey, stale.map((tie) => tie.shootout.id));
  }, [hydrated, rounds, season.predictions]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstOpen = useMemo(() => {
    const i = rounds.findIndex((r) => r.drawn === "pending" || r.ties.some((tie) => tieWinner(tie, season.predictions) === null));
    return i === -1 ? rounds.length - 1 : i;
  }, [rounds, season.predictions]);
  const [roundIndex, setRoundIndex] = useState(() => firstOpen);
  const round = rounds[roundIndex]!;

  // Load saved predictions, then apply a shared link (?r=…&d=…) if present.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(useSimStore.persist.rehydrate()).then(() => {
      if (cancelled) return;
      const url = new URL(window.location.href);
      const shared = url.searchParams.get("r");
      if (shared !== null) {
        const decoded = decodeResults(slotFixtures, shared);
        const drawSalt = Number(url.searchParams.get("d") ?? 0) || 0;
        if (decoded) {
          replace(seasonKey, realFixtures, decoded, { drawSalt });
          setNotice(ts("sharedLoaded"));
        }
        url.searchParams.delete("r");
        url.searchParams.delete("d");
        window.history.replaceState(null, "", url);
      } else {
        const removed = reconcile(seasonKey, realFixtures);
        if (removed > 0) setNotice(ts("replacedNotice", { count: removed }));
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [seasonKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const simulateRound = () => {
    if (round.drawn === "pending") return;
    applyResults(seasonKey, simulateCupRound(round, season.predictions, model, createRng(randomSeed())));
    // Show the next round, which has just been drawn.
    if (roundIndex < rounds.length - 1) setRoundIndex(roundIndex + 1);
  };
  const simulateAll = () => {
    applyResults(seasonKey, simulateCup(cup, data.real, season.predictions, model, createRng(randomSeed()), buildOptions));
    setRoundIndex(rounds.length - 1);
  };
  const simulateOne = (fixture: Fixture) => {
    const rng = createRng(randomSeed());
    const score = isCupShootoutId(fixture.id)
      ? simulatePenalties(rng)
      : simulateScore(fixture.neutral ? expectedGoalsNeutral(model, fixture.homeId, fixture.awayId) : expectedGoals(model, fixture.homeId, fixture.awayId), rng);
    setScore(seasonKey, fixture, score);
  };
  const onScore = (fixture: Fixture, score: Score | null) => {
    if (score && fixture.result && score.home === fixture.result.home && score.away === fixture.result.away) {
      setScore(seasonKey, fixture, null);
      return;
    }
    setScore(seasonKey, fixture, score);
  };
  const share = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("r", encodeResults(slotFixtures, season.predictions));
    if (season.drawSalt) url.searchParams.set("d", String(season.drawSalt));
    else url.searchParams.delete("d");
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      window.prompt(ts("share"), url.toString());
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const onReset = () => {
    if (Object.keys(season.predictions).length === 0 && !season.drawSalt) reset(seasonKey);
    else setConfirmReset(true);
  };

  const winner = cupWinner(rounds, season.predictions);
  // Chances count predictions on real pairings only (simulated rounds are
  // redrawn every run), so "still in" and the first open round follow the same rule.
  const realIds = useMemo(() => new Set(realFixtures.map((f) => f.id)), [realFixtures]);
  const fixedReal = useMemo(
    () => Object.fromEntries(Object.entries(season.predictions).filter(([id]) => realIds.has(Number(id)))) as ResultMap,
    [season.predictions, realIds],
  );
  const chanceRounds = useMemo(() => buildCup(cup, data.real, fixedReal, buildOptions), [cup, data.real, fixedReal, buildOptions]);
  const alive = useMemo(() => [...clubsAlive(chanceRounds, fixedReal, allClubs)], [chanceRounds, fixedReal, allClubs]);
  const chancesFrom = useMemo(() => {
    const i = chanceRounds.findIndex((r) => r.drawn === "pending" || r.ties.some((tie) => tieWinner(tie, fixedReal) === null));
    return i === -1 ? chanceRounds.length - 1 : i;
  }, [chanceRounds, fixedReal]);
  const roundDecided = round.drawn !== "pending" && round.ties.every((tie) => tieWinner(tie, season.predictions) !== null);
  const anySimulated = rounds.some((r) => r.drawn === "simulated" && r.ties.length > 0);
  const monteCarloInput = useMemo<CupMonteCarloInput | null>(
    () =>
      tab === "chances" && hydrated
        ? { config: cup, real: data.real, fixed: fixedReal, strengths: data.strengths, options: { entrants: data.entrants, tiers }, iterations: CUP_ITERATIONS, seed: 2026 }
        : null,
    [tab, hydrated, cup, data.real, data.strengths, data.entrants, fixedReal, tiers],
  );

  const actionButton =
    "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";
  const primaryButton = "rounded-lg bg-pitch-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pitch-700 disabled:opacity-40";
  const tabButton = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-semibold ${active ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"}`;
  const view = { cup, rounds, teams: teamMap, predictions: season.predictions, divisions: data.divisions, onScore, onSimulate: simulateOne };

  return (
    <div className="space-y-4">
      {notice && (
        <div className="flex items-center justify-between rounded-lg bg-pitch-50 px-3 py-2 text-sm text-pitch-900 dark:bg-pitch-900/40 dark:text-pitch-100" role="status">
          {notice}
          <button type="button" className="text-xs font-semibold underline" onClick={() => setNotice(null)}>
            {ts("dismiss")}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "fixtures"} className={tabButton(tab === "fixtures")} onClick={() => setTab("fixtures")}>
            {t("fixtures")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "chances"} className={tabButton(tab === "chances")} onClick={() => setTab("chances")}>
            {ts("chances")}
          </button>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="actions">
          <button type="button" className={`${primaryButton} grow lg:grow-0`} onClick={simulateRound} disabled={round.drawn === "pending" || roundDecided}>
            {t("simulateRound")}
          </button>
          <button type="button" className={`${actionButton} grow lg:grow-0`} onClick={simulateAll} disabled={winner !== null}>
            {t("simulateAll")}
          </button>
          {anySimulated && (
            <button type="button" className={`${actionButton} grow lg:grow-0`} onClick={() => redraw(seasonKey)} data-testid="new-draw">
              {t("newDraw")}
            </button>
          )}
          <button type="button" className={`${actionButton} grow lg:grow-0`} onClick={() => undo(seasonKey)} disabled={!canUndo}>
            {ts("undo")}
          </button>
          <button type="button" className={`${actionButton} grow lg:grow-0`} onClick={onReset}>
            {ts("reset")}
          </button>
          <button type="button" className={`${actionButton} grow lg:grow-0`} onClick={share}>
            {copied ? ts("linkCopied") : ts("share")}
          </button>
        </div>
      </div>

      {tab === "fixtures" ? (
        <>
          <CupRounds {...view} roundIndex={roundIndex} onSelect={setRoundIndex} />
          <CupChampion cup={cup} rounds={rounds} winner={winner} predictions={season.predictions} teams={teamMap} season={data.season} />
        </>
      ) : (
        <CupChances cup={cup} input={monteCarloInput} teams={teamMap} divisions={data.divisions} alive={alive} fromRound={chancesFrom} />
      )}

      <ConfirmDialog
        open={confirmReset}
        danger
        title={ts("resetTitle")}
        message={ts("resetConfirm")}
        confirmLabel={ts("resetAction")}
        cancelLabel={ts("cancel")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          reset(seasonKey);
          setConfirmReset(false);
        }}
      />
    </div>
  );
}

/** The cup winner with its road to the final, once the final is decided. */
function CupChampion({ cup, rounds, winner, predictions, teams, season }: { cup: CupConfig; rounds: ReturnType<typeof buildCup>; winner: TeamId | null; predictions: ResultMap; teams: Map<TeamId, import("../engine/types.ts").Team>; season: string }) {
  const t = useTranslations("Cup");
  const team = winner !== null ? teams.get(winner) : undefined;
  const road = team
    ? rounds.flatMap((round) => {
        const tie = round.ties.find((x) => x.homeId === winner || x.awayId === winner);
        if (!tie) return [];
        const score = tieAggregate(tie, predictions);
        const pens = predictions[tie.shootout.id] ?? tie.shootout.result;
        const home = tie.homeId === winner;
        const opponent = teams.get(home ? tie.awayId : tie.homeId)?.shortName ?? "";
        const line = score ? `${home ? score.home : score.away}–${home ? score.away : score.home}${tie.legs.length === 2 ? ` ${t("onAggregate")}` : ""}` : "";
        const pensLine = pens && needsShootout(tie, predictions) ? ` (${Math.max(pens.home, pens.away)}–${Math.min(pens.home, pens.away)} ${t("onPenalties")})` : "";
        return [{ key: round.config.key, text: `${t(`round.${round.config.key}`)}: ${line} v ${opponent}${pensLine}` }];
      })
    : [];
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40" data-testid="champion">
      <h2 className="font-bold">{t("champion", { title: cup.title, year: season })}</h2>
      {team ? (
        <>
          <p className="mt-2 flex items-center gap-2 rounded-lg bg-white px-3 py-2 dark:bg-zinc-900" data-testid="champion-team">
            <TeamBadge team={team} size={28} />
            <span className="text-lg font-semibold">{team.name}</span>
            <span className="ml-auto text-xl" aria-hidden>
              🏆
            </span>
          </p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("road")}</p>
          <ul className="mt-1 grid gap-x-4 text-sm text-zinc-700 sm:grid-cols-2 dark:text-zinc-300">
            {road.map((r) => (
              <li key={r.key}>{r.text}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t("championPending")}</p>
      )}
    </section>
  );
}
