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
