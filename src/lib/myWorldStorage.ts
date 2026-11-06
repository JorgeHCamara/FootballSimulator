import { ENGLAND, WORLD_VERSION, type World } from "./myWorld.ts";

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
/** A season's scores so far (DivisionSeason.scores): game id to [home goals, away goals]. */
const isScores = (value: unknown) => value === undefined || (isRecord(value) && Object.values(value).every((s) => Array.isArray(s) && s.length === 2 && s.every(isGoals)));

/** The parts a page needs to show a world, checked: anything else counts as unreadable. */
export function isWorld(value: unknown): value is World {
  if (!isRecord(value) || value.version !== WORLD_VERSION || value.pyramid !== "ENG") return false;
  const { clubs, ratings, divisions, history, params } = value;
  if (!isNumber(value.year) || !isNumber(value.seed) || !isNumber(value.userClub) || !isNumber(value.newClubs) || typeof value.review !== "boolean") return false;
  if (!isRecord(clubs) || !isRecord(ratings) || !isRecord(params) || !Array.isArray(divisions) || !Array.isArray(history)) return false;
  if (!isRecord(clubs[String(value.userClub)])) return false;
  if (divisions.length !== ENGLAND.length || !divisions.every((d, i) => isRecord(d) && d.code === ENGLAND[i] && Array.isArray(d.clubs) && d.clubs.every((id) => isRecord(clubs[String(id)])) && isScores(d.scores))) return false;
  if (!ENGLAND.every((code) => isRecord(params[code]) && isNumber(params[code].avgHomeGoals) && isNumber(params[code].avgAwayGoals))) return false;
  return history.every(
    (s) =>
      isRecord(s) &&
      isNumber(s.year) &&
      Array.isArray(s.divisions) &&
      s.divisions.every((d) => isRecord(d) && typeof d.code === "string" && Array.isArray(d.rows) && d.rows.every((r) => Array.isArray(r) && r.length === 9 && isRecord(clubs[String(r[0])]))),
  );
}

/** The saved world, if there is a usable one; a save that can't be used is removed. */
export function loadWorld(store: Store | undefined): LoadResult {
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
  return { world: value };
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
