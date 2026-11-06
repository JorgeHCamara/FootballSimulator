import type { Fixture, TeamId } from "./types.ts";

/**
 * Double round-robin via the circle method: every team meets every other team once
 * at home and once away. Used for the sample leagues and for My World's
 * generated seasons (src/lib/myWorld.ts).
 */
export function doubleRoundRobin(teamIds: readonly TeamId[], startDate = "2025-08-01T15:00:00Z"): Fixture[] {
  const ids: (TeamId | null)[] = [...teamIds];
  if (ids.length % 2 === 1) ids.push(null);
  const n = ids.length;
  const rounds = n - 1;
  const start = Date.parse(startDate);
  const week = 7 * 24 * 60 * 60 * 1000;

  const firstHalf: { matchday: number; homeId: TeamId; awayId: TeamId }[] = [];
  const rotation = [...ids];
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < n / 2; i++) {
      const a = rotation[i];
      const b = rotation[n - 1 - i];
      if (a == null || b == null) continue;
      // Alternate home advantage so no team plays every first-half game at home.
      const swap = (round + i) % 2 === 1;
      firstHalf.push({ matchday: round + 1, homeId: swap ? b : a, awayId: swap ? a : b });
    }
    rotation.splice(1, 0, rotation.pop()!);
  }

  const all = [
    ...firstHalf,
    ...firstHalf.map((m) => ({ matchday: m.matchday + rounds, homeId: m.awayId, awayId: m.homeId })),
  ];
  return all.map((m, index) => ({
    id: index + 1,
    matchday: m.matchday,
    utcDate: new Date(start + (m.matchday - 1) * week).toISOString(),
    homeId: m.homeId,
    awayId: m.awayId,
    result: null,
  }));
}
