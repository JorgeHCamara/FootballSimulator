/**
 * Rating-noise tuning over several seasons of the season backtest: pools the
 * backtest-results/season-<season>.json files of a grid run (`npm run
 * backtest:season -- <season> <codes…> --rating-noise 0,0.15,… --noise-k
 * 5,10,…`), scores every run on all seasons together, and applies the
 * selection rule (chooseNoise in seasonScoring.ts): the lowest pooled RPS
 * whose calibration error is no worse than no noise's at any checkpoint by
 * more than 0.002 and whose title Brier is no worse by more than 1%. Offline
 * and dev-only: it changes no default.
 *
 *   npm run backtest:season:tune -- 2022 2023 2024 2025
 *
 * Prints Markdown tables (per checkpoint for no noise, the chosen run and the
 * runner-up, or the grid's best RPS when no other run is eligible; each season
 * apart; the whole grid) and writes them to
 * backtest-results/rating-noise-tune.md, with the numbers in
 * backtest-results/rating-noise-tune.json.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chooseNoise, metrics, NOISE_RULE, scoreClubs, type Candidate, type Category, type ClubPrediction, type Metrics, type PooledScores, type Scored } from "./seasonScoring.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../backtest-results");
/** Seasons the chosen run has to beat no noise in for the live change (roadmap item 4) to go ahead. */
const SEASONS_NEEDED = 3;

interface SeasonFile {
  season: number;
  failed: string[];
  leagues: {
    code: string;
    final: Record<string, number>;
    categories: Category[];
    checkpoints: { checkpoint: number; runs: Record<string, { clubs: Record<string, ClubPrediction> }> }[];
  }[];
}

const seasons = process.argv.slice(2).map(Number).filter(Number.isInteger);
if (!seasons.length) throw new Error("usage: npm run backtest:season:tune -- <season> <season…>");
const files: SeasonFile[] = await Promise.all(seasons.map(async (y) => JSON.parse(await readFile(join(DIR, `season-${y}.json`), "utf8")) as SeasonFile));

// The runs every file has.
const runKeys = files
  .map((f) => new Set(f.leagues.flatMap((l) => l.checkpoints.flatMap((cp) => Object.keys(cp.runs)))))
  .reduce((a, b) => new Set([...a].filter((k) => b.has(k))));
if (!runKeys.has("0")) throw new Error('every file needs the no-noise run ("0")');
const keys = [...runKeys].sort((a, b) => (a === "0" ? -1 : b === "0" ? 1 : a.localeCompare(b, "en", { numeric: true })));

/** Every scored club, by run, then by checkpoint ("all": every checkpoint), pooled over the leagues of the seasons given. */
function pool(of: SeasonFile[]): Record<string, PooledScores> {
  const rows: Record<string, Record<string, Scored[]>> = {};
  for (const file of of) {
    for (const league of file.leagues) {
      for (const cp of league.checkpoints) {
        for (const key of keys) {
          const scored = scoreClubs({ final: league.final, categories: league.categories }, cp.runs[key]!.clubs);
          const byCp = (rows[key] ??= {});
          (byCp[cp.checkpoint] ??= []).push(...scored);
          (byCp.all ??= []).push(...scored);
        }
      }
    }
  }
  return Object.fromEntries(
    keys.map((key) => {
      const { all, ...byCp } = rows[key]!;
      return [key, { all: metrics(all!), byCheckpoint: Object.fromEntries(Object.entries(byCp).map(([cp, r]) => [cp, metrics(r)])) }];
    }),
  );
}

const pooled = pool(files);
const { chosen, runnerUp, candidates } = chooseNoise(pooled);
const perSeason = Object.fromEntries(files.map((f) => [f.season, pool([f])]));
// The chosen run beats no noise's RPS in how many seasons?
const holds = chosen ? files.filter((f) => perSeason[f.season]![chosen]!.all.rps < perSeason[f.season]!["0"]!.all.rps).map((f) => f.season) : [];
const goAhead = Boolean(chosen) && holds.length >= SEASONS_NEEDED;

// ---------------------------------------------------------------- the report (Markdown)
const n = (x: number | undefined, digits = 4) => (x !== undefined && Number.isFinite(x) ? x.toFixed(digits) : "–");
const label = (key: string) => (key === "0" ? "no noise" : `sd ${key.split("/")[0]}, k ${key.split("/")[1] ?? "18"}`);
const lines: string[] = [];
const say = (s = "") => lines.push(s);
// Without an eligible runner-up, the tables show the grid's best RPS instead, as a reference (it fails the rule).
const reference = !runnerUp && candidates[0] && candidates[0].key !== chosen ? candidates[0].key : undefined;
const shown = ["0", ...(chosen ? [chosen] : []), ...(runnerUp ? [runnerUp] : []), ...(reference ? [reference] : [])];
const rowLabel = (key: string) => (key === reference ? `${label(key)} (best RPS, not eligible)` : label(key));
/** Why a run fails the rule. */
const fails = (c: Candidate) =>
  [c.rps >= pooled["0"]!.all.rps && "RPS", c.worstCalibrationGap > NOISE_RULE.calibrationMargin + 1e-12 && "calibration", c.titleBrierChange > NOISE_RULE.titleMargin + 1e-12 && "title Brier"].filter(Boolean).join(", ");

say(`## Rating noise tune: seasons ${seasons.join(", ")}`);
say();
for (const f of files) say(`- ${f.season}: ${f.leagues.map((l) => l.code).join(", ")}${f.failed.length ? ` (not loaded: ${f.failed.join(", ")})` : ""}`);
say();
say(
  chosen
    ? `**Chosen: ${label(chosen)}** (runner-up: ${runnerUp ? label(runnerUp) : `none${reference ? `; the tables also show the best RPS of the grid, ${label(reference)}, which fails the rule (${fails(candidates[0]!)})` : ""}`}). It beats no noise's RPS in ${holds.length} of ${files.length} seasons (${holds.join(", ") || "none"}): ${goAhead ? `the live change (item 4) can go ahead` : `fewer than ${SEASONS_NEEDED}, so item 4 is cancelled`}.`
    : "**No run meets the selection rule: keep rating noise off** (item 4 is cancelled).",
);
say();
say("### Per checkpoint, all seasons pooled");
say();
say("| Checkpoint | Run | RPS | Calibration error | Title Brier | Top places Brier | Relegation Brier |");
say("|---|---|---|---|---|---|---|");
for (const cp of [...Object.keys(pooled["0"]!.byCheckpoint), "all"]) {
  for (const key of shown) {
    const m: Metrics = cp === "all" ? pooled[key]!.all : pooled[key]!.byCheckpoint[cp]!;
    say(`| ${cp === "all" ? "**all**" : cp} | ${rowLabel(key)} | ${n(m.rps)} | ${n(m.calibrationError)} | ${n(m.brier.title)} | ${n(m.brier.top)} | ${n(m.brier.relegation)} |`);
  }
}
say();
say("### Each season");
say();
say(`| Season | Run | RPS | Calibration error | Title Brier | Top places Brier | Relegation Brier | Beats no noise |`);
say("|---|---|---|---|---|---|---|---|");
for (const f of files) {
  for (const key of shown) {
    const m = perSeason[f.season]![key]!.all;
    const beats = key === "0" ? "" : m.rps < perSeason[f.season]!["0"]!.all.rps ? "yes" : "no";
    say(`| ${f.season} | ${rowLabel(key)} | ${n(m.rps)} | ${n(m.calibrationError)} | ${n(m.brier.title)} | ${n(m.brier.top)} | ${n(m.brier.relegation)} | ${beats} |`);
  }
}
say();
say("### The whole grid, all seasons pooled");
say();
say(`Eligible: lower RPS than no noise, no checkpoint's calibration error worse than no noise's by more than ${NOISE_RULE.calibrationMargin}, the title Brier no more than ${100 * NOISE_RULE.titleMargin}% worse.`);
say();
say("| Run | RPS | vs no noise | Worst calibration gap | Title Brier change | Eligible |");
say("|---|---|---|---|---|---|");
say(`| no noise | ${n(pooled["0"]!.all.rps)} | | | | |`);
for (const c of candidates) {
  say(`| ${label(c.key)} | ${n(c.rps)} | ${(c.rps - pooled["0"]!.all.rps >= 0 ? "+" : "") + n(c.rps - pooled["0"]!.all.rps)} | ${(c.worstCalibrationGap >= 0 ? "+" : "") + n(c.worstCalibrationGap)} | ${(c.titleBrierChange >= 0 ? "+" : "") + (100 * c.titleBrierChange).toFixed(1)}% | ${c.eligible ? "yes" : `no (${fails(c)})`} |`);
}
const report = lines.join("\n");
console.log(report);
await writeFile(join(DIR, "rating-noise-tune.md"), `${report}\n`);
await writeFile(join(DIR, "rating-noise-tune.json"), JSON.stringify({ seasons, runs: keys, chosen: chosen ?? null, runnerUp: runnerUp ?? null, reference: reference ?? null, rule: NOISE_RULE, holds, goAhead, candidates, pooled, perSeason }));
console.error(`\nWritten: backtest-results/rating-noise-tune.md and .json`);
