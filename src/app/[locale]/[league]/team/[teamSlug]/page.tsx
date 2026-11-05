import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Flag } from "../../../../../components/Flag.tsx";
import { Icon, type IconName } from "../../../../../components/Icon.tsx";
import { JsonLd } from "../../../../../components/JsonLd.tsx";
import { ShareMenu } from "../../../../../components/ShareMenu.tsx";
import { TeamBadge } from "../../../../../components/TeamBadge.tsx";
import { zoneHex, ZONE_STYLES } from "../../../../../components/zones.ts";
import type { SiteLocale, ZoneKind } from "../../../../../config/leagues.ts";
import type { FormResult, Team, TeamId } from "../../../../../engine/types.ts";
import { Link } from "../../../../../i18n/navigation.ts";
import { mustWinGames, toughestGames, type ClubFixture } from "../../../../../lib/clubOutlook.ts";
import { clubDescription, clubHeading, clubSubtitle, loadClub } from "../../../../../lib/clubPage.ts";
import { listOf, ordinal, percent, placeRange } from "../../../../../lib/clubText.ts";
import { inIndexWindow, matchPath, matchSlug } from "../../../../../lib/matches.ts";
import { HREFLANG, OG_LOCALE, SITE_NAME, SITE_URL, alternates } from "../../../../../lib/site.ts";

/** Regenerated in the background at most every hour, like the league pages (the league data is refreshed hourly). */
export const revalidate = 3600;

type Params = Promise<{ locale: string; league: string; teamSlug: string }>;

/** Every club page is rendered on its first visit, then kept and refreshed (ISR): none at build time. */
export function generateStaticParams() {
  return [];
}

const langOf = (locale: string) => (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league: slug, teamSlug } = await params;
  const loaded = await loadClub(slug, teamSlug);
  if (!loaded) return {};
  const lang = langOf(locale);
  const [t, tz] = await Promise.all([getTranslations({ locale, namespace: "Club" }), getTranslations({ locale, namespace: "Zones" })]);
  const title = clubHeading(loaded, lang, t as never, tz as never);
  const description = clubDescription(loaded, lang, t as never, tz as never);
  const path = loaded.team.page!;
  return {
    title,
    description,
    alternates: alternates(locale, path),
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

export default async function ClubPage({ params }: { params: Params }) {
  const { locale, league: slug, teamSlug } = await params;
  setRequestLocale(locale);
  const loaded = await loadClub(slug, teamSlug);
  if (!loaded) notFound();
  const lang = langOf(locale);
  const [t, tz, seo] = await Promise.all([getTranslations("Club"), getTranslations("Zones"), getTranslations("Seo")]);
  const { league, data, outlook, club, team, season } = loaded;
  const teams = new Map<TeamId, Team>(data.teams.map((x) => [x.id, x]));
  const pct = (share: number) => percent(share, lang);
  const count = new Intl.NumberFormat(lang).format(outlook.iterations);
  const simulator = league.simulatorName[lang];
  const leaguePath = `/${league.slug}`;
  const pageUrl = `${SITE_URL}/${locale}${team.page}`;
  const { row } = club;
  const table =
    outlook.scope === "eachTable" && club.group
      ? t("tableGroup", { group: club.group[lang] })
      : outlook.scope === "annual"
        ? t("tableAnnual", { league: league.name })
        : t("tableLeague", { league: league.name });
  const tableName = outlook.scope === "eachTable" && club.group ? club.group[lang] : outlook.scope === "annual" && league.annual ? league.annual.name[lang] : league.name;

  // The summary: where the club stands, its chances, its likeliest finish.
  const position = ordinal(row.position, lang);
  const summary = [
    row.played === 0
      ? t("summaryStart", { club: team.name })
      : outlook.complete
        ? t("summaryFinal", { club: team.name, position, table, points: row.points })
        : t("summaryPosition", { club: team.name, position, table, points: row.points, played: row.played }),
    ...(!outlook.complete && club.headline.length
      ? [
          t("summaryChances", {
            club: team.shortName,
            count,
            clauses: listOf(
              club.headline.map((h) => t(`clause.${h.kind}`, { pct: pct(h.chance), zone: tz(h.zone) })),
              lang,
            ),
          }),
        ]
      : []),
    ...(!outlook.complete
      ? [t("summaryLikeliest", { position: ordinal(club.likeliest.position, lang), pct: pct(club.likeliest.chance), avgPoints: Math.round(club.averagePoints) })]
      : []),
  ].join(" ");

  const toughest = toughestGames(club.fixtures);
  const mustWin = mustWinGames(club.fixtures, row.position, toughest);
  const zoneAt = (p: number): ZoneKind | undefined => club.zones.find((z) => z.ranges.some(([from, to]) => p >= from && p <= to))?.kind;
  const maxShare = Math.max(0.0001, ...club.distribution);
  const dateFormat = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" });
  // Phones: "8/11" (day first, also in English), which fits on one line.
  const shortDate = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang, { day: "numeric", month: "numeric", timeZone: "UTC" });
  const shareProps = {
    path: `/${locale}${team.page}`,
    imagePath: `/${locale}${team.page}/opengraph-image`,
    title: t("shareTitle", { club: team.name, season: season }),
    text: t("shareText", { club: team.name, league: league.name, season: season }),
    league: league.code,
  };
  const others = data.teams.filter((x) => x.id !== team.id && outlook.clubs.has(x.id)).sort((a, b) => a.name.localeCompare(b.name, lang));

  const venue = (f: ClubFixture) => (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${f.home ? "bg-pitch-100 text-pitch-800 dark:bg-pitch-900/50 dark:text-pitch-100" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"}`}
      title={t(f.home ? "home" : "away")}
    >
      <span aria-hidden>{t(f.home ? "homeShort" : "awayShort")}</span>
      <span className="sr-only">{t(f.home ? "home" : "away")}</span>
    </span>
  );
  const opponent = (f: ClubFixture) => {
    const other = teams.get(f.opponentId);
    if (!other) return null;
    const name = (
      <>
        <TeamBadge team={other} size={20} />
        <span className="truncate font-medium">{other.shortName}</span>
      </>
    );
    return other.page ? (
      <Link href={other.page} className="flex min-w-0 items-center gap-2 hover:underline">
        {name}
      </Link>
    ) : (
      <span className="flex min-w-0 items-center gap-2">{name}</span>
    );
  };
  const odds = (f: ClubFixture) => (
    <div className="w-28 shrink-0 sm:w-40" aria-label={t("oddsLabel", { win: pct(f.win), draw: pct(f.draw), loss: pct(f.loss) })} role="img">
      <div className="flex justify-between text-xs tabular-nums">
        <span className="font-bold text-pitch-700 dark:text-pitch-300">{pct(f.win)}</span>
        <span className="text-zinc-500">{pct(f.draw)}</span>
        <span className="text-red-600 dark:text-red-400">{pct(f.loss)}</span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <span className="bg-pitch-600" style={{ width: `${f.win * 100}%` }} />
        <span className="bg-zinc-400" style={{ width: `${f.draw * 100}%` }} />
        <span className="bg-red-500" style={{ width: `${f.loss * 100}%` }} />
      </div>
    </div>
  );
  // Each game's own preview page (odds, likely scores, what each result means),
  // linked only inside the window search engines are pointed at (the rest are plain text).
  const preview = (f: ClubFixture) => {
    if (!inIndexWindow(f.fixture.utcDate)) return undefined;
    const slug = matchSlug(league, f.fixture, teams.get(f.fixture.homeId), teams.get(f.fixture.awayId));
    return slug ? matchPath(league, slug) : undefined;
  };
  const withPreview = (f: ClubFixture, content: React.ReactNode, className = "") => {
    const href = preview(f);
    return href ? (
      <Link href={href} className={`hover:underline ${className}`} data-testid="club-match-link">
        {content}
      </Link>
    ) : (
      <span className={className}>{content}</span>
    );
  };
  const keyGame = (f: ClubFixture) => (
    <li key={f.fixture.id} className="flex items-center gap-3 py-2">
      {venue(f)}
      <div className="min-w-0 flex-1">
        {opponent(f)}
        <p className="mt-0.5 text-xs text-zinc-500">
          {withPreview(f, dateFormat.format(new Date(f.fixture.utcDate)))} · {t("opponentPosition", { position: ordinal(f.opponentPosition, lang) })}
        </p>
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums text-pitch-700 dark:text-pitch-300">{t("winChance", { pct: pct(f.win) })}</span>
    </li>
  );

  return (
    <div className="space-y-6" data-testid="club-page">
      <JsonLd
        data={[
          {
            "@type": "SportsTeam",
            name: team.name,
            alternateName: team.shortName !== team.name ? team.shortName : undefined,
            sport: "Soccer",
            url: pageUrl,
            ...(team.crest ? { logo: team.crest } : {}),
            memberOf: { "@type": "SportsOrganization", name: league.name, sport: "Soccer", url: `${SITE_URL}/${locale}${leaguePath}` },
            inLanguage: HREFLANG[locale],
            description: summary,
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: seo("breadcrumbHome"), item: `${SITE_URL}/${locale}` },
              { "@type": "ListItem", position: 2, name: simulator, item: `${SITE_URL}/${locale}${leaguePath}` },
              { "@type": "ListItem", position: 3, name: team.name, item: pageUrl },
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
        <span className="truncate">{team.name}</span>
      </nav>

      <header className="space-y-4">
        <Link
          href={leaguePath}
          className="inline-flex items-center gap-2 rounded-full bg-pitch-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-pitch-700 hover:bg-pitch-100 dark:bg-pitch-900/40 dark:text-pitch-100"
        >
          <Flag code={league.flag} width={18} />
          {league.name} {season}
        </Link>
        <div className="flex items-start gap-3 sm:items-center">
          <span className="mt-0.5 shrink-0 sm:mt-0">
            <TeamBadge team={team} size={40} />
          </span>
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-extrabold tracking-tight sm:text-3xl">{team.name}</h1>
            <p className="mt-0.5 text-sm font-medium text-zinc-600 dark:text-zinc-400" data-testid="club-subtitle">
              {clubSubtitle(loaded, lang, t as never, tz as never)}
            </p>
          </div>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-700 dark:text-zinc-300" data-testid="club-summary">
          {summary}
        </p>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="club-stats">
          <div className={card}>
            <dt className="text-xs font-medium text-zinc-500">{t("position")}</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums">{position}</dd>
            <dd className="truncate text-xs text-zinc-500">{tableName}</dd>
          </div>
          <div className={card}>
            <dt className="text-xs font-medium text-zinc-500">{t("points")}</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums">{row.points}</dd>
          </div>
          <div className={card}>
            <dt className="text-xs font-medium text-zinc-500">{t("played")}</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums">{row.played}</dd>
            <dd className="text-xs tabular-nums text-zinc-500">
              {row.won}-{row.drawn}-{row.lost}
            </dd>
          </div>
          <div className={card}>
            <dt className="text-xs font-medium text-zinc-500">{t("form")}</dt>
            <dd className="mt-2 flex gap-1" data-testid="club-form">
              {row.form.length === 0 ? (
                <span className="text-sm text-zinc-500">{t("formEmpty")}</span>
              ) : (
                row.form.map((result, i) => (
                  <span key={i} className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${FORM[result].className}`} data-result={result}>
                    <Icon name={FORM[result].icon} size={14} strokeWidth={3} title={t(`formResult.${result}`)} />
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link
            href={leaguePath}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700"
            data-testid="club-simulate"
          >
            <Icon name="dices" size={18} />
            {t("simulate", { club: team.shortName })}
          </Link>
          <div className="hidden sm:block">
            <ShareMenu {...shareProps} variant="inline" />
          </div>
          <div className="sm:hidden">
            <ShareMenu {...shareProps} variant="bar" />
          </div>
        </div>
      </header>

      <section className="space-y-3" data-testid="club-chances">
        <h2 className="text-xl font-bold tracking-tight">{t("chancesTitle")}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {club.zones.map((zone) => (
            <div key={zone.kind} className={card} data-zone={zone.kind}>
              <div className="flex items-start gap-2">
                <span className={`mt-px h-3 w-3 shrink-0 rounded-sm ${ZONE_STYLES[zone.kind].dot}`} />
                <span className="text-xs font-semibold leading-tight">{tz(zone.kind)}</span>
              </div>
              <p className="mt-2 text-2xl font-extrabold tabular-nums">{pct(zone.chance)}</p>
              <p className="text-xs text-zinc-500">{zone.ranges.map(([from, to]) => placeRange(from, to, lang)).join(", ")}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div className="h-full rounded-full" style={{ width: `${zone.chance * 100}%`, background: zoneHex(zone.kind) }} />
              </div>
            </div>
          ))}
          <div className={card}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Icon name="target" size={14} className="shrink-0 text-zinc-500" />
              <span className="leading-tight">{t("likeliest")}</span>
            </div>
            <p className="mt-2 text-2xl font-extrabold tabular-nums">{ordinal(club.likeliest.position, lang)}</p>
            <p className="text-xs text-zinc-500">{pct(club.likeliest.chance)}</p>
          </div>
          <div className={card}>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Icon name="chart-column" size={14} className="shrink-0 text-zinc-500" />
              <span className="leading-tight">{t("averagePoints")}</span>
            </div>
            <p className="mt-2 text-2xl font-extrabold tabular-nums">{Math.round(club.averagePoints)}</p>
          </div>
        </div>
        <p className="text-xs text-zinc-500">{t("chancesNote", { count })}</p>
      </section>

      <section className="space-y-3" data-testid="club-distribution">
        <h2 className="text-xl font-bold tracking-tight">{t("distributionTitle")}</h2>
        <div className={card}>
          <div className="flex h-36 items-end gap-px sm:gap-1" role="img" aria-label={t("distributionNote", { club: team.shortName })}>
            {club.distribution.map((share, i) => {
              const kind = zoneAt(i + 1);
              return (
                <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${ordinal(i + 1, lang)}: ${pct(share)}`}>
                  {share >= 0.05 && <span className="mb-1 hidden text-[10px] font-semibold tabular-nums text-zinc-600 sm:block dark:text-zinc-300">{pct(share)}</span>}
                  <div
                    className={`w-full rounded-t-sm ${kind ? "" : "bg-zinc-300 dark:bg-zinc-600"}`}
                    style={{ height: `${Math.max(share > 0 ? 2 : 0, (share / maxShare) * 100)}%`, ...(kind ? { background: zoneHex(kind) } : {}) }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex gap-px border-t border-zinc-200 pt-1 sm:gap-1 dark:border-zinc-700">
            {club.distribution.map((_, i) => (
              <span key={i} className={`min-w-0 flex-1 text-center text-[9px] tabular-nums text-zinc-500 sm:text-[10px] ${club.distribution.length > 20 && (i + 1) % 5 !== 0 && i !== 0 ? "invisible sm:visible" : ""}`}>
                {i + 1}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-500">{t("distributionNote", { club: team.shortName })}</p>
        </div>
      </section>

      {club.fixtures.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-3" data-testid="club-toughest">
            <h2 className="text-xl font-bold tracking-tight">{t("toughestTitle")}</h2>
            <div className={card}>
              <p className="text-xs text-zinc-500">{t("toughestNote", { club: team.shortName })}</p>
              <ul className="mt-1 divide-y divide-zinc-200/70 dark:divide-zinc-800">{toughest.map(keyGame)}</ul>
            </div>
          </section>
          <section className="space-y-3" data-testid="club-must-win">
            <h2 className="text-xl font-bold tracking-tight">{t("mustWinTitle")}</h2>
            <div className={card}>
              <p className="text-xs text-zinc-500">{t("mustWinNote", { club: team.shortName })}</p>
              {mustWin.length ? (
                <ul className="mt-1 divide-y divide-zinc-200/70 dark:divide-zinc-800">{mustWin.map(keyGame)}</ul>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">{t("mustWinEmpty")}</p>
              )}
            </div>
          </section>
        </div>
      )}

      <section className="space-y-3" data-testid="club-fixtures">
        <h2 className="text-xl font-bold tracking-tight">{t("fixturesTitle")}</h2>
        {club.fixtures.length === 0 ? (
          <p className="text-sm text-zinc-500">{t("fixturesEmpty")}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex justify-end gap-3 border-b border-zinc-200 bg-zinc-100 px-3 py-1.5 text-[11px] font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-300">
              <span className="flex w-28 justify-between sm:w-40">
                <span>{t("win")}</span>
                <span>{t("draw")}</span>
                <span>{t("loss")}</span>
              </span>
            </div>
            <ul className="divide-y divide-zinc-200/70 dark:divide-zinc-800">
              {club.fixtures.map((f) => (
                <li key={f.fixture.id} className="flex items-center gap-2 px-3 py-2 text-sm sm:gap-3" data-testid="club-fixture">
                  {withPreview(
                    f,
                    <>
                      <span className="sm:hidden">{shortDate.format(new Date(f.fixture.utcDate))}</span>
                      <span className="hidden sm:inline">{dateFormat.format(new Date(f.fixture.utcDate))}</span>
                    </>,
                    "w-9 shrink-0 text-xs tabular-nums text-zinc-500 sm:w-16",
                  )}
                  {venue(f)}
                  <div className="min-w-0 flex-1">{opponent(f)}</div>
                  {odds(f)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3" data-testid="club-others">
        <h2 className="text-xl font-bold tracking-tight">{t("otherClubs", { league: league.name })}</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {others.map((other) => (
            <li key={other.id}>
              <Link
                href={other.page ?? leaguePath}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                <TeamBadge team={other} size={20} />
                <span className="truncate">{other.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

