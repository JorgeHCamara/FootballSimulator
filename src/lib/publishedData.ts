// The file itself (".js"): these modules also run outside Next (scripts, tests), whose Node needs the extension.
import { unstable_cache } from "next/cache.js";
import { createHash } from "node:crypto";
import { cacheScope } from "./dataCacheKey.ts";

/*
 * The data the daily job publishes (.github/workflows/odds-snapshots.yml): the
 * odds snapshots (src/data/snapshots) and the games' xG (src/data/xg). They
 * are committed to main as before, so the history stays durable and versioned,
 * but a commit that changes nothing else no longer deploys the site
 * (scripts/vercel-ignore.mjs): a deployment starts Vercel's page cache afresh,
 * and every page of the site was then rebuilt on its next visit, every night.
 *
 * So the running deployment reads them from the repository itself, over HTTPS
 * (publishedSource: the files on main, as GitHub serves them), through Next's
 * data cache:
 * - each file is one entry, kept PUBLISHED_KEEP_SECONDS at most, so a new
 *   file is read the same day even when nobody says it's there;
 * - the job says it's there (/api/revalidate/leagues?publish=…), which
 *   expires that file's entry and the pages that read it (publishedTag), and
 *   no other league's;
 * - the copy the deployment was built with (the bundled file) stays as the
 *   fallback when GitHub can't be read, and wins when it's the newer one
 *   (a deployment that carries snapshots retaken with a new model).
 *
 * Off the platform (a local build, the tests, the scripts) there is no
 * published source unless FOOTSIMU_DATA_URL names one: the files on disk are
 * the data.
 */

export type PublishedKind = "snapshots" | "xg";

/** How long a published file's entry is kept at most: the safety net for a publication nobody announced. */
export const PUBLISHED_KEEP_SECONDS = 21600;

/** Where main's files are served from when nothing else is configured (the repository is public). */
export const DEFAULT_DATA_URL = "https://raw.githubusercontent.com/JorgeHCamara/FootballSimulator/main";

/** The tag of a published file's entry and of the pages that read it: expire it when the file changes. */
export const publishedTag = (kind: PublishedKind, code: string) => `published:${kind}:${code}`;

export interface PublishedSource {
  /** The repository's root as served: `${base}/src/data/xg/PL.json`. */
  base: string;
  /** For a private repository (FOOTSIMU_DATA_TOKEN): sent as the request's authorization. */
  token?: string;
}

/**
 * Where published files are read from, or undefined for the bundled files
 * only: FOOTSIMU_DATA_URL when set ("off" for none), else main's files on
 * GitHub when running on Vercel, else none. Never with sample data.
 */
export function publishedSource(env: Record<string, string | undefined> = process.env): PublishedSource | undefined {
  if (env.FOOTSIMU_SAMPLE_DATA === "1") return undefined;
  const configured = env.FOOTSIMU_DATA_URL?.trim();
  if (configured?.toLowerCase() === "off") return undefined;
  const base = configured || (env.VERCEL ? DEFAULT_DATA_URL : "");
  if (!/^https?:\/\//.test(base)) return undefined;
  return { base: base.replace(/\/+$/, ""), ...(env.FOOTSIMU_DATA_TOKEN ? { token: env.FOOTSIMU_DATA_TOKEN } : {}) };
}

/** A league code as it appears in a file name ("PL", "BL1"): nothing else is ever asked for. */
export const isDataCode = (code: string) => /^[A-Z0-9]{2,6}$/.test(code);

export const publishedUrl = (source: PublishedSource, kind: PublishedKind, code: string) => `${source.base}/src/data/${kind}/${code}.json`;

/** A file's fingerprint as the job computes it (`sha256sum`): the whole SHA-256, in hex. */
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const TIMEOUT_MS = 8000;

/**
 * A published file's text straight from the source, past every cache of ours
 * (GitHub's own CDN may still serve the last version for a few minutes): null
 * when the league has no such file. Throws when the source can't be read.
 */
export async function fetchPublishedText(source: PublishedSource, kind: PublishedKind, code: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!isDataCode(code)) throw new Error(`not a league code: ${code}`);
  const url = publishedUrl(source, kind, code);
  const res = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), ...(source.token ? { headers: { Authorization: `token ${source.token}` } } : {}) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Outside a Next.js server or build (scripts, tests) there is no data cache. */
const noDataCache = (error: unknown) => error instanceof Error && error.message.includes("incrementalCache missing");

/**
 * A published file as JSON, from the data cache (read from the source once
 * and kept there, tagged publishedTag): `{ file: null }` when the league has
 * none, undefined when there's no source or it can't be read (the caller then
 * uses the bundled file). `keep`: how old an entry the caller accepts, which
 * is also how long its page may be kept for it; `quiet`: an entry of its own
 * without the tag, for a page a new publication mustn't rebuild at once (it
 * follows within PUBLISHED_KEEP_SECONDS).
 */
export async function readPublished<T>(
  kind: PublishedKind,
  code: string,
  { keep = PUBLISHED_KEEP_SECONDS, quiet = false, env = process.env }: { keep?: number; quiet?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<{ file: T | null } | undefined> {
  const source = publishedSource(env);
  if (!source || !isDataCode(code)) return undefined;
  const load = async (): Promise<{ file: T | null }> => {
    const text = await fetchPublishedText(source, kind, code);
    return { file: text === null ? null : (JSON.parse(text) as T) };
  };
  try {
    const key = ["published-data", "v1", cacheScope(env), source.base, kind, code, ...(quiet ? ["quiet"] : [])];
    return await unstable_cache(load, key, { tags: quiet ? [] : [publishedTag(kind, code)], revalidate: keep })();
  } catch (error) {
    if (noDataCache(error)) return load().catch(() => undefined);
    console.warn(`${code}: no published ${kind}, using the deployment's own:`, error);
    return undefined;
  }
}

/** What the job announces: a file, and its fingerprint when it wants the source checked for it first. */
export interface Publication {
  kind: PublishedKind;
  code: string;
  sha?: string;
}

/**
 * The `publish` parameter's files: "snapshots:PL:<sha256>,xg:PL" (the
 * fingerprint is optional). Anything else in the list is left out.
 */
export function parsePublications(param: string): Publication[] {
  const out: Publication[] = [];
  for (const part of param.split(",")) {
    const [kind, code, sha] = part.trim().split(":");
    if ((kind !== "snapshots" && kind !== "xg") || !code || !isDataCode(code.toUpperCase())) continue;
    if (sha !== undefined && !/^[0-9a-f]{64}$/.test(sha)) continue;
    out.push({ kind, code: code.toUpperCase(), ...(sha ? { sha } : {}) });
  }
  return out;
}

export type PublicationState = "published" | "pending" | "unavailable";

/**
 * Is the announced file what the source serves now? "published": yes (or no
 * fingerprint to check, or no source: the deployment reads its own files);
 * "pending": the source still serves another version (GitHub's CDN keeps a
 * file for up to five minutes: ask again); "unavailable": it can't be read.
 */
export async function publicationState(p: Publication, source: PublishedSource | undefined, fetcher: typeof fetch = fetch): Promise<PublicationState> {
  if (!source || !p.sha) return "published";
  try {
    const text = await fetchPublishedText(source, p.kind, p.code, fetcher);
    return text !== null && sha256(text) === p.sha ? "published" : "pending";
  } catch {
    return "unavailable";
  }
}

/** The newer of two versions of a file by a stamp of its contents; the published one when they're level, either when the other is missing. */
export function fresher<T>(bundled: T | undefined, published: T | null | undefined, stamp: (file: T) => string | number): T | undefined {
  if (published === undefined || published === null) return bundled;
  if (bundled === undefined) return published;
  return stamp(bundled) > stamp(published) ? bundled : published;
}
