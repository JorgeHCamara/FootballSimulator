// Vercel's "ignored build step" (vercel.json's ignoreCommand): exit 0 to skip
// the build, 1 to build.
//
// The daily job commits new odds snapshots and xG to main
// (.github/workflows/odds-snapshots.yml). The running site reads those files
// from the repository itself (src/lib/publishedData.ts), so a commit that
// changes nothing else doesn't need a deployment, and a deployment isn't
// free: it starts Vercel's page cache afresh, and every page of the site is
// then rebuilt on its next visit.
//
// Skipped only when it is certain that nothing but those files changed since
// the last deployment of main that succeeded (VERCEL_GIT_PREVIOUS_SHA, not
// just the last commit: a code change whose own build was cancelled or failed
// is still built with the next commit). Anything else builds: another
// branch, a first deployment, a redeploy of the same commit, a comparison
// that can't be made.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The folders the running site reads from the repository instead of from its own build. */
export const PUBLISHED_FOLDERS = ["src/data/snapshots/", "src/data/xg/"];

/**
 * Whether to build, and why: `changed` is every file that differs between the
 * last deployed commit and this one (undefined when it couldn't be worked out).
 */
export function decide({ ref, previous, changed }) {
  if (ref !== "main") return { build: true, why: `branch ${ref || "unknown"}: only main's data commits are skipped` };
  if (!previous) return { build: true, why: "no earlier deployment to compare with" };
  if (!changed) return { build: true, why: "the changes since the last deployment couldn't be listed" };
  if (changed.length === 0) return { build: true, why: "nothing changed since the last deployment (a redeploy)" };
  const other = changed.filter((file) => !PUBLISHED_FOLDERS.some((folder) => file.startsWith(folder)));
  if (other.length) return { build: true, why: `${other.length} file(s) outside the published data changed, e.g. ${other[0]}` };
  return { build: false, why: `only published data changed (${changed.length} file(s)): the running site reads it from the repository` };
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** The files that differ between a commit and HEAD, or undefined when git can't say. */
function changedSince(previous, env) {
  const names = () => git("diff", "--name-only", previous, "HEAD").split("\n").filter(Boolean);
  try {
    return names();
  } catch {
    // The build's clone is shallow: the last deployed commit may not be in it. Its tree is all the comparison needs.
    try {
      const owner = env.VERCEL_GIT_REPO_OWNER;
      const repo = env.VERCEL_GIT_REPO_SLUG;
      if (env.VERCEL_GIT_PROVIDER !== "github" || !owner || !repo) return undefined;
      git("fetch", "--depth=1", `https://github.com/${owner}/${repo}.git`, previous);
      return names();
    } catch {
      return undefined;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const previous = /^[0-9a-f]{7,40}$/.test(env.VERCEL_GIT_PREVIOUS_SHA ?? "") ? env.VERCEL_GIT_PREVIOUS_SHA : undefined;
  const ref = env.VERCEL_GIT_COMMIT_REF;
  const { build, why } = decide({ ref, previous, changed: ref === "main" && previous ? changedSince(previous, env) : undefined });
  console.log(`${build ? "Building" : "Skipping the build"}: ${why}.`);
  process.exit(build ? 1 : 0);
}
