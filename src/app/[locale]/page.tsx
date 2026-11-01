import { getTranslations, setRequestLocale } from "next-intl/server";
import { Faq } from "../../components/Faq.tsx";
import { Flag } from "../../components/Flag.tsx";
import { JsonLd } from "../../components/JsonLd.tsx";
import { LEAGUES, type CompetitionCode, type SiteLocale } from "../../config/leagues.ts";
import { Link } from "../../i18n/navigation.ts";
import { HREFLANG, SITE_NAME, SITE_URL, faqJsonLd, type FaqItem } from "../../lib/site.ts";

/** Leagues with a card on the home page; every league is still in the header menu and footer. */
const HOME_LEAGUES: readonly CompetitionCode[] = ["PL", "ELC", "PD", "BL1", "SA", "FL1", "PPL", "BSA", "MLS"];

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Home");
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
            alternateName: ["FootSimu", "Football Simulator", "Simulador de Futebol", "Simulador de Fútbol"],
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
            description: meta("homeDescription"),
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
        <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{t("heading")}</h1>
        <p className="mt-2 text-lg font-semibold text-pitch-700 dark:text-pitch-100">{t("tagline")}</p>
        <p className="mx-auto mt-3 max-w-2xl text-zinc-600 text-pretty dark:text-zinc-400">{t("subheading")}</p>
      </section>

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
        <h2 className="text-xl font-bold tracking-tight">{t("aboutTitle")}</h2>
        <p className="max-w-3xl leading-relaxed text-zinc-600 dark:text-zinc-400">{t("aboutBody")}</p>
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
