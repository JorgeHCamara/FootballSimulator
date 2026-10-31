import type { ZoneKind } from "../config/leagues.ts";

// `dot` uses literal Tailwind class strings so Tailwind can see them at build time.
// `color` is the same colour as a hex value, for inline styles (the row accent bar).
export const ZONE_STYLES: Record<ZoneKind, { dot: string; color: string }> = {
  championsLeague: { dot: "bg-blue-600 text-white", color: "#2563eb" },
  championsLeagueQualifying: { dot: "bg-sky-400 text-white", color: "#38bdf8" },
  europaLeague: { dot: "bg-orange-500 text-white", color: "#f97316" },
  conferenceLeague: { dot: "bg-emerald-500 text-white", color: "#10b981" },
  libertadores: { dot: "bg-blue-600 text-white", color: "#2563eb" },
  libertadoresQualifying: { dot: "bg-sky-400 text-white", color: "#38bdf8" },
  sudamericana: { dot: "bg-emerald-500 text-white", color: "#10b981" },
  relegationPlayoff: { dot: "bg-amber-500 text-white", color: "#f59e0b" },
  relegation: { dot: "bg-red-600 text-white", color: "#dc2626" },
};
