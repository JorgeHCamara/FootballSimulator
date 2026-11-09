// Import of the 2026 Primera B (Colombia's second division, Torneo BetPlay
// Dimayor) as the site's own data: run by hand when the data should be brought
// up to date (there is no scheduled job), and the site reads only what it
// writes, which is committed. ESPN has no 2026 Primera B games (col.2), and
// Dimayor publishes its fixtures only through licensed widgets, so the games
// come from the season's article on the Spanish Wikipedia, which lists every
// game round by round (date, time, ground, score).
//
//   npm run data:primera-b                                           # games and crests (NODE_USE_ENV_PROXY=1 node scripts/import-primera-b.ts)
//   NODE_USE_ENV_PROXY=1 node scripts/import-primera-b.ts --local    # games only; crests from the saved originals
//   node scripts/import-primera-b.ts --local --wikitext saved.wiki    # from a saved copy of the article
//
// It writes src/data/primera-b/2026.json (the clubs, every game of both
// tournaments, and the article's own tables, to check the data against) and
// each club's crest to public/crests/primera-b/{id}.png, from the originals
// kept in scripts/data/primera-b-crests: ESPN's crest of each club (as the
// site shows ESPN's clubs), and Independiente Valle del Cauca's, which ESPN
// doesn't have, from the club's own X account (its crest since the July 2026
// rename), cut out of its white square (scripts/crest-backgrounds.ts).
//
// The rules the data follows (Dimayor's Reglamento Torneo BetPlay 2026) are in
// the league's config (src/config/leagues.ts, code COLB).

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { cutOut } from "./crest-backgrounds.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/data/primera-b/2026.json");
const ORIGINALS = join(ROOT, "scripts/data/primera-b-crests");
const CRESTS = join(ROOT, "public/crests/primera-b");
const ARTICLE = "Primera B 2026 (Colombia)";
const WIKI = "https://es.wikipedia.org/w/api.php";
/** Wikimedia asks every client to say who it is. */
const HEADERS = { "User-Agent": "FootSimu-importer/1.0 (https://footsimu.com)" };
const YEAR = 2026;
const CREST_SIZE = 160;

/**
 * The clubs, by ESPN's id (the crest's), with the names the article uses for
 * them. Independiente Valle del Cauca is Atlético Huila's licence (ESPN's
 * 5482), moved to Yumbo as Independiente Yumbo for the first tournament and
 * renamed in July.
 */
const CLUBS: { id: number; name: string; shortName?: string; tla: string; wiki: string[]; crest: string }[] = [
  { id: 17370, name: "Atlético FC", tla: "ATL", wiki: ["Atlético F. C."], crest: espn(17370) },
  { id: 17373, name: "Barranquilla FC", tla: "BAR", wiki: ["Barranquilla F. C."], crest: espn(17373) },
  { id: 17372, name: "Boca Juniors de Cali", tla: "BOC", wiki: ["Boca Juniors de Cali"], crest: espn(17372) },
  { id: 17371, name: "Bogotá FC", tla: "BOG", wiki: ["Bogotá F. C."], crest: espn(17371) },
  { id: 5487, name: "Deportes Quindío", tla: "QUI", wiki: ["Deportes Quindío"], crest: espn(5487) },
  { id: 5481, name: "Envigado", tla: "ENV", wiki: ["Envigado F. C.", "Envigado"], crest: espn(5481) },
  {
    id: 5482,
    name: "Independiente Valle del Cauca",
    shortName: "Ind. Valle del Cauca",
    tla: "IVC",
    wiki: ["Independiente Valle del Cauca", "Independiente Yumbo"],
    crest: "https://pbs.twimg.com/profile_images/2073060948403761152/icqy5Bck_400x400.jpg",
  },
  { id: 22184, name: "Inter de Palmira", tla: "INT", wiki: ["Inter de Palmira"], crest: espn(22184) },
  { id: 9769, name: "Itagüí Leones", tla: "LEO", wiki: ["Itagüí Leones"], crest: espn(9769) },
  { id: 18156, name: "Orsomarso", tla: "ORS", wiki: ["Orsomarso"], crest: espn(18156) },
  { id: 9773, name: "Patriotas", tla: "PAT", wiki: ["Patriotas", "Patriotas Boyacá"], crest: espn(9773) },
  { id: 5479, name: "Real Cartagena", tla: "RCA", wiki: ["Real Cartagena"], crest: espn(5479) },
  { id: 21967, name: "Real Cundinamarca", tla: "RCU", wiki: ["Real Cundinamarca"], crest: espn(21967) },
  { id: 9774, name: "Real Santander", tla: "RSA", wiki: ["Real Santander"], crest: espn(9774) },
  { id: 9770, name: "Tigres FC", tla: "TIG", wiki: ["Tigres F. C."], crest: espn(9770) },
  { id: 17374, name: "Unión Magdalena", tla: "MAG", wiki: ["Unión Magdalena"], crest: espn(17374) },
];

function espn(id: number) {
  return `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png`;
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export interface ImportedGame {
  /** 1: Torneo I (Apertura), 2: Torneo II (Finalización); 3: the season's promotion games (grand final, play-off). */
  tournament: 1 | 2 | 3;
  /** The round robin, the groups (cuadrangulares), the tournament's final; or the grand final and the play-off (repechaje). */
  phase: "first" | "second" | "final" | "grandFinal" | "playoff";
  group?: "A" | "B";
  round: number;
  /** UTC; estimated (a few days after the round before) while Dimayor hasn't set it (`estimated`). */
  kickoff: string;
  estimated?: true;
  venue: string;
  homeId: number;
  awayId: number;
  score: { home: number; away: number } | null;
  penalties?: { home: number; away: number };
}

/** A row of one of the article's tables (Football table module): to check the games against. */
export interface ArticleRow {
  position: number;
  clubId: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

const clean = (text: string) =>
  text
    .replace(/<ref[^>]*\/>|<ref[^>]*>.*?<\/ref>/gs, "")
    .replace(/\{\{refn[^}]*\}\}/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'''?|''/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{(?:Bandera|bandera)\|[^}]*\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();

const byWikiName = new Map(CLUBS.flatMap((c) => c.wiki.map((n) => [n, c.id] as const)));
function clubId(text: string): number {
  const name = clean(text);
  const id = byWikiName.get(name);
  if (id === undefined) throw new Error(`Unknown club "${name}"`);
  return id;
}

/** "23 de enero" and "15:30", Colombian time (UTC−5, no daylight saving), as UTC. */
function kickoff(date: string, time: string): string | null {
  const m = /(\d{1,2}) de ([a-z]+)/i.exec(clean(date));
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  if (month < 0) return null;
  const t = /(\d{1,2}):(\d{2})/.exec(clean(time));
  const [hh, mm] = t ? [Number(t[1]), Number(t[2])] : [15, 0];
  return new Date(Date.UTC(YEAR, month, Number(m[1]), hh + 5, mm)).toISOString();
}

/** Splits at `sep` outside links and templates. */
function splitOutside(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === "[[" || two === "{{") {
      depth++;
      i++;
    } else if (two === "]]" || two === "}}") {
      depth = Math.max(0, depth - 1);
      i++;
    } else if (depth === 0 && text.startsWith(sep, i)) {
      out.push(text.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

interface Cell {
  text: string;
  rowspan: number;
  colspan: number;
}

function cellOf(raw: string): Cell {
  const parts = splitOutside(raw, "|");
  const attrs = parts.length > 1 && /=/.test(parts[0]!) ? parts[0]! : "";
  const text = attrs ? parts.slice(1).join("|") : raw;
  const span = (name: string) => Number(new RegExp(`${name}\\s*=\\s*"?(\\d+)`).exec(attrs)?.[1] ?? 1);
  return { text: text.trim(), rowspan: span("rowspan"), colspan: span("colspan") };
}

/** A wikitable's rows as a grid, rowspans and colspans filled in; header rows left out. */
function tableRows(table: string): string[][] {
  const rows: Cell[][] = [];
  for (const chunk of table.split(/\n\|-[^\n]*/).slice(1)) {
    const cells: Cell[] = [];
    for (const line of chunk.split("\n")) {
      if (line.startsWith("|}") || line.startsWith("!")) continue;
      if (!line.startsWith("|")) {
        // A cell's text carried onto the next line.
        if (cells.length && line.trim()) cells.at(-1)!.text += ` ${line.trim()}`;
        continue;
      }
      for (const raw of splitOutside(line.slice(1), "||")) cells.push(cellOf(raw));
    }
    if (cells.length) rows.push(cells);
  }
  const grid: string[][] = [];
  const pending: { text: string; left: number }[] = [];
  for (const cells of rows) {
    const row: string[] = [];
    let col = 0;
    const fill = () => {
      while (pending[col] && pending[col]!.left > 0) {
        row[col] = pending[col]!.text;
        pending[col]!.left--;
        col++;
      }
    };
    for (const cell of cells) {
      fill();
      for (let k = 0; k < cell.colspan; k++) {
        row[col] = cell.text;
        if (cell.rowspan > 1) pending[col] = { text: cell.text, left: cell.rowspan - 1 };
        col++;
      }
    }
    fill();
    grid.push(row);
  }
  return grid;
}

/** Every wikitable ({| … |}) in the text, nested ones on their own. */
function tables(text: string): string[] {
  const out: string[] = [];
  const stack: number[] = [];
  const lines = text.split("\n");
  let offset = 0;
  const starts: number[] = [];
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith("{|")) stack.push(i);
    else if (line.trimStart().startsWith("|}") && stack.length) {
      const from = stack.pop()!;
      out.push(lines.slice(from, i + 1).join("\n"));
    }
  });
  return out;
}

/** The text between a heading matching `from` and the next heading of the same level or higher. */
function section(text: string, from: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => from.test(l));
  if (start < 0) return "";
  const level = /^(=+)/.exec(lines[start]!)![1]!.length;
  const end = lines.findIndex((l, i) => i > start && /^(=+)[^=]/.test(l) && /^(=+)/.exec(l)![1]!.length <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

const score = (text: string) => {
  const m = /(\d+)\s*:\s*(\d+)/.exec(clean(text));
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
};

const ROUND_NAMES = ["primera", "segunda", "tercera", "cuarta", "quinta", "sexta"];

/** A tournament's round robin: the "Fecha N" tables. */
function firstPhase(text: string, tournament: 1 | 2): ImportedGame[] {
  return tables(text).flatMap((table) => {
    const round = /!\s*colspan="?\d+"?[^|\n]*\|\s*Fecha (\d+)/.exec(table)?.[1];
    if (!round) return [];
    return tableRows(table).flatMap((row) => {
      const [home, result, away, venue, date, time] = row;
      if (!home || !away || result === undefined) return [];
      const at = kickoff(date ?? "", time ?? "");
      return [game(tournament, "first", Number(round), home, result, away, venue ?? "", at)];
    });
  });
}

/** A tournament's groups: each group's results table, its rounds named ("Primera"…). */
function groups(text: string, tournament: 1 | 2): ImportedGame[] {
  return (["A", "B"] as const).flatMap((group) =>
    tables(section(text, new RegExp(`^====\\s*Grupo ${group}\\s*====`))).flatMap((table) => {
      if (!/Jornada/.test(table) || !/Local/.test(table)) return [];
      return tableRows(table).flatMap((row) => {
        const [roundName, home, result, away, venue, date, time] = row;
        const round = ROUND_NAMES.indexOf(clean(roundName ?? "").toLowerCase()) + 1;
        if (!round || !home || !away) return [];
        return [{ ...game(tournament, "second", round, home, result ?? "", away, venue ?? "", kickoff(date ?? "", time ?? "")), group }];
      });
    }),
  );
}

/** {{Partido}} templates: a final's legs (and the season's grand final and play-off). */
function matches(text: string, tournament: 1 | 2 | 3, phase: ImportedGame["phase"]): ImportedGame[] {
  return [...text.matchAll(/\{\{Partido\b([\s\S]*?)\n\}\}/g)].map(([, body], i) => {
    const param = (name: string) => new RegExp(`\\|\\s*${name}\\s*=\\s*(.*)`).exec(body!)?.[1] ?? "";
    const home = param("local").replace(/\{\{[^}]*\}\}/g, "");
    const away = param("visita").replace(/\{\{[^}]*\}\}/g, "");
    const date = /\{\{fecha\|(\d+)\|(\d+)\|(\d+)\}\}/.exec(param("fecha"));
    const time = /(\d{1,2}):(\d{2})/.exec(param("hora"));
    const at = date ? new Date(Date.UTC(Number(date[3]), Number(date[2]) - 1, Number(date[1]), (time ? Number(time[1]) : 15) + 5, time ? Number(time[2]) : 0)).toISOString() : null;
    // The result before any half-time score in brackets.
    const result = param("resultado").split("(")[0]!;
    const g = game(tournament, phase, i + 1, home, result, away, clean(param("estadio")).replace(/^Estadio /, ""), at);
    const pens = /(\d+)\s*:\s*(\d+)/.exec(clean(param("penaltis") || param("penales") || param("penales_resultado")));
    return pens && g.score ? { ...g, penalties: { home: Number(pens[1]), away: Number(pens[2]) } } : g;
  });
}

function game(tournament: 1 | 2 | 3, phase: ImportedGame["phase"], round: number, home: string, result: string, away: string, venue: string, at: string | null): ImportedGame {
  return {
    tournament,
    phase,
    round,
    kickoff: at ?? "",
    ...(at ? {} : { estimated: true as const }),
    venue: clean(venue).replace(/^Estadio /, ""),
    homeId: clubId(home),
    awayId: clubId(away),
    score: score(result),
  };
}

/** Games without a date yet: a few days after the latest one before them (by round), at 15:00 local. */
function estimateDates(games: ImportedGame[]): void {
  const order = (g: ImportedGame) => [g.tournament, ["first", "second", "final", "grandFinal", "playoff"].indexOf(g.phase), g.round];
  const sorted = [...games].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!;
  });
  let last = Date.UTC(YEAR, 0, 1);
  let lastKey = "";
  let roundStart = last;
  for (const g of sorted) {
    const key = order(g).join(":");
    if (g.kickoff) {
      last = Math.max(last, Date.parse(g.kickoff));
      continue;
    }
    if (key !== lastKey) {
      roundStart = last + 4 * 24 * 3600 * 1000;
      last = roundStart;
    }
    lastKey = key;
    const day = new Date(roundStart);
    g.kickoff = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 20, 0)).toISOString();
  }
}

/** Each Football table module in the text, as rows in its order. */
function articleTables(text: string): ArticleRow[][] {
  return [...text.matchAll(/\{\{#invoke:Football table\|main([\s\S]*?)\n\}\}/g)].map(([, body]) => {
    const abbr = new Map<string, number>();
    for (const [, key, value] of body!.matchAll(/\|nombre_(\w+)\s*=\s*([^\n]*)/g)) abbr.set(key!, clubId(value!.replace(/\{\{refn[\s\S]*$/, "")));
    const order = /\|orden_equipo\s*=\s*([^\n]*)/.exec(body!)?.[1]!.split(",").map((s) => s.trim()) ?? [];
    const num = (field: string, key: string) => Number(new RegExp(`\\|${field}_${key}\\s*=\\s*(\\d+)`).exec(body!)?.[1] ?? NaN);
    return order.map((key, i) => ({
      position: i + 1,
      clubId: abbr.get(key)!,
      won: num("ganados", key),
      drawn: num("empates", key),
      lost: num("perdidos", key),
      goalsFor: num("gf", key),
      goalsAgainst: num("gc", key),
    }));
  });
}

async function article(): Promise<{ text: string; revision: number; timestamp: string }> {
  const url = `${WIKI}?action=query&format=json&formatversion=2&prop=revisions&rvprop=ids|timestamp|content&rvslots=main&titles=${encodeURIComponent(ARTICLE)}`;
  let res = await fetch(url, { headers: HEADERS });
  // Busy: wait as long as Wikimedia asks (a minute at most), then try again, three times.
  for (let attempt = 1; res.status === 429 && attempt <= 3; attempt++) {
    const wait = Math.min(60, Number(res.headers.get("retry-after")) || 15 * attempt);
    console.log(`Wikipedia is busy: trying again in ${wait} s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await fetch(url, { headers: HEADERS });
  }
  if (!res.ok) throw new Error(`${ARTICLE}: HTTP ${res.status}`);
  const body = (await res.json()) as { query: { pages: { revisions: { revid: number; timestamp: string; slots: { main: { content: string } } }[] }[] } };
  const rev = body.query.pages[0]!.revisions[0]!;
  return { text: rev.slots.main.content, revision: rev.revid, timestamp: rev.timestamp };
}

/** JSON with one club, game or table row per line: short, and easy to review in a diff. */
function compactJson(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null || !Array.isArray(v))) {
      return `[\n${value.map((v) => `${indent} ${JSON.stringify(v)}`).join(",\n")}\n${indent}]`;
    }
    return `[\n${value.map((v) => `${indent} ${compactJson(v, `${indent} `)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(
      ([k, v]) => `${indent} ${JSON.stringify(k)}: ${Array.isArray(v) || (v && typeof v === "object" && Object.values(v).some((x) => Array.isArray(x) || (x && typeof x === "object"))) ? compactJson(v, `${indent} `) : JSON.stringify(v)}`,
    );
    return `{\n${entries.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

async function crests(local: boolean) {
  await mkdir(ORIGINALS, { recursive: true });
  await mkdir(CRESTS, { recursive: true });
  for (const club of CLUBS) {
    const ext = club.crest.endsWith(".png") ? "png" : "jpg";
    const original = join(ORIGINALS, `${club.id}.${ext}`);
    if (!local || !existsSync(original)) {
      const res = await fetch(club.crest);
      if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw new Error(`Crest of ${club.name}: HTTP ${res.status}`);
      await writeFile(original, Buffer.from(await res.arrayBuffer()));
    }
    const bytes = await readFile(original);
    // ESPN's crests are on transparency already; the X avatar is on a white square.
    const png = ext === "png" ? await sharp(bytes).resize(CREST_SIZE, CREST_SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() : await cutOut(bytes);
    await writeFile(join(CRESTS, `${club.id}.png`), png);
  }
}

async function main() {
  const local = process.argv.includes("--local");
  // --wikitext <file>: the article's text saved earlier, instead of today's (to work on the parsing offline).
  const saved = process.argv.indexOf("--wikitext");
  const { text, revision, timestamp } = saved > 0 ? { text: await readFile(process.argv[saved + 1]!, "utf8"), revision: 0, timestamp: "saved copy" } : await article();
  const t1 = section(text, /^==\s*Torneo Apertura\s*==/);
  const t2 = section(text, /^==\s*Torneo Finalización\s*==/);
  const final1 = section(t1, /^===\s*Final\s*===/);
  const final2 = section(t2, /^===\s*Final\s*===/);
  const promotion = [section(text, /^==\s*Gran final\s*==/), section(text, /^==\s*Repechaje/)];
  const games: ImportedGame[] = [
    ...firstPhase(t1.split(/=== Cuadrangulares/)[0]!, 1),
    ...groups(t1, 1),
    ...matches(final1, 1, "final"),
    ...firstPhase(t2.split(/=== Cuadrangulares/)[0]!, 2),
    ...groups(t2, 2),
    ...matches(final2, 2, "final"),
    ...matches(promotion[0]!, 3, "grandFinal"),
    ...matches(promotion[1]!, 3, "playoff"),
  ];
  estimateDates(games);

  const count = (tournament: number, phase: string) => games.filter((g) => g.tournament === tournament && g.phase === phase).length;
  for (const tournament of [1, 2]) {
    if (count(tournament, "first") !== 120) throw new Error(`Torneo ${tournament}: ${count(tournament, "first")} round-robin games, not 120`);
    if (count(tournament, "second") && count(tournament, "second") !== 24) throw new Error(`Torneo ${tournament}: ${count(tournament, "second")} group games, not 24`);
  }
  if (count(1, "second") !== 24 || count(1, "final") !== 2) throw new Error("Torneo I: its groups and final are missing");

  const [t1First, t1A, t1B] = articleTables(t1);
  const [t2First, t2A, t2B] = articleTables(t2);
  const [aggregate] = articleTables(section(text, /^==\s*Tabla de reclasificación\s*==/));
  // Each tournament's groups: its first table's top two head groups A and B.
  const members = (tournament: 1 | 2, group: "A" | "B") => [...new Set(games.filter((g) => g.tournament === tournament && g.group === group).flatMap((g) => [g.homeId, g.awayId]))];

  await crests(local);

  const data = {
    source: `Wikipedia (es), "${ARTICLE}", revision ${revision} (${timestamp}); imported by scripts/import-primera-b.ts`,
    importedAt: new Date().toISOString().slice(0, 10),
    season: String(YEAR),
    clubs: CLUBS.map(({ id, name, shortName, tla }) => ({ id, name, ...(shortName ? { shortName } : {}), tla, crest: `/crests/primera-b/${id}.png` })),
    groups: {
      "1": { A: members(1, "A"), B: members(1, "B") },
      "2": { A: members(2, "A"), B: members(2, "B") },
    },
    games,
    article: {
      "1": { first: t1First ?? [], A: t1A ?? [], B: t1B ?? [] },
      "2": { first: t2First ?? [], A: t2A ?? [], B: t2B ?? [] },
      aggregate: aggregate ?? [],
    },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${compactJson(data)}\n`);
  const played = games.filter((g) => g.score).length;
  console.log(`Wrote ${games.length} games (${played} played) and ${CLUBS.length} crests`);
}

await main();
