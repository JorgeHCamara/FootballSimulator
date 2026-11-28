import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HowItWorksPage, type HowItWorksCopy } from "../../../components/HowItWorksPage.tsx";
import { alternates, OG_LOCALE } from "../../../lib/site.ts";

/*
 * "How FootSimu works": the methodology, in the messages (HowItWorks). Static
 * like About: no data read, no revalidate, built for each language by the
 * locale layout's generateStaticParams. Linked from the footer only.
 */

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "HowItWorks" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: alternates(locale, "/how-it-works"),
    openGraph: { title: t("title"), description: t("description"), url: `/${locale}/how-it-works`, locale: OG_LOCALE[locale] },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("HowItWorks");
  const seo = await getTranslations("Seo");
  const copy: HowItWorksCopy = {
    title: t("title"),
    description: t("description"),
    deck: t("deck"),
    diagramLabel: t("diagramLabel"),
    diagram: t.raw("diagram") as HowItWorksCopy["diagram"],
    sections: t.raw("sections") as HowItWorksCopy["sections"],
    example: t.raw("example") as HowItWorksCopy["example"],
    breadcrumb: seo("breadcrumb"),
    breadcrumbHome: seo("breadcrumbHome"),
  };
  return <HowItWorksPage locale={locale} copy={copy} />;
}
