"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Zone } from "../config/leagues.ts";
import type { Fixture, ResultMap, Score, Team, TeamId } from "../engine/types.ts";
import { divisionConfig, tableRows, worldSeasonLabel, type DivisionCode, type World } from "../lib/myWorld.ts";
import { stageOfMatchday, TOURNAMENT_ROUNDS, type ZoneSeason, type ZoneStage } from "../lib/worldZones.ts";
import { FixtureList, PLAYOFF_MATCHDAY, type PlayoffView } from "./FixtureList.tsx";
import { Icon } from "./Icon.tsx";
import { PromotedClubs } from "./PromotedClubs.tsx";
import { WorldTable } from "./WorldTable.tsx";

/*
 * Argentina's zone leagues in My World (src/lib/worldZones.ts): each zone's
 * table and the fixtures of one tournament at a time (the Liga Profesional's
 * Apertura or Clausura, or its annual table), its play-off after its games.
 * Used for the season in progress and for a finished one (read only).
 */

/** The tournament a matchday shows: its own for a league game; the play-off's choice (or the first one still open) for the play-off. */
export function zoneStageShown(season: ZoneSeason, code: DivisionCode, matchday: number, playoffStage: number | null): number {
  if (matchday !== PLAYOFF_MATCHDAY) return Math.min(stageOfMatchday(season.code, matchday), season.stages.length - 1);
  if (playoffStage !== null && playoffStage < season.stages.length) return playoffStage;
  const open = season.stages.find((s) => s.complete && !s.decided);
  return open?.index ?? [...season.stages].reverse().find((s) => s.complete)?.index ?? 0;
}

/** Where a tournament's fixtures open: its first game without a score, else its play-off. */
export function zoneOpening(stage: ZoneStage, results: ResultMap): number {
  return stage.fixtures.find((f) => !results[f.id])?.matchday ?? PLAYOFF_MATCHDAY;
}

/** A tournament's play-off as the fixture list shows it: the zones' slots, its title (and the Primera Nacional's promotion). */
function playoffView(stage: ZoneStage, zoneNames: string[], title: string): PlayoffView {
  const config = stage.config;
  return {
    bracket: stage.bracket,
    seasonComplete: stage.complete,
    title,
    ...(config.promotedTo ? { promotedTo: config.promotedTo } : {}),
    ...(config.titleRound !== undefined ? { titleRound: config.titleRound } : {}),
    // The Liga Profesional's seeds interleave the zones (1A, 1B, 2A…); the Primera Nacional's pairs name a zone's place.
    ...(config.seedFromGroups?.interleave ? { zoneSlots: { ids: ["A", "B"], names: zoneNames } } : { zoneNames }),
  };
}

/**
 * The tables and the fixtures of a zone league's season: the tournament
 * switch (the Liga Profesional: Apertura, Clausura, annual table), each
 * zone's table with the tournament's champion under it, and the fixtures by
 * matchday with the tournament's play-off. Two grid cells, as WorldSeason's
 * table and fixtures columns.
 */
export function ZoneColumns({
  world,
  year,
  code,
  season,
  fixtures,
  teams,
  picks,
  matchday,
  onMatchday,
  readOnly,
  onScore,
  onSimulate,
  playoffStage,
  onPlayoffStage,
}: {
  world: World;
  /** The season shown (world.year, or a finished one). */
  year: number;
  code: DivisionCode;
  season: ZoneSeason;
  fixtures: readonly Fixture[];
  teams: Map<TeamId, Team>;
  /** The scores typed in, rolled or simulated (none for a finished season). */
  picks: ResultMap;
  matchday: number;
  onMatchday: (matchday: number) => void;
  readOnly: boolean;
  onScore: (fixture: Fixture, score: Score | null) => void;
  onSimulate: (fixture: Fixture) => void;
  /** The tournament whose play-off shows (the Liga Profesional's); null: the first one still open. */
  playoffStage: number | null;
  onPlayoffStage: (stage: number) => void;
}) {
  const t = useTranslations("World");
  const [annual, setAnnual] = useState(false);
  // The Liga Profesional: one zone at a time, as on its league page (the user's club's zone to begin with).
  const zoneSwitch = code === "ARG" && season.zones.length > 1;
  const [zone, setZone] = useState(() => Math.max(0, season.zones.findIndex((ids) => ids.includes(world.userClub))));
  const league = divisionConfig(code);
  const zoneNames = (league.groups ?? []).map((g) => t("zones.zone", { zone: g.id }));
  const index = zoneStageShown(season, code, matchday, playoffStage);
  const stage = season.stages[index]!;
  const tournament = (s: ZoneStage) => (s.key ? t(`zones.${s.key}`) : t(`leagues.${code}.name`));
  const results: ResultMap = {};
  for (const f of fixtures) {
    const score = picks[f.id] ?? f.result;
    if (score) results[f.id] = score;
  }
  const matchdays = [...new Set(stage.fixtures.map((f) => f.matchday))].sort((a, b) => a - b).concat([PLAYOFF_MATCHDAY]);
  const shown = matchdays.includes(matchday) ? matchday : matchdays[0]!;
  // The Clausura's rounds by its own numbers (its games come after the Apertura's).
  const roundLabels = stage.index === 1 ? Object.fromEntries(matchdays.filter((md) => md > 0).map((md) => [md, t("zones.round", { round: md - TOURNAMENT_ROUNDS })])) : undefined;
  const pick = (s: ZoneStage) => {
    setAnnual(false);
    const opening = zoneOpening(s, results);
    if (opening === PLAYOFF_MATCHDAY) onPlayoffStage(s.index);
    onMatchday(opening);
  };
  // The annual table's places in My World: the Libertadores and Sudamericana places, the bottom two down.
  const annualZones: Zone[] = [...(league.annual?.zones ?? []).filter((z) => z.kind !== "relegation"), { kind: "relegation", from: 29, to: 30 }];
  const button = (active: boolean) =>
    `min-h-8 rounded-md px-3 text-sm font-semibold ${active ? "bg-white shadow-sm dark:bg-zinc-900" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300"}`;
  const club = (id: TeamId | null) => (id !== null ? world.clubs[id]?.name ?? "" : "");
  return (
    <>
      <div className="min-w-0 space-y-3 lg:col-span-2 lg:col-start-1 lg:row-start-2" data-testid="world-zones" data-league={code}>
        <div className="flex flex-wrap items-center gap-2">
        {season.stages.length > 1 && (
          <div role="tablist" className="flex w-fit gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800" data-testid="world-tournaments">
            {season.stages.map((s) => (
              <button key={s.index} type="button" role="tab" aria-selected={!annual && s.index === index} className={button(!annual && s.index === index)} onClick={() => pick(s)} data-stage={s.key}>
                {tournament(s)}
              </button>
            ))}
            {season.annual && (
              <button type="button" role="tab" aria-selected={annual} className={button(annual)} onClick={() => setAnnual(true)} data-stage="annual">
                {t("zones.annual")}
              </button>
            )}
          </div>
        )}
        {/* The zone switch, as the league page's. */}
        {zoneSwitch && !annual && (
          <div className="flex max-w-full overflow-x-auto rounded-lg bg-zinc-200/70 p-1 dark:bg-zinc-800" role="group" aria-label={t("zones.switch")} data-testid="world-zone-switch">
            {zoneNames.map((name, z) => (
              <button
                key={z}
                type="button"
                aria-pressed={z === zone}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold ${z === zone ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"}`}
                onClick={() => setZone(z)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        </div>
        {annual && season.annual ? (
          <WorldTable rows={tableRows(season.annual)} code={code} clubs={world.clubs} highlight={world.userClub} final={false} testId="world-annual-table" zones={annualZones} title={t("zones.annual")} />
        ) : (
          stage.tables.map((rows, z) =>
            zoneSwitch && z !== zone ? null : (
              <WorldTable key={z} rows={tableRows(rows)} code={code} clubs={world.clubs} highlight={world.userClub} final={false} testId="world-zone-table" {...(zoneSwitch ? {} : { title: zoneNames[z] ?? "" })} />
            ),
          )
        )}
        {annual && season.annual && <p className="text-xs text-zinc-500">{t("zones.annualNote")}</p>}
        {/* The Primera Nacional's promoted clubs, as the other leagues' (the final's winner, then the Reducido's). */}
        {stage.config.promotedTo && (
          <PromotedClubs
            bracket={stage.bracket}
            rows={[]}
            teams={teams}
            predictions={picks}
            seasonComplete={stage.complete}
            directPromotion={[]}
            promotedTo={stage.config.promotedTo}
            nextSeason={worldSeasonLabel(world, year + 1, "ARG")}
            {...(stage.config.titleRound !== undefined ? { titleRound: stage.config.titleRound } : {})}
          />
        )}
        {/* The Liga Profesional's champion of each tournament once decided. */}
        {season.stages
          .filter((s) => s.champion !== null && !s.config.promotedTo)
          .map((s) => (
            <p key={s.index} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300" data-testid="world-zone-champion" data-stage={s.key}>
              <Icon name="trophy" size={16} className="shrink-0 text-amber-500" />
              {t("zones.champion", { tournament: tournament(s), club: club(s.champion), runnerUp: club(s.runnerUp) })}
            </p>
          ))}
      </div>
      <div className="min-w-0 lg:col-start-3 lg:row-start-2" data-testid="world-fixtures">
        <FixtureList
          matchday={shown}
          matchdays={matchdays}
          onMatchdayChange={(md) => {
            if (md === PLAYOFF_MATCHDAY) onPlayoffStage(index);
            onMatchday(md);
          }}
          {...(roundLabels ? { roundLabels } : {})}
          fixtures={fixtures.filter((f) => f.matchday === shown)}
          teams={teams}
          predictions={picks}
          onScore={onScore}
          onSimulate={onSimulate}
          kickOff={false}
          {...(readOnly ? { readOnly: true } : {})}
          playoff={playoffView(stage, zoneNames, tournament(stage))}
        />
      </div>
    </>
  );
}
