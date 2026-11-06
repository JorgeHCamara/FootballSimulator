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

/** The longest run of home or of away games any club has in these games (byes skipped). */
export function longestVenueRun(fixtures: readonly Pick<Fixture, "matchday" | "homeId" | "awayId">[]): number {
  const byClub = new Map<TeamId, { matchday: number; home: boolean }[]>();
  for (const f of fixtures) {
    for (const [id, home] of [[f.homeId, true], [f.awayId, false]] as const) {
      const games = byClub.get(id) ?? [];
      games.push({ matchday: f.matchday, home });
      byClub.set(id, games);
    }
  }
  let longest = 0;
  for (const games of byClub.values()) {
    games.sort((a, b) => a.matchday - b.matchday);
    let run = 0;
    games.forEach((g, i) => {
      run = i > 0 && g.home === games[i - 1]!.home ? run + 1 : 1;
      longest = Math.max(longest, run);
    });
  }
  return longest;
}

/**
 * Double round robin with a real league's home-and-away rhythm: no club plays
 * more than two games in a row at home or away (AHAHHAAHAH…). The first half is
 * the canonical circle schedule (clubs on a circle, one in the centre; in each
 * round the centre game's venue alternates and every other pair gets its home
 * side by its distance on the circle), which gives each club at most one
 * home-home or away-away pair, the fewest possible. The second half is the
 * first half's rounds with the venues swapped, starting from its second round:
 * an exact mirror would give some clubs three in a row where the halves meet.
 * Used for My World's generated seasons (the sample leagues and split rounds
 * keep `doubleRoundRobin`).
 */
export function balancedDoubleRoundRobin(teamIds: readonly TeamId[], startDate = "2025-08-01T15:00:00Z"): Fixture[] {
  const ids: (TeamId | null)[] = [...teamIds];
  if (ids.length % 2 === 1) ids.push(null);
  const n = ids.length;
  const rounds = n - 1;
  // Slots 0..rounds-1 on the circle, slot `rounds` in the centre: [home slot, away slot] per round.
  const half = Array.from({ length: rounds }, (_, r) => {
    const games: [number, number][] = [r % 2 === 1 ? [rounds, r] : [r, rounds]];
    for (let k = 1; k < n / 2; k++) {
      const a = (r + k) % rounds;
      const b = (r - k + rounds) % rounds;
      games.push(k % 2 === 1 ? [a, b] : [b, a]);
    }
    return games;
  });
  const order = [...half, ...half.map((_, j) => half[(j + 1) % rounds]!.map(([home, away]): [number, number] => [away, home]))];
  const start = Date.parse(startDate);
  const week = 7 * 24 * 60 * 60 * 1000;
  const fixtures: Fixture[] = [];
  order.forEach((games, r) => {
    for (const [home, away] of games) {
      const homeId = ids[home];
      const awayId = ids[away];
      if (homeId == null || awayId == null) continue;
      fixtures.push({ id: fixtures.length + 1, matchday: r + 1, utcDate: new Date(start + r * week).toISOString(), homeId, awayId, result: null });
    }
  });
  return fixtures;
}
