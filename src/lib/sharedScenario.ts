import { getLeagueBySlug, type LeagueConfig } from "../config/leagues.ts";
import type { ResultMap } from "../engine/types.ts";
import { getLeagueData, type LeagueData } from "./leagueData.ts";
import { decodeResults } from "./shareCodec.ts";
import { shareCardSupported, shareFixtureList } from "./splitSetup.ts";

export interface SharedScenario {
  league: LeagueConfig;
  data: LeagueData;
  /** The predictions in the link, or null if it doesn't match this season's fixtures. */
  predictions: ResultMap | null;
}

/**
 * A share link's league and predictions (decoded from the link itself:
 * nothing is stored). Undefined for an unknown league or one whose links
 * open its league page instead (see shareCardSupported).
 */
export async function loadSharedScenario(slug: string, code: string): Promise<SharedScenario | undefined> {
  const league = getLeagueBySlug(slug);
  if (!league || !shareCardSupported(league)) return undefined;
  const data = await getLeagueData(league);
  const predictions = decodeResults(shareFixtureList(league, data.fixtures, data.teams, data.groups), code);
  return { league, data, predictions };
}
