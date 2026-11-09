"use client";

import { useState, type ComponentProps } from "react";
import { Link } from "../i18n/navigation.ts";

type Props = ComponentProps<typeof Link> & {
  /** What to prefetch once the visitor shows intent: the route's default (null), or the whole page (true). */
  intentPrefetch?: true | null;
};

/**
 * A link prefetched only once the visitor shows they may follow it: the
 * pointer over it, keyboard focus on it, or a finger on it (Next's
 * hover-triggered prefetch, node_modules/next/dist/docs, guides/prefetching).
 * A plain link prefetches as soon as it's on screen, and a page of fixtures
 * or the footer's fifty competitions puts dozens on screen at once: each a
 * request, and on a page not built yet, a function run. Still a real
 * <a href>: crawlers, keyboards, middle clicks and the address preview work
 * as before; only the background request waits for intent.
 */
export function IntentLink({ intentPrefetch = null, onMouseEnter, onFocus, onTouchStart, ...props }: Props) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? intentPrefetch : false}
      onMouseEnter={(event) => {
        setIntent(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setIntent(true);
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        setIntent(true);
        onTouchStart?.(event);
      }}
    />
  );
}
