import type { Team } from "../engine/types.ts";

// Crests for clubs ESPN has none for, from TheSportsDB (thesportsdb.com,
// community-uploaded artwork), matched by hand-checked script and saved under
// public/crests. Regenerate: NODE_USE_ENV_PROXY=1 node scripts/fetch-crests.mjs --download

export const CREST_FALLBACKS: Readonly<Record<number, string>> = {};

/** Gives clubs without a crest the saved one, keyed by ESPN team id; ESPN's own crests stay. */
export function withFallbackCrests(teams: readonly Team[]): Team[] {
  return teams.map((team) => (team.crest || !CREST_FALLBACKS[team.id] ? team : { ...team, crest: CREST_FALLBACKS[team.id] }));
}
