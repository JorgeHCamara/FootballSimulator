"use client";

import type { FlagCode } from "../config/leagues.ts";
import { IntentLink } from "./IntentLink.tsx";

/** A competition in the footer: [code, slug, name, flag]. */
export type FooterLeague = readonly [string, string, string, FlagCode];

/**
 * The footer's competitions, every page: the same links and flags the footer
 * drew as server components, from a compact list. A server component's output
 * is sent twice, as HTML and again as RSC data, every element with its props;
 * fifty links were about 16 KB of every page's RSC data. As a client component
 * the HTML is the same, and the RSC data carries only the list.
 */
export function FooterLeagues({ leagues, sprite }: { leagues: readonly FooterLeague[]; sprite: string }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
      {leagues.map(([code, slug, name, flag]) => (
        <li key={code}>
          {/* Fifty competitions on every page: prefetched on intent only (src/components/IntentLink.tsx). */}
          <IntentLink href={`/${slug}`} className="footer-league">
            {/* As <Flag code={flag} width={16} /> draws it, from the sprite (src/lib/flagSprite.tsx). */}
            <svg viewBox="0 0 30 20" width={16} height={(16 * 2) / 3} aria-hidden="true" focusable="false" className="flag-16">
              <use href={`${sprite}#${flag}`} />
            </svg>
            {name}
          </IntentLink>
        </li>
      ))}
    </ul>
  );
}
