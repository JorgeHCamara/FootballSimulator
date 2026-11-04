"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LeagueConfig, SiteLocale } from "../config/leagues.ts";
import { expectedGoals, expectedGoalsNeutral, simulateFixtures, simulateScore } from "../engine/match.ts";
import type { MonteCarloInput } from "../engine/montecarlo.ts";
import { buildLeagueModel, type TeamStrength } from "../engine/ratings.ts";
import {
  buildBracket,
  isShootoutId,
  needsShootout,
  playoffCancelled,
  playoffIds,
  seedByGroupPlace,
  seriesGames,
  simulatePenalties,
  simulatePlayoff,
  tieIds,
} from "../engine/playoffs.ts";
import { effectiveResults, realResults } from "../engine/results.ts";
import { createRng, randomSeed } from "../engine/rng.ts";
import {
  allSplitFixtureIds,
  buildSplitPhase,
  groupOfRound,
  isSlotTeamId,
  slotTeamId,
  splitFixtures,
  splitGroupTable,
  splitGroupsFrom,
} from "../engine/split.ts";
import { computeStandings, sortFixtures } from "../engine/standings.ts";
import type { Fixture, ResultMap, Score, StandingRow, Team } from "../engine/types.ts";
import { decodeResults, encodeResults } from "../lib/shareCodec.ts";
import { emptySeason, useSimStore } from "../store/simStore.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { FixtureList, PLAYOFF_MATCHDAY } from "./FixtureList.tsx";
import { ITERATIONS, ProbabilityGrid } from "./ProbabilityGrid.tsx";
import { PlayoffChampion } from "./PlayoffChampion.tsx";
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
  /** Starting ratings (continental competitions: from each club's domestic league). */
  priorStrengths?: Record<number, TeamStrength>;
  /** Clubs joining the knockout phase from another competition, with their records there (see `seedFromGroups.external`). */
  externalSeeds?: StandingRow[];
  /**
   * Clubs already in the competition of the first zone by another route
   * (Argentina's annual table: the tournament champions, already in the
   * Libertadores). They show in that zone and its places pass down.
   */
  qualifiedElsewhere?: number[];
  /** Note under the table for `qualifiedElsewhere`, e.g. who the champions are. */
  qualifiedNote?: string;
  /** Points deducted by the league (ESPN's standings), by club. */
  deductions?: Record<number, number>;
  /** A split league: its first phase's games, by the feed's stage tag. */
  firstPhaseIds?: number[];
}

type Tab = "table" | "chances";

/** The group switch's entry for a split's first phase (not a group id). */
const REGULAR_TAB = "regular";

/** "2026" → "2027", "2026/27" → "2027/28". */
function nextSeasonLabel(season: string): string {
  const single = /^(\d{4})$/.exec(season);
  if (single) return String(Number(single[1]) + 1);
  const split = /^(\d{4})\/(\d{2})$/.exec(season);
  if (split) return `${Number(split[1]) + 1}/${String((Number(split[2]) + 1) % 100).padStart(2, "0")}`;
  return "";
}

export function LeagueSimulator({
  league,
  teams,
  fixtures,
  seasonKey,
  season: seasonLabel,
  postseason,
  groups,
  priorStrengths,
  externalSeeds,
  qualifiedElsewhere,
  qualifiedNote,
  deductions,
  firstPhaseIds,
}: Props) {
  const t = useTranslations("Simulator");
  const lang = useLocale() as SiteLocale;
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("table");
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const season = useSimStore((s) => (hydrated ? s.seasons[seasonKey] : undefined) ?? emptySeason);
  const canUndo = useSimStore((s) => (s.history[seasonKey]?.length ?? 0) > 0);
  const { setScore, applyResults, replace, reset, undo, reconcile, drop } = useSimStore.getState();

  const teamMap = useMemo(() => new Map(teams.map((tm) => [tm.id, tm])), [teams]);
  const real = useMemo(() => realResults(fixtures), [fixtures]);
  // Ratings come from real results only: predictions shouldn't change how good a team is.
  const model = useMemo(
    () =>
      buildLeagueModel(teams, fixtures, real, priorStrengths ? { priorStrengths: new Map(Object.entries(priorStrengths).map(([id, st]) => [Number(id), st])) } : {}),
    [teams, fixtures, real, priorStrengths],
  );
  const baseOptions = useMemo(() => ({ tiebreakers: league.tiebreakers, ...(deductions ? { deductions } : {}) }), [league.tiebreakers, deductions]);

  // A split league (Greece's play-offs, Ecuador's final stage, Scotland's last
  // five rounds). Until the split's real games are published they're
  // generated from the first phase's table once it is complete.
  const splitConfig = league.split;
  const lastReal = useMemo(() => sortFixtures(fixtures).at(-1), [fixtures]);
  const realGroups = league.groups && groups?.length ? groups : undefined;
  const canGenerate = useMemo(() => {
    if (!splitConfig || !lastReal || realGroups) return false;
    if (splitConfig.afterRound !== undefined) return lastReal.matchday === splitConfig.afterRound;
    // The first phase ends with the last round published: only once it is all out (a double round robin at least).
    const games = new Map<number, number>();
    for (const f of fixtures) for (const id of [f.homeId, f.awayId]) games.set(id, (games.get(id) ?? 0) + 1);
    return teams.every((tm) => (games.get(tm.id) ?? 0) >= 2 * (teams.length - 1));
  }, [splitConfig, lastReal, realGroups, fixtures, teams]);
  // The last round of the first phase: set, or the last round published, or
  // (once ESPN has the groups) the last round with a game between two groups.
  const splitRound = useMemo(() => {
    if (!splitConfig) return 0;
    if (splitConfig.afterRound !== undefined) return splitConfig.afterRound;
    if (realGroups) {
      const groupOf = new Map(realGroups.flatMap((g) => g.teamIds.map((id) => [id, g.id] as const)));
      return Math.max(0, ...fixtures.filter((f) => groupOf.get(f.homeId) !== groupOf.get(f.awayId)).map((f) => f.matchday));
    }
    return lastReal?.matchday ?? 0;
  }, [splitConfig, realGroups, fixtures, lastReal]);
  // Groups as new tables (Greece, Ecuador): the regular season, then each
  // group with its own games and rounds. Scotland's table carries on instead.
  const phased = Boolean(splitConfig && league.groups && (realGroups || canGenerate || splitConfig.afterRound !== undefined));
  const standingsOptions = useMemo(
    () =>
      splitConfig && (splitConfig.afterRound !== undefined || canGenerate || phased)
        ? { ...baseOptions, split: { afterRound: splitRound, groups: splitConfig.groups, ...(phased ? { separate: true } : {}) } }
        : baseOptions,
    [baseOptions, splitConfig, canGenerate, phased, splitRound],
  );
  const phase = useMemo(
    () =>
      phased && splitConfig
        ? buildSplitPhase({
            teams,
            fixtures,
            results: { ...realResults(fixtures), ...season.predictions },
            groups: splitConfig.groups,
            afterRound: splitRound,
            ...(realGroups ? { realGroups: (league.groups ?? []).map((g) => realGroups.find((m) => m.id === g.id)?.teamIds ?? []) } : {}),
            ...(firstPhaseIds ? { firstPhaseIds } : {}),
            options: baseOptions,
          })
        : null,
    [phased, splitConfig, teams, fixtures, season.predictions, splitRound, realGroups, league.groups, baseOptions, firstPhaseIds],
  );
  // Scotland: the split's rounds, generated once the first phase is complete.
  const extraRounds = useMemo(() => {
    if (phased || !canGenerate || !splitConfig || !lastReal) return null;
    const results = effectiveResults(fixtures, season.predictions);
    if (!fixtures.every((f) => results[f.id])) return null;
    const groupTeams = splitGroupsFrom(computeStandings(teams, fixtures, results, { ...baseOptions, includeForm: false }), splitConfig.groups);
    return splitFixtures(groupTeams, splitConfig.groups, splitRound, lastReal.utcDate);
  }, [phased, canGenerate, splitConfig, lastReal, fixtures, season.predictions, teams, baseOptions, splitRound]);
  const allFixtures = useMemo(
    () =>
      phase ? (phase.members ? [...phase.firstPhase, ...phase.groupFixtures.flat()] : phase.firstPhase) : extraRounds ? [...fixtures, ...extraRounds] : fixtures,
    [phase, extraRounds, fixtures],
  );
  const ordered = useMemo(() => sortFixtures(allFixtures), [allFixtures]);
  /** Stand-in games between places ("1st v 2nd") until the groups' clubs are known. */
  const slotFixtures = useMemo(() => (phase && !phase.members ? sortFixtures(phase.groupFixtures.flat()) : []), [phase]);
  /** Stand-in clubs for those places. */
  const slotTeams = useMemo(
    () =>
      phase && !phase.members
        ? teams.map((_, i) => ({ id: slotTeamId(i + 1), name: t("slotName", { place: i + 1 }), shortName: t("slotShort", { place: i + 1 }), tla: String(i + 1) }))
        : [],
    [phase, teams, t],
  );
  const displayTeams = useMemo(() => (slotTeams.length ? new Map([...teamMap, ...slotTeams.map((s) => [s.id, s] as const)]) : teamMap), [teamMap, slotTeams]);

  // Leagues split into separate tables (MLS conferences) show one at a time;
  // a split's groups from the start, with places standing in for the clubs
  // until the first phase is complete.
  const groupTabs = useMemo(() => {
    let place = 0;
    return (league.groups ?? []).flatMap((g, i) => {
      const size = splitConfig?.groups[i]?.size ?? 0;
      const slots = Array.from({ length: i === (league.groups ?? []).length - 1 ? teams.length - place : size }, () => slotTeamId(++place));
      const teamIds = phase ? (phase.members?.[i] ?? slots) : groups?.find((m) => m.id === g.id)?.teamIds;
      return teamIds ? [{ id: g.id, index: i, name: g.name[lang], shortName: g.shortName[lang], teamIds, ...(g.zones ? { zones: g.zones } : {}) }] : [];
    });
  }, [league.groups, groups, phase, splitConfig, teams.length, lang]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const known = Boolean(phase?.members);
  // The first phase's own table comes first; shown until the groups are known.
  const regularTab = phase
    ? {
        id: REGULAR_TAB,
        name: splitConfig?.firstPhaseName?.[lang] ?? t("regularSeason"),
        shortName: splitConfig?.firstPhaseShortName?.[lang] ?? t("regularSeasonShort"),
      }
    : null;
  const selectedId = groupId ?? (phase && !known ? REGULAR_TAB : groupTabs[0]?.id);
  const showRegular = Boolean(regularTab) && selectedId === REGULAR_TAB && tab === "table";
  // In the chances: before the groups are known, the whole season; after, each group.
  const overallChances = Boolean(phase && !known && tab === "chances");
  const group = showRegular || overallChances ? undefined : (groupTabs.find((g) => g.id === selectedId) ?? groupTabs[0]);
  const slotGroup = Boolean(phase && !known && group);
  // A group with its own zones (Ecuador's final stage) shows and simulates
  // those; the first phase, where each place leads.
  const tableLeague = useMemo(
    () => (showRegular || !group ? { ...league, groups: undefined } : group.zones ? { ...league, zones: group.zones } : league),
    [league, group, showRegular],
  );
  const chancesLeague = useMemo(
    () => (overallChances && splitConfig?.finalZones ? { ...league, zones: splitConfig.finalZones, groups: undefined } : tableLeague),
    [overallChances, splitConfig, league, tableLeague],
  );
  const groupTableOptions = useMemo(() => ({ tiebreakers: league.tiebreakers }), [league.tiebreakers]);

  const effective = useMemo(() => effectiveResults(allFixtures, season.predictions), [allFixtures, season.predictions]);
  const tableTeams = useMemo(
    () => (group ? group.teamIds.flatMap((id) => displayTeams.get(id) ?? []) : teams),
    [group, displayTeams, teams],
  );
  const rows = useMemo(() => {
    if (phase && showRegular) return computeStandings(teams, phase.firstPhase, effective, baseOptions);
    if (phase && group) {
      if (slotGroup) return computeStandings(tableTeams, [], {}, { tiebreakers: league.tiebreakers, fallbackOrder: group.teamIds });
      return splitGroupTable(phase, group.index, teams, effective, groupTableOptions);
    }
    return computeStandings(tableTeams, ordered, effective, standingsOptions);
  }, [phase, showRegular, group, slotGroup, teams, tableTeams, ordered, effective, baseOptions, standingsOptions, groupTableOptions, league.tiebreakers]);
  /**
   * The first phase's table once the groups are known: each club in the zone
   * of the group it went into (ESPN's groups can differ from the table when
   * postponed games were played after the cut).
   */
  const zoneByTeam = useMemo(() => {
    if (!phase?.members || !showRegular) return undefined;
    return new Map(phase.members.flatMap((ids, g) => (league.zones[g] ? ids.map((id) => [id, league.zones[g]!] as const) : [])));
  }, [phase, showRegular, league.zones]);
  /** A group's points carried over from the first phase, shown beside the total. */
  const carried = phase && group && known ? phase.startPoints[group.index] : undefined;

  // Reserve sides (Eerste Divisie's "Jong" teams) can't go up: promotion places
  // and play-off seeds count first teams only, renumbered 1, 2, 3…
  const reserveNames = league.reserveTeams;
  const qualified = useMemo(() => new Set(qualifiedElsewhere ?? []), [qualifiedElsewhere]);
  // Clubs whose places pass down: reserve sides, and clubs qualified by another route.
  const passesDown = Boolean(reserveNames) || qualified.size > 0;
  const isReserve = (id: number) => (reserveNames?.some((start) => teamMap.get(id)?.name.startsWith(start)) ?? false) || qualified.has(id);
  const firstTeams = (table: StandingRow[]) =>
    passesDown ? table.filter((r) => !isReserve(r.teamId)).map((r, i) => ({ ...r, position: i + 1 })) : table;
  const playoffRows = useMemo(() => firstTeams(rows), [rows, qualified]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Position that decides each club's zone (none for a reserve side or a club qualified elsewhere). */
  const zonePositions = useMemo(
    () => (passesDown ? new Map(rows.map((r) => [r.teamId, playoffRows.find((p) => p.teamId === r.teamId)?.position ?? null])) : undefined),
    [passesDown, rows, playoffRows],
  );

  // Play-offs across separate tables (MLS Cup) are seeded from every group's
  // table, plus the overall table for games between the groups' winners.
  const tablesFor = (results: ResultMap) => {
    const overall = firstTeams(computeStandings(teams, ordered, results, standingsOptions));
    if (!groupTabs.length) return { overall, groups: undefined };
    const groupTables = groupTabs.map((g) =>
      computeStandings(g.teamIds.flatMap((id) => teamMap.get(id) ?? []), ordered, results, standingsOptions),
    );
    // A knockout seeded from the group places (Libertadores): one ranking, winners first.
    const seeding = league.playoff?.seedFromGroups;
    if (seeding) return { overall: seedByGroupPlace(groupTables, externalSeeds, seeding.places, seeding.interleave), groups: undefined };
    return { overall, groups: groupTables };
  };

  // Promotion play-off (Série B, Championship): seeded from the table once every
  // league match has a score, then round by round from the results entered.
  const playoff = league.playoff;
  const legIds = useMemo(() => (playoff ? playoffIds(playoff) : []), [playoff]);
  // The share codec only needs the ids, which don't depend on who qualifies.
  const shareFixtures = useMemo<Fixture[]>(
    () => [
      ...fixtures,
      ...[...legIds, ...(canGenerate ? allSplitFixtureIds(teams.map((tm) => tm.id)) : [])].map((id) => ({ id, matchday: 0, utcDate: "", homeId: 0, awayId: 0, result: null })),
    ],
    [fixtures, legIds, canGenerate, teams],
  );
  const seasonComplete = useMemo(() => allFixtures.every((f) => effective[f.id]), [allFixtures, effective]);
  // Serie B: no play-off when 3rd finishes far enough clear of 4th.
  const cancelled = Boolean(playoff && seasonComplete && playoffCancelled(playoff, playoffRows));
  const bracketOptions = useMemo(
    () => ({
      afterMatchday: ordered.at(-1)?.matchday ?? 0,
      afterDate: ordered.at(-1)?.utcDate ?? "",
      ...(postseason ? { real: postseason } : {}),
    }),
    [ordered, postseason],
  );
  const bracket = useMemo(() => {
    if (!playoff) return [];
    if (!groupTabs.length) return buildBracket(playoffRows, playoff, season.predictions, { ...bracketOptions, seasonComplete });
    const { overall, groups: groupTables } = tablesFor(effective);
    return buildBracket(overall, playoff, season.predictions, { ...bracketOptions, seasonComplete, ...(groupTables ? { groups: groupTables } : {}) });
  }, [playoffRows, playoff, season.predictions, bracketOptions, seasonComplete, groupTabs, effective]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // A shoot-out score belongs to a level tie (or, in a series, a drawn game):
  // once it has a winner without penalties, the shoot-out score is cleared.
  useEffect(() => {
    if (!hydrated || !playoff) return;
    const stale = bracket.flat().flatMap((tie) =>
      tie.config.bestOf
        ? seriesGames(tie, season.predictions).filter((g) => season.predictions[g.shootout.id] && !g.needsPenalties).map((g) => g.shootout.id)
        : tie.shootout && season.predictions[tie.shootout.id] && !needsShootout(tie, season.predictions)
          ? [tie.shootout.id]
          : [],
    );
    if (stale.length) drop(seasonKey, stale);
  }, [hydrated, bracket, season.predictions]); // eslint-disable-line react-hooks/exhaustive-deps

  // The play-off is listed as one more entry after the last matchday.
  const matchdays = useMemo(
    () => [...new Set([...ordered, ...slotFixtures].map((f) => f.matchday))].sort((a, b) => a - b).concat(playoff ? [PLAYOFF_MATCHDAY] : []),
    [ordered, slotFixtures, playoff],
  );
  const [matchday, setMatchday] = useState(() => {
    const next = ordered.find((f) => !f.result);
    return next?.matchday ?? matchdays.at(-1) ?? 1;
  });
  const onPlayoff = matchday === PLAYOFF_MATCHDAY;
  const matchdayFixtures = useMemo(() => [...ordered, ...slotFixtures].filter((f) => f.matchday === matchday), [ordered, slotFixtures, matchday]);
  /** Rounds of a split's groups: "Championship play-offs 3". */
  const roundLabels = useMemo(
    () =>
      phase
        ? Object.fromEntries(
            matchdays.flatMap((md) => {
              const g = groupOfRound(md);
              return g === null ? [] : [[md, t("groupRound", { group: league.groups?.[g]?.name[lang] ?? "", number: md % 1000 })]];
            }),
          )
        : undefined,
    [phase, matchdays, league.groups, lang, t],
  );
  const slotRound = matchdayFixtures.length > 0 && matchdayFixtures.every((f) => isSlotTeamId(f.homeId));
  /** Picking a table shows its fixtures: its next round with a game to play, else its last. */
  const pickTable = (id: string) => {
    setGroupId(id);
    if (!phase) return;
    const g = id === REGULAR_TAB ? null : groupTabs.find((x) => x.id === id)?.index ?? null;
    const own = [...ordered, ...slotFixtures].filter((f) => groupOfRound(f.matchday) === g);
    const next = own.find((f) => !effective[f.id]) ?? own.at(-1);
    if (next) setMatchday(next.matchday);
  };

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
    // Then the split's games, from the table the first phase ends with.
    if (canGenerate && splitConfig && lastReal && (phase ? !phase.members : !extraRounds)) {
      const all = { ...effective, ...leagueResults };
      const groupTeams = splitGroupsFrom(computeStandings(teams, fixtures, all, { ...baseOptions, includeForm: false }), splitConfig.groups);
      Object.assign(leagueResults, simulateFixtures(splitFixtures(groupTeams, splitConfig.groups, splitRound, lastReal.utcDate), season.predictions, model, rng));
    }
    if (!playoff) return applyResults(seasonKey, leagueResults);
    const all = { ...effective, ...leagueResults };
    const { overall, groups: groupTables } = tablesFor(all);
    const playoffResults = simulatePlayoff(overall, playoff, { ...season.predictions, ...all }, model, rng, {
      ...bracketOptions,
      ...(groupTables ? { groups: groupTables } : {}),
    });
    applyResults(seasonKey, { ...leagueResults, ...playoffResults });
  };

  const simulateWholePlayoff = () => {
    if (!playoff) return;
    const { overall, groups: groupTables } = groupTabs.length ? tablesFor(effective) : { overall: playoffRows, groups: undefined };
    applyResults(
      seasonKey,
      simulatePlayoff(overall, playoff, season.predictions, model, createRng(randomSeed()), {
        ...bracketOptions,
        ...(groupTables ? { groups: groupTables } : {}),
      }),
    );
  };

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
            fixtures: allFixtures,
            fixed: effective,
            model,
            standings: standingsOptions,
            // The knockout phase makes each continental run several times slower, so half as many (as for cups).
            iterations: league.continental || playoff?.seedFromGroups || (playoff?.title && !league.groups) ? ITERATIONS / 2 : ITERATIONS,
            seed: 2026,
            // A split's groups once known: each its own games, from its carried points.
            ...(phase?.members
              ? {
                  groups: phase.members,
                  groupFixtures: phase.groupFixtures,
                  groupStandings: phase.members.map((_, g) => ({
                    ...groupTableOptions,
                    startPoints: phase.startPoints[g] ?? {},
                    fallbackOrder: phase.firstTable.map((r) => r.teamId),
                  })),
                }
              : !phase && groupTabs.length
                ? { groups: groupTabs.map((g) => g.teamIds) }
                : {}),
            // Not yet: each run generates them from its own table.
            ...(canGenerate && splitConfig && lastReal && (phase ? !phase.members : !extraRounds)
              ? { project: { afterRound: splitRound, afterDate: lastReal.utcDate, groups: splitConfig.groups } }
              : {}),
            ...(qualifiedElsewhere?.length ? { passDown: qualifiedElsewhere } : {}),
            // Continental competitions: the chance of winning it takes the knockout phase too.
            // Also a title play-off seeded from groups (Argentina): the chance of winning the tournament.
            // and a title play-off of a single table (Colombia).
            ...((league.continental || playoff?.seedFromGroups || (playoff?.title && !league.groups)) && playoff
              ? { playoff: { config: playoff, options: bracketOptions, ...(externalSeeds ? { external: externalSeeds } : {}) } }
              : {}),
          }
        : null,
    [tab, hydrated, teams, allFixtures, effective, model, standingsOptions, groupTabs, league.continental, playoff, bracketOptions, externalSeeds, qualifiedElsewhere, canGenerate, phase, extraRounds, splitConfig, lastReal, splitRound, groupTableOptions], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const actionButton =
    "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";
  const primaryButton = "rounded-lg bg-pitch-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pitch-700";
  const tabButton = (active: boolean, compact = false) =>
    `rounded-md ${compact ? "px-2 sm:px-3" : "px-3"} py-1.5 text-sm font-semibold ${active ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"}`;

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
      {/* One column on phones, never wider than the screen (a long group switch scrolls instead). */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[auto_minmax(0,1fr)_400px] lg:items-start">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 self-start justify-self-start lg:col-start-1 lg:row-start-1">
          <div className="flex rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "table"} className={tabButton(tab === "table")} onClick={() => setTab("table")}>
              {t("table")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "chances"} className={tabButton(tab === "chances")} onClick={() => setTab("chances")}>
              {t("chances")}
            </button>
          </div>
          {(groupTabs.length > 1 || regularTab) && !overallChances && (
            <div
              className="flex max-w-full overflow-x-auto rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800"
              role="group"
              aria-label={t(groupTabs.length > 4 ? "group" : "conference")}
              data-testid="group-switch"
            >
              {[...(regularTab && tab === "table" ? [regularTab] : []), ...groupTabs].map((g) => {
                const selected = g.id === REGULAR_TAB ? showRegular : g.id === group?.id;
                // Many groups (Libertadores A–H): the selected one by name, the others by letter.
                const label = groupTabs.length > 4 && !selected ? g.id : g.name;
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={selected}
                    aria-label={g.name}
                    title={g.name}
                    className={`whitespace-nowrap ${tabButton(selected, Boolean(phase))}`}
                    onClick={() => pickTable(g.id)}
                  >
                    {/* A split's tables: short names on phones ("Title"), in full from tablets up. */}
                    {phase ? (
                      <>
                        <span className="sm:hidden">{g.shortName}</span>
                        <span className="hidden sm:inline">{g.name}</span>
                      </>
                    ) : (
                      label
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-2">
          {tab === "table" ? (
            <>
              <StandingsTable
                league={tableLeague}
                rows={rows}
                teams={displayTeams}
                {...(carried ? { carried } : {})}
                {...(zoneByTeam ? { zoneByTeam } : {})}
                {...(slotGroup ? { note: t("slotNote", { phase: (regularTab?.name ?? "").toLowerCase() }) } : {})}
                {...(zonePositions ? { zonePositions } : {})}
                {...(qualified.size ? { qualified } : {})}
                {...(qualifiedNote ? { qualifiedNote } : {})}
                {...(deductions && !group ? { deductions } : {})}
              />
              {playoff?.title && bracket.length > 0 && (
                <PlayoffChampion
                  bracket={bracket}
                  teams={teamMap}
                  predictions={season.predictions}
                  seasonComplete={seasonComplete}
                  title={playoff.title}
                  season={seasonLabel}
                  {...(league.continental ? { knockout: playoff.seedFromGroups ? ("groupStage" as const) : ("leaguePhase" as const) } : {})}
                />
              )}
              {playoff?.promotedTo && (bracket.length > 0 || cancelled) && (
                <PromotedClubs
                  bracket={bracket}
                  cancelled={cancelled}
                  {...(playoff.directIfClear ? { clearPosition: playoff.directIfClear.position } : {})}
                  {...(playoff.winnerPlays ? { winnerPlays: playoff.winnerPlays } : {})}
                  rows={playoffRows}
                  teams={teamMap}
                  predictions={season.predictions}
                  seasonComplete={seasonComplete}
                  directPromotion={playoff.directPromotion ?? []}
                  promotedTo={playoff.promotedTo}
                  nextSeason={nextSeasonLabel(seasonLabel)}
                />
              )}
            </>
          ) : (
            <ProbabilityGrid league={chancesLeague} input={monteCarloInput} rows={rows} teams={teamMap} />
          )}
        </div>

        <div className="flex flex-wrap gap-2 lg:col-span-2 lg:col-start-2 lg:row-start-1 lg:justify-end" data-testid="actions">
          <button
            type="button"
            className={`${primaryButton} grow disabled:opacity-40 lg:grow-0`}
            onClick={() => (onPlayoff ? simulateWholePlayoff() : simulate(matchdayFixtures))}
            disabled={(onPlayoff && !seasonComplete) || slotRound}
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
            teams={displayTeams}
            {...(roundLabels ? { roundLabels } : {})}
            predictions={season.predictions}
            onScore={onScore}
            onSimulate={simulateOne}
            {...(slotRound
              ? { note: t("slotNote", { phase: (regularTab?.name ?? "").toLowerCase() }) }
              : (phase?.generated || extraRounds) && matchday > splitRound && matchday !== PLAYOFF_MATCHDAY
                ? { note: t("projectedSplitNote", { round: splitRound }) }
                : {})}
            {...(playoff
              ? {
                  playoff: {
                    bracket,
                    seasonComplete,
                    ...(playoff.promotedTo ? { promotedTo: playoff.promotedTo } : {}),
                    ...(playoff.title ? { title: playoff.title } : {}),
                    ...(playoff.winnerPlays ? { winnerPlays: playoff.winnerPlays } : {}),
                    ...(cancelled && playoff.directIfClear ? { cancelled: playoff.directIfClear } : {}),
                    groupNames: (league.groups ?? []).map((g) => g.shortName[lang]),
                    ...(playoff.seedFromGroups?.interleave
                      ? { zoneSlots: { ids: (league.groups ?? []).map((g) => g.id), names: (league.groups ?? []).map((g) => g.name[lang]) } }
                      : {}),
                    ...(league.continental
                      ? { knockout: playoff.seedFromGroups ? (playoff.seedFromGroups.external ? "groupStageExternal" : "groupStage") : "leaguePhase" }
                      : {}),
                  },
                }
              : {})}
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
