/**
 * Backtests the match model on a past season: before each matchday, ratings
 * from that season's earlier games only (and starting ratings, rho and home
 * splits from the season before), then the 1X2 probabilities of that
 * matchday's games are scored against what happened.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/backtest.ts 2025 PL PD SA BSA
 */
import { getLeagueByCode } from "../src/config/leagues.ts";
import { expectedGoals, outcomeProbabilities } from "../src/engine/match.ts";
import { buildLeagueModel, DOMESTIC_PRIOR_GAMES, NO_DATA_PRIOR, type ModelOptions } from "../src/engine/ratings.ts";
import { buildLeaguePriors, fetchSeason } from "./priorsLib.ts";

const [yearArg, ...codes] = process.argv.slice(2);
const year = Number(yearArg ?? 2025);
const leagues = codes.length ? codes : ["PL", "PD", "SA", "BSA"];

interface Config {
  name: string;
  dixonColes: boolean;
  home: boolean;
  halfLife: number;
  /** Half-life for last season's games in the priors (default: the same). */
  priorHalfLife?: number;
}
const CONFIGS: Config[] = [
  { name: "old (Poisson, league home adv.)", dixonColes: false, home: false, halfLife: Infinity },
  { name: "+ Dixon–Coles", dixonColes: true, home: false, halfLife: Infinity },
  { name: "+ Dixon–Coles + team home adv.", dixonColes: true, home: true, halfLife: Infinity },
  ...[6, 10, 15, 20].flatMap((h) => [
    { name: `DC, half-life ${h}`, dixonColes: true, home: false, halfLife: h },
    { name: `DC, half-life ${h} (this season only)`, dixonColes: true, home: false, halfLife: h, priorHalfLife: Infinity },
    { name: `DC, half-life ${h} (priors only)`, dixonColes: true, home: false, halfLife: Infinity, priorHalfLife: h },
  ]),
  { name: "DC, half-life 30", dixonColes: true, home: false, halfLife: 30 },
  { name: "DC, half-life 40", dixonColes: true, home: false, halfLife: 40 },
];

interface Score {
  n: number;
  logLoss: number;
  brier: number;
  predictedDraws: number;
  draws: number;
}

const totals = new Map<string, Score>();
const add = (key: string, s: Score) => {
  const t = totals.get(key) ?? { n: 0, logLoss: 0, brier: 0, predictedDraws: 0, draws: 0 };
  totals.set(key, { n: t.n + s.n, logLoss: t.logLoss + s.logLoss, brier: t.brier + s.brier, predictedDraws: t.predictedDraws + s.predictedDraws, draws: t.draws + s.draws });
};

const rows: string[] = [];
for (const code of leagues) {
  const league = getLeagueByCode(code)!;
  const season = await fetchSeason(code, year);
  const priorCache = new Map<number, Awaited<ReturnType<typeof buildLeaguePriors>>>();
  const priorsFor = async (halfLife: number) => {
    if (!priorCache.has(halfLife)) priorCache.set(halfLife, await buildLeaguePriors(league, year, { halfLife, includeCurrent: false }));
    return priorCache.get(halfLife)!;
  };
  const matchdays = [...new Set(season.fixtures.filter((f) => season.results[f.id]).map((f) => f.matchday))].sort((a, b) => a - b);
  for (const config of CONFIGS) {
    const priors = await priorsFor(config.priorHalfLife ?? config.halfLife);
    if (!priors) continue;
    const rho = config.dixonColes ? priors.rho : 0;
    const score: Score = { n: 0, logLoss: 0, brier: 0, predictedDraws: 0, draws: 0 };
    for (const md of matchdays) {
      const known = Object.fromEntries(season.fixtures.filter((f) => f.matchday < md && season.results[f.id]).map((f) => [f.id, season.results[f.id]!]));
      const options: ModelOptions = {
        priorGames: league.ratingPriorGames ?? DOMESTIC_PRIOR_GAMES,
        priorStrengths: priors.clubs,
        missingPrior: NO_DATA_PRIOR,
        rho,
        halfLife: config.halfLife,
        ...(config.home ? { homeFactor: priors.home } : {}),
      };
      const model = buildLeagueModel(season.teams, season.fixtures, known, options);
      for (const f of season.fixtures) {
        const r = season.results[f.id];
        if (f.matchday !== md || !r) continue;
        const p = outcomeProbabilities(expectedGoals(model, f.homeId, f.awayId), rho);
        const outcome = r.home > r.away ? "home" : r.home === r.away ? "draw" : "away";
        score.n++;
        score.logLoss += -Math.log(Math.max(1e-12, p[outcome]));
        score.brier += (["home", "draw", "away"] as const).reduce((sum, k) => sum + (p[k] - (k === outcome ? 1 : 0)) ** 2, 0);
        score.predictedDraws += p.draw;
        score.draws += outcome === "draw" ? 1 : 0;
      }
    }
    add(config.name, score);
    rows.push(
      `${code.padEnd(4)} ${config.name.padEnd(40)} n=${String(score.n).padStart(3)}  log-loss ${(score.logLoss / score.n).toFixed(4)}  Brier ${(score.brier / score.n).toFixed(4)}  draws predicted ${((100 * score.predictedDraws) / score.n).toFixed(1)}% / actual ${((100 * score.draws) / score.n).toFixed(1)}%`,
    );
  }
  const p = await priorsFor(Infinity);
  rows.push(`${code.padEnd(4)} rho ${p?.rho} (${p?.rhoMatches} games), team home factors ${p?.home.size}`);
  rows.push("");
}
console.log(rows.join("\n"));
console.log("ALL (pooled)");
for (const [name, t] of totals) {
  console.log(
    `     ${name.padEnd(40)} n=${t.n}  log-loss ${(t.logLoss / t.n).toFixed(4)}  Brier ${(t.brier / t.n).toFixed(4)}  draws predicted ${((100 * t.predictedDraws) / t.n).toFixed(1)}% / actual ${((100 * t.draws) / t.n).toFixed(1)}%`,
  );
}
