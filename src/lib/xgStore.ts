import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fresher, readPublished } from "./publishedData.ts";
import { xgByFixture, type GameXg, type XgFile } from "./xg.ts";

const files = new Map<string, Promise<XgFile | undefined>>();

/** A league's xG file as the deployment was built with it (read once per server). */
function bundledXg(code: string): Promise<XgFile | undefined> {
  let file = files.get(code);
  if (!file) {
    file = readFile(join(process.cwd(), "src/data/xg", `${code}.json`), "utf8").then(
      (text) => JSON.parse(text) as XgFile,
      () => undefined,
    );
    files.set(code, file);
  }
  return file;
}

/** How much an xG file holds: its games with xG, then its games (the files only grow, so more is newer). */
export function xgStamp(file: XgFile): number {
  const games = Object.values(file.matches ?? {});
  return games.filter(Boolean).length * 1_000_000 + games.length;
}

const isXg = (file: XgFile | null | undefined): file is XgFile => Boolean(file && typeof file === "object" && file.matches && typeof file.matches === "object");

/**
 * A league's stored xG (src/data/xg/<CODE>.json) by ESPN game id, leaving out
 * games without it; empty when the league has no file. The published file
 * (main's, through the data cache: src/lib/publishedData.ts), or the one the
 * deployment was built with when that holds more or the published one can't
 * be read. A page that reads it is tagged with the league's xG tag: new xG
 * rebuilds the league's pages, whose chances it changes (see dataVersion).
 */
export async function readXg(code: string): Promise<Record<number, GameXg>> {
  const [bundled, published] = await Promise.all([bundledXg(code), readPublished<XgFile>("xg", code)]);
  const file = published?.file;
  return xgByFixture(fresher(bundled, file === null || isXg(file) ? file : undefined, xgStamp));
}
