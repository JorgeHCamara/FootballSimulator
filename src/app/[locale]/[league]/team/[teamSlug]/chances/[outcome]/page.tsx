import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { ChanceRace } from "../../../../../../../components/ChanceRace.tsx";
import { Faq } from "../../../../../../../components/Faq.tsx";
import { Flag } from "../../../../../../../components/Flag.tsx";
import { Icon } from "../../../../../../../components/Icon.tsx";
import { JsonLd } from "../../../../../../../components/JsonLd.tsx";
import { TeamBadge } from "../../../../../../../components/TeamBadge.tsx";
import { zoneHex } from "../../../../../../../components/zones.ts";
import type { SiteLocale } from "../../../../../../../config/leagues.ts";
import type { Team, TeamId } from "../../../../../../../engine/types.ts";
import { Link } from "../../../../../../../i18n/navigation.ts";
import { IntentLink } from "../../../../../../../components/IntentLink.tsx";
import { clubChancePath, isOutcome, leagueChancePath, leagueOutcomes, outcomeChance, outcomeRace, raceAround, type Outcome } from "../../../../../../../lib/chancePages.ts";
import { clubChanceText, outcomeKey, type ChanceTranslators } from "../../../../../../../lib/chanceText.ts";
import { loadClub, type LoadedClub } from "../../../../../../../lib/clubPage.ts";
import { ordinal, placeRange } from "../../../../../../../lib/clubText.ts";
import { OG_LOCALE, SITE_NAME, SITE_URL, alternates, faqJsonLd } from "../../../../../../../lib/site.ts";

/** As the club page: rebuilt when the league's results change, else every six hours at most (ISR). */
export const revalidate = 21600;
/** Room for the shared outlook on a cold server (see the club page). */
export const maxDuration = 60;

/** Rendered on its first visit, then kept and refreshed: none at build time. */
export function generateStaticParams() {
  return [];
}

type Params = Promise<{ locale: string; league: string; teamSlug: string; outcome: string }>;
const langOf = (locale: string) => (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;

/** The club and its outlook, when its league has this outcome; undefined for a 404. */
async function load(slug: string, teamSlug: string, outcome: string): Promise<(LoadedClub & { outcome: Outcome }) | undefined> {
  if (!isOutcome(outcome)) return undefined;
  const loaded = await loadClub(slug, teamSlug);
  return loaded?.team.page && outcomeChance(loaded.club, outcome) ? { ...loaded, outcome } : undefined;
}

async function translators(locale: string): Promise<ChanceTranslators> {
  const [t, tc, tz] = await Promise.all([
    getTranslations({ locale, namespace: "Chances" }),
    getTranslations({ locale, namespace: "Club" }),
    getTranslations({ locale, namespace: "Zones" }),
  ]);
  return { t: t as never, tc: tc as never, tz: tz as never };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league, teamSlug, outcome } = await params;
  const loaded = await load(league, teamSlug, outcome);
  if (!loaded) return {};
  const text = clubChanceText(loaded, loaded.outcome, langOf(locale), await translators(locale))!;
  const path = clubChancePath(loaded.team.page!, loaded.outcome);
  return {
    title: text.h1,
    description: text.description,
    alternates: alternates(locale, path),
    // The club's own card (its chances; nested pages don't inherit it).
    openGraph: { type: "website", siteName: SITE_NAME, title: text.h1, description: text.description, url: `/${locale}${path}`, locale: OG_LOCALE[locale], images: [{ url: `/${locale}${loaded.team.page}/opengraph-image`, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: text.h1, description: text.description, images: [`/${locale}${loaded.team.page}/opengraph-image`] },
    // Settled for the club (0% or 100%), or the season over: the page stays, out of search results.
    ...(text.indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

/** "{club}'s relegation chances": the club's chance of one outcome, where it stands, the race around it, an FAQ. */
export default async function ClubChancePage({ params }: { params: Params }) {
  const { locale, league: slug, teamSlug, outcome: param } = await params;
  setRequestLocale(locale);
  const loaded = await load(slug, teamSlug, param);
  if (!loaded) notFound();
  const lang = langOf(locale);
  const tr = await translators(locale);
  const { t, tc } = tr;
  const seo = await getTranslations("Seo");
  const { league, data, outlook, club, team, season, outcome } = loaded;
  const text = clubChanceText(loaded, outcome, lang, tr)!;
  const h = outcomeChance(club, outcome)!;
  const teams = new Map<TeamId, Team>(data.teams.map((x) => [x.id, x]));
  const leaguePath = `/${league.slug}`;
  const path = clubChancePath(team.page!, outcome);
  const pageUrl = `${SITE_URL}/${locale}${path}`;
  const race = raceAround(outcomeRace(outlook, outcome), team.id);
  const topicOf = (o: Outcome) => {
    const k = outcomeKey(o, outcomeChance(club, o));
    return { Topic: t(`Topic.${k.key}`, { name: k.name }), topic: t(`topic.${k.key}`, { name: k.name }) };
  };
  const others = leagueOutcomes(outlook).filter((o) => o !== outcome && outcomeChance(club, o));

  return (
    <div className="space-y-8" data-testid="club-chance-page" data-outcome={outcome}>
      <JsonLd
        data={[
          faqJsonLd(text.faq),
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: seo("breadcrumbHome"), item: `${SITE_URL}/${locale}` },
              { "@type": "ListItem", position: 2, name: league.simulatorName[lang], item: `${SITE_URL}/${locale}${leaguePath}` },
              { "@type": "ListItem", position: 3, name: team.name, item: `${SITE_URL}/${locale}${team.page}` },
              { "@type": "ListItem", position: 4, name: text.h1, item: pageUrl },
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
          {league.simulatorName[lang]}
        </Link>
        <Icon name="chevron-right" size={12} className="mx-1 shrink-0" />
        <IntentLink href={team.page!} className="truncate hover:underline">
          {team.name}
        </IntentLink>
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
        <div className="flex items-start gap-3">
          <span className="mt-1 shrink-0">
            <TeamBadge team={team} size={40} />
          </span>
          <h1 className="min-w-0 text-2xl font-extrabold tracking-tight break-words sm:text-3xl">{text.h1}</h1>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="club-chance-stats">
          <div className={`${card} col-span-2 sm:col-span-1`}>
            <dt className="flex items-center gap-2 text-xs font-semibold">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: zoneHex(h.zone) }} />
              {text.label}
            </dt>
            <dd className="mt-1 text-4xl font-extrabold tabular-nums" data-testid="club-chance-value">
              {text.pct}
            </dd>
            <dd className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <span className="block h-full rounded-full" style={{ width: `${Math.max(h.chance > 0 ? 2 : 0, h.chance * 100)}%`, background: zoneHex(h.zone) }} />
            </dd>
          </div>
          <div className={card}>
            <dt className="text-xs font-medium text-zinc-500">{tc("position")}</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums">{ordinal(club.row.position, lang)}</dd>
            <dd className="text-xs tabular-nums text-zinc-500">{t("pointsPlayed", { points: club.row.points, played: club.row.played })}</dd>
          </div>
          <div className={card}>
            <dt className="text-xs font-medium text-zinc-500">{tc("likeliest")}</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums">{placeRange(club.likelyRange.from, club.likelyRange.to, lang)}</dd>
          </div>
        </dl>

        <div className="max-w-3xl space-y-2 leading-relaxed text-zinc-700 dark:text-zinc-300" data-testid="club-chance-lead">
          {text.lead.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <IntentLink href={team.page!} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700" data-testid="club-chance-club">
            <Icon name="shield" size={18} />
            {t("club.fullPage", { club: team.shortName })}
          </IntentLink>
          <Link
            href={leaguePath}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            data-testid="club-chance-simulate"
          >
            <Icon name="dices" size={18} />
            {tc("simulate", { club: team.shortName })}
          </Link>
        </div>
      </header>

      <section className="space-y-3" data-testid="club-chance-race">
        <h2 className="text-xl font-bold tracking-tight">{t("club.raceTitle", topicOf(outcome))}</h2>
        <ChanceRace rows={race} teams={teams} outcome={outcome} color={zoneHex(h.zone)} lang={lang} standing={(position, points) => t("standing", { position, points })} highlight={team.id} />
        <p className="text-xs text-zinc-500">{t("club.raceNote", { count: Math.min(8, race.length) })}</p>
        <IntentLink href={leagueChancePath(league, outcome)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-pitch-700 hover:underline dark:text-pitch-100" data-testid="club-chance-league">
          {t("club.allClubs", topicOf(outcome))}
          <Icon name="chevron-right" size={16} />
        </IntentLink>
      </section>

      {others.length > 0 && (
        <section className="space-y-3" data-testid="club-chance-more">
          <h2 className="text-xl font-bold tracking-tight">{t("club.more", { club: team.shortName })}</h2>
          <ul className="flex flex-wrap gap-2">
            {others.map((o) => (
              <li key={o}>
                <IntentLink
                  href={clubChancePath(team.page!, o)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold hover:border-pitch-500 hover:bg-pitch-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-pitch-900/30"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: zoneHex(outcomeChance(club, o)!.zone) }} />
                  {t("chip", topicOf(o))}
                </IntentLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Faq title={seo("faqTitle")} items={text.faq} />
    </div>
  );
}
