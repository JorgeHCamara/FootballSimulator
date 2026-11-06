import type { LeagueConfig, ZoneKind } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import type { ClubOutlook, HeadlineChance, LeagueOutlook } from "./clubOutlook.ts";
import type { OddsSnapshot } from "./snapshots.ts";

/*
 * Chance pages: one search question each, in every language. A league's
 * "{league} title odds" (/{league}/chances/title) and a club's "{club}'s
 * relegation chances" (/{league}/team/{club}/chances/relegation), for the
 * outcomes the league has. They read the shared outlook the league and club
 * pages read (no maths of their own): a club's headline chances.
 */

/** What a chance page is about, in this order. */
export const OUTCOMES = ["title", "promotion", "playoffs", "relegation"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const isOutcome = (value: string): value is Outcome => (OUTCOMES as readonly string[]).includes(value);

/**
 * A club's chance of an outcome: its headline chance of it. The title is the
 * table's or, where a play-off decides the champion (the MLS Cup), winning it.
 */
export function outcomeChance(club: Pick<ClubOutlook, "headline">, outcome: Outcome): HeadlineChance | undefined {
  if (outcome === "title") return club.headline.find((h) => h.kind === "title") ?? club.headline.find((h) => h.kind === "playoffWin");
  return club.headline.find((h) => h.kind === outcome);
}

/** The outcomes a league's pages cover: those its clubs' headline chances have. */
export function leagueOutcomes(outlook: Pick<LeagueOutlook, "clubs">): Outcome[] {
  const clubs = [...outlook.clubs.values()];
  return OUTCOMES.filter((o) => clubs.some((c) => outcomeChance(c, o)));
}

/** One club in a race: its chance of the outcome, and where it stands now. */
export interface RaceRow {
  teamId: TeamId;
  chance: number;
  position: number;
  points: number;
  played: number;
}

/** Every club's chance of an outcome, likeliest first (a tie: the higher place in the table). */
export function outcomeRace(outlook: Pick<LeagueOutlook, "clubs">, outcome: Outcome): RaceRow[] {
  return [...outlook.clubs.values()]
    .flatMap((c) => {
      const h = outcomeChance(c, outcome);
      return h ? [{ teamId: c.team.id, chance: h.chance, position: c.row.position, points: c.row.points, played: c.row.played }] : [];
    })
    .sort((a, b) => b.chance - a.chance || a.position - b.position || a.teamId - b.teamId);
}

/**
 * The race a club's page shows: the `size` likeliest, and the club itself
 * where it isn't among them (last, in its own place in the race).
 */
export function raceAround(race: readonly RaceRow[], teamId: TeamId, size = 8): RaceRow[] {
  const top = race.slice(0, size);
  const own = race.find((r) => r.teamId === teamId);
  return own && !top.includes(own) ? [...top, own] : top;
}

/** Shown as 1% to 99%: a question still open for the club. Its page is for search engines only then (and in the sitemap). */
export const OPEN_MIN = 0.01;
export const OPEN_MAX = 0.99;
export const isOpen = (chance: number) => chance >= OPEN_MIN && chance <= OPEN_MAX;

/** A league's chance page, without the locale: "/premier-league/chances/title". */
export const leagueChancePath = (league: Pick<LeagueConfig, "slug">, outcome: Outcome) => `/${league.slug}/chances/${outcome}`;
/** A club's chance page from its page ("/premier-league/team/arsenal"): "/premier-league/team/arsenal/chances/title". */
export const clubChancePath = (clubPage: string, outcome: Outcome) => `${clubPage}/chances/${outcome}`;

/**
 * The outcomes a league's snapshot holds: the same as its clubs' headline
 * (leagueOutcomes), from the places each snapshot keeps. For the sitemap,
 * which reads the snapshots rather than simulating every league.
 */
export function snapshotOutcomes(league: Pick<LeagueConfig, "playoff">, snapshot: OddsSnapshot): Outcome[] {
  const kinds = new Set(Object.values(snapshot.teams).flatMap((t) => Object.keys(t.chances)));
  const title = kinds.has("title");
  const has: Record<Outcome, boolean> = {
    title: title || Boolean(league.playoff?.title),
    promotion: kinds.has("promotion"),
    playoffs: !title && (kinds.has("playoffs") || kinds.has("titlePlayoffs")),
    relegation: kinds.has("relegation"),
  };
  return OUTCOMES.filter((o) => has[o]);
}

/** The messages' key of an outcome from a league's snapshot (see outcomeKey): the title as a play-off ("MLS Cup") has its own. */
export function snapshotOutcomeKey(league: Pick<LeagueConfig, "playoff">, snapshot: OddsSnapshot, outcome: Outcome): { key: string; name: string } {
  const title = Object.values(snapshot.teams).some((t) => t.chances.title !== undefined);
  return outcome === "title" && !title && league.playoff?.title ? { key: "titlePlayoff", name: league.playoff.title } : { key: outcome, name: "" };
}

/**
 * Whether an outcome is still open for a club in a snapshot (see isOpen). The
 * snapshot keeps each place's chance, not the headline's: promotion counts
 * the promotion play-off places too, a title play-off counts reaching it.
 */
export function snapshotOpen(outcome: Outcome, chances: Partial<Record<ZoneKind, number>>): boolean {
  const c = (kind: ZoneKind) => chances[kind] ?? 0;
  switch (outcome) {
    case "title":
      return chances.title !== undefined ? isOpen(c("title")) : Math.max(c("titlePlayoffs"), c("playoffs")) >= OPEN_MIN;
    case "promotion":
      return c("promotion") + c("promotionPlayoff") >= OPEN_MIN && c("promotion") <= OPEN_MAX;
    case "playoffs":
      return isOpen(Math.max(c("playoffs"), c("titlePlayoffs")));
    case "relegation":
      return isOpen(c("relegation"));
  }
}
