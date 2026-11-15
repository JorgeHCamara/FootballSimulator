import type { Fixture } from "../engine/types.ts";

/*
 * A league's fixtures as the league page sends them to its simulator (a client
 * component): every prop is serialized into the page (its HTML's inline
 * payload and its RSC data), on every regeneration and cache miss, and a
 * season's 380 fixtures as objects, each key named and each kick-off spelled
 * out, were about 40 KB of it. Packed, the kick-offs are listed once and each
 * fixture is a row of numbers; LeagueSimulator unpacks them once into exactly
 * the objects it got before (the same keys in the same order), so it computes
 * and shows exactly the same. A fixture of any other shape (neutral ground, a
 * shoot-out) travels as it is.
 */

/** [id, matchday, kick-off (index into `dates`), homeId, awayId] and, once played, [..., home goals, away goals]. */
type Row = [number, number, number, number, number] | [number, number, number, number, number, number, number];

export interface PackedFixtures {
  packed: 1;
  dates: string[];
  rows: (Row | Fixture)[];
}

/** What LeagueSimulator takes: fixtures as they are, or packed. */
export type FixtureInput = readonly Fixture[] | PackedFixtures;

const PLAIN_KEYS = "id,matchday,utcDate,homeId,awayId,result";

/** Is it the shape a row holds, keys in this order (so unpacking gives back the same object)? */
const plain = (f: Fixture) =>
  Object.keys(f).join(",") === PLAIN_KEYS && (f.result === null || (Object.keys(f.result).join(",") === "home,away" && Number.isInteger(f.result.home) && Number.isInteger(f.result.away)));

export function packFixtures(fixtures: readonly Fixture[]): PackedFixtures {
  const dates: string[] = [];
  const index = new Map<string, number>();
  const rows = fixtures.map((f): Row | Fixture => {
    if (!plain(f)) return f;
    let d = index.get(f.utcDate);
    if (d === undefined) {
      d = dates.push(f.utcDate) - 1;
      index.set(f.utcDate, d);
    }
    return f.result ? [f.id, f.matchday, d, f.homeId, f.awayId, f.result.home, f.result.away] : [f.id, f.matchday, d, f.homeId, f.awayId];
  });
  return { packed: 1, dates, rows };
}

export const isPacked = (input: FixtureInput): input is PackedFixtures => !Array.isArray(input) && (input as PackedFixtures).packed === 1;

/** The fixtures as objects: the array itself when it isn't packed. */
export function unpackFixtures(input: FixtureInput): Fixture[] {
  if (!isPacked(input)) return input as Fixture[];
  return input.rows.map((row) =>
    Array.isArray(row)
      ? { id: row[0], matchday: row[1], utcDate: input.dates[row[2]]!, homeId: row[3], awayId: row[4], result: row.length === 7 ? { home: row[5]!, away: row[6]! } : null }
      : row,
  );
}
