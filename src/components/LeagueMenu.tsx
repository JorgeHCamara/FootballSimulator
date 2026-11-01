"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { countries } from "../config/leagues.ts";
import { Link, usePathname } from "../i18n/navigation.ts";
import { Flag } from "./Flag.tsx";

const CLOSE_DELAY_MS = 150;

/** Countries with their leagues, alphabetical in the current language. */
export function useCountryGroups() {
  const t = useTranslations("Countries");
  const locale = useLocale();
  return useMemo(() => countries().sort((a, b) => t(a.country).localeCompare(t(b.country), locale)), [t, locale]);
}

/**
 * Header menu: one entry per country (alphabetical in the current language),
 * each opening a submenu with that country's leagues. Opens on mouse hover, or
 * on click/tap/Enter; closes on leaving, Esc, an outside click or choosing a league.
 * Shown on wide screens; phones and small tablets use MobileMenu instead.
 */
export function LeagueMenu() {
  const t = useTranslations("Countries");
  const nav = useTranslations("Nav");
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The open submenu came from hovering, so a click on its button shouldn't close it. */
  const openedByHover = useRef(false);
  const menuRef = useRef<HTMLUListElement>(null);

  const groups = useCountryGroups();

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_DELAY_MS);
  };

  // Close on Esc and on clicks/taps outside the menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Close after navigating to a league.
  useEffect(() => setOpen(null), [pathname]);

  return (
    <nav aria-label={nav("leagues")} className="hidden border-t border-white/10 bg-pitch-900/40 lg:block">
      <ul ref={menuRef} className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-1 gap-y-0.5 px-2 py-1.5 text-sm" data-testid="league-menu">
        {groups.map((group, i) => {
          const isOpen = open === group.country;
          const active = group.leagues.some((l) => pathname === `/${l.slug}`);
          const id = `menu-${group.flag}`;
          // Keep dropdowns of the last entries inside the viewport.
          const alignRight = i >= groups.length - 2;
          return (
            <li
              key={group.country}
              className="relative"
              // Hover only for real mice: a tap also fires pointer-enter, and would
              // otherwise open the menu and then toggle it shut on the click.
              onPointerEnter={(e) => {
                if (e.pointerType !== "mouse") return;
                cancelClose();
                openedByHover.current = open !== group.country;
                setOpen(group.country);
              }}
              onPointerLeave={(e) => e.pointerType === "mouse" && scheduleClose()}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => {
                  setOpen(isOpen && !openedByHover.current ? null : group.country);
                  openedByHover.current = false;
                }}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-pitch-50 hover:bg-white/10 ${isOpen || active ? "bg-white/10" : ""}`}
              >
                <Flag code={group.flag} width={18} />
                {t(group.country)}
                <svg aria-hidden viewBox="0 0 12 12" width="10" height="10" className={`transition ${isOpen ? "rotate-180" : ""}`}>
                  <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {isOpen && (
                <ul
                  id={id}
                  className={`absolute top-full z-30 mt-1 min-w-52 rounded-xl border border-zinc-200 bg-white p-1 text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 ${alignRight ? "right-0" : "left-0"}`}
                  onPointerEnter={cancelClose}
                >
                  {group.leagues.map((league) => {
                    const current = pathname === `/${league.slug}`;
                    return (
                      <li key={league.code}>
                        <Link
                          href={`/${league.slug}`}
                          aria-current={current ? "page" : undefined}
                          onClick={() => setOpen(null)}
                          className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 hover:bg-pitch-50 dark:hover:bg-pitch-900/40 ${current ? "bg-pitch-50 font-semibold text-pitch-700 dark:bg-pitch-900/40 dark:text-pitch-100" : ""}`}
                        >
                          <Flag code={league.flag} width={18} />
                          {league.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
