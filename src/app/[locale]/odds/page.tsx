import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Flag } from "../../../components/Flag.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TeamBadge } from "../../../components/TeamBadge.tsx";
import { CONTINENTS, continentOf } from "../../../config/competitions.ts";
import type { SiteLocale } from "../../../config/leagues.ts";
import { Link } from "../../../i18n/navigation.ts";
import { percent } from "../../../lib/clubText.ts";
import { latestReports } from "../../../lib/oddsPage.ts";
import { latestReportPath } from "../../../lib/oddsReports.ts";
import { dateLocale, reportText } from "../../../lib/oddsText.ts";
import { OG_LOCALE, SITE_NAME, alternates } from "../../../lib/site.ts";

/** Every league's latest report: it changes when a new round's snapshot is deployed, and with the leagues' data (as their pages). */
export const revalidate = 21600;

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Odds" });
  const title = t("hubTitle");
  const description = t("hubDescription");
  return {
    title,
    description,
    alternates: alternates(locale, "/odds"),
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: `/${locale}/odds`, locale: OG_LOCALE[locale] },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** "Latest odds": every league's latest "what changed" report, by continent. */
export default async function OddsHubPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const [t, tc] = await Promise.all([getTranslations("Odds"), getTranslations("Continents")]);
  const reports = await latestReports();
  const items = await Promise.all(
    reports.map(async (loaded) => {
      const text = await reportText(loaded, lang);
      return { loaded, text };
    }),
  );
  const day = (date: string) => new Intl.DateTimeFormat(dateLocale(lang), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

  return (
    <div className="space-y-8" data-testid="odds-hub">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
          <Icon name="trending-up" size={28} className="shrink-0 text-pitch-600" />
          {t("hubTitle")}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("hubIntro")}</p>
      </header>
      {CONTINENTS.map((continent) => {
        const own = items.filter(({ loaded }) => continentOf(loaded.league.country) === continent);
        if (!own.length) return null;
        return (
          <section key={continent} className="space-y-3">
            <h2 className="text-lg font-bold tracking-tight">{tc(continent)}</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {own.map(({ loaded, text }) => {
                const { league, report, teams } = loaded;
                const leader = text.leader;
                const team = leader ? teams.get(leader.teamId) : undefined;
                return (
                  <li key={league.code}>
                    <Link
                      href={latestReportPath(league)}
                      className="flex h-full flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 hover:border-pitch-600 dark:border-zinc-800 dark:bg-zinc-900"
                      data-testid="odds-hub-item"
                    >
                      <span className="flex items-center gap-2 font-bold">
                        <Flag code={league.flag} width={20} />
                        <span className="min-w-0 truncate">{league.name}</span>
                      </span>
                      <span className="text-xs text-zinc-500">
                        {text.round} · {day(report.snapshot.date)}
                      </span>
                      {leader && team && (
                        <span className="mt-auto flex items-center gap-2 text-sm">
                          <TeamBadge team={team} size={20} />
                          <span className="min-w-0 flex-1 truncate">{team.shortName}</span>
                          <span className="shrink-0 text-xs text-zinc-500">{report.lead.kind === "continental" ? text.topic(report.lead) : text.t(`category.${report.lead.kind}`)}</span>
                          <span className="shrink-0 font-bold tabular-nums">{percent(leader.values[report.lead.kind]!.now, lang)}</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
