"use client";

import { createElement as h, useEffect, useRef } from "react";
import { pushAd } from "../lib/adSlots.ts";

/**
 * A live slot's AdSense unit: its <ins>, sized by its box's classes, and one
 * request to fill it once on the page. The script that fills it is the Auto
 * ads one the layout already loads: no script of its own.
 */
export function AdUnit({ client, unit, className }: { client: string; unit: string; className: string }) {
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    try {
      pushAd(window as unknown as { adsbygoogle?: unknown[] });
    } catch {
      // An ad that can't load leaves its box empty: the page doesn't move.
    }
  }, []);
  return h("ins", { className: `adsbygoogle block ${className}`, "data-ad-client": client, "data-ad-slot": unit, "data-testid": "ad-unit" });
}
