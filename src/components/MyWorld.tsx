"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteLocale } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import { ordinal } from "../lib/clubText.ts";
import {
  clubCountry,
  clubDivision,
  clubPath,
  COUNTRY_CUPS,
  COUNTRY_FLAG,
  COUNTRY_LEAGUES,
  createWorld,
  cupCountry,
  divisionConfig,
  divisionCountry,
  gamesInSeason,
  gamesLeft,
  LOWER_LEAGUE,
  neighbours,
  packReady,
  playSeason,
  seasonLabelFor,
  worldSeasonLabel,
  seasonMoves,
  seasonStates,
  startNextSeason,
  type DivisionCode,
  type PathOutcome,
  type SeasonRecord,
  type StartPack,
  type World,
  type WorldClub,
  type WorldCountry,
  isDivision,
  WORLD_COUNTRIES,
  worldDivisions,
} from "../lib/myWorld.ts";
import { browserStore, clearWorld, loadWorld, saveWorld } from "../lib/myWorldStorage.ts";
import { markWorldPlaying } from "./WorldPlayingFlag.tsx";
import { PLAY_ANCHOR } from "../lib/worldHero.ts";
import { cupGamesInSeason, cupGamesLeft, cupStates, isWorldCup, outsidersNeeded, type WorldCupCode } from "../lib/worldCups.ts";
import { Flag } from "./Flag.tsx";
import { Icon } from "./Icon.tsx";
import { TeamBadge } from "./TeamBadge.tsx";
import { zoneHex } from "./zones.ts";
import { WorldCup } from "./WorldCup.tsx";
import { DivisionTabs, openingMatchday, Picker, WorldSeason } from "./WorldSeason.tsx";

type View = { kind: "loading" } | { kind: "setup"; reset?: "incompatible" | "unreadable" } | { kind: "world"; world: World; saved: boolean };

/** Changes within a season that Undo can take back (in this visit only). */
const UNDO_STEPS = 50;

const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const primary = "flex h-11 items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700 disabled:opacity-60";
const secondary = "flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

/**
 * My World (see src/lib/myWorld.ts): set up a world from the live data, then
 * play it season by season, result by result, league by league. Everything
 * happens in the browser and is saved there after every step
 * (src/lib/myWorldStorage.ts).
 */
export function MyWorld({ pack, locale }: { pack: StartPack; locale: SiteLocale }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  // The worlds before each change in the season in progress, for Undo.
  const [past, setPast] = useState<World[]>([]);

  // The saved world, once in the browser (the server has none); the live data is for a world from before the cups (see upgradeWorld).
  useEffect(() => {
    const found = loadWorld(browserStore(), pack);
    setView(found.world ? { kind: "world", world: found.world, saved: true } : { kind: "setup", ...(found.reason === "incompatible" || found.reason === "unreadable" ? { reset: found.reason } : {}) });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A world being played: the page's hero goes (it's for visitors yet to start one); back on a reset.
  useEffect(() => {
    if (view.kind !== "loading") markWorldPlaying(view.kind === "world");
  }, [view.kind]);

  const keep = (world: World) => setView({ kind: "world", world, saved: saveWorld(browserStore(), world) });
  /** A change in the season in progress: Undo can take it back. */
  const change = (world: World) => {
    if (view.kind === "world") {
      const current = view.world;
      setPast((list) => [...list.slice(-(UNDO_STEPS - 1)), current]);
    }
    keep(world);
  };
  /** A season finished or started, or a new world: nothing to undo before it. */
  const commit = (world: World) => {
    setPast([]);
    keep(world);
  };
  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast((list) => list.slice(0, -1));
    keep(previous);
  };

  if (view.kind === "loading") return <Loading />;
  if (view.kind === "setup") {
    const onCreate = (league: DivisionCode, club: number, countries: WorldCountry[]) => {
      commit(createWorld(pack, { league, club, countries }));
      // The world opens at its top (below the hero): the club, its season and the ways to play it.
      requestAnimationFrame(() => (document.getElementById(PLAY_ANCHOR) ?? document.querySelector('[data-testid="my-world"]'))?.scrollIntoView({ block: "start" }));
    };
    return <Setup pack={pack} locale={locale} reset={view.reset} onCreate={onCreate} />;
  }
  return (
    <WorldScreen
      world={view.world}
      saved={view.saved}
      locale={locale}
      onChange={change}
      onCommit={commit}
      onSet={keep}
      canUndo={past.length > 0}
      onUndo={undo}
      onReset={() => {
        clearWorld(browserStore());
        setPast([]);
        setView({ kind: "setup" });
      }}
    />
  );
}

function Loading() {
  const t = useTranslations("World");
  return (
    <div className={`${card} flex items-center gap-2 text-sm text-zinc-500`} data-testid="world-loading">
      <Icon name="loader-circle" size={18} className="animate-spin" />
      {t("loading")}
    </div>
  );
}

/** Picking the countries (one card each; every one picked is played in full), then the league, then the club, then creating the world. */
function Setup({ pack, locale, reset, onCreate }: { pack: StartPack; locale: SiteLocale; reset?: "incompatible" | "unreadable"; onCreate: (league: DivisionCode, club: number, countries: WorldCountry[]) => void }) {
  const t = useTranslations("World");
  const [countries, setCountries] = useState<WorldCountry[]>([]);
  const [league, setLeague] = useState<DivisionCode | null>(null);
  const [club, setClub] = useState<number | null>(null);
  // A country whose live data didn't load can't be picked; with none to pick, no new world for now.
  const available = (country: WorldCountry) => packReady(pack, [country]);
  const ready = WORLD_COUNTRIES.some(available);
  const name = (code: string) => t(isWorldCup(code) ? `cups.${code}.name` : `leagues.${code}.name`);
  const leagues = worldDivisions(countries);
  const season = leagues[0] ? seasonLabelFor(countries, pack.leagues.find((l) => l.code === leagues[0])?.year ?? NaN) : "";
  const clubs = league ? (pack.leagues.find((l) => l.code === league)?.teams ?? []) : [];
  const chosen = clubs.find((c) => c.id === club);
  const createRef = useRef<HTMLDivElement>(null);
  // Picking a club: on to the last step (below the list on a phone).
  useEffect(() => {
    if (club !== null) createRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [club]);
  const toggle = (country: WorldCountry) => {
    setCountries((picked) => WORLD_COUNTRIES.filter((c) => (c === country ? !picked.includes(c) : picked.includes(c))));
    setLeague(null);
    setClub(null);
  };
  const countryNames = (list: readonly WorldCountry[]) => list.map((c) => t(`countries.${c}`)).join(t("setup.and"));
  const step = "flex items-center gap-2 text-base font-bold";
  const number = "inline-flex h-6 w-6 items-center justify-center rounded-full bg-pitch-600 text-xs font-bold text-white";
  const cardButton = (active: boolean) =>
    `flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition ${active ? "border-pitch-600 bg-pitch-50 dark:bg-pitch-900/40" : "border-zinc-200 bg-white hover:border-pitch-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:disabled:hover:border-zinc-800"}`;
  return (
    <section className="space-y-5" data-testid="world-setup">
      <h2 className="text-xl font-bold tracking-tight">{t("setup.title")}</h2>
      {reset && (
        <p className={`${card} flex gap-2 text-sm`} role="status" data-testid="world-reset">
          <Icon name="info" size={18} className="mt-0.5 shrink-0 text-pitch-700" />
          {t(`reset.${reset}`)}
        </p>
      )}
      {!ready ? (
        <p className={`${card} flex gap-2 text-sm`} role="alert" data-testid="world-missing">
          <Icon name="info" size={18} className="mt-0.5 shrink-0 text-red-600" />
          {t("missing", { leagues: (pack.missing.length ? pack.missing : worldDivisions(WORLD_COUNTRIES)).map(name).join(", ") })}
        </p>
      ) : (
        <>
          <div className="space-y-3">
            <h3 className={step}>
              <span className={number}>1</span>
              {t("setup.countries")}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("setup.countriesHint")}</p>
            {/* One card per country, all the same size: the flag and the name, a tick once picked. */}
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {WORLD_COUNTRIES.map((country) => {
                const picked = countries.includes(country);
                const ok = available(country);
                const countryName = t(`countries.${country}`);
                // A country whose live data didn't load can't be picked: why, on the card's tooltip.
                const why = ok ? undefined : t("setup.unavailable", { leagues: [...COUNTRY_LEAGUES[country], ...COUNTRY_CUPS[country]].filter((code) => pack.missing.includes(code)).map(name).join(", ") });
                return (
                  <li key={country}>
                    <button
                      type="button"
                      onClick={() => toggle(country)}
                      aria-pressed={picked}
                      disabled={!ok}
                      {...(why ? { title: why, "aria-description": why } : {})}
                      className={`relative flex h-28 w-full flex-col items-center justify-center gap-2.5 rounded-xl border-2 px-2 text-sm font-semibold shadow-sm transition ${picked ? "border-pitch-600 bg-pitch-50 dark:bg-pitch-900/40" : "border-zinc-200 bg-white hover:-translate-y-0.5 hover:border-pitch-500 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-zinc-200 disabled:hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:disabled:hover:border-zinc-800"}`}
                      data-testid="world-country"
                      data-country={country}
                      data-picked={picked}
                    >
                      <Flag code={COUNTRY_FLAG[country]} width={48} />
                      <span className="block max-w-full truncate">{countryName}</span>
                      {picked && (
                        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-pitch-600 text-white" aria-hidden="true">
                          <Icon name="check" size={12} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {countries.length > 0 && (
            <div className="space-y-3">
              <h3 className={step}>
                <span className={number}>2</span>
                {t("setup.league")}
              </h3>
              <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {leagues.map((code) => (
                  <li key={code}>
                    <button
                      type="button"
                      onClick={() => {
                        setLeague(code);
                        setClub(null);
                      }}
                      aria-pressed={league === code}
                      className={cardButton(league === code)}
                      data-testid="world-league"
                      data-league={code}
                    >
                      <Flag code={divisionConfig(code).flag} width={24} />
                      <span className="min-w-0">
                        <span className="block truncate">{t(`leagues.${code}.name`)}</span>
                        <span className="block text-xs font-normal text-zinc-500">{t("setup.clubs", { count: divisionConfig(code).teams })}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {countries.length > 0 && league && (
            <div className="space-y-3">
              <h3 className={step}>
                <span className={number}>3</span>
                {t("setup.club")}
              </h3>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[...clubs]
                  .sort((a, b) => a.name.localeCompare(b.name, locale))
                  .map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setClub(c.id)}
                        aria-pressed={club === c.id}
                        className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium transition ${club === c.id ? "border-pitch-600 bg-pitch-50 font-semibold dark:bg-pitch-900/40" : "border-zinc-200 bg-white hover:border-pitch-500 dark:border-zinc-800 dark:bg-zinc-900"}`}
                        data-testid="world-club"
                      >
                        <TeamBadge team={c} size={22} textless />
                        <span className="truncate">{c.name}</span>
                        {club === c.id && <Icon name="check" size={16} strokeWidth={3} className="ml-auto shrink-0 text-pitch-700" />}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {countries.length > 0 && league && chosen && (
            <div ref={createRef} className={`${card} space-y-3`}>
              <h3 className={step}>
                <span className={number}>4</span>
                {t("setup.create")}
              </h3>
              <p className="text-sm text-zinc-700 dark:text-zinc-300" data-testid="world-summary">
                {t("setup.summary", { club: chosen.name, league: t(`leagues.${league}.in`), season })} {t("setup.summaryCountries", { countries: countryNames(countries) })}
              </p>
              <button type="button" className={`${primary} w-full sm:w-auto`} onClick={() => onCreate(league, chosen.id, [...countries])} data-testid="world-create">
                <Icon name="globe" size={18} />
                {t("setup.create")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface ScreenProps {
  world: World;
  saved: boolean;
  locale: SiteLocale;
  /** A change in the season in progress (Undo can take it back). */
  onChange: (world: World) => void;
  /** A season finished: the next one starts. */
  onCommit: (world: World) => void;
  /** A change that isn't the season's (the next season started from the review): kept, nothing to undo. */
  onSet: (world: World) => void;
  canUndo: boolean;
  onUndo: () => void;
  onReset: () => void;
}

function WorldScreen({ world, saved, locale, onChange, onCommit, onSet, canUndo, onUndo, onReset }: ScreenProps) {
  const t = useTranslations("World");
  const me = world.clubs[world.userClub]!;
  const myDivision = clubDivision(world, world.userClub);
  const myCountry = myDivision ? divisionCountry(myDivision) : clubCountry(me);
  /** The competition a country opens on: the visitor's club's division when it's there, else the country's top league. */
  const opening = (c: WorldCountry): DivisionCode => (myDivision && divisionCountry(myDivision) === c ? myDivision : COUNTRY_LEAGUES[c][0]!);
  // The country whose competitions the tabs show, and the competition shown.
  const [country, setCountry] = useState<WorldCountry>(myCountry);
  // The games-left panel's open countries: the club's, every one opened in the tables, and any opened by hand.
  const [openLeft, setOpenLeft] = useState<WorldCountry[]>([myCountry]);
  useEffect(() => setOpenLeft((open) => (open.includes(country) ? open : [...open, country])), [country]);
  const toggleLeft = (c: WorldCountry) => setOpenLeft((open) => (open.includes(c) ? open.filter((x) => x !== c) : [...open, c]));
  const [viewed, setViewed] = useState<DivisionCode | WorldCupCode>(opening(myCountry));
  // The matchday each league's fixtures show (else its next round).
  const [matchdays, setMatchdays] = useState<Partial<Record<DivisionCode, number>>>({});
  // The season the tables and fixtures show: this one, or a finished one picked to look back at.
  const [year, setYear] = useState(world.year);
  const [playing, setPlaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const last = world.history.at(-1);
  // Where the visitor's club is when the season changes: its own division, on its next round, this season.
  useEffect(() => {
    setCountry(myCountry);
    setOpenLeft([myCountry]);
    setViewed(opening(myCountry));
    setMatchdays({});
    setYear(world.year);
  }, [world.year, world.userClub]); // eslint-disable-line react-hooks/exhaustive-deps
  const states = useMemo(() => seasonStates(world), [world]);
  const cups = useMemo(() => cupStates(world), [world]);
  // The competition shown: a league's season, or a cup's.
  const state = states.find((s) => s.code === viewed);
  const cupShown = cups.find((c) => c.code === viewed);
  const mine = states.find((s) => s.code === myDivision);
  const myRow = mine?.rows.find((r) => r.teamId === world.userClub);
  const firstSeason = world.divisions.some((d) => d.games);
  const season = worldSeasonLabel(world, world.year);
  // Games left to play in each league (play-offs included) and each cup, by country; the next season once there are none.
  const left = world.countries.map((c) => {
    const items = [
      ...states.filter((s) => divisionCountry(s.code) === c).map((s) => ({ code: s.code as DivisionCode | WorldCupCode, games: gamesLeft(s), total: gamesInSeason(s) })),
      ...cups.filter((x) => cupCountry(x.code) === c).map((x) => ({ code: x.code as DivisionCode | WorldCupCode, games: cupGamesLeft(x), total: cupGamesInSeason(x) })),
    ];
    return { country: c, items, games: items.reduce((n, i) => n + i.games, 0), total: items.reduce((n, i) => n + i.total, 0) };
  });
  const leftAll = left.reduce((n, c) => n + c.games, 0);
  const totalAll = left.reduce((n, c) => n + c.total, 0);
  /** Share of a season's games played (a shoot-out still to come doesn't count against it). */
  const playedShare = (games: number, total: number) => (total > 0 ? Math.min(1, Math.max(0, 1 - games / total)) : 1);
  const done = states.every((s) => s.done) && cups.every((c) => c.done);
  const lowerOf = (c: WorldCountry) => ({ lower: t(`leagues.${LOWER_LEAGUE[c]}.the`), back: t(`leagues.${COUNTRY_LEAGUES[c].at(-1)!}.name`) });
  const shownSeason = worldSeasonLabel(world, year, country);
  /** A competition's name: a league's or a cup's. */
  const name = (code: DivisionCode | WorldCupCode) => t(isWorldCup(code) ? `cups.${code}.name` : `leagues.${code}.name`);

  /** Every game is played: the season ends (promotion and relegation) and its review shows; the next season starts from there. */
  const endSeason = () => {
    setPlaying(true);
    // Let the button show it's working first (the season's ratings are worked out, a few milliseconds).
    setTimeout(() => {
      onCommit(playSeason(world));
      setPlaying(false);
    }, 30);
  };
  /** A country picked: its competitions, opening on the visitor's club's division when it's there. */
  const pickCountry = (c: WorldCountry) => {
    setCountry(c);
    setViewed(opening(c));
  };
  /** A league's or a cup's games left, tapped: its table and fixtures (its rounds), this season. */
  const showLeague = (code: DivisionCode | WorldCupCode) => {
    setCountry(isWorldCup(code) ? cupCountry(code) : divisionCountry(code));
    setViewed(code);
    setYear(world.year);
    document.querySelector('[data-testid="world-tables"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // The fixtures stay on the matchday shown while its scores change (as on the league pages), even once it's complete.
  const shown = state ? (matchdays[state.code] ?? openingMatchday(state)) : 1;
  const changeShown = (changed: World) => {
    if (state) setMatchdays((m) => (m[state.code] === undefined ? { ...m, [state.code]: shown } : m));
    onChange(changed);
  };

  return (
    <div className="space-y-6" data-testid="world" data-year={world.year}>
      {/* The visitor's club and the season in progress. */}
      <section className={`${card} flex scroll-mt-4 flex-col gap-4 lg:flex-row lg:items-center`} data-testid="world-club-card">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <TeamBadge team={me} size={44} textless />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-pitch-700 dark:text-pitch-100">{t("yourClub")}</p>
            <p className="truncate text-xl font-extrabold" data-testid="world-my-club">
              {me.name}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="world-season">
              {t("season", { season: worldSeasonLabel(world, world.year, myCountry) })}
              {myDivision ? ` · ${t(`leagues.${myDivision}.name`)}` : world.nationalLeague.includes(me.id) ? ` · ${t(`leagues.${LOWER_LEAGUE[clubCountry(me)]}.name`)}` : ""}
              {myRow && myRow.played > 0 ? ` · ${t("standing", { position: ordinal(myRow.position, locale), points: myRow.points })}` : ""}
            </p>
          </div>
        </div>
        {/* Games left in each league; the season's end once every league is played (not while its review shows). */}
        {!world.review && (
          <div className={`space-y-3 lg:shrink-0 ${left.length > 1 ? "lg:w-[36rem] xl:w-[42rem]" : "lg:w-[26rem]"}`} data-testid="world-left-card">
            {/* The season's games left, all countries: one count and a bar of the share played. */}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{t("left.title")}</p>
                <p className="text-sm font-semibold tabular-nums" data-testid="world-left-total" data-left={leftAll}>
                  {t("left.count", { count: leftAll })}
                </p>
              </div>
              <ProgressBar share={playedShare(leftAll, totalAll)} />
            </div>
            {/* One row per country, its competitions under it: the club's country open, the others a tap away.
                On bigger screens, two columns: the first half of the countries, then the rest. */}
            <div className={`grid items-start gap-3 ${left.length > 1 ? "lg:grid-cols-2" : ""}`}>
              {(left.length > 1 ? [left.slice(0, Math.ceil(left.length / 2)), left.slice(Math.ceil(left.length / 2))] : [left]).map((column, k) => (
                <ul key={k} className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" data-testid="world-left-column">
                  {column.map(({ country: c, items, games, total }) => {
                    const open = left.length === 1 || openLeft.includes(c);
                    const listId = `world-left-${c}`;
                    return (
                      <li key={c} data-testid="world-left-country" data-country={c} data-open={open}>
                        {left.length > 1 && (
                          <button
                            type="button"
                            onClick={() => toggleLeft(c)}
                            aria-expanded={open}
                            aria-controls={listId}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                            data-testid="world-left-toggle"
                          >
                            <Flag code={COUNTRY_FLAG[c]} width={20} />
                            <span className="min-w-0 flex-1 truncate font-semibold">{t(`countries.${c}`)}</span>
                            <span className="hidden w-14 shrink-0 sm:block lg:hidden xl:block">
                              <ProgressBar share={playedShare(games, total)} />
                            </span>
                            <span className={`shrink-0 whitespace-nowrap text-right text-xs tabular-nums sm:min-w-[4.75rem] ${games === 0 ? "font-semibold text-pitch-700 dark:text-pitch-100" : "text-zinc-600 dark:text-zinc-300"}`}>
                              {t("left.countShort", { count: games })}
                            </span>
                            <Icon name="chevron-down" size={16} className={`shrink-0 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
                          </button>
                        )}
                        <ul id={listId} hidden={!open} className={`grid grid-cols-1 gap-x-3 px-1.5 pb-1.5 pt-0.5 sm:grid-cols-2 ${left.length > 1 ? "lg:grid-cols-1" : ""}`}>
                          {items.map(({ code, games: n }) => (
                            <li key={code}>
                              <button
                                type="button"
                                onClick={() => showLeague(code)}
                                className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                data-testid="world-left"
                                data-league={code}
                                data-left={n}
                              >
                                <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">{name(code)}</span>
                                <span className={`flex shrink-0 items-center gap-1 tabular-nums ${n === 0 ? "font-semibold text-pitch-700 dark:text-pitch-100" : "text-zinc-500"}`}>
                                  {n === 0 && <Icon name="check" size={12} strokeWidth={3} />}
                                  {t("left.countShort", { count: n })}
                                </span>
                              </button>
                            </li>
                        ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>
            {done ? (
              <div className="space-y-1">
                <button type="button" className={`${primary} w-full`} onClick={endSeason} disabled={playing} data-testid="world-end-season">
                  <Icon name={playing ? "loader-circle" : "trophy"} size={18} className={playing ? "animate-spin" : ""} />
                  {t("endSeason")}
                </button>
                <p className="text-xs text-zinc-500">{t("endSeasonNote", { season })}</p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">{t("left.note")}</p>
            )}
          </div>
        )}
      </section>

      {!saved && (
        <p className={`${card} flex gap-2 text-sm`} role="status" data-testid="world-unsaved">
          <Icon name="info" size={18} className="mt-0.5 shrink-0 text-red-600" />
          {t("notSaved")}
        </p>
      )}
      {!myDivision && me.left !== undefined && (
        <p className={`${card} flex gap-2 text-sm`} role="status" data-testid="world-out">
          <Icon name="info" size={18} className="mt-0.5 shrink-0 text-pitch-700" />
          {/* A season in the league below, then back up; or (a world from before the National League) gone for good. */}
          {world.nationalLeague.includes(me.id)
            ? t("outNotice", { club: me.name, season: worldSeasonLabel(world, me.left, clubCountry(me)), ...lowerOf(clubCountry(me)) })
            : t("goneNotice", { club: me.name, season: worldSeasonLabel(world, me.left, clubCountry(me)) })}
        </p>
      )}

      {world.review && last && (
        <Review
          record={last}
          world={world}
          locale={locale}
          onStart={() => {
            onSet(startNextSeason(world));
            // The new season from its top: the club, its games left, then the tables and fixtures.
            requestAnimationFrame(() => document.querySelector('[data-testid="world-club-card"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }}
        />
      )}

      {/* The season, league by league, as on the league pages (or a finished one, picked to look back at); the next one only once it's started from the review. */}
      {!world.review && (
        <section className="scroll-mt-4 space-y-3" data-testid="world-tables">
          {/* The country, then the season: more countries will be picked here once there are more pyramids. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <CountryPicker world={world} value={country} onChange={pickCountry} testId="world-season-country" />
            <h2 className="text-xl font-bold tracking-tight" data-testid="world-season-heading">
              {t("seasonHeading", { season: shownSeason })}
            </h2>
          </div>
          <DivisionTabs country={country} value={viewed} onChange={setViewed} label={t("competitions")} testId="world-tabs" />
          <p className="text-xs text-zinc-500">
            {cupShown
              ? year !== world.year
                ? t("pastCup", { season: shownSeason, cup: name(cupShown.code) })
                : cupShown.season.real
                  ? t("cupFirst", { cup: t(`cups.${cupShown.code}.the`) })
                  : t("cupNew", {
                      cup: t(`cups.${cupShown.code}.the`),
                      outsiders: (() => {
                        const count = outsidersNeeded(cupShown.cup, world.divisions.filter((d) => divisionCountry(d.code) === cupCountry(cupShown.code)).reduce((n, d) => n + d.clubs.length, 0));
                        return count ? t("cupOutsiders", { count }) : "";
                      })(),
                    })
              : year !== world.year
                ? t("pastNote", { season: shownSeason })
                : firstSeason
                  ? t("firstSeason")
                  : t("newSeason")}
          </p>
          {cupShown ? (
            <WorldCup key={`${cupShown.code}-${world.year}`} world={world} state={cupShown} year={year} onYear={setYear} onChange={onChange} canUndo={canUndo} onUndo={onUndo} />
          ) : state ? (
            <WorldSeason
              world={world}
              state={state}
              year={year}
              onYear={setYear}
              matchday={shown}
              onMatchday={(md) => setMatchdays((m) => ({ ...m, [state.code]: md }))}
              onChange={changeShown}
              canUndo={canUndo}
              onUndo={onUndo}
              locale={locale}
            />
          ) : null}
        </section>
      )}

      <Path world={world} locale={locale} />

      <section className="space-y-2 border-t border-zinc-200 pt-6 dark:border-zinc-800" data-testid="world-new">
        <p className="text-xs text-zinc-500">{t("savedNote")}</p>
        {confirming ? (
          <div className={`${card} space-y-3`} role="alertdialog" aria-label={t("newWorld.button")}>
            <p className="text-sm font-semibold">{t("newWorld.confirm")}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" className={`${primary} bg-red-600 hover:bg-red-700`} onClick={onReset} data-testid="world-new-confirm">
                <Icon name="rotate-ccw" size={18} />
                {t("newWorld.yes")}
              </button>
              <button type="button" className={secondary} onClick={() => setConfirming(false)} data-testid="world-new-cancel">
                {t("newWorld.no")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={secondary} onClick={() => setConfirming(true)} data-testid="world-new-button">
            <Icon name="rotate-ccw" size={18} />
            {t("newWorld.button")}
          </button>
        )}
      </section>
    </div>
  );
}

/** The season just ended: how the visitor's club did, then one country at a time (the club's to begin with) its champions, cup finals and who went up and down; the next season starts from here. */
function Review({ record, world, locale, onStart }: { record: SeasonRecord; world: World; locale: SiteLocale; onStart: () => void }) {
  const t = useTranslations("World");
  const name = (id: TeamId) => world.clubs[id]!.name;
  const leagueOf = (code: DivisionCode) => ({ league: t(`leagues.${code}.the`), in: t(`leagues.${code}.in`) });
  // The visitor's club's season.
  const i = record.divisions.findIndex((d) => d.rows.some((r) => r[0] === world.userClub));
  const mine = i >= 0 ? record.divisions[i]! : undefined;
  const at = mine ? mine.rows.findIndex((r) => r[0] === world.userClub) : -1;
  const note = mine ? mine.rows[at]![8] : "";
  const next = mine ? neighbours(mine.code) : {};
  const country = mine ? divisionCountry(mine.code) : clubCountry(world.clubs[world.userClub]!);
  const values = mine
    ? {
        club: name(world.userClub),
        position: ordinal(at + 1, locale),
        ...leagueOf(mine.code),
        to: next.above && (note === "C" || note === "P" || note === "W") ? t(`leagues.${next.above}.the`) : note === "R" && next.below ? t(`leagues.${next.below}.the`) : "",
        lower: t(`leagues.${LOWER_LEAGUE[country]}.the`),
        back: t(`leagues.${mine.code}.name`),
      }
    : undefined;
  const key = !mine ? undefined : note === "C" ? (next.above ? "CUp" : "C") : note === "P" || note === "W" || note === "O" ? note : note === "R" ? (next.below ? "R" : "out") : "stay";
  const headline = key && values ? t(`review.${key}`, key === "W" ? { ...values, league: t(`leagues.${mine!.code}.name`) } : values) : "";
  const good = note === "C" || note === "P" || note === "W";
  // The country whose champions and moves show: the visitor's club's, each season.
  const [shown, setShown] = useState<WorldCountry>(country);
  useEffect(() => setShown(country), [record.year, country]);
  const divisions = record.divisions.filter((d) => divisionCountry(d.code) === shown);
  const cups = (record.cups ?? []).filter((c) => cupCountry(c.code) === shown);
  const moves = seasonMoves(world, record).filter((m) => divisionCountry(m.upper) === shown);
  const list = (ids: TeamId[]) => (
    <ul className="space-y-1">
      {ids.map((id) => (
        <li key={id} className={`flex min-w-0 items-center gap-2 text-sm ${id === world.userClub ? "font-bold" : ""}`} title={name(id)}>
          <TeamBadge team={world.clubs[id]!} size={18} textless />
          <span className="truncate">{world.clubs[id]!.shortName}</span>
          {world.clubs[id]!.origin === "new" && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t("newClub")}</span>}
        </li>
      ))}
    </ul>
  );
  return (
    <section className={`${card} space-y-4 border-pitch-600/40`} data-testid="world-review" data-note={note}>
      <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
        <Icon name="trophy" size={22} className="text-amber-500" />
        {t("review.title", { season: worldSeasonLabel(world, record.year) })}
      </h2>
      {headline && (
        <p className={`rounded-lg p-3 text-sm font-semibold ${good ? "bg-pitch-50 text-pitch-800 dark:bg-pitch-900/40 dark:text-pitch-100" : note === "R" ? "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200" : "bg-zinc-50 dark:bg-zinc-800"}`} data-testid="world-review-headline">
          {headline}
        </p>
      )}
      {(record.cups ?? [])
        .filter((c) => c.final[0] === world.userClub)
        .map((c) => (
          <p key={c.code} className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:bg-amber-900/30 dark:text-amber-100" data-testid="world-review-cup-won" data-cup={c.code}>
            {t(c.final[4] ? "review.cupWonPens" : "review.cupWon", { club: name(world.userClub), cup: t(`cups.${c.code}.the`), loser: name(c.final[1]), score: `${c.final[2]}–${c.final[3]}` })}
          </p>
        ))}
      {/* The country whose season shows below: the visitor's club's to begin with. */}
      <div className="flex">
        <CountryPicker world={world} value={shown} onChange={setShown} testId="world-review-country" />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">{t("review.champions")}</h3>
        <ul className="grid gap-1 sm:grid-cols-2">
          {divisions.map((d) => (
            <li key={d.code} className="flex items-center gap-2 text-sm">
              <Icon name="trophy" size={14} className="shrink-0 text-amber-500" />
              <span className="text-zinc-500">{t(`leagues.${d.code}.name`)}:</span>
              <span className={`truncate font-semibold ${d.rows[0]![0] === world.userClub ? "text-pitch-700 dark:text-pitch-100" : ""}`}>{name(d.rows[0]![0])}</span>
            </li>
          ))}
          {/* The cups: their winners and finals. */}
          {cups.map((c) => (
            <li key={c.code} className="flex min-w-0 items-center gap-2 text-sm" data-testid="world-review-cup" data-cup={c.code} data-winner={c.final[0]}>
              <Icon name="trophy" size={14} className="shrink-0 text-amber-500" />
              <span className="shrink-0 text-zinc-500">{t(`cups.${c.code}.name`)}:</span>
              <span className={`truncate font-semibold ${c.final[0] === world.userClub ? "text-pitch-700 dark:text-pitch-100" : ""}`}>{name(c.final[0])}</span>
              <span className="truncate text-zinc-500">{t(c.final[4] ? "review.cupFinalPens" : "review.cupFinal", { loser: name(c.final[1]), score: `${c.final[2]}–${c.final[3]}` })}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {moves.map((m) => (
          <div key={m.upper} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" data-testid="world-moves" data-upper={m.upper}>
            <p className="mb-2 text-sm font-bold">{m.lower ? `${t(`leagues.${m.upper}.name`)} · ${t(`leagues.${m.lower}.name`)}` : t(`leagues.${m.upper}.name`)}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-pitch-700 dark:text-pitch-100">
                  <Icon name="arrow-up" size={13} strokeWidth={2.5} />
                  {m.lower ? t("review.up") : t("review.in_", { league: t(`leagues.${LOWER_LEAGUE[divisionCountry(m.upper)]}.the`) })}
                </p>
                {list(m.up)}
              </div>
              <div className="min-w-0">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-red-600">
                  <Icon name="arrow-down" size={13} strokeWidth={2.5} />
                  {m.lower ? t("review.down") : t("review.out_", { league: t(`leagues.${LOWER_LEAGUE[divisionCountry(m.upper)]}.the`) })}
                </p>
                {list(m.down)}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <button type="button" className={`${primary} w-full sm:w-auto`} onClick={onStart} data-testid="world-start-season">
          {t("review.next")}
          <Icon name="chevron-right" size={18} />
        </button>
      </div>
    </section>
  );
}

/** The visitor's club, season by season: its division, its place and what came of it. */
/** Each season's outcome: its icon (or a European place's colour) and tone. */
const OUTCOME_STYLE: Record<PathOutcome, { icon?: "trophy" | "arrow-up" | "arrow-down" | "target"; zone?: "championsLeague" | "europaLeague" | "conferenceLeague"; tone: string }> = {
  champions: { icon: "trophy", tone: "text-pitch-700 dark:text-pitch-100" },
  promoted: { icon: "arrow-up", tone: "text-pitch-700 dark:text-pitch-100" },
  playoffWinners: { icon: "arrow-up", tone: "text-pitch-700 dark:text-pitch-100" },
  nationalLeague: { icon: "arrow-up", tone: "text-pitch-700 dark:text-pitch-100" },
  playoffs: { icon: "target", tone: "text-sky-700 dark:text-sky-300" },
  relegated: { icon: "arrow-down", tone: "text-red-600" },
  out: { icon: "arrow-down", tone: "text-red-600" },
  championsLeague: { zone: "championsLeague", tone: "text-zinc-800 dark:text-zinc-100" },
  europaLeague: { zone: "europaLeague", tone: "text-zinc-800 dark:text-zinc-100" },
  conferenceLeague: { zone: "conferenceLeague", tone: "text-zinc-800 dark:text-zinc-100" },
  neutral: { tone: "text-zinc-500" },
};

/** The country picker: the world's countries (the one picked's flag, then the names). */
function CountryPicker({ world, value, onChange, testId }: { world: World; value: WorldCountry; onChange: (country: WorldCountry) => void; testId: string }) {
  const t = useTranslations("World");
  const countries = WORLD_COUNTRIES.filter((c) => (world.countries ?? ["ENG"]).includes(c));
  return (
    <Picker
      icon={<Flag code={COUNTRY_FLAG[value]} width={18} className="shrink-0" />}
      label={t("country")}
      value={value}
      options={countries.map((c) => ({ value: c, label: t(`countries.${c}`) }))}
      onChange={(c) => onChange(c as WorldCountry)}
      testId={testId}
    />
  );
}

/**
 * Any club, season by season, the latest first: its division, its place and
 * what came of it. Picked by country (England, for now), league and club; the
 * visitor's club to begin with.
 */
function Path({ world, locale }: { world: World; locale: SiteLocale }) {
  const t = useTranslations("World");
  const [picked, setPicked] = useState(world.userClub);
  // A new world: its club again.
  useEffect(() => setPicked(world.userClub), [world.id, world.userClub]);
  const club = world.clubs[picked] ?? world.clubs[world.userClub]!;
  const steps = useMemo(() => [...clubPath(world, club.id)].reverse(), [world, club.id]);
  const clubsOf = (code: DivisionCode) =>
    [...(world.divisions.find((d) => d.code === code)?.clubs ?? [])].sort((a, b) => world.clubs[a]!.name.localeCompare(world.clubs[b]!.name, locale));
  // A club's league this season; for a season in the league below, the last one it played in (it's listed there), else its country's bottom league.
  const leagueOf = (id: TeamId): DivisionCode =>
    clubDivision(world, id) ??
    ([...clubPath(world, id)].reverse().find((s) => isDivision(s.code))?.code as DivisionCode | undefined) ??
    COUNTRY_LEAGUES[clubCountry(world.clubs[id]!)].at(-1)!;
  const league = leagueOf(club.id);
  const country = divisionCountry(league);
  const clubs = clubsOf(league);
  if (!clubs.includes(club.id)) clubs.push(club.id);
  /** Another league: the visitor's club if it's that club's league, else the league's first club. */
  const pickLeague = (code: DivisionCode) => setPicked(leagueOf(world.userClub) === code ? world.userClub : (clubsOf(code)[0] ?? club.id));
  /** Another country: its league with the visitor's club, else its top league. */
  const pickCountry = (c: WorldCountry) => pickLeague(divisionCountry(leagueOf(world.userClub)) === c ? leagueOf(world.userClub) : COUNTRY_LEAGUES[c][0]!);
  return (
    <section className="space-y-3" data-testid="world-path">
      <h2 className="text-xl font-bold tracking-tight">{t("path.title", { club: club.shortName })}</h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" data-testid="world-path-pickers">
        <CountryPicker world={world} value={country} onChange={pickCountry} testId="world-path-country" />
        <Picker
          icon={<Icon name="trophy" size={16} className="shrink-0 text-zinc-500" />}
          label={t("path.league")}
          value={league}
          options={COUNTRY_LEAGUES[country].map((code) => ({ value: code, label: t(`leagues.${code}.name`) }))}
          onChange={(code) => pickLeague(code as DivisionCode)}
          testId="world-path-league"
        />
        <Picker
          icon={<TeamBadge team={club} size={18} textless />}
          label={t("path.club")}
          value={String(club.id)}
          options={clubs.map((id) => ({ value: String(id), label: world.clubs[id]!.name }))}
          onChange={(id) => setPicked(Number(id))}
          testId="world-path-club"
        />
      </div>
      {steps.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("path.empty")}</p>
      ) : (
        <ol className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {steps.map((s) => {
            const style = OUTCOME_STYLE[s.outcome];
            const place = s.position === null ? "–" : ordinal(s.position, locale);
            return (
              <li key={s.year} className="flex items-center gap-3 px-3 py-2.5 text-sm" data-testid="world-path-step" data-league={s.code} data-move={s.move} data-outcome={s.outcome}>
                <span className="w-16 shrink-0 font-semibold tabular-nums">{worldSeasonLabel(world, s.year, (Object.keys(LOWER_LEAGUE) as WorldCountry[]).find((c) => LOWER_LEAGUE[c] === s.code) ?? divisionCountry(s.code as DivisionCode))}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{t(`leagues.${s.code}.name`)}</span>
                    {s.cups.map((code) => (
                      <span
                        key={code}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                        title={t("path.cupWon", { cup: t(`cups.${code}.name`) })}
                        data-testid="world-path-cup"
                        data-cup={code}
                      >
                        <Icon name="trophy" size={10} strokeWidth={2.5} />
                        {t(`cups.${code}.name`)}
                      </span>
                    ))}
                  </span>
                  {/* Phones: the place under the league. */}
                  <span className="block text-xs tabular-nums text-zinc-500 sm:hidden">{place}</span>
                </span>
                <span className="hidden w-10 shrink-0 text-right tabular-nums text-zinc-600 sm:block dark:text-zinc-300">{place}</span>
                <span className={`flex w-36 shrink-0 items-center justify-end gap-1.5 text-right text-xs font-semibold sm:w-44 ${style.tone}`}>
                  {style.icon && <Icon name={style.icon} size={14} strokeWidth={style.icon === "trophy" || style.icon === "target" ? 2 : 2.5} className="shrink-0" />}
                  {style.zone && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: zoneHex(style.zone) }} aria-hidden />}
                  <span className="min-w-0 truncate">{t(`path.${s.outcome}`)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** A thin bar of the share of a season's games played. */
function ProgressBar({ share }: { share: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="presentation">
      <span className="block h-full rounded-full bg-pitch-600 transition-[width]" style={{ width: `${Math.round(share * 100)}%` }} />
    </span>
  );
}
