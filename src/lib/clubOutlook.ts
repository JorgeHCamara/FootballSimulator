import type { LeagueConfig, SiteLocale, Zone, ZoneKind } from "../config/leagues.ts";
import { likelyFinishRange, mostLikelyPlaces, type FinishRange } from "../engine/finishes.ts";
import { expectedGoals, expectedGoalsNeutral, outcomeProbabilities } from "../engine/match.ts";
import { runMonteCarlo, runMonteCarloVariants, type MonteCarloInput, type MonteCarloResult } from "../engine/montecarlo.ts";
import { buildLeagueModel, type LeagueModel } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import { computeStandings, sortFixtures, type StandingsOptions } from "../engine/standings.ts";
import type { Fixture, ResultMap, Score, StandingRow, Team, TeamId } from "../engine/types.ts";
import { CONTINENTAL, leagueFacts } from "./leagueFacts.ts";
import type { LeagueData } from "./leagueData.ts";
import { domesticModelOptions } from "./priors.ts";
import { SCENARIO_ITERATIONS, SCENARIO_SEED, scenarioSimulation } from "./scenario.ts";
import { seasonRatingNoise } from "./seasonNoise.ts";
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
  /** Its place in the most likely final table (one club per place: the projected table, snapshots), and its chance of it. */
  likeliest: { position: number; chance: number };
  /** Its likely finish on its own: the shortest run of places it ends in at least 75% of the time (likelyFinishRange). */
  likelyRange: FinishRange;
  /** The average final place over the simulated seasons. */
  expectedPosition: number;
  averagePoints: number;
  /** Its games still to play, soonest first. */
  fixtures: ClubFixture[];
  /** A league with a play-off after its table (EFL, MLS Cup, Liga MX…): its chances in it. */
  playoff?: PlayoffOutlook;
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
  /** The match model the chances (and every game's odds) come from. */
  model: LeagueModel;
}

/** The kinds a club's headline chances are about, in this order: the title, the top continental place, promotion, play-offs, relegation. */
export type HeadlineKind = "title" | "continental" | "promotion" | "playoffs" | "playoffWin" | "relegation";

export interface HeadlineChance {
  kind: HeadlineKind;
  zone: ZoneKind;
  chance: number;
  /** "playoffWin": what winning the play-off is ("MLS Cup", "Liga MX"). */
  name?: string;
}

/**
 * A club's chances in its league's play-off, simulated after the table in every
 * season (the bracket in its config): what winning it means, and how often it
 * reaches the final and wins it.
 */
export interface PlayoffOutlook {
  /** Winning it is promotion (to `name`), the title (`name`: "MLS Cup"), or a decider with `name`'s club (Ligue 2 v Ligue 1's 16th). */
  kind: "promotion" | "title" | "qualifier";
  name?: string;
  /** Share of simulated seasons it wins the play-off. */
  win: number;
  /** …it plays in the final. */
  final: number;
  /** Promotion by any route: the automatic places, the play-off, or going up directly when the play-off isn't held (Serie B). */
  promoted?: number;
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

/** A chance a club's card shows: one of its headline chances, or another of its places ("zone"). */
export interface FeaturedChance {
  kind: HeadlineKind | "zone";
  zone: ZoneKind;
  chance: number;
  /** "playoffWin": what winning the play-off is ("MLS Cup"). */
  name?: string;
}

/** Another of the club's places makes its card from this chance (shown as 1% or more). */
const FEATURED_MIN = 0.005;

/**
 * The chances a club's card (and its link preview) show, at most `max`: its
 * headline chances, except that a headline at 0% gives way to another of the
 * club's places it has a real chance of (Série B: promotion 0%, but the
 * promotion play-off 23%; a top-flight club's Europa League or Sudamericana
 * place). Chances above 0% come first, the headline's in its order and then
 * the other places in table order; 0% headline chances fill what's left, the
 * title last (a club with no chance of promotion or of the places from the
 * top has none of the title either). In table order.
 */
export function featuredChances(club: Pick<ClubOutlook, "headline" | "zones">, max = 3): FeaturedChance[] {
  // The places the headline already speaks for (a continental place with its qualifying round).
  const covered = new Set<ZoneKind>(club.headline.map((h) => h.zone));
  for (const h of club.headline) if (h.kind === "continental") for (const z of club.zones) if (family(z.kind) === h.zone) covered.add(z.kind);
  const others: FeaturedChance[] = club.zones.filter((z) => !covered.has(z.kind) && z.chance >= FEATURED_MIN).map((z) => ({ kind: "zone", zone: z.kind, chance: z.chance }));
  const empty = club.headline.filter((h) => h.chance <= 0);
  const picked = [...club.headline.filter((h) => h.chance > 0), ...others, ...empty.filter((h) => h.kind !== "title"), ...empty.filter((h) => h.kind === "title")].slice(0, max);
  const order = [...club.headline, ...others];
  const firstPlace = (c: FeaturedChance) =>
    Math.min(Infinity, ...club.zones.filter((z) => z.kind === c.zone || (c.kind === "continental" && family(z.kind) === c.zone)).flatMap((z) => z.ranges.map(([from]) => from)));
  return picked.sort((a, b) => firstPlace(a) - firstPlace(b) || order.indexOf(a) - order.indexOf(b));
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

/** What a league's Monte Carlo runs on, and how its result reads as places. */
export interface OutlookSetup {
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

/**
 * A domestic league's play-off after its table, as the season outlook plays it:
 * a promotion play-off (EFL, Série B…) or a title play-off of one table (Liga
 * MX) or of conferences (`grouped`: the MLS Cup), with the real play-off games
 * once the feed lists them. None for a knockout seeded from groups (Argentina)
 * or a table without one.
 */
function seasonPlayoff(league: LeagueConfig, data: LeagueData, fixtures: readonly Fixture[], grouped: boolean): MonteCarloInput["playoff"] {
  const config = league.playoff;
  if (!config || league.continental || config.seedFromGroups || grouped !== Boolean(config.groupStage)) return undefined;
  const last = sortFixtures(fixtures).at(-1);
  return { config, options: { afterMatchday: last?.matchday ?? 0, afterDate: last?.utcDate ?? "", ...(data.postseason?.length ? { real: data.postseason } : {}) } };
}

export function outlookSetup(league: LeagueConfig, data: LeagueData): OutlookSetup | null {
  const facts = leagueFacts(league);
  if (!facts) return null;
  const base: StandingsOptions = { tiebreakers: league.tiebreakers, ...(data.deductions ? { deductions: data.deductions } : {}) };
  // The season's chances allow for the ratings being estimates (as scenarioSimulation's; see SEASON_RATING_NOISE).
  const ratingNoise = seasonRatingNoise(league);
  const noise = ratingNoise ? { ratingNoise } : {};

  // One table (or a split): as the share card sets it up.
  const simulation = scenarioSimulation(league, data, {});
  if (simulation) {
    const { model, rows, played, offset } = simulation;
    // One table: its play-off too (the share card's simulation doesn't need it).
    const knockout = simulation.input.groups?.length || simulation.input.project ? undefined : seasonPlayoff(league, data, played, false);
    const input = knockout ? { ...simulation.input, playoff: knockout } : simulation.input;
    const real = new Set(data.fixtures.map((f) => f.id));
    const fixed = input.fixed;
    return {
      model,
      rows,
      input,
      offset,
      places: facts.places,
      scope: "table",
      // A final classification (Série C) puts the play-off's champion 1st.
      title: !league.playoff?.title || Boolean(input.classification),
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
    const model = buildLeagueModel(data.teams, fixtures, fixed, domesticModelOptions(league, data.seasonYear, data.xg));
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
      input: { teams, fixtures, fixed, model, standings: base, ...(champions.length ? { passDown: [...new Set(champions)] } : {}), ...noise },
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
    const cup = seasonPlayoff(league, data, data.fixtures, true);
    const fixed = realResults(data.fixtures);
    const model = buildLeagueModel(data.teams, data.fixtures, fixed, domesticModelOptions(league, data.seasonYear, data.xg));
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
      input: {
        teams: data.teams,
        fixtures: data.fixtures,
        fixed,
        model,
        standings: base,
        groups: data.groups.map((g) => g.teamIds),
        ...noise,
        // The MLS Cup: each conference's first rounds, then the winners together.
        ...(cup ? { playoff: cup } : {}),
      },
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

/** Every club's outlook from one Monte Carlo run of the league's setup. */
export function outlookFromRun(league: LeagueConfig, data: LeagueData, s: OutlookSetup, result: MonteCarloResult): LeagueOutlook {
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
    // Set below, from the most likely final table (one club per place).
    const likeliest = { position: row.position, chance: distribution[row.position - 1] ?? 0 };
    const expectedPosition = distribution.reduce((sum, chance, p) => sum + chance * (p + 1), 0);
    const group = s.groupOf?.get(row.teamId);
    const playoff = playoffOutlook(s, result, row.teamId, distribution);
    clubs.set(row.teamId, {
      team,
      row,
      tableSize,
      distribution,
      zones,
      // A final classification (Série C) already has the final's winner as champion: no second title chance.
      headline: withPlayoff(headlineChances(zones, share, passedDown.has(row.teamId)), zones, s.input.classification ? undefined : playoff),
      ...(playoff ? { playoff } : {}),
      likeliest,
      likelyRange: likelyFinishRange(distribution),
      expectedPosition,
      averagePoints: result.averagePoints[row.teamId] ?? row.points,
      fixtures: clubFixtures(row.teamId, s.fixtures, s.model, positions),
      ...(group ? { group } : {}),
    });
  }
  setLikeliestFinishes(clubs, s.scope === "eachTable" ? s.groupOf : undefined);
  return { league, season: data.season, iterations: result.iterations, complete: s.complete, scope: s.scope, clubs, order: s.rows.map((r) => r.teamId), model: s.model };
}

/** A club's play-off chances from a run that played the league's play-off (see seasonPlayoff), or undefined. */
function playoffOutlook(s: OutlookSetup, result: MonteCarloResult, teamId: TeamId, distribution: readonly number[]): PlayoffOutlook | undefined {
  const config = s.input.playoff?.config;
  if (!config || !result.playoffWins || result.iterations === 0) return undefined;
  const kind = config.title ? "title" : config.winnerPlays ? "qualifier" : config.promotedTo ? "promotion" : undefined;
  if (!kind) return undefined;
  const name = kind === "title" ? config.title : kind === "qualifier" ? config.winnerPlays!.league : config.promotedTo;
  const win = (result.playoffWins[teamId] ?? 0) / result.iterations;
  const final = (result.playoffReached?.[teamId]?.[config.rounds.length - 1] ?? 0) / result.iterations;
  const out: PlayoffOutlook = { kind, ...(name ? { name } : {}), win, final };
  if (kind === "promotion") {
    // The automatic places, the play-off and (Serie B) going up directly when it isn't held: never two in one season.
    const automatic = (config.directPromotion ?? []).reduce((sum, p) => sum + (distribution[p - 1] ?? 0), 0);
    out.promoted = Math.min(1, automatic + win + (result.playoffSkips?.[teamId] ?? 0) / result.iterations);
  }
  return out;
}

/**
 * The headline with the play-off: promotion counts every route (the automatic
 * places and the play-off), and a title play-off adds the chance of winning it
 * ("MLS Cup"), coloured as its play-off places.
 */
function withPlayoff(headline: HeadlineChance[], zones: readonly ZoneChance[], playoff: PlayoffOutlook | undefined): HeadlineChance[] {
  if (!playoff) return headline;
  if (playoff.kind === "promotion" && playoff.promoted !== undefined) return headline.map((h) => (h.kind === "promotion" ? { ...h, chance: playoff.promoted! } : h));
  if (playoff.kind === "title") {
    const zone = zones.find((z) => z.kind === "titlePlayoffs" || z.kind === "playoffs")?.kind ?? "title";
    return [...headline, { kind: "playoffWin", zone, chance: playoff.win, ...(playoff.name ? { name: playoff.name } : {}) }];
  }
  return headline;
}

/**
 * Each club's most likely finish: its place in the most likely final table
 * (mostLikelyPlaces), so no two clubs share one. One table per conference
 * when the places are counted within each (`groupOf`).
 */
function setLikeliestFinishes(clubs: Map<TeamId, ClubOutlook>, groupOf?: ReadonlyMap<TeamId, unknown>) {
  const tables = new Map<unknown, ClubOutlook[]>();
  for (const [id, club] of clubs) {
    const key = groupOf?.get(id) ?? null;
    tables.set(key, [...(tables.get(key) ?? []), club]);
  }
  for (const table of tables.values()) {
    const places = mostLikelyPlaces(
      table.map((c) => c.distribution),
      table.map((c) => c.row.position - 1),
    );
    table.forEach((club, i) => {
      const p = places[i]!;
      club.likeliest = { position: p + 1, chance: club.distribution[p] ?? 0 };
    });
  }
}

/**
 * Every club's outlook in a league: where it stands, its chances over the
 * rest of the season (the league page's Monte Carlo, from the real results
 * only) and the model's odds for its remaining games. With `override`, the
 * same run with those results set ("what if this game ends 2–1").
 */
export function leagueOutlook(league: LeagueConfig, data: LeagueData, iterations = SCENARIO_ITERATIONS, override?: ResultMap, s = outlookSetup(league, data)): LeagueOutlook | null {
  if (!s) return null;
  const result = runMonteCarlo({ ...s.input, iterations, seed: SCENARIO_SEED, ...(override ? { override } : {}) });
  return outlookFromRun(league, data, s, result);
}

/**
 * The league as it stood at a moment: games kicking off at or after `cutoff`
 * (an ISO time) have no result yet. For pre-match odds and past snapshots.
 */
export function dataAsOf(data: LeagueData, cutoff: string): LeagueData {
  const strip = (fixtures: Fixture[]) => fixtures.map((f) => (f.result && f.utcDate >= cutoff ? { ...f, result: null } : f));
  return {
    ...data,
    fixtures: strip(data.fixtures),
    ...(data.tournaments ? { tournaments: data.tournaments.map((t) => ({ ...t, fixtures: strip(t.fixtures) })) } : {}),
  };
}

/**
 * One outlook per league and data version, kept while the server runs: the
 * club pages of a league (and their images) share one Monte Carlo.
 */
const cache = new Map<string, { version: string; outlook: LeagueOutlook | null; setup: OutlookSetup | null }>();

/** A fingerprint of a league's data: every game's id, date and result, and the groups. */
export function dataVersion(data: LeagueData): string {
  const fixtures = data.tournaments?.flatMap((t) => t.fixtures) ?? data.fixtures;
  // FNV-1a over each game, so a moved or newly played game changes it.
  let hash = 0x811c9dc5;
  const add = (text: string) => {
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  };
  for (const f of fixtures) add(`${f.id}@${f.utcDate}=${f.result ? `${f.result.home}-${f.result.away}` : ""};`);
  add(data.groups?.map((g) => g.teamIds.join(",")).join("|") ?? "");
  return `${data.seasonKey}:${fixtures.length}:${hash.toString(36)}`;
}

function cached(league: LeagueConfig, data: LeagueData) {
  const version = dataVersion(data);
  const hit = cache.get(league.code);
  if (hit && hit.version === version) return hit;
  const setup = outlookSetup(league, data);
  const entry = { version, setup, outlook: leagueOutlook(league, data, SCENARIO_ITERATIONS, undefined, setup) };
  cache.set(league.code, entry);
  return entry;
}

export function cachedLeagueOutlook(league: LeagueConfig, data: LeagueData): LeagueOutlook | null {
  return cached(league, data).outlook;
}

/** This server's outlook for the league's data as it stands, if it has worked it out (or been given it) already. */
export function peekLeagueOutlook(league: LeagueConfig, data: LeagueData): { outlook: LeagueOutlook | null } | undefined {
  const hit = cache.get(league.code);
  return hit && hit.version === dataVersion(data) ? { outlook: hit.outlook } : undefined;
}

/**
 * Keep an outlook worked out elsewhere (the shared one, src/lib/sharedOutlook.ts)
 * as this server's for the league's data, so cachedLeagueOutlook and the match
 * pages' results read the same numbers.
 */
export function primeLeagueOutlook(league: LeagueConfig, data: LeagueData, setup: OutlookSetup | null, outlook: LeagueOutlook | null) {
  cache.set(league.code, { version: dataVersion(data), setup, outlook });
}

/** What a club's page would say after a result: its chances and average place. */
export type ClubChances = Pick<ClubOutlook, "zones" | "headline" | "expectedPosition">;

/** The season's chances of a game's two clubs after a home win, a draw and an away win (each with a given score). */
export interface ResultScenarios {
  scores: { home: Score; draw: Score; away: Score };
  /** By result, then by club. */
  after: Record<"home" | "draw" | "away", Map<TeamId, ClubChances>>;
}

const scenarioCache = new Map<string, ResultScenarios>();
/** Kept while the server runs, a few hundred games at most (each holds two clubs' chances, three times). */
const SCENARIO_CACHE_SIZE = 500;

/**
 * The league's Monte Carlo with the game's result set to each score, in one
 * simulation loop (runMonteCarloVariants): every simulated season's other
 * games drawn once and finished three times, so each result has the full
 * SCENARIO_ITERATIONS seasons and the same draws for every other game (common
 * random numbers): the change from today's chances is the result's alone.
 * Cached per game and data version.
 */
export function resultScenarios(league: LeagueConfig, data: LeagueData, fixture: Fixture, scores: ResultScenarios["scores"]): ResultScenarios | null {
  const { version, setup } = cached(league, data);
  if (!setup) return null;
  const key = `${league.code}:${version}:${fixture.id}:${JSON.stringify(scores)}`;
  const hit = scenarioCache.get(key);
  if (hit) return hit;
  // One simulation loop: each season's other games drawn once, then finished with each result (full iterations each).
  const [home, draw, away] = runMonteCarloVariants({ ...setup.input, iterations: SCENARIO_ITERATIONS, seed: SCENARIO_SEED }, resultVariants(fixture, scores));
  return keepScenarios(key, { scores, after: { home: chancesAfter(league, data, setup, fixture, home!), draw: chancesAfter(league, data, setup, fixture, draw!), away: chancesAfter(league, data, setup, fixture, away!) } });
}

const resultVariants = (fixture: Fixture, scores: ResultScenarios["scores"]): ResultMap[] => [{ [fixture.id]: scores.home }, { [fixture.id]: scores.draw }, { [fixture.id]: scores.away }];

/** The game's two clubs' chances in a run. */
function chancesAfter(league: LeagueConfig, data: LeagueData, setup: OutlookSetup, fixture: Fixture, result: MonteCarloResult): Map<TeamId, ClubChances> {
  const outlook = outlookFromRun(league, data, setup, result);
  const clubs = new Map<TeamId, ClubChances>();
  for (const id of [fixture.homeId, fixture.awayId]) {
    const club = outlook.clubs.get(id);
    if (club) clubs.set(id, { zones: club.zones, headline: club.headline, expectedPosition: club.expectedPosition });
  }
  return clubs;
}

function keepScenarios(key: string, scenarios: ResultScenarios): ResultScenarios {
  if (scenarioCache.size >= SCENARIO_CACHE_SIZE) scenarioCache.delete(scenarioCache.keys().next().value!);
  scenarioCache.set(key, scenarios);
  return scenarios;
}

/**
 * The league's outlook (exactly cachedLeagueOutlook's) and a game's results
 * (resultScenarios's), together: when the outlook isn't worked out on this
 * server yet, from one simulation loop, the season as it stands first and
 * then each result, instead of a run for the outlook and another for the
 * results. `scoresOf` gives each result's score from the league's model.
 */
export function outlookWithResults(
  league: LeagueConfig,
  data: LeagueData,
  fixture: Fixture,
  scoresOf: (model: LeagueModel) => ResultScenarios["scores"],
): { outlook: LeagueOutlook; scenarios: ResultScenarios } | null {
  const version = dataVersion(data);
  const hit = cache.get(league.code);
  if (hit && hit.version === version) {
    if (!hit.outlook || !hit.setup) return null;
    const scenarios = resultScenarios(league, data, fixture, scoresOf(hit.setup.model));
    return scenarios ? { outlook: hit.outlook, scenarios } : null;
  }
  const setup = outlookSetup(league, data);
  if (!setup) {
    cache.set(league.code, { version, setup, outlook: null });
    return null;
  }
  const scores = scoresOf(setup.model);
  const [now, home, draw, away] = runMonteCarloVariants({ ...setup.input, iterations: SCENARIO_ITERATIONS, seed: SCENARIO_SEED }, [{}, ...resultVariants(fixture, scores)]);
  const outlook = outlookFromRun(league, data, setup, now!);
  cache.set(league.code, { version, setup, outlook });
  const scenarios = keepScenarios(`${league.code}:${version}:${fixture.id}:${JSON.stringify(scores)}`, {
    scores,
    after: { home: chancesAfter(league, data, setup, fixture, home!), draw: chancesAfter(league, data, setup, fixture, draw!), away: chancesAfter(league, data, setup, fixture, away!) },
  });
  return { outlook, scenarios };
}
