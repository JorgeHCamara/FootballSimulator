import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { MyWorld } from "../../../components/MyWorld.tsx";
import { PastWinnersProvider, type RealWinners } from "../../../components/PastWinnersProvider.tsx";
import { WorldHero } from "../../../components/WorldHero.tsx";
import { WorldPlayingFlag } from "../../../components/WorldPlayingFlag.tsx";
import type { SiteLocale } from "../../../config/leagues.ts";
import { divisionConfig, WORLD_LEAGUES } from "../../../lib/myWorld.ts";
import { worldStartPack } from "../../../lib/myWorldStart.ts";
import { leagueWinners } from "../../../lib/winnersData.ts";
import { MY_WORLD_LISTED, OG_LOCALE, SITE_NAME, alternates } from "../../../lib/site.ts";
import { PLAY_ANCHOR } from "../../../lib/worldHero.ts";

/**
 * The live data a new world starts from, refreshed as the league pages are:
 * every six hours at most while /api/revalidate/leagues brings new results in
 * (the leagues' data and each cup's start, keptStartCup, are kept that long),
 * hourly without it. A saved world needs none of it.
 */
export const revalidate = 21600;
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
  const [messages, pack] = await Promise.all([getMessages(), worldStartPack()]);
  // Each league's real Past Winners (src/data/history), for the world's own seasons to go on top of; a league without a file shows the world's only.
  const realWinners: RealWinners = Object.fromEntries(
    WORLD_LEAGUES.flatMap((code) => {
      const rows = leagueWinners(divisionConfig(code).slug);
      return rows ? [[code, rows]] : [];
    }),
  );
  return (
    <div className="space-y-6" data-testid="my-world">
      {/* A world already being played: the hero goes, its H1 kept for screen readers (before the hero, so it never shows). */}
      <WorldPlayingFlag />
      {/* The hero: the page's one H1, the mode in a few words, a button to the game below. */}
      <WorldHero />
      {/* The game's own words, the league simulator's (its fixtures and dice) and the cups': the rest of the site's client messages aren't needed inside it. */}
      <div id={PLAY_ANCHOR} className="scroll-mt-4">
        <NextIntlClientProvider locale={locale} messages={{ World: messages.World, Simulator: messages.Simulator, PastWinners: messages.PastWinners, Cup: messages.Cup, Zones: messages.Zones }}>
          <PastWinnersProvider value={realWinners}>
            <MyWorld pack={pack} locale={langOf(locale)} />
          </PastWinnersProvider>
        </NextIntlClientProvider>
      </div>
    </div>
  );
}
