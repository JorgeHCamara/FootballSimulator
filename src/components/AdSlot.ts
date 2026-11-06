import { createElement as h } from "react";
import { adMode, adsConfig, type AdKind, type AdsConfig } from "../lib/adSlots.ts";
import { AdUnit } from "./AdUnit.ts";

/*
 * Written with createElement (no JSX) so the unit tests can render it.
 */

/** The box each kind reserves: its ad's exact size (AD_SIZES), on phones and from md up. Written out in full for the CSS build to find. */
const BOX: Record<AdKind, string> = {
  inContent: "h-[250px] w-[300px] md:h-[90px] md:w-[728px]",
  rail: "hidden h-[600px] w-[300px] lg:block",
};

/**
 * A reserved ad placement (see src/lib/adSlots.ts): nothing by default; with
 * the slots on, a box at its ad's exact size holding its ad unit, so a filled
 * ad doesn't move the page. A subtle "Ad" label only with the debug flag.
 */
export function AdSlot({ kind, config = adsConfig(), className = "" }: { kind: AdKind; config?: AdsConfig; className?: string }) {
  const mode = adMode(kind, config);
  if (mode === "off") return null;
  const live = mode === "live";
  const outline = config.debug ? "rounded-md border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900" : "";
  return h(
    "div",
    {
      className: `flex justify-center overflow-hidden ${kind === "rail" ? "hidden lg:flex" : ""} ${className}`.trim(),
      "data-testid": "ad-slot",
      "data-ad-kind": kind,
      "data-ad-mode": mode,
      ...(live ? {} : { "aria-hidden": "true" }),
    },
    h(
      "div",
      { className: `relative shrink-0 ${BOX[kind]} ${outline}`.trim(), "data-testid": "ad-box" },
      config.debug ? h("span", { className: "absolute left-1.5 top-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400" }, "Ad") : null,
      live ? h(AdUnit, { client: config.client!, unit: config.units[kind]!, className: BOX[kind] }) : null,
    ),
  );
}
