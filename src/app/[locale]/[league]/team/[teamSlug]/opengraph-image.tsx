import { getTranslations } from "next-intl/server";
import { zoneHex } from "../../../../../components/zones.ts";
import { getLeagueBySlug, type SiteLocale } from "../../../../../config/leagues.ts";
import { loadClub, topicName } from "../../../../../lib/clubPage.ts";
import { ordinal, percent } from "../../../../../lib/clubText.ts";
import { OG_SIZE } from "../../../../../lib/ogImage.tsx";
import { renderClubCard, renderGenericShareCard } from "../../../../../lib/shareCard.tsx";

export const alt = "Foot Simu club chances";
export const size = OG_SIZE;
export const contentType = "image/png";

/** A club page's card: where the club stands and its headline chances (the page's own numbers). */
export default async function Image({ params }: { params: Promise<{ locale: string; league: string; teamSlug: string }> }) {
  const { locale, league: slug, teamSlug } = await params;
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const [t, tz, ts, tc] = await Promise.all([
    getTranslations({ locale: lang, namespace: "Club" }),
    getTranslations({ locale: lang, namespace: "Zones" }),
    getTranslations({ locale: lang, namespace: "ShareCard" }),
    getTranslations({ locale: lang, namespace: "Simulator" }),
  ]);
  const loaded = await loadClub(slug, teamSlug).catch(() => undefined);
  if (!loaded) {
    const league = getLeagueBySlug(slug);
    return renderGenericShareCard({ title: league?.name ?? "Foot Simu", subtitle: ts("genericSubtitle"), cta: ts("cta") });
  }
  const { league, outlook, club, team, season } = loaded;
  const chanceLabel = (h: (typeof club.headline)[number]) => (h.kind === "continental" ? topicName(h, t as never, tz as never) : t(`card.chance.${h.kind}`));
  return renderClubCard({
    pill: `${league.name} ${season}`.toUpperCase(),
    club: team.name,
    standing: `${ordinal(club.row.position, lang)} · ${club.row.points} ${tc("points")}`,
    likeliest: t("card.likeliest", { position: ordinal(club.likeliest.position, lang) }),
    chances: club.headline.slice(0, 4).map((h) => ({ label: chanceLabel(h), value: percent(h.chance, lang), share: h.chance, color: zoneHex(h.zone) })),
    basedOn: t("card.basedOn", { count: new Intl.NumberFormat(lang).format(outlook.iterations) }),
    cta: t("card.cta"),
  });
}
