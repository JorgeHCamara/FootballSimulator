"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { continents, type ContinentGroup, type CountryGroup } from "../config/competitions.ts";
import { Link, usePathname } from "../i18n/navigation.ts";
import { MY_WORLD_LISTED } from "../lib/site.ts";
import { Flag } from "./Flag.tsx";
import { Icon } from "./Icon.tsx";

const CLOSE_DELAY_MS = 150;

/**
 * Continents with their countries: a continental federation (UEFA) first, then
 * the countries alphabetically in the current language.
 */
export function useContinentGroups(): ContinentGroup[] {
  const t = useTranslations("Countries");
  const locale = useLocale();
  return useMemo(
    () =>
      continents().map((group) => ({
        ...group,
        countries: [...group.countries].sort((a, b) => Number(isFederation(b)) - Number(isFederation(a)) || t(a.country).localeCompare(t(b.country), locale)),
      })),
    [t, locale],
  );
}

/** A continental federation's group (UEFA, CONMEBOL), listed before the countries. */
const isFederation = (group: CountryGroup) => group.flag === "eu" || group.flag === "conmebol";

/** One country (or UEFA) and its competitions, as a column of a mega-menu panel. */
export function CountryColumn({ group, onPick, large = false }: { group: CountryGroup; onPick: () => void; large?: boolean }) {
  const t = useTranslations("Countries");
  const pathname = usePathname();
  return (
    <div>
      <p className="flex items-center gap-2 px-2 pb-1 text-xs font-bold uppercase tracking-wide text-zinc-500">
        <Flag code={group.flag} width={18} />
        {t(group.country)}
      </p>
      <ul id={`menu-${group.flag}`}>
        {group.leagues.map((league) => {
          const current = pathname === `/${league.slug}`;
          return (
            <li key={league.code}>
              <Link
                href={`/${league.slug}`}
                aria-current={current ? "page" : undefined}
                onClick={onPick}
                className={`block whitespace-nowrap rounded-lg px-2 ${large ? "py-2 text-base" : "py-1.5 text-sm"} hover:bg-pitch-50 dark:hover:bg-pitch-900/40 ${current ? "bg-pitch-50 font-semibold text-pitch-700 dark:bg-pitch-900/40 dark:text-pitch-100" : ""}`}
              >
                {league.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Header menu: one entry per continent, each opening a panel with a column
 * per country (and UEFA) listing its leagues and cups. Opens on mouse hover,
 * or on click/tap/Enter; closes on leaving, Esc, an outside click or choosing
 * a competition. Shown on wide screens; phones and small tablets use MobileMenu.
 */
export function LeagueMenu() {
  const t = useTranslations("Continents");
  const nav = useTranslations("Nav");
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The open panel came from hovering, so a click on its button shouldn't close it. */
  const openedByHover = useRef(false);
  const menuRef = useRef<HTMLUListElement>(null);

  const groups = useContinentGroups();

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

  // Close after navigating to a competition.
  useEffect(() => setOpen(null), [pathname]);

  return (
    <nav aria-label={nav("leagues")} className="hidden border-t border-white/10 bg-pitch-900/40 lg:block">
      <ul ref={menuRef} className="relative mx-auto flex max-w-6xl justify-center gap-x-1 px-2 py-1.5 text-sm" data-testid="league-menu">
        {groups.map((group) => {
          const isOpen = open === group.continent;
          const active = group.countries.some((c) => c.leagues.some((l) => pathname === `/${l.slug}`));
          const id = `menu-${group.continent.toLowerCase().replace(/\s+/g, "-")}`;
          // A continent with several countries gets a wide panel centred under the
          // bar; one with a single country a small one under its own button.
          const wide = group.countries.length > 2;
          const columns = Math.min(group.countries.length, 4);
          return (
            <li
              key={group.continent}
              className={wide ? "" : "relative"}
              // Hover only for real mice: a tap also fires pointer-enter, and would
              // otherwise open the menu and then toggle it shut on the click.
              onPointerEnter={(e) => {
                if (e.pointerType !== "mouse") return;
                cancelClose();
                openedByHover.current = open !== group.continent;
                setOpen(group.continent);
              }}
              onPointerLeave={(e) => e.pointerType === "mouse" && scheduleClose()}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => {
                  setOpen(isOpen && !openedByHover.current ? null : group.continent);
                  openedByHover.current = false;
                }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium text-pitch-50 hover:bg-white/10 ${isOpen || active ? "bg-white/10" : ""}`}
              >
                {t(group.continent)}
                <Icon name="chevron-down" size={14} className={`transition ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && (
                <div
                  id={id}
                  data-testid="menu-panel"
                  className={`absolute top-full z-30 mt-1 rounded-xl border border-zinc-200 bg-white p-3 text-zinc-900 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 ${wide ? "left-1/2 w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2" : "left-0 w-max min-w-52"}`}
                  onPointerEnter={cancelClose}
                >
                  {/* Wide panels share their width in a grid; small ones size to their columns. */}
                  <div className={wide ? `grid gap-4 ${columns === 4 ? "grid-cols-4" : "grid-cols-3"}` : "flex gap-6"}>
                    {group.countries.map((country) => (
                      <CountryColumn key={country.country} group={country} onPick={() => setOpen(null)} />
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {/* Every league's latest "what changed" report. */}
        <li>
          <Link
            href="/odds"
            aria-current={pathname === "/odds" ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium text-pitch-50 hover:bg-white/10 ${pathname === "/odds" || pathname.endsWith("/odds") || pathname.includes("/odds/") ? "bg-white/10" : ""}`}
            data-testid="nav-latest-odds"
          >
            <Icon name="trending-up" size={14} />
            {nav("latestOdds")}
          </Link>
        </li>
        {/* My World: a club's seasons up the English pyramid (unlisted for now, see MY_WORLD_LISTED). */}
        {MY_WORLD_LISTED && (
          <li>
            <Link
              href="/my-world"
              aria-current={pathname === "/my-world" ? "page" : undefined}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium text-pitch-50 hover:bg-white/10 ${pathname === "/my-world" || pathname.endsWith("/my-world") ? "bg-white/10" : ""}`}
              data-testid="nav-my-world"
            >
              <Icon name="globe" size={14} />
              {nav("myWorld")}
            </Link>
          </li>
        )}
        {/* The daily quiz. */}
        <li>
          <Link
            href="/quiz"
            aria-current={pathname === "/quiz" ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium text-pitch-50 hover:bg-white/10 ${pathname === "/quiz" || pathname.endsWith("/quiz") ? "bg-white/10" : ""}`}
            data-testid="nav-quiz"
          >
            <Icon name="circle-help" size={14} />
            {nav("quiz")}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
