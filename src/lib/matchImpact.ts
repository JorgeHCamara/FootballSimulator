import type { SiteLocale, ZoneKind } from "../config/leagues.ts";
import type { Score, Team } from "../engine/types.ts";
import { percent } from "./clubText.ts";
import { outlookWithResults } from "./clubOutlook.ts";
import { gameXg, impactRows, preMatchModel, resultScores, type FoundMatch, type ImpactRow, type LoadedMatch } from "./matchPreview.ts";

/*
 * "What this result means" on a match page: three more season simulations
 * (one simulation loop, see outlookWithResults), so the page loads without them
 * and fetches this from its own address (…/impact). The numbers are worked
 * out once per game (impactNumbers, cached by the route), the words per
 * language (impactView).
 */

/** The section's numbers, the same in every language: each result's score and the chances it moves. */
export interface ImpactNumbers {
  scores: { home: Score; draw: Score; away: Score };
  rows: ImpactRow[];
  iterations: number;
}

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

/** Can the game have the section (still to play, this season's)? Before any simulation. */
export const impactPossible = (found: FoundMatch) => found.state !== "played" && found.state !== "off" && found.data === found.current;

/** Does the page show the section's placeholder? */
export const hasImpact = (loaded: LoadedMatch) => impactPossible(loaded) && Boolean(loaded.homeClub && loaded.awayClub);

/**
 * The section's numbers (null for a game without it): the expensive part, the
 * same in every language. The league's outlook (the "Now" column) and the
 * three results come from one simulation loop (outlookWithResults), each
 * result played out with its likeliest score under the model at kick-off.
 */
export function impactNumbers(found: FoundMatch): ImpactNumbers | null {
  const { league, data } = found;
  const { fixture } = found.match;
  const both = outlookWithResults(league, data, fixture, (current) => {
    const model = preMatchModel(league, data, fixture, current) ?? current;
    return resultScores(gameXg(model, fixture), model.rho ?? 0);
  });
  const homeClub = both?.outlook.clubs.get(fixture.homeId);
  const awayClub = both?.outlook.clubs.get(fixture.awayId);
  if (!both || !homeClub || !awayClub) return null;
  const { scenarios } = both;
  const rows = [homeClub, awayClub].flatMap((club) =>
    impactRows(club.team.id, club, {
      home: scenarios.after.home.get(club.team.id),
      draw: scenarios.after.draw.get(club.team.id),
      away: scenarios.after.away.get(club.team.id),
    }),
  );
  return rows.length ? { scores: scenarios.scores, rows, iterations: both.outlook.iterations } : null;
}

/** The section in one language. */
export function impactView(match: FoundMatch["match"], numbers: ImpactNumbers, lang: SiteLocale, t: Translate, tz: Translate): ImpactView {
  const { home, away } = match;
  const { scores, rows } = numbers;
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
  const score = (s: Score) => `${s.home}–${s.away}`;
  return {
    heads: [
      { key: "home", label: t("impactHome", { team: home.shortName }), score: score(scores.home), team: badge(home) },
      { key: "draw", label: t("impactDraw"), score: score(scores.draw) },
      { key: "away", label: t("impactAway", { team: away.shortName }), score: score(scores.away), team: badge(away) },
    ],
    nowLabel: t("impactNow"),
    rows: rows.map((row) => {
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
    note: t("impactNote", { count: new Intl.NumberFormat(lang).format(numbers.iterations) }),
    ...(rows.some((r) => r.kind === "position") ? { positionNote: t("impactPositionNote") } : {}),
  };
}
