import { getTranslations, setRequestLocale } from "next-intl/server";
import { Faq } from "../../components/Faq.tsx";
import { Flag } from "../../components/Flag.tsx";
import { Icon } from "../../components/Icon.tsx";
import { JsonLd } from "../../components/JsonLd.tsx";
import { COMPETITIONS } from "../../config/competitions.ts";
import { LEAGUES, type CompetitionCode, type SiteLocale } from "../../config/leagues.ts";
import { Link } from "../../i18n/navigation.ts";
import { HREFLANG, MY_WORLD_LISTED, SITE_NAME, SITE_URL, faqJsonLd, type FaqItem } from "../../lib/site.ts";

/** Leagues with a card on the home page; every league is still in the header menu and footer. */
const HOME_LEAGUES: readonly CompetitionCode[] = ["PL", "ELC", "PD", "BL1", "SA", "FL1", "PPL", "BSA", "MLS"];

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");
  const worldT = await getTranslations("World");
  const meta = await getTranslations("Metadata");
  const faq = (await getTranslations("Faq")).raw("home") as FaqItem[];
  const lang = locale as SiteLocale;

  const features = [
    { title: t("featurePredictTitle"), body: t("featurePredictBody") },
    { title: t("featureSimulateTitle"), body: t("featureSimulateBody") },
    { title: t("featureChancesTitle"), body: t("featureChancesBody") },
  ];

  return (
    <div className="space-y-12">
      <JsonLd
        data={[
          {
            "@type": "WebSite",
            "@id": `${SITE_URL}/#website`,
            name: SITE_NAME,
            alternateName: ["Foot Simu", "Football Simulator"],
            url: `${SITE_URL}/${locale}`,
            inLanguage: HREFLANG[locale],
            publisher: { "@id": `${SITE_URL}/#organization` },
          },
          {
            "@type": "Organization",
            "@id": `${SITE_URL}/#organization`,
            name: SITE_NAME,
            url: SITE_URL,
            logo: `${SITE_URL}/icon.svg`,
          },
          {
            "@type": "WebApplication",
            name: `${SITE_NAME} – ${t("heading")}`,
            url: `${SITE_URL}/${locale}`,
            description: meta("homeDescription", { count: COMPETITIONS.length }),
            applicationCategory: "GameApplication",
            applicationSubCategory: "Sports simulation",
            operatingSystem: "Web",
            inLanguage: HREFLANG[locale],
            isAccessibleForFree: true,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          },
          faqJsonLd(faq),
        ]}
      />

      <section className="pt-4 text-center">
        {/* Not shown (the header already says FootSimu), but kept as the page's H1 for search engines and screen readers. */}
        <h1 className="sr-only">{t("heading")}</h1>
        <p className="text-lg font-semibold text-pitch-700 dark:text-pitch-100">{t("tagline")}</p>
        <p className="mx-auto mt-3 max-w-2xl text-zinc-600 text-pretty dark:text-zinc-400">{t("subheading")}</p>
      </section>

      {/* The game modes, by the main simulators: My World (a club's seasons up the English pyramid; unlisted for now, see MY_WORLD_LISTED) and the daily quiz. */}
      <div className={`grid gap-3 ${MY_WORLD_LISTED ? "md:grid-cols-2" : ""}`}>
        {[
          ...(MY_WORLD_LISTED ? [{ href: "/my-world", icon: "globe" as const, title: worldT("homeTitle"), body: worldT("homeBody"), cta: worldT("homeCta"), testId: "home-my-world" }] : []),
          { href: "/quiz", icon: "circle-help" as const, title: t("quizTitle"), body: t("quizBody"), cta: t("quizCta"), testId: "home-quiz" },
        ].map((mode) => (
          <Link
            key={mode.href}
            href={mode.href}
            className="group flex flex-col gap-3 rounded-xl border border-pitch-100 bg-pitch-50 p-4 transition hover:border-pitch-500 hover:shadow-md dark:border-pitch-900 dark:bg-pitch-900/30"
            data-testid={mode.testId}
          >
            <span className="flex min-w-0 flex-1 items-start gap-3">
              <Icon name={mode.icon} size={28} className="shrink-0 text-pitch-600 dark:text-pitch-100" />
              <span className="min-w-0">
                <span className="block font-bold">{mode.title}</span>
                <span className="block text-sm text-zinc-600 dark:text-zinc-400">{mode.body}</span>
              </span>
            </span>
            <span className="flex h-11 items-center justify-center gap-1.5 self-stretch rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white group-hover:bg-pitch-700 sm:self-start">
              {mode.cta}
              <Icon name="chevron-right" size={18} />
            </span>
          </Link>
        ))}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {HOME_LEAGUES.flatMap((code) => LEAGUES.filter((l) => l.code === code)).map((l) => (
          <li key={l.code}>
            <Link
              href={`/${l.slug}`}
              className="group flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-pitch-500 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              title={l.simulatorName[lang]}
            >
              <Flag code={l.flag} width={42} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{l.name}</span>
                <span className="block truncate text-xs text-zinc-500">{l.aka[lang]}</span>
                <span className="block text-xs text-zinc-500">{t("teams", { count: l.teams })}</span>
              </span>
              <span className="rounded-lg bg-pitch-600 px-3 py-1.5 text-sm font-semibold text-white group-hover:bg-pitch-700">
                {t("open")}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="space-y-4">
        <ul className="grid gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <li key={f.title} className="rounded-xl border-l-4 border-pitch-500 bg-pitch-50 p-4 dark:bg-pitch-900/30">
              <h3 className="font-bold">{f.title}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <Faq title={(await getTranslations("Seo"))("faqTitle")} items={faq} />
    </div>
  );
}
