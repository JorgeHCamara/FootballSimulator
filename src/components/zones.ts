import type { ZoneKind } from "../config/leagues.ts";

// Literal Tailwind class strings so Tailwind can see them at build time.
// `row` tints a whole table row (and the legend swatch); `dot` is the strong
// colour used in the chances heatmap.
export const ZONE_STYLES: Record<ZoneKind, { row: string; dot: string }> = {
  championsLeague: { row: "bg-blue-100 dark:bg-blue-900/45", dot: "bg-blue-600" },
  championsLeagueQualifying: { row: "bg-sky-50 dark:bg-sky-700/35", dot: "bg-sky-400" },
  europaLeague: { row: "bg-orange-100 dark:bg-orange-900/40", dot: "bg-orange-500" },
  conferenceLeague: { row: "bg-emerald-100 dark:bg-emerald-900/40", dot: "bg-emerald-500" },
  libertadores: { row: "bg-blue-100 dark:bg-blue-900/45", dot: "bg-blue-600" },
  libertadoresQualifying: { row: "bg-sky-50 dark:bg-sky-700/35", dot: "bg-sky-400" },
  sudamericana: { row: "bg-emerald-100 dark:bg-emerald-900/40", dot: "bg-emerald-500" },
  promotion: { row: "bg-emerald-100 dark:bg-emerald-900/40", dot: "bg-emerald-500" },
  promotionPlayoff: { row: "bg-sky-50 dark:bg-sky-700/35", dot: "bg-sky-400" },
  relegationPlayoff: { row: "bg-amber-100 dark:bg-amber-900/40", dot: "bg-amber-500" },
  relegation: { row: "bg-red-100 dark:bg-red-900/40", dot: "bg-red-600" },
  playoffs: { row: "bg-blue-100 dark:bg-blue-900/45", dot: "bg-blue-600" },
  playoffWildCard: { row: "bg-sky-50 dark:bg-sky-700/35", dot: "bg-sky-400" },
  title: { row: "bg-yellow-100 dark:bg-yellow-900/35", dot: "bg-yellow-500" },
  aclElite: { row: "bg-blue-100 dark:bg-blue-900/45", dot: "bg-blue-600" },
  aclEliteQualifying: { row: "bg-sky-50 dark:bg-sky-700/35", dot: "bg-sky-400" },
  aclTwo: { row: "bg-orange-100 dark:bg-orange-900/40", dot: "bg-orange-500" },
  gulfClub: { row: "bg-teal-50 dark:bg-teal-900/35", dot: "bg-teal-500" },
  splitTitle: { row: "bg-blue-100 dark:bg-blue-900/45", dot: "bg-blue-600" },
  splitMiddle: { row: "bg-emerald-100 dark:bg-emerald-900/40", dot: "bg-emerald-500" },
  splitRelegation: { row: "bg-red-50 dark:bg-red-950/40", dot: "bg-red-400" },
  titlePlayoffs: { row: "bg-blue-100 dark:bg-blue-900/45", dot: "bg-blue-600" },
  knockoutRoundOf16: { row: "bg-blue-100 dark:bg-blue-900/45", dot: "bg-blue-600" },
  knockoutPlayoff: { row: "bg-sky-50 dark:bg-sky-700/35", dot: "bg-sky-400" },
  eliminated: { row: "bg-red-50 dark:bg-red-950/40", dot: "bg-red-400" },
};
