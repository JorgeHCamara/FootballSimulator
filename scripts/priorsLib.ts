/**
 * How a domestic league's starting ratings and match parameters are built
 * from ESPN's results (used by build-priors.ts and backtest.ts).
 */
import { LEAGUES, type LeagueConfig } from "../src/config/leagues.ts";
import { dixonColesTau, expectedGoals } from "../src/engine/match.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clubPriors, round3, seasonRatings } from "../src/engine/offseason.ts";
import { buildLeagueModel, ratingXgWeight, type LeagueModel, type TeamStrength } from "../src/engine/ratings.ts";
import { xgByFixture, type GameXg, type XgFile } from "../src/lib/xg.ts";
import { realResults } from "../src/engine/results.ts";
import type { Fixture, ResultMap, Team, TeamId } from "../src/engine/types.ts";
import { espnFixtures, espnTeams, fetchEspnSeason } from "../src/lib/espn.ts";

/** The league below each one the site covers (promotion and relegation between them). */
export const LOWER: Partial<Record<string, string>> = { PL: "ELC", ELC: "EL1", EL1: "EL2", PD: "SD", BL1: "BL2", SA: "SB", FL1: "FL2", DED: "DJL", BSA: "BSB", ARG: "PN" };
export const UPPER: Partial<Record<string, string>> = Object.fromEntries(Object.entries(LOWER).map(([up, down]) => [down!, up]));

// The rule from one season's ratings to the next (CARRY, PROMOTED, RELEGATED…) is in src/engine/offseason.ts,
// shared with the My World mode: clubPriors, seasonRatings and round3 come from there.
export { clubPriors, round3, seasonRatings };

/** Dixon–Coles rho: the range it's kept in, and the value for leagues with too few games. */
export const RHO_RANGE = [-0.2, 0] as const;
export const DEFAULT_RHO = -0.1;
const MIN_RHO_MATCHES = 150;
/** Home advantage: home games a club needs to move half way from the league's (w = n / (n + K)), and the clamp. */
export const HOME_SHRINK_GAMES = 35;
export const HOME_CLAMP = 0.3;

const byCode = new Map(LEAGUES.map((l) => [l.code as string, l]));

export interface Season {
  teams: Team[];
  fixtures: Fixture[];
  results: ResultMap;
  /** Each game's xG where ESPN has it (src/data/xg), by fixture id. */
  xg: Record<number, GameXg>;
}

/** A league's stored xG (src/data/xg), if it has any. */
function storedXg(code: string): Record<number, GameXg> {
  try {
    return xgByFixture(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/data/xg", `${code}.json`), "utf8")) as XgFile);
  } catch {
    return {};
  }
}

const seasons = new Map<string, Promise<Season>>();
/** A league's season from ESPN (cached for the run). */
export function fetchSeason(code: string, year: number): Promise<Season> {
  const key = `${code}:${year}`;
  if (!seasons.has(key)) {
    const league = byCode.get(code)!;
    seasons.set(
      key,
      fetchEspnSeason(league.espn.slug, year, league.espn.seasons).then((events) => {
        const fixtures = espnFixtures(events);
        const xg = storedXg(code);
        return { teams: espnTeams(events), fixtures, results: realResults(fixtures), xg: Object.fromEntries(fixtures.flatMap((f) => (xg[f.id] ? [[f.id, xg[f.id]!]] : []))) };
      }),
    );
  }
  return seasons.get(key)!;
}


/** Played games of several seasons as one pool (ids are ESPN's, unique across seasons). */
export function pool(...parts: Season[]): Season {
  const teams = new Map<number, Team>();
  for (const part of parts) for (const t of part.teams) teams.set(t.id, t);
  const fixtures = parts.flatMap((p) => p.fixtures.filter((f) => p.results[f.id]));
  return { teams: [...teams.values()], fixtures, results: Object.assign({}, ...parts.map((p) => p.results)), xg: Object.assign({}, ...parts.map((p) => p.xg)) };
}

/**
 * Dixon–Coles rho by maximum likelihood with the ratings held fixed: only τ
 * depends on rho, so it maximises Σ log τ over the games (a grid search),
 * clamped to RHO_RANGE; DEFAULT_RHO with too few games.
 */
export function estimateRho(model: LeagueModel, season: Season): { rho: number; matches: number } {
  const games = season.fixtures.filter((f) => season.results[f.id]);
  if (games.length < MIN_RHO_MATCHES) return { rho: DEFAULT_RHO, matches: games.length };
  const xg = games.map((f) => expectedGoals(model, f.homeId, f.awayId));
  let best = { rho: 0, ll: -Infinity };
  for (let rho = -0.3; rho <= 0.1 + 1e-9; rho += 0.0025) {
    let ll = 0;
    games.forEach((f, i) => {
      const r = season.results[f.id]!;
      ll += Math.log(Math.max(1e-12, dixonColesTau(r.home, r.away, xg[i]!, rho)));
    });
    if (ll > best.ll) best = { rho, ll };
  }
  return { rho: round3(Math.min(RHO_RANGE[1], Math.max(RHO_RANGE[0], best.rho))), matches: games.length };
}

/**
 * Each club's home/away split relative to the league's, from its home and
 * away goals for and against, each against what its opponents would give an
 * average side at that venue (the pooled model's ratings). Shrunk hard to
 * the league's (w = n / (n + K), n its home games) and clamped to ±30%.
 * Only for `clubs` (returning ones); the others play at the league's.
 */
export function estimateHomeFactors(model: LeagueModel, season: Season, clubs: ReadonlySet<TeamId>): Map<TeamId, number> {
  const acc = new Map<TeamId, { n: number; hgf: number; hxgf: number; hga: number; hxga: number; agf: number; axgf: number; aga: number; axga: number }>();
  const get = (id: TeamId) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { n: 0, hgf: 0, hxgf: 0, hga: 0, hxga: 0, agf: 0, axgf: 0, aga: 0, axga: 0 }));
    return a;
  };
  const s = (id: TeamId) => model.strengths.get(id) ?? { attack: 1, defence: 1 };
  for (const f of season.fixtures) {
    const r = season.results[f.id];
    if (!r || f.neutral) continue;
    const h = get(f.homeId);
    const a = get(f.awayId);
    h.n++;
    // What each side's opponent gives an average side at this venue.
    h.hgf += r.home;
    h.hxgf += model.avgHomeGoals * s(f.awayId).defence;
    h.hga += r.away;
    h.hxga += model.avgAwayGoals * s(f.awayId).attack;
    a.agf += r.away;
    a.axgf += model.avgAwayGoals * s(f.homeId).defence;
    a.aga += r.home;
    a.axga += model.avgHomeGoals * s(f.homeId).attack;
  }
  const raw = new Map<TeamId, { n: number; log: number }>();
  for (const [id, a] of acc) {
    if (a.n < 1 || a.hgf + a.hga === 0 || !(a.hxgf > 0 && a.axgf > 0 && a.hxga > 0 && a.axga > 0)) continue;
    // Smoothed ratios (half a goal each way) so a club that never scored away isn't infinite.
    const ratio = (g: number, x: number) => (g + 0.5) / (x + 0.5);
    const home = ratio(a.hgf, a.hxgf) / ratio(a.hga, a.hxga);
    const away = ratio(a.agf, a.axgf) / ratio(a.aga, a.axga);
    raw.set(id, { n: a.n, log: Math.log(home / away) });
  }
  const values = [...raw.values()];
  const leagueLog = values.length ? values.reduce((sum, v) => sum + v.log, 0) / values.length : 0;
  const out = new Map<TeamId, number>();
  for (const id of clubs) {
    const v = raw.get(id);
    if (!v) continue;
    const w = v.n / (v.n + HOME_SHRINK_GAMES);
    const k = Math.exp(w * (v.log - leagueLog));
    out.set(id, round3(Math.min(1 + HOME_CLAMP, Math.max(1 - HOME_CLAMP, k))));
  }
  return out;
}

export interface LeaguePriors {
  clubs: Map<TeamId, TeamStrength>;
  rho: number;
  rhoMatches: number;
  home: Map<TeamId, number>;
  counts: ReturnType<typeof clubPriors>["counts"];
}

/**
 * One league's priors for the season starting in `year`: its clubs' starting
 * ratings from the season before (later games weighing more with
 * `halfLife`), and rho and the home splits from last season and, with
 * `includeCurrent`, the current season's games so far.
 */
export async function buildLeaguePriors(
  league: LeagueConfig,
  year: number,
  { halfLife = Infinity, includeCurrent = true, xgWeight = ratingXgWeight(league) }: { halfLife?: number; includeCurrent?: boolean; xgWeight?: number } = {},
): Promise<LeaguePriors | null> {
  const current = await fetchSeason(league.code, year);
  if (current.teams.length < 4) return null;
  // Last season's ratings, on the same blend of xG and goals as the league's ratings (games without xG on goals).
  const lastSeason = await fetchSeason(league.code, year - 1).catch(() => null);
  const last = lastSeason ? seasonRatings(lastSeason, halfLife, xgWeight) : null;
  const lower = LOWER[league.code] ? await fetchSeason(LOWER[league.code]!, year - 1).then((s) => seasonRatings(s, halfLife, xgWeight)).catch(() => null) : null;
  const upper = UPPER[league.code] ? await fetchSeason(UPPER[league.code]!, year - 1).then((s) => seasonRatings(s, halfLife, xgWeight)).catch(() => null) : null;
  const { strengths, counts, returning } = clubPriors(current.teams, last, lower, upper);
  // rho and home splits: from the league's games, last season (+ this one so far).
  const parts = [lastSeason, includeCurrent ? current : null].filter((p): p is Season => Boolean(p));
  const games = pool(...parts);
  const fitted = buildLeagueModel(games.teams, games.fixtures, games.results, { priorGames: 3 });
  const { rho, matches } = estimateRho(fitted, games);
  const home = estimateHomeFactors(fitted, games, returning);
  return { clubs: strengths, rho, rhoMatches: matches, home, counts };
}
