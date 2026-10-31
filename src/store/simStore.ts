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
}

interface SimStore {
  seasons: Record<string, SeasonState>;
  /** Undo snapshots per season; kept in memory only. */
  history: Record<string, SeasonState[]>;
  setScore: (key: string, fixture: Fixture, score: Score | null) => void;
  applyResults: (key: string, results: ResultMap) => void;
  replace: (key: string, fixtures: readonly Fixture[], predictions: ResultMap) => void;
  reset: (key: string) => void;
  undo: (key: string) => void;
  /** Drops predictions that real results have superseded; returns how many. */
  reconcile: (key: string, fixtures: readonly Fixture[]) => number;
}

const empty: SeasonState = { predictions: {}, overrides: [] };

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

        replace: (key, fixtures, predictions) => {
          const overrides = fixtures.filter((f) => f.result && predictions[f.id]).map((f) => f.id);
          commit(key, { predictions, overrides });
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
