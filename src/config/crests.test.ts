import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import type { Team } from "../engine/types.ts";
import { cornerAlphas, seeThrough } from "../lib/testdata/crests.ts";
import { CREST_FALLBACKS, withFallbackCrests } from "./crests.ts";
import { CREST_CUTOUTS } from "./crestCutouts.ts";

const ROOT = join(import.meta.dirname, "../..");
const rochdale = CREST_CUTOUTS[303]!;

describe("crests that come with a background", () => {
  it("shows Rochdale's crest cut out of its white square", () => {
    const [team] = withFallbackCrests([{ id: 303, name: "Rochdale", shortName: "Rochdale", tla: "ROC", crest: rochdale.from }]);
    assert.equal(team!.crest, "/crests/cutout/303.png");
  });

  it("keeps a club's new crest from the feed, and leaves every other club's alone", () => {
    const changed = "https://a.espncdn.com/i/teamlogos/soccer/500/303-new.png";
    const fallback = Number(Object.keys(CREST_FALLBACKS)[0]);
    const teams: Team[] = [
      { id: 303, name: "Rochdale", shortName: "Rochdale", tla: "ROC", crest: changed },
      { id: 359, name: "Arsenal", shortName: "Arsenal", tla: "ARS", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/359.png" },
      { id: fallback, name: "Fallback", shortName: "Fallback", tla: "FAL" },
    ];
    assert.deepEqual(
      withFallbackCrests(teams).map((t) => t.crest),
      [changed, "https://a.espncdn.com/i/teamlogos/soccer/500/359.png", CREST_FALLBACKS[fallback]],
    );
  });

  it("has every cut-out saved: a transparent PNG, nothing see-through inside the crest", async () => {
    assert.ok(Object.keys(CREST_CUTOUTS).length > 0);
    for (const [id, cutout] of Object.entries(CREST_CUTOUTS)) {
      assert.equal(cutout.crest, `/crests/cutout/${id}.png`);
      const file = join(ROOT, "public", cutout.crest);
      assert.ok(existsSync(file), file);
      assert.ok(existsSync(join(ROOT, "scripts/data/crest-originals", `${id}.png`)), `${id}: original kept`);
      const { data, info } = await sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual(cornerAlphas(data, info.width, info.height), [0, 0, 0, 0], id);
      assert.ok(seeThrough(data, info.width, info.height) < 0.01, `${id}: holes in the crest`);
    }
  });
});
