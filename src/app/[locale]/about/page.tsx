import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage, type LegalSection } from "../../../components/LegalPage.tsx";
import { alternates, OG_LOCALE } from "../../../lib/site.ts";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Legal" });
  return {
    title: t("about.title"),
    description: t("about.description"),
    alternates: alternates(locale, "/about"),
    openGraph: { title: t("about.title"), description: t("about.description"), url: `/${locale}/about`, locale: OG_LOCALE[locale] },
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Legal");
  return (
    <LegalPage
      title={t("about.title")}
      sections={t.raw("about.sections") as LegalSection[]}
    />
  );
}
