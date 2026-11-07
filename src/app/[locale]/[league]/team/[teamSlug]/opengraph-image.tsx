import { getTranslations } from "next-intl/server";
import { zoneHex } from "../../../../../components/zones.ts";
import { getLeagueBySlug, type SiteLocale } from "../../../../../config/leagues.ts";
import { firstCardThatRenders } from "../../../../../lib/cardFallback.ts";
import { clubCardChances, loadClub } from "../../../../../lib/clubPage.ts";
import { ordinal, placeRange } from "../../../../../lib/clubText.ts";
import { OG_SIZE } from "../../../../../lib/ogImage.tsx";
import { crestDataUri, renderClubCard, renderGenericShareCard } from "../../../../../lib/shareCard.tsx";

export const alt = "FootSimu club chances";
export const size = OG_SIZE;
export const contentType = "image/png";
/** As the club page: room for a cold render (see page.tsx). */
export const maxDuration = 60;

/** A club page's card: its crest and name, where it stands and its chances (the page's own numbers). */
export default async function Image({ params }: { params: Promise<{ locale: string; league: string; teamSlug: string }> }) {
  const { locale, league: slug, teamSlug } = await params;
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const [t, tz, ts, tc] = await Promise.all([
    getTranslations({ locale: lang, namespace: "Club" }),
    getTranslations({ locale: lang, namespace: "Zones" }),
    getTranslations({ locale: lang, namespace: "ShareCard" }),
    getTranslations({ locale: lang, namespace: "Simulator" }),
  ]);
  const generic = () => renderGenericShareCard({ title: getLeagueBySlug(slug)?.name ?? "FootSimu", subtitle: ts("genericSubtitle"), cta: ts("cta") });
  const loaded = await loadClub(slug, teamSlug).catch(() => undefined);
  if (!loaded) return firstCardThatRenders([generic]);
  const { league, outlook, club, team, season } = loaded;
  // A crest that fails or takes too long: its initials (crestDataUri never throws).
  const crest = await crestDataUri(team.crest);
  const card = (withCrest: boolean) =>
    renderClubCard({
      pill: `${league.name} ${season}`.toUpperCase(),
      club: team.name,
      tla: team.tla,
      ...(withCrest && crest ? { crest } : {}),
      standing: `${ordinal(club.row.position, lang)} · ${club.row.points} ${tc("points")}`,
      // The range only (no chance on the card).
      likeliest: t("card.likeliest", { range: placeRange(club.likelyRange.from, club.likelyRange.to, lang) }),
      chances: clubCardChances(loaded, lang, t as never, tz as never).map((c) => ({ label: c.label, value: c.value, share: c.chance, color: zoneHex(c.zone) })),
      basedOn: t("card.basedOn", { count: new Intl.NumberFormat(lang).format(outlook.iterations) }),
      cta: t("card.cta"),
    });
  // With the crest; if it can't be drawn, with the initials; then the branded card.
  return firstCardThatRenders([() => card(true), () => card(false), generic]);
}
