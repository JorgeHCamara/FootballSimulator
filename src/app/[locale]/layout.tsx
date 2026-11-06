import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import Script from "next/script";
import type { ReactNode } from "react";
import { SiteFooter } from "../../components/SiteFooter.tsx";
import { SiteHeader } from "../../components/SiteHeader.tsx";
import { COMPETITIONS } from "../../config/competitions.ts";
import { routing } from "../../i18n/routing.ts";
import { ADSENSE_CLIENT, GOOGLE_SITE_VERIFICATION, HREFLANG, OG_LOCALE, SITE_NAME, SITE_URL, alternates } from "../../lib/site.ts";
import "../globals.css";

const CLIENT_NAMESPACES = ["Nav", "Simulator", "Zones", "Countries", "Continents", "Cup"];

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: "#166534",
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Metadata" });
  const description = t("homeDescription", { count: COMPETITIONS.length });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `${t("homeTitle")} | ${SITE_NAME}`, template: `%s | ${SITE_NAME}` },
    description,
    applicationName: SITE_NAME,
    alternates: alternates(locale, ""),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: OG_LOCALE[locale],
      alternateLocale: routing.locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]!),
      title: t("homeTitle"),
      description,
      url: `/${locale}`,
    },
    twitter: { card: "summary_large_image", title: t("homeTitle"), description },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    verification: { google: GOOGLE_SITE_VERIFICATION },
    // AdSense's site ownership tag, once a publisher id is set.
    ...(ADSENSE_CLIENT ? { other: { "google-adsense-account": ADSENSE_CLIENT } } : {}),
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
        {/* Google AdSense Auto ads, once approved (consent in the EEA/UK/CH: AdSense's own certified message). */}
        {ADSENSE_CLIENT && (
          <Script
            id="adsense"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
            strategy="afterInteractive"
            crossOrigin="anonymous"
          />
        )}
      </body>
    </html>
  );
}
