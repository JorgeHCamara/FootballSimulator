import { zoneForPosition, type LeagueConfig, type Zone, type ZoneKind } from "../config/leagues.ts";
import { runMonteCarlo, type MonteCarloInput } from "../engine/montecarlo.ts";
import { buildLeagueModel } from "../engine/ratings.ts";
import { effectiveResults, realResults } from "../engine/results.ts";
import { buildSplitPhase, splitFixtures, splitGroupTable, splitGroupsFrom } from "../engine/split.ts";
import { computeStandings, type StandingsOptions } from "../engine/standings.ts";
import type { Fixture, ResultMap, StandingRow, Team, TeamId } from "../engine/types.ts";
import { leagueFacts } from "./leagueFacts.ts";
import { domesticModelOptions, domesticPriors } from "./priors.ts";
import { canGenerateSplit, realGroupsOf, shareCardSupported, splitRoundOf } from "./splitSetup.ts";

export { shareCardSupported };

/** Seasons simulated for a scenario's chances: the same as the Chances tab. */
export const SCENARIO_ITERATIONS = 10_000;
/** The Chances tab's seed (useMonteCarlo), so the card and the page agree. */
const SEED = 2026;

export interface ScenarioData {
  teams: readonly Team[];
  fixtures: readonly Fixture[];
  groups?: readonly { id: string; teamIds: readonly number[] }[];
  firstPhaseIds?: readonly number[];
  deductions?: Readonly<Record<number, number>>;
  seasonYear?: number;
}

export interface ScenarioRow extends StandingRow {
  /** Where this place leads (the league's own zones, over the whole table). */
  zone?: Zone;
  /** Share of simulated seasons the club ends in that zone. */
  chance?: number;
}

export interface ScenarioOutcome {
  rows: ScenarioRow[];
  /** Every game has a score: the table is final. */
  complete: boolean;
  iterations: number;
  /** The result to lead with: the champion (or leader), or a big club going down. */
  headline: { kind: "champion" | "top" | "relegated"; teamId: TeamId; chance: number };
  /** The league's places, over the whole table, for the legend. */
  places: readonly Zone[];
}

/**
 * The final table a shared scenario leads to, with the chances behind it:
 * the user's predictions on top of the real results, everything else
 * simulated. Mirrors the league page (LeagueSimulator) for one table per league.
 */
export function scenarioOutcome(league: LeagueConfig, data: ScenarioData, predictions: ResultMap, iterations = SCENARIO_ITERATIONS): ScenarioOutcome | null {
  if (!shareCardSupported(league)) return null;
  const facts = leagueFacts(league);
  if (!facts) return null;
  const { teams, fixtures } = data;
  const base: StandingsOptions = { tiebreakers: league.tiebreakers, ...(data.deductions ? { deductions: data.deductions } : {}) };
  const model = buildLeagueModel(teams, fixtures, realResults(fixtures), domesticModelOptions(league, data.seasonYear));
  const groups = data.groups;
  const realGroups = realGroupsOf(league, groups);
  const canGenerate = canGenerateSplit(league, fixtures, teams, groups);
  const splitRound = splitRoundOf(league, fixtures, groups);
  const lastDate = fixtures.reduce((max, f) => (f.utcDate > max ? f.utcDate : max), "");
  const split = league.split;
  const phased = Boolean(split && league.groups && (realGroups || canGenerate || split.afterRound !== undefined));

  let rows: StandingRow[];
  let played: Fixture[];
  let input: Omit<MonteCarloInput, "iterations" | "seed">;
  /** Each club's offset from its group's places to the whole table's. */
  const offset = new Map<TeamId, number>();

  if (phased && split) {
    const phase = buildSplitPhase({
      teams,
      fixtures,
      results: { ...realResults(fixtures), ...predictions },
      groups: split.groups,
      afterRound: splitRound,
      ...(realGroups ? { realGroups: (league.groups ?? []).map((g) => realGroups.find((m) => m.id === g.id)?.teamIds ?? []) } : {}),
      ...(data.firstPhaseIds ? { firstPhaseIds: data.firstPhaseIds } : {}),
      options: base,
    });
    if (phase.members) {
      played = [...phase.firstPhase, ...phase.groupFixtures.flat()];
      const effective = effectiveResults(played, predictions);
      let start = 0;
      rows = phase.members.flatMap((ids, g) => {
        for (const id of ids) offset.set(id, start);
        const table = splitGroupTable(phase, g, teams, effective, { tiebreakers: league.tiebreakers }).map((r) => ({ ...r, position: r.position + start }));
        start += ids.length;
        return table;
      });
      input = {
        teams,
        fixtures: played,
        fixed: effective,
        model,
        standings: base,
        groups: phase.members,
        groupFixtures: phase.groupFixtures,
        groupStandings: phase.members.map((_, g) => ({ tiebreakers: league.tiebreakers, startPoints: phase.startPoints[g] ?? {}, fallbackOrder: phase.firstTable.map((r) => r.teamId) })),
      };
    } else {
      played = phase.firstPhase;
      const effective = effectiveResults(played, predictions);
      rows = computeStandings(teams, played, effective, base);
      input = {
        teams,
        fixtures: played,
        fixed: effective,
        model,
        standings: { ...base, split: { afterRound: splitRound, groups: split.groups, separate: true } },
        ...(canGenerate ? { project: { afterRound: splitRound, afterDate: lastDate, groups: split.groups } } : {}),
      };
    }
  } else if (split) {
    // Scotland: the table carries on through the split.
    const options: StandingsOptions = { ...base, split: { afterRound: splitRound, groups: split.groups } };
    const firstResults = effectiveResults(fixtures, predictions);
    const extra =
      canGenerate && fixtures.every((f) => firstResults[f.id])
        ? splitFixtures(splitGroupsFrom(computeStandings(teams, fixtures, firstResults, { ...base, includeForm: false }), split.groups), split.groups, splitRound, lastDate)
        : [];
    played = [...fixtures, ...extra];
    const effective = effectiveResults(played, predictions);
    rows = computeStandings(teams, played, effective, options);
    input = {
      teams,
      fixtures: played,
      fixed: effective,
      model,
      standings: options,
      ...(canGenerate && !extra.length ? { project: { afterRound: splitRound, afterDate: lastDate, groups: split.groups } } : {}),
    };
  } else {
    played = [...fixtures];
    const effective = effectiveResults(played, predictions);
    rows = computeStandings(teams, played, effective, base);
    input = { teams, fixtures: played, fixed: effective, model, standings: base };
  }

  const result = runMonteCarlo({ ...input, iterations, seed: SEED });
  /** Runs a club ends at each place of the whole table. */
  const counts = (id: TeamId) => {
    const own = result.positionCounts[id] ?? [];
    const start = offset.get(id) ?? 0;
    return (p: number) => own[p - 1 - start] ?? 0;
  };
  const share = (id: TeamId, from: number, to: number) => {
    const at = counts(id);
    let n = 0;
    for (let p = from; p <= to; p++) n += at(p);
    return n / result.iterations;
  };
  const places = facts.places;
  const zoneAt = (position: number) => zoneForPosition({ ...league, zones: [...places] }, position);
  // The champion is highlighted on its own (with its title chance), unless a
  // play-off decides the title (Liga MX).
  const championRow = !league.playoff?.title;
  const scenarioRows: ScenarioRow[] = rows.map((row) => {
    const zone = championRow && row.position === 1 ? { kind: "title" as const, from: 1, to: 1 } : zoneAt(row.position);
    return { ...row, ...(zone ? { zone, chance: share(row.teamId, zone.from, zone.to) } : {}) };
  });
  const effectiveAll = effectiveResults(played, predictions);
  const complete = played.every((f) => effectiveAll[f.id]) && !input.project;

  // The headline: a big club going down if the prediction has one, else the
  // champion (the leader once every game is played, else the favourite).
  const title = (id: TeamId) => share(id, 1, 1);
  const favourite = complete ? rows[0]!.teamId : [...rows].sort((a, b) => title(b.teamId) - title(a.teamId))[0]!.teamId;
  const priors = domesticPriors(league.code, data.seasonYear);
  const relegation = places.find((z) => z.kind === "relegation");
  let headline: ScenarioOutcome["headline"] = { kind: league.playoff?.title ? "top" : "champion", teamId: favourite, chance: title(favourite) };
  if (priors && relegation) {
    const strength = (id: TeamId) => (priors[id] ? priors[id]!.attack / priors[id]!.defence : 0);
    const bigClubs = new Set([...teams].sort((a, b) => strength(b.id) - strength(a.id)).slice(0, 6).map((t) => t.id));
    const down = scenarioRows.filter((r) => r.zone?.kind === "relegation" && bigClubs.has(r.teamId)).sort((a, b) => strength(b.teamId) - strength(a.teamId))[0];
    if (down) headline = { kind: "relegated", teamId: down.teamId, chance: share(down.teamId, relegation.from, relegation.to) };
  }
  return { rows: scenarioRows, complete, iterations: result.iterations, headline, places };
}

/** The zones a league's legend shows, in table order, each once. */
export function legendKinds(places: readonly Zone[], champion: boolean): ZoneKind[] {
  const kinds = [...places].sort((a, b) => a.from - b.from).map((z) => z.kind);
  return [...new Set([...(champion && !kinds.includes("title") ? (["title"] as const) : []), ...kinds])];
}

/** The card's rows: all of a small league, else the top six, a gap and the bottom three. */
export function cardRows<T>(rows: readonly T[]): (T | "gap")[] {
  if (rows.length <= 12) return [...rows];
  return [...rows.slice(0, 6), "gap", ...rows.slice(-3)];
}
