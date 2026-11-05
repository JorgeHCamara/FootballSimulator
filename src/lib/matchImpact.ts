import type { SiteLocale, ZoneKind } from "../config/leagues.ts";
import type { Team } from "../engine/types.ts";
import { percent } from "./clubText.ts";
import { impactRows, matchScenarios, type ImpactRow, type LoadedMatch } from "./matchPreview.ts";

/*
 * "What this result means" on a match page, as text ready to show: three
 * more season simulations (a few seconds on a first visit), so the page loads
 * without them and fetches this from its own address (…/impact).
 */

/** One figure and its change from now, as shown ("64%", "+3 pts"). */
export interface ImpactCell {
  value: string;
  change: { text: string; tone: "same" | "better" | "worse" };
}

export interface ImpactView {
  /** Each result's heading: the winner's crest (phones), its name and the score played out. */
  heads: { key: "home" | "draw" | "away"; label: string; score: string; team?: Pick<Team, "id" | "name" | "shortName" | "tla" | "crest"> }[];
  nowLabel: string;
  rows: { key: string; kind: ImpactRow["kind"]; zone?: ZoneKind; label: string; now: string; cells: ImpactCell[] }[];
  note: string;
  positionNote?: string;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The section's content, or null for a game without it (played, called off, an old season's). */
export function impactView(loaded: LoadedMatch, lang: SiteLocale, t: Translate, tz: Translate): ImpactView | null {
  const { homeClub, awayClub, outlook } = loaded;
  const { home, away } = loaded.match;
  const scenarios = homeClub && awayClub ? matchScenarios(loaded) : null;
  if (!scenarios || !homeClub || !awayClub) return null;
  const impacts = [homeClub, awayClub].flatMap((club) =>
    impactRows(club.team.id, club, {
      home: scenarios.after.home.get(club.team.id),
      draw: scenarios.after.draw.get(club.team.id),
      away: scenarios.after.away.get(club.team.id),
    }),
  );
  if (!impacts.length) return null;
  const value = (row: ImpactRow, v: number) => (row.kind === "position" ? v.toFixed(1) : percent(v, lang));
  const change = (row: ImpactRow, v: number): ImpactCell["change"] => {
    // From the figures shown (whole points, places to one decimal), so "1% → 2%" reads "+1".
    const diff = row.kind === "position" ? (Math.round(v * 10) - Math.round(row.now * 10)) / 10 : Math.round(v * 100) - Math.round(row.now * 100);
    const size = Math.abs(diff);
    if (size === 0) return { text: "±0", tone: "same" };
    const better = row.kind === "relegation" || row.kind === "position" ? diff < 0 : diff > 0;
    const sign = diff > 0 ? "+" : "−";
    return { text: row.kind === "position" ? `${sign}${size.toFixed(1)}` : t("impactDelta", { sign, n: size }), tone: better ? "better" : "worse" };
  };
  const badge = (team: Team) => ({ id: team.id, name: team.name, shortName: team.shortName, tla: team.tla, ...(team.crest ? { crest: team.crest } : {}) });
  const score = (s: { home: number; away: number }) => `${s.home}–${s.away}`;
  return {
    heads: [
      { key: "home", label: t("impactHome", { team: home.shortName }), score: score(scenarios.scores.home), team: badge(home) },
      { key: "draw", label: t("impactDraw"), score: score(scenarios.scores.draw) },
      { key: "away", label: t("impactAway", { team: away.shortName }), score: score(scenarios.scores.away), team: badge(away) },
    ],
    nowLabel: t("impactNow"),
    rows: impacts.map((row) => {
      const team = row.teamId === home.id ? home : away;
      return {
        key: `${row.teamId}-${row.kind}`,
        kind: row.kind,
        ...(row.zone ? { zone: row.zone } : {}),
        label: `${team.shortName}: ${row.kind === "continental" ? tz(row.zone!) : t(`impactKind.${row.kind}`)}`,
        now: value(row, row.now),
        cells: (["home", "draw", "away"] as const).map((k) => ({ value: value(row, row[k]), change: change(row, row[k]) })),
      };
    }),
    note: t("impactNote", { count: new Intl.NumberFormat(lang).format(outlook?.iterations ?? 10_000) }),
    ...(impacts.some((r) => r.kind === "position") ? { positionNote: t("impactPositionNote") } : {}),
  };
}

/** Does the game get the section (so the page shows its placeholder)? The same test as matchScenarios, without running it. */
export const hasImpact = (loaded: LoadedMatch) =>
  loaded.state !== "played" && loaded.state !== "off" && loaded.data === loaded.current && Boolean(loaded.homeClub && loaded.awayClub);
