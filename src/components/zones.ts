import type { ZoneKind } from "../config/leagues.ts";

// `row` tints a whole table row (and the legend swatch): a short class each
// (src/app/globals.css, the same Tailwind colours), as tables repeat it on every
// row and cell. `dot` is the strong colour used in the chances heatmap: literal
// Tailwind classes, so Tailwind can see them at build time.
export const ZONE_STYLES: Record<ZoneKind, { row: string; dot: string }> = {
  championsLeague: { row: "zone-blue", dot: "bg-blue-600" },
  championsLeagueQualifying: { row: "zone-sky", dot: "bg-sky-400" },
  europaLeague: { row: "zone-orange", dot: "bg-orange-500" },
  conferenceLeague: { row: "zone-emerald", dot: "bg-emerald-500" },
  libertadores: { row: "zone-blue", dot: "bg-blue-600" },
  libertadoresQualifying: { row: "zone-sky", dot: "bg-sky-400" },
  sudamericana: { row: "zone-emerald", dot: "bg-emerald-500" },
  promotion: { row: "zone-emerald", dot: "bg-emerald-500" },
  promotionPlayoff: { row: "zone-sky", dot: "bg-sky-400" },
  relegationPlayoff: { row: "zone-amber", dot: "bg-amber-500" },
  relegation: { row: "zone-red", dot: "bg-red-600" },
  playoffs: { row: "zone-blue", dot: "bg-blue-600" },
  playoffWildCard: { row: "zone-sky", dot: "bg-sky-400" },
  title: { row: "zone-yellow", dot: "bg-yellow-500" },
  aclElite: { row: "zone-blue", dot: "bg-blue-600" },
  aclEliteQualifying: { row: "zone-sky", dot: "bg-sky-400" },
  aclTwo: { row: "zone-orange", dot: "bg-orange-500" },
  gulfClub: { row: "zone-teal", dot: "bg-teal-500" },
  splitTitle: { row: "zone-blue", dot: "bg-blue-600" },
  splitMiddle: { row: "zone-emerald", dot: "bg-emerald-500" },
  splitRelegation: { row: "zone-red-soft", dot: "bg-red-400" },
  championshipPlayoffs: { row: "zone-blue", dot: "bg-blue-600" },
  europePlayoffs: { row: "zone-emerald", dot: "bg-emerald-500" },
  relegationPlayouts: { row: "zone-red-soft", dot: "bg-red-400" },
  championshipGroup: { row: "zone-blue", dot: "bg-blue-600" },
  qualificationGroup: { row: "zone-red-soft", dot: "bg-red-400" },
  conferenceLeaguePlayoff: { row: "zone-teal", dot: "bg-teal-500" },
  titlePlayoffs: { row: "zone-blue", dot: "bg-blue-600" },
  promotionFinal: { row: "zone-yellow", dot: "bg-yellow-500" },
  semifinalGroups: { row: "zone-blue", dot: "bg-blue-600" },
  tournamentFinal: { row: "zone-yellow", dot: "bg-yellow-500" },
  promotionContention: { row: "zone-sky", dot: "bg-sky-400" },
  knockoutRoundOf16: { row: "zone-blue", dot: "bg-blue-600" },
  knockoutPlayoff: { row: "zone-sky", dot: "bg-sky-400" },
  eliminated: { row: "zone-red-soft", dot: "bg-red-400" },
};

/** Hex values of the zone colours (Tailwind's), for images drawn without CSS (the share card). */
const DOT_HEX: Record<string, string> = {
  "bg-amber-500": "#f59e0b",
  "bg-blue-600": "#2563eb",
  "bg-emerald-500": "#10b981",
  "bg-orange-500": "#f97316",
  "bg-red-400": "#f87171",
  "bg-red-600": "#dc2626",
  "bg-sky-400": "#38bdf8",
  "bg-teal-500": "#14b8a6",
  "bg-yellow-500": "#eab308",
};

/** A zone's strong colour as hex: the same as its dot in the chances table. */
export function zoneHex(kind: ZoneKind): string {
  return DOT_HEX[ZONE_STYLES[kind].dot] ?? "#71717a";
}
