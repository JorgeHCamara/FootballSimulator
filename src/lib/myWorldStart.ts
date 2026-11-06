import { outlookSetup } from "./clubOutlook.ts";
import { getLeagueData } from "./leagueData.ts";
import { divisionConfig, ENGLAND, type DivisionCode, type StartLeague, type StartPack, type WorldGame, type WorldPlayoffGame } from "./myWorld.ts";

/**
 * What a new world starts from (on the server): the four English leagues' live
 * data (clubs, results so far, the games left, deductions, any play-off games
 * played) and the same ratings the site's season odds use (the outlook's
 * model). A league whose data doesn't load is listed in `missing`: no new
 * world then, but a saved one still plays (it needs nothing live).
 */
export async function worldStartPack(): Promise<StartPack> {
  const leagues: StartLeague[] = [];
  const missing: DivisionCode[] = [];
  await Promise.all(
    ENGLAND.map(async (code) => {
      const league = divisionConfig(code);
      try {
        const data = await getLeagueData(league);
        const setup = outlookSetup(league, data);
        const year = data.seasonYear ?? Number.parseInt(data.season, 10);
        const playing = new Set(data.fixtures.flatMap((f) => [f.homeId, f.awayId]));
        const teams = data.teams.filter((t) => playing.has(t.id));
        if (!setup || !Number.isFinite(year) || teams.length !== league.teams) throw new Error(`${code}: incomplete data`);
        const games = data.fixtures.map((f): WorldGame => [f.id, f.matchday, f.homeId, f.awayId, f.result?.home ?? null, f.result?.away ?? null]);
        const playoffGames = (data.postseason ?? []).map((f): WorldPlayoffGame => [
          f.id,
          f.homeId,
          f.awayId,
          f.utcDate,
          f.result?.home ?? null,
          f.result?.away ?? null,
          f.neutral ? 1 : 0,
          f.penalties?.home ?? null,
          f.penalties?.away ?? null,
        ]);
        const { model } = setup;
        leagues.push({
          code,
          year,
          teams: teams.map((t) => ({ id: t.id, name: t.name, shortName: t.shortName, tla: t.tla, ...(t.crest ? { crest: t.crest } : {}) })),
          games,
          ...(data.deductions && Object.keys(data.deductions).length ? { deductions: data.deductions } : {}),
          ...(playoffGames.length ? { playoffGames } : {}),
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
  );
  leagues.sort((a, b) => ENGLAND.indexOf(a.code) - ENGLAND.indexOf(b.code));
  missing.sort((a, b) => ENGLAND.indexOf(a) - ENGLAND.indexOf(b));
  return { leagues, missing };
}
