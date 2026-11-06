import { adsenseClient } from "./site.ts";

/*
 * Reserved ad placements (src/components/AdSlot.ts), for when display ads are
 * turned on after the AdSense review: each slot keeps the exact size of its
 * ad, so a filled ad never moves the page (no layout shift). Everything here
 * is off by default, and none of it touches ads.txt or the Auto ads script in
 * the layout: a live slot is only its own <ins>, filled by that script.
 *
 * Settings (build-time, as NEXT_PUBLIC_ADSENSE_CLIENT):
 * - NEXT_PUBLIC_ADS_SLOTS=1: turn the slots on.
 * - NEXT_PUBLIC_ADS_UNIT_IN_CONTENT, NEXT_PUBLIC_ADS_UNIT_RAIL: each kind's
 *   AdSense ad unit id (data-ad-slot, digits).
 * - NEXT_PUBLIC_ADS_DEBUG=1: show each slot's box, labelled "Ad" (to check
 *   the layout before any ad is live).
 */

/** In the page's flow (after a section), or a desktop rail beside it. */
export type AdKind = "inContent" | "rail";

/**
 * Each kind's ad size in pixels (width, height) on phones and from the md
 * breakpoint (768px) up: a medium rectangle in the page on phones, a
 * leaderboard on wider screens; a half-page rail on wide desktops only.
 */
export const AD_SIZES: Record<AdKind, { mobile?: readonly [number, number]; desktop: readonly [number, number] }> = {
  inContent: { mobile: [300, 250], desktop: [728, 90] },
  rail: { desktop: [300, 600] },
};

export interface AdsConfig {
  /** NEXT_PUBLIC_ADS_SLOTS=1. */
  slots: boolean;
  /** NEXT_PUBLIC_ADS_DEBUG=1. */
  debug: boolean;
  /** The AdSense publisher id, through the site's own helper (adsenseClient). */
  client?: string;
  /** Each kind's ad unit id. */
  units: Partial<Record<AdKind, string>>;
}

type Env = Partial<Record<"NEXT_PUBLIC_ADS_SLOTS" | "NEXT_PUBLIC_ADS_DEBUG" | "NEXT_PUBLIC_ADSENSE_CLIENT" | "NEXT_PUBLIC_ADS_UNIT_IN_CONTENT" | "NEXT_PUBLIC_ADS_UNIT_RAIL", string>>;

const unit = (value: string | undefined) => {
  const id = value?.trim();
  return id && /^\d{6,20}$/.test(id) ? id : undefined;
};

/** The settings, from the environment (named one by one, as Next inlines them). */
export function adsConfig(
  env: Env = {
    NEXT_PUBLIC_ADS_SLOTS: process.env.NEXT_PUBLIC_ADS_SLOTS,
    NEXT_PUBLIC_ADS_DEBUG: process.env.NEXT_PUBLIC_ADS_DEBUG,
    NEXT_PUBLIC_ADSENSE_CLIENT: process.env.NEXT_PUBLIC_ADSENSE_CLIENT,
    NEXT_PUBLIC_ADS_UNIT_IN_CONTENT: process.env.NEXT_PUBLIC_ADS_UNIT_IN_CONTENT,
    NEXT_PUBLIC_ADS_UNIT_RAIL: process.env.NEXT_PUBLIC_ADS_UNIT_RAIL,
  },
): AdsConfig {
  const client = adsenseClient(env.NEXT_PUBLIC_ADSENSE_CLIENT);
  const units: AdsConfig["units"] = {};
  const inContent = unit(env.NEXT_PUBLIC_ADS_UNIT_IN_CONTENT);
  const rail = unit(env.NEXT_PUBLIC_ADS_UNIT_RAIL);
  if (inContent) units.inContent = inContent;
  if (rail) units.rail = rail;
  return { slots: env.NEXT_PUBLIC_ADS_SLOTS === "1", debug: env.NEXT_PUBLIC_ADS_DEBUG === "1", ...(client ? { client } : {}), units };
}

/**
 * What a slot renders:
 * - "off" (the default): nothing. The live site is exactly as without slots
 *   (chosen over an empty reserved box while the site is under AdSense
 *   review: no blank gaps for visitors). The flag is a build setting, so
 *   turning it on changes the page between deployments, never while one loads.
 * - "reserved": the slots are on but the publisher id or the kind's ad unit
 *   isn't set: the empty box at its ad's size, so the layout is as it will be.
 * - "debug": the box, labelled "Ad" (NEXT_PUBLIC_ADS_DEBUG=1, slots off).
 * - "live": the box with its ad unit (<ins>), for the Auto ads script to fill.
 */
export type AdMode = "off" | "reserved" | "debug" | "live";

export function adMode(kind: AdKind, config: AdsConfig): AdMode {
  if (config.slots && config.client && config.units[kind]) return "live";
  if (config.slots) return "reserved";
  if (config.debug) return "debug";
  return "off";
}

/** Asks AdSense to fill the next unit on the page (adsbygoogle.push({}), as its code does). */
export function pushAd(target: { adsbygoogle?: unknown[] }) {
  (target.adsbygoogle = target.adsbygoogle ?? []).push({});
}
