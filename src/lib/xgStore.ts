import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { xgByFixture, type GameXg, type XgFile } from "./xg.ts";

const files = new Map<string, Promise<Record<number, GameXg>>>();

/**
 * A league's stored xG (src/data/xg/<CODE>.json) by ESPN game id, leaving out
 * games without it; empty when the league has no file. Read once per server:
 * the files only change with a deploy.
 */
export function readXg(code: string): Promise<Record<number, GameXg>> {
  let file = files.get(code);
  if (!file) {
    file = readFile(join(process.cwd(), "src/data/xg", `${code}.json`), "utf8").then(
      (text) => xgByFixture(JSON.parse(text) as XgFile),
      () => ({}),
    );
    files.set(code, file);
  }
  return file;
}
