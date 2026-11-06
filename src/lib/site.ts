import { routing } from "../i18n/routing.ts";

export const SITE_NAME = "Foot Simu";
/** Google Search Console HTML-tag verification for https://footsimu.com (public by design). */
export const GOOGLE_SITE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "NNYCQH90rIGoWobSE23pk7USI5FSAfXfFxO2-Y_Jzr0";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://footsimu.com").replace(/\/$/, "");

/** Pages about the site itself, linked from the footer. */
export const SITE_PAGES = ["about", "privacy", "contact"] as const;

export const CONTACT_EMAIL = "contact@footsimu.com";

/**
 * My World is linked from the menus, the home page and the sitemap (and
 * indexed). Off while it is reworked: the page still works at its address,
 * but nothing links to it and search engines are asked not to index it.
 */
export const MY_WORLD_LISTED = false;

/**
 * Google AdSense publisher id ("ca-pub-…"), set in the deployment once the
 * site is approved; until then no ad code is loaded and ads.txt is a 404.
 */
export const ADSENSE_CLIENT = adsenseClient(process.env.NEXT_PUBLIC_ADSENSE_CLIENT);

export function adsenseClient(value: string | undefined): string | undefined {
  const id = value?.trim();
  return id && /^ca-pub-\d{10,20}$/.test(id) ? id : undefined;
}

/** ads.txt: Google may sell this site's ad space, for this publisher only. */
export function adsTxt(client: string): string {
  return `google.com, ${client.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`;
}

/** hreflang codes: Portuguese content is written for Brazil. */
export const HREFLANG: Record<string, string> = { en: "en", pt: "pt-BR", es: "es" };
export const OG_LOCALE: Record<string, string> = { en: "en_GB", pt: "pt_BR", es: "es_ES" };

/** Canonical + hreflang links for a path such as "" (home) or "/bundesliga". */
export function alternates(locale: string, path: string) {
  return {
    canonical: `/${locale}${path}`,
    languages: Object.fromEntries([
      ...routing.locales.map((l) => [HREFLANG[l] ?? l, `/${l}${path}`]),
      ["x-default", `/${routing.defaultLocale}${path}`],
    ]),
  };
}

/** Replaces {name} placeholders in raw message strings (used for FAQ arrays). */
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export interface FaqItem {
  q: string;
  a: string;
}

export function faqJsonLd(items: FaqItem[]) {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}
