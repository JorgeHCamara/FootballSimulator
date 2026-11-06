"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "../i18n/navigation.ts";
import { MY_WORLD_LISTED } from "../lib/site.ts";
import { Flag } from "./Flag.tsx";
import { CountryColumn, useContinentGroups } from "./LeagueMenu.tsx";
import { Icon } from "./Icon.tsx";

/** Flags shown on a continent's row, in this order whatever the menu's (else the first six). */
const PREVIEW: Partial<Record<string, readonly string[]>> = {
  Europe: ["UEFA", "England", "Spain", "Germany", "Italy", "France"],
};

function previewCountries<T extends { country: string }>(continent: string, countries: readonly T[]): T[] {
  const preferred = PREVIEW[continent];
  if (!preferred) return countries.slice(0, 6);
  const picked = preferred.flatMap((name) => countries.filter((c) => c.country === name));
  return [...picked, ...countries.filter((c) => !picked.includes(c))].slice(0, 6);
}

/**
 * Phones and small tablets: a menu button beside the logo opens a panel with one
 * row per continent; tapping a continent shows its countries and their
 * competitions (one continent at a time, so Asia is as close as Europe). On a
 * competition's page its continent starts open. Closes on the button, Esc, a
 * tap outside or choosing a competition.
 */
export function MobileMenu() {
  const tc = useTranslations("Continents");
  const nav = useTranslations("Nav");
  const pathname = usePathname();
  const groups = useContinentGroups();
  const [open, setOpen] = useState(false);
  /** The continent shown open, or null for all closed. */
  const [expanded, setExpanded] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // The current page's continent (none on the home page).
  const current = groups.find((g) => g.countries.some((c) => c.leagues.some((l) => pathname === `/${l.slug}`)))?.continent ?? null;

  useEffect(() => setOpen(false), [pathname]);
  // Each time the menu opens, start from the current page's continent.
  useEffect(() => {
    if (open) setExpanded(current);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <Icon name={open ? "x" : "menu"} size={22} />
      </button>
      {open && (
        <nav
          id="mobile-menu"
          aria-label={nav("leagues")}
          className="absolute inset-x-0 top-full z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-white/10 bg-white text-zinc-900 shadow-xl dark:bg-zinc-900 dark:text-zinc-100"
          data-testid="mobile-menu"
        >
          <div className="mx-auto max-w-6xl px-4 py-2">
            {/* Every league's latest "what changed" report. */}
            <Link
              href="/odds"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg border-b border-zinc-100 px-2 py-3 text-base font-extrabold text-zinc-800 hover:bg-pitch-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-pitch-900/40"
              data-testid="mobile-latest-odds"
            >
              <Icon name="trending-up" size={18} className="shrink-0 text-pitch-600" />
              {nav("latestOdds")}
            </Link>
            {/* My World: a club's seasons up the English pyramid (unlisted for now, see MY_WORLD_LISTED). */}
            {MY_WORLD_LISTED && (
              <Link
                href="/my-world"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg border-b border-zinc-100 px-2 py-3 text-base font-extrabold text-zinc-800 hover:bg-pitch-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-pitch-900/40"
                data-testid="mobile-my-world"
              >
                <Icon name="globe" size={18} className="shrink-0 text-pitch-600" />
                {nav("myWorld")}
              </Link>
            )}
            {/* The daily quiz. */}
            <Link
              href="/quiz"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg border-b border-zinc-100 px-2 py-3 text-base font-extrabold text-zinc-800 hover:bg-pitch-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-pitch-900/40"
              data-testid="mobile-quiz"
            >
              <Icon name="circle-help" size={18} className="shrink-0 text-pitch-600" />
              {nav("quiz")}
            </Link>
            {groups.map((group) => {
              const isOpen = expanded === group.continent;
              const id = `mobile-${group.continent.toLowerCase().replace(/\s+/g, "-")}`;
              return (
                <section key={group.continent} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800" data-testid="mobile-continent">
                  <h2>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={id}
                      onClick={() => setExpanded(isOpen ? null : group.continent)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-pitch-50 dark:hover:bg-pitch-900/40"
                      data-testid="mobile-continent-button"
                    >
                      <span className="grow text-base font-extrabold text-zinc-800 dark:text-zinc-100">{tc(group.continent)}</span>
                      {/* What's inside, at a glance. */}
                      <span className="flex shrink-0 items-center gap-1" aria-hidden>
                        {previewCountries(group.continent, group.countries).map((country) => (
                          <span key={country.country} className="contents" data-flag={country.flag}>
                            <Flag code={country.flag} width={16} />
                          </span>
                        ))}
                        {group.countries.length > 6 && <span className="text-xs text-zinc-500">+{group.countries.length - 6}</span>}
                      </span>
                      <Icon name="chevron-down" size={16} className={`shrink-0 text-zinc-500 transition ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  </h2>
                  {isOpen && (
                    <ul id={id} className="grid gap-x-4 gap-y-2 pb-3 sm:grid-cols-2" data-testid="mobile-continent-panel">
                      {group.countries.map((country) => (
                        <li key={country.country}>
                          <CountryColumn group={country} onPick={() => setOpen(false)} large />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
