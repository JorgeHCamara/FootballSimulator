"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Fixture, FixtureId, ResultMap, Score } from "../engine/types.ts";

const MAX_UNDO = 50;

interface SeasonState {
  /** User predictions and simulated results, keyed by fixture id. */
  predictions: ResultMap;
  /**
   * Fixtures the user deliberately changed after a real result existed. All
   * other predictions are dropped once the real result comes in.
   */
  overrides: FixtureId[];
  /** Cups: bumps every "New draw", changing the simulated pairings. */
  drawSalt?: number;
  /**
   * Cups: the pairing ("home-away") each predicted slot had. A slot whose
   * pairing changes (new draw, real draw published, earlier upset) drops its
   * prediction, which belonged to another tie.
   */
  pairings?: Record<FixtureId, string>;
}

interface SimStore {
  seasons: Record<string, SeasonState>;
  /** Undo snapshots per season; kept in memory only. */
  history: Record<string, SeasonState[]>;
  setScore: (key: string, fixture: Fixture, score: Score | null) => void;
  applyResults: (key: string, results: ResultMap) => void;
  replace: (key: string, fixtures: readonly Fixture[], predictions: ResultMap, extra?: { drawSalt?: number }) => void;
  /** Cups: a new simulated draw (undoable). */
  redraw: (key: string) => void;
  /** Cups: remembers the current pairings and drops predictions whose slot changed pairing; returns how many. */
  syncPairings: (key: string, pairings: Record<FixtureId, string>) => number;
  reset: (key: string) => void;
  undo: (key: string) => void;
  /** Removes predictions for these fixtures without an undo step (e.g. stale play-off legs). */
  drop: (key: string, ids: readonly FixtureId[]) => void;
  /** Drops predictions that real results have superseded; returns how many. */
  reconcile: (key: string, fixtures: readonly Fixture[]) => number;
}

const empty: SeasonState = { predictions: {}, overrides: [] };

/**
 * Cups: each slot's pairing now, against the one remembered for it. A slot
 * whose pairing changed drops its prediction (it belonged to another tie). A
 * slot not built just now (its round pending while an earlier score is being
 * typed) keeps the pairing it had, so once it's built again with other clubs
 * its old prediction still goes, and with the same clubs it stays.
 */
export function syncedPairings(
  current: Pick<SeasonState, "predictions" | "pairings">,
  pairings: Record<FixtureId, string>,
): { predictions: ResultMap; pairings: Record<FixtureId, string>; removed: number; changed: boolean } {
  const predictions = { ...current.predictions };
  let removed = 0;
  for (const [id, pairing] of Object.entries(pairings)) {
    const previous = current.pairings?.[Number(id)];
    if (previous !== undefined && previous !== pairing && predictions[Number(id)]) {
      delete predictions[Number(id)];
      removed++;
    }
  }
  const remembered = { ...(current.pairings ?? {}), ...pairings };
  const changed = removed > 0 || current.pairings === undefined || Object.entries(pairings).some(([id, p]) => current.pairings![Number(id)] !== p);
  return { predictions, pairings: remembered, removed, changed };
}

export const useSimStore = create<SimStore>()(
  persist(
    (set, get) => {
      const commit = (key: string, next: SeasonState) =>
        set((s) => ({
          seasons: { ...s.seasons, [key]: next },
          history: {
            ...s.history,
            [key]: [...(s.history[key] ?? []), s.seasons[key] ?? empty].slice(-MAX_UNDO),
          },
        }));

      return {
        seasons: {},
        history: {},

        setScore: (key, fixture, score) => {
          const current = get().seasons[key] ?? empty;
          const predictions = { ...current.predictions };
          let overrides = current.overrides.filter((id) => id !== fixture.id);
          if (score) {
            predictions[fixture.id] = score;
            if (fixture.result) overrides = [...overrides, fixture.id];
          } else {
            delete predictions[fixture.id];
          }
          commit(key, { predictions, overrides });
        },

        applyResults: (key, results) => {
          if (Object.keys(results).length === 0) return;
          const current = get().seasons[key] ?? empty;
          commit(key, { ...current, predictions: { ...current.predictions, ...results } });
        },

        replace: (key, fixtures, predictions, extra) => {
          const overrides = fixtures.filter((f) => f.result && predictions[f.id]).map((f) => f.id);
          commit(key, { predictions, overrides, ...(extra?.drawSalt ? { drawSalt: extra.drawSalt } : {}) });
        },

        redraw: (key) => {
          const current = get().seasons[key] ?? empty;
          commit(key, { ...current, drawSalt: (current.drawSalt ?? 0) + 1 });
        },

        syncPairings: (key, pairings) => {
          const current = get().seasons[key] ?? empty;
          const next = syncedPairings(current, pairings);
          if (next.changed) set((s) => ({ seasons: { ...s.seasons, [key]: { ...current, predictions: next.predictions, pairings: next.pairings } } }));
          return next.removed;
        },

        reset: (key) => commit(key, empty),

        undo: (key) =>
          set((s) => {
            const stack = s.history[key] ?? [];
            const previous = stack.at(-1);
            if (!previous) return s;
            return {
              seasons: { ...s.seasons, [key]: previous },
              history: { ...s.history, [key]: stack.slice(0, -1) },
            };
          }),

        drop: (key, ids) => {
          const current = get().seasons[key];
          if (!current || !ids.some((id) => current.predictions[id])) return;
          const predictions = { ...current.predictions };
          for (const id of ids) delete predictions[id];
          set((s) => ({ seasons: { ...s.seasons, [key]: { ...current, predictions } } }));
        },

        reconcile: (key, fixtures) => {
          const current = get().seasons[key];
          if (!current) return 0;
          const overrides = new Set(current.overrides);
          const predictions = { ...current.predictions };
          let removed = 0;
          for (const f of fixtures) {
            if (f.result && predictions[f.id] && !overrides.has(f.id)) {
              delete predictions[f.id];
              removed++;
            }
          }
          if (removed > 0) {
            set((s) => ({ seasons: { ...s.seasons, [key]: { ...current, predictions } } }));
          }
          return removed;
        },
      };
    },
    {
      name: "footsimu",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ seasons: s.seasons }),
      // Hydrated manually after mount so server and first client render match.
      skipHydration: true,
    },
  ),
);

export const emptySeason = empty;
