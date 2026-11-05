/**
 * Backtests the match model on a past season: before each matchday, ratings
 * from that season's earlier games only (and starting ratings, rho and home
 * splits from the season before), then the 1X2 probabilities of that
 * matchday's games are scored against what happened.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/backtest.ts 2025 PL PD SA BSA
 *
 * With --xg, the current model (Dixon–Coles) with its ratings on a blend of
 * xG and goals (src/data/xg, `npm run xg`) at several weights instead.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/backtest.ts --xg 2026 PL ELC PD BL1 SA FL1 BSA MLS ARG MX
 */
import { getLeagueByCode } from "../src/config/leagues.ts";
import { expectedGoals, outcomeProbabilities } from "../src/engine/match.ts";
import { buildLeagueModel, DOMESTIC_PRIOR_GAMES, NO_DATA_PRIOR, type ModelOptions } from "../src/engine/ratings.ts";
import { buildLeaguePriors, fetchSeason } from "./priorsLib.ts";

const xgMode = process.argv.includes("--xg");
const [yearArg, ...codes] = process.argv.slice(2).filter((a) => a !== "--xg");
const year = Number(yearArg ?? 2025);
const leagues = codes.length ? codes : ["PL", "PD", "SA", "BSA"];

interface Config {
  name: string;
  dixonColes: boolean;
  home: boolean;
  halfLife: number;
  /** Half-life for last season's games in the priors (default: the same). */
  priorHalfLife?: number;
  /** Ratings on xgWeight × xG + (1 − xgWeight) × goals, for games with xG. */
  xgWeight?: number;
}
const XG_CONFIGS: Config[] = [0, 0.3, 0.5, 0.7, 1].map((w) => ({ name: `DC, xG weight ${w}`, dixonColes: true, home: false, halfLife: Infinity, xgWeight: w }));
const CONFIGS: Config[] = xgMode ? XG_CONFIGS : [
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
/** --xg: each game's log loss per weight (same games, same order), for paired comparisons with goals only. */
const perGame = new Map<string, Map<string, number[]>>();
const paired = (base: number[], other: number[]) => {
  const d = other.map((x, i) => x - base[i]!);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, d.length - 1));
  return { mean, se: sd / Math.sqrt(d.length) };
};
for (const code of leagues) {
  const league = getLeagueByCode(code)!;
  const season = await fetchSeason(code, year);
  const priorCache2 = new Map<string, Awaited<ReturnType<typeof buildLeaguePriors>>>();
  const priorsFor = async (halfLife: number, xgWeight = 0) => {
    const key = `${halfLife}:${xgWeight}`;
    if (!priorCache2.has(key)) priorCache2.set(key, await buildLeaguePriors(league, year, { halfLife, includeCurrent: false, xgWeight }));
    return priorCache2.get(key)!;
  };
  const matchdays = [...new Set(season.fixtures.filter((f) => season.results[f.id]).map((f) => f.matchday))].sort((a, b) => a - b);
  for (const config of CONFIGS) {
    const priors = await priorsFor(config.priorHalfLife ?? config.halfLife, config.xgWeight ?? 0);
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
        ...(config.xgWeight ? { xg: season.xg, xgWeight: config.xgWeight } : {}),
      };
      const model = buildLeagueModel(season.teams, season.fixtures, known, options);
      for (const f of season.fixtures) {
        const r = season.results[f.id];
        if (f.matchday !== md || !r) continue;
        const p = outcomeProbabilities(expectedGoals(model, f.homeId, f.awayId), rho);
        const outcome = r.home > r.away ? "home" : r.home === r.away ? "draw" : "away";
        score.n++;
        const loss = -Math.log(Math.max(1e-12, p[outcome]));
        score.logLoss += loss;
        if (xgMode) {
          const byConfig = perGame.get(code) ?? perGame.set(code, new Map()).get(code)!;
          (byConfig.get(config.name) ?? byConfig.set(config.name, []).get(config.name)!).push(loss);
        }
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
  const withXg = season.fixtures.filter((f) => season.results[f.id] && season.xg[f.id]).length;
  rows.push(`${code.padEnd(4)} rho ${p?.rho} (${p?.rhoMatches} games), team home factors ${p?.home.size}; games with xG ${withXg} of ${Object.keys(season.results).length}`);
  rows.push("");
}
console.log(rows.join("\n"));
if (xgMode) {
  // Log loss change from goals only, game by game: mean ± standard error (negative = xG helps).
  console.log("\nPAIRED vs xG weight 0 (log-loss change per game, mean ± SE)");
  const pooled = new Map<string, number[]>();
  for (const [code, byConfig] of perGame) {
    const base = byConfig.get(XG_CONFIGS[0]!.name)!;
    const cells = XG_CONFIGS.slice(1).map((c) => {
      const { mean, se } = paired(base, byConfig.get(c.name)!);
      pooled.set(c.name, [...(pooled.get(c.name) ?? []), ...byConfig.get(c.name)!]);
      return `w${c.xgWeight} ${mean >= 0 ? "+" : ""}${mean.toFixed(4)} ± ${se.toFixed(4)}`;
    });
    pooled.set(XG_CONFIGS[0]!.name, [...(pooled.get(XG_CONFIGS[0]!.name) ?? []), ...base]);
    console.log(`  ${code.padEnd(4)} ${cells.join("   ")}`);
  }
  const base = pooled.get(XG_CONFIGS[0]!.name)!;
  console.log(`  ALL  ${XG_CONFIGS.slice(1).map((c) => { const { mean, se } = paired(base, pooled.get(c.name)!); return `w${c.xgWeight} ${mean >= 0 ? "+" : ""}${mean.toFixed(4)} ± ${se.toFixed(4)}`; }).join("   ")}`);
}
console.log("ALL (pooled)");
for (const [name, t] of totals) {
  console.log(
    `     ${name.padEnd(40)} n=${t.n}  log-loss ${(t.logLoss / t.n).toFixed(4)}  Brier ${(t.brier / t.n).toFixed(4)}  draws predicted ${((100 * t.predictedDraws) / t.n).toFixed(1)}% / actual ${((100 * t.draws) / t.n).toFixed(1)}%`,
  );
}
