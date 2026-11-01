import { routing } from "../i18n/routing.ts";

export const SITE_NAME = "Foot Simu";
/** Google Search Console HTML-tag verification for https://footsimu.com (public by design). */
export const GOOGLE_SITE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "NNYCQH90rIGoWobSE23pk7USI5FSAfXfFxO2-Y_Jzr0";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://footsimu.com").replace(/\/$/, "");

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
