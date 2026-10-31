"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "../i18n/navigation.ts";
import { routing } from "../i18n/routing.ts";

const LABELS: Record<string, string> = { en: "EN", pt: "PT", es: "ES" };

export function LanguageSwitcher() {
  const t = useTranslations("Nav");
  const locale = useLocale();
  const pathname = usePathname();
  return (
    <nav aria-label={t("language")} className="flex gap-1 text-xs font-semibold">
      {routing.locales.map((l) => (
        <Link
          key={l}
          href={pathname}
          locale={l}
          hrefLang={l}
          aria-current={l === locale ? "true" : undefined}
          className={`rounded px-1.5 py-1 ${l === locale ? "bg-white text-pitch-900" : "text-white hover:bg-white/10"}`}
        >
          {LABELS[l]}
        </Link>
      ))}
    </nav>
  );
}
