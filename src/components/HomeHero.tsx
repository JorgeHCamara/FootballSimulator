import { getTranslations } from "next-intl/server";
import type { LeagueConfig, SiteLocale } from "../config/leagues.ts";
import { Link } from "../i18n/navigation.ts";
import { percent } from "../lib/clubText.ts";
import { competitionCount, featuredLeague, heroLinks, loadTitleCard, type TitleCard } from "../lib/homeHero.ts";
import { MY_WORLD_LISTED } from "../lib/site.ts";
import { Icon } from "./Icon.tsx";
import { TeamBadge } from "./TeamBadge.tsx";

/*
 * The home page's hero: a pill badge, the page's H1, the subtitle, the two
 * buttons, the trust line and the featured league's live title-chances card
 * (src/lib/homeHero.ts), all server-rendered. Phones first: one column, the
 * card right under the buttons; two columns from 1024px. The background (the
 * glow and the faint pitch lines) is CSS, in globals.css (.site-hero, shared with My World's hero).
 */

export interface TitleCardLabels {
  /** "Title chances". */
  titleChances: string;
  /** "Simulating…", the live states' status. */
  simulating: string;
  /** "Pre-season favourites". */
  preseasonFavourites: string;
  /** "{season} final table", with the season filled in. */
  finalTable: (season: string) => string;
  /** "{count} pts". */
  points: (count: number) => string;
  /** "Open the simulator". */
  cta: string;
}

/** The card's status: live rows are "Simulating…" with the pulsing dot; a final table says which season's. */
function cardStatus(card: TitleCard, labels: TitleCardLabels): { text: string; live: boolean } {
  switch (card.kind) {
    case "live":
      return { text: labels.simulating, live: true };
    case "preseason":
      return { text: labels.preseasonFavourites, live: true };
    default:
      return { text: labels.finalTable(card.season), live: false };
  }
}

/**
 * The inside of the title-chances card (the link around it is the hero's):
 * the league's top five with their points, a bar and their title chance.
 * `league`: the card's, or the featured league when there is no card at all.
 */
export function TitleCardBody({ card, league, labels, locale }: { card: TitleCard | undefined; league: LeagueConfig; labels: TitleCardLabels; locale: SiteLocale }) {
  const status = card ? cardStatus(card, labels) : undefined;
  return (
    <div className="flex min-h-[15rem] flex-col" data-testid="hero-card-body" data-kind={card?.kind ?? "none"}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold text-white">
          <Icon name="trophy" size={16} className="shrink-0 text-emerald-300" />
          <span>
            {league.name} · {labels.titleChances}
          </span>
        </h2>
        {status && (
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-300" data-testid="hero-card-status">
            {status.live && <span className="home-pulse h-2 w-2 rounded-full bg-emerald-400" aria-hidden />}
            {status.text}
          </span>
        )}
      </div>
      {card && card.rows.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {card.rows.map((row) => {
            const chance = row.chance;
            // The bar is the chance itself; a sliver keeps a tiny chance visible.
            const width = chance === undefined ? 0 : Math.max(2, Math.round(chance * 100));
            return (
              <li key={row.team.id} className="flex items-center gap-2.5" data-testid="hero-card-row">
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-zinc-500">{row.position}</span>
                <TeamBadge team={row.team} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-white" data-testid="hero-card-club">
                      {row.team.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-zinc-400" data-testid="hero-card-points">
                      {labels.points(row.points)}
                    </span>
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    <span className="home-bar block h-full rounded-full bg-pitch-500" style={{ width: `${width}%` }} />
                  </span>
                </span>
                <span className="w-11 shrink-0 text-right text-sm font-bold tabular-nums text-emerald-300" data-testid="hero-card-chance">
                  {chance === undefined ? "–" : percent(chance, locale)}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-zinc-400">{league.simulatorName[locale]}</p>
      )}
      <span className="mt-auto flex items-center gap-1 pt-3 text-xs font-medium text-zinc-400">
        {labels.cta}
        <Icon name="chevron-right" size={14} />
      </span>
    </div>
  );
}

export async function HomeHero({ locale, subtitle }: { locale: SiteLocale; subtitle: string }) {
  const t = await getTranslations("Home");
  const card = await loadTitleCard(locale);
  const league = card?.league ?? featuredLeague(locale);
  const links = heroLinks(league, MY_WORLD_LISTED);
  const labels: TitleCardLabels = {
    titleChances: t("titleChances"),
    simulating: t("simulating"),
    preseasonFavourites: t("preseasonFavourites"),
    finalTable: (season) => t("finalTable", { season }),
    points: (count) => t("points", { count }),
    cta: t("cardCta"),
  };
  const linkLabel = (kind: "primary" | "secondary") => (kind === "primary" ? t("simulateFeatured") : t("startMyWorld"));

  return (
    <section className="site-hero relative -mx-4 -mt-6 overflow-hidden text-white sm:mx-0 sm:mt-0 sm:rounded-3xl sm:ring-1 sm:ring-white/10" data-testid="home-hero">
      <div className="relative mx-auto max-w-[40rem] px-5 pt-10 pb-8 sm:px-8 sm:py-14 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-12 lg:px-12 lg:py-20">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300" data-testid="hero-badge">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            {t("badge")}
          </p>
          <h1 className="site-hero-title mt-4 font-extrabold tracking-tight text-pretty text-white" data-testid="hero-title">
            {t("headline")}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-300 text-pretty sm:text-base lg:text-lg" data-testid="hero-subtitle">
            {subtitle}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-testid="hero-actions">
            {links.map((link) => (
              <Link
                key={link.testId}
                href={link.href}
                className={
                  link.kind === "primary"
                    ? "flex h-12 items-center justify-center gap-1.5 rounded-xl bg-pitch-500 px-5 text-base font-semibold text-white shadow-lg shadow-pitch-500/20 transition hover:bg-pitch-600 sm:w-auto"
                    : "flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 text-base font-semibold text-white transition hover:border-white/40 hover:bg-white/10 sm:w-auto"
                }
                data-testid={link.testId}
              >
                {link.kind === "secondary" && <Icon name={link.icon} size={18} className="shrink-0" />}
                {linkLabel(link.kind)}
                {link.kind === "primary" && <Icon name={link.icon} size={18} className="shrink-0" />}
              </Link>
            ))}
          </div>
          {/* Two groups, each on its own line on phones; a dot stays with the item before it, so none ever starts a line (a <p>: the first list in main is the league grid). */}
          <p className="mt-5 grid gap-y-1 text-xs text-zinc-400 sm:flex sm:flex-wrap sm:gap-x-1.5" data-testid="hero-trust">
            <span className="flex flex-wrap gap-x-1.5 gap-y-1 min-[360px]:flex-nowrap">
              <span className="whitespace-nowrap">
                {t("trustCompetitions", { count: competitionCount() })}
                <span aria-hidden> ·</span>
              </span>
              <span className="whitespace-nowrap">
                {t("trustFree")}
                <span aria-hidden> ·</span>
              </span>
              <span className="whitespace-nowrap">
                {t("trustNoSignup")}
                <span className="hidden sm:inline" aria-hidden>
                  {" "}
                  ·
                </span>
              </span>
            </span>
            <span className="whitespace-nowrap">{t("trustUpdated")}</span>
          </p>
        </div>
        <Link
          href={`/${league.slug}`}
          className="home-glass mt-8 block rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/40 backdrop-blur-md transition hover:border-emerald-400/40 hover:bg-white/10 sm:p-5 lg:mt-0"
          data-testid="hero-card"
          title={league.simulatorName[locale]}
        >
          <TitleCardBody card={card} league={league} labels={labels} locale={locale} />
        </Link>
      </div>
    </section>
  );
}
