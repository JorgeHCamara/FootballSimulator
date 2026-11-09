import { isWorldCountry, upgradeWorld, WORLD_VERSION, worldDivisions, type StartPack, type World, type WorldCountry } from "./myWorld.ts";
import { isPackedCupTies, isWorldCup } from "./worldCups.ts";

/*
 * My World's save: one world per browser, in localStorage (no account, no
 * server). It is written after every step (a new world, every score typed in,
 * rolled or simulated, a round or a season played, the next season started),
 * so a refresh loses nothing. A save from another
 * version, or one that can't be read, is set aside and a new world starts:
 * it never breaks the page.
 */

export const WORLD_KEY = "footsimu:my-world";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What loading found: the world, or why there is none ("none": nothing saved; "incompatible": an older version's; "unreadable": broken; "unavailable": no storage). */
export type LoadResult = { world: World; reason?: undefined } | { world: null; reason: "none" | "incompatible" | "unreadable" | "unavailable" };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isGoals = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 99;
/** A season's scores so far (DivisionSeason.scores), or a past play-off's: game id to [home goals, away goals]. */
const isScores = (value: unknown) => value === undefined || (isRecord(value) && Object.values(value).every((s) => Array.isArray(s) && s.length === 2 && s.every(isGoals)));
/** A finished season's packed games (SavedDivision.games): five characters a game, its clubs among the table's. */
const isPackedGames = (value: unknown, clubs: number) => {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length % 5 !== 0) return false;
  for (let i = 0; i < value.length; i += 5) {
    const home = value.charCodeAt(i + 1) - 48;
    const away = value.charCodeAt(i + 2) - 48;
    if (home < 0 || home >= clubs || away < 0 || away >= clubs) return false;
  }
  return true;
};

/** A cup tie a season started with (WorldCupTie): its clubs, each leg's score or null, its shoot-out. */
const isCupTie = (value: unknown, clubs: Record<string, unknown>) =>
  isRecord(value) &&
  typeof value.round === "string" &&
  isRecord(clubs[String(value.homeId)]) &&
  isRecord(clubs[String(value.awayId)]) &&
  Array.isArray(value.legs) &&
  value.legs.length >= 1 &&
  value.legs.length <= 2 &&
  value.legs.every((leg) => leg === null || (Array.isArray(leg) && leg.length === 2 && leg.every(isGoals))) &&
  (value.penalties === undefined || (Array.isArray(value.penalties) && value.penalties.length === 2 && value.penalties.every(isGoals)));
/** A cup's season in progress (WorldCupSeason): its entrants, the ties it started with, its scores. */
const isCupSeason = (value: unknown, clubs: Record<string, unknown>) =>
  isRecord(value) &&
  typeof value.code === "string" &&
  isWorldCup(value.code) &&
  isRecord(value.entrants) &&
  Object.values(value.entrants).every((ids) => Array.isArray(ids) && ids.every((id) => isRecord(clubs[String(id)]))) &&
  (value.real === undefined || (Array.isArray(value.real) && value.real.every((t) => isCupTie(t, clubs)))) &&
  isScores(value.scores) &&
  (value.draw === undefined || value.draw === 2);
/** A finished season's cup (SavedCup): its final, and its ties when kept. */
const isSavedCup = (value: unknown, clubs: Record<string, unknown>) =>
  isRecord(value) &&
  typeof value.code === "string" &&
  Array.isArray(value.final) &&
  value.final.length === 5 &&
  isRecord(clubs[String(value.final[0])]) &&
  isRecord(clubs[String(value.final[1])]) &&
  isGoals(value.final[2]) &&
  isGoals(value.final[3]) &&
  typeof value.final[4] === "boolean" &&
  (value.ties === undefined ||
    (Array.isArray(value.clubs) &&
      value.clubs.every((id) => isRecord(clubs[String(id)])) &&
      Array.isArray(value.rounds) &&
      value.rounds.every((r) => Array.isArray(r) && r.length === 2 && typeof r[0] === "string" && (r[1] === 1 || r[1] === 2)) &&
      isPackedCupTies(value.ties, value.clubs.length, value.rounds.length)));

/** Série C's first-phase groups (from 2028): two lists of its clubs, every one in exactly one. */
const isGroups = (value: unknown, clubs: unknown[]) =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length === 2 &&
    value.every((g) => Array.isArray(g) && g.every((id) => clubs.includes(id))) &&
    value.reduce((n: number, g: unknown[]) => n + g.length, 0) === clubs.length);

/** The parts a page needs to show a world, checked: anything else counts as unreadable. */
export function isWorld(value: unknown): value is World {
  if (!isRecord(value) || value.version !== WORLD_VERSION || value.pyramid !== "ENG") return false;
  const { clubs, ratings, divisions, history, params } = value;
  if (!isNumber(value.year) || !isNumber(value.seed) || !isNumber(value.userClub) || !isNumber(value.newClubs) || typeof value.review !== "boolean") return false;
  if (!isRecord(clubs) || !isRecord(ratings) || !isRecord(params) || !Array.isArray(divisions) || !Array.isArray(history)) return false;
  // The club levels (absent from saves from before them: upgradeWorld starts them from the ratings).
  if (value.levels !== undefined && !isRecord(value.levels)) return false;
  // The world's countries (absent from saves from before the choice: England's).
  if (value.countries !== undefined && !(Array.isArray(value.countries) && value.countries.length > 0 && value.countries.every((c) => typeof c === "string" && isWorldCountry(c)))) return false;
  // The National League's clubs (absent from saves from before it: upgradeWorld adds it).
  if (value.nationalLeague !== undefined && !(Array.isArray(value.nationalLeague) && value.nationalLeague.every((id) => isRecord(clubs[String(id)])))) return false;
  // The cups and the FA Cup's non-league sides (absent from saves from before them: upgradeWorld draws them).
  if (value.cups !== undefined && !(Array.isArray(value.cups) && value.cups.every((c) => isCupSeason(c, clubs)))) return false;
  if (value.cupPool !== undefined && !(Array.isArray(value.cupPool) && value.cupPool.every((id) => isRecord(clubs[String(id)])))) return false;
  // Past Winners (absent from saves from before it: upgradeWorld fills it from the finished seasons).
  if (
    value.winners !== undefined &&
    !(
      Array.isArray(value.winners) &&
      value.winners.every(
        (w) =>
          isRecord(w) &&
          isNumber(w.year) &&
          typeof w.code === "string" &&
          Array.isArray(w.top) &&
          w.top.every((p) => Array.isArray(p) && p.length === 3 && isRecord(clubs[String(p[0])]) && typeof p[1] === "string" && isNumber(p[2])),
      )
    )
  )
    return false;
  if (!isRecord(clubs[String(value.userClub)])) return false;
  // The divisions of the world's countries (England's for a save from before the choice), in order.
  const expected = worldDivisions((value.countries as WorldCountry[] | undefined) ?? ["ENG"]);
  if (divisions.length !== expected.length || !divisions.every((d, i) => isRecord(d) && d.code === expected[i] && Array.isArray(d.clubs) && d.clubs.every((id) => isRecord(clubs[String(id)])) && isScores(d.scores) && (d.calendar === undefined || d.calendar === 2) && isGroups(d.groups, d.clubs))) return false;
  if (!expected.every((code) => isRecord(params[code]) && isNumber(params[code].avgHomeGoals) && isNumber(params[code].avgAwayGoals))) return false;
  return history.every(
    (s) =>
      isRecord(s) &&
      isNumber(s.year) &&
      Array.isArray(s.divisions) &&
      s.divisions.every(
        (d) =>
          isRecord(d) &&
          typeof d.code === "string" &&
          Array.isArray(d.rows) &&
          d.rows.every((r) => Array.isArray(r) && r.length === 9 && isRecord(clubs[String(r[0])])) &&
          isPackedGames(d.games, d.rows.length) &&
          isScores(d.playoff),
      ) &&
      (s.cups === undefined || (Array.isArray(s.cups) && s.cups.every((c) => isSavedCup(c, clubs)))),
  );
}

/** The saved world, if there is a usable one (brought up to date, see upgradeWorld; `pack`: the live data it may need for that); a save that can't be used is removed. */
export function loadWorld(store: Store | undefined, pack?: StartPack): LoadResult {
  if (!store) return { world: null, reason: "unavailable" };
  let text: string | null;
  try {
    text = store.getItem(WORLD_KEY);
  } catch {
    return { world: null, reason: "unavailable" };
  }
  if (text === null) return { world: null, reason: "none" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    clearWorld(store);
    return { world: null, reason: "unreadable" };
  }
  if (isRecord(value) && value.version !== WORLD_VERSION) {
    clearWorld(store);
    return { world: null, reason: "incompatible" };
  }
  if (!isWorld(value)) {
    clearWorld(store);
    return { world: null, reason: "unreadable" };
  }
  // Brought up to date: a season not yet being played takes the realistic calendar, a world from before the cups gets them (see upgradeWorld).
  return { world: upgradeWorld(value, pack) };
}

/** Saves the world; false when the browser won't keep it (private browsing, storage full): the world goes on, unsaved. */
export function saveWorld(store: Store | undefined, world: World): boolean {
  if (!store) return false;
  try {
    store.setItem(WORLD_KEY, JSON.stringify(world));
    return true;
  } catch {
    return false;
  }
}

/** Deletes the saved world (a new world, or a save that can't be read). */
export function clearWorld(store: Store | undefined): void {
  try {
    store?.removeItem(WORLD_KEY);
  } catch {
    // Nothing to do: it can't be read either.
  }
}

/** The browser's storage, when the page may use it. */
export function browserStore(): Store | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
