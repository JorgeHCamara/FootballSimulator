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
  return totals;
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
  matches: readonly PlayedMatch[],
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
      matches.filter((m) => members.has(m.homeId) && members.has(m.awayId)),
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
      const plain = { ...options, split: undefined };
      const table = computeStandings(teams, firstPhase, results, { ...plain, includeForm: false });
      const atSplit = table.map((r) => r.teamId);
      const later = options.split.separate ? fixtures.filter((f) => f.matchday > afterRound) : fixtures;
      const rows: StandingRow[] = [];
      let start = 0;
      groups.forEach((group, i) => {
        const members = new Set(i === groups.length - 1 ? atSplit.slice(start) : atSplit.slice(start, start + group.size));
        start += group.size;
        const own = teams.filter((t) => members.has(t.id));
        const separate = options.split!.separate
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
  const order = rankGroup(ids, criteria, overall, matches, names, fallback);
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
