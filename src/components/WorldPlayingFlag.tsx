"use client";

import { useLayoutEffect } from "react";
import { WORLD_KEY } from "../lib/myWorldStorage.ts";

/** The attribute on <html> while this browser has a world being played: the hero then goes (globals.css, `.world-hero`). */
export const PLAYING_ATTR = "data-world-playing";

/** Sets or clears the attribute (MyWorld, as a world is created or reset). */
export function markWorldPlaying(playing: boolean) {
  document.documentElement.toggleAttribute(PLAYING_ATTR, playing);
}

/**
 * Marks the page as soon as a saved world is known, so My World's hero,
 * pointless to a visitor already playing, never shows: on a first load the
 * inline script runs before the hero is drawn; on a move from another page
 * (where React doesn't run inline scripts) the layout effect does, also
 * before the page is painted. Leaving the page clears it.
 */
export function WorldPlayingFlag() {
  useLayoutEffect(() => {
    try {
      markWorldPlaying(window.localStorage.getItem(WORLD_KEY) !== null);
    } catch {
      // No storage (private browsing): no saved world, the hero stays.
    }
    return () => markWorldPlaying(false);
  }, []);
  const script = `try{if(localStorage.getItem(${JSON.stringify(WORLD_KEY)})!==null)document.documentElement.setAttribute(${JSON.stringify(PLAYING_ATTR)},"")}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
