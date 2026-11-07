import { WORLD_COUNTRIES, WORLD_CUPS, WORLD_LEAGUES } from "./worldCountries.ts";

/*
 * The My World page's hero (src/components/WorldHero.tsx): what it says about
 * the mode is counted from the config, never written out, so it stays right
 * as countries, leagues and cups are added.
 */

export interface WorldFacts {
  countries: number;
  leagues: number;
  cups: number;
}

/** How much a world can play today: its countries, their leagues and their cups. */
export const worldFacts = (): WorldFacts => ({ countries: WORLD_COUNTRIES.length, leagues: WORLD_LEAGUES.length, cups: WORLD_CUPS.length });

/** The hero's four steps, each with its Lucide icon (the words are World.how.<step>). */
export const HOW_STEPS = [
  { key: "pick", icon: "globe" },
  { key: "play", icon: "dices" },
  { key: "season", icon: "trophy" },
  { key: "again", icon: "history" },
] as const;
export type HowStep = (typeof HOW_STEPS)[number]["key"];

/** The id of the game below the hero (the set-up, or the saved world): the hero's button scrolls to it. */
export const PLAY_ANCHOR = "play";
