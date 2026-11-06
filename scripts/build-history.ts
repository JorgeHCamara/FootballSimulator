// Past final tables for the quiz (src/lib/quiz.ts): every finished season since
// 2015 of the leagues whose table decides the champion, from ESPN's official
// standings (its final order, deductions and tiebreakers included), written to
// src/data/history.json. Run it again after a season ends:
//
//   npm run history
//
// Per season: the final table (club id, name, points), the clubs relegated
// directly (ESPN's "Relegation"/"Relegated" notes; when a season has no notes
// at all, the league's relegation places from its config, if it had as many
// clubs as now) and the champion (none when ESPN says none was named: the
// 2019/20 Eredivisie). Club names go through the site's own overrides.

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLeagueByCode, type LeagueConfig } from "../src/config/leagues.ts";
import { applyTeamOverrides } from "../src/config/teamOverrides.ts";
import type { Team } from "../src/engine/types.ts";
import { HISTORY_LEAGUES, type HistoryFile, type HistorySeason } from "../src/lib/history.ts";
import { currentSeasonYear } from "../src/lib/leagueData.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../src/data/history.json");
const FIRST_YEAR = 2015;

interface EspnStandings {
  children?: {
    standings?: {
      seasonDisplayName?: string;
      entries?: { team: { id: string; displayName: string; shortDisplayName?: string; abbreviation?: string }; note?: { description?: string }; stats: { name: string; value?: number }[] }[];
    };
  }[];
}

async function season(league: LeagueConfig, year: number): Promise<HistorySeason | undefined> {
  const res = await fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${league.espn.slug}/standings?season=${year}`);
  if (!res.ok) throw new Error(`${league.code} ${year}: HTTP ${res.status}`);
  const table = ((await res.json()) as EspnStandings).children?.[0]?.standings;
  const entries = table?.entries ?? [];
  if (entries.length < 10) return undefined;
  const stat = (e: (typeof entries)[number], name: string) => e.stats.find((s) => s.name === name)?.value;
  const rows = [...entries].sort((a, b) => (stat(a, "rank") ?? 99) - (stat(b, "rank") ?? 99));
  const teams = applyTeamOverrides(
    rows.map((e): Team => ({ id: Number(e.team.id), name: e.team.displayName, shortName: e.team.shortDisplayName ?? e.team.displayName, tla: e.team.abbreviation ?? "" })),
    { league: league.code },
  );
  const notes = rows.map((e) => e.note?.description?.trim() ?? "");
  const noNotes = notes.every((n) => !n);
  const relegationPlaces = league.zones.filter((z) => z.kind === "relegation");
  const relegated = noNotes
    ? rows.length === league.teams
      ? teams.filter((_, i) => relegationPlaces.some((z) => i + 1 >= z.from && i + 1 <= z.to)).map((t) => t.id)
      : []
    : teams.filter((_, i) => /^relegat(ion|ed)$/i.test(notes[i]!)).map((t) => t.id);
  const unnamed = /not named/i.test(notes[0] ?? "");
  return {
    year,
    label: league.espn.seasons === "split" ? `${year}/${String(year + 1).slice(2)}` : String(year),
    table: teams.map((t, i) => [t.id, t.name, stat(rows[i]!, "points") ?? 0]),
    relegated,
    champion: unnamed ? null : teams[0]!.id,
  };
}

const out: HistoryFile = { leagues: {} };
for (const code of HISTORY_LEAGUES) {
  const league = getLeagueByCode(code)!;
  const seasons: HistorySeason[] = [];
  for (let year = FIRST_YEAR; year < currentSeasonYear(league); year++) {
    const s = await season(league, year).catch((error: unknown) => {
      console.warn(String(error));
      return undefined;
    });
    if (s) seasons.push(s);
  }
  out.leagues[code] = seasons;
  console.log(`${code}: ${seasons.length} seasons (${seasons[0]?.label}–${seasons.at(-1)?.label}); champions ${seasons.map((s) => s.table.find((r) => r[0] === s.champion)?.[1] ?? "none").join(", ")}`);
}
// One season per line: a new season is a one-line diff.
const body = Object.entries(out.leagues)
  .map(([code, seasons]) => `    ${JSON.stringify(code)}: [\n${seasons.map((s) => `      ${JSON.stringify(s)}`).join(",\n")}\n    ]`)
  .join(",\n");
await writeFile(OUT, `{\n  "leagues": {\n${body}\n  }\n}\n`);
console.log(`Written: src/data/history.json`);
