// Scoring for the season-outcome backtest (scripts/backtest-season.ts): which
// chances are scored, and the scores (Brier, ranked probability score,
// calibration buckets, the expected place's error).
import type { Zone } from "../src/config/leagues.ts";
import { CONTINENTAL } from "../src/lib/leagueFacts.ts";

/** Calibration buckets of a predicted chance, [from, to). */
export const BUCKETS: readonly [number, number][] = [[0, 0.05], [0.05, 0.15], [0.15, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.000001]];
/** A bucket with fewer predictions than this is too small to trust. */
export const MIN_BUCKET = 30;
/** Play-off places scored when a league has them. */
export const PLAYOFF_KINDS = ["promotionPlayoff", "playoffs", "titlePlayoffs", "relegationPlayoff"] as const;

/** A chance the backtest scores: a range of final places (the title, the top places, relegation, play-offs). */
export interface Category {
  key: string;
  ranges: [number, number][];
}

/** One club at one checkpoint: its finishing-position chances (index 0 = 1st) and its average place. */
export interface ClubPrediction {
  dist: number[];
  expected: number;
}

/** What scoring needs of a league's run: its real final places, its table sizes and the chances scored. */
interface LeagueResult {
  final: Record<string, number>;
  tableSize: Record<string, number>;
  categories: Category[];
}

/** The chances scored, from the league's places: the title, its top places (continental, else promotion), relegation and play-offs. */
export function categoriesOf(places: readonly Zone[], title: boolean): Category[] {
  const sorted = [...places].sort((a, b) => a.from - b.from);
  const out: Category[] = [];
  const titleZone = sorted.find((z) => z.kind === "title");
  if (title || titleZone) out.push({ key: "title", ranges: [[1, 1]] });
  const family = (kind: string) => kind.replace(/Qualifying$/, "");
  const first = sorted.findIndex((z) => CONTINENTAL.has(z.kind));
  if (first >= 0) {
    const top = family(sorted[first]!.kind);
    const zones = sorted.filter((z) => family(z.kind) === top);
    const fromTop = sorted.slice(0, first).every((z) => z.kind === "title");
    out.push({ key: "top", ranges: [[fromTop ? 1 : Math.min(...zones.map((z) => z.from)), Math.max(...zones.map((z) => z.to))]] });
  } else {
    const promotion = sorted.filter((z) => z.kind === "promotion");
    if (promotion.length) out.push({ key: "top", ranges: promotion.map((z) => [z.from, z.to]) });
  }
  const relegation = sorted.filter((z) => z.kind === "relegation");
  if (relegation.length) out.push({ key: "relegation", ranges: relegation.map((z) => [z.from, z.to]) });
  for (const kind of PLAYOFF_KINDS) {
    const zones = sorted.filter((z) => z.kind === kind);
    if (zones.length) out.push({ key: kind, ranges: zones.map((z) => [z.from, z.to]) });
  }
  return out;
}

export interface Scored {
  /** Each finishing-position distribution, its expected place and the real one. */
  dist: number[];
  expected: number;
  final: number;
  /** Each scored chance and whether it happened. */
  chances: { key: string; p: number; hit: 0 | 1 }[];
}

export interface Metrics {
  clubs: number;
  brier: Record<string, number>;
  rps: number;
  mae: number;
  calibration: { bucket: string; n: number; predicted: number; actual: number; tooFewToTrust: boolean }[];
  /** Expected calibration error: the buckets' |predicted − actual|, weighted by their counts. */
  calibrationError: number;
}

const inRanges = (place: number, ranges: readonly [number, number][]) => ranges.some(([from, to]) => place >= from && place <= to);

/** A league's clubs at a checkpoint, scored: from a run's distributions, or from the baseline's places (certain). */
export function scoreClubs(league: Pick<LeagueResult, "final" | "categories">, predictions: Record<string, ClubPrediction>): Scored[] {
  return Object.entries(predictions).flatMap(([id, pred]) => {
    const final = league.final[id];
    if (final === undefined) return [];
    return [
      {
        dist: pred.dist,
        expected: pred.expected,
        final,
        chances: league.categories.map((c) => ({
          key: c.key,
          p: pred.dist.reduce((sum, p, i) => sum + (inRanges(i + 1, c.ranges) ? p : 0), 0),
          hit: inRanges(final, c.ranges) ? 1 : 0,
        })),
      },
    ];
  });
}

export const baselinePredictions = (league: Pick<LeagueResult, "tableSize">, places: Record<string, number>): Record<string, ClubPrediction> =>
  Object.fromEntries(
    Object.entries(places).map(([id, place]) => {
      const size = league.tableSize[id] ?? Math.max(...Object.values(places));
      return [id, { dist: Array.from({ length: size }, (_, i) => (i + 1 === place ? 1 : 0)), expected: place }];
    }),
  );

export function metrics(rows: readonly Scored[]): Metrics {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const brier: Record<string, number> = {};
  for (const key of new Set(rows.flatMap((r) => r.chances.map((c) => c.key)))) brier[key] = mean(rows.flatMap((r) => r.chances.filter((c) => c.key === key).map((c) => (c.p - c.hit) ** 2)));
  // Ranked probability score: the cumulative chances against the real place, over the places.
  const rps = mean(
    rows.map((r) => {
      const n = r.dist.length;
      let cumulative = 0;
      let sum = 0;
      for (let place = 1; place < n; place++) {
        cumulative += r.dist[place - 1]!;
        sum += (cumulative - (r.final <= place ? 1 : 0)) ** 2;
      }
      return n > 1 ? sum / (n - 1) : 0;
    }),
  );
  const all = rows.flatMap((r) => r.chances);
  const calibration = BUCKETS.map(([from, to]) => {
    const inBucket = all.filter((c) => c.p >= from && c.p < to);
    return {
      bucket: `${Math.round(from * 100)}–${Math.min(100, Math.round(to * 100))}%`,
      n: inBucket.length,
      predicted: mean(inBucket.map((c) => c.p)),
      actual: mean(inBucket.map((c) => c.hit)),
      tooFewToTrust: inBucket.length < MIN_BUCKET,
    };
  });
  const calibrationError = calibration.reduce((sum, b) => sum + (b.n ? b.n * Math.abs(b.predicted - b.actual) : 0), 0) / Math.max(1, all.length);
  return { clubs: rows.length, brier, rps, mae: mean(rows.map((r) => Math.abs(r.expected - r.final))), calibration, calibrationError };
}

