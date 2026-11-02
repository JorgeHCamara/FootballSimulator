import { gamesPerTeam, type EspnStages, type LeagueConfig } from "../config/leagues.ts";
import { withFallbackCrests } from "../config/crests.ts";
import { applyTeamOverrides } from "../config/teamOverrides.ts";
import type { Fixture, Team } from "../engine/types.ts";
import { EspnError, espnFixtures, espnSplitSeason, espnTeams, fetchEspnGroups, fetchEspnSeason, type EspnEvent } from "./espn.ts";
import { FootballDataError, fetchMatches, mapMatches, seasonOf, teamsFromMatches, type ApiSeason } from "./footballData.ts";
import { sampleLeague } from "./sampleLeague.ts";

export interface LeagueData {
  teams: Team[];
  fixtures: Fixture[];
  /** Display label, e.g. "2026/27" or "2026". */
  season: string;
  /** Stable key for saved predictions: a new season starts with a clean slate. */
  seasonKey: string;
  source: "live" | "sample";
  /** Real post-season games (e.g. play-off legs) once the feed lists them. */
  postseason?: Fixture[];
  /** Clubs of each separate table (MLS conferences), in the league config's group order. */
  groups?: { id: string; teamIds: number[] }[];
  /**
   * Every tournament of the season when it has several (Argentina: Apertura,
   * Clausura), in the config's order (latest first). The fields above are the
   * current one's.
   */
  tournaments?: Tournament[];
}

export interface Tournament {
  /** ESPN's stage of its table, e.g. "torneo-apertura". */
  id: string;
  /** e.g. "Apertura". */
  name: string;
  /** e.g. "Apertura 2026". */
  season: string;
  fixtures: Fixture[];
  postseason?: Fixture[];
  seasonKey: string;
}

/** Server responses are cached for an hour, well inside the free tier's rate limit. */
const REVALIDATE_SECONDS = 3600;

const isBuildPhase = () => process.env.NEXT_PHASE === "phase-production-build";

const inflight = new Map<string, Promise<LeagueData>>();

export function seasonLabel(season: Pick<ApiSeason, "startDate" | "endDate">): string {
  const start = season.startDate.slice(0, 4);
  const end = season.endDate.slice(0, 4);
  return start === end ? start : `${start}/${end.slice(2)}`;
}

async function loadLive(league: LeagueConfig, apiKey: string): Promise<LeagueData> {
  // One request per league: teams and season come embedded in the matches.
  // Build workers fetch in parallel and can hit the 10 requests/minute limit, so
  // the build waits for the limit to reset. At runtime a stale page is fine, so fail fast.
  const { matches } = await fetchMatches(
    league.code,
    apiKey,
    { next: { revalidate: REVALIDATE_SECONDS, tags: [`league:${league.code}`] } },
    { maxRetries: isBuildPhase() ? 2 : 0 },
  );
  // Knockout games after the regular season (e.g. Championship play-offs) feed the
  // play-off bracket instead of the table.
  const isLeague = (m: (typeof matches)[number]) => !m.stage || m.stage === "REGULAR_SEASON";
  const fixtures = mapMatches(matches.filter(isLeague));
  const postseason = mapMatches(matches.filter((m) => !isLeague(m)).map((m) => ({ ...m, matchday: m.matchday ?? 0 })));
  if (fixtures.length === 0) throw new Error(`No fixtures returned for ${league.code}`);
  const season = seasonOf(matches) ?? {
    id: 0,
    startDate: fixtures[0]!.utcDate,
    endDate: fixtures.at(-1)!.utcDate,
  };
  return {
    teams: applyTeamOverrides(teamsFromMatches(matches.filter(isLeague)), { league: league.code }),
    fixtures,
    season: seasonLabel(season),
    seasonKey: `${league.code}:${season.id || season.startDate.slice(0, 4)}`,
    source: "live",
    ...(postseason.length ? { postseason } : {}),
  };
}

/** The season currently being played, by its starting year (2026 = 2026/27). */
function currentSeasonYear(league: LeagueConfig, now = new Date()): number {
  const year = now.getUTCFullYear();
  // Split seasons start in August; from June on, try the new season first.
  return league.espn.seasons === "split" && now.getUTCMonth() < 5 ? year - 1 : year;
}

/**
 * ESPN's public feed: the main source for every league (no key, no tight rate
 * limit). football-data.org is the fallback, except for Série B.
 * Until at least half of a new season's fixtures are published, the previous
 * season is shown.
 */
async function loadEspn(league: LeagueConfig): Promise<LeagueData> {
  const { slug, seasons, weeklyRounds } = league.espn;
  const init = { next: { revalidate: REVALIDATE_SECONDS, tags: [`league:${league.code}`] } };
  const perTeam = gamesPerTeam(league);
  const current = currentSeasonYear(league);
  for (const year of [current, current - 1]) {
    let all = await fetchEspnSeason(slug, year, seasons, init);
    const groups = league.groups ? await loadEspnGroups(league, year, init) : undefined;
    // The tournament to show: the first listed (latest) with at least half its
    // table published; a single tournament is always used.
    const stageSets = league.espn.stages === undefined ? [] : "table" in league.espn.stages ? [league.espn.stages] : [...league.espn.stages];
    const tableGames = (set: EspnStages) => all.filter((e) => e.season?.slug === set.table).length;
    const stages = stageSets.find((set) => stageSets.length === 1 || tableGames(set) >= (league.teams * perTeam) / 4) ?? stageSets.at(-1);
    if (groups) {
      // Only games between member clubs: drops exhibitions such as the MLS All-Star game.
      // With stages, only the tables': knockout games can bring in clubs from
      // another competition (Sudamericana: the Libertadores third-placed clubs).
      const members = new Set(groups.flatMap((g) => g.teamIds));
      const isMember = (id: string | undefined) => members.has(Number(id));
      const isTable = (slug: string | undefined) => stageSets.length === 0 || stageSets.some((set) => set.table === slug);
      all = all.filter((e) => !isTable(e.season?.slug) || (e.competitions[0]?.competitors ?? []).every((c) => isMember(c.team.id)));
    }
    const yearLabel = seasons === "split" ? `${year}/${String(year + 1).slice(2)}` : String(year);
    // ESPN and football-data.org use different match ids, so each source keeps
    // its own saved predictions (Série B has only ever used ESPN).
    const baseKey = league.espnOnly ? `${league.code}:${year}` : `${league.code}:espn:${year}`;
    // Games after a club's full league schedule are post-season (play-offs);
    // they feed the play-off bracket, or are left out when the site has none.
    const split = (set: EspnStages | undefined) =>
      set
        ? {
            league: all.filter((e) => e.season?.slug === set.table),
            postseason: all.filter((e) => set.knockout.includes(e.season?.slug ?? "")),
          }
        : espnSplitSeason(all, perTeam);
    // Cancelled play-off games (e.g. a series' unneeded game 3) are left out.
    const realPostseason = (events: EspnEvent[]) => espnFixtures(events.filter((e) => e.status.type.name !== "STATUS_CANCELED"));
    const { league: events, postseason } = split(stages);
    const fixtures = espnFixtures(events, weeklyRounds ? { weekly: true } : { roundCount: perTeam });
    // Skip a year until at least half of its games are published.
    if (fixtures.length < (league.teams * perTeam) / 4) continue;
    // A season of several tournaments: each one with games, with its own predictions.
    const tournaments: Tournament[] = [];
    const tournamentEvents: EspnEvent[] = [];
    if (stageSets.length > 1) {
      for (const set of stageSets) {
        const parts = split(set);
        if (parts.league.length === 0) continue;
        tournamentEvents.push(...parts.league, ...parts.postseason);
        tournaments.push({
          id: set.table,
          name: set.name ?? set.table,
          season: set.name ? `${set.name} ${yearLabel}` : yearLabel,
          fixtures: set === stages ? fixtures : espnFixtures(parts.league, { roundCount: perTeam }),
          ...(league.playoff && parts.postseason.length ? { postseason: realPostseason(parts.postseason) } : {}),
          seasonKey: `${baseKey}:${set.table}`,
        });
      }
    }
    return {
      // Knockout games can bring in clubs from outside the table (see above), which need names too.
      teams: withFallbackCrests(
        applyTeamOverrides(espnTeams(stages ? [...events, ...postseason, ...tournamentEvents] : events), { league: league.code }),
      ),
      fixtures,
      season: stages?.name ? `${stages.name} ${yearLabel}` : yearLabel,
      // Each tournament of a season (Apertura, Clausura) keeps its own predictions.
      seasonKey: `${baseKey}${stageSets.length > 1 && stages ? `:${stages.table}` : ""}`,
      source: "live",
      ...(league.playoff && postseason.length ? { postseason: realPostseason(postseason) } : {}),
      ...(groups ? { groups } : {}),
      ...(tournaments.length > 1 ? { tournaments } : {}),
    };
  }
  throw new Error(`No ${league.code} fixtures on ESPN for ${current} or ${current - 1}`);
}

/** The league's groups (conferences) with their clubs, matched to the config by ESPN's group names. */
async function loadEspnGroups(league: LeagueConfig, year: number, init: RequestInit) {
  const espnGroups = await fetchEspnGroups(league.espn.slug, year, init);
  return league.groups!.map((group) => {
    const found = espnGroups.find((g) => g.name.includes(group.espnName));
    if (!found || found.teamIds.length === 0) throw new Error(`${league.code}: no "${group.espnName}" group in ESPN standings for ${year}`);
    return { id: group.id, teamIds: found.teamIds };
  });
}

function loadSample(league: LeagueConfig): LeagueData {
  const { teams, fixtures } = sampleLeague(league);
  const year = new Date().getUTCFullYear();
  // Sample groups: the clubs split evenly, in order.
  const size = league.groups ? Math.ceil(teams.length / league.groups.length) : 0;
  const groups = league.groups?.map((g, i) => ({ id: g.id, teamIds: teams.slice(i * size, (i + 1) * size).map((t) => t.id) }));
  // Several tournaments a season (Argentina): the current one as above, and an
  // earlier one fully played, its fixture ids and dates moved clear of it.
  const sets = league.espn.stages && !("table" in league.espn.stages) ? league.espn.stages : [];
  let tournaments: Tournament[] | undefined;
  if (sets.length > 1) {
    const halfYear = 26 * 7 * 24 * 60 * 60 * 1000;
    const earlier = sampleLeague(league, 1).fixtures.map((f) => ({
      ...f,
      id: f.id + 100_000,
      utcDate: new Date(Date.parse(f.utcDate) - halfYear).toISOString(),
    }));
    // Its final, already played: club 1 beat club 2 (the annual table's champion pass-down).
    const lastDate = earlier.reduce((max, f) => (f.utcDate > max ? f.utcDate : max), "");
    const final: Fixture = { id: 200_001, matchday: 0, utcDate: lastDate, homeId: 1, awayId: 2, result: { home: 2, away: 1 } };
    tournaments = sets.map((set, i) => ({
      id: set.table,
      name: set.name ?? set.table,
      season: `${set.name ?? ""} ${year}`.trim(),
      fixtures: i === 0 ? fixtures : earlier,
      ...(i === 0 ? {} : { postseason: [final] }),
      seasonKey: `${league.code}:sample:${set.table}`,
    }));
  }
  return {
    teams,
    fixtures,
    season: tournaments ? tournaments[0]!.season : `${year}`,
    seasonKey: tournaments ? tournaments[0]!.seasonKey : `${league.code}:sample`,
    source: "sample",
    ...(groups ? { groups } : {}),
    ...(tournaments ? { tournaments } : {}),
  };
}

/**
 * Real data, in order of preference: ESPN's public feed, then football-data.org
 * (when FOOTBALL_DATA_API_KEY is set and the league is in its free tier). Generated
 * sample leagues are only used for local development and tests (offline, or
 * FOOTSIMU_SAMPLE_DATA=1). If every source fails during runtime regeneration the
 * error is thrown, so the previously generated (real) page stays in place; on a
 * Vercel build it fails the deployment, so the live site keeps its real data.
 */
export function getLeagueData(league: LeagueConfig): Promise<LeagueData> {
  // Share one request per league across the 3 language versions of its page and
  // their metadata. During a build the result is kept for the whole build; at
  // runtime only while the request is in flight, so hourly refreshes still fetch.
  const pending = inflight.get(league.code);
  if (pending) return pending;
  const promise = loadLeagueData(league);
  inflight.set(league.code, promise);
  const forget = () => {
    if (!isBuildPhase()) inflight.delete(league.code);
  };
  promise.then(forget, () => inflight.delete(league.code));
  return promise;
}

async function loadLeagueData(league: LeagueConfig): Promise<LeagueData> {
  if (process.env.FOOTSIMU_SAMPLE_DATA === "1") return loadSample(league);

  const sources: { name: string; load: () => Promise<LeagueData> }[] = [{ name: "ESPN", load: () => loadEspn(league) }];
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (apiKey && !league.espnOnly) sources.push({ name: "football-data.org", load: () => loadLive(league, apiKey) });

  const failures: string[] = [];
  for (const source of sources) {
    try {
      const data = await source.load();
      if (failures.length) console.warn(`${league.code}: using ${source.name} after ${failures.join("; ")}`);
      return data;
    } catch (error) {
      const reason = error instanceof FootballDataError || error instanceof EspnError ? `HTTP ${error.status}` : String(error);
      failures.push(`${source.name} failed (${reason})`);
    }
  }

  const summary = `${league.code}: ${failures.join("; ")}`;
  // Never publish made-up clubs: at runtime Next.js keeps serving the last good
  // page, and a failed Vercel build keeps the current deployment live.
  if (process.env.NODE_ENV === "production" && (!isBuildPhase() || process.env.VERCEL)) {
    throw new Error(`No real data for ${summary}`);
  }
  console.error(`Falling back to sample data for ${summary}`);
  return loadSample(league);
}
