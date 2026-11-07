// One-time import of the 2026 Brasileirão Série C from the CBF (cbf.com.br),
// the league's only source: ESPN has no 2026 Série C games (bra.3) and
// football-data.org doesn't carry it. The site never calls the CBF: it reads
// what this script writes, which is committed.
//
//   NODE_USE_ENV_PROXY=1 node scripts/import-serie-c.ts
//
// It writes src/data/serie-c/2026.json (the clubs, every game of the three
// phases and the CBF's official tables, to check the data against) and each
// club's crest to public/crests/serie-c/{CBF club id}.png (cut out of the CBF's
// JPEG, kept in scripts/data/serie-c-crests: see scripts/serieCCrests.ts). Run it again only to
// correct the data (the 2026 season is over).
//
// Where it reads from:
// - The phase pages (…/serie-c/2026/{2013,2098,2117}): the official tables
//   (points, games, wins, draws, losses, goals, cards), server-rendered.
// - The games, loaded by those pages from the CBF's games API through the
//   site (/api/cbf/jogos/campeonato/{competition}/rodada/{n}/fase): each round
//   lists every phase's games of that round number, so rounds 1–19 hold the
//   whole season (190 + 12 + 12 + 2 games).
// - The crests, as the phase pages show them (the site's image route over
//   conteudo.cbf.com.br/clubes/{id}/escudo.jpg), saved as the original JPEG,
//   then cut out of its square background as a transparent PNG.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGINALS, OUT as CRESTS, writeCrests } from "./serieCCrests.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/data/serie-c/2026.json");
const SITE = "https://www.cbf.com.br";
const PAGE = `${SITE}/futebol-brasileiro/tabelas/campeonato-brasileiro/serie-c/2026`;
/** The CBF's ids: the competition (games API) and its three phases (pages). */
const COMPETITION = 1260613;
const PHASES = { first: 2013, second: 2098, final: 2117 } as const;
const ROUNDS = 19;

/**
 * Each club's name as the federation writes it in the competition's
 * regulation (REC 2026, Anexo B: "Maringá", "Ituano", "Botafogo / PB"…), the
 * name supporters use, rather than the company names some game listings carry
 * ("Maringá FC SAF", "Botafogo Pb Saf"). Botafogo keeps its state, as the CBF
 * does, to tell it from Rio's. Keyed by CBF club id.
 */
const CLUBS: Record<number, { name: string; tla: string; state: string }> = {
  20017: { name: "Paysandu", tla: "PAY", state: "PA" },
  20024: { name: "Guarani", tla: "GUA", state: "SP" },
  20038: { name: "Ferroviária", tla: "FER", state: "SP" },
  20039: { name: "Santa Cruz", tla: "SCR", state: "PE" },
  20043: { name: "Maranhão", tla: "MAC", state: "MA" },
  20057: { name: "Itabaiana", tla: "ITA", state: "SE" },
  20062: { name: "Caxias", tla: "CAX", state: "RS" },
  20065: { name: "Volta Redonda", tla: "VRE", state: "RJ" },
  20107: { name: "Inter de Limeira", tla: "INT", state: "SP" },
  20164: { name: "Anápolis", tla: "ANA", state: "GO" },
  20379: { name: "Ypiranga", tla: "YPI", state: "RS" },
  21918: { name: "Maringá", tla: "MAR", state: "PR" },
  35322: { name: "Floresta", tla: "FLO", state: "CE" },
  40387: { name: "Barra", tla: "BAR", state: "SC" },
  59879: { name: "Figueirense", tla: "FIG", state: "SC" },
  63524: { name: "Botafogo-PB", tla: "BOT", state: "PB" },
  63843: { name: "Brusque", tla: "BRU", state: "SC" },
  64052: { name: "Amazonas", tla: "AMA", state: "AM" },
  64368: { name: "Confiança", tla: "CON", state: "SE" },
  64742: { name: "Ituano", tla: "ITU", state: "SP" },
};

/** The API's group names: the first phase is group A, the second B and C, the final D. */
const PHASE_OF_GROUP: Record<string, "first" | "second" | "final"> = { "GRUPO A": "first", "GRUPO B": "second", "GRUPO C": "second", "GRUPO D": "final" };

interface ApiSide {
  id: string;
  nome: string;
  gols: string;
  panaltis: string;
}
interface ApiGame {
  id_jogo: string;
  num_jogo: string;
  rodada: string;
  grupo: string;
  mandante: ApiSide;
  visitante: ApiSide;
  local: string;
  data: string;
  hora: string;
}

async function get(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/json, text/html, image/jpeg" } });
    if (res.ok) return res;
    if (attempt >= 2) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

/** "04/04/2026" and "17:00", Brasília time (UTC−3; no daylight saving since 2019), as UTC. */
function kickoff(date: string, time: string): string {
  const [d, m, y] = date.trim().split("/").map(Number);
  const [hh, mm] = (time.trim() || "00:00").split(":").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hh! + 3, mm!)).toISOString();
}

export interface OfficialRow {
  position: number;
  clubId: number;
  cbfName: string;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  yellowCards: number;
  redCards: number;
}

/** A phase page's tables (one per group), as the CBF shows them. */
function officialTables(html: string): OfficialRow[][] {
  return [...html.matchAll(/<tbody.*?<\/tbody>/gs)].flatMap(([body]) => {
    const rows = [...body.matchAll(/<tr.*?<\/tr>/gs)].flatMap(([tr]) => {
      const id = /clubes%2F(\d+)%2F/.exec(tr);
      const name = /teamName[^>]*>([^<]+)</.exec(tr);
      const position = /styles_position__\w+\s*">(\d+)</.exec(tr);
      const nums = [...tr.matchAll(/styles_alignCenter__\w+(?: styles_score__\w+)?">(-?\d+)</g)].map((m) => Number(m[1]));
      if (!id || !name || !position || nums.length < 11) return [];
      const [points, played, won, drawn, lost, goalsFor, goalsAgainst, , yellowCards, redCards] = nums as [number, number, number, number, number, number, number, number, number, number];
      return [{ position: Number(position[1]), clubId: Number(id[1]), cbfName: name[1]!.trim(), points, played, won, drawn, lost, goalsFor, goalsAgainst, yellowCards, redCards }];
    });
    return rows.length ? [rows] : [];
  });
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
    const entries = Object.entries(value).map(([k, v]) => `${indent} ${JSON.stringify(k)}: ${Array.isArray(v) || (v && typeof v === "object" && Object.values(v).some((x) => Array.isArray(x))) ? compactJson(v, `${indent} `) : JSON.stringify(v)}`);
    return `{\n${entries.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const [firstHtml, secondHtml] = await Promise.all([PHASES.first, PHASES.second].map(async (id) => (await get(`${PAGE}/${id}`)).text()));
  const firstTable = officialTables(firstHtml)[0];
  const secondTables = officialTables(secondHtml);
  if (!firstTable || firstTable.length !== 20) throw new Error("No 20-club first-phase table on the CBF page");
  if (secondTables.length !== 2) throw new Error("Expected the second phase's two group tables");

  const games = new Map<string, ApiGame>();
  for (let round = 1; round <= ROUNDS; round++) {
    const res = await get(`${SITE}/api/cbf/jogos/campeonato/${COMPETITION}/rodada/${round}/fase`);
    const body = (await res.json()) as { jogos: { grupo: string; jogo: ApiGame[] }[] };
    for (const group of body.jogos) for (const game of group.jogo) games.set(game.id_jogo, { ...game, grupo: group.grupo });
  }

  const unknown = [...games.values()].flatMap((g) => [g.mandante, g.visitante]).filter((s) => !CLUBS[Number(s.id)]);
  if (unknown.length) throw new Error(`Clubs without a name here: ${[...new Set(unknown.map((s) => `${s.id} ${s.nome}`))].join(", ")}`);

  const out = [...games.values()]
    .map((g) => {
      const phase = PHASE_OF_GROUP[g.grupo];
      if (!phase) throw new Error(`Game ${g.id_jogo}: unknown group ${g.grupo}`);
      const home = Number(g.mandante.gols);
      const away = Number(g.visitante.gols);
      if (!Number.isInteger(home) || !Number.isInteger(away)) throw new Error(`Game ${g.id_jogo} has no score`);
      const homePens = Number(g.mandante.panaltis);
      const awayPens = Number(g.visitante.panaltis);
      return {
        id: Number(g.id_jogo),
        number: Number(g.num_jogo),
        phase,
        group: g.grupo.replace("GRUPO ", ""),
        round: Number(g.rodada),
        kickoff: kickoff(g.data, g.hora),
        venue: g.local.trim(),
        homeId: Number(g.mandante.id),
        awayId: Number(g.visitante.id),
        score: { home, away },
        ...(homePens || awayPens ? { penalties: { home: homePens, away: awayPens } } : {}),
      };
    })
    .sort((a, b) => a.number - b.number);
  const count = (phase: string) => out.filter((g) => g.phase === phase).length;
  if (count("first") !== 190 || count("second") !== 24 || count("final") !== 2) {
    throw new Error(`Unexpected game counts: ${count("first")} / ${count("second")} / ${count("final")}`);
  }

  // Crests: the original JPEG, as the phase pages load it.
  await mkdir(ORIGINALS, { recursive: true });
  await mkdir(CRESTS, { recursive: true });
  for (const id of Object.keys(CLUBS)) {
    const url = `${SITE}/_next/image?url=${encodeURIComponent(`https://conteudo.cbf.com.br/clubes/${id}/escudo.jpg`)}&w=256&q=70`;
    const res = await get(url);
    if (!res.headers.get("content-type")?.startsWith("image/")) throw new Error(`Crest ${id}: not an image`);
    await writeFile(join(ORIGINALS, `${id}.jpg`), Buffer.from(await res.arrayBuffer()));
  }

  await writeCrests();

  const cbfNames = new Map(firstTable.map((r) => [r.clubId, r.cbfName]));
  const data = {
    source: "Confederação Brasileira de Futebol (cbf.com.br), imported once by scripts/import-serie-c.ts",
    importedAt: new Date().toISOString().slice(0, 10),
    season: "2026",
    cbf: { competition: COMPETITION, phases: PHASES },
    clubs: Object.entries(CLUBS)
      .map(([id, club]) => ({ id: Number(id), ...club, cbfName: cbfNames.get(Number(id)) ?? "", crest: `/crests/serie-c/${id}.png` }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt")),
    games: out,
    official: { firstPhase: firstTable, secondPhase: secondTables },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${compactJson(data)}\n`);
  console.log(`Wrote ${out.length} games and ${Object.keys(CLUBS).length} crests`);
}

await main();
