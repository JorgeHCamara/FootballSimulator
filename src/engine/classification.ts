import { addRecords, byCampaign } from "./playoffs.ts";
import type { StandingRow, TeamId } from "./types.ts";

/**
 * A staged league's final classification over all its clubs (Série C 2026,
 * REC arts. 24–26): the final's winner 1st and its loser 2nd; the groups'
 * runners-up 3rd and 4th, then the rest of the groups' clubs 5th–8th, each by
 * its campaign over the first phase and its group (points, wins, goal
 * difference, goals scored; then the first phase's place, for the cards and
 * the draw the site doesn't model); the clubs out after the first phase
 * after them, in their first-phase order. Until the final is decided its two
 * clubs (the group winners) are ranked by campaign too.
 *
 * Each row's record is over the first phase and the group (the "soma das
 * fases" of the regulation, without the final's two games); a club out after
 * the first phase keeps its first-phase record.
 */
export function stagedClassification(
  firstTable: readonly StandingRow[],
  groupTables: readonly (readonly StandingRow[])[],
  final: { winner: TeamId; loser: TeamId } | null,
): StandingRow[] {
  const campaign = byCampaign(firstTable);
  const first = new Map(firstTable.map((r) => [r.teamId, r]));
  const atPlace = (place: number) => groupTables.flatMap((g) => g.filter((r) => r.position === place));
  const winners = atPlace(1).sort(campaign);
  const top = final
    ? [winners.find((r) => r.teamId === final.winner), winners.find((r) => r.teamId === final.loser)].filter((r): r is StandingRow => r !== undefined)
    : winners;
  // A final between other clubs than the group winners (it can't be): the winners by campaign.
  const finalists = top.length === winners.length ? top : winners;
  const runnersUp = atPlace(2).sort(campaign);
  const inGroups = new Set(groupTables.flat().map((r) => r.teamId));
  const rest = groupTables
    .flat()
    .filter((r) => r.position > 2)
    .sort(campaign);
  const out = [...firstTable].sort((a, b) => a.position - b.position).filter((r) => !inGroups.has(r.teamId));
  return [...[...finalists, ...runnersUp, ...rest].map((r) => addRecords(r, first.get(r.teamId))), ...out].map((row, i) => ({ ...row, position: i + 1 }));
}
