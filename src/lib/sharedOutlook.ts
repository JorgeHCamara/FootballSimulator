// The file itself (".js"): these modules also run outside Next (scripts, tests), whose Node needs the extension.
import { unstable_cache } from "next/cache.js";
import type { LeagueConfig } from "../config/leagues.ts";
import { runMonteCarlo, type MonteCarloResult } from "../engine/montecarlo.ts";
import { dataVersion, outlookFromRun, outlookSetup, peekLeagueOutlook, primeLeagueOutlook, type LeagueOutlook, type OutlookSetup } from "./clubOutlook.ts";
import type { LeagueData } from "./leagueData.ts";
import { SCENARIO_ITERATIONS, SCENARIO_SEED } from "./scenario.ts";
import { SIM_VERSION } from "./simVersion.ts";

/*
 * One season outlook per league, data version and model, shared by every page
 * that shows it (the league page's projected table, every club page and its
 * images, the match pages' clubs): the Monte Carlo runs once per new set of
 * results and is kept in Next's data cache, which every server instance reads
 * and which outlives a deployment. So two club pages built from the same
 * results show chances from the same simulated seasons, wherever and whenever
 * they're rendered (their chances add up: one champion, two promoted…), and a
 * cold server reads the run instead of working it out again.
 *
 * Every page that reads it is tagged outlookTag (by a marker entry, see
 * markPage), so revalidating that tag with the league's data tag
 * (src/app/api/revalidate/leagues) refreshes the league page and every club
 * page of a league together, from the same new data.
 */

/** The tag of every page that shows a league's outlook: revalidate it (with dataTag) to refresh them all together. */
export const outlookTag = (code: string) => `league:${code}-outlook`;

/** The tag of a league's ESPN data (src/lib/leagueData.ts), and of the pages that fetched it. */
export const dataTag = (code: string) => `league:${code}`;

/** The tag of a league's stored runs (one per data version; revalidating it makes them run again). */
export const runTag = (code: string) => `league:${code}-runs`;

/**
 * What a stored run holds besides the table: "table", or "playoff" when the
 * season outlook plays the league's play-off too (its winners' counts). A run
 * stored before the outlook played it must not stand in for one that does.
 */
export type RunShape = "table" | "playoff";

/** The data cache key of a league's run: league, data version, SIM_VERSION and what the run holds. */
export const outlookKey = (code: string, version: string, shape: RunShape = "table") => ["league-outlook", code, version, `sim-${SIM_VERSION}`, ...(shape === "table" ? [] : [shape])];

/** Outside a Next.js server or build (scripts, tests) there is no data cache: the run is worked out on the spot. */
const noDataCache = (error: unknown) => error instanceof Error && error.message.includes("incrementalCache missing");

/** A data cache read, or the value worked out on the spot without a data cache. */
async function fromDataCache<T>(work: () => Promise<T>, key: string[], tags: string[]): Promise<T> {
  try {
    return await unstable_cache(work, key, { tags, revalidate: false })();
  } catch (error) {
    if (noDataCache(error)) return work();
    throw error;
  }
}

/**
 * Tags the page being rendered with outlookTag: a tiny entry read on every
 * render (a page is tagged with the entries it reads, and only then: a render
 * that reused another's data or run in flight would otherwise miss the tags).
 */
const markPage = (code: string) => fromDataCache(async () => code, ["league-pages", code], [outlookTag(code)]);

/** Runs being worked out on this server, so renders at the same moment share one (each still reads the cache). */
const pending = new Map<string, Promise<MonteCarloResult>>();

/** The Monte Carlo of a league's setup, from the data cache (or worked out once and stored there). */
function sharedRun(league: LeagueConfig, setup: OutlookSetup, version: string): Promise<MonteCarloResult> {
  const shape: RunShape = setup.input.playoff ? "playoff" : "table";
  const id = `${league.code}:${version}:${shape}`;
  const work = () => {
    let promise = pending.get(id);
    if (!promise) {
      promise = Promise.resolve().then(() => runMonteCarlo({ ...setup.input, iterations: SCENARIO_ITERATIONS, seed: SCENARIO_SEED }));
      pending.set(id, promise);
      const forget = () => pending.delete(id);
      promise.then(forget, forget);
    }
    return promise;
  };
  // The same data and model always give the same run: kept until runTag is revalidated.
  return fromDataCache(work, outlookKey(league.code, version, shape), [runTag(league.code)]);
}

/**
 * The league's outlook for its data, as every page shows it: the shared run
 * (see above), turned into the outlook here, and kept as this server's copy
 * (cachedLeagueOutlook and the match pages' results then read the same).
 */
export async function sharedLeagueOutlook(league: LeagueConfig, data: LeagueData): Promise<LeagueOutlook | null> {
  await markPage(league.code);
  const setup = outlookSetup(league, data);
  if (!setup) {
    primeLeagueOutlook(league, data, null, null);
    return null;
  }
  // Read on every render (so the page is tagged and reads what every other page reads), turned into an outlook
  // once: renders at the same moment wait for the same run, and the first one back keeps the outlook for the others.
  const run = await sharedRun(league, setup, dataVersion(data));
  const known = peekLeagueOutlook(league, data);
  if (known?.outlook) return known.outlook;
  const outlook = outlookFromRun(league, data, setup, run);
  primeLeagueOutlook(league, data, setup, outlook);
  return outlook;
}
