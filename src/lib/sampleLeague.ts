import type { CupConfig, CupRoundKey } from "../config/cups.ts";
import type { CompetitionCode, LeagueConfig } from "../config/leagues.ts";
import type { RealCupTie } from "../engine/cup.ts";
import { cupModelFor, tierStrength } from "../engine/cupModel.ts";
import { expectedGoals, simulateFixtures, simulateScore } from "../engine/match.ts";
import { simulatePenalties } from "../engine/playoffs.ts";
import type { LeagueModel, TeamStrength } from "../engine/ratings.ts";
import { createRng } from "../engine/rng.ts";
import { doubleRoundRobin } from "../engine/schedule.ts";
import type { Fixture, Team, TeamId } from "../engine/types.ts";
import type { CupData } from "./cupData.ts";

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
    // Leagues with reserve sides get two, so their promotion rules can be seen locally:
    // a prefix ("Jong ") gets a town, a full name ("Real Sociedad II") is used as is.
    const reserve = league.reserveTeams?.[i % league.reserveTeams.length];
    const name =
      reserve && i < 2 && (reserve.endsWith(" ") || i < league.reserveTeams!.length)
        ? reserve.endsWith(" ") ? `${reserve}${town}` : reserve
        : `${town} ${SUFFIXES[(offset + i * 3) % SUFFIXES.length]}`;
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

/**
 * A fictional cup for local development and tests: 80 first-round clubs (half
 * of the ties played, one on penalties) and 44 top-two-division clubs waiting
 * for the third round.
 */
export function sampleCup(cup: CupConfig): CupData {
  const rng = createRng(hash(cup.code));
  const teams: Team[] = [];
  const divisions: Record<TeamId, CompetitionCode> = {};
  const strengths: Record<TeamId, TeamStrength> = {};
  const club = (id: TeamId, name: string, shortName: string, division: CompetitionCode | undefined, tier: number | undefined) => {
    teams.push({ id, name, shortName, tla: shortName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() });
    if (division) divisions[id] = division;
    if (tier !== undefined) {
      const quality = rng() * 2 - 1;
      const scale = tierStrength(tier);
      strengths[id] = { attack: Math.exp(0.3 * quality) * scale.attack, defence: Math.exp(-0.3 * quality) * scale.defence };
    }
  };
  // Clubs entering later: 20 "FC Town" (top division) and 24 "Town County" (second).
  const entrantLeagues = cup.rounds.find((r) => r.entrantsFrom)?.entrantsFrom ?? [];
  const entrants: Partial<Record<CupRoundKey, TeamId[]>> = {};
  const later: TeamId[] = [];
  for (let i = 0; i < 20; i++) {
    club(i + 1, `FC ${TOWNS[i]!}`, TOWNS[i]!, entrantLeagues[0], 0);
    later.push(i + 1);
  }
  for (let i = 0; i < 24; i++) {
    club(101 + i, `${TOWNS[(i + 5) % TOWNS.length]!} County`, TOWNS[(i + 5) % TOWNS.length]!, entrantLeagues[1], 1);
    later.push(101 + i);
  }
  const entrantRound = cup.rounds.find((r) => r.entrantsFrom);
  if (entrantRound) entrants[entrantRound.key] = later;
  // First round: 24 third-tier clubs, 24 fourth-tier clubs and 32 non-league sides.
  const first: TeamId[] = [];
  for (let i = 0; i < 80; i++) {
    const town = TOWNS[(i * 7) % TOWNS.length]!;
    const id = 1001 + i;
    const division = i < 24 ? cup.feederLeagues[2] : i < 48 ? cup.feederLeagues[3] : undefined;
    club(id, `${town} ${SUFFIXES[i % SUFFIXES.length]!}`, town, division, i < 24 ? 2 : i < 48 ? 3 : undefined);
    first.push(id);
  }

  const day = 86_400_000;
  const played = new Date(Date.now() - 3 * day);
  played.setUTCHours(15, 0, 0, 0);
  const upcoming = new Date(played.getTime() + 7 * day);
  const model = cupModelFor(new Map(Object.entries(strengths).map(([id, s]) => [Number(id), s])), first);
  const firstRound = cup.rounds[0]!;
  const real: RealCupTie[] = [];
  for (let t = 0; t < firstRound.ties; t++) {
    const homeId = first[(t * 2 + 3) % first.length]!;
    const awayId = first[(t * 2 + 4) % first.length]!;
    const done = t < firstRound.ties / 2;
    const fixture: Fixture = { id: 900_000 + t, matchday: 1, utcDate: (done ? played : upcoming).toISOString(), homeId, awayId, result: null };
    if (done) {
      // Tie 0 goes to penalties so the shoot-out display can be seen locally.
      const score = t === 0 ? { home: 1, away: 1 } : simulateScore(expectedGoals(model, homeId, awayId), rng);
      fixture.result = score;
      if (score.home === score.away) fixture.penalties = simulatePenalties(rng);
    }
    real.push({ round: firstRound.key, homeId, awayId, fixture });
  }
  const roundDates: Partial<Record<CupRoundKey, string>> = {};
  cup.rounds.forEach((round, r) => {
    roundDates[round.key] = new Date(upcoming.getTime() + r * 28 * day).toISOString();
  });
  const year = new Date().getUTCFullYear();
  return {
    teams,
    real,
    entrants,
    roundDates,
    divisions,
    strengths,
    season: `${year}/${String(year + 1).slice(2)}`,
    seasonKey: `${cup.code}:sample`,
    source: "sample",
  };
}
