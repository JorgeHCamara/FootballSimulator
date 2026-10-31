import { routing } from "../i18n/routing.ts";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.footballsimulator.com";

/** Canonical + hreflang links for a path such as "" (home) or "/bundesliga". */
export function alternates(locale: string, path: string) {
  return {
    canonical: `/${locale}${path}`,
    languages: Object.fromEntries([
      ...routing.locales.map((l) => [l, `/${l}${path}`]),
      ["x-default", `/${routing.defaultLocale}${path}`],
    ]),
  };
}
