// Core domain types for the simulation engine.
// This module (and everything in src/engine) must stay free of React/Next so it
// can run in the browser, in a Web Worker and on the server (phase 2 career mode).

export type TeamId = number;
export type FixtureId = number;

export interface Team {
  id: TeamId;
  name: string;
  shortName: string;
  tla: string;
  crest?: string;
  /** URL slug of the club's own page, unique within its league ("sao-paulo"). */
  slug?: string;
  /** The club's page, without the locale ("/brasileirao/team/sao-paulo"); set for clubs of domestic leagues. */
  page?: string;
}

export interface Score {
  home: number;
  away: number;
}

export interface Fixture {
  id: FixtureId;
  matchday: number;
  utcDate: string;
  homeId: TeamId;
  awayId: TeamId;
  /** Real-world result, present only once the match has finished. */
  result: Score | null;
  /** Played at a neutral ground (e.g. a play-off final): no home advantage. */
  neutral?: boolean;
  /** Real penalty shoot-out score (home first), for a knockout game decided on penalties. */
  penalties?: Score;
}

/** Scores keyed by fixture id (user predictions, simulated results, or both). */
export type ResultMap = Record<FixtureId, Score>;

export type FormResult = "W" | "D" | "L";

export interface StandingRow {
  position: number;
  teamId: TeamId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** Most recent last, at most 5 entries. */
  form: FormResult[];
}

export type Tiebreaker =
  | "points"
  | "wins"
  | "goalDifference"
  | "goalsFor"
  | "awayGoalsFor"
  | "headToHeadPoints"
  | "headToHeadGoalDifference"
  | "headToHeadGoalsFor"
  | "headToHeadAwayGoalsFor";
