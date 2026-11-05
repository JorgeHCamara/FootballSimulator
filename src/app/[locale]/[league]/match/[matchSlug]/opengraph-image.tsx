import { getTranslations } from "next-intl/server";
import { getLeagueBySlug, type SiteLocale } from "../../../../../config/leagues.ts";
import { percent } from "../../../../../lib/clubText.ts";
import { loadMatch } from "../../../../../lib/matchPreview.ts";
import { OG_SIZE } from "../../../../../lib/ogImage.tsx";
import { crestDataUri, renderGenericShareCard, renderMatchCard } from "../../../../../lib/shareCard.tsx";

export const alt = "Foot Simu match prediction";
export const size = OG_SIZE;
export const contentType = "image/png";

/** A match page's card: the two clubs, when they meet, and the model's win/draw/loss chances (with the final score once played). */
export default async function Image({ params }: { params: Promise<{ locale: string; league: string; matchSlug: string }> }) {
  const { locale, league: slug, matchSlug } = await params;
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const [t, ts] = await Promise.all([getTranslations({ locale: lang, namespace: "Match" }), getTranslations({ locale: lang, namespace: "ShareCard" })]);
  const loaded = await loadMatch(slug, matchSlug).catch(() => undefined);
  if (!loaded || "moved" in loaded) {
    const league = getLeagueBySlug(slug);
    return renderGenericShareCard({ title: league?.name ?? "Foot Simu", subtitle: ts("genericSubtitle"), cta: ts("cta") });
  }
  const { league, match, odds, result, state, season, timeZone } = loaded;
  const { home, away, fixture } = match;
  const [homeCrest, awayCrest] = await Promise.all([crestDataUri(home.crest), crestDataUri(away.crest)]);
  const when = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : lang, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short" }).format(new Date(fixture.utcDate));
  return renderMatchCard({
    pill: `${league.name} ${season}`.toUpperCase(),
    home: { name: home.name, tla: home.tla, ...(homeCrest ? { crest: homeCrest } : {}) },
    away: { name: away.name, tla: away.tla, ...(awayCrest ? { crest: awayCrest } : {}) },
    when,
    ...(state === "played" && result ? { result: { score: `${result.home}–${result.away}`, label: t("card.fullTime") }, oddsTitle: t("card.preMatch") } : {}),
    odds: [
      { label: t("win", { team: home.shortName }), value: percent(odds.home, lang), share: odds.home, color: "#16a34a" },
      { label: t("draw"), value: percent(odds.draw, lang), share: odds.draw, color: "#a1a1aa" },
      { label: t("win", { team: away.shortName }), value: percent(odds.away, lang), share: odds.away, color: "#2563eb" },
    ],
    cta: t("card.cta"),
  });
}
