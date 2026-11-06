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
  currentTable,
  divisionConfig,
  ENGLAND,
  packReady,
  playSeason,
  savedTable,
  seasonLabel,
  seasonMoves,
  startNextSeason,
  type DivisionCode,
  type SeasonRecord,
  type StartPack,
  type World,
  type WorldClub,
} from "../lib/myWorld.ts";
import { browserStore, clearWorld, loadWorld, saveWorld } from "../lib/myWorldStorage.ts";
import { Flag } from "./Flag.tsx";
import { Icon } from "./Icon.tsx";
import { TeamBadge } from "./TeamBadge.tsx";
import { WorldTable } from "./WorldTable.tsx";

type View = { kind: "loading" } | { kind: "setup"; reset?: "incompatible" | "unreadable" } | { kind: "world"; world: World; saved: boolean };

const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const primary = "flex h-11 items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700 disabled:opacity-60";
const secondary = "flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

/**
 * My World (see src/lib/myWorld.ts): set up a world from the live data, then
 * play it season by season. Everything happens in the browser and is saved
 * there after every step (src/lib/myWorldStorage.ts).
 */
export function MyWorld({ pack, locale }: { pack: StartPack; locale: SiteLocale }) {
  const [view, setView] = useState<View>({ kind: "loading" });

  // The saved world, once in the browser (the server has none).
  useEffect(() => {
    const found = loadWorld(browserStore());
    setView(found.world ? { kind: "world", world: found.world, saved: true } : { kind: "setup", ...(found.reason === "incompatible" || found.reason === "unreadable" ? { reset: found.reason } : {}) });
  }, []);

  const keep = (world: World) => setView({ kind: "world", world, saved: saveWorld(browserStore(), world) });

  if (view.kind === "loading") return <Loading />;
  if (view.kind === "setup") return <Setup pack={pack} locale={locale} reset={view.reset} onCreate={(league, club) => keep(createWorld(pack, { league, club }))} />;
  return (
    <WorldScreen
      world={view.world}
      saved={view.saved}
      locale={locale}
      onChange={keep}
      onReset={() => {
        clearWorld(browserStore());
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

/** A division picker: one button per league, as tabs. */
function DivisionTabs({ value, onChange, label, testId }: { value: DivisionCode; onChange: (code: DivisionCode) => void; label: string; testId: string }) {
  const t = useTranslations("World");
  return (
    <div role="tablist" aria-label={label} className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 sm:grid-cols-4 dark:bg-zinc-800" data-testid={testId}>
      {ENGLAND.map((code) => (
        <button
          key={code}
          type="button"
          role="tab"
          aria-selected={value === code}
          onClick={() => onChange(code)}
          className={`min-h-9 rounded-md px-2 text-sm font-semibold ${value === code ? "bg-white shadow-sm dark:bg-zinc-900" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300"}`}
          data-league={code}
        >
          {t(`leagues.${code}.name`)}
        </button>
      ))}
    </div>
  );
}

function WorldScreen({ world, saved, locale, onChange, onReset }: { world: World; saved: boolean; locale: SiteLocale; onChange: (world: World) => void; onReset: () => void }) {
  const t = useTranslations("World");
  const me = world.clubs[world.userClub]!;
  const myDivision = clubDivision(world, world.userClub);
  const [viewed, setViewed] = useState<DivisionCode>(myDivision ?? "EL2");
  const [playing, setPlaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const last = world.history.at(-1);
  // Where the visitor's club is when the season changes: its own division's table.
  useEffect(() => setViewed(clubDivision(world, world.userClub) ?? "EL2"), [world.year, world.userClub]);
  const table = useMemo(() => currentTable(world, viewed), [world, viewed]);
  const myRow = myDivision ? currentTable(world, myDivision).find((r) => r.clubId === world.userClub) : undefined;
  const firstSeason = world.divisions.some((d) => d.games);
  const season = seasonLabel(world.year);

  const play = () => {
    setPlaying(true);
    // Let the button show it's working before the season is played (a few milliseconds).
    setTimeout(() => {
      onChange(playSeason(world));
      setPlaying(false);
    }, 30);
  };

  return (
    <div className="space-y-6" data-testid="world" data-year={world.year}>
      {/* The visitor's club and the season in progress. */}
      <section className={`${card} flex flex-col gap-4 sm:flex-row sm:items-center`} data-testid="world-club-card">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <TeamBadge team={me} size={44} textless />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-pitch-700 dark:text-pitch-100">{t("yourClub")}</p>
            <p className="truncate text-xl font-extrabold" data-testid="world-my-club">
              {me.name}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400" data-testid="world-season">
              {t("season", { season })}
              {myDivision ? ` · ${t(`leagues.${myDivision}.name`)}` : ""}
              {myRow && myRow.played > 0 ? ` · ${t("standing", { position: ordinal(myRow.position, locale), points: myRow.points })}` : ""}
            </p>
          </div>
        </div>
        {!world.review && (
          <div className="space-y-1 sm:text-right">
            <button type="button" className={`${primary} w-full sm:w-auto`} onClick={play} disabled={playing} data-testid="world-play">
              <Icon name={playing ? "loader-circle" : "dices"} size={18} className={playing ? "animate-spin" : ""} />
              {playing ? t("playing") : t("play", { season })}
            </button>
            <p className="text-xs text-zinc-500">{t("playNote")}</p>
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
          {t("outNotice", { club: me.name, season: seasonLabel(me.left) })}
        </p>
      )}

      {world.review && last && <Review record={last} world={world} locale={locale} onNext={() => onChange(startNextSeason(world))} />}

      {/* The season in progress, league by league. */}
      <section className="space-y-3" data-testid="world-tables">
        <h2 className="text-xl font-bold tracking-tight">
          {t("tables")} <span className="font-semibold text-zinc-500">{season}</span>
        </h2>
        <DivisionTabs value={viewed} onChange={setViewed} label={t("tables")} testId="world-tabs" />
        <p className="text-xs text-zinc-500">{firstSeason ? t("firstSeason") : t("newSeason")}</p>
        <WorldTable rows={table} code={viewed} clubs={world.clubs} highlight={world.userClub} final={false} testId="world-table" />
      </section>

      <History world={world} locale={locale} />
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

/** The season just played: how the visitor's club did, the champions, who went up and down, and on to the next season. */
function Review({ record, world, locale, onNext }: { record: SeasonRecord; world: World; locale: SiteLocale; onNext: () => void }) {
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
      <button type="button" className={`${primary} w-full sm:w-auto`} onClick={onNext} data-testid="world-next">
        {t("review.next", { season: seasonLabel(world.year) })}
        <Icon name="chevron-right" size={18} />
      </button>
    </section>
  );
}

/** Any finished season's final tables, league by league. */
function History({ world, locale }: { world: World; locale: SiteLocale }) {
  const t = useTranslations("World");
  const latest = world.history.at(-1)?.year;
  const [year, setYear] = useState<number | undefined>(latest);
  const [code, setCode] = useState<DivisionCode>("PL");
  // A season just played: shown first.
  useEffect(() => {
    setYear(latest);
    if (latest !== undefined) setCode(world.history.at(-1)!.divisions.find((d) => d.rows.some((r) => r[0] === world.userClub))?.code ?? "PL");
  }, [latest, world.history, world.userClub]);
  const shown = year !== undefined ? savedTable(world, year, code) : undefined;
  const final = shown?.final;
  return (
    <section className="space-y-3" data-testid="world-history">
      <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
        <Icon name="history" size={20} className="text-zinc-500" />
        {t("history.title")}
      </h2>
      {world.history.length === 0 ? (
        <p className="text-sm text-zinc-500" data-testid="world-history-empty">
          {t("history.empty", { season: seasonLabel(world.year) })}
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs font-semibold text-zinc-500 sm:flex-row sm:items-center sm:gap-3">
            {t("history.season")}
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              data-testid="world-history-season"
            >
              {[...world.history].reverse().map((s, i) => (
                <option key={s.year} value={s.year}>
                  {seasonLabel(s.year)} ({t("history.ago", { count: i + 1 })})
                </option>
              ))}
            </select>
          </label>
          <DivisionTabs value={code} onChange={setCode} label={t("history.league")} testId="world-history-tabs" />
          {shown && <WorldTable rows={shown.rows} code={code} clubs={world.clubs} highlight={world.userClub} final testId="world-history-table" />}
          {final && (
            <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400" data-testid="world-history-final">
              <Icon name="trophy" size={16} className="shrink-0 text-amber-500" />
              {t("review.final", {
                winner: world.clubs[final[0]]!.name,
                loser: world.clubs[final[1]]!.name,
                score: final[4] ? t("review.penalties", { score: `${final[2]}–${final[3]}` }) : `${final[2]}–${final[3]}`,
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** The visitor's club, season by season: its division, its place and what came of it. */
function Path({ world, me, locale }: { world: World; me: WorldClub; locale: SiteLocale }) {
  const t = useTranslations("World");
  const steps = clubPath(world, me.id);
  return (
    <section className="space-y-3" data-testid="world-path">
      <h2 className="text-xl font-bold tracking-tight">{t("path.title", { club: me.shortName })}</h2>
      {steps.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("path.empty")}</p>
      ) : (
        <ol className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {steps.map((s) => {
            const label = s.note === "C" ? t("path.champions") : s.move === "up" ? t("path.up") : s.move === "down" ? (s.code === "EL2" ? t("path.out") : t("path.down")) : t("path.stay");
            const tone = s.move === "up" || s.note === "C" ? "text-pitch-700 dark:text-pitch-100" : s.move === "down" ? "text-red-600" : "text-zinc-500";
            return (
              <li key={s.year} className="flex items-center gap-3 px-3 py-2.5 text-sm" data-testid="world-path-step" data-league={s.code} data-move={s.move}>
                <span className="w-16 shrink-0 font-semibold tabular-nums">{seasonLabel(s.year)}</span>
                <span className="min-w-0 flex-1 truncate">{t(`leagues.${s.code}.name`)}</span>
                <span className="w-10 shrink-0 text-right tabular-nums text-zinc-600 dark:text-zinc-300">{ordinal(s.position, locale)}</span>
                <span className={`flex w-28 shrink-0 items-center justify-end gap-1 text-xs font-semibold ${tone}`}>
                  {s.note === "C" ? <Icon name="trophy" size={14} /> : s.move === "up" ? <Icon name="arrow-up" size={14} strokeWidth={2.5} /> : s.move === "down" ? <Icon name="arrow-down" size={14} strokeWidth={2.5} /> : null}
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
