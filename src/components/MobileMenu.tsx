"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "../i18n/navigation.ts";
import { CountryColumn, useContinentGroups } from "./LeagueMenu.tsx";

/**
 * Phones and small tablets: a ☰ button beside the logo opens a panel with every
 * continent, its countries and their leagues, so any competition is one tap away. Closes on the button,
 * Esc, a tap outside or choosing a league.
 */
export function MobileMenu() {
  const tc = useTranslations("Continents");
  const nav = useTranslations("Nav");
  const pathname = usePathname();
  const groups = useContinentGroups();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? nav("closeMenu") : nav("openMenu")}
        onClick={() => setOpen(!open)}
        className="-ml-1 flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
        data-testid="mobile-menu-button"
      >
        <svg aria-hidden viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <nav
          id="mobile-menu"
          aria-label={nav("leagues")}
          className="absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-white/10 bg-white text-zinc-900 shadow-xl dark:bg-zinc-900 dark:text-zinc-100"
          data-testid="mobile-menu"
        >
          <div className="mx-auto max-w-6xl px-4 py-2">
            {groups.map((group) => (
              <section key={group.continent} className="border-b border-zinc-100 py-2 last:border-b-0 dark:border-zinc-800" data-testid="mobile-continent">
                <h2 className="px-2 pb-1 text-sm font-extrabold text-zinc-800 dark:text-zinc-100">{tc(group.continent)}</h2>
                <ul className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {group.countries.map((country) => (
                    <li key={country.country}>
                      <CountryColumn group={country} onPick={() => setOpen(false)} large />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
