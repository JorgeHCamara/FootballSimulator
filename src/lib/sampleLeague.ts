import type { LeagueConfig } from "../config/leagues.ts";
import { simulateFixtures } from "../engine/match.ts";
import type { LeagueModel } from "../engine/ratings.ts";
import { createRng } from "../engine/rng.ts";
import { doubleRoundRobin } from "../engine/schedule.ts";
import type { Fixture, Team } from "../engine/types.ts";

// Deterministic, clearly fictional leagues used when no football-data.org API key
// is configured, so the site runs locally out of the box. No real clubs are used:
// generated results must never pass for real ones.

const TOWNS = [
  "Northbridge", "Ashford Vale", "Kingsport", "Millbrook", "Redcastle", "Stonehaven",
  "Westmere", "Oakhurst", "Ravenford", "Silverton", "Eastwick", "Highcliff",
  "Lakeside", "Brightwater", "Thornbury", "Fairhaven", "Greywood", "Port Alder",
  "Elmstead", "Copperfield", "Marlow Heath", "Dunmore", "Westbury", "Hollowmere",
  "Kestrel Bay", "Ironbridge", "Cedar Falls", "Pinecrest", "Harborview", "Granite Ridge",
];
const SUFFIXES = ["FC", "United", "City", "Athletic", "Rovers", "Wanderers", "Town", "Albion"];

const hash = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

export interface SampleLeague {
  teams: Team[];
  fixtures: Fixture[];
}

export function sampleLeague(league: LeagueConfig, playedShare = 0.4): SampleLeague {
  const rng = createRng(hash(league.code));
  const offset = hash(league.code) % TOWNS.length;
  const teams: Team[] = Array.from({ length: league.teams }, (_, i) => {
    const town = TOWNS[(offset + i) % TOWNS.length]!;
    const name = `${town} ${SUFFIXES[(offset + i * 3) % SUFFIXES.length]}`;
    return { id: i + 1, name, shortName: town, tla: town.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() };
  });

  // Hidden "true" strengths so the generated first part of the season has a
  // believable spread between strong and weak sides.
  const truth: LeagueModel = {
    avgHomeGoals: 1.55,
    avgAwayGoals: 1.25,
    strengths: new Map(
      teams.map((t) => {
        const quality = rng() * 2 - 1;
        return [t.id, { attack: Math.exp(0.35 * quality), defence: Math.exp(-0.3 * quality) }];
      }),
    ),
  };

  // Season starts so that the played share of matchdays lies in the past.
  const rounds = (league.teams - 1) * 2;
  const playedRounds = Math.round(rounds * playedShare);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const start = new Date(Date.now() - playedRounds * weekMs + weekMs / 2);
  start.setUTCHours(15, 0, 0, 0);

  const schedule = doubleRoundRobin(teams.map((t) => t.id), start.toISOString());
  const played = schedule.filter((f) => f.matchday <= playedRounds);
  const results = simulateFixtures(played, {}, truth, rng);
  const fixtures = schedule.map((f) => ({ ...f, result: results[f.id] ?? null }));
  return { teams, fixtures };
}
