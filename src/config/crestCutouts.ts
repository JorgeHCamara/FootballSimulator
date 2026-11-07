// Crests that come with a background (a flat square behind the crest), cut out as
// transparent PNGs by scripts/crest-backgrounds.ts, keyed by ESPN team id. A
// club shows its cut-out only while its crest is still `from` (a new crest
// from the feed shows as it is until the script runs again). Regenerate:
//   npm run crests:backgrounds

export interface CrestCutout {
  /** The crest it was made from (the feed's URL, or a saved fallback's path). */
  from: string;
  /** The cut-out, served by the site. */
  crest: string;
}

export const CREST_CUTOUTS: Readonly<Record<number, CrestCutout>> = {
  303: { from: "https://a.espncdn.com/i/teamlogos/soccer/500/303.png", crest: "/crests/cutout/303.png" }, // Rochdale
};
