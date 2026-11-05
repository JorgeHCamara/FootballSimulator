import type { Fixture, FormResult, ResultMap, StandingRow, Team, TeamId, Tiebreaker } from "./types.ts";

interface Totals {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  awayGoalsFor: number;
  points: number;
}

interface PlayedMatch {
  matchday: number;
  homeId: TeamId;
  awayId: TeamId;
  home: number;
  away: number;
}

export interface StandingsOptions {
  tiebreakers: readonly Tiebreaker[];
  /** Points deducted by the league (e.g. financial sanctions), keyed by team id. */
  deductions?: Readonly<Record<TeamId, number>>;
  /** Skip building the form column (hot path in Monte Carlo runs). Defaults to true. */
  includeForm?: boolean;
  /**
   * A split league (Scotland, Greece, Ecuador): once every game up to round
   * `afterRound` has a score and later games exist, the table at that point
   * cuts the clubs into consecutive groups of `size` (the last takes the
   * rest), which then stay apart whatever their points later, each ranked on
   * its own. With `separate`, each group is a new table of its own games,
   * starting from the points at the split (times `carryOver`, rounded up),
   * ties going to the higher place at the split; else the table carries on.
   */
  split?: { afterRound: number; groups: readonly { size: number; carryOver?: number }[]; separate?: boolean };
  /** Points a club starts the table with (a split's carried-over points). */
  startPoints?: Readonly<Record<TeamId, number>>;
  /** Order for clubs level on every criterion (else by name). */
  fallbackOrder?: readonly TeamId[];
}

const emptyTotals = (): Totals => ({
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  awayGoalsFor: 0,
  points: 0,
});

function accumulate(matches: readonly PlayedMatch[], teamIds: Iterable<TeamId>): Map<TeamId, Totals> {
  const totals = new Map<TeamId, Totals>();
  for (const id of teamIds) totals.set(id, emptyTotals());
  addMatches(totals, matches);
  return totals;
}

/** Adds the matches to the clubs' totals (a club not in `totals` is skipped). */
function addMatches(totals: Map<TeamId, Totals>, matches: readonly PlayedMatch[]): void {
  for (const m of matches) {
    // A table can hold only some of the league's clubs (an MLS conference): a
    // match against a club outside it still counts for the club inside.
    const h = totals.get(m.homeId);
    const a = totals.get(m.awayId);
    if (!h && !a) continue;
    if (h) {
      h.played++;
      h.goalsFor += m.home;
      h.goalsAgainst += m.away;
      if (m.home > m.away) {
        h.won++;
        h.points += 3;
      } else if (m.home < m.away) h.lost++;
      else {
        h.drawn++;
        h.points++;
      }
    }
    if (a) {
      a.played++;
      a.goalsFor += m.away;
      a.goalsAgainst += m.home;
      a.awayGoalsFor += m.away;
      if (m.away > m.home) {
        a.won++;
        a.points += 3;
      } else if (m.away < m.home) a.lost++;
      else {
        a.drawn++;
        a.points++;
      }
    }
  }
}

function criterionValue(criterion: Tiebreaker, overall: Totals, h2h: Totals | undefined): number {
  switch (criterion) {
    case "points":
      return overall.points;
    case "wins":
      return overall.won;
    case "goalDifference":
      return overall.goalsFor - overall.goalsAgainst;
    case "goalsFor":
      return overall.goalsFor;
    case "awayGoalsFor":
      return overall.awayGoalsFor;
    case "headToHeadPoints":
      return h2h?.points ?? 0;
    case "headToHeadGoalDifference":
      return h2h ? h2h.goalsFor - h2h.goalsAgainst : 0;
    case "headToHeadGoalsFor":
      return h2h?.goalsFor ?? 0;
    case "headToHeadAwayGoalsFor":
      return h2h?.awayGoalsFor ?? 0;
  }
}

const isHeadToHead = (c: Tiebreaker) => c.startsWith("headToHead");

/**
 * Orders a group of teams that are level on every previous criterion, applying the
 * remaining criteria in sequence. Head-to-head criteria are computed as a
 * mini-league among exactly the teams still tied, recomputed for each sub-group.
 */
function rankGroup(
  group: TeamId[],
  criteria: readonly Tiebreaker[],
  overall: Map<TeamId, Totals>,
  /** The games, for head-to-head criteria: asked for only when a tie gets that far. */
  matches: () => readonly PlayedMatch[],
  names: Map<TeamId, string>,
  fallback?: ReadonlyMap<TeamId, number>,
): TeamId[] {
  if (group.length <= 1) return group;
  const [criterion, ...rest] = criteria;
  if (!criterion) {
    // Fully level: a given order (a split's places), else the name, so the order is deterministic.
    if (fallback) return [...group].sort((a, b) => (fallback.get(a) ?? Infinity) - (fallback.get(b) ?? Infinity));
    return [...group].sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""));
  }

  let h2h: Map<TeamId, Totals> | undefined;
  if (isHeadToHead(criterion)) {
    const members = new Set(group);
    h2h = accumulate(
      matches().filter((m) => members.has(m.homeId) && members.has(m.awayId)),
      group,
    );
  }

  const valued = group.map((id) => ({
    id,
    value: criterionValue(criterion, overall.get(id)!, h2h?.get(id)),
  }));
  valued.sort((a, b) => b.value - a.value);

  const ordered: TeamId[] = [];
  let i = 0;
  while (i < valued.length) {
    let j = i;
    while (j < valued.length && valued[j]!.value === valued[i]!.value) j++;
    const tied = valued.slice(i, j).map((v) => v.id);
    // If a head-to-head criterion splits nothing, still recurse with the rest.
    ordered.push(...rankGroup(tied, rest, overall, matches, names, fallback));
    i = j;
  }
  return ordered;
}

function buildForm(teamId: TeamId, fixtures: readonly Fixture[], results: ResultMap): FormResult[] {
  const form: FormResult[] = [];
  for (const f of fixtures) {
    if (f.homeId !== teamId && f.awayId !== teamId) continue;
    const r = results[f.id];
    if (!r) continue;
    const gf = f.homeId === teamId ? r.home : r.away;
    const ga = f.homeId === teamId ? r.away : r.home;
    form.push(gf > ga ? "W" : gf < ga ? "L" : "D");
  }
  return form.slice(-5);
}

/** Sorts fixtures chronologically (matchday, then kick-off, then id). */
export function sortFixtures<T extends Fixture>(fixtures: readonly T[]): T[] {
  return [...fixtures].sort(
    (a, b) => a.matchday - b.matchday || a.utcDate.localeCompare(b.utcDate) || a.id - b.id,
  );
}

/**
 * The table of a split league once its split is done (see `split` in
 * StandingsOptions), from the table at the split: what computeStandings returns
 * then, with `table` = computeStandings of the first phase's games (without the
 * split, nor the form column). A Monte Carlo run that has that table already
 * passes it here instead of having it worked out again.
 */
export function splitStandings(teams: readonly Team[], fixtures: readonly Fixture[], results: ResultMap, options: StandingsOptions, table: readonly StandingRow[]): StandingRow[] {
  const { afterRound, groups, separate: apart } = options.split!;
  const plain = { ...options, split: undefined };
  const atSplit = table.map((r) => r.teamId);
  const later = apart ? fixtures.filter((f) => f.matchday > afterRound) : fixtures;
  const rows: StandingRow[] = [];
  let start = 0;
  groups.forEach((group, i) => {
    const members = new Set(i === groups.length - 1 ? atSplit.slice(start) : atSplit.slice(start, start + group.size));
    start += group.size;
    const own = teams.filter((t) => members.has(t.id));
    const separate = apart
      ? {
          deductions: undefined,
          startPoints: Object.fromEntries(table.filter((r) => members.has(r.teamId)).map((r) => [r.teamId, Math.ceil(r.points * (group.carryOver ?? 1))])),
          fallbackOrder: atSplit,
        }
      : {};
    rows.push(...computeStandings(own, later, results, { ...plain, ...separate }));
  });
  return rows.map((r, i) => ({ ...r, position: i + 1 }));
}

export function computeStandings(
  teams: readonly Team[],
  fixtures: readonly Fixture[],
  results: ResultMap,
  options: StandingsOptions,
): StandingRow[] {
  const matches: PlayedMatch[] = [];
  for (const f of fixtures) {
    const r = results[f.id];
    if (r) matches.push({ matchday: f.matchday, homeId: f.homeId, awayId: f.awayId, home: r.home, away: r.away });
  }

  // The split: the table at the split decides the groups, which then stay apart.
  if (options.split) {
    const { afterRound, groups } = options.split;
    const firstPhase = fixtures.filter((f) => f.matchday <= afterRound);
    const splitDone = firstPhase.length > 0 && firstPhase.every((f) => results[f.id]) && fixtures.some((f) => f.matchday > afterRound);
    if (splitDone) {
      const table = computeStandings(teams, firstPhase, results, { ...options, split: undefined, includeForm: false });
      return splitStandings(teams, fixtures, results, options, table);
    }
  }

  const ids = teams.map((t) => t.id);
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const overall = accumulate(matches, ids);
  for (const [teamId, points] of Object.entries(options.startPoints ?? {})) {
    const t = overall.get(Number(teamId));
    if (t) t.points += points;
  }
  for (const [teamId, deduction] of Object.entries(options.deductions ?? {})) {
    const t = overall.get(Number(teamId));
    if (t) t.points -= deduction;
  }

  const criteria: Tiebreaker[] = options.tiebreakers[0] === "points"
    ? [...options.tiebreakers]
    : ["points", ...options.tiebreakers];
  const fallback = options.fallbackOrder ? new Map(options.fallbackOrder.map((id, i) => [id, i])) : undefined;
  const order = rankGroup(ids, criteria, overall, () => matches, names, fallback);
  const includeForm = options.includeForm ?? true;
  const chronological = includeForm ? sortFixtures(fixtures) : [];

  return order.map((teamId, index) => {
    const t = overall.get(teamId)!;
    return {
      position: index + 1,
      teamId,
      played: t.played,
      won: t.won,
      drawn: t.drawn,
      lost: t.lost,
      goalsFor: t.goalsFor,
      goalsAgainst: t.goalsAgainst,
      goalDifference: t.goalsFor - t.goalsAgainst,
      points: t.points,
      form: includeForm ? buildForm(teamId, chronological, results) : [],
    };
  });
}

/**
 * computeStandings for many result sets over the same games (a Monte Carlo
 * run): the games whose result never changes (a result in `fixed`, not in
 * `changing`) are added up once, and each call adds only the others. Each
 * call returns exactly what computeStandings(teams, fixtures, results,
 * options) would, for a table without a split and without the form column;
 * undefined for any other table (use computeStandings).
 */
export function standingsBuilder(
  teams: readonly Team[],
  fixtures: readonly Fixture[],
  fixed: ResultMap,
  options: StandingsOptions,
  changing: ReadonlySet<number>,
): ((results: ResultMap) => StandingRow[]) | undefined {
  if (options.split || (options.includeForm ?? true)) return undefined;
  const ids = teams.map((t) => t.id);
  const names = new Map(teams.map((t) => [t.id, t.name]));
  const settled: PlayedMatch[] = [];
  const open: Fixture[] = [];
  for (const f of fixtures) {
    const r = fixed[f.id];
    if (r && !changing.has(f.id)) settled.push({ matchday: f.matchday, homeId: f.homeId, awayId: f.awayId, home: r.home, away: r.away });
    else open.push(f);
  }
  // The settled games' totals, with the points a club starts with and its deductions (they only add up).
  const base = accumulate(settled, ids);
  for (const [teamId, points] of Object.entries(options.startPoints ?? {})) {
    const t = base.get(Number(teamId));
    if (t) t.points += points;
  }
  for (const [teamId, deduction] of Object.entries(options.deductions ?? {})) {
    const t = base.get(Number(teamId));
    if (t) t.points -= deduction;
  }
  const criteria: Tiebreaker[] = options.tiebreakers[0] === "points" ? [...options.tiebreakers] : ["points", ...options.tiebreakers];
  const fallback = options.fallbackOrder ? new Map(options.fallbackOrder.map((id, i) => [id, i])) : undefined;
  // Totals by club index, eight numbers each, the settled games' added in once; the open games by club index (-1: not in the table).
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const baseTotals = new Int32Array(n * FIELDS);
  for (const [i, id] of ids.entries()) {
    const t = base.get(id)!;
    baseTotals.set([t.played, t.won, t.drawn, t.lost, t.goalsFor, t.goalsAgainst, t.awayGoalsFor, t.points], i * FIELDS);
  }
  const homeOf = Int32Array.from(open, (f) => index.get(f.homeId) ?? -1);
  const awayOf = Int32Array.from(open, (f) => index.get(f.awayId) ?? -1);
  const totals = new Int32Array(n * FIELDS);
  return (results) => {
    totals.set(baseTotals);
    for (let k = 0; k < open.length; k++) {
      const r = results[open[k]!.id];
      if (!r) continue;
      const h = homeOf[k]!;
      const a = awayOf[k]!;
      if (h >= 0) tally(totals, h * FIELDS, r.home, r.away, false);
      if (a >= 0) tally(totals, a * FIELDS, r.away, r.home, true);
    }
    const overall = new Map<TeamId, Totals>();
    for (const [i, id] of ids.entries()) {
      const o = i * FIELDS;
      overall.set(id, {
        played: totals[o]!,
        won: totals[o + 1]!,
        drawn: totals[o + 2]!,
        lost: totals[o + 3]!,
        goalsFor: totals[o + 4]!,
        goalsAgainst: totals[o + 5]!,
        awayGoalsFor: totals[o + 6]!,
        points: totals[o + 7]!,
      });
    }
    // Every game, only if a tie gets as far as a head-to-head criterion.
    let all: PlayedMatch[] | undefined;
    const matches = () =>
      (all ??= settled.concat(
        open.flatMap((f) => {
          const r = results[f.id];
          return r ? [{ matchday: f.matchday, homeId: f.homeId, awayId: f.awayId, home: r.home, away: r.away }] : [];
        }),
      ));
    const order = rankGroup(ids, criteria, overall, matches, names, fallback);
    return order.map((teamId, position) => {
      const t = overall.get(teamId)!;
      return {
        position: position + 1,
        teamId,
        played: t.played,
        won: t.won,
        drawn: t.drawn,
        lost: t.lost,
        goalsFor: t.goalsFor,
        goalsAgainst: t.goalsAgainst,
        goalDifference: t.goalsFor - t.goalsAgainst,
        points: t.points,
        form: [],
      };
    });
  };
}

/** Numbers per club in standingsBuilder's totals: played, won, drawn, lost, for, against, away goals, points. */
const FIELDS = 8;

/** One game into a club's totals (at offset `o`), from its side: its goals, the other side's, and whether it played away. */
function tally(t: Int32Array, o: number, own: number, other: number, away: boolean): void {
  t[o]!++;
  t[o + 4]! += own;
  t[o + 5]! += other;
  if (away) t[o + 6]! += own;
  if (own > other) {
    t[o + 1]!++;
    t[o + 7]! += 3;
  } else if (own < other) t[o + 3]!++;
  else {
    t[o + 2]!++;
    t[o + 7]!++;
  }
}
