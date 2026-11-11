import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LeagueConfig, ZoneKind } from "../config/leagues.ts";
import type { Fixture, TeamId } from "../engine/types.ts";
import { CONTINENTAL, leagueFacts } from "./leagueFacts.ts";
import type { LeagueData } from "./leagueData.ts";
import { fresher, readPublished } from "./publishedData.ts";
import { snapshotModel, type LeagueSnapshots, type OddsSnapshot, type TeamSnapshot } from "./snapshots.ts";

/*
 * "What changed" reports: one per league and completed round, from the odds
 * snapshots in src/data/snapshots (see src/lib/snapshots.ts). A new round's
 * snapshot is committed by the scheduled job, the running site reads it
 * (src/lib/publishedData.ts: no deployment), and its report exists: nothing
 * to write by hand.
 */

const files = new Map<string, Promise<LeagueSnapshots | undefined>>();

/** A league's snapshots as the deployment was built with them (read once per server), or its sample ones. */
function bundledSnapshots(code: string): Promise<LeagueSnapshots | undefined> {
  let file = files.get(code);
  if (!file) {
    file =
      process.env.FOOTSIMU_SAMPLE_DATA === "1"
        ? sampleSnapshots(code)
        : readFile(join(process.cwd(), "src/data/snapshots", `${code}.json`), "utf8").then(
            (text) => JSON.parse(text) as LeagueSnapshots,
            () => undefined,
          );
    files.set(code, file);
  }
  return file;
}

/** When a snapshots file was last added to: its latest snapshot's `takenAt` (a retaken round counts too). */
export function snapshotsStamp(file: LeagueSnapshots): string {
  let latest = "";
  for (const season of Object.values(file.seasons ?? {})) for (const s of season.snapshots ?? []) if (s.takenAt > latest) latest = s.takenAt;
  return latest;
}

const isSnapshots = (file: LeagueSnapshots | null | undefined): file is LeagueSnapshots => Boolean(file && typeof file === "object" && file.seasons && typeof file.seasons === "object");

/**
 * A league's stored snapshots: the published file (main's, read through the
 * data cache: src/lib/publishedData.ts), or the one the deployment was built
 * with when that is newer or the published one can't be read. With the
 * generated sample leagues (local development, tests), snapshots of their own
 * rounds instead, worked out on the spot.
 *
 * A page that reads them is tagged with the league's snapshots tag, so a new
 * round's publication rebuilds it; `quiet` for a page that only shows a detail
 * of the latest round (the league page, a chance page): it follows within
 * hours instead. `keep`: see readPublished (a past round's report page keeps
 * its entry, and itself, for 30 days).
 */
export async function readSnapshots(code: string, options: { keep?: number; quiet?: boolean } = {}): Promise<LeagueSnapshots | undefined> {
  const [bundled, published] = await Promise.all([bundledSnapshots(code), readPublished<LeagueSnapshots>("snapshots", code, options)]);
  const file = published?.file;
  return fresher(bundled, file === null || isSnapshots(file) ? file : undefined, snapshotsStamp);
}

/** Fewer seasons, and only the last rounds, than the real snapshots: they're worked out on the spot (the sitemap needs every league's). */
const SAMPLE_ITERATIONS = 1000;
const SAMPLE_ROUNDS = 6;

async function sampleSnapshots(code: string): Promise<LeagueSnapshots | undefined> {
  const { getLeagueByCode } = await import("../config/leagues.ts");
  const { getLeagueData } = await import("./leagueData.ts");
  const { addSnapshots, completedRounds, snapshotAfter } = await import("./snapshots.ts");
  const league = getLeagueByCode(code);
  // A first-party league (Série C) has no snapshots on the live site either (scripts/snapshot-odds.ts skips it).
  if (!league || league.firstParty) return undefined;
  const data = await getLeagueData(league);
  const snapshots = completedRounds(data.fixtures).slice(-SAMPLE_ROUNDS).flatMap((r) => snapshotAfter(league, data, r.round, r.lastKickoff, new Date(), SAMPLE_ITERATIONS) ?? []);
  return snapshots.length ? addSnapshots(undefined, league.code, data.seasonKey, data.season, snapshots) : undefined;
}

/** What a report tracks: the title, the top continental competition, promotion, the play-offs and relegation, each when the league has it. */
export type CategoryKind = "title" | "continental" | "promotion" | "playoffs" | "relegation";

export interface Category {
  kind: CategoryKind;
  /** The zone it's named after (the continental competition: "championsLeague", "libertadores"…). */
  zone: ZoneKind;
}

/** A continental place and its qualifying round count as one. */
const family = (kind: ZoneKind) => kind.replace(/Qualifying$/, "") as ZoneKind;

/** The categories a league's reports track, in this order, from its places and what the snapshots hold. */
export function reportCategories(league: LeagueConfig, snapshot: OddsSnapshot): Category[] {
  const kinds = new Set(Object.values(snapshot.teams).flatMap((t) => Object.keys(t.chances)));
  const places = [...(leagueFacts(league)?.places ?? [])].sort((a, b) => a.from - b.from);
  const out: Category[] = [];
  const title = kinds.has("title");
  if (title) out.push({ kind: "title", zone: "title" });
  const continental = places.find((z) => CONTINENTAL.has(z.kind));
  if (continental) out.push({ kind: "continental", zone: family(continental.kind) });
  if (kinds.has("promotion")) out.push({ kind: "promotion", zone: "promotion" });
  const playoffs = (["playoffs", "titlePlayoffs"] as const).find((k) => kinds.has(k));
  if (playoffs && !title) out.push({ kind: "playoffs", zone: playoffs });
  if (kinds.has("relegation")) out.push({ kind: "relegation", zone: "relegation" });
  return out;
}

/**
 * A club's chance in a category. The continental one is every place of the top
 * competition (its qualifying round included) and, where the champions go
 * there with the title as its own place (Greece), the title.
 */
export function categoryValue(league: LeagueConfig, team: TeamSnapshot, category: Category): number {
  const c = team.chances;
  if (category.kind !== "continental") return c[category.zone] ?? 0;
  const places = [...(leagueFacts(league)?.places ?? [])].sort((a, b) => a.from - b.from);
  const top = places.filter((z) => family(z.kind) === category.zone);
  const kinds = [...new Set(top.map((z) => z.kind))];
  const firstAt = Math.min(...top.map((z) => z.from));
  const titleLeadsThere = firstAt > 1 && places.filter((z) => z.from < firstAt).every((z) => z.kind === "title");
  return Math.min(1, kinds.reduce((sum, k) => sum + (c[k] ?? 0), 0) + (titleLeadsThere ? (c.title ?? 0) : 0));
}

/** A season's snapshots, oldest first. */
export interface SeasonReports {
  seasonKey: string;
  season: string;
  snapshots: OddsSnapshot[];
}

/**
 * The season reports are shown for: the current one when it has snapshots,
 * else the latest stored (a new season before its first completed round).
 */
export function seasonReports(file: LeagueSnapshots | undefined, currentKey?: string): SeasonReports | undefined {
  if (!file) return undefined;
  const entries = Object.entries(file.seasons).filter(([, s]) => s.snapshots.length);
  if (!entries.length) return undefined;
  const [seasonKey, season] =
    entries.find(([key]) => key === currentKey) ?? entries.sort((a, b) => (a[1].snapshots.at(-1)!.asOf < b[1].snapshots.at(-1)!.asOf ? 1 : -1))[0]!;
  return { seasonKey, season: season.season, snapshots: [...season.snapshots].sort((a, b) => a.round - b.round) };
}

/** A season label for headings: a season of several tournaments by its year ("2026", not "Clausura 2026"). */
export const seasonYearLabel = (season: string) => (/\d{4}$/.test(season) && /\s/.test(season) ? season.split(" ").at(-1)! : season);

/** A club's chance now, before (the previous report), and the change in whole points (as shown). */
export interface Change {
  teamId: TeamId;
  now: number;
  before?: number;
  /** In points of percentage, from the rounded figures (so 7% → 12% is +5). */
  delta?: number;
}

const points = (share: number) => Math.round(share * 100);

export interface ReportRow {
  teamId: TeamId;
  position: number;
  points: number;
  played: number;
  expectedPosition: number;
  values: Partial<Record<CategoryKind, Change>>;
}

export interface Movers {
  category: Category;
  /** Up to three, biggest first; only changes of a point or more. */
  up: Change[];
  down: Change[];
}

export interface OddsReport {
  league: LeagueConfig;
  seasonKey: string;
  season: string;
  snapshot: OddsSnapshot;
  /** The report before (undefined for the season's first). */
  previous?: OddsSnapshot;
  /**
   * The previous report was taken with another model (snapshotModel): the
   * chances moved with the model as well as the results, so no change is
   * worked out (no deltas, movers or result of the round).
   */
  modelChange: boolean;
  /** Every report of the season, oldest first (the archive). */
  all: OddsSnapshot[];
  categories: Category[];
  /** Every club, in table order then. */
  rows: ReportRow[];
  movers: Movers[];
  /** The category the race chart follows: the title, or the first one there is. */
  lead: Category;
  /**
   * The lead category's top five now, and their chance after each report up to
   * this one; `modelChanges`: the rounds whose snapshot was the first of a new model.
   */
  race: { rounds: number[]; series: { teamId: TeamId; values: number[] }[]; modelChanges: number[] };
}

/** Each club's place in the table of a report's rows (for breaking ties between movers). */
const positionOf = (rows: readonly ReportRow[]) => {
  const at = new Map(rows.map((r) => [r.teamId, r.position]));
  return (id: TeamId) => at.get(id) ?? Number.MAX_SAFE_INTEGER;
};

/**
 * The `n` biggest moves one way (1: up, −1: down), by the size of the change in
 * points. A tie goes to the higher chance now, then the higher place in the
 * table, then the lower club id: the same order every time.
 */
export function topMovers(changes: readonly Change[], dir: 1 | -1, n: number, position: (id: TeamId) => number): Change[] {
  return changes
    .filter((c) => c.delta !== undefined && Math.sign(c.delta) === dir)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!) || b.now - a.now || position(a.teamId) - position(b.teamId) || a.teamId - b.teamId)
    .slice(0, n);
}

/** How much the biggest-movers card holds: up to three categories, two risers and two fallers in each. */
export const MOVERS_CARD = { categories: 3, perSide: 2 } as const;

/** The categories the card picks first: the title, promotion and relegation, then the continental places and the play-offs. */
const CARD_PRIORITY: readonly CategoryKind[] = ["title", "promotion", "relegation", "continental", "playoffs"];

export interface MoversCardSection {
  category: Category;
  up: Change[];
  down: Change[];
}

/**
 * The biggest-movers card of a report: up to `categories` of its categories
 * with a change (picked in CARD_PRIORITY order, shown in the report's), each
 * with its `perSide` biggest risers and fallers (topMovers). None when the
 * report has no changes: the season's first, or the first after a model change.
 */
export function moversCardSections(report: OddsReport, { categories = MOVERS_CARD.categories, perSide = MOVERS_CARD.perSide }: { categories?: number; perSide?: number } = {}): MoversCardSection[] {
  if (!report.previous || report.modelChange) return [];
  const position = positionOf(report.rows);
  const sections = report.categories
    .map((category) => {
      const changes = report.rows.flatMap((r) => r.values[category.kind] ?? []);
      return { category, up: topMovers(changes, 1, perSide, position), down: topMovers(changes, -1, perSide, position) };
    })
    .filter((s) => s.up.length || s.down.length);
  const rank = (s: MoversCardSection) => CARD_PRIORITY.indexOf(s.category.kind);
  const chosen = new Set([...sections].sort((a, b) => rank(a) - rank(b)).slice(0, categories));
  return sections.filter((s) => chosen.has(s));
}

/** The report for a round (the season's latest when `round` is undefined), or undefined for no such round. */
export function buildReport(league: LeagueConfig, season: SeasonReports, round?: number): OddsReport | undefined {
  const index = round === undefined ? season.snapshots.length - 1 : season.snapshots.findIndex((s) => s.round === round);
  const snapshot = season.snapshots[index];
  if (!snapshot) return undefined;
  const previous = index > 0 ? season.snapshots[index - 1] : undefined;
  const modelChange = Boolean(previous && snapshotModel(previous) !== snapshotModel(snapshot));
  const categories = reportCategories(league, snapshot);
  const value = (s: OddsSnapshot | undefined, id: string, c: Category) => (s?.teams[id] ? categoryValue(league, s.teams[id]!, c) : undefined);
  const rows: ReportRow[] = Object.entries(snapshot.teams)
    .map(([id, team]) => ({
      teamId: Number(id),
      position: team.position,
      points: team.points,
      played: team.played,
      expectedPosition: team.expectedPosition,
      values: Object.fromEntries(
        categories.map((c) => {
          const now = value(snapshot, id, c)!;
          const before = value(previous, id, c);
          return [c.kind, { teamId: Number(id), now, ...(before !== undefined ? { before, ...(modelChange ? {} : { delta: points(now) - points(before) }) } : {}) }];
        }),
      ),
    }))
    .sort((a, b) => a.position - b.position || a.teamId - b.teamId);
  const position = positionOf(rows);
  const movers = categories.map((category) => {
    const changes = rows.map((r) => r.values[category.kind]!);
    return { category, up: topMovers(changes, 1, 3, position), down: topMovers(changes, -1, 3, position) };
  });
  const lead = categories[0] ?? { kind: "title" as const, zone: "title" as const };
  const history = season.snapshots.slice(0, index + 1);
  const top = [...rows].sort((a, b) => (b.values[lead.kind]?.now ?? 0) - (a.values[lead.kind]?.now ?? 0) || a.position - b.position).slice(0, 5);
  const race = {
    rounds: history.map((s) => s.round),
    series: top.map((r) => ({ teamId: r.teamId, values: history.map((s) => value(s, String(r.teamId), lead) ?? 0) })),
    modelChanges: history.flatMap((s, i) => (i > 0 && snapshotModel(s) !== snapshotModel(history[i - 1]!) ? [s.round] : [])),
  };
  return { league, seasonKey: season.seasonKey, season: season.season, snapshot, ...(previous ? { previous } : {}), modelChange, all: season.snapshots, categories, rows, movers, lead, race };
}

/** A club's game between two reports, from its side. */
export interface ClubGame {
  fixture: Fixture;
  home: boolean;
  opponentId: TeamId;
  goalsFor: number;
  goalsAgainst: number;
}

/**
 * The games a report covers: played after the previous report's moment and
 * up to this one's (the league data's results; none when the data is another
 * season's, or for the season's first report).
 */
export function reportGames(report: OddsReport, data: LeagueData): Fixture[] {
  if (!report.previous || data.seasonKey !== report.seasonKey) return [];
  const from = report.previous.asOf;
  const to = report.snapshot.asOf;
  return data.fixtures.filter((f) => f.result && f.utcDate >= from && f.utcDate < to);
}

/** Each club's games in a report, from its side. */
export function clubGames(games: readonly Fixture[]): Map<TeamId, ClubGame[]> {
  const out = new Map<TeamId, ClubGame[]>();
  for (const f of games) {
    const r = f.result!;
    const add = (id: TeamId, game: ClubGame) => out.set(id, [...(out.get(id) ?? []), game]);
    add(f.homeId, { fixture: f, home: true, opponentId: f.awayId, goalsFor: r.home, goalsAgainst: r.away });
    add(f.awayId, { fixture: f, home: false, opponentId: f.homeId, goalsFor: r.away, goalsAgainst: r.home });
  }
  return out;
}

/**
 * "Result of the round": the game whose two clubs' chances moved the most
 * (every category's change, in points, added up for both). Each club's change
 * is put down to its own game; a club that played twice since the last report
 * counts for neither game.
 */
export function resultOfRound(report: OddsReport, games: readonly Fixture[]): { fixture: Fixture; swing: number } | undefined {
  const perClub = clubGames(games);
  const swingOf = (id: TeamId) => {
    if ((perClub.get(id)?.length ?? 0) !== 1) return 0;
    const row = report.rows.find((r) => r.teamId === id);
    return row ? Object.values(row.values).reduce((sum, c) => sum + Math.abs(c?.delta ?? 0), 0) : 0;
  };
  let best: { fixture: Fixture; swing: number } | undefined;
  for (const f of games) {
    const swing = swingOf(f.homeId) + swingOf(f.awayId);
    if (swing > 0 && (!best || swing > best.swing)) best = { fixture: f, swing };
  }
  return best;
}

/** The round in a report address ("matchday-11"), or undefined. */
export const roundFromParam = (param: string) => {
  const m = /^matchday-(\d{1,3})$/.exec(param);
  return m ? Number(m[1]) : undefined;
};

/** A report's address, without the locale: "/premier-league/odds/matchday-11". */
export const reportPath = (league: Pick<LeagueConfig, "slug">, round: number) => `/${league.slug}/odds/matchday-${round}`;
export const latestReportPath = (league: Pick<LeagueConfig, "slug">) => `/${league.slug}/odds`;
