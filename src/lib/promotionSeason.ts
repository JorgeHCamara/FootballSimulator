// A season of tournaments whose champions and annual table decide promotion
// (Colombia's Primera B, LeagueConfig.promotionPath): each tournament played
// as the simulator plays it (its round robin, its groups, its final), the
// aggregate table of every game, then the promotion path (see
// src/engine/promotionPath.ts) and its two-legged ties.

import type { LeagueConfig } from "../config/leagues.ts";
import { simulateFixtures } from "../engine/match.ts";
import { buildBracket, seedByGroupPlace, simulatePlayoff, tieOutcome, type PlayoffTie } from "../engine/playoffs.ts";
import { knownLegs, playTie, promotionPath, promotionTie, tieWinner, type PromotionPath, type PromotionTie } from "../engine/promotionPath.ts";
import type { LeagueModel } from "../engine/ratings.ts";
import { realResults } from "../engine/results.ts";
import { createRng, type Rng } from "../engine/rng.ts";
import { buildSplitPhase, splitGroupTable } from "../engine/split.ts";
import { computeStandings, sortFixtures } from "../engine/standings.ts";
import type { Fixture, ResultMap, StandingRow, Team, TeamId } from "../engine/types.ts";
import type { LeagueData, Tournament } from "./leagueData.ts";

/** One tournament as played: its champion (null while a game is missing), and every game with its score. */
interface Played {
  champion: TeamId | null;
  /** Its games with a score (round robin, groups, final legs), for the aggregate table. */
  games: Fixture[];
  results: ResultMap;
}

/**
 * Plays a tournament: its games with a result in `known` (real ones and the
 * user's predictions) as they are, the others drawn from the model when
 * there is an `rng` (else the champion stays null until they all have one).
 */
function playTournament(league: LeagueConfig, teams: readonly Team[], tournament: Tournament, known: ResultMap, model: LeagueModel | null, rng: Rng | null): Played {
  const split = league.split;
  const playoff = league.playoff;
  const fixtures = tournament.fixtures;
  const results: ResultMap = { ...realResults(fixtures), ...known };
  if (rng && model) Object.assign(results, simulateFixtures(fixtures, results, model, rng, { fast: true }));
  if (!split || !playoff) return { champion: null, games: fixtures, results };
  const options = { tiebreakers: league.tiebreakers };
  const phase = buildSplitPhase({
    teams,
    fixtures,
    results,
    groups: split.groups,
    afterRound: split.afterRound ?? 0,
    ...(tournament.groups?.length ? { realGroups: (league.groups ?? []).map((g) => tournament.groups!.find((m) => m.id === g.id)?.teamIds ?? []) } : {}),
    options,
  });
  if (!phase.members) return { champion: null, games: fixtures, results };
  const groupGames = phase.groupFixtures.flat();
  if (rng && model) Object.assign(results, simulateFixtures(groupGames, results, model, rng, { fast: true }));
  const games = [...phase.firstPhase, ...groupGames];
  if (games.some((f) => !results[f.id])) return { champion: null, games, results };
  const groupOptions = { tiebreakers: split.groupTiebreakers ?? league.tiebreakers };
  const tables = phase.members.map((_, g) => splitGroupTable(phase, g, teams, results, groupOptions));
  const campaign = playoff.seedFromGroups?.campaign ? computeStandings(teams, phase.firstPhase, results, { ...options, includeForm: false }) : undefined;
  const rows = seedByGroupPlace(tables, undefined, playoff.seedFromGroups?.places ?? 1, playoff.seedFromGroups?.interleave, campaign);
  const last = sortFixtures(games).at(-1);
  const bracketOptions = { afterMatchday: last?.matchday ?? 0, afterDate: last?.utcDate ?? "", ...(tournament.postseason ? { real: tournament.postseason } : {}) };
  let ties: readonly PlayoffTie[] = [];
  if (rng && model) {
    Object.assign(results, simulatePlayoff(rows, playoff, results, model, rng, bracketOptions, (round, played) => {
      if (round === playoff.rounds.length - 1) ties = played;
    }));
  } else {
    ties = buildBracket(rows, playoff, results, { ...bracketOptions, seasonComplete: true }).at(-1) ?? [];
  }
  const final = ties[0];
  const outcome = final ? tieOutcome(final, results) : null;
  // The final's legs count in the aggregate table (with their scores; the shoot-out doesn't).
  const legs = final ? final.legs.flatMap((leg) => (results[leg.id] ?? leg.result ? [leg] : [])) : [];
  for (const leg of legs) if (!results[leg.id] && leg.result) results[leg.id] = leg.result;
  return { champion: outcome?.winner ?? null, games: [...games, ...legs], results };
}

/** The aggregate table over the tournaments as played: every game renumbered (two tournaments' final legs share ids). */
function aggregateTable(league: LeagueConfig, teams: readonly Team[], played: readonly Played[]): StandingRow[] {
  const fixtures: Fixture[] = [];
  const results: ResultMap = {};
  for (const p of played) {
    for (const f of p.games) {
      const score = p.results[f.id];
      if (!score) continue;
      const id = fixtures.length + 1;
      fixtures.push({ ...f, id });
      results[id] = score;
    }
  }
  return computeStandings(teams, fixtures, results, { tiebreakers: league.tiebreakers, includeForm: false });
}

export interface PromotionChances {
  iterations: number;
  /** By club, the share of simulated seasons it goes up (by any route). */
  promoted: Map<TeamId, number>;
  /** …it wins each tournament (by tournament id). */
  champion: Map<string, Map<TeamId, number>>;
  /** …it plays the grand final, and the play-off. */
  grandFinal: Map<TeamId, number>;
  playoff: Map<TeamId, number>;
}

export interface PromotionSeasonInput {
  league: LeagueConfig;
  teams: readonly Team[];
  /** The season's tournaments, latest first (as LeagueData lists them). */
  tournaments: readonly Tournament[];
  /** The user's predictions, by tournament seasonKey. */
  predictions?: Readonly<Record<string, ResultMap>>;
  /** The real grand final and play-off games (LeagueData.promotionGames). */
  promotionGames?: LeagueData["promotionGames"];
  model: LeagueModel;
}

/** One season's promotion path from the tournaments as played (null while a champion or the aggregate table isn't settled). */
function seasonPath(input: PromotionSeasonInput, model: LeagueModel | null, rng: Rng | null, settledTournaments?: ReadonlyMap<string, Played>) {
  const ordered = [...input.tournaments].reverse();
  const played = ordered.map((t) => settledTournaments?.get(t.id) ?? playTournament(input.league, input.teams, t, input.predictions?.[t.seasonKey] ?? {}, model, rng));
  const champions = played.map((p) => p.champion);
  const table = aggregateTable(input.league, input.teams, played);
  const settled = played.every((p) => p.champion !== null && p.games.every((f) => p.results[f.id]));
  const path = settled && champions.length === 2 ? promotionPath([champions[0]!, champions[1]!], table.map((r) => r.teamId)) : null;
  return { ordered, champions, table, path };
}

/**
 * Every club's chances of going up: the rest of the season played
 * `iterations` times (the user's predictions as they are), each time the
 * promotion path and its ties.
 */
export function simulatePromotion(input: PromotionSeasonInput, iterations: number, seed = 1): PromotionChances {
  const rng = createRng(seed);
  const promoted = new Map<TeamId, number>();
  const champion = new Map(input.tournaments.map((t) => [t.id, new Map<TeamId, number>()]));
  const grandFinal = new Map<TeamId, number>();
  const playoff = new Map<TeamId, number>();
  const add = (map: Map<TeamId, number>, id: TeamId) => map.set(id, (map.get(id) ?? 0) + 1);
  // A tournament whose every game has a result (real or predicted) is the same in every season: played once.
  const settled = new Map<string, Played>();
  for (const t of input.tournaments) {
    const once = playTournament(input.league, input.teams, t, input.predictions?.[t.seasonKey] ?? {}, null, null);
    if (once.champion !== null && once.games.every((f) => once.results[f.id])) settled.set(t.id, once);
  }
  let counted = 0;
  for (let i = 0; i < iterations; i++) {
    const { ordered, champions, path, table } = seasonPath(input, input.model, rng, settled);
    champions.forEach((id, t) => id !== null && add(champion.get(ordered[t]!.id)!, id));
    if (!path) continue;
    counted++;
    const order = table.map((r) => r.teamId);
    for (const id of path.direct) add(promoted, id);
    for (const t of resolveTies(path, order, input, rng)) {
      add(t.kind === "grandFinal" ? grandFinal : playoff, t.higher);
      add(t.kind === "grandFinal" ? grandFinal : playoff, t.lower);
      if (t.winner !== null) add(promoted, t.winner);
    }
  }
  const share = (map: Map<TeamId, number>, n: number) => new Map([...map].map(([id, c]) => [id, n ? c / n : 0]));
  return {
    iterations: counted,
    promoted: share(promoted, counted),
    champion: new Map([...champion].map(([id, m]) => [id, share(m, iterations)])),
    grandFinal: share(grandFinal, counted),
    playoff: share(playoff, counted),
  };
}

/** The path's ties, played (real legs as they are) or, without an rng, decided only by real legs. */
function resolveTies(path: PromotionPath, order: readonly TeamId[], input: PromotionSeasonInput, rng: Rng | null): (PromotionTie & { winner: TeamId | null })[] {
  const play = (t: PromotionTie) => {
    const known = knownLegs(t, input.promotionGames);
    return rng ? playTie(t, input.model, rng, known) : tieWinner(t, known.legs, known.shootout);
  };
  const out: (PromotionTie & { winner: TeamId | null })[] = [];
  let playoffTie: PromotionTie | undefined;
  if (path.grandFinal) {
    const winner = play(path.grandFinal);
    out.push({ ...path.grandFinal, winner });
    const loser = winner === null ? null : winner === path.grandFinal.higher ? path.grandFinal.lower : path.grandFinal.higher;
    if (loser !== null && path.playoff && "against" in path.playoff) playoffTie = promotionTie("playoff", loser, path.playoff.against, order);
  } else if (path.playoff && !("against" in path.playoff)) {
    playoffTie = path.playoff;
  }
  if (playoffTie) out.push({ ...playoffTie, winner: play(playoffTie) });
  return out;
}

/** The season as the user has it: each champion once settled, the aggregate table, and the path once both are. */
export function promotionScenario(input: Omit<PromotionSeasonInput, "model"> & { model: LeagueModel }) {
  const { ordered, champions, table, path } = seasonPath(input, null, null);
  const order = table.map((r) => r.teamId);
  return {
    champions: ordered.map((t, i) => ({ tournament: t, champion: champions[i] ?? null })),
    table,
    path,
    ties: path ? resolveTies(path, order, input, null) : [],
  };
}
