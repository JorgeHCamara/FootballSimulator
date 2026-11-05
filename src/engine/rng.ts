// Seeded pseudo-random number generator (mulberry32).
// A seed fully determines a simulation, which makes results reproducible in tests
// and shareable by link.

export type Rng = () => number;

/** A seeded generator whose position can be read and set back, to replay the same draws. */
export interface SeededRng extends Rng {
  state: number;
}

export function createRng(seed: number): SeededRng {
  let a = seed >>> 0;
  const next = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SeededRng;
  Object.defineProperty(next, "state", {
    get: () => a,
    set: (value: number) => {
      a = value >>> 0;
    },
  });
  return next;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
