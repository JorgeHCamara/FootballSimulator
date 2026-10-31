"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import type { LeagueConfig } from "../config/leagues.ts";
import { simulateFixtures, simulateScore, expectedGoals } from "../engine/match.ts";
import type { MonteCarloInput } from "../engine/montecarlo.ts";
import { buildLeagueModel } from "../engine/ratings.ts";
import { effectiveResults, realResults } from "../engine/results.ts";
import { createRng, randomSeed } from "../engine/rng.ts";
import { computeStandings, sortFixtures } from "../engine/standings.ts";
import type { Fixture, Score, Team } from "../engine/types.ts";
import { decodeResults, encodeResults } from "../lib/shareCodec.ts";
import { emptySeason, useSimStore } from "../store/simStore.ts";
import { FixtureList } from "./FixtureList.tsx";
import { ITERATIONS, ProbabilityGrid } from "./ProbabilityGrid.tsx";
import { StandingsTable } from "./StandingsTable.tsx";

interface Props {
  league: LeagueConfig;
  teams: Team[];
  fixtures: Fixture[];
  seasonKey: string;
}

type Tab = "table" | "chances";

export function LeagueSimulator({ league, teams, fixtures, seasonKey }: Props) {
  const t = useTranslations("Simulator");
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("table");
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const season = useSimStore((s) => (hydrated ? s.seasons[seasonKey] : undefined) ?? emptySeason);
  const canUndo = useSimStore((s) => (s.history[seasonKey]?.length ?? 0) > 0);
  const { setScore, applyResults, replace, reset, undo, reconcile } = useSimStore.getState();

  const ordered = useMemo(() => sortFixtures(fixtures), [fixtures]);
  const teamMap = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams]);
  const real = useMemo(() => realResults(fixtures), [fixtures]);
  // Ratings come from real results only: predictions shouldn't change how good a team is.
  const model = useMemo(() => buildLeagueModel(teams, fixtures, real), [teams, fixtures, real]);
  const standingsOptions = useMemo(() => ({ tiebreakers: league.tiebreakers }), [league.tiebreakers]);

  const effective = useMemo(() => effectiveResults(fixtures, season.predictions), [fixtures, season.predictions]);
  const rows = useMemo(() => computeStandings(teams, ordered, effective, standingsOptions), [teams, ordered, effective, standingsOptions]);
  const basePoints = useMemo(() => {
    const base = computeStandings(teams, ordered, real, { ...standingsOptions, includeForm: false });
    return new Map(base.map((r) => [r.teamId, r.points]));
  }, [teams, ordered, real, standingsOptions]);

  const matchdays = useMemo(() => [...new Set(ordered.map((f) => f.matchday))], [ordered]);
  const [matchday, setMatchday] = useState(() => {
    const next = ordered.find((f) => !f.result);
    return next?.matchday ?? matchdays.at(-1) ?? 1;
  });
  const matchdayFixtures = useMemo(() => ordered.filter((f) => f.matchday === matchday), [ordered, matchday]);

  // Load saved predictions, then apply a shared link (?r=...) if present.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(useSimStore.persist.rehydrate()).then(() => {
      if (cancelled) return;
      const url = new URL(window.location.href);
      const shared = url.searchParams.get("r");
      if (shared !== null) {
        const decoded = decodeResults(fixtures, shared);
        if (decoded) {
          replace(seasonKey, fixtures, decoded);
          setNotice(t("sharedLoaded"));
        }
        url.searchParams.delete("r");
        window.history.replaceState(null, "", url);
      } else {
        const removed = reconcile(seasonKey, fixtures);
        if (removed > 0) setNotice(t("replacedNotice", { count: removed }));
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fixtures, seasonKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const simulate = (targets: readonly Fixture[]) =>
    applyResults(seasonKey, simulateFixtures(targets, effective, model, createRng(randomSeed())));

  const simulateOne = (fixture: Fixture) => {
    const score = simulateScore(expectedGoals(model, fixture.homeId, fixture.awayId), createRng(randomSeed()));
    setScore(seasonKey, fixture, score);
  };

  const onScore = (fixture: Fixture, score: Score | null) => {
    // Typing the real score back in is the same as not overriding it.
    if (score && fixture.result && score.home === fixture.result.home && score.away === fixture.result.away) {
      setScore(seasonKey, fixture, null);
      return;
    }
    setScore(seasonKey, fixture, score);
  };

  const share = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("r", encodeResults(fixtures, season.predictions));
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      window.prompt(t("share"), url.toString());
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onReset = () => {
    if (Object.keys(season.predictions).length === 0 || window.confirm(t("resetConfirm"))) reset(seasonKey);
  };

  const monteCarloInput = useMemo<MonteCarloInput | null>(
    () =>
      tab === "chances" && hydrated
        ? { teams, fixtures, fixed: effective, model, standings: standingsOptions, iterations: ITERATIONS, seed: 2026 }
        : null,
    [tab, hydrated, teams, fixtures, effective, model, standingsOptions],
  );

  const actionButton =
    "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";
  const primaryButton = "rounded-lg bg-pitch-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pitch-700";
  const tabButton = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-semibold ${active ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`;

  return (
    <div className="space-y-4">
      {notice && (
        <div className="flex items-center justify-between rounded-lg bg-pitch-50 px-3 py-2 text-sm text-pitch-900 dark:bg-pitch-900/40 dark:text-pitch-100" role="status">
          {notice}
          <button type="button" className="text-xs font-semibold underline" onClick={() => setNotice(null)}>
            {t("dismiss")}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "table"} className={tabButton(tab === "table")} onClick={() => setTab("table")}>
            {t("table")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "chances"} className={tabButton(tab === "chances")} onClick={() => setTab("chances")}>
            {t("chances")}
          </button>
        </div>
        <button type="button" className={primaryButton} onClick={() => simulate(matchdayFixtures)}>
          {t("simulateMatchday")}
        </button>
        <button type="button" className={actionButton} onClick={() => simulate(ordered)}>
          {t("simulateRest")}
        </button>
        <button type="button" className={actionButton} onClick={() => undo(seasonKey)} disabled={!canUndo}>
          {t("undo")}
        </button>
        <button type="button" className={actionButton} onClick={onReset}>
          {t("reset")}
        </button>
        <button type="button" className={actionButton} onClick={share}>
          {copied ? t("linkCopied") : t("share")}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {tab === "table" ? (
          <StandingsTable league={league} rows={rows} teams={teamMap} basePoints={basePoints} />
        ) : (
          <ProbabilityGrid league={league} input={monteCarloInput} rows={rows} teams={teamMap} />
        )}
        <FixtureList
          matchday={matchday}
          matchdays={matchdays}
          onMatchdayChange={setMatchday}
          fixtures={matchdayFixtures}
          teams={teamMap}
          predictions={season.predictions}
          model={model}
          onScore={onScore}
          onSimulate={simulateOne}
        />
      </div>
    </div>
  );
}
