/**
 * Past Winners: every season's champion, runner-up and third place of a league,
 * FootSimu's own data (src/data/history/<league-slug>.json, one file per league,
 * compiled from RSSSF and Wikipedia). This is the pure part, shared by the
 * league pages and My World: the file format and its checks, and the rows the
 * PastWinners component shows. The files themselves are read on the server by
 * src/lib/winnersData.ts; My World's own seasons join the rows in
 * src/lib/worldWinners.ts.
 */

export type WinnerStatus = "completed" | "not_held" | "abandoned";
export type WinnerFormat = "league" | "final" | "playoff";
const STATUSES: readonly string[] = ["completed", "not_held", "abandoned"];
const FORMATS: readonly string[] = ["league", "final", "playoff"];

/** A placing in a history file: the club as it was named that season, and as it is known today. */
export interface HistoryPlacing {
  name: string;
  currentName: string;
  /** The club's ESPN id, the id the site uses for it; null for a club the site has never had. */
  footsimuId: number | null;
  footsimuSlug: string | null;
  footsimuPath: string | null;
  /** Final points, after any deduction; null when not known or not applicable (a final). */
  points: number | null;
  /** Other clubs level in the same place (a shared position, as Italian tables list them); only on such placings. */
  tiedWith?: HistoryPlacing[];
}

/** One season of a history file; a season with several champions (North and South, Apertura and Clausura) is one row per tournament. */
export interface HistorySeason {
  /** "1888-89", or "2025" for a calendar-year season. */
  season: string;
  startYear: number;
  /** The tournament this row is for, when the season had more than one champion; else null. */
  tournament: string | null;
  status: WinnerStatus;
  /** The competition's name at the time (the era): "Football League First Division", "Premier League". */
  competition: string;
  format: WinnerFormat;
  notes: string[];
  champion: HistoryPlacing | null;
  runnerUp: HistoryPlacing | null;
  third: HistoryPlacing | null;
  /** The club that finished first but had the title revoked and not reassigned (the champion is null then). */
  strippedChampion?: HistoryPlacing | null;
}

export interface LeagueHistory {
  league: string;
  footsimuSlug: string;
  footsimuCode: string;
  country: string;
  /** Oldest first, as in the file. */
  seasons: HistorySeason[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const SEASON = /^\d{4}(-\d{2})?$/;

function placing(value: unknown, where: string, tied = true): HistoryPlacing | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error(`${where} must be an object or null`);
  if (!isText(value.name) || !isText(value.currentName)) throw new Error(`${where} needs a name and a currentName`);
  if (value.footsimuId !== null && !(isInt(value.footsimuId) && value.footsimuId > 0)) throw new Error(`${where}: footsimuId must be a positive integer or null`);
  if (value.footsimuSlug !== null && !isText(value.footsimuSlug)) throw new Error(`${where}: footsimuSlug must be text or null`);
  if (value.footsimuPath !== null && !(isText(value.footsimuPath) && value.footsimuPath.startsWith("/"))) throw new Error(`${where}: footsimuPath must be a path or null`);
  if (value.points !== null && !(isInt(value.points) && value.points >= 0)) throw new Error(`${where}: points must be a whole number or null`);
  const out: HistoryPlacing = { name: value.name, currentName: value.currentName, footsimuId: value.footsimuId, footsimuSlug: value.footsimuSlug, footsimuPath: value.footsimuPath, points: value.points };
  if (value.tiedWith !== undefined) {
    if (!tied || !Array.isArray(value.tiedWith) || value.tiedWith.length === 0) throw new Error(`${where}: tiedWith must be a non-empty list of placings`);
    out.tiedWith = value.tiedWith.map((v, i) => placing(v, `${where} tiedWith ${i + 1}`, false)!);
    if (out.tiedWith.some((p) => p === null)) throw new Error(`${where}: tiedWith must be a non-empty list of placings`);
  }
  return out;
}

/** A placing and the clubs level with it. */
const withTied = (p: HistoryPlacing | null | undefined): HistoryPlacing[] => (p ? [p, ...(p.tiedWith ?? [])] : []);

/**
 * A history file, checked field by field (every file is checked at build and
 * test time): throws naming the file and the season when something is wrong.
 * Seasons must be oldest first, listed once (per tournament). A completed
 * season needs a champion, or the club whose title was revoked and not
 * reassigned (strippedChampion); the runner-up can be missing only when the
 * final round was never finished, and the third place is optional. A season
 * not held or abandoned has no placings. A placing can list the clubs level
 * with it (tiedWith). The same club can't take two places.
 */
export function parseLeagueHistory(value: unknown, file = "history"): LeagueHistory {
  if (!isRecord(value)) throw new Error(`${file}: not an object`);
  for (const key of ["league", "footsimuSlug", "footsimuCode", "country"] as const) if (!isText(value[key])) throw new Error(`${file}: ${key} must be text`);
  if (!Array.isArray(value.seasons) || value.seasons.length === 0) throw new Error(`${file}: seasons must be a non-empty list`);
  const seasons: HistorySeason[] = [];
  const seen = new Set<string>();
  value.seasons.forEach((s, i) => {
    if (!isRecord(s)) throw new Error(`${file}: season ${i + 1} is not an object`);
    if (!isText(s.season) || !SEASON.test(s.season)) throw new Error(`${file}: season ${i + 1} must be labelled like "1888-89" or "2025"`);
    const where = `${file}: ${s.season}`;
    if (!isInt(s.startYear) || !s.season.startsWith(String(s.startYear))) throw new Error(`${where}: startYear must be the season's first year`);
    if (s.tournament !== null && !isText(s.tournament)) throw new Error(`${where}: tournament must be text or null`);
    if (typeof s.status !== "string" || !STATUSES.includes(s.status)) throw new Error(`${where}: status must be completed, not_held or abandoned`);
    if (!isText(s.competition)) throw new Error(`${where}: competition must be text`);
    if (typeof s.format !== "string" || !FORMATS.includes(s.format)) throw new Error(`${where}: format must be league, final or playoff`);
    if (!Array.isArray(s.notes) || !s.notes.every(isText)) throw new Error(`${where}: notes must be a list of text`);
    const champion = placing(s.champion, `${where} champion`);
    const runnerUp = placing(s.runnerUp, `${where} runnerUp`);
    const third = placing(s.third, `${where} third`);
    const stripped = s.strippedChampion === undefined ? null : placing(s.strippedChampion, `${where} strippedChampion`, false);
    if (s.status === "completed") {
      // A title revoked and not reassigned leaves no champion; a final round cut short can leave no runner-up.
      if (!champion && !stripped) throw new Error(`${where}: a completed season needs a champion (or a revoked one)`);
      if (champion && stripped) throw new Error(`${where}: a revoked title (strippedChampion) leaves no champion`);
      if (!runnerUp && third) throw new Error(`${where}: a third place needs a runner-up`);
    } else if (champion || runnerUp || third || stripped) {
      throw new Error(`${where}: a season ${s.status} has no placings`);
    }
    const ids = [stripped, champion, runnerUp, third].flatMap(withTied).map((p) => p.footsimuId ?? `name:${fold(p.currentName)}`);
    if (new Set(ids).size !== ids.length) throw new Error(`${where}: the same club in two places`);
    const key = `${s.season}|${s.tournament ?? ""}`;
    if (seen.has(key)) throw new Error(`${where}: listed twice`);
    seen.add(key);
    const previous = seasons.at(-1);
    if (previous && previous.startYear > s.startYear) throw new Error(`${where}: seasons must be oldest first`);
    seasons.push({
      season: s.season,
      startYear: s.startYear,
      tournament: s.tournament as string | null,
      status: s.status as WinnerStatus,
      competition: s.competition,
      format: s.format as WinnerFormat,
      notes: [...(s.notes as string[])],
      champion,
      runnerUp,
      third,
      ...(stripped ? { strippedChampion: stripped } : {}),
    });
  });
  return { league: value.league as string, footsimuSlug: value.footsimuSlug as string, footsimuCode: value.footsimuCode as string, country: value.country as string, seasons };
}

/** Lower case, without accents: for club searches and keys. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** The year a season ends: "1888-89" → 1889, "2025" → 2025. */
export const seasonEndYear = (season: string, startYear: number) => (season.includes("-") ? startYear + 1 : startYear);

/** A club in a Past Winners row: its name that season, the club it is today, and how to draw its badge. */
export interface WinnerClub {
  /** What a club's titles add up under: "espn:364" for a real club (its current self), "world:12" for a My World club without a real counterpart. */
  key: string;
  id: number | null;
  name: string;
  currentName: string;
  crest: string | null;
  /** A My World club's code, for the site's badge disc when it has no crest. */
  tla: string | null;
  points: number | null;
  /** Other clubs level in the same place (a shared position). */
  tiedWith?: WinnerClub[];
}

export interface WinnerRow {
  id: string;
  season: string;
  startYear: number;
  endYear: number;
  tournament: string | null;
  status: WinnerStatus;
  competition: string;
  format: WinnerFormat;
  notes: string[];
  champion: WinnerClub | null;
  runnerUp: WinnerClub | null;
  third: WinnerClub | null;
  /** The club whose title was revoked and not reassigned (no champion that season). */
  stripped?: WinnerClub | null;
  /** A season played in My World, not a real one. */
  world: boolean;
}

/** What a placing's titles count under: the club as it is today. */
export const clubKey = (p: HistoryPlacing) => (p.footsimuId !== null ? `espn:${p.footsimuId}` : `name:${fold(p.currentName)}`);

/**
 * A history's rows, newest first, with each club's badge from `crest`. Two
 * seasons starting the same year go by the year they end (La Liga's first,
 * "1929", before "1929-30"); a season's tournaments keep the file's order.
 */
export function winnerRows(history: LeagueHistory, crest: (id: number | null, currentName: string) => string | null): WinnerRow[] {
  const club = (p: HistoryPlacing | null | undefined): WinnerClub | null => {
    if (!p) return null;
    const out: WinnerClub = { key: clubKey(p), id: p.footsimuId, name: p.name, currentName: p.currentName, crest: crest(p.footsimuId, p.currentName), tla: null, points: p.points };
    if (p.tiedWith) out.tiedWith = p.tiedWith.map((t) => club(t)!);
    return out;
  };
  return history.seasons
    .map((s, index) => ({ s, index }))
    .sort((a, b) => b.s.startYear - a.s.startYear || seasonEndYear(b.s.season, b.s.startYear) - seasonEndYear(a.s.season, a.s.startYear) || a.index - b.index)
    .map(({ s }) => ({
      id: `${s.season}${s.tournament ? `-${fold(s.tournament).replace(/\s+/g, "-")}` : ""}`,
      season: s.season,
      startYear: s.startYear,
      endYear: seasonEndYear(s.season, s.startYear),
      tournament: s.tournament,
      status: s.status,
      competition: s.competition,
      format: s.format,
      notes: s.notes,
      champion: club(s.champion),
      runnerUp: club(s.runnerUp),
      third: club(s.third),
      ...(s.strippedChampion ? { stripped: club(s.strippedChampion) } : {}),
      world: false,
    }));
}

/** A name the competition went by, and its years: "Football League First Division", 1892–1992; the current name is open-ended (to null). */
export interface Era {
  name: string;
  from: number;
  to: number | null;
}

/** The competition's names over time, oldest first, from the real seasons (My World's seasons belong to the current name). */
export function eras(rows: readonly WinnerRow[]): Era[] {
  const out: Era[] = [];
  // Seasons not played don't name an era (France's war years are listed as "Division 1" between two
  // stretches of the "French championship"): they belong to the era around them (inEra).
  const real = rows.filter((x) => !x.world && x.status === "completed").sort((a, b) => a.startYear - b.startYear || a.endYear - b.endYear);
  for (let i = 0; i < real.length; ) {
    let j = i;
    while (j < real.length && real[j]!.season === real[i]!.season) j++;
    const parallel = j - i > 1;
    for (const r of real.slice(i, j)) {
      // A name goes on from the latest era; in a season of parallel championships under different names
      // (Italy's 1921-22, Brazil's Taça Brasil and Robertão in 1967 and 1968), also from an era that ran up
      // to the season before, so each keeps its own era and the two overlap.
      const last = out.at(-1);
      const going = last?.name === r.competition ? last : parallel ? [...out].reverse().find((e) => e.name === r.competition && e.to !== null && e.to >= r.startYear - 1) : undefined;
      if (going) going.to = r.endYear;
      else out.push({ name: r.competition, from: r.startYear, to: r.endYear });
    }
    i = j;
  }
  const last = out.at(-1);
  if (last) last.to = null;
  return out;
}

/** Is a row in an era: the same competition name (any, for a season not played), within its years (an open era takes everything since). */
export const inEra = (row: WinnerRow, era: Era) =>
  (row.status !== "completed" || row.competition === era.name) && row.startYear >= era.from && (era.to === null || row.endYear <= era.to);

export const decadeOf = (year: number) => Math.floor(year / 10) * 10;

/** The decades the rows span, newest first. */
export const decades = (rows: readonly WinnerRow[]) => [...new Set(rows.map((r) => decadeOf(r.startYear)))].sort((a, b) => b - a);

/** A club's titles, for the "Most titles" summary. */
export interface TitleCount {
  key: string;
  id: number | null;
  name: string;
  crest: string | null;
  tla: string | null;
  titles: number;
}

/** The clubs with most titles (My World's seasons count too, under the real club when it is one), most first, then by name. */
export function mostTitles(rows: readonly WinnerRow[], limit = 5): TitleCount[] {
  const counts = new Map<string, TitleCount>();
  for (const r of [...rows].sort((a, b) => b.startYear - a.startYear)) {
    const c = r.champion;
    if (!c) continue;
    const current = counts.get(c.key);
    if (current) current.titles++;
    else counts.set(c.key, { key: c.key, id: c.id, name: c.currentName, crest: c.crest, tla: c.tla, titles: 1 });
  }
  return [...counts.values()].sort((a, b) => b.titles - a.titles || a.name.localeCompare(b.name)).slice(0, limit);
}

export interface WinnersFilter {
  era?: Era | null;
  decade?: number | null;
  /** A club's name, any part of it, as named that season or today. */
  query?: string;
}

/** Every club a row names: its placings, the clubs level with them and a revoked champion. */
export const rowClubs = (r: WinnerRow): WinnerClub[] => [r.stripped, r.champion, r.runnerUp, r.third].flatMap((c) => (c ? [c, ...(c.tiedWith ?? [])] : []));

/** The rows an era or decade chip and a club search leave (a search leaves out the seasons without placings). */
export function filterRows(rows: readonly WinnerRow[], filter: WinnersFilter): WinnerRow[] {
  const q = fold(filter.query ?? "");
  return rows.filter(
    (r) =>
      (!filter.era || inEra(r, filter.era)) &&
      (filter.decade === undefined || filter.decade === null || decadeOf(r.startYear) === filter.decade) &&
      (!q || rowClubs(r).some((c) => fold(c.name).includes(q) || fold(c.currentName).includes(q))),
  );
}
