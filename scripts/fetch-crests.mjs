// Fills crests ESPN doesn't have, from TheSportsDB (community database, free key).
//
//   NODE_USE_ENV_PROXY=1 node scripts/fetch-crests.mjs           # match + review file
//   NODE_USE_ENV_PROXY=1 node scripts/fetch-crests.mjs --download # also download accepted crests
//
// 1. Collects every club without a crest in the current ESPN season of each
//    league and cup on the site.
// 2. Looks each one up on TheSportsDB by name (with variants), keeping teams of
//    the same country; a trailing Brazilian state code in ESPN's name
//    ("Sampaio Correa RJ") must match the team's location.
// 3. Writes scripts/crests-review.json (accepted / needs review / not found).
//    Wrong or missing picks are fixed in scripts/crest-overrides.json:
//    { "<espnId>": "<TheSportsDB team id>" | null }.
// 4. With --download: saves each crest to public/crests/<espnId>.png and
//    regenerates src/config/crests.ts.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { CUPS } from "../src/config/cups.ts";
import { LEAGUES } from "../src/config/leagues.ts";
import { fetchEspnSeason } from "../src/lib/espn.ts";

const ROOT = new URL("..", import.meta.url);
const REVIEW = new URL("scripts/crests-review.json", ROOT);
const OVERRIDES = new URL("scripts/crest-overrides.json", ROOT);
const MAP = new URL("src/config/crests.ts", ROOT);
const CRESTS = new URL("public/crests/", ROOT);
const API = "https://www.thesportsdb.com/api/v1/json/123";
const download = process.argv.includes("--download");

const COUNTRY = { England: "England", Spain: "Spain", Germany: "Germany", Italy: "Italy", France: "France", Portugal: "Portugal", Netherlands: "Netherlands", Brazil: "Brazil", USA: "USA" };
const STATES = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal|Brasília", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba", PR: "Paraná",
  PE: "Pernambuco|Recife", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia",
  RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};
const NOISE = new Set(["fc", "ec", "sc", "cf", "afc", "ac", "ca", "club", "clube", "futebol", "football", "esporte", "esportes", "sport", "sociedade", "de", "da", "do", "dos", "das", "desportos", "associacao", "atletico", "esportiva", "the", "u20", "town", "city", "united"]);

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tokens = (s) => fold(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !NOISE.has(t));
function similarity(a, b) {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (!x.size || !y.size) return fold(a) === fold(b) ? 1 : 0;
  const shared = [...x].filter((t) => y.has(t)).length;
  return shared / Math.max(x.size, y.size);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(15_000);
      continue;
    }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`${url}: rate limited`);
}

/** Clubs without an ESPN crest, per competition (current season). */
async function missingClubs() {
  const year = new Date().getUTCFullYear();
  const month = new Date().getUTCMonth();
  const competitions = [
    // First-party leagues (Série C) have no feed: their crests are the site's own.
    ...LEAGUES.filter((l) => l.espn).map((l) => ({ code: l.code, country: l.country, slug: l.espn.slug, seasons: l.espn.seasons })),
    ...CUPS.map((c) => ({ code: c.code, country: c.country, slug: c.espn.slug, seasons: c.espn.seasons })),
  ];
  const clubs = new Map();
  for (const c of competitions) {
    const season = c.seasons === "split" && month < 5 ? year - 1 : year;
    let events = [];
    try {
      events = await fetchEspnSeason(c.slug, season, c.seasons);
    } catch (error) {
      console.warn(`${c.code}: ${error.message}`);
    }
    for (const e of events) {
      for (const side of e.competitions[0]?.competitors ?? []) {
        const t = side.team;
        if (!/^\d+$/.test(t.id) || /^TBD\b/i.test(t.displayName)) continue;
        const club = clubs.get(t.id) ?? { espnId: Number(t.id), name: t.displayName, shortName: t.shortDisplayName ?? t.displayName, country: c.country, competitions: new Set(), hasLogo: false };
        club.competitions.add(c.code);
        club.hasLogo ||= Boolean(t.logo);
        clubs.set(t.id, club);
      }
    }
    console.log(`${c.code}: ${events.length} games`);
  }
  return [...clubs.values()].filter((c) => !c.hasLogo).map((c) => ({ ...c, competitions: [...c.competitions] }));
}

/** Candidate TheSportsDB teams for a club, best first, with the reason for each verdict. */
async function lookUp(club) {
  const state = /\s([A-Z]{2})$/.exec(club.name)?.[1];
  const base = state && STATES[state] ? club.name.slice(0, -3) : club.name;
  const variants = [...new Set([base, fold(base), club.shortName, base.replace(/\b(FC|EC|SC|CF|AC)\b/g, "").trim()].filter((v) => v && v.length > 2))];
  const seen = new Map();
  for (const v of variants) {
    const data = await json(`${API}/searchteams.php?t=${encodeURIComponent(v)}`);
    await sleep(2_200);
    for (const team of data.teams ?? []) {
      if (team.strSport !== "Soccer" || team.strCountry !== COUNTRY[club.country]) continue;
      if (/women|feminin|u2\d|u1\d|sub-?2\d/i.test(`${team.strTeam} ${team.strLeague ?? ""}`)) continue;
      seen.set(team.idTeam, team);
    }
    if ([...seen.values()].some((t) => similarity(base, t.strTeam) === 1)) break;
  }
  const where = (t) => fold(`${t.strLocation ?? ""} ${t.strStadiumLocation ?? ""} ${t.strKeywords ?? ""} ${t.strDescriptionEN ?? ""}`.slice(0, 600));
  const candidates = [...seen.values()]
    .map((t) => {
      let score = Math.max(similarity(base, t.strTeam), similarity(base, t.strTeamAlternate ?? ""), similarity(club.shortName, t.strTeam));
      // A state code in ESPN's name must match the team's location.
      if (state && STATES[state] && !STATES[state].split("|").some((s) => where(t).includes(fold(s)))) score *= 0.3;
      return { idTeam: t.idTeam, team: t.strTeam, location: t.strLocation ?? t.strStadiumLocation ?? "", league: t.strLeague ?? "", badge: t.strBadge ?? "", score: Math.round(score * 100) / 100 };
    })
    .filter((c) => c.badge)
    .sort((a, b) => b.score - a.score);
  return candidates;
}

const clubs = await missingClubs();
const previous = existsSync(REVIEW) ? JSON.parse(await readFile(REVIEW, "utf8")) : { clubs: [] };
const known = new Map(previous.clubs.map((c) => [c.espnId, c]));
const overrides = existsSync(OVERRIDES) ? JSON.parse(await readFile(OVERRIDES, "utf8")) : {};
console.log(`${clubs.length} clubs without an ESPN crest`);

const review = [];
for (const club of clubs) {
  let entry = known.get(club.espnId);
  if (!entry || !entry.candidates) {
    const candidates = await lookUp(club);
    const [best, second] = candidates;
    const accepted = best && best.score >= 0.8 && (!second || second.score < best.score);
    entry = { ...club, verdict: !best ? "not found" : accepted ? "accepted" : "review", pick: accepted ? best.idTeam : null, candidates: candidates.slice(0, 4) };
    console.log(`${entry.verdict.padEnd(9)} ${club.name} (${club.competitions.join(",")}) → ${best ? `${best.team} [${best.location}] ${best.score}` : "-"}`);
  }
  if (Object.hasOwn(overrides, String(club.espnId))) {
    entry.pick = overrides[club.espnId];
    entry.verdict = entry.pick ? "fixed" : "skipped";
  }
  review.push(entry);
}
await writeFile(REVIEW, JSON.stringify({ generated: new Date().toISOString(), clubs: review }, null, 1) + "\n");
const counts = review.reduce((n, c) => ({ ...n, [c.verdict]: (n[c.verdict] ?? 0) + 1 }), {});
console.log("verdicts:", counts);

if (download) {
  await mkdir(CRESTS, { recursive: true });
  const map = {};
  for (const c of review) {
    if (!c.pick) continue;
    let badge = c.candidates.find((x) => x.idTeam === c.pick)?.badge;
    if (!badge) {
      const data = await json(`${API}/lookupteam.php?id=${c.pick}`);
      await sleep(2_200);
      badge = data.teams?.[0]?.strBadge;
    }
    if (!badge) continue;
    const file = new URL(`${c.espnId}.png`, CRESTS);
    if (!existsSync(file)) {
      const res = await fetch(`${badge}/small`);
      if (!res.ok) {
        console.warn(`${c.name}: crest HTTP ${res.status}`);
        continue;
      }
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
    }
    map[c.espnId] = `/crests/${c.espnId}.png`;
  }
  const lines = Object.entries(map)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, path]) => `  ${id}: "${path}", // ${review.find((c) => c.espnId === Number(id)).name}`);
  await writeFile(
    MAP,
    `import type { Team } from "../engine/types.ts";
import { CREST_CUTOUTS } from "./crestCutouts.ts";

// Crests for clubs ESPN has none for, from TheSportsDB (thesportsdb.com,
// community-uploaded artwork), matched by hand-checked script and saved under
// public/crests. Regenerate: NODE_USE_ENV_PROXY=1 node scripts/fetch-crests.mjs --download

export const CREST_FALLBACKS: Readonly<Record<number, string>> = {
${lines.join("\n")}
};

/**
 * Gives clubs without a crest the saved one, keyed by ESPN team id; ESPN's own
 * crests stay, cut out where they come with a background (src/config/crestCutouts.ts).
 */
export function withFallbackCrests(teams: readonly Team[]): Team[] {
  return teams.map((team) => {
    const crest = team.crest || CREST_FALLBACKS[team.id];
    if (!crest) return team;
    // A crest that comes with a background shows cut out, while it's still the one the cut-out was made from.
    const cutout = CREST_CUTOUTS[team.id];
    const shown = cutout && cutout.from === crest ? cutout.crest : crest;
    return shown === team.crest ? team : { ...team, crest: shown };
  });
}
`,
  );
  console.log(`saved ${Object.keys(map).length} crests`);
}
