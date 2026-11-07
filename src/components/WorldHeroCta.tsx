"use client";

import { useEffect, useState } from "react";
import { WORLD_KEY } from "../lib/myWorldStorage.ts";
import { PLAY_ANCHOR } from "../lib/worldHero.ts";
import { Icon } from "./Icon.tsx";

/**
 * The hero's button: "Start your world", or "Continue your world" once this
 * browser has a saved world (known only after mounting: the server renders
 * the start label). It scrolls to the game below the hero either way.
 */
export function WorldHeroCta({ start, resume }: { start: string; resume: string }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    try {
      setSaved(window.localStorage.getItem(WORLD_KEY) !== null);
    } catch {
      // No storage (private browsing): the start label stays.
    }
  }, []);
  return (
    <a
      href={`#${PLAY_ANCHOR}`}
      className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-pitch-500 px-5 text-base font-semibold text-white shadow-lg shadow-pitch-500/20 transition hover:bg-pitch-600 sm:w-auto"
      data-testid="world-hero-cta"
      data-state={saved ? "continue" : "start"}
    >
      {saved ? resume : start}
      <Icon name="chevron-right" size={18} className="shrink-0" />
    </a>
  );
}
