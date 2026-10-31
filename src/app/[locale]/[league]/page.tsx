import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { LeagueSimulator } from "../../../components/LeagueSimulator.tsx";
import { LEAGUES, getLeagueBySlug } from "../../../config/leagues.ts";
import { routing } from "../../../i18n/routing.ts";
import { getLeagueData } from "../../../lib/leagueData.ts";
import { alternates } from "../../../lib/site.ts";

export const revalidate = 3600;

type Params = Promise<{ locale: string; league: string }>;

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => LEAGUES.map((l) => ({ locale, league: l.slug })));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, league: slug } = await params;
  const league = getLeagueBySlug(slug);
  if (!league) return {};
  const { season } = await getLeagueData(league);
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    title: t("leagueTitle", { league: league.name, season }),
    description: t("leagueDescription", { league: league.name, season }),
    alternates: alternates(locale, `/${league.slug}`),
  };
}

export default async function LeaguePage({ params }: { params: Params }) {
  const { locale, league: slug } = await params;
  setRequestLocale(locale);
  const league = getLeagueBySlug(slug);
  if (!league) notFound();

  const [data, t] = await Promise.all([getLeagueData(league), getTranslations("Simulator")]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          {league.name} <span className="font-semibold text-zinc-400">{data.season}</span>
        </h1>
        <p className="text-sm text-zinc-500">{data.source === "live" ? t("liveSource") : null}</p>
      </div>
      {data.source === "sample" && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" data-testid="sample-banner">
          {t("sampleBanner")}
        </p>
      )}
      <LeagueSimulator league={league} teams={data.teams} fixtures={data.fixtures} seasonKey={data.seasonKey} />
    </div>
  );
}
