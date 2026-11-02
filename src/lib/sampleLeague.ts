import type { CupConfig, CupRoundKey } from "../config/cups.ts";
import { LEAGUES, gamesPerTeam, type CompetitionCode, type LeagueConfig } from "../config/leagues.ts";
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
  // A continental league phase (UEFA) plays only the first rounds of a round robin:
  // each club meets 8 (or 6) different opponents.
  const rounds = league.continental ? gamesPerTeam(league) : (league.teams - 1) * 2;
  const playedRounds = Math.round(rounds * playedShare);
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const start = new Date(Date.now() - playedRounds * weekMs + weekMs / 2);
  start.setUTCHours(15, 0, 0, 0);

  // A continental group stage (Libertadores) plays within each group, split in
  // order like the sample groups in leagueData.ts.
  const groupCount = league.continental ? (league.groups?.length ?? 0) : 0;
  const size = groupCount ? Math.ceil(teams.length / groupCount) : teams.length;
  const chunks = Array.from({ length: Math.max(groupCount, 1) }, (_, g) => teams.slice(g * size, (g + 1) * size).map((t) => t.id));
  const schedule = chunks
    .flatMap((ids) => doubleRoundRobin(ids, start.toISOString()))
    .filter((f) => f.matchday <= rounds)
    .map((f, i) => ({ ...f, id: i + 1 }));
  const played = schedule.filter((f) => f.matchday <= playedRounds);
  const results = simulateFixtures(played, {}, truth, rng);
  const fixtures = schedule.map((f) => ({ ...f, result: results[f.id] ?? null }));
  return { teams, fixtures };
}

/**
 * A fictional cup for local development and tests, for any round structure:
 * the first round's clubs come from the lower feeder leagues and outsiders,
 * every later round gets the entrants it needs (feeder-league clubs for rounds
 * with `entrantsFrom`, outsiders otherwise), and half of the first round is
 * played (one tie on penalties).
 */
export function sampleCup(cup: CupConfig): CupData {
  const rng = createRng(hash(cup.code));
  const teams: Team[] = [];
  const divisions: Record<TeamId, CompetitionCode> = {};
  const strengths: Record<TeamId, TeamStrength> = {};
  let nextId = 1;
  const club = (division: CompetitionCode | undefined, tier: number): TeamId => {
    const id = nextId++;
    const town = TOWNS[(id * 7) % TOWNS.length]!;
    const name = division === cup.feederLeagues[0] ? `FC ${town}` : division === cup.feederLeagues[1] ? `${town} County` : `${town} ${SUFFIXES[id % SUFFIXES.length]!}`;
    teams.push({ id, name, shortName: town, tla: town.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() });
    if (division) divisions[id] = division;
    const quality = rng() * 2 - 1;
    const scale = tierStrength(tier);
    strengths[id] = { attack: Math.exp(0.3 * quality) * scale.attack, defence: Math.exp(-0.3 * quality) * scale.defence };
    return id;
  };
  const leagueSize = (code: CompetitionCode) => LEAGUES.find((l) => l.code === code)?.teams ?? 20;
  const entering = new Set(cup.rounds.flatMap((r) => r.entrantsFrom ?? []));

  const entrants: Partial<Record<CupRoundKey, TeamId[]>> = {};
  const first: TeamId[] = [];
  cup.rounds.forEach((round, r) => {
    const needed = round.ties * 2 - (r === 0 ? 0 : cup.rounds[r - 1]!.ties);
    if (needed <= 0) return;
    const ids: TeamId[] = [];
    if (round.entrantsFrom) {
      for (const code of round.entrantsFrom) {
        const tier = cup.feederLeagues.indexOf(code);
        for (let i = 0; i < leagueSize(code) && ids.length < needed; i++) ids.push(club(code, tier));
      }
    } else if (r === 0) {
      // Feeder leagues that don't enter later start here, then outsiders.
      cup.feederLeagues.forEach((code, tier) => {
        if (entering.has(code)) return;
        for (let i = 0; i < leagueSize(code) && ids.length < needed; i++) ids.push(club(code, tier));
      });
    }
    while (ids.length < needed) ids.push(club(undefined, cup.outsiderTier));
    if (r === 0) first.push(...ids);
    else entrants[round.key] = ids;
  });

  const day = 86_400_000;
  const played = new Date(Date.now() - 3 * day);
  played.setUTCHours(15, 0, 0, 0);
  const upcoming = new Date(played.getTime() + 7 * day);
  const model = cupModelFor(new Map(Object.entries(strengths).map(([id, st]) => [Number(id), st])), first, cup.outsiderTier);
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
    real.push({ round: firstRound.key, homeId, awayId, legs: [fixture] });
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
    season: cup.espn.seasons === "split" ? `${year}/${String(year + 1).slice(2)}` : String(year),
    seasonKey: `${cup.code}:sample`,
    source: "sample",
  };
}
