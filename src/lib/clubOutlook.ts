import type { LeagueConfig, SiteLocale, Zone, ZoneKind } from "../config/leagues.ts";
import { expectedGoals, expectedGoalsNeutral, outcomeProbabilities } from "../engine/match.ts";
import { runMonteCarlo, type MonteCarloInput, type MonteCarloResult } from "../engine/montecarlo.ts";
import { buildLeagueModel, type LeagueModel } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import { computeStandings, type StandingsOptions } from "../engine/standings.ts";
import type { Fixture, StandingRow, Team, TeamId } from "../engine/types.ts";
import { CONTINENTAL, leagueFacts } from "./leagueFacts.ts";
import type { LeagueData } from "./leagueData.ts";
import { domesticModelOptions } from "./priors.ts";
import { SCENARIO_ITERATIONS, SCENARIO_SEED, scenarioSimulation } from "./scenario.ts";
import { annualFixtures, tournamentChampion, tournamentConfig, tournamentStages } from "./tournaments.ts";

/** A place a club can finish in, with its chance (ranges of the same kind merged: Greece's two Conference League places). */
export interface ZoneChance {
  kind: ZoneKind;
  /** Its places, e.g. [[1, 4]]. */
  ranges: [number, number][];
  chance: number;
}

/** One of the club's remaining games, with the model's chances. */
export interface ClubFixture {
  fixture: Fixture;
  home: boolean;
  opponentId: TeamId;
  win: number;
  draw: number;
  loss: number;
  /** The opponent's place in the table now, and how far it is from the club's. */
  opponentPosition: number;
}

export interface ClubOutlook {
  team: Team;
  /** Its row in the table its places are counted in (the whole table, its conference, or the annual table). */
  row: StandingRow;
  /** That table's size. */
  tableSize: number;
  /** Share of simulated seasons the club ends in each place (index 0 = 1st). */
  distribution: number[];
  /** Title (when the table decides it) and every place the league's config lists, in table order. */
  zones: ZoneChance[];
  /** What the page leads with (see headlineChances). */
  headline: HeadlineChance[];
  /** The most likely final place, and its chance. */
  likeliest: { position: number; chance: number };
  averagePoints: number;
  /** Its games still to play, soonest first. */
  fixtures: ClubFixture[];
  /** A conference (MLS): its name. */
  group?: Record<SiteLocale, string>;
}

export interface LeagueOutlook {
  league: LeagueConfig;
  season: string;
  iterations: number;
  /** Every game has been played: the table is final. */
  complete: boolean;
  /** Places are counted over the whole table, within each conference, or in the annual table. */
  scope: "table" | "eachTable" | "annual";
  clubs: Map<TeamId, ClubOutlook>;
  /** Clubs of the league, in table order (by conference, one after the other). */
  order: TeamId[];
}

/** The kinds a club's headline chances are about, in this order: the title, the top continental place, promotion, play-offs, relegation. */
export type HeadlineKind = "title" | "continental" | "promotion" | "playoffs" | "relegation";

export interface HeadlineChance {
  kind: HeadlineKind;
  zone: ZoneKind;
  chance: number;
}

/** A continental place and its qualifying round count as one ("Champions League" = league phase or qualifying). */
const family = (kind: ZoneKind) => kind.replace(/Qualifying$/, "") as ZoneKind;

/**
 * The chances a club's page leads with: the title (when the table decides
 * it), the top continental competition (all its places from the top, its
 * qualifying round and a title that leads there included), promotion, the
 * play-offs (when there is no title in the table), relegation, each when the
 * league has it. `share` gives the chance of a range of places.
 */
export function headlineChances(zones: readonly ZoneChance[], share: (from: number, to: number) => number, passedDown = false): HeadlineChance[] {
  const out: HeadlineChance[] = [];
  const title = zones.find((z) => z.kind === "title");
  if (title) out.push({ kind: "title", zone: "title", chance: title.chance });
  const firstContinental = zones.findIndex((z) => CONTINENTAL.has(z.kind));
  if (firstContinental >= 0) {
    const top = family(zones[firstContinental]!.kind);
    // From the top when only the title is above it (Greece: champions go to the Champions League).
    const fromTop = zones.slice(0, firstContinental).every((z) => z.kind === "title");
    const ranges = zones.filter((z) => family(z.kind) === top).flatMap((z) => z.ranges);
    const from = fromTop ? 1 : Math.min(...ranges.map((r) => r[0]));
    const to = Math.max(...ranges.map((r) => r[1]));
    out.push({ kind: "continental", zone: top, chance: passedDown ? 1 : Math.min(1, share(from, to)) });
  }
  const promotion = zones.find((z) => z.kind === "promotion");
  if (promotion) out.push({ kind: "promotion", zone: "promotion", chance: promotion.chance });
  const playoffs = zones.find((z) => z.kind === "playoffs" || z.kind === "titlePlayoffs");
  if (playoffs && !title) out.push({ kind: "playoffs", zone: playoffs.kind, chance: playoffs.chance });
  const relegation = zones.find((z) => z.kind === "relegation");
  if (relegation) out.push({ kind: "relegation", zone: "relegation", chance: relegation.chance });
  return out;
}

/** Zones merged by kind, in table order, with each club's chance from its place counts. */
function zoneChances(places: readonly Zone[], title: boolean, share: (from: number, to: number) => number): ZoneChance[] {
  const zones: ZoneChance[] = [];
  const all = [...(title && !places.some((z) => z.kind === "title") ? [{ kind: "title" as const, from: 1, to: 1 }] : []), ...places].sort((a, b) => a.from - b.from);
  for (const zone of all) {
    const existing = zones.find((z) => z.kind === zone.kind);
    if (existing) existing.ranges.push([zone.from, zone.to]);
    else zones.push({ kind: zone.kind, ranges: [[zone.from, zone.to]], chance: 0 });
  }
  for (const zone of zones) zone.chance = Math.min(1, zone.ranges.reduce((sum, [from, to]) => sum + share(from, to), 0));
  return zones;
}

/** The model's home/draw/away chances for a club's remaining games, soonest first. */
function clubFixtures(teamId: TeamId, fixtures: readonly Fixture[], model: LeagueModel, positions: ReadonlyMap<TeamId, number>): ClubFixture[] {
  return fixtures
    .filter((f) => !f.result && (f.homeId === teamId || f.awayId === teamId))
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id - b.id)
    .map((fixture) => {
      const xg = fixture.neutral ? expectedGoalsNeutral(model, fixture.homeId, fixture.awayId) : expectedGoals(model, fixture.homeId, fixture.awayId);
      const p = outcomeProbabilities(xg, model.rho ?? 0);
      const home = fixture.homeId === teamId;
      const opponentId = home ? fixture.awayId : fixture.homeId;
      return { fixture, home, opponentId, win: home ? p.home : p.away, draw: p.draw, loss: home ? p.away : p.home, opponentPosition: positions.get(opponentId) ?? 0 };
    });
}

/** The three remaining games the club is least likely to win. */
export function toughestGames(fixtures: readonly ClubFixture[], count = 3): ClubFixture[] {
  return [...fixtures].sort((a, b) => a.win - b.win || a.fixture.utcDate.localeCompare(b.fixture.utcDate)).slice(0, count);
}

/**
 * Must-win games: against the clubs closest in the table (within three
 * places), where a win also costs a direct rival points; the nearest rivals
 * first, then the soonest. Games already among the toughest are left out.
 */
export function mustWinGames(fixtures: readonly ClubFixture[], position: number, exclude: readonly ClubFixture[] = [], count = 3): ClubFixture[] {
  const skip = new Set(exclude.map((f) => f.fixture.id));
  return fixtures
    .filter((f) => !skip.has(f.fixture.id) && f.opponentPosition > 0 && Math.abs(f.opponentPosition - position) <= 3)
    .sort((a, b) => Math.abs(a.opponentPosition - position) - Math.abs(b.opponentPosition - position) || a.fixture.utcDate.localeCompare(b.fixture.utcDate))
    .slice(0, count);
}

interface Setup {
  model: LeagueModel;
  /** The table(s) now, positions within each. */
  rows: StandingRow[];
  input: Omit<MonteCarloInput, "iterations" | "seed">;
  /** Each club's offset from its group's places to the whole table's. */
  offset: Map<TeamId, number>;
  places: readonly Zone[];
  scope: LeagueOutlook["scope"];
  /** The table decides the title. */
  title: boolean;
  /** The games still to come that are on the real calendar. */
  fixtures: readonly Fixture[];
  /** Clubs whose places pass down (annual tables: tournament champions). */
  zoneCounts: boolean;
  groupOf?: Map<TeamId, Record<SiteLocale, string>>;
  complete: boolean;
}

function setup(league: LeagueConfig, data: LeagueData): Setup | null {
  const facts = leagueFacts(league);
  if (!facts) return null;
  const base: StandingsOptions = { tiebreakers: league.tiebreakers, ...(data.deductions ? { deductions: data.deductions } : {}) };

  // One table (or a split): as the share card sets it up.
  const simulation = scenarioSimulation(league, data, {});
  if (simulation) {
    const { model, rows, played, input, offset } = simulation;
    const real = new Set(data.fixtures.map((f) => f.id));
    const fixed = input.fixed;
    return {
      model,
      rows,
      input,
      offset,
      places: facts.places,
      scope: "table",
      title: !league.playoff?.title,
      fixtures: played.filter((f) => real.has(f.id)),
      zoneCounts: false,
      complete: played.every((f) => fixed[f.id]) && !input.project,
    };
  }

  // A season of several tournaments: the annual table decides the places.
  if (league.annual && data.tournaments?.length) {
    const annual = { ...league, annual: league.annual };
    const ordered = [...data.tournaments].reverse();
    const fixtures = annualFixtures(annual, ordered);
    const fixed = realResults(fixtures);
    const model = buildLeagueModel(data.teams, fixtures, fixed, domesticModelOptions(league, data.seasonYear));
    const stages = tournamentStages(league);
    const champions = league.annual.championsQualify
      ? ordered.flatMap((x) => {
          const id = tournamentChampion(tournamentConfig(league, stages.find((s) => s.table === x.id)), data.teams, x);
          return id === null ? [] : [id];
        })
      : [];
    const clubs = new Set(fixtures.flatMap((f) => [f.homeId, f.awayId]));
    const teams = data.teams.filter((t) => clubs.has(t.id));
    return {
      model,
      rows: computeStandings(teams, fixtures, fixed, base),
      input: { teams, fixtures, fixed, model, standings: base, ...(champions.length ? { passDown: [...new Set(champions)] } : {}) },
      offset: new Map(),
      places: league.annual.zones,
      scope: "annual",
      title: false,
      fixtures,
      zoneCounts: champions.length > 0,
      complete: false,
    };
  }

  // Separate tables (MLS conferences): places within each.
  if (data.groups?.length) {
    const fixed = realResults(data.fixtures);
    const model = buildLeagueModel(data.teams, data.fixtures, fixed, domesticModelOptions(league, data.seasonYear));
    const byId = new Map(data.teams.map((t) => [t.id, t]));
    const groupOf = new Map<TeamId, Record<SiteLocale, string>>();
    const rows = data.groups.flatMap((g) => {
      const config = league.groups?.find((x) => x.id === g.id);
      for (const id of g.teamIds) if (config) groupOf.set(id, config.name);
      return computeStandings(g.teamIds.flatMap((id) => byId.get(id) ?? []), data.fixtures, fixed, base);
    });
    return {
      model,
      rows,
      input: { teams: data.teams, fixtures: data.fixtures, fixed, model, standings: base, groups: data.groups.map((g) => g.teamIds) },
      offset: new Map(),
      places: facts.places,
      scope: "eachTable",
      title: false,
      fixtures: data.fixtures,
      zoneCounts: false,
      groupOf,
      complete: data.fixtures.every((f) => f.result),
    };
  }
  return null;
}

/**
 * Every club's outlook in a league: where it stands, its chances over the
 * rest of the season (the league page's Monte Carlo, from the real results
 * only) and the model's odds for its remaining games.
 */
export function leagueOutlook(league: LeagueConfig, data: LeagueData, iterations = SCENARIO_ITERATIONS): LeagueOutlook | null {
  const s = setup(league, data);
  if (!s) return null;
  const result: MonteCarloResult = runMonteCarlo({ ...s.input, iterations, seed: SCENARIO_SEED });
  // Rows' places are already over the whole table (a split's groups one after the other).
  const positions = new Map(s.rows.map((r) => [r.teamId, r.position]));
  const passedDown = new Set(s.input.passDown ?? []);
  const byId = new Map(data.teams.map((t) => [t.id, t]));
  const clubs = new Map<TeamId, ClubOutlook>();
  for (const row of s.rows) {
    const team = byId.get(row.teamId);
    if (!team) continue;
    const start = s.offset.get(row.teamId) ?? 0;
    const own = result.positionCounts[row.teamId] ?? [];
    // Places over the whole table (a split's group placed after the ones above it).
    const tableSize = s.scope === "eachTable" ? own.length : Math.max(s.rows.length, own.length + start);
    const distribution = Array.from({ length: tableSize }, (_, p) => (own[p - start] ?? 0) / result.iterations);
    const zoneOwn = s.zoneCounts ? result.zonePositionCounts?.[row.teamId] : undefined;
    const share = (from: number, to: number) => {
      let n = 0;
      for (let p = from; p <= to; p++) n += zoneOwn ? (zoneOwn[p - 1] ?? 0) / result.iterations : (distribution[p - 1] ?? 0);
      return n;
    };
    let zones = zoneChances(s.places, s.title, share);
    // Already in the first zone's competition (a tournament champion): there whatever the table, its places passed down.
    if (passedDown.has(row.teamId)) {
      const first = zones[0]?.kind;
      const byPlace = (from: number, to: number) => distribution.slice(from - 1, to).reduce((a, b) => a + b, 0);
      zones = zones.map((z) => ({ ...z, chance: z.kind === "relegation" ? Math.min(1, z.ranges.reduce((sum, [from, to]) => sum + byPlace(from, to), 0)) : z.kind === first ? 1 : 0 }));
    }
    let likeliest = { position: row.position, chance: 0 };
    distribution.forEach((chance, p) => {
      if (chance > likeliest.chance) likeliest = { position: p + 1, chance };
    });
    const group = s.groupOf?.get(row.teamId);
    clubs.set(row.teamId, {
      team,
      row,
      tableSize,
      distribution,
      zones,
      headline: headlineChances(zones, share, passedDown.has(row.teamId)),
      likeliest,
      averagePoints: result.averagePoints[row.teamId] ?? row.points,
      fixtures: clubFixtures(row.teamId, s.fixtures, s.model, positions),
      ...(group ? { group } : {}),
    });
  }
  return { league, season: data.season, iterations: result.iterations, complete: s.complete, scope: s.scope, clubs, order: s.rows.map((r) => r.teamId) };
}

/**
 * One outlook per league and data version, kept while the server runs: the
 * club pages of a league (and their images) share one Monte Carlo.
 */
const cache = new Map<string, { version: string; outlook: LeagueOutlook | null }>();

const dataVersion = (data: LeagueData) => {
  const fixtures = data.tournaments?.flatMap((t) => t.fixtures) ?? data.fixtures;
  const played = fixtures.filter((f) => f.result);
  return `${data.seasonKey}:${fixtures.length}:${played.length}:${played.reduce((sum, f) => sum + f.id * 7 + f.result!.home * 3 + f.result!.away, 0)}:${data.groups?.map((g) => g.teamIds.join(",")).join("|") ?? ""}`;
};

export function cachedLeagueOutlook(league: LeagueConfig, data: LeagueData): LeagueOutlook | null {
  const version = dataVersion(data);
  const hit = cache.get(league.code);
  if (hit && hit.version === version) return hit.outlook;
  const outlook = leagueOutlook(league, data);
  cache.set(league.code, { version, outlook });
  return outlook;
}
