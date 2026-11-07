import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Icon } from "../../../components/Icon.tsx";
import { MyWorld } from "../../../components/MyWorld.tsx";
import { PastWinnersProvider, type RealWinners } from "../../../components/PastWinnersProvider.tsx";
import type { SiteLocale } from "../../../config/leagues.ts";
import { divisionConfig, ENGLAND } from "../../../lib/myWorld.ts";
import { worldStartPack } from "../../../lib/myWorldStart.ts";
import { leagueWinners } from "../../../lib/winnersData.ts";
import { MY_WORLD_LISTED, OG_LOCALE, SITE_NAME, alternates } from "../../../lib/site.ts";

/** The live data a new world starts from, refreshed as the league pages are (hourly). A saved world needs none of it. */
export const revalidate = 3600;
/** Room for the four leagues' data on a cold server. */
export const maxDuration = 60;

type Params = Promise<{ locale: string }>;
const langOf = (locale: string) => (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "World" });
  const title = t("metaTitle");
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: alternates(locale, "/my-world"),
    // Unlisted while it is reworked: not indexed either.
    ...(MY_WORLD_LISTED ? {} : { robots: { index: false, follow: true } }),
    openGraph: { type: "website", siteName: SITE_NAME, title, description, url: `/${locale}/my-world`, locale: OG_LOCALE[locale] },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** My World: the game mode's page (the game itself runs in the browser, see MyWorld). */
export default async function Page({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [t, messages, pack] = await Promise.all([getTranslations("World"), getMessages(), worldStartPack()]);
  // Each league's real Past Winners (src/data/history), for the world's own seasons to go on top of; a league without a file shows the world's only.
  const realWinners: RealWinners = Object.fromEntries(
    ENGLAND.flatMap((code) => {
      const rows = leagueWinners(divisionConfig(code).slug);
      return rows ? [[code, rows]] : [];
    }),
  );
  return (
    <div className="space-y-6" data-testid="my-world">
      <header className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-pitch-700 dark:text-pitch-100">
          <Icon name="globe" size={16} />
          {t("title")}
        </p>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t("intro")}</p>
      </header>
      {/* The game's own words, the league simulator's (its fixtures and dice) and the cups': the rest of the site's client messages aren't needed inside it. */}
      <NextIntlClientProvider locale={locale} messages={{ World: messages.World, Simulator: messages.Simulator, PastWinners: messages.PastWinners, Cup: messages.Cup }}>
        <PastWinnersProvider value={realWinners}>
          <MyWorld pack={pack} locale={langOf(locale)} />
        </PastWinnersProvider>
      </NextIntlClientProvider>
    </div>
  );
}
