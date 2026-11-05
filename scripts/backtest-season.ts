/**
 * Season-outcome backtest: is the season Monte Carlo calibrated? When it gives
 * a club a 30% title chance, does that happen about 30% of the time? Offline
 * and dev-only: nothing on the site changes.
 *
 *   npm run backtest:season -- 2025 PL ELC PD BL1 SA FL1 BSA MLS ARG MX
 *   npm run backtest:season -- 2025 PL --rating-noise 0,0.05,0.1,0.15 --noise-k 18
 *
 * For each league's completed season: at checkpoints after rounds 0 (priors
 * only), 5, 10, 15, 20, 25 and 30 of a 38-round season (the same shares of
 * the season for other lengths), the model is rebuilt from the results played
 * by then only (starting ratings from the season before, xG only of games
 * played, the league's live xG weight), and the live setup (outlookSetup:
 * tiebreakers, splits, conferences, annual tables) runs the 10,000-season
 * Monte Carlo with seed 2026. Each club's finishing-position distribution and
 * its title, top-places, relegation and play-off chances are scored against
 * the real final table: Brier scores, the ranked probability score (RPS), a
 * calibration table, the error of the expected position, and the same for a
 * baseline (the table at the checkpoint is the final one; at round 0, last
 * season's table). Results go to backtest-results/season-<season>.json.
 *
 * Options: --rating-noise <sd[,sd…]> runs each checkpoint once per spread of
 * the engine's rating noise (each simulated season starts with every club's
 * attack and defence times exp(N(0, sd × √(k / (k + games played)))); 0, the
 * default, is the live engine). --noise-k <k> (default 18, the prior's weight
 * in games), --iterations <n> (default 10,000), --jobs <n> (leagues run at a
 * time; default: the CPUs), --out <file> (default
 * backtest-results/season-<season>.json).
 */
import { fork } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLeagueByCode, type LeagueConfig } from "../src/config/leagues.ts";
import { PRIOR_SEASONS } from "../src/data/priors/index.ts";
import { runMonteCarlo } from "../src/engine/montecarlo.ts";
import { ratingHalfLife, ratingXgWeight } from "../src/engine/ratings.ts";
import { computeStandings } from "../src/engine/standings.ts";
import type { Fixture, TeamId } from "../src/engine/types.ts";
import { outlookFromRun, outlookSetup } from "../src/lib/clubOutlook.ts";
import { SCENARIO_SEED } from "../src/lib/scenario.ts";
import { hasClubPages } from "../src/lib/clubs.ts";
import { getPastSeasonData, type LeagueData } from "../src/lib/leagueData.ts";
import type { PriorSeason } from "../src/lib/priors.ts";
import { readXg } from "../src/lib/xgStore.ts";
import { buildLeaguePriors, fetchSeason, round3 } from "./priorsLib.ts";
import { BUCKETS, baselinePredictions, categoriesOf, metrics, MIN_BUCKET, noiseConfigs, PLAYOFF_KINDS, scoreClubs, type Category, type ClubPrediction, type Metrics, type NoiseConfig, type Scored } from "./seasonScoring.ts";

const SCRIPT = fileURLToPath(import.meta.url);
const OUT_DIR = join(dirname(SCRIPT), "../backtest-results");
/** Checkpoints on a 38-round season's scale (other lengths: the same share of their games). */
const CHECKPOINTS = [0, 5, 10, 15, 20, 25, 30];
const SCALE = 38;
/** A finished season can have this many games ESPN never gave a result for. */
const MISSING_ALLOWED = 2;

interface Options {
  year: number;
  /** The rating-noise runs: a spread and a fade constant each, under a key ("0" for none). */
  configs: NoiseConfig[];
  iterations: number;
}


interface CheckpointResult {
  /** On the 38-round scale, and in the league's own rounds. */
  checkpoint: number;
  round: number;
  played: number;
  cutoff: string;
  /** The baseline's place for each club: the table at the checkpoint (round 0: last season's). */
  baseline: Record<string, number>;
  /** By rating-noise spread. */
  runs: Record<string, Record<string, ClubPrediction>>;
}

interface LeagueResult {
  code: string;
  name: string;
  season: string;
  scope: string;
  /** Rounds and league games in the season (in the table's scope). */
  rounds: number;
  games: number;
  priors: boolean;
  /** Games of the season ESPN has no result for (left out of the final table). */
  missingResults: number[];
  categories: Category[];
  /** Each club's real final place, and its table's size. */
  final: Record<string, number>;
  tableSize: Record<string, number>;
  checkpoints: CheckpointResult[];
  seconds: number;
}

// ---------------------------------------------------------------- one league (a worker process)

/** The season as it stood at `cutoff`: later results, play-off games and deductions left out, xG only of games played. */
function seasonAsOf(league: LeagueConfig, data: LeagueData, cutoff: string, xg: Record<number, readonly [number, number]>): LeagueData {
  const strip = (fixtures: readonly Fixture[]) => fixtures.map((f) => (f.result && f.utcDate >= cutoff ? { ...f, result: null } : f));
  // Knockout games after the cutoff weren't even drawn yet.
  const before = (fixtures: readonly Fixture[]) => fixtures.filter((f) => f.utcDate < cutoff);
  let fixtures = strip(data.fixtures);
  let groups = data.groups;
  let firstPhaseIds = data.firstPhaseIds;
  // A split not reached yet: its real games (and groups) would give away the groups.
  if (league.split) {
    const firstPhase = new Set(data.firstPhaseIds ?? data.fixtures.filter((f) => f.matchday <= (league.split!.afterRound ?? Infinity)).map((f) => f.id));
    const splitStart = data.fixtures.filter((f) => !firstPhase.has(f.id)).reduce((min, f) => (f.utcDate < min ? f.utcDate : min), "9999");
    if (cutoff <= splitStart) {
      fixtures = fixtures.filter((f) => firstPhase.has(f.id));
      firstPhaseIds = undefined;
      if (league.groupsOptional) groups = undefined;
    }
  }
  const out: LeagueData = {
    ...data,
    fixtures,
    ...(data.tournaments ? { tournaments: data.tournaments.map((t) => ({ ...t, fixtures: strip(t.fixtures), ...(t.postseason ? { postseason: before(t.postseason) } : {}) })) } : {}),
  };
  if (data.postseason) out.postseason = before(data.postseason);
  // Points deductions come from ESPN's final standings: not known at the time.
  delete out.deductions;
  if (groups) out.groups = groups;
  else delete out.groups;
  if (firstPhaseIds) out.firstPhaseIds = firstPhaseIds;
  else delete out.firstPhaseIds;
  // xG of the games played by then, for a league whose ratings use it (as live).
  delete out.xg;
  if (ratingXgWeight(league) > 0) {
    const played = [...out.fixtures, ...(out.tournaments ?? []).flatMap((t) => t.fixtures)].filter((f) => f.result && xg[f.id]);
    if (played.length) out.xg = Object.fromEntries(played.map((f) => [f.id, xg[f.id]!]));
  }
  return out;
}

/** Each club's place in last season's table (by points, the league's tiebreakers), within the tables of this season. */
async function lastSeasonBaseline(league: LeagueConfig, year: number, tables: TeamId[][]): Promise<Record<string, number>> {
  const prev = await fetchSeason(league.code, year - 1).catch(() => null);
  const rank = new Map<TeamId, number>();
  if (prev) for (const row of computeStandings(prev.teams, prev.fixtures, prev.results, { tiebreakers: league.tiebreakers, includeForm: false })) rank.set(row.teamId, row.position);
  const out: Record<string, number> = {};
  for (const table of tables) {
    // Clubs that were in the league, in last season's order; then the newcomers.
    const order = [...table].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a - b);
    order.forEach((id, i) => (out[id] = i + 1));
  }
  return out;
}

async function backtestLeague(code: string, { year, configs, iterations }: Options): Promise<LeagueResult> {
  const started = Date.now();
  const league = getLeagueByCode(code);
  if (!league || !hasClubPages(league)) throw new Error(`${code}: not a domestic league with club pages`);
  const data = await getPastSeasonData(league, year);
  if (!data) throw new Error(`${code}: no ${year} season on ESPN`);
  const full = outlookSetup(league, data);
  if (!full) throw new Error(`${code}: no outlook for its format`);
  // Finished: every game the table counts has its result (an annual table is never marked complete by the outlook),
  // but for a game or two ESPN never gave one (abandoned, awarded): the final table counts the games played.
  const missing = full.fixtures.filter((f) => !f.result);
  if (!full.fixtures.length || missing.length > MISSING_ALLOWED || full.input.project) throw new Error(`${code}: the ${year} season isn't finished (${missing.length} games without a result)`);
  if (missing.length) console.error(`${code}: ${missing.length} game(s) without a result on ESPN (${missing.map((f) => f.id).join(", ")}); the final table counts the games played`);

  // Starting ratings from the season before only (as `npm run priors`, without this season's games).
  const priors = await buildLeaguePriors(league, year, { halfLife: ratingHalfLife(league), includeCurrent: false });
  if (priors) {
    const seasons = PRIOR_SEASONS as Record<number, PriorSeason>;
    seasons[year] = {
      ...seasons[year],
      [code]: {
        rho: priors.rho,
        clubs: Object.fromEntries([...priors.clubs].map(([id, s]) => [id, [round3(s.attack), round3(s.defence)] as const])),
        home: Object.fromEntries([...priors.home].map(([id, h]) => [id, round3(h)])),
      },
    };
  }
  const xg = await readXg(code);

  // The real final table, in the outlook's own scope (a conference, the annual table…).
  const final = Object.fromEntries(full.rows.map((r) => [String(r.teamId), r.position]));
  const games = full.fixtures.filter((f) => f.result).sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id - b.id);
  const clubs = new Set(games.flatMap((f) => [f.homeId, f.awayId]));
  const rounds = Math.round((2 * games.length) / clubs.size);
  const categories = categoriesOf(full.places, full.title);
  // The separate tables (conferences), for last season's baseline.
  const byGroup = new Map<unknown, TeamId[]>();
  for (const r of full.rows) {
    const key = full.scope === "eachTable" ? (full.groupOf?.get(r.teamId) ?? null) : null;
    byGroup.set(key, [...(byGroup.get(key) ?? []), r.teamId]);
  }

  const tableSize: Record<string, number> = {};
  const checkpoints: CheckpointResult[] = [];
  for (const checkpoint of CHECKPOINTS) {
    const played = Math.round((games.length * checkpoint) / SCALE);
    if (played >= games.length) continue;
    // Just after the last kick-off counted: that game is in, any later one isn't.
    const cutoff = played === 0 ? games[0]!.utcDate : new Date(Date.parse(games[played - 1]!.utcDate) + 60_000).toISOString();
    const at = seasonAsOf(league, data, cutoff, xg);
    const s = outlookSetup(league, at);
    if (!s) continue;
    const runs: CheckpointResult["runs"] = {};
    for (const { key, sd, k } of configs) {
      const result = runMonteCarlo({ ...s.input, iterations, seed: SCENARIO_SEED, ...(sd > 0 ? { ratingNoise: { sd, k } } : {}) });
      const outlook = outlookFromRun(league, at, s, result);
      runs[key] = Object.fromEntries(
        [...outlook.clubs.values()].map((c) => {
          tableSize[c.team.id] = c.tableSize;
          return [String(c.team.id), { dist: c.distribution.map((p) => Math.round(p * 1e5) / 1e5), expected: Math.round(c.expectedPosition * 1e4) / 1e4 }];
        }),
      );
    }
    const baseline = checkpoint === 0 ? await lastSeasonBaseline(league, year, [...byGroup.values()]) : Object.fromEntries(s.rows.map((r) => [String(r.teamId), r.position]));
    const playedNow = s.input.fixtures.filter((f) => s.input.fixed[f.id]).length;
    checkpoints.push({ checkpoint, round: Math.round((rounds * checkpoint) / SCALE), played: playedNow, cutoff, baseline, runs });
    console.error(`${code}: checkpoint ${checkpoint} (${playedNow} games played) done`);
  }
  return {
    code,
    name: league.name,
    season: data.season,
    scope: full.scope,
    rounds,
    games: games.length,
    priors: Boolean(priors),
    missingResults: missing.map((f) => f.id),
    categories,
    final,
    tableSize,
    checkpoints,
    seconds: (Date.now() - started) / 1000,
  };
}

// ---------------------------------------------------------------- the run

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) flags.set(a.slice(2), argv[++i] ?? "");
    else positional.push(a);
  }
  const [yearArg, ...codes] = positional;
  const year = Number(yearArg);
  if (!Number.isInteger(year) || !codes.length) throw new Error("usage: npm run backtest:season -- <season> <codes...> [--rating-noise 0,0.05] [--noise-k 18] [--iterations 10000] [--jobs n] [--out file]");
  const sds = (flags.get("rating-noise") ?? "0").split(",").map(Number);
  if (sds.some((sd) => !(sd >= 0))) throw new Error("--rating-noise: spreads of 0 or more, comma-separated");
  const ks = (flags.get("noise-k") ?? "18").split(",").map(Number);
  if (ks.some((k) => !(k > 0))) throw new Error("--noise-k: fade constants above 0, comma-separated");
  return {
    codes,
    worker: flags.get("worker"),
    out: flags.get("out"),
    jobs: Number(flags.get("jobs") ?? Math.min(availableParallelism(), codes.length)),
    options: { year, configs: noiseConfigs(sds, ks), iterations: Number(flags.get("iterations") ?? 10_000) } satisfies Options,
  };
}

/** One league in its own process, so leagues run side by side. */
function runWorker(code: string, argv: string[]): Promise<LeagueResult> {
  return new Promise((resolve, reject) => {
    const child = fork(SCRIPT, [...argv, "--worker", code], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    let result: LeagueResult | undefined;
    child.on("message", (m) => (result = m as LeagueResult));
    child.on("exit", (status) => (result ? resolve(result) : reject(new Error(`${code}: worker exited (${status})`))));
  });
}

const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : "–");
const num = (x: number | undefined, digits = 4) => (x !== undefined && Number.isFinite(x) ? x.toFixed(digits) : "–");
const pad = (s: string, n: number) => s.padEnd(n);
const lpad = (s: string, n: number) => s.padStart(n);

async function main() {
  if (process.env.FOOTSIMU_SAMPLE_DATA === "1") throw new Error("the season backtest needs real data: unset FOOTSIMU_SAMPLE_DATA");
  const { codes, worker, jobs, out, options } = parseArgs(process.argv.slice(2));
  if (worker) {
    const result = await backtestLeague(worker, options);
    process.send!(result);
    return;
  }
  const started = Date.now();
  const argv = process.argv.slice(2);
  // Leagues side by side, `jobs` at a time.
  const leagues: LeagueResult[] = [];
  const failed: string[] = [];
  const queue = [...codes];
  await Promise.all(
    Array.from({ length: Math.max(1, jobs) }, async () => {
      for (let code = queue.shift(); code; code = queue.shift()) {
        try {
          leagues.push(await runWorker(code, argv));
        } catch (error) {
          failed.push(code);
          console.error(String(error));
        }
      }
    }),
  );
  leagues.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));

  // Scores: per league and checkpoint, then pooled by checkpoint and overall, for each spread and the baseline.
  const sdKeys = options.configs.map((c) => c.key);
  const pooled: Record<string, { baseline: Scored[]; runs: Record<string, Scored[]> }> = {};
  const all = { baseline: [] as Scored[], runs: Object.fromEntries(sdKeys.map((k) => [k, [] as Scored[]])) };
  const perLeague = leagues.map((league) => ({
    code: league.code,
    name: league.name,
    season: league.season,
    scope: league.scope,
    rounds: league.rounds,
    games: league.games,
    priorsFromLastSeason: league.priors,
    missingResults: league.missingResults,
    categories: league.categories,
    final: league.final,
    tableSize: league.tableSize,
    seconds: league.seconds,
    checkpoints: league.checkpoints.map((cp) => {
      const base = scoreClubs(league, baselinePredictions(league, cp.baseline));
      const bucket = (pooled[cp.checkpoint] ??= { baseline: [], runs: Object.fromEntries(sdKeys.map((k) => [k, []])) });
      bucket.baseline.push(...base);
      all.baseline.push(...base);
      const runs = Object.fromEntries(
        sdKeys.map((sd) => {
          const scored = scoreClubs(league, cp.runs[sd]!);
          bucket.runs[sd]!.push(...scored);
          all.runs[sd]!.push(...scored);
          return [sd, { metrics: metrics(scored), clubs: cp.runs[sd] }];
        }),
      );
      return { checkpoint: cp.checkpoint, round: cp.round, played: cp.played, cutoff: cp.cutoff, baseline: { metrics: metrics(base), places: cp.baseline }, runs };
    }),
  }));
  const pooledMetrics = Object.fromEntries(
    Object.entries(pooled).map(([cp, p]) => [cp, { baseline: metrics(p.baseline), runs: Object.fromEntries(sdKeys.map((sd) => [sd, metrics(p.runs[sd]!)])) }]),
  );
  const overall = { baseline: metrics(all.baseline), runs: Object.fromEntries(sdKeys.map((sd) => [sd, metrics(all.runs[sd]!)])) };
  // The spread that scores best at each checkpoint: by RPS (accuracy and calibration together) and by calibration error alone.
  const best = Object.fromEntries(
    Object.entries(pooledMetrics).map(([cp, m]) => {
      const by = (f: (x: Metrics) => number) => sdKeys.reduce((a, b) => (f(m.runs[b]!) < f(m.runs[a]!) ? b : a));
      return [cp, { byRps: by((x) => x.rps), byCalibrationError: by((x) => x.calibrationError) }];
    }),
  );
  const seconds = (Date.now() - started) / 1000;

  await mkdir(out ? dirname(out) : OUT_DIR, { recursive: true });
  const file = out ?? join(OUT_DIR, `season-${options.year}.json`);
  await writeFile(
    file,
    JSON.stringify({
      season: options.year,
      generatedAt: new Date().toISOString(),
      iterations: options.iterations,
      seed: SCENARIO_SEED,
      ratingNoise: { configs: options.configs },
      checkpoints: CHECKPOINTS,
      buckets: BUCKETS.map(([from, to]) => [from, Math.min(1, to)]),
      minBucket: MIN_BUCKET,
      failed,
      seconds,
      pooled: { byCheckpoint: pooledMetrics, all: overall, bestRatingNoise: best },
      leagues: perLeague,
    }),
  );

  // ------------------------------------------------------------ the summary
  const lines: string[] = [];
  const say = (s = "") => lines.push(s);
  say(`SEASON BACKTEST ${options.year}: ${leagues.length} league(s), ${options.iterations.toLocaleString("en")} simulated seasons per run, seed ${SCENARIO_SEED}`);
  say(`Rating noise (sd${options.configs.some((c) => c.key.includes("/")) ? "/k" : ""}): ${options.configs.map((c) => (c.key.includes("/") || c.sd === 0 ? c.key : `${c.key} (k = ${c.k})`)).join(", ")}. Lower is better for every score.`);
  if (failed.length) say(`Not run: ${failed.join(", ")} (see the errors above)`);
  const sd0 = sdKeys[0]!;
  say();
  say(`PER LEAGUE (rating noise ${sd0})          Brier                                    |  model          |  baseline`);
  say(`league  cp  rnd  played  title   top     releg   play-off |  RPS     MAE    |  RPS     MAE`);
  for (const l of perLeague) {
    for (const cp of l.checkpoints) {
      const m = cp.runs[sd0]!.metrics;
      const b = cp.baseline.metrics;
      const playoff = Object.keys(m.brier).find((k) => (PLAYOFF_KINDS as readonly string[]).includes(k));
      say(
        `${pad(l.code, 6)} ${lpad(String(cp.checkpoint), 3)} ${lpad(String(cp.round), 4)} ${lpad(String(cp.played), 7)}  ${pad(num(m.brier.title), 7)} ${pad(num(m.brier.top), 7)} ${pad(num(m.brier.relegation), 7)} ${pad(playoff ? num(m.brier[playoff]) : "–", 8)} |  ${num(m.rps)}  ${num(m.mae, 2)}  |  ${num(b.rps)}  ${num(b.mae, 2)}`,
      );
    }
  }
  const grid = sdKeys.length > 4;
  if (grid) {
    // A grid: one row per run, a column per checkpoint.
    const cps = Object.keys(pooledMetrics);
    const matrix = (title: string, f: (m: Metrics) => number) => {
      say();
      say(title);
      say(`${pad("run", 10)} ${cps.map((cp) => lpad(`cp ${cp}`, 8)).join(" ")} ${lpad("all", 8)}`);
      for (const sd of sdKeys) say(`${pad(sd, 10)} ${cps.map((cp) => lpad(num(f(pooledMetrics[cp]!.runs[sd]!)), 8)).join(" ")} ${lpad(num(f(overall.runs[sd]!)), 8)}`);
      say(`${pad("baseline", 10)} ${cps.map((cp) => lpad(num(f(pooledMetrics[cp]!.baseline)), 8)).join(" ")} ${lpad(num(f(overall.baseline)), 8)}`);
    };
    matrix("RPS, POOLED BY CHECKPOINT (all leagues)", (m) => m.rps);
    matrix("CALIBRATION ERROR, POOLED BY CHECKPOINT", (m) => m.calibrationError);
    matrix("TITLE BRIER, POOLED BY CHECKPOINT", (m) => m.brier.title ?? NaN);
  }
  if (!grid) {
    say();
    say("POOLED BY CHECKPOINT (all leagues)");
    say(`cp   clubs | ${sdKeys.map((sd) => pad(`sd ${sd}: RPS / MAE / calib. err.`, 30)).join(" | ")} | baseline RPS / MAE`);
    for (const [cp, m] of Object.entries(pooledMetrics)) {
      say(
        `${lpad(cp, 3)} ${lpad(String(m.baseline.clubs), 6)} | ${sdKeys.map((sd) => pad(`${num(m.runs[sd]!.rps)} / ${num(m.runs[sd]!.mae, 2)} / ${num(m.runs[sd]!.calibrationError)}`, 30)).join(" | ")} | ${num(m.baseline.rps)} / ${num(m.baseline.mae, 2)}`,
      );
    }
    say(`all ${lpad(String(overall.baseline.clubs), 6)} | ${sdKeys.map((sd) => pad(`${num(overall.runs[sd]!.rps)} / ${num(overall.runs[sd]!.mae, 2)} / ${num(overall.runs[sd]!.calibrationError)}`, 30)).join(" | ")} | ${num(overall.baseline.rps)} / ${num(overall.baseline.mae, 2)}`);
    say();
    say("BRIER, POOLED BY CHECKPOINT (title / top places / relegation)");
    for (const [cp, m] of Object.entries(pooledMetrics)) {
      const cell = (x: Metrics) => `${num(x.brier.title)} / ${num(x.brier.top)} / ${num(x.brier.relegation)}`;
      say(`${lpad(cp, 3)} | ${sdKeys.map((sd) => pad(`sd ${sd}: ${cell(m.runs[sd]!)}`, 36)).join(" | ")} | baseline ${cell(m.baseline)}`);
    }
  }
  if (sdKeys.length > 1) {
    say();
    say("BEST RATING NOISE BY CHECKPOINT (lowest pooled RPS; lowest calibration error)");
    for (const [cp, b] of Object.entries(best)) say(`${lpad(cp, 3)}: RPS → sd ${b.byRps}; calibration → sd ${b.byCalibrationError}`);
  }
  for (const sd of grid ? [sd0] : sdKeys) {
    say();
    say(`CALIBRATION, all leagues and checkpoints, rating noise ${sd} (every chance scored: title, top places, relegation, play-offs)`);
    say("bucket      predicted  actual     n");
    for (const b of overall.runs[sd]!.calibration) say(`${pad(b.bucket, 10)}  ${lpad(pct(b.predicted), 8)}  ${lpad(pct(b.actual), 7)}  ${lpad(String(b.n), 5)}${b.tooFewToTrust ? "  too few to trust" : ""}`);
  }
  say();
  say(`CALIBRATION BY CHECKPOINT, rating noise ${sd0}: predicted → actual (n) per bucket`);
  for (const [cp, m] of Object.entries(pooledMetrics)) {
    say(`${lpad(cp, 3)}: ${m.runs[sd0]!.calibration.map((b) => `${b.bucket} ${pct(b.predicted)}→${pct(b.actual)} (${b.n}${b.tooFewToTrust ? "*" : ""})`).join("  ")}`);
  }
  say("* fewer than 30 predictions: too few to trust");
  say();
  say(`Results: ${file}`);
  say(`Total run time: ${seconds.toFixed(1)} s (${leagues.map((l) => `${l.code} ${l.seconds.toFixed(0)} s`).join(", ")}; ${jobs} at a time)`);
  console.log(lines.join("\n"));
}

await main();
