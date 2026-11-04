/**
 * Builds every domestic league's starting ratings for one season from the
 * season before, and writes them to src/data/priors/<year>.ts.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-priors.ts 2026
 *
 * Run it once a season has its clubs on ESPN (each league's clubs come from
 * the new season's fixtures). For each club in the new season:
 * - it was in the same league last season: last season's rating, fitted
 *   against the opponents it met, pulled partway back to average (clubs
 *   change over a summer);
 * - it came up: its rating in the league below, turned into a below-average
 *   rating in this one (the better it was down there, the less below);
 * - it came down: the reverse, an above-average rating;
 * - no data (a league the site doesn't cover below): a below-average default.
 * Each league's ratings are then rescaled to average 1.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES, type LeagueConfig } from "../src/config/leagues.ts";
import { buildLeagueModel, type TeamStrength } from "../src/engine/ratings.ts";
import { realResults } from "../src/engine/results.ts";
import { espnFixtures, espnTeams, fetchEspnSeason } from "../src/lib/espn.ts";

const year = Number(process.argv[2]);
if (!Number.isInteger(year) || year < 2000) {
  console.error("Usage: node scripts/build-priors.ts <season start year, e.g. 2026>");
  process.exit(1);
}

/** The league below each one the site covers (promotion and relegation between them). */
const LOWER: Partial<Record<string, string>> = { PL: "ELC", ELC: "EL1", EL1: "EL2", PD: "SD", BL1: "BL2", SA: "SB", FL1: "FL2", DED: "DJL", BSA: "BSB" };
const UPPER = Object.fromEntries(Object.entries(LOWER).map(([up, down]) => [down!, up]));

/** How much of last season's difference from average a club keeps (in log terms). */
const CARRY = 0.75;
/** A promoted club: typical rating of a club coming up, and of a club going down. */
const PROMOTED = { attack: 0.8, defence: 1.25 };
const RELEGATED = { attack: 1.2, defence: 0.82 };
/** Typical ratings of those clubs in the league they leave, to compare with. */
const UP_FROM = { attack: 1.3, defence: 0.75 };
const DOWN_FROM = { attack: 0.8, defence: 1.25 };
/** How much a club's rating in the other league moves it from the typical value. */
const MOVE = 0.4;
/** No data: below average. */
const UNKNOWN = { attack: 0.85, defence: 1.15 };
/** Games a club needs last season for its rating to count. */
const MIN_GAMES = 8;

const leagues = LEAGUES.filter((l) => !l.continental);
const byCode = new Map(LEAGUES.map((l) => [l.code as string, l]));

/** Opponent-adjusted ratings of a league's season, with how many games each club played. */
async function seasonRatings(league: LeagueConfig, season: number) {
  const events = await fetchEspnSeason(league.espn.slug, season, league.espn.seasons);
  const teams = espnTeams(events);
  const fixtures = espnFixtures(events);
  const results = realResults(fixtures);
  const model = buildLeagueModel(teams, fixtures, results, { priorGames: 3 });
  const games = new Map<number, number>();
  for (const f of fixtures) if (results[f.id]) for (const id of [f.homeId, f.awayId]) games.set(id, (games.get(id) ?? 0) + 1);
  return { model, games, teams };
}

const cache = new Map<string, ReturnType<typeof seasonRatings>>();
const ratingsOf = (code: string, season: number) => {
  const key = `${code}:${season}`;
  if (!cache.has(key)) cache.set(key, seasonRatings(byCode.get(code)!, season));
  return cache.get(key)!;
};

const pow = (x: number, k: number) => Math.exp(k * Math.log(x));
const moved = (typical: TeamStrength, from: TeamStrength, s: TeamStrength): TeamStrength => ({
  attack: typical.attack * pow(s.attack / from.attack, MOVE),
  defence: typical.defence * pow(s.defence / from.defence, MOVE),
});
const round = (x: number) => Math.round(Math.min(2.5, Math.max(0.4, x)) * 1000) / 1000;

const out: Record<string, Record<string, [number, number]>> = {};
for (const league of leagues) {
  try {
    const current = await fetchEspnSeason(league.espn.slug, year, league.espn.seasons);
    const clubs = espnTeams(current);
    if (clubs.length < 4) {
      console.warn(`${league.code}: no ${year} clubs on ESPN yet, skipped`);
      continue;
    }
    const last = await ratingsOf(league.code, year - 1);
    const lower = LOWER[league.code] ? await ratingsOf(LOWER[league.code]!, year - 1).catch(() => null) : null;
    const upper = UPPER[league.code] ? await ratingsOf(UPPER[league.code]!, year - 1).catch(() => null) : null;
    const known = (r: Awaited<ReturnType<typeof seasonRatings>> | null, id: number) =>
      r && (r.games.get(id) ?? 0) >= MIN_GAMES ? r.model.strengths.get(id) : undefined;
    const counts = { returning: 0, promoted: 0, relegated: 0, unknown: 0 };
    const raw = clubs.map((club) => {
      const same = known(last, club.id);
      if (same) {
        counts.returning++;
        return [club.id, { attack: pow(same.attack, CARRY), defence: pow(same.defence, CARRY) }] as const;
      }
      const below = known(lower, club.id);
      if (below) {
        counts.promoted++;
        return [club.id, moved(PROMOTED, UP_FROM, below)] as const;
      }
      const above = known(upper, club.id);
      if (above) {
        counts.relegated++;
        return [club.id, moved(RELEGATED, DOWN_FROM, above)] as const;
      }
      counts.unknown++;
      return [club.id, UNKNOWN] as const;
    });
    // Average 1 across the league's clubs (geometric mean), as the model expects.
    const mean = (k: "attack" | "defence") => Math.exp(raw.reduce((sum, [, s]) => sum + Math.log(s[k]), 0) / raw.length);
    const ma = mean("attack");
    const md = mean("defence");
    out[league.code] = Object.fromEntries(raw.map(([id, s]) => [String(id), [round(s.attack / ma), round(s.defence / md)]]));
    console.log(`${league.code}: ${clubs.length} clubs (${counts.returning} returning, ${counts.promoted} promoted, ${counts.relegated} relegated, ${counts.unknown} unknown)`);
  } catch (error) {
    console.warn(`${league.code}: failed, skipped:`, error instanceof Error ? error.message : error);
  }
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/data/priors");
const body = Object.entries(out)
  .map(([code, clubs]) => `  ${code}: {\n${Object.entries(clubs).map(([id, [a, d]]) => `    "${id}": [${a}, ${d}],`).join("\n")}\n  },`)
  .join("\n");
writeFileSync(
  join(dir, `${year}.ts`),
  `// Generated by \`NODE_USE_ENV_PROXY=1 node scripts/build-priors.ts ${year}\` on ${new Date().toISOString().slice(0, 10)}, from the ${year - 1} season's results on ESPN.
// Starting ratings for the season starting in ${year}, by league and ESPN club id: [attack, defence] relative to
// the league average (attack above 1 scores more, defence above 1 concedes more). Don't edit by hand: rerun the script.
import type { PriorSeason } from "../../lib/priors.ts";

const PRIORS: PriorSeason = {
${body}
};

export default PRIORS;
`,
);
// The index lists every season's file.
const years = readdirSync(dir)
  .map((f) => /^(\d{4})\.ts$/.exec(f)?.[1])
  .filter((y): y is string => Boolean(y))
  .sort();
writeFileSync(
  join(dir, "index.ts"),
  `// Generated by scripts/build-priors.ts: every season's starting ratings, by the year it starts.
import type { PriorSeason } from "../../lib/priors.ts";
${years.map((y) => `import priors${y} from "./${y}.ts";`).join("\n")}

export const PRIOR_SEASONS: Readonly<Record<number, PriorSeason>> = {
${years.map((y) => `  ${y}: priors${y},`).join("\n")}
};
`,
);
console.log(`Wrote src/data/priors/${year}.ts (${Object.keys(out).length} leagues).`);
