"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteLocale } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import { ordinal } from "../lib/clubText.ts";
import {
  clubDivision,
  clubPath,
  createWorld,
  divisionConfig,
  ENGLAND,
  gamesLeft,
  packReady,
  playSeason,
  seasonLabel,
  seasonMoves,
  seasonStates,
  startNextSeason,
  type DivisionCode,
  type PathOutcome,
  type SeasonRecord,
  type StartPack,
  type World,
  type WorldClub,
} from "../lib/myWorld.ts";
import { browserStore, clearWorld, loadWorld, saveWorld } from "../lib/myWorldStorage.ts";
import { Flag } from "./Flag.tsx";
import { Icon } from "./Icon.tsx";
import { TeamBadge } from "./TeamBadge.tsx";
import { zoneHex } from "./zones.ts";
import { DivisionTabs, openingMatchday, WorldSeason } from "./WorldSeason.tsx";

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

  // The saved world, once in the browser (the server has none).
  useEffect(() => {
    const found = loadWorld(browserStore());
    setView(found.world ? { kind: "world", world: found.world, saved: true } : { kind: "setup", ...(found.reason === "incompatible" || found.reason === "unreadable" ? { reset: found.reason } : {}) });
  }, []);

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
    const onCreate = (league: DivisionCode, club: number) => {
      commit(createWorld(pack, { league, club }));
      // The world opens at the top: the club, its season and the ways to play it.
      requestAnimationFrame(() => document.querySelector('[data-testid="my-world"]')?.scrollIntoView({ block: "start" }));
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

/** Picking the league, then the club, then creating the world. */
function Setup({ pack, locale, reset, onCreate }: { pack: StartPack; locale: SiteLocale; reset?: "incompatible" | "unreadable"; onCreate: (league: DivisionCode, club: number) => void }) {
  const t = useTranslations("World");
  const [league, setLeague] = useState<DivisionCode | null>(null);
  const [club, setClub] = useState<number | null>(null);
  const ready = packReady(pack);
  const season = pack.leagues[0] ? seasonLabel(pack.leagues[0].year) : "";
  const clubs = league ? (pack.leagues.find((l) => l.code === league)?.teams ?? []) : [];
  const chosen = clubs.find((c) => c.id === club);
  const createRef = useRef<HTMLDivElement>(null);
  // Picking a club: on to the last step (below the list on a phone).
  useEffect(() => {
    if (club !== null) createRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [club]);
  const step = "flex items-center gap-2 text-base font-bold";
  const number = "inline-flex h-6 w-6 items-center justify-center rounded-full bg-pitch-600 text-xs font-bold text-white";
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
          {t("missing", { leagues: (pack.missing.length ? pack.missing : ENGLAND).map((c) => t(`leagues.${c}.name`)).join(", ") })}
        </p>
      ) : (
        <>
          <div className="space-y-3">
            <h3 className={step}>
              <span className={number}>1</span>
              {t("setup.league")}
            </h3>
            <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {ENGLAND.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => {
                      setLeague(code);
                      setClub(null);
                    }}
                    aria-pressed={league === code}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition ${league === code ? "border-pitch-600 bg-pitch-50 dark:bg-pitch-900/40" : "border-zinc-200 bg-white hover:border-pitch-500 dark:border-zinc-800 dark:bg-zinc-900"}`}
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
          {league && (
            <div className="space-y-3">
              <h3 className={step}>
                <span className={number}>2</span>
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
          {league && chosen && (
            <div ref={createRef} className={`${card} space-y-3`}>
              <h3 className={step}>
                <span className={number}>3</span>
                {t("setup.create")}
              </h3>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{t("setup.summary", { club: chosen.name, league: t(`leagues.${league}.in`), season })}</p>
              <button type="button" className={`${primary} w-full sm:w-auto`} onClick={() => onCreate(league, chosen.id)} data-testid="world-create">
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
  const [viewed, setViewed] = useState<DivisionCode>(myDivision ?? "EL2");
  // The matchday each league's fixtures show (else its next round).
  const [matchdays, setMatchdays] = useState<Partial<Record<DivisionCode, number>>>({});
  // The season the tables and fixtures show: this one, or a finished one picked to look back at.
  const [year, setYear] = useState(world.year);
  const [playing, setPlaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const last = world.history.at(-1);
  // Where the visitor's club is when the season changes: its own division, on its next round, this season.
  useEffect(() => {
    setViewed(clubDivision(world, world.userClub) ?? "EL2");
    setMatchdays({});
    setYear(world.year);
  }, [world.year, world.userClub]); // eslint-disable-line react-hooks/exhaustive-deps
  const states = useMemo(() => seasonStates(world), [world]);
  const state = states.find((s) => s.code === viewed)!;
  const mine = states.find((s) => s.code === myDivision);
  const myRow = mine?.rows.find((r) => r.teamId === world.userClub);
  const firstSeason = world.divisions.some((d) => d.games);
  const season = seasonLabel(world.year);
  // Games left to play in each league (play-offs included); the next season once there are none.
  const left = states.map((s) => ({ code: s.code, games: gamesLeft(s) }));
  const done = states.every((s) => s.done);
  const shownSeason = seasonLabel(year);

  /** Every game is played: the season ends (promotion and relegation) and its review shows; the next season starts from there. */
  const endSeason = () => {
    setPlaying(true);
    // Let the button show it's working first (the season's ratings are worked out, a few milliseconds).
    setTimeout(() => {
      onCommit(playSeason(world));
      setPlaying(false);
    }, 30);
  };
  /** A league's games left, tapped: its table and fixtures, this season. */
  const showLeague = (code: DivisionCode) => {
    setViewed(code);
    setYear(world.year);
    document.querySelector('[data-testid="world-tables"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // The fixtures stay on the matchday shown while its scores change (as on the league pages), even once it's complete.
  const shown = matchdays[viewed] ?? openingMatchday(state);
  const changeShown = (changed: World) => {
    setMatchdays((m) => (m[viewed] === undefined ? { ...m, [viewed]: shown } : m));
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
              {t("season", { season })}
              {myDivision ? ` · ${t(`leagues.${myDivision}.name`)}` : world.nationalLeague.includes(me.id) ? ` · ${t("leagues.NL.name")}` : ""}
              {myRow && myRow.played > 0 ? ` · ${t("standing", { position: ordinal(myRow.position, locale), points: myRow.points })}` : ""}
            </p>
          </div>
        </div>
        {/* Games left in each league; the season's end once every league is played (not while its review shows). */}
        {!world.review && (
          <div className="space-y-2 lg:w-[30rem] lg:shrink-0" data-testid="world-left-card">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">{t("left.title")}</p>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {left.map(({ code, games }) => (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => showLeague(code)}
                    className={`flex w-full min-w-0 flex-col items-start rounded-lg px-2.5 py-1.5 text-left text-xs hover:ring-1 hover:ring-pitch-500 ${games === 0 ? "bg-pitch-50 text-pitch-800 dark:bg-pitch-900/40 dark:text-pitch-100" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"}`}
                    data-testid="world-left"
                    data-league={code}
                    data-left={games}
                  >
                    <span className="w-full truncate font-semibold">{t(`leagues.${code}.name`)}</span>
                    <span className="flex items-center gap-1 tabular-nums">
                      {games === 0 && <Icon name="check" size={12} strokeWidth={3} />}
                      {t("left.count", { count: games })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
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
          {/* A season in the National League, then back up; or (a world from before it) gone for good. */}
          {world.nationalLeague.includes(me.id)
            ? t("outNotice", { club: me.name, season: seasonLabel(me.left) })
            : t("goneNotice", { club: me.name, season: seasonLabel(me.left) })}
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
          <h2 className="text-xl font-bold tracking-tight">{t("seasonHeading", { season: shownSeason })}</h2>
          <DivisionTabs value={viewed} onChange={setViewed} label={t("tables")} testId="world-tabs" />
          <p className="text-xs text-zinc-500">{year !== world.year ? t("pastNote", { season: shownSeason }) : firstSeason ? t("firstSeason") : t("newSeason")}</p>
          <WorldSeason
            world={world}
            state={state}
            year={year}
            onYear={setYear}
            matchday={shown}
            onMatchday={(md) => setMatchdays((m) => ({ ...m, [viewed]: md }))}
            onChange={changeShown}
            canUndo={canUndo}
            onUndo={onUndo}
          />
        </section>
      )}

      <Path world={world} me={me} locale={locale} />

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

/** The season just ended: how the visitor's club did, the champions, who went up and down; the next season starts from here. */
function Review({ record, world, locale, onStart }: { record: SeasonRecord; world: World; locale: SiteLocale; onStart: () => void }) {
  const t = useTranslations("World");
  const name = (id: TeamId) => world.clubs[id]!.name;
  const leagueOf = (code: DivisionCode) => ({ league: t(`leagues.${code}.the`), in: t(`leagues.${code}.in`) });
  // The visitor's club's season.
  const i = record.divisions.findIndex((d) => d.rows.some((r) => r[0] === world.userClub));
  const mine = i >= 0 ? record.divisions[i]! : undefined;
  const at = mine ? mine.rows.findIndex((r) => r[0] === world.userClub) : -1;
  const note = mine ? mine.rows[at]![8] : "";
  const values = mine
    ? {
        club: name(world.userClub),
        position: ordinal(at + 1, locale),
        ...leagueOf(mine.code),
        to: i > 0 && (note === "C" || note === "P" || note === "W") ? t(`leagues.${ENGLAND[i - 1]!}.the`) : note === "R" && i < ENGLAND.length - 1 ? t(`leagues.${ENGLAND[i + 1]!}.the`) : "",
      }
    : undefined;
  const key = !mine ? undefined : note === "C" ? (i > 0 ? "CUp" : "C") : note === "P" || note === "W" || note === "O" ? note : note === "R" ? (i === ENGLAND.length - 1 ? "out" : "R") : "stay";
  const headline = key && values ? t(`review.${key}`, key === "W" ? { ...values, league: t(`leagues.${mine!.code}.name`) } : values) : "";
  const good = note === "C" || note === "P" || note === "W";
  const moves = seasonMoves(record);
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
        {t("review.title", { season: seasonLabel(record.year) })}
      </h2>
      {headline && (
        <p className={`rounded-lg p-3 text-sm font-semibold ${good ? "bg-pitch-50 text-pitch-800 dark:bg-pitch-900/40 dark:text-pitch-100" : note === "R" ? "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200" : "bg-zinc-50 dark:bg-zinc-800"}`} data-testid="world-review-headline">
          {headline}
        </p>
      )}
      <div>
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-zinc-500">{t("review.champions")}</h3>
        <ul className="grid gap-1 sm:grid-cols-2">
          {record.divisions.map((d) => (
            <li key={d.code} className="flex items-center gap-2 text-sm">
              <Icon name="trophy" size={14} className="shrink-0 text-amber-500" />
              <span className="text-zinc-500">{t(`leagues.${d.code}.name`)}:</span>
              <span className={`truncate font-semibold ${d.rows[0]![0] === world.userClub ? "text-pitch-700 dark:text-pitch-100" : ""}`}>{name(d.rows[0]![0])}</span>
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
                  {m.lower ? t("review.up") : t("review.in_")}
                </p>
                {list(m.up)}
              </div>
              <div className="min-w-0">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-red-600">
                  <Icon name="arrow-down" size={13} strokeWidth={2.5} />
                  {m.lower ? t("review.down") : t("review.out_")}
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

/** The visitor's club, season by season, the latest first: its division, its place and what came of it. */
function Path({ world, me, locale }: { world: World; me: WorldClub; locale: SiteLocale }) {
  const t = useTranslations("World");
  const steps = [...clubPath(world, me.id)].reverse();
  return (
    <section className="space-y-3" data-testid="world-path">
      <h2 className="text-xl font-bold tracking-tight">{t("path.title", { club: me.shortName })}</h2>
      {steps.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("path.empty")}</p>
      ) : (
        <ol className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {steps.map((s) => {
            const style = OUTCOME_STYLE[s.outcome];
            const place = s.position === null ? "–" : ordinal(s.position, locale);
            return (
              <li key={s.year} className="flex items-center gap-3 px-3 py-2.5 text-sm" data-testid="world-path-step" data-league={s.code} data-move={s.move} data-outcome={s.outcome}>
                <span className="w-16 shrink-0 font-semibold tabular-nums">{seasonLabel(s.year)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{t(`leagues.${s.code}.name`)}</span>
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
