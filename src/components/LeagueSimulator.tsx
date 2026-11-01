"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LeagueConfig, SiteLocale } from "../config/leagues.ts";
import { expectedGoals, expectedGoalsNeutral, simulateFixtures, simulateScore } from "../engine/match.ts";
import type { MonteCarloInput } from "../engine/montecarlo.ts";
import { buildLeagueModel } from "../engine/ratings.ts";
import { buildBracket, isShootoutId, playoffIds, simulatePenalties, simulatePlayoff, tieIds } from "../engine/playoffs.ts";
import { effectiveResults, realResults } from "../engine/results.ts";
import { createRng, randomSeed } from "../engine/rng.ts";
import { computeStandings, sortFixtures } from "../engine/standings.ts";
import type { Fixture, ResultMap, Score, StandingRow, Team } from "../engine/types.ts";
import { decodeResults, encodeResults } from "../lib/shareCodec.ts";
import { emptySeason, useSimStore } from "../store/simStore.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { FixtureList, PLAYOFF_MATCHDAY } from "./FixtureList.tsx";
import { ITERATIONS, ProbabilityGrid } from "./ProbabilityGrid.tsx";
import { PromotedClubs } from "./PromotedClubs.tsx";
import { StandingsTable } from "./StandingsTable.tsx";

interface Props {
  league: LeagueConfig;
  teams: Team[];
  fixtures: Fixture[];
  seasonKey: string;
  /** Season label, e.g. "2026"; the play-off promotes to the next one. */
  season: string;
  /** Real post-season games from the feed (play-off legs once known). */
  postseason?: Fixture[];
  /** Clubs of each separate table (MLS conferences), matching `league.groups`. */
  groups?: { id: string; teamIds: number[] }[];
}

type Tab = "table" | "chances";

/** "2026" → "2027", "2026/27" → "2027/28". */
function nextSeasonLabel(season: string): string {
  const single = /^(\d{4})$/.exec(season);
  if (single) return String(Number(single[1]) + 1);
  const split = /^(\d{4})\/(\d{2})$/.exec(season);
  if (split) return `${Number(split[1]) + 1}/${String((Number(split[2]) + 1) % 100).padStart(2, "0")}`;
  return "";
}

export function LeagueSimulator({ league, teams, fixtures, seasonKey, season: seasonLabel, postseason, groups }: Props) {
  const t = useTranslations("Simulator");
  const lang = useLocale() as SiteLocale;
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("table");
  // Leagues split into separate tables (MLS conferences) show one at a time.
  const groupTabs = useMemo(
    () => (league.groups ?? []).flatMap((g) => {
      const members = groups?.find((m) => m.id === g.id);
      return members ? [{ id: g.id, name: g.name[lang], teamIds: members.teamIds }] : [];
    }),
    [league.groups, groups, lang],
  );
  const [groupId, setGroupId] = useState(groupTabs[0]?.id);
  const group = groupTabs.find((g) => g.id === groupId) ?? groupTabs[0];
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const season = useSimStore((s) => (hydrated ? s.seasons[seasonKey] : undefined) ?? emptySeason);
  const canUndo = useSimStore((s) => (s.history[seasonKey]?.length ?? 0) > 0);
  const { setScore, applyResults, replace, reset, undo, reconcile, drop } = useSimStore.getState();

  const ordered = useMemo(() => sortFixtures(fixtures), [fixtures]);
  const teamMap = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams]);
  const real = useMemo(() => realResults(fixtures), [fixtures]);
  // Ratings come from real results only: predictions shouldn't change how good a team is.
  const model = useMemo(() => buildLeagueModel(teams, fixtures, real), [teams, fixtures, real]);
  const standingsOptions = useMemo(() => ({ tiebreakers: league.tiebreakers }), [league.tiebreakers]);

  const effective = useMemo(() => effectiveResults(fixtures, season.predictions), [fixtures, season.predictions]);
  const tableTeams = useMemo(
    () => (group ? group.teamIds.flatMap((id) => teamMap.get(id) ?? []) : teams),
    [group, teamMap, teams],
  );
  const rows = useMemo(
    () => computeStandings(tableTeams, ordered, effective, standingsOptions),
    [tableTeams, ordered, effective, standingsOptions],
  );

  // Promotion play-off (Série B, Championship): seeded from the table once every
  // league match has a score, then round by round from the results entered.
  const playoff = league.playoff;
  const legIds = useMemo(() => (playoff ? playoffIds(playoff) : []), [playoff]);
  // The share codec only needs the ids, which don't depend on who qualifies.
  const shareFixtures = useMemo<Fixture[]>(
    () => [...fixtures, ...legIds.map((id) => ({ id, matchday: 0, utcDate: "", homeId: 0, awayId: 0, result: null }))],
    [fixtures, legIds],
  );
  const seasonComplete = useMemo(() => fixtures.every((f) => effective[f.id]), [fixtures, effective]);
  const bracketOptions = useMemo(
    () => ({
      afterMatchday: ordered.at(-1)?.matchday ?? 0,
      afterDate: ordered.at(-1)?.utcDate ?? "",
      ...(postseason ? { real: postseason } : {}),
    }),
    [ordered, postseason],
  );
  const bracket = useMemo(
    () => (playoff ? buildBracket(rows, playoff, season.predictions, { ...bracketOptions, seasonComplete }) : []),
    [rows, playoff, season.predictions, bracketOptions, seasonComplete],
  );

  // Play-off scores belong to one pairing: when a tie's clubs change (a league or
  // earlier-round result was edited), its scores are dropped. All of them go if
  // the league is no longer complete.
  const pairings = new Map(bracket.flat().map((tie) => [`${tie.round}-${tie.index}`, `${tie.higher.teamId}-${tie.lower.teamId}`]));
  const pairingKey = seasonComplete ? [...pairings.values()].join(",") : null;
  const lastPairings = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!hydrated || !playoff) return;
    if (!seasonComplete) {
      drop(seasonKey, legIds);
    } else if (lastPairings.current) {
      const stale = bracket
        .flat()
        .filter((tie) => lastPairings.current!.get(`${tie.round}-${tie.index}`) !== pairings.get(`${tie.round}-${tie.index}`))
        .flatMap((tie) => tieIds(tie.round, tie.index, tie.config));
      if (stale.length) drop(seasonKey, stale);
    }
    lastPairings.current = seasonComplete ? pairings : null;
  }, [hydrated, pairingKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The play-off is listed as one more entry after the last matchday.
  const matchdays = useMemo(
    () => [...new Set(ordered.map((f) => f.matchday)), ...(playoff ? [PLAYOFF_MATCHDAY] : [])],
    [ordered, playoff],
  );
  const [matchday, setMatchday] = useState(() => {
    const next = ordered.find((f) => !f.result);
    return next?.matchday ?? matchdays.at(-1) ?? 1;
  });
  const onPlayoff = matchday === PLAYOFF_MATCHDAY;
  const matchdayFixtures = useMemo(() => ordered.filter((f) => f.matchday === matchday), [ordered, matchday]);

  // Load saved predictions, then apply a shared link (?r=...) if present.
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve(useSimStore.persist.rehydrate()).then(() => {
      if (cancelled) return;
      const url = new URL(window.location.href);
      const shared = url.searchParams.get("r");
      if (shared !== null) {
        const decoded = decodeResults(shareFixtures, shared);
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

  /** Rest of the league and, where there is one, the whole promotion play-off in one step. */
  const simulateRest = () => {
    const rng = createRng(randomSeed());
    const leagueResults = simulateFixtures(ordered, effective, model, rng);
    if (!playoff) return applyResults(seasonKey, leagueResults);
    const all = { ...effective, ...leagueResults };
    const table = computeStandings(teams, ordered, all, standingsOptions);
    const playoffResults = simulatePlayoff(table, playoff, { ...season.predictions, ...all }, model, rng, bracketOptions);
    applyResults(seasonKey, { ...leagueResults, ...playoffResults });
  };

  const simulateWholePlayoff = () =>
    playoff && applyResults(seasonKey, simulatePlayoff(rows, playoff, season.predictions, model, createRng(randomSeed()), bracketOptions));

  const simulateOne = (fixture: Fixture) => {
    const rng = createRng(randomSeed());
    const score = isShootoutId(fixture.id)
      ? simulatePenalties(rng)
      : simulateScore(
          fixture.neutral ? expectedGoalsNeutral(model, fixture.homeId, fixture.awayId) : expectedGoals(model, fixture.homeId, fixture.awayId),
          rng,
        );
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
    url.searchParams.set("r", encodeResults(shareFixtures, season.predictions));
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      window.prompt(t("share"), url.toString());
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [confirmReset, setConfirmReset] = useState(false);
  const onReset = () => {
    if (Object.keys(season.predictions).length === 0) reset(seasonKey);
    else setConfirmReset(true);
  };

  const monteCarloInput = useMemo<MonteCarloInput | null>(
    () =>
      tab === "chances" && hydrated
        ? {
            teams,
            fixtures,
            fixed: effective,
            model,
            standings: standingsOptions,
            iterations: ITERATIONS,
            seed: 2026,
            ...(groupTabs.length ? { groups: groupTabs.map((g) => g.teamIds) } : {}),
          }
        : null,
    [tab, hydrated, teams, fixtures, effective, model, standingsOptions, groupTabs],
  );

  const actionButton =
    "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";
  const primaryButton = "rounded-lg bg-pitch-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pitch-700";
  const tabButton = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-semibold ${active ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"}`;

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

      {/* Phones: tabs, table, actions, fixtures. Desktop: tabs and actions on one
          row above the table and fixtures columns. */}
      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_400px] lg:items-start">
        <div className="flex flex-wrap items-center gap-2 self-start justify-self-start lg:col-start-1 lg:row-start-1">
          <div className="flex rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "table"} className={tabButton(tab === "table")} onClick={() => setTab("table")}>
              {t("table")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "chances"} className={tabButton(tab === "chances")} onClick={() => setTab("chances")}>
              {t("chances")}
            </button>
          </div>
          {groupTabs.length > 1 && (
            <div className="flex rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="group" aria-label={t("conference")} data-testid="group-switch">
              {groupTabs.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={g.id === group?.id}
                  className={`whitespace-nowrap ${tabButton(g.id === group?.id)}`}
                  onClick={() => setGroupId(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-2">
          {tab === "table" ? (
            <>
              <StandingsTable league={league} rows={rows} teams={teamMap} />
              {playoff && bracket.length > 0 && (
                <PromotedClubs
                  bracket={bracket}
                  rows={rows}
                  teams={teamMap}
                  predictions={season.predictions}
                  seasonComplete={seasonComplete}
                  directPromotion={playoff.directPromotion}
                  promotedTo={playoff.promotedTo}
                  nextSeason={nextSeasonLabel(seasonLabel)}
                />
              )}
            </>
          ) : (
            <ProbabilityGrid league={league} input={monteCarloInput} rows={rows} teams={teamMap} />
          )}
        </div>

        <div className="flex flex-wrap gap-2 lg:col-span-2 lg:col-start-2 lg:row-start-1 lg:justify-end" data-testid="actions">
          <button
            type="button"
            className={`${primaryButton} grow disabled:opacity-40 lg:grow-0`}
            onClick={() => (onPlayoff ? simulateWholePlayoff() : simulate(matchdayFixtures))}
            disabled={onPlayoff && !seasonComplete}
          >
            {t("simulateMatchday")}
          </button>
          <button type="button" className={`${actionButton} grow lg:grow-0`} onClick={simulateRest}>
            {t("simulateRest")}
          </button>
          <button type="button" className={`${actionButton} grow lg:grow-0`} onClick={() => undo(seasonKey)} disabled={!canUndo}>
            {t("undo")}
          </button>
          <button type="button" className={`${actionButton} grow lg:grow-0`} onClick={onReset}>
            {t("reset")}
          </button>
          <button type="button" className={`${actionButton} grow lg:grow-0`} onClick={share}>
            {copied ? t("linkCopied") : t("share")}
          </button>
        </div>

        <div className="min-w-0 lg:col-start-3 lg:row-start-2" data-testid="fixtures">
          <FixtureList
            matchday={matchday}
            matchdays={matchdays}
            onMatchdayChange={setMatchday}
            fixtures={matchdayFixtures}
            teams={teamMap}
            predictions={season.predictions}
            onScore={onScore}
            onSimulate={simulateOne}
            {...(playoff ? { playoff: { bracket, seasonComplete, promotedTo: playoff.promotedTo } } : {})}
          />
        </div>
      </div>
      <ConfirmDialog
        open={confirmReset}
        danger
        title={t("resetTitle")}
        message={t("resetConfirm")}
        confirmLabel={t("resetAction")}
        cancelLabel={t("cancel")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          reset(seasonKey);
          setConfirmReset(false);
        }}
      />
    </div>
  );
}
