import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, permanentRedirect } from "next/navigation";
import { Flag } from "../../../../../components/Flag.tsx";
import { Icon, type IconName } from "../../../../../components/Icon.tsx";
import { JsonLd } from "../../../../../components/JsonLd.tsx";
import { LocalKickoff } from "../../../../../components/LocalKickoff.tsx";
import { MatchImpact } from "../../../../../components/MatchImpact.tsx";
import { MatchDice } from "../../../../../components/MatchDice.tsx";
import { TeamBadge } from "../../../../../components/TeamBadge.tsx";
import type { SiteLocale } from "../../../../../config/leagues.ts";
import type { FormResult, Team } from "../../../../../engine/types.ts";
import { Link } from "../../../../../i18n/navigation.ts";
import type { ClubOutlook } from "../../../../../lib/clubOutlook.ts";
import { ordinal, percent } from "../../../../../lib/clubText.ts";
import { hasImpact } from "../../../../../lib/matchImpact.ts";
import { loadMatch, type LoadedMatch } from "../../../../../lib/matchPreview.ts";
import { inIndexWindow } from "../../../../../lib/matches.ts";
import { HREFLANG, OG_LOCALE, SITE_NAME, SITE_URL, alternates } from "../../../../../lib/site.ts";

/**
 * Regenerated in the background every few hours at most; in practice hourly
 * (the league data's refresh), and every 10 minutes on match day, when the
 * game's own state is fetched (see MATCH_DAY_REVALIDATE).
 */
export const revalidate = 10800;
/** Three season simulations for "What this result means" on a first visit. */
export const maxDuration = 60;

type Params = Promise<{ locale: string; league: string; matchSlug: string }>;

/** Every match page is rendered on its first visit, then kept and refreshed (ISR): none at build time. */
export function generateStaticParams() {
  return [];
}

const langOf = (locale: string) => (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
/** Dates in British English ("15 Nov 2026", "15:00"), like the rest of the site's English. */
const dateLocale = (lang: SiteLocale) => (lang === "en" ? "en-GB" : lang);

/** The values every heading, title and description shares. */
function textValues(loaded: LoadedMatch, lang: SiteLocale) {
  const { match, result, odds, xg, league, timeZone } = loaded;
  const pct = (share: number) => percent(share, lang);
  return {
    home: match.home.name,
    away: match.away.name,
    league: league.name,
    date: new Intl.DateTimeFormat(dateLocale(lang), { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(match.fixture.utcDate)),
    homeWin: pct(odds.home),
    draw: pct(odds.draw),
    awayWin: pct(odds.away),
    homeXg: xg.home.toFixed(1),
    awayXg: xg.away.toFixed(1),
    homeGoals: result?.home ?? 0,
    awayGoals: result?.away ?? 0,
  };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league: slug, matchSlug } = await params;
  const loaded = await loadMatch(slug, matchSlug);
  if (!loaded || "moved" in loaded) return {};
  const lang = langOf(locale);
  const t = await getTranslations({ locale, namespace: "Match" });
  const values = textValues(loaded, lang);
  const played = loaded.state === "played";
  const title = t(played ? "titlePlayed" : "title", values);
  const description = t(played ? "descriptionPlayed" : "description", values);
  const path = loaded.match.path;
  return {
    title,
    description,
    alternates: alternates(locale, path),
    // Games far from today (over 30 days ago, over 14 ahead): the page loads, search engines are pointed at the current ones.
    ...(inIndexWindow(loaded.match.fixture.utcDate) ? {} : { robots: { index: false, follow: true } }),
    // The card comes from the opengraph-image and twitter-image files next to this page.
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: `/${locale}${path}`, locale: OG_LOCALE[locale] },
    twitter: { card: "summary_large_image", title, description },
  };
}

const FORM: Record<FormResult, { icon: IconName; className: string }> = {
  W: { icon: "check", className: "bg-pitch-600 text-white" },
  D: { icon: "minus", className: "bg-zinc-400 text-white dark:bg-zinc-500" },
  L: { icon: "x", className: "bg-red-500 text-white" },
};

const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

export default async function MatchPage({ params }: { params: Params }) {
  const { locale, league: slug, matchSlug } = await params;
  setRequestLocale(locale);
  const loaded = await loadMatch(slug, matchSlug);
  if (!loaded) notFound();
  // A game moved to another day: its new address.
  if ("moved" in loaded) permanentRedirect(`/${locale}${loaded.moved}`);
  const lang = langOf(locale);
  const [t, tc, seo] = await Promise.all([getTranslations("Match"), getTranslations("Club"), getTranslations("Seo")]);
  const { league, match, result, state, odds, xg, scores, outlook, homeClub, awayClub, venue, timeZone, season } = loaded;
  const { fixture, home, away } = match;
  const pct = (share: number) => percent(share, lang);
  const values = textValues(loaded, lang);
  const played = state === "played";
  const subtitle = t(played ? "subtitlePlayed" : "subtitle", { league: league.name, matchday: t("matchday", { n: fixture.matchday }) });
  const simulator = league.simulatorName[lang];
  const leaguePath = `/${league.slug}`;
  const pageUrl = `${SITE_URL}/${locale}${match.path}`;
  const count = new Intl.NumberFormat(lang).format(outlook?.iterations ?? 10_000);
  // Club pages exist for this season's clubs (an old game's club may have gone down since).
  const clubPage = (team: Team) => loaded.current.teams.find((x) => x.slug === team.slug)?.page;
  const tableName = (club: ClubOutlook) =>
    outlook?.scope === "eachTable" && club.group ? club.group[lang] : outlook?.scope === "annual" && league.annual ? league.annual.name[lang] : league.name;


  const scoreText = (s: { home: number; away: number }) => `${s.home}–${s.away}`;

  const teamName = (team: Team, className = "") => {
    const page = clubPage(team);
    return page ? (
      <Link href={page} className={`hover:underline ${className}`} data-testid="match-club-link">
        {team.name}
      </Link>
    ) : (
      <span className={className}>{team.name}</span>
    );
  };

  const outcomes = [
    { key: "home", label: t("win", { team: home.shortName }), share: odds.home, color: "#16a34a" },
    { key: "draw", label: t("draw"), share: odds.draw, color: "#a1a1aa" },
    { key: "away", label: t("win", { team: away.shortName }), share: odds.away, color: "#2563eb" },
  ];
  const maxScore = Math.max(...scores.map((s) => s.p));

  const teamCard = (team: Team, club: ClubOutlook | undefined) => (
    <div className={card} data-testid="match-team">
      <div className="flex min-w-0 items-center gap-3">
        <TeamBadge team={team} size={32} />
        <h3 className="min-w-0 truncate text-base font-bold">{teamName(team)}</h3>
      </div>
      {club ? (
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-zinc-500">{t("position")}</dt>
            <dd className="text-lg font-extrabold tabular-nums">{ordinal(club.row.position, lang)}</dd>
            <dd className="truncate text-[11px] text-zinc-500">{tableName(club)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">{t("points")}</dt>
            <dd className="text-lg font-extrabold tabular-nums">{club.row.points}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">{t("played")}</dt>
            <dd className="text-lg font-extrabold tabular-nums">{club.row.played}</dd>
            <dd className="text-[11px] tabular-nums text-zinc-500">
              {club.row.won}-{club.row.drawn}-{club.row.lost}
            </dd>
          </div>
          <div className="col-span-3">
            <dt className="text-xs text-zinc-500">{t("form")}</dt>
            <dd className="mt-1 flex gap-1" data-testid="match-form">
              {club.row.form.length === 0 ? (
                <span className="text-sm text-zinc-500">{t("formEmpty")}</span>
              ) : (
                club.row.form.map((r, i) => (
                  <span key={i} className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${FORM[r].className}`} data-result={r}>
                    <Icon name={FORM[r].icon} size={14} strokeWidth={3} title={tc(`formResult.${r}`)} />
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      ) : null}
      {clubPage(team) && (
        <Link href={clubPage(team)!} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-pitch-700 hover:underline dark:text-pitch-300">
          {t("seasonChances", { club: team.shortName })}
          <Icon name="chevron-right" size={14} />
        </Link>
      )}
    </div>
  );

  // A change in a chance, in points, coloured by whether it's good for that club.
  return (
    <div className="space-y-6" data-testid="match-page" data-state={state}>
      <JsonLd
        data={[
          {
            "@type": "SportsEvent",
            name: `${home.name} vs ${away.name}`,
            sport: "Soccer",
            startDate: fixture.utcDate,
            // schema.org's statuses are about scheduling: a game played as planned stays
            // EventScheduled ("taking place or has taken place on the startDate as
            // scheduled"); there is no completed status.
            eventStatus: state === "off" ? "https://schema.org/EventPostponed" : "https://schema.org/EventScheduled",
            url: pageUrl,
            inLanguage: HREFLANG[locale],
            description: t(played ? "descriptionPlayed" : "description", values),
            homeTeam: { "@type": "SportsTeam", name: home.name, ...(clubPage(home) ? { url: `${SITE_URL}/${locale}${clubPage(home)}` } : {}), ...(home.crest ? { logo: home.crest } : {}) },
            awayTeam: { "@type": "SportsTeam", name: away.name, ...(clubPage(away) ? { url: `${SITE_URL}/${locale}${clubPage(away)}` } : {}), ...(away.crest ? { logo: away.crest } : {}) },
            competitor: [
              { "@type": "SportsTeam", name: home.name },
              { "@type": "SportsTeam", name: away.name },
            ],
            ...(venue ? { location: { "@type": "Place", name: venue } } : {}),
            superEvent: { "@type": "SportsEvent", name: `${league.name} ${season}`, url: `${SITE_URL}/${locale}${leaguePath}` },
            organizer: { "@type": "SportsOrganization", name: league.name, url: `${SITE_URL}/${locale}${leaguePath}` },
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: seo("breadcrumbHome"), item: `${SITE_URL}/${locale}` },
              { "@type": "ListItem", position: 2, name: simulator, item: `${SITE_URL}/${locale}${leaguePath}` },
              { "@type": "ListItem", position: 3, name: `${home.name} vs ${away.name}`, item: pageUrl },
            ],
          },
        ]}
      />

      <nav aria-label={seo("breadcrumb")} className="flex min-w-0 items-center text-xs text-zinc-500">
        <Link href="/" className="shrink-0 hover:underline">
          {seo("breadcrumbHome")}
        </Link>
        <Icon name="chevron-right" size={12} className="mx-1 shrink-0" />
        <Link href={leaguePath} className="truncate hover:underline">
          {simulator}
        </Link>
        <Icon name="chevron-right" size={12} className="mx-1 shrink-0" />
        <span className="truncate">
          {home.shortName} {t("vs")} {away.shortName}
        </span>
      </nav>

      <header className="space-y-4">
        <Link
          href={leaguePath}
          className="inline-flex max-w-full items-center gap-2 rounded-full bg-pitch-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-pitch-700 hover:bg-pitch-100 dark:bg-pitch-900/40 dark:text-pitch-100"
        >
          <Flag code={league.flag} width={18} />
          <span className="truncate">
            {league.name} {season}
          </span>
        </Link>
        <div>
          {/* Phones: no visible heading (the match card below names both clubs); it stays in the page for search engines and screen readers. */}
          <h1 className="sr-only sm:not-sr-only sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1 sm:text-3xl sm:font-extrabold sm:tracking-tight" data-testid="match-h1">
            {([home, away] as const).map((team, i) => (
              <span key={team.id} className="contents">
                {i === 1 && <span className="font-semibold text-zinc-400">{t("vs")}</span>}
                {/* Name, crest × crest, name: each crest next to the "vs". */}
                <span className={`inline-flex min-w-0 items-center gap-2 ${i === 0 ? "flex-row-reverse" : ""}`}>
                  <TeamBadge team={team} size={32} textless />
                  <span className="break-words">{team.name}</span>
                </span>
              </span>
            ))}
          </h1>
          <p className="text-sm font-medium text-zinc-600 sm:mt-1 dark:text-zinc-400" data-testid="match-subtitle">
            {subtitle}
          </p>
        </div>
        <div className="flex flex-col gap-1 text-sm text-zinc-600 sm:flex-row sm:flex-wrap sm:gap-x-5 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Icon name="calendar-days" size={16} className="shrink-0" />
            <LocalKickoff iso={fixture.utcDate} locale={dateLocale(lang)} timeZone={timeZone} yourTime={t("yourTime")} />
          </span>
          {venue && (
            <span className="flex min-w-0 items-center gap-1.5" data-testid="match-venue">
              <Icon name="map-pin" size={16} className="shrink-0" />
              <span className="truncate">{venue}</span>
            </span>
          )}
        </div>

        {/* The two clubs, and the final score once it's in. */}
        <div className={`${card} grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3`} data-testid="match-scoreboard">
          <div className="flex min-w-0 flex-col items-center gap-2 text-center">
            <TeamBadge team={home} size={56} />
            <span className="max-w-full text-sm font-bold break-words sm:text-base">{teamName(home)}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            {played && result ? (
              <>
                <span className="rounded-lg bg-zinc-100 px-4 py-2 text-3xl font-extrabold tabular-nums dark:bg-zinc-800" data-testid="match-final-score">
                  {scoreText(result)}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("fullTime")}</span>
              </>
            ) : (
              <>
                <span className="text-xl font-extrabold text-zinc-400">{t("vs")}</span>
                {state === "live" && (
                  <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/40 dark:text-red-200">
                    <Icon name="clock" size={12} />
                    {t("live")}
                  </span>
                )}
                {state === "off" && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t("postponed")}</span>}
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-col items-center gap-2 text-center">
            <TeamBadge team={away} size={56} />
            <span className="max-w-full text-sm font-bold break-words sm:text-base">{teamName(away)}</span>
          </div>
        </div>
        {state === "live" && <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("liveNote")}</p>}
        {state === "off" && <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("postponedNote")}</p>}
      </header>

      <section className="space-y-3" data-testid="match-prediction">
        <h2 className="text-xl font-bold tracking-tight">{t(played ? "preMatchTitle" : "predictionTitle")}</h2>
        <div className="grid grid-cols-3 gap-2 sm:gap-3" role="img" aria-label={t("oddsLabel", { home: home.shortName, away: away.shortName, homeWin: pct(odds.home), draw: pct(odds.draw), awayWin: pct(odds.away) })}>
          {outcomes.map((o) => (
            <div key={o.key} className={`${card} p-3 sm:p-4`} data-outcome={o.key}>
              <p className="min-h-8 text-xs font-semibold leading-4 break-words text-zinc-600 sm:min-h-0 dark:text-zinc-300">{o.label}</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums sm:text-3xl">{pct(o.share)}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div className="h-full rounded-full" style={{ width: `${o.share * 100}%`, background: o.color }} />
              </div>
            </div>
          ))}
        </div>
        <div className={`grid gap-3 ${played ? "" : "md:grid-cols-2"}`}>
          <div className={card}>
            <h3 className="text-sm font-semibold">{t("xgTitle")}</h3>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3" data-testid="match-xg">
              <span className="truncate text-sm font-medium">{home.shortName}</span>
              <span className="text-2xl font-extrabold tabular-nums">
                {xg.home.toFixed(2)} <span className="text-zinc-400">–</span> {xg.away.toFixed(2)}
              </span>
              <span className="truncate text-right text-sm font-medium">{away.shortName}</span>
            </div>
            <h3 className="mt-5 text-sm font-semibold">{t("scoresTitle")}</h3>
            <ol className="mt-2 space-y-1.5" data-testid="match-scores">
              {scores.map((s) => (
                <li key={`${s.home}-${s.away}`} className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2 text-sm">
                  <span className="font-bold tabular-nums">{scoreText(s)}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                    <span className="block h-full rounded-full bg-pitch-600" style={{ width: `${(s.p / maxScore) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-zinc-600 dark:text-zinc-300">{pct(s.p)}</span>
                </li>
              ))}
            </ol>
          </div>
          {/* The dice: for a game still to play (a played one has its real score). */}
          {!played && (
            <div className={`${card} flex flex-col gap-3`}>
              <h3 className="text-sm font-semibold">{t("diceTitle")}</h3>
              <MatchDice
                xg={xg}
                rho={loaded.model.rho ?? 0}
                home={home.shortName}
                away={away.shortName}
                labels={{ button: t("diceButton"), again: t("diceAgain"), result: t("diceResult", { score: "{score}" }) }}
              />
              <p className="text-xs text-zinc-500">{t("diceNote")}</p>
            </div>
          )}
        </div>
        <p className="text-xs text-zinc-500">{t(played ? "preMatchNote" : "predictionNote")}</p>
      </section>

      {/* "What this result means": three more season simulations, fetched once the page has loaded. */}
      {hasImpact(loaded) && <MatchImpact src={`/${locale}${match.path}/impact`} title={t("impactTitle")} />}

      <section className="space-y-3" data-testid="match-form-table">
        <h2 className="text-xl font-bold tracking-tight">{t("formTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {teamCard(home, homeClub)}
          {teamCard(away, awayClub)}
        </div>
      </section>

      <Link
        href={leaguePath}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700 sm:w-auto sm:justify-self-start"
        data-testid="match-simulate"
      >
        <Icon name="dices" size={18} />
        <span className="truncate">{t("simulate", { league: league.name })}</span>
      </Link>
    </div>
  );
}

