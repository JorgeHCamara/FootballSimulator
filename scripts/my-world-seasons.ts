// Plays My World seasons from the live data, many worlds over, and reports how realistic the years turn out: who wins
// the top divisions' titles, where the best-known clubs finish (and how often they miss the top six or ten, or go
// down), the tables' points, how often promoted clubs go straight back down, and how the ratings' spread moves season
// by season. This is how the between-season rule's values (src/lib/worldLevels.ts) were chosen.
// Usage: npm run world:seasons -- [worlds] [seasons]  (default 60 worlds of 10 seasons; STATS_SEASONS=10 limits the
// finishes and titles to the first seasons of a longer run, the spread showing every season).
import { createWorld, playSeason, startNextSeason, type World } from "../src/lib/myWorld.ts";
import { worldStartPack } from "../src/lib/myWorldStart.ts";
import { COUNTRY_LEAGUES, divisionCountry } from "../src/lib/worldCountries.ts";

const WORLDS = Number(process.argv[2] ?? 60);
const SEASONS = Number(process.argv[3] ?? 10);
const STATS_SEASONS = Number(process.env.STATS_SEASONS ?? SEASONS);
/** The clubs to follow, by ESPN id: the English big six, Spain's and Germany's top three. */
const NAMED: Record<string, number[]> = { PL: [382, 359, 364, 363, 360, 367], PD: [86, 83, 1068], BL1: [132, 124, 131] };

const pack = await worldStartPack();
if (pack.missing.length) throw new Error(`missing: ${pack.missing.join(", ")}`);
const logQuality = (w: World, id: number) => Math.log(w.ratings[id]![0] / w.ratings[id]![1]);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");

interface Finishes { finishes: number[]; top4: number; out6: number; out10: number; down: number; away: number; n: number }
const finishes = (): Finishes => ({ finishes: [], top4: 0, out6: 0, out10: 0, down: 0, away: 0, n: 0 });
const named = new Map<string, Finishes>();
const bySeason = new Map<string, Finishes[]>();
const titles = new Map<string, { initialTop3: number; total: number; champions: Set<number>[] }>();
const points = new Map<string, { champion: number[]; bottom: number[]; sd: number[] }>();
const spread = new Map<string, number[][]>();
const promoted = { seasons: 0, down: 0 };

const t0 = Date.now();
for (let seed = 1; seed <= WORLDS; seed++) {
  const club = pack.leagues.find((l) => l.code === "PL")!.teams[0]!.id;
  let world = createWorld(pack, { league: "PL", club, countries: ["ENG", "ESP", "GER"] }, seed * 7919);
  const byReal = new Map<number, number>();
  for (const c of Object.values(world.clubs)) if (c.origin === "real" && c.realId !== undefined) byReal.set(c.realId, c.id);
  const initialTop3 = new Map(world.divisions.map((d) => [d.code, new Set([...d.clubs].sort((a, b) => logQuality(world, b) - logQuality(world, a)).slice(0, 3))]));
  let promotedLast = new Set<number>();
  for (let s = 0; s < SEASONS; s++) {
    for (const d of world.divisions) {
      if (!spread.has(d.code)) spread.set(d.code, []);
      (spread.get(d.code)![s] ??= []).push(sd(d.clubs.map((id) => logQuality(world, id))));
    }
    world = playSeason(world);
    const record = world.history.at(-1)!;
    const promotedNow = new Set<number>();
    for (const d of record.divisions) {
      const { rows, code } = d;
      for (const r of rows) if (["C", "P", "W"].includes(r[8])) promotedNow.add(r[0]);
      if (s >= STATS_SEASONS) continue;
      for (const realId of NAMED[code] ?? []) {
        const id = byReal.get(realId);
        const key = `${code}:${realId}`;
        if (!named.has(key)) named.set(key, finishes());
        if (!bySeason.has(key)) bySeason.set(key, []);
        const all = named.get(key)!;
        const one = (bySeason.get(key)![s] ??= finishes());
        const i = rows.findIndex((r) => r[0] === id);
        for (const x of [all, one]) {
          x.n++;
          if (i < 0) {
            x.away++;
            continue;
          }
          x.finishes.push(i + 1);
          if (i < 4) x.top4++;
          if (i >= 6) x.out6++;
          if (i >= 10) x.out10++;
          if (rows[i]![8] === "R") x.down++;
        }
      }
      if (COUNTRY_LEAGUES[divisionCountry(code)][0] !== code) continue;
      if (!titles.has(code)) titles.set(code, { initialTop3: 0, total: 0, champions: [] });
      const t = titles.get(code)!;
      t.total++;
      if (initialTop3.get(code)!.has(rows[0]![0])) t.initialTop3++;
      (t.champions[seed] ??= new Set()).add(rows[0]![0]);
      if (!points.has(code)) points.set(code, { champion: [], bottom: [], sd: [] });
      const p = points.get(code)!;
      p.champion.push(rows[0]![7]);
      p.bottom.push(rows[rows.length - 1]![7]);
      p.sd.push(sd(rows.map((r) => r[7])));
      for (const r of rows) {
        if (!promotedLast.has(r[0])) continue;
        promoted.seasons++;
        if (r[8] === "R") promoted.down++;
      }
    }
    promotedLast = promotedNow;
    world = startNextSeason(world);
  }
}
console.log(`${WORLDS} worlds × ${SEASONS} seasons in ${((Date.now() - t0) / 1000).toFixed(1)}s${STATS_SEASONS < SEASONS ? ` (finishes and titles over the first ${STATS_SEASONS})` : ""}\n`);
for (const [code, t] of titles) {
  const p = points.get(code)!;
  const distinct = t.champions.filter(Boolean).map((c) => c.size);
  console.log(`${code}: titles to the initial top 3: ${pct(t.initialTop3, t.total)}; distinct champions per world: ${mean(distinct).toFixed(1)}; champion ${mean(p.champion).toFixed(1)} pts, bottom ${mean(p.bottom).toFixed(1)} pts, table sd ${mean(p.sd).toFixed(1)}`);
  console.log(`  spread of log(attack/defence) at the start of seasons 1..${SEASONS}: ${spread.get(code)!.map((xs) => mean(xs).toFixed(2)).join(" ")}`);
}
console.log(`promoted clubs relegated straight back: ${pct(promoted.down, promoted.seasons)}\n`);
for (const [key, st] of named) {
  const [code, realId] = key.split(":");
  const name = pack.leagues.find((l) => l.code === code)!.teams.find((t) => t.id === Number(realId))?.shortName ?? realId!;
  const per = bySeason.get(key)!.map((s) => (s.finishes.length ? mean(s.finishes).toFixed(1) : "-")).join(" ");
  console.log(
    `${code} ${name.padEnd(14)} mean finish ${(st.finishes.length ? mean(st.finishes).toFixed(1) : "-").padStart(4)} | top 4 ${pct(st.top4, st.n).padStart(6)} | outside top 6 ${pct(st.out6, st.n).padStart(6)} | outside top 10 ${pct(st.out10, st.n).padStart(6)} | relegated ${pct(st.down, st.n).padStart(5)} | away ${pct(st.away, st.n).padStart(5)} | by season: ${per}`,
  );
}
