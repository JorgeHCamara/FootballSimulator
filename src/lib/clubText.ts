import type { SiteLocale } from "../config/leagues.ts";

/** "1st", "1º", "1.º". */
export function ordinal(n: number, locale: SiteLocale): string {
  if (locale === "pt") return `${n}º`;
  if (locale === "es") return `${n}.º`;
  const suffix = { one: "st", two: "nd", few: "rd", other: "th" }[new Intl.PluralRules("en", { type: "ordinal" }).select(n) as "one" | "two" | "few" | "other"] ?? "th";
  return `${n}${suffix}`;
}

/** Places as a range: "1st–4th", or "5th". */
export const placeRange = (from: number, to: number, locale: SiteLocale) => (from === to ? ordinal(from, locale) : `${ordinal(from, locale)}–${ordinal(to, locale)}`);

/** A chance as a whole percentage, never rounding a possibility to 0% or 100%. */
export function percent(share: number, locale: SiteLocale): string {
  const format = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  if (share > 0 && share < 0.005) return `<${format.format(0.01)}`;
  if (share < 1 && share > 0.995) return `>${format.format(0.99)}`;
  return format.format(share);
}

/** "a, b and c" in the page's language (British English: no serial comma). */
export const listOf = (items: readonly string[], locale: SiteLocale) => new Intl.ListFormat(locale === "en" ? "en-GB" : locale, { type: "conjunction" }).format(items);
