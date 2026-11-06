import { gamesPerTeam, type LeagueConfig, type SiteLocale, type Zone } from "../config/leagues.ts";
import { groupPlaces, placedGroups } from "../engine/split.ts";

/**
 * What a domestic league's page says about its format, built from the same
 * config the simulator runs on so the two can't drift apart. Wording lives in
 * the "Facts" messages; this only says which sentences apply, with their numbers.
 */
export type LeagueFact =
  | { kind: "clubs"; clubs: number }
  /** Each club meets every other `times` times (`games` in all); `perTournament` for Apertura/Clausura leagues. */
  | {
      kind: "roundRobin";
      times: number;
      games: number;
      perTournament: boolean;
      /** A split into new tables: the round robin is its first phase (named, or "the regular season"). */
      firstPhase?: { name?: Record<SiteLocale, string> };
    }
  /** No whole number of meetings (MLS): just the games. */
  | { kind: "games"; games: number; perTournament: boolean }
  | { kind: "tournaments"; names: string[] }
  /** A split into new tables: each group's places at the split, and the share of points it keeps. */
  | {
      kind: "split";
      afterRound?: number;
      groups: { from: number; to: number; name: Record<SiteLocale, string>; carryOver: number; legs: 1 | 2 }[];
    }
  /** A split into groups of named places (Série C: 1st, 4th, 5th and 8th…), from zero points; the other clubs are out. */
  | { kind: "splitPlaced"; afterRound: number; groups: { places: number[]; name: Record<SiteLocale, string> }[] }
  /** Scotland: the halves play once more and stay apart. */
  | { kind: "splitHalves"; afterRound: number; top: number; bottom: number }
  | { kind: "tables"; names: Record<SiteLocale, string>[] }
  | { kind: "titlePlayoff"; perTournament: boolean }
  | { kind: "annual" };

export interface LeagueFacts {
  facts: LeagueFact[];
  /** Where each place leads, over the whole table (a split's groups placed after each other). */
  places: Zone[];
  /** Places are within each table (MLS conferences), or in the annual table. */
  placesScope: "table" | "eachTable" | "annual";
  /** Some places lead to a continental competition (they can shift with cup winners and rankings). */
  continentalPlaces: boolean;
}

/** Places that lead to a continental competition. */
export const CONTINENTAL: ReadonlySet<string> = new Set([
  "championsLeague",
  "championsLeagueQualifying",
  "europaLeague",
  "conferenceLeague",
  "conferenceLeaguePlayoff",
  "libertadores",
  "libertadoresQualifying",
  "sudamericana",
  "aclElite",
  "aclEliteQualifying",
  "aclTwo",
  "gulfClub",
]);

/** Facts for a domestic league; null for continental competitions (their pages explain their own format). */
export function leagueFacts(league: LeagueConfig): LeagueFacts | null {
  if (league.continental) return null;
  const facts: LeagueFact[] = [{ kind: "clubs", clubs: league.teams }];
  const tournaments = league.espn?.stages && !("table" in league.espn.stages) ? [...league.espn.stages].reverse() : [];
  const split = league.split;
  // Games in the round robin: a split's first phase only.
  const roundRobin = split ? (split.afterRound ?? 2 * (league.teams - 1)) : gamesPerTeam(league);
  const times = roundRobin / (league.teams - 1);
  if (Number.isInteger(times)) {
    facts.push({
      kind: "roundRobin",
      times,
      games: roundRobin,
      perTournament: tournaments.length > 1,
      ...(split && league.groups ? { firstPhase: split.firstPhaseName ? { name: split.firstPhaseName } : {} } : {}),
    });
  } else {
    facts.push({ kind: "games", games: roundRobin, perTournament: tournaments.length > 1 });
  }
  if (tournaments.length > 1) facts.push({ kind: "tournaments", names: tournaments.map((t) => t.name ?? t.table) });

  let places: readonly Zone[] = league.zones;
  let placesScope: LeagueFacts["placesScope"] = "table";
  if (split && league.groups && placedGroups(split.groups)) {
    // Groups of named places, then a final (Série C): the places over every club are its final classification.
    const named = groupPlaces(split.groups, league.teams);
    facts.push({ kind: "splitPlaced", afterRound: split.afterRound ?? roundRobin, groups: named.map((places, i) => ({ places, name: league.groups![i]!.name })) });
    places = split.finalZones ?? league.zones;
  } else if (split && league.groups) {
    // Each group's own places, after the groups before it.
    let start = 0;
    const groups = split.groups.map((g, i) => {
      const size = i === split.groups.length - 1 ? league.teams - start : g.size;
      const out = { from: start + 1, to: start + size, name: league.groups![i]!.name, carryOver: g.carryOver ?? 1, legs: g.legs };
      start += size;
      return out;
    });
    facts.push({ kind: "split", ...(split.afterRound !== undefined ? { afterRound: split.afterRound } : {}), groups });
    places = groups.flatMap((g, i) => (league.groups![i]!.zones ?? []).map((z) => ({ kind: z.kind, from: z.from + g.from - 1, to: z.to + g.from - 1 })));
  } else if (split) {
    const top = split.groups[0]?.size ?? 0;
    facts.push({ kind: "splitHalves", afterRound: split.afterRound ?? roundRobin, top, bottom: league.teams - top });
  } else if (league.groups) {
    facts.push({ kind: "tables", names: league.groups.map((g) => g.name) });
    placesScope = "eachTable";
  }
  if (league.playoff?.title) facts.push({ kind: "titlePlayoff", perTournament: tournaments.length > 1 });
  if (league.annual) {
    facts.push({ kind: "annual" });
    places = league.annual.zones;
    placesScope = "annual";
  }
  return { facts, places: [...places].sort((a, b) => a.from - b.from), placesScope, continentalPlaces: places.some((z) => CONTINENTAL.has(z.kind)) };
}
