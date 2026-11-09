import { outlookSetup } from "./clubOutlook.ts";
import { getCupData } from "./cupData.ts";
import { getLeagueData } from "./leagueData.ts";
import { divisionConfig, divisionTeams, isDivision, WORLD_LEAGUES, type DivisionCode, type StartCup, type StartLeague, type StartPack, type WorldGame, type WorldPlayoffGame } from "./myWorld.ts";
import { cupConfig, WORLD_CUPS, type WorldCupCode, type WorldCupTie } from "./worldCups.ts";
import { isZoneDivision, TOURNAMENT_ROUNDS } from "./worldZones.ts";
import type { Fixture } from "../engine/types.ts";

/**
 * What a new world starts from (on the server): every country's leagues' live
 * data (clubs, results so far, the games left, deductions, any play-off games
 * played) and the same ratings the site's season odds use (the outlook's
 * model), and every cup's (their clubs, the draw so far with its results, the
 * clubs entering later). A league or cup whose data doesn't load is listed in
 * `missing`: its country can't start a new world then, but a saved one still
 * plays (it needs nothing live).
 */
export async function worldStartPack(): Promise<StartPack> {
  const leagues: StartLeague[] = [];
  const cups: StartCup[] = [];
  const missing: (DivisionCode | WorldCupCode)[] = [];
  const loadCup = async (code: WorldCupCode) => {
    try {
      const data = await getCupData(cupConfig(code));
      const year = Number.parseInt(data.season, 10);
      if (!Number.isFinite(year)) throw new Error(`${code}: no season`);
      cups.push({
        code,
        year,
        teams: data.teams.map((t) => ({ id: t.id, name: t.name, shortName: t.shortName, tla: t.tla, ...(t.crest ? { crest: t.crest } : {}) })),
        divisions: Object.fromEntries(Object.entries(data.divisions).flatMap(([id, league]) => (isDivision(league) ? [[Number(id), league]] : []))),
        real: data.real.map((t): WorldCupTie => {
          const last = t.legs.at(-1);
          return {
            round: t.round,
            homeId: t.homeId,
            awayId: t.awayId,
            legs: t.legs.map((leg) => (leg.result ? [leg.result.home, leg.result.away] : null)),
            ...(last?.penalties ? { penalties: [last.penalties.home, last.penalties.away] } : {}),
          };
        }),
        entrants: data.entrants,
      });
    } catch (error) {
      console.warn(`my world: no ${code} data:`, error instanceof Error ? error.message : error);
      missing.push(code);
    }
  };
  await Promise.all([
    ...WORLD_CUPS.map(loadCup),
    ...WORLD_LEAGUES.map(async (code) => {
      const league = divisionConfig(code);
      try {
        const data = await getLeagueData(league);
        const setup = outlookSetup(league, data);
        // The season's year: "2026", "2026/27", or a tournament's ("Clausura 2026").
        const year = data.seasonYear ?? Number(/\d{4}/.exec(data.season)?.[0]);
        const playing = new Set(data.fixtures.flatMap((f) => [f.homeId, f.awayId]));
        const teams = data.teams.filter((t) => playing.has(t.id));
        if (!setup || !Number.isFinite(year) || teams.length !== divisionTeams(code, year)) throw new Error(`${code}: incomplete data`);
        const game = (f: Fixture, offset = 0): WorldGame => [f.id, f.matchday + offset, f.homeId, f.awayId, f.result?.home ?? null, f.result?.away ?? null];
        const playoffGame = (f: Fixture, stage?: number): WorldPlayoffGame => {
          const g: WorldPlayoffGame = [f.id, f.homeId, f.awayId, f.utcDate, f.result?.home ?? null, f.result?.away ?? null, f.neutral ? 1 : 0, f.penalties?.home ?? null, f.penalties?.away ?? null];
          return stage === undefined ? g : [g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7], g[8], stage];
        };
        let games = data.fixtures.map((f) => game(f));
        let playoffGames = (data.postseason ?? []).map((f) => playoffGame(f));
        // The Liga Profesional: the season's two tournaments, the Clausura's rounds after the Apertura's, each with its own play-off games.
        if (code === "ARG") {
          const apertura = data.tournaments?.find((x) => x.id === "torneo-apertura");
          const clausura = data.tournaments?.find((x) => x.id === "torneo-clausura");
          if (!apertura || !clausura) throw new Error(`${code}: no Apertura and Clausura`);
          games = [...apertura.fixtures.map((f) => game(f)), ...clausura.fixtures.map((f) => game(f, TOURNAMENT_ROUNDS))];
          playoffGames = [...(apertura.postseason ?? []).map((f) => playoffGame(f, 0)), ...(clausura.postseason ?? []).map((f) => playoffGame(f, 1))];
        }
        // A zone league's zones, as ESPN's standings have them (zone A first).
        const zones = isZoneDivision(code) ? data.groups?.map((g) => g.teamIds.filter((id) => playing.has(id))) : undefined;
        if (isZoneDivision(code) && (zones?.length !== 2 || zones.flat().length !== teams.length)) throw new Error(`${code}: no zones`);
        const { model } = setup;
        leagues.push({
          code,
          year,
          teams: teams.map((t) => ({ id: t.id, name: t.name, shortName: t.shortName, tla: t.tla, ...(t.crest ? { crest: t.crest } : {}) })),
          games,
          ...(data.deductions && Object.keys(data.deductions).length ? { deductions: data.deductions } : {}),
          ...(playoffGames.length ? { playoffGames } : {}),
          ...(zones ? { zones } : {}),
          model: {
            avgHomeGoals: model.avgHomeGoals,
            avgAwayGoals: model.avgAwayGoals,
            rho: model.rho ?? 0,
            strengths: Object.fromEntries(teams.map((t) => {
              const s = model.strengths.get(t.id) ?? { attack: 1, defence: 1 };
              return [t.id, [Math.round(s.attack * 1000) / 1000, Math.round(s.defence * 1000) / 1000]];
            })),
          },
        });
      } catch (error) {
        console.warn(`my world: no ${code} data:`, error instanceof Error ? error.message : error);
        missing.push(code);
      }
    }),
  ]);
  const order: readonly string[] = [...WORLD_LEAGUES, ...WORLD_CUPS];
  leagues.sort((a, b) => WORLD_LEAGUES.indexOf(a.code) - WORLD_LEAGUES.indexOf(b.code));
  cups.sort((a, b) => WORLD_CUPS.indexOf(a.code) - WORLD_CUPS.indexOf(b.code));
  missing.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { leagues, cups, missing };
}
