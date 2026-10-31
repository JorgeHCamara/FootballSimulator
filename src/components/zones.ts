import type { ZoneKind } from "../config/leagues.ts";

// Literal class strings so Tailwind can see them at build time.
export const ZONE_STYLES: Record<ZoneKind, { dot: string; bar: string }> = {
  championsLeague: { dot: "bg-blue-600 text-white", bar: "border-l-blue-600" },
  championsLeagueQualifying: { dot: "bg-sky-400 text-white", bar: "border-l-sky-400" },
  europaLeague: { dot: "bg-orange-500 text-white", bar: "border-l-orange-500" },
  conferenceLeague: { dot: "bg-emerald-500 text-white", bar: "border-l-emerald-500" },
  libertadores: { dot: "bg-blue-600 text-white", bar: "border-l-blue-600" },
  libertadoresQualifying: { dot: "bg-sky-400 text-white", bar: "border-l-sky-400" },
  sudamericana: { dot: "bg-emerald-500 text-white", bar: "border-l-emerald-500" },
  relegationPlayoff: { dot: "bg-amber-500 text-white", bar: "border-l-amber-500" },
  relegation: { dot: "bg-red-600 text-white", bar: "border-l-red-600" },
};
