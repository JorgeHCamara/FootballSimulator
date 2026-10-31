import type { Team } from "../engine/types.ts";

// Display-name overrides for clubs whose football-data.org name isn't the one
// fans use. Only names, codes and crests change: simulations, saved predictions
// and share links work on team ids, so they are unaffected.
//
// `match` can be:
// - the football-data.org team id (never changes; find it in the API's
//   /v4/competitions/{code}/teams response), or
// - the club's name or short name as the API sends it (case-insensitive).
//   If a club still shows its old name, copy the exact name the site shows here.

export interface TeamOverride {
  match: number | string;
  /** Full name, shown in the table on wider screens. */
  name?: string;
  /** Short name, shown in fixtures and on phones. */
  shortName?: string;
  /** Three-letter code, shown in the badge when there is no crest. */
  tla?: string;
  /** Replacement crest image URL. */
  crest?: string;
}

export const TEAM_OVERRIDES: readonly TeamOverride[] = [
  { match: "CA Paranaense", name: "Athletico Paranaense", shortName: "Athletico-PR", tla: "CAP" },
];

const normalize = (text: string) => text.trim().toLowerCase();

function matches(team: Team, override: TeamOverride): boolean {
  if (typeof override.match === "number") return team.id === override.match;
  const wanted = normalize(override.match);
  return normalize(team.name) === wanted || normalize(team.shortName) === wanted;
}

export function applyTeamOverrides(teams: readonly Team[], overrides: readonly TeamOverride[] = TEAM_OVERRIDES): Team[] {
  return teams.map((team) => {
    const override = overrides.find((o) => matches(team, o));
    if (!override) return team;
    const { match: _match, ...fields } = override;
    return { ...team, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
  });
}
