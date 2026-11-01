import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SiteFooter } from "../../components/SiteFooter.tsx";
import { SiteHeader } from "../../components/SiteHeader.tsx";
import { routing } from "../../i18n/routing.ts";
import { GOOGLE_SITE_VERIFICATION, HREFLANG, OG_LOCALE, SITE_NAME, SITE_URL, alternates } from "../../lib/site.ts";
import "../globals.css";

const CLIENT_NAMESPACES = ["Nav", "Simulator", "Zones", "Countries", "Cup"];

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: "#166534",
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("homeTitle"), template: `%s | ${SITE_NAME}` },
    description: t("homeDescription"),
    applicationName: SITE_NAME,
    alternates: alternates(locale, ""),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OG_LOCALE[locale],
      alternateLocale: routing.locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]!),
      title: t("homeTitle"),
      description: t("homeDescription"),
      url: `/${locale}`,
    },
    twitter: { card: "summary_large_image", title: t("homeTitle"), description: t("homeDescription") },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    verification: { google: GOOGLE_SITE_VERIFICATION },
  };
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // Client components only use these namespaces; the long SEO/FAQ copy stays on the server.
  const messages = await getMessages();
  const clientMessages = Object.fromEntries(
    CLIENT_NAMESPACES.filter((ns) => ns in messages).map((ns) => [ns, messages[ns]]),
  );

  return (
    <html lang={HREFLANG[locale]}>
      <body className="min-h-screen">
        <NextIntlClientProvider messages={clientMessages}>
          <SiteHeader />
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
          <SiteFooter />
        </NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
