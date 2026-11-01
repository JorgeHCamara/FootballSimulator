"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "../i18n/navigation.ts";
import { Flag } from "./Flag.tsx";
import { useCountryGroups } from "./LeagueMenu.tsx";

/**
 * Phones and small tablets: a ☰ button beside the logo opens a panel with every
 * country and its leagues, so any league is one tap away. Closes on the button,
 * Esc, a tap outside or choosing a league.
 */
export function MobileMenu() {
  const t = useTranslations("Countries");
  const nav = useTranslations("Nav");
  const pathname = usePathname();
  const groups = useCountryGroups();
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
          <ul className="mx-auto grid max-w-6xl gap-x-4 px-4 py-2 sm:grid-cols-2">
            {groups.map((group) => (
              <li key={group.country} className="border-b border-zinc-100 py-2 last:border-b-0 dark:border-zinc-800 sm:border-b-0">
                <p className="flex items-center gap-2 px-2 pb-1 text-xs font-bold uppercase tracking-wide text-zinc-500">
                  <Flag code={group.flag} width={18} />
                  {t(group.country)}
                </p>
                <ul>
                  {group.leagues.map((league) => {
                    const current = pathname === `/${league.slug}`;
                    return (
                      <li key={league.code}>
                        <Link
                          href={`/${league.slug}`}
                          aria-current={current ? "page" : undefined}
                          onClick={() => setOpen(false)}
                          className={`block rounded-lg px-2 py-2 text-base hover:bg-pitch-50 dark:hover:bg-pitch-900/40 ${current ? "bg-pitch-50 font-semibold text-pitch-700 dark:bg-pitch-900/40 dark:text-pitch-100" : ""}`}
                        >
                          {league.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
