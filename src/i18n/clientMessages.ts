/*
 * Which messages each route sends to the browser. Everything a client
 * component reads with useTranslations is serialized into the page (the
 * HTML's inline payload and the RSC response), on every regeneration and
 * cache miss, so a page carries only what its own client components use:
 * - the layout, the header's menus' (Nav, Countries, Continents) on every page;
 * - a page with client components of its own wraps them in ClientMessages
 *   (src/components/ClientMessages.tsx) with its scope below.
 * A nested provider replaces its parent's messages for what's inside it (no
 * merge), so a scope lists everything the components inside it use.
 * src/i18n/clientMessages.test.ts follows each route's imports to the client
 * components it can render and fails when a namespace (or key) one of them
 * uses isn't sent.
 */

/** A whole namespace, or only some of its keys (for a component that uses a few of a large namespace's). */
export type MessageScope = readonly (string | { namespace: string; keys: readonly string[] })[];

/** The header's menus and language switcher, on every page. */
export const LAYOUT_SCOPE = ["Nav", "Countries", "Continents"] as const satisfies MessageScope;

/** What the share menu (src/components/ShareMenu.tsx) says: a few of the simulator's 139 messages. */
export const SHARE_MENU_KEYS = [
  "share",
  "shareMenu",
  "shareNative",
  "shareImage",
  "sharePreparing",
  "shareImageReady",
  "shareFailed",
  "copyLink",
  "copied",
  "shareX",
  "shareWhatsApp",
  "shareReddit",
  "shareFacebook",
  "downloadImage",
] as const;

/** A page whose only client component with messages is the share menu (club pages, odds reports). */
export const SHARE_MENU_SCOPE = [{ namespace: "Simulator", keys: SHARE_MENU_KEYS }] as const satisfies MessageScope;

/** A league's simulator (its table, fixtures, chances, tournaments, play-offs and promotion path). */
export const LEAGUE_SCOPE = ["Simulator", "Zones", "Promotion"] as const satisfies MessageScope;

/** A cup's simulator (its rounds, bracket and chances, and its past winners). */
export const CUP_SCOPE = ["Simulator", "Cup", "PastWinners"] as const satisfies MessageScope;

/** A shared prediction: the league's simulator, read-only. */
export const SHARE_PAGE_SCOPE = ["Simulator", "Zones"] as const satisfies MessageScope;

/** A league's past winners. */
export const PAST_WINNERS_SCOPE = ["PastWinners"] as const satisfies MessageScope;

/** My World: the game's own words, the league simulator's (its fixtures and dice) and the cups'. */
export const MY_WORLD_SCOPE = ["World", "Simulator", "PastWinners", "Cup", "Zones"] as const satisfies MessageScope;

type Messages = Record<string, unknown>;

/** The messages a scope sends, from all of a locale's: missing namespaces or keys are left out. */
export function pickMessages(messages: Messages, scope: MessageScope): Messages {
  const out: Messages = {};
  for (const entry of scope) {
    if (typeof entry === "string") {
      if (entry in messages) out[entry] = messages[entry];
      continue;
    }
    const all = messages[entry.namespace] as Messages | undefined;
    if (!all) continue;
    const kept = (out[entry.namespace] ??= {}) as Messages;
    for (const key of entry.keys) if (key in all) kept[key] = all[key];
  }
  return out;
}
